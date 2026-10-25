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

  // GET, or POST when a body is given
  async function call(path, body) {
    const t = token();
    const res = await fetch(API + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'X-API-Key': apiKey, ...(t ? { Authorization: 'Bearer ' + t.access_token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const j = await res.json();
    if (j.ErrorStatus === 'AccessNotPermittedByApplicationScope')
      throw new Error('This site isn\'t allowed to move gear yet. Tick "Move or equip Destiny gear" in your Bungie app settings, then sign out and back in here.');
    if (j.ErrorCode !== 1) throw new Error(j.Message || j.ErrorStatus);
    return j.Response;
  }

  const POSTMASTER = 215593132;
  // Human-readable place, kept in step with owner/equipped as items move.
  function locate(p, it) {
    const cls = p.chars.find(c => c.id === it.owner)?.cls;
    it.location = it.postmaster ? `Postmaster (${cls})` : !it.owner ? 'Vault' : it.equipped ? `${cls} (equipped)` : cls;
  }

  // Returns { name, membershipType, chars: [{ id, cls, emblem, light }], items: [{ itemHash, instanceId, owner (character id, null = vault), equipped,
  // postmaster, location, plugs: Set<plugHash> (socketed plus selectable), socketed: Set<plugHash>, power, tier, stats: {statHash: value} }] }
  // for every instanced item.
  async function loadProfile() {
    const m = await call('/User/GetMembershipsForCurrentUser/');
    const primary = m.primaryMembershipId;
    const dm = m.destinyMemberships.find(x => x.membershipId === primary) || m.destinyMemberships[0];
    if (!dm) throw new Error('No Destiny account found on this Bungie profile.');
    const p = await call(`/Destiny2/${dm.membershipType}/Profile/${dm.membershipId}/?components=102,200,201,205,300,304,305,310`);
    const items = [];
    const push = (list, owner, equipped) => list.forEach(i => i.itemInstanceId && items.push({ itemHash: i.itemHash, instanceId: i.itemInstanceId, owner, equipped,
      postmaster: i.bucketHash === POSTMASTER }));
    push(p.profileInventory.data.items, null, false);
    for (const [cid, inv] of Object.entries(p.characterInventories.data || {})) push(inv.items, cid, false);
    for (const [cid, eq] of Object.entries(p.characterEquipment.data || {})) push(eq.items, cid, true);
    const chars = Object.entries(p.characters?.data || {}).map(([id, c]) => ({ id, cls: ['Titan', 'Hunter', 'Warlock'][c.classType] || 'Character ' + id.slice(-4),
      emblem: c.emblemBackgroundPath || '', light: c.light || 0 }));
    // Postmaster slots used per character (it holds 21), counting engrams and materials the site doesn't list
    const postmasterUsed = Object.fromEntries(Object.entries(p.characterInventories.data || {}).map(([cid, inv]) => [cid, inv.items.filter(i => i.bucketHash === POSTMASTER).length]));
    const profile = { name: m.bungieNetUser.uniqueName || m.bungieNetUser.displayName, membershipType: dm.membershipType, chars, items, postmasterUsed };
    const sockets = p.itemComponents.sockets.data || {}, reusable = p.itemComponents.reusablePlugs.data || {}, inst = p.itemComponents.instances.data || {};
    const stats = p.itemComponents.stats?.data || {};
    for (const it of items) {
      const plugs = new Set(), socketed = new Set();
      (sockets[it.instanceId]?.sockets || []).forEach(s => s.plugHash && (plugs.add(s.plugHash), socketed.add(s.plugHash)));
      Object.values(reusable[it.instanceId]?.plugs || {}).forEach(col => col.forEach(pl => plugs.add(pl.plugItemHash)));
      it.plugs = plugs; it.socketed = socketed;
      it.power = inst[it.instanceId]?.primaryStat?.value || 0;
      it.tier = inst[it.instanceId]?.gearTier || 0;
      it.stats = Object.fromEntries(Object.entries(stats[it.instanceId]?.stats || {}).map(([h, s]) => [h, s.value]));
      locate(profile, it);
    }
    return profile;
  }

  // Moves an item to a character id or 'vault'. Character-to-character goes through the vault, as in game.
  async function move(p, it, to) {
    const transfer = (characterId, transferToVault) => call('/Destiny2/Actions/Items/TransferItem/',
      { itemReferenceHash: it.itemHash, stackSize: 1, transferToVault, itemId: it.instanceId, characterId, membershipType: p.membershipType });
    if (it.owner && it.owner !== to) { await transfer(it.owner, true); it.owner = null; locate(p, it); }
    if (to !== 'vault' && it.owner !== to) { await transfer(to, false); it.owner = to; locate(p, it); }
  }

  // Pulls an item out of its character's Postmaster into that character's inventory.
  async function pull(p, it) {
    await call('/Destiny2/Actions/Items/PullFromPostmaster/', { itemReferenceHash: it.itemHash, stackSize: 1, itemId: it.instanceId, characterId: it.owner, membershipType: p.membershipType });
    it.postmaster = false; p.postmasterUsed[it.owner]--; locate(p, it);
  }

  // Equips an item that is already on a character; the caller unmarks whatever it replaced.
  async function equip(p, it) {
    await call('/Destiny2/Actions/Items/EquipItem/', { itemId: it.instanceId, characterId: it.owner, membershipType: p.membershipType });
    it.equipped = true; locate(p, it);
  }

  // Equips several items on one character in one call, so exotic swaps resolve together. Returns the items that failed.
  async function equipAll(p, items, characterId) {
    if (!items.length) return [];
    const r = await call('/Destiny2/Actions/Items/EquipItems/', { itemIds: items.map(i => i.instanceId), characterId, membershipType: p.membershipType });
    const failed = new Set(r.equipResults.filter(x => x.equipStatus !== 1).map(x => x.itemInstanceId));
    return items.filter(i => failed.has(i.instanceId));
  }

  // One DestinyInventoryItemDefinition, for hashes the site's data files don't cover (subclasses, mods, artifact perks).
  const item = hash => call(`/Destiny2/Manifest/DestinyInventoryItemDefinition/${hash}/`);

  return { token, signIn, signOut, handleRedirect, loadProfile, move, pull, equip, equipAll, item, locate, store };
})();
