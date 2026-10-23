// Bungie OAuth (public client, authorization code flow) and profile loading.
const Bungie = (() => {
  const { apiKey, clientId } = window.D2_CONFIG;
  const API = 'https://www.bungie.net/Platform';
  const TOKEN_KEY = 'd2c_token';

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  function token() {
    const t = store.get(TOKEN_KEY);
    return t && t.expires_at > Date.now() ? t : null;
  }

  function signIn() {
    const state = crypto.getRandomValues(new Uint32Array(2)).join('');
    sessionStorage.setItem('d2c_state', state);
    sessionStorage.setItem('d2c_return', location.hash || '#/inventory');
    location.href = `https://www.bungie.net/en/OAuth/Authorize?client_id=${clientId}&response_type=code&state=${state}`;
  }

  function signOut() { store.set(TOKEN_KEY, null); }

  // Called on page load: finishes the OAuth redirect if Bungie just sent us back with ?code=.
  async function handleRedirect() {
    const q = new URLSearchParams(location.search);
    if (!q.get('code')) return;
    const back = sessionStorage.getItem('d2c_return') || '#/inventory';
    if (q.get('state') !== sessionStorage.getItem('d2c_state')) throw new Error('Sign-in state mismatch, please try again.');
    const res = await fetch(`${API}/App/OAuth/Token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: q.get('code'), client_id: clientId }),
    });
    const t = await res.json();
    if (!t.access_token) throw new Error('Bungie sign-in failed: ' + (t.error_description || t.error || res.status));
    store.set(TOKEN_KEY, { access_token: t.access_token, membership_id: t.membership_id, expires_at: Date.now() + (t.expires_in - 60) * 1000 });
    history.replaceState(null, '', location.pathname + back);
  }

  async function call(path) {
    const t = token();
    const res = await fetch(API + path, { headers: { 'X-API-Key': apiKey, ...(t ? { Authorization: 'Bearer ' + t.access_token } : {}) } });
    const j = await res.json();
    if (j.ErrorCode !== 1) throw new Error(`${j.ErrorStatus}: ${j.Message}`);
    return j.Response;
  }

  // Returns { name, items: [{ itemHash, instanceId, location, plugs: Set<plugHash>, power, tier, stats: {statHash: value} }] } for every instanced item.
  async function loadProfile() {
    const m = await call('/User/GetMembershipsForCurrentUser/');
    const primary = m.primaryMembershipId;
    const dm = m.destinyMemberships.find(x => x.membershipId === primary) || m.destinyMemberships[0];
    if (!dm) throw new Error('No Destiny account found on this Bungie profile.');
    const p = await call(`/Destiny2/${dm.membershipType}/Profile/${dm.membershipId}/?components=102,200,201,205,300,304,305,310`);
    const items = [];
    const push = (list, where) => list.forEach(i => i.itemInstanceId && items.push({ itemHash: i.itemHash, instanceId: i.itemInstanceId, location: where }));
    push(p.profileInventory.data.items, 'Vault');
    const charName = cid => ['Titan', 'Hunter', 'Warlock'][p.characters?.data?.[cid]?.classType] || 'Character ' + cid.slice(-4);
    for (const [cid, inv] of Object.entries(p.characterInventories.data || {})) push(inv.items, charName(cid));
    for (const [cid, eq] of Object.entries(p.characterEquipment.data || {})) push(eq.items, charName(cid) + ' (equipped)');
    const sockets = p.itemComponents.sockets.data || {}, reusable = p.itemComponents.reusablePlugs.data || {}, inst = p.itemComponents.instances.data || {};
    const stats = p.itemComponents.stats?.data || {};
    for (const it of items) {
      const plugs = new Set();
      (sockets[it.instanceId]?.sockets || []).forEach(s => s.plugHash && plugs.add(s.plugHash));
      Object.values(reusable[it.instanceId]?.plugs || {}).forEach(col => col.forEach(pl => plugs.add(pl.plugItemHash)));
      it.plugs = plugs;
      it.power = inst[it.instanceId]?.primaryStat?.value || 0;
      it.tier = inst[it.instanceId]?.gearTier || 0;
      it.stats = Object.fromEntries(Object.entries(stats[it.instanceId]?.stats || {}).map(([h, s]) => [h, s.value]));
    }
    return { name: m.bungieNetUser.uniqueName || m.bungieNetUser.displayName, items };
  }

  return { token, signIn, signOut, handleRedirect, loadProfile, store };
})();
