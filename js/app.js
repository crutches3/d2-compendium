// D2 Compendium: hash-routed single page app over data/*.json plus live Bungie profile data.
const BNET = 'https://www.bungie.net';
const $app = document.getElementById('app');
const S = { profile: null };
const cache = {};
let routeSeq = 0;
// Settles only while the page that asked is still the one showing, so a slow page you've left never draws over the next one.
const live = async promise => { const seq = routeSeq, v = await promise; if (seq !== routeSeq) await new Promise(() => {}); return v; };
// data files carry the page's ?v= too, so a release never pairs new code with a browser-cached old file
const DATA_VERSION = new URL(document.currentScript.src).search;
const load = name => live(cache[name] ||= fetch(`data/${name}.json${DATA_VERSION}`).then(r => r.json()));

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const img = (path, cls = '') => path ? `<img class="${cls}" loading="lazy" src="${BNET}${path}" alt="">` : '';
const icon = w => `<span class="icon">${img(w.i)}${img(w.wm, 'wm')}</span>`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const card = (w, sub, kind = 'weapon') => `<a class="card" href="#/${kind}/${w.h}">${icon(w)}<div><b>${esc(w.n)}</b>${sub}</div></a>`;
const select = (id, label, vals, cur = '') => `<select id="${id}" aria-label="${label}"><option value="">${label}</option>${vals.map(v => {
  const [val, text] = Array.isArray(v) ? v : [v, v];
  return `<option value="${esc(val)}"${String(val) === cur ? ' selected' : ''}>${esc(text)}</option>`; }).join('')}</select>`;
const hero = (x, badges) => `<div class="hero" style="background-image:url('${BNET}${x.ss}')"><div class="shade">${icon(x)}<div>
  <h1>${esc(x.n)}</h1><div>${badges}</div>${x.fl ? `<p class="flavor">${esc(x.fl)}</p>` : ''}</div></div></div>`;

async function data() {
  const [w, plugs, gr] = await Promise.all([load('weapons'), load('plugs'), load('godrolls')]);
  w.byHash ||= Object.fromEntries(w.weapons.map(x => [x.h, x]));
  return { weapons: w.weapons, byHash: w.byHash, version: w.version, plugs, rolls: gr.rolls, source: gr.source };
}

// d.rolls[hash] is Aegis's Endgame Analysis rating. A copy is a god roll when it has one of the Perk 1 picks and one of the
// Perk 2 picks; exotics are rated but have no roll to match.
const rollMatches = (roll, plugs) => !!roll?.c?.length && roll.c.every(col => col.some(p => plugs.has(p)));
const TIERS = ['S', 'A', 'B', 'C', 'D', 'E', 'F'];
const tierOrder = r => r ? (TIERS.indexOf(r.t) + 1 || 9) * 1000 + r.r : 1e5;
const tierBadge = r => r ? `<span class="badge tier tier-${esc(r.t)}">Tier ${esc(r.t)}</span>` : '';

async function profile() {
  if (S.profile || !Bungie.token()) return S.profile;
  return live(Bungie.loadProfile().then(p => S.profile = p));
}

function renderAccount() {
  const el = document.getElementById('account');
  el.innerHTML = Bungie.token()
    ? `${esc(S.profile?.name || 'Signed in')} · <a href="#" id="signout">Sign out</a>`
    : `<button class="primary" id="signin">Sign in with Bungie</button>`;
  el.querySelector('#signin')?.addEventListener('click', Bungie.signIn);
  el.querySelector('#signout')?.addEventListener('click', e => { e.preventDefault(); Bungie.signOut(); S.profile = null; route(); });
}

// ---------- community sheet lookups ----------
let sheetIndex;
async function sheets() {
  const tabs = await load('tabs');
  if (!sheetIndex) {
    sheetIndex = new Map();
    tabs.forEach((t, ti) => t.rows.forEach((r, ri) => r.forEach((c, ci) => {
      const k = c.split('\n')[0].replace(/^↑/, '').trim().toLowerCase();
      if (k && k.length < 60) { if (!sheetIndex.has(k)) sheetIndex.set(k, []); sheetIndex.get(k).push([ti, ri, ci]); }
    })));
  }
  return tabs;
}

// Monument of Triumph loot tabs: column 0 is the item, rows like ['', 'Nessus', ...] start a group.
let farmSources;
async function monumentSources() {
  if (farmSources) return farmSources;
  farmSources = new Map();
  // activities first so a raid gun that Xur also sells is filed under the raid
  const rank = t => ['Raids', 'Dungeons', 'Destinations', 'Portal Attuneable Gear'].indexOf(t.tab) + 1 || 9;
  for (const t of [...await sheets()].sort((a, b) => rank(a) - rank(b))) {
    if (!t.source.startsWith('Monument') || !t.rows[0] || t.rows[0][0] !== 'Loot') continue;
    const enc = t.rows[0].indexOf('Encounter(s)');
    let group = '';
    for (const r of t.rows.slice(1)) {
      if (!r[0] && r[1]) { group = r[1]; continue; }
      const key = r[0].replace(/\s*(\|.*|\(Adept\))$/i, '').trim().toLowerCase();
      if (key) farmSources.set(key, [...(farmSources.get(key) || []), `${t.tab.replace(/ \(Cla$/, '')} · ${group}` + (enc > 0 && r[enc] ? ` (${r[enc]})` : '')]);
    }
  }
  return farmSources;
}
const bungieSource = w => /^Random Perks/.test(w.src) ? '' : w.src.replace(/^Source:\s*/, '');
// Every known source, best first: Monument of Triumph rows, then Bungie's collection text.
async function whereToFarm(w) { return (await monumentSources()).get(w.n.toLowerCase()) || [bungieSource(w)].filter(Boolean); }

// Header guess: the row among the first four with the most short, non-empty cells.
function headerRow(t) {
  let best = t.rows[0], score = -1;
  t.rows.slice(0, 4).forEach(r => { const s = r.filter(c => c && c.length < 30).length; if (s > score) { score = s; best = r; } });
  return best;
}

async function sheetRows(key, filter = () => true) {
  const tabs = await sheets();
  const hits = (sheetIndex.get(key.toLowerCase()) || []).filter(([ti, ri]) => filter(tabs[ti], tabs[ti].rows[ri]));
  return [...new Map(hits.map(h => [h[0] + ',' + h[1], h])).values()].map(([ti, ri, ci]) => {
    const tab = tabs[ti], head = headerRow(tab);
    // tabs like Exotic Armors repeat a column block per class ("Armor, Icon, Notes" x3): keep only the matched item's block
    let [from, to] = [0, head.length];
    if (head[ci] && head.indexOf(head[ci]) !== head.lastIndexOf(head[ci])) {
      from = ci; const next = head.indexOf(head[ci], ci + 1); to = next < 0 ? head.length : next;
    }
    return { tab, row: tab.rows[ri].slice(from, to), head: head.slice(from, to) };
  });
}

function rowTable(hits) {
  return hits.map(({ tab, row, head }) => {
    const label = i => head[i] && head[i] !== row[i] ? head[i].replace(/\s*\n\s*/g, ' ') : '';
    const cells = row.map((c, i) => c && !['/', '-', 'N/A'].includes(c) ? `<tr><td class="muted">${esc(label(i))}</td><td>${esc(c)}</td></tr>` : '').join('');
    return `<div class="roll"><b>${esc(tab.source)}</b> · ${esc(tab.tab)}<div class="tablewrap"><table class="sheet">${cells}</table></div></div>`;
  }).join('');
}

// ---------- pages ----------
async function weaponList(params) {
  const d = await data();
  const uniq = (k) => [...new Set(d.weapons.map(w => w[k]).filter(Boolean))].sort();
  $app.innerHTML = `<h1>Weapons</h1><p class="muted">Every weapon in the game, with perks, stats, Endgame Analysis tiers and rolls, and what your sheets say about it.</p><div class="filters">
    <input type="search" id="q" aria-label="Search weapons" placeholder="Search weapons, perks or sources" value="${esc(params.get('q') || '')}">
    ${select('ty', 'All types', uniq('ty'))}${select('dm', 'All elements', uniq('dm'))}${select('am', 'All ammo', uniq('am'))}${select('ti', 'All rarities', uniq('ti'))}
    ${select('tier', 'All tiers', TIERS.map(t => [t, 'Tier ' + t]))}</div><p id="count" class="muted"></p><div class="grid" id="list"></div>`;
  const f = id => $app.querySelector('#' + id);
  const draw = () => {
    const q = f('q').value.trim().toLowerCase();
    const list = d.weapons.filter(w => (!q || w.n.toLowerCase().includes(q) || w.src.toLowerCase().includes(q) ||
        w.cols.some(c => c.p.some(p => d.plugs[p]?.n.toLowerCase() === q)))
      && ['ty', 'dm', 'am', 'ti'].every(k => !f(k).value || w[k] === f(k).value) && (!f('tier').value || d.rolls[w.h]?.t === f('tier').value));
    // reissues share a name; list each name once (newest version first, by the build's sort) and link the rest from its page
    const byName = new Map();
    list.forEach(w => byName.has(w.n) ? byName.get(w.n).count++ : byName.set(w.n, { w, count: 1 }));
    const names = [...byName.values()];
    f('count').textContent = plural(names.length, 'weapon') + (names.length > 300 ? ', showing the first 300' : '');
    f('list').innerHTML = names.slice(0, 300).map(({ w, count }) => card(w, `<small>${tierBadge(d.rolls[w.h])}<span class="dmg-${esc(w.dm)}">${esc(w.dm)}</span> ${esc(w.ty)} · ${esc(w.am)}</small>
      <small>${esc(bungieSource(w))}${count > 1 ? `${bungieSource(w) ? ' · ' : ''}${count} versions` : ''}</small>`)).join('')
      || '<p class="empty">No weapons match. Try a shorter search or clear a filter.</p>';
  };
  $app.querySelectorAll('input,select').forEach(el => el.addEventListener('input', draw));
  draw();
}

async function weaponPage(hash) {
  const d = await data();
  const w = d.byHash[hash];
  if (!w) { $app.innerHTML = '<p>Weapon not found.</p>'; return; }
  const same = d.weapons.filter(x => x.n === w.n && x.h !== w.h);
  const er = d.rolls[w.h];
  const godNames = new Set([...Object.values(er?.p || {}).flat(), er?.o]);
  // the masterwork socket offers every stat in the game; keep the ones this weapon has (Impact only on swords)
  const stats = new Set(w.st.map(s => s[0])), mwName = h => d.plugs[h]?.n.match(/^Masterworked: (.+)/)?.[1];
  const mw = { c: 'Masterwork', p: w.cols.flatMap(c => c.p).filter(h => stats.has(mwName(h)) && (mwName(h) !== 'Impact' || w.ty === 'Sword')) };
  const mwPicks = (er?.mw || '').toLowerCase().split(' or ').filter(Boolean);  // "Handling or Reload"
  mw.p.forEach(h => mwPicks.some(x => mwName(h).toLowerCase().startsWith(x)) && godNames.add(d.plugs[h].n));
  const perk = (h, col) => { const p = d.plugs[h];
    return `<button type="button" class="perk${godNames.has(p.n) ? ' god' : ''}${col.cur === h ? ' cur' : ''}" data-h="${h}">${img(p.i)}<span>${esc(mwName(h) || p.n)}${p.e ? ' <span class="enh">enhanced</span>' : ''}</span></button>`; };
  // enhanced versions share a name with the base perk, so show one entry per name (the first, usually the base);
  // "Empty ... Socket" plugs are placeholders, not choices
  const dedupe = hs => hs.filter((h, i) => d.plugs[h] && !/^Empty .*Socket$/.test(d.plugs[h].n) && hs.findIndex(x => d.plugs[x]?.n === d.plugs[h].n) === i);
  const perkCols = cols => cols.map(c => [c, dedupe(c.p)]).filter(([, hs]) => hs.length)
    .map(([c, hs]) => `<div class="perkcol"><h3>${esc(d.plugs[c.p[0]]?.t || c.c)}</h3>${hs.map(h => perk(h, c)).join('')}</div>`).join('');
  const maxStat = Math.max(100, ...w.st.filter(s => !s[2]).map(s => s[1]));
  $app.innerHTML = `
    ${hero(w, `<span class="badge">${esc(w.ti)}</span><span class="badge dmg-${esc(w.dm)}">${esc(w.dm)}</span><span class="badge">${esc(w.ty)}</span><span class="badge">${esc(w.sl)} · ${esc(w.am)}</span>${tierBadge(er)}`)}
    ${same.length ? `<p class="versions">Other versions: ${same.map((x, i) => `<a href="#/weapon/${x.h}">${esc(bungieSource(x) || 'version ' + (i + 2))}</a>`).join(' · ')}</p>` : ''}
    <section class="panel"><h2>Perks</h2><p class="legend"><span class="key god"></span> In the Endgame Analysis roll <span class="key cur"></span> Curated roll</p>
      <div class="perkwrap"><div class="perkcols">${perkCols([...w.cols.filter(c => c.c !== 'Weapon Mods'), mw])}</div>
      <aside class="copies" id="mine"><h3>Your copies</h3><p class="muted">${Bungie.token() ? 'Loading your vault…' : 'Sign in with Bungie to see your copies here.'}</p></aside></div>
      <div class="perkinfo" id="perkinfo" aria-live="polite"><span class="muted">Select a perk to see what it does.</span></div></section>
    <div class="cols2"><div>
      <section class="panel"><h2>Stats</h2>${w.st.map(([n, v, num]) => `<div class="stat"><span class="muted">${esc(n)}</span>${num ? '<span></span>' : `<div class="bar"><span style="width:${Math.min(100, v / maxStat * 100)}%"></span></div>`}<b>${v}</b></div>`).join('')}</section>
      <section class="panel"><h2>Source</h2><p id="farmsrc">${esc(bungieSource(w) || 'Unknown')}</p><div id="sheetsrc" class="muted">Looking up community sheets…</div><p>${farmButton(w.h)}</p></section>
    </div><div>
      <section class="panel"><h2>Endgame Analysis</h2>${endgamePanel(d, er)}</section>
    </div></div>
    ${w.lore ? `<section class="panel"><h2>Lore</h2><div class="lore">${esc(w.lore)}</div></section>` : ''}`;

  $app.querySelectorAll('.perk').forEach(el => el.addEventListener('click', async () => {
    const info = document.getElementById('perkinfo');
    const wasOn = el.classList.contains('sel');
    $app.querySelectorAll('.perk.sel').forEach(x => { x.classList.remove('sel'); x.removeAttribute('aria-pressed'); });
    // clicking the selected perk again closes the details box
    if (wasOn) { info.classList.remove('on'); info.innerHTML = '<span class="muted">Select a perk to see what it does.</span>'; return; }
    el.classList.add('sel');
    info.classList.add('on');
    const p = d.plugs[el.dataset.h];
    const extra = await sheetRows(p.n, t => t.source === 'Destiny Data Compendium');
    info.innerHTML = `<b>${esc(p.n)}</b> <span class="muted">${esc(p.t)}</span>\n${esc(p.d)}` +
      (p.s.length ? `\n${p.s.map(([n, v]) => `${v > 0 ? '+' : ''}${v} ${esc(n)}`).join(', ')}` : '') +
      (extra.length ? `\n\n<b>Destiny Data Compendium</b>\n${esc(extra[0].row.filter(c => c && c !== extra[0].row[0]).join('\n'))}` : '');
    el.setAttribute('aria-pressed', 'true');
  }));

  wireFarmButton();
  if (Bungie.token()) showCopies(d, w, er, mw.p.filter(h => godNames.has(d.plugs[h].n)).map(h => d.plugs[h].n));  // runs alongside the slower sheet lookups below

  // Community sheet rows mentioning this weapon by name, or its frame for the same weapon type.
  const frame = w.cols.find(c => c.c === 'Intrinsic Traits');
  const frameName = frame && d.plugs[frame.p[0]]?.n;
  const hits = [...await sheetRows(w.n),
    ...(frameName && w.ti !== 'Exotic' ? await sheetRows(frameName, (t, r) => t.tab === 'Weapons' && r.some(c => c.toLowerCase() === w.ty.toLowerCase())) : [])];
  document.getElementById('farmsrc').textContent = (await whereToFarm(w)).join(' · also: ') || 'Unknown';
  document.getElementById('sheetsrc').innerHTML = hits.length ? rowTable(hits) : 'Not mentioned in the community sheets.';
}

// Copies of this weapon (any version) beside the perk grid. Hovering or tapping one lights up its perks in the grid:
// filled = on this copy, dashed outline = a recommended perk it's missing.
async function showCopies(d, w, er, mwPicks) {
  const box = document.querySelector('#mine'), grid = $app.querySelector('.perkcols');
  try {
    const prof = await profile(); renderAccount();
    if (!box.isConnected) return;
    const mwName = h => d.plugs[h]?.n.match(/^Masterworked: (.+)/)?.[1];
    // masterwork plugs only count when socketed; every tier of a stat's masterwork shares its name
    const names = i => new Set([...i.plugs].filter(h => !mwName(h) || i.socketed.has(h)).map(h => d.plugs[h]?.n).filter(Boolean));
    const recommended = [...Object.entries(er?.p || {}), ['Masterwork', mwPicks]];
    const traitCols = w.cols.filter(c => c.c === 'Weapon Perks').map(c => new Set(c.p.map(h => d.plugs[h]?.n)));
    const mine = prof.items.filter(i => d.byHash[i.itemHash]?.n === w.n).map(i => {
      const n = names(i);
      const missing = er?.p ? recommended.filter(([, v]) => v.length && !v.some(x => n.has(x))).map(([k]) => k) : [];
      const god = !!er?.c?.length && er.c.every(col => col.some(h => n.has(d.plugs[h]?.n)));
      // the perk showing in each column, as icons
      const shown = traitCols.map(ns => [...i.socketed].map(h => d.plugs[h]).find(p => p && ns.has(p.n))).filter(Boolean);
      return { i, n, missing, god, shown };
    }).sort((a, b) => b.god - a.god || a.missing.length - b.missing.length);
    if (!mine.length) { box.innerHTML = '<h3>Your copies</h3><p class="muted">You don\'t own this weapon.</p>'; return; }
    box.innerHTML = `<h3>Your copies <span class="count">${mine.length}</span></h3>${mine.map((c, k) => `<button type="button" class="copy" data-k="${k}" aria-pressed="false">
      <span class="where">${c.god ? '<span class="badge good">God roll</span>' : ''}${esc(c.i.location)}${c.i.power ? ` · ${c.i.power}` : ''}${c.i.itemHash !== w.h ? ' · other version' : ''}</span>
      <span class="minis">${c.shown.map(p => `<img src="${BNET}${p.i}" alt="${esc(p.n)}" title="${esc(p.n)}">`).join('')}</span>
      ${er?.p ? `<small class="${c.missing.length ? 'miss' : 'full'}">${c.missing.length ? 'Missing: ' + esc(c.missing.join(', ')) : 'Has every recommended pick'}</small>` : ''}</button>`).join('')}
      <p class="muted hint">Hover or tap a copy to see its perks in the grid. A dashed outline is a recommended perk it doesn't have.</p>`;
    let pinned = null;
    const show = k => {
      const n = k == null ? null : mine[k].n;
      grid.classList.toggle('showing', !!n);
      grid.querySelectorAll('.perk').forEach(el => el.classList.toggle('have', !!n && n.has(d.plugs[el.dataset.h].n)));
      box.querySelectorAll('.copy').forEach(el => el.classList.toggle('on', el.dataset.k == k));
    };
    box.addEventListener('mouseover', e => { const c = e.target.closest('.copy'); if (c) show(c.dataset.k); });
    box.addEventListener('mouseleave', () => show(pinned));
    box.addEventListener('focusin', e => { const c = e.target.closest('.copy'); if (c) show(c.dataset.k); });
    box.addEventListener('click', e => {
      const c = e.target.closest('.copy'); if (!c) return;
      pinned = pinned === c.dataset.k ? null : c.dataset.k;
      box.querySelectorAll('.copy').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.k === pinned)));
      show(pinned);
    });
  } catch (e) { box.innerHTML = `<h3>Your copies</h3><p>${esc(e.message)}</p>`; }
}

// Aegis's rating: tier, rank within the weapon type, why, and the roll to chase in priority order.
function endgamePanel(d, r) {
  if (!r) return '<p class="muted">Not rated in the Endgame Analysis sheet.</p>';
  const rows = [...Object.entries(r.p || {}), ['Masterwork', r.mw ? [r.mw] : []], ['Origin trait', r.o ? [r.o] : []]].filter(([, v]) => v.length);
  return `<p>${tierBadge(r)} <span class="muted">#${r.r} of ${r.of} in ${esc(r.tab)}</span></p>${r.d ? `<p>${esc(r.d)}</p>` : ''}${r.note ? `<p>${esc(r.note)}</p>` : ''}
    ${rows.map(([k, v]) => `<div class="eg"><span class="muted">${k}</span><div class="perks">${v.map(n => `<span class="badge${/^Perk/.test(k) ? ' good' : ''}">${esc(n)}</span>`).join('')}</div></div>`).join('')}
    <p class="muted"><small>From <a href="${esc(d.source)}" target="_blank" rel="noopener">Aegis's Destiny 2: Endgame Analysis</a>.${r.c?.length ? ' A copy counts as a god roll when it has one of the Perk 1 picks and one of the Perk 2 picks.' : ''}</small></p>`;
}

// ---------- armor ----------
async function armorData() {
  const a = await load('armor');
  a.byHash ||= Object.fromEntries(a.armor.map(x => [x.h, x]));
  return a;
}
// "Warlock Bond" already names the class, "Helmet" does not
const slotLabel = x => x.ty.startsWith(x.cl) ? x.ty : `${x.cl} ${x.ty}`;
const archetypeOf = (a, item) => [...item.plugs].map(h => a.archetypes[h]).find(Boolean);
const statTotal = (a, item) => Object.keys(a.stats).reduce((t, h) => t + (item.stats[h] || 0), 0);
// "Primary Stat: Super Secondary Stat: Melee" -> ['Super', 'Melee']
const archetypeStats = d => [/Primary Stat:\s*(\w+)/, /Secondary Stat:\s*(\w+)/].map(re => d.match(re)?.[1] || '');
async function armorSource(a, x) {
  const monu = await monumentSources(), set = a.sets[x.set];
  return monu.get(x.n.toLowerCase()) || (set && monu.get(`${set.n} armor`.toLowerCase())) || [bungieSource(x)].filter(Boolean);
}
const setBonus = set => set.perks.map(([n, name, desc, ic]) => `<div class="bonus">${ic ? `<img src="${BNET}${ic}" alt="">` : ''}<div><b>${n}-piece: ${esc(name)}</b><br><span class="muted">${esc(desc)}</span></div></div>`).join('');

async function armorList(params) {
  const a = await armorData();
  const uniq = k => [...new Set(a.armor.map(x => x[k]).filter(Boolean))].sort();
  const sets = Object.entries(a.sets).map(([h, st]) => [h, st.n]).sort((x, y) => x[1].localeCompare(y[1]));
  $app.innerHTML = `<h1>Armor</h1><p class="muted">Every armor piece, with set bonuses, archetypes, exotic perks and where it drops.</p><div class="filters">
    <input type="search" id="q" aria-label="Search armor" placeholder="Search armor, sets or exotic perks" value="${esc(params.get('q') || '')}">
    ${select('cl', 'All classes', ['Titan', 'Hunter', 'Warlock'])}${select('ty', 'All slots', uniq('ty'))}${select('ti', 'All rarities', uniq('ti'))}${select('set', 'All sets', sets, params.get('set') || '')}
    <label class="check"><input type="checkbox" id="cur" checked> Current armor only</label></div><p id="count" class="muted"></p><div class="grid" id="list"></div>`;
  const f = id => $app.querySelector('#' + id);
  const draw = () => {
    const q = f('q').value.trim().toLowerCase();
    const list = a.armor.filter(x => (!q || x.n.toLowerCase().includes(q) || a.sets[x.set]?.n.toLowerCase().includes(q) || x.ex?.[0].toLowerCase().includes(q))
      && ['cl', 'ty', 'ti', 'set'].every(k => !f(k).value || x[k] === f(k).value) && (!f('cur').checked || x.a3));
    // older copies of a piece share its name; list each name once and link the rest from its page
    const byName = new Map();
    list.forEach(x => byName.has(x.n + x.cl) ? byName.get(x.n + x.cl).count++ : byName.set(x.n + x.cl, { x, count: 1 }));
    const names = [...byName.values()];
    f('count').textContent = plural(names.length, 'piece') + (names.length > 300 ? ', showing the first 300' : '');
    f('list').innerHTML = names.slice(0, 300).map(({ x, count }) => card(x, `<small>${esc(slotLabel(x))}${x.ex ? ` · ${esc(x.ex[0])}` : ''}</small>
      <small>${esc(a.sets[x.set]?.n || bungieSource(x))}${count > 1 ? ` · ${count} versions` : ''}</small>`, 'armor')).join('')
      || '<p class="empty">No armor matches. Try a shorter search, clear a filter, or untick "Current armor only".</p>';
  };
  $app.querySelectorAll('input,select').forEach(el => el.addEventListener('input', draw));
  draw();
}

async function armorPage(hash) {
  const a = await armorData();
  const x = a.byHash[hash];
  if (!x) { $app.innerHTML = '<p class="empty">Armor piece not found. <a href="#/armor">Back to armor</a></p>'; return; }
  const set = a.sets[x.set];
  const same = a.armor.filter(y => y.n === x.n && y.cl === x.cl && y.h !== x.h);
  $app.innerHTML = `
    ${hero(x, `<span class="badge">${esc(x.ti)}</span><span class="badge">${esc(x.cl)}</span><span class="badge">${esc(x.ty)}</span>${set ? `<span class="badge">${esc(set.n)} set</span>` : ''}${x.a3 ? '' : '<span class="badge">Legacy armor</span>'}`)}
    ${same.length ? `<p class="versions">Other versions: ${same.map((y, i) => `<a href="#/armor/${y.h}">${esc(bungieSource(y) || 'version ' + (i + 2))}</a>`).join(' · ')}</p>` : ''}
    <div class="cols2"><div>
      ${x.ex ? `<section class="panel"><h2>Exotic perk</h2><div class="bonus">${x.ex[2] ? `<img src="${BNET}${x.ex[2]}" alt="">` : ''}<div><b>${esc(x.ex[0])}</b><br><span class="muted">${esc(x.ex[1])}</span></div></div></section>` : ''}
      ${set ? `<section class="panel"><h2>Set bonus</h2>${setBonus(set)}<p class="muted"><a href="#/armor?set=${x.set}">See every ${esc(set.n)} piece</a></p></section>` : ''}
      <section class="panel"><h2>Source</h2><p id="farmsrc">${esc(bungieSource(x) || 'Unknown')}</p><div id="sheetsrc" class="muted">Looking up community sheets…</div><p>${farmButton(x.h)}</p></section>
    </div><div>
      <section class="panel" id="mine"><h2>Your copies</h2><p class="muted">${Bungie.token() ? 'Loading your vault…' : 'Sign in with Bungie to see your copies, their tier, archetype and stats.'}</p></section>
      ${x.a3 ? `<section class="panel"><h2>Archetypes</h2><p class="muted">Every current armor piece can drop as any of these. The archetype sets its two highest stats.</p>
        <table class="sheet"><tr><td class="muted">Archetype</td><td class="muted">Primary stat</td><td class="muted">Secondary stat</td></tr>
        ${Object.values(Object.fromEntries(Object.values(a.archetypes).map(t => [t.n, t]))).sort((p, q) => p.n.localeCompare(q.n)).map(t => `<tr><td>${esc(t.n)}</td>${archetypeStats(t.d).map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</table></section>` : ''}
    </div></div>`;

  wireFarmButton();
  const hits = [...await sheetRows(x.n), ...(set ? await sheetRows(`${set.n} Armor`) : [])];
  document.getElementById('farmsrc').textContent = (await armorSource(a, x)).join(' · also: ') || 'Unknown';
  document.getElementById('sheetsrc').innerHTML = hits.length ? rowTable(hits) : 'Not mentioned in the community sheets.';

  if (Bungie.token()) {
    try {
      const prof = await profile(); renderAccount();
      const mine = prof.items.filter(i => i.itemHash === x.h);
      document.querySelector('#mine').innerHTML = `<h2>Your copies</h2>` + (mine.length ? mine.map(i => armorCopy(a, i)).join('') : '<p class="muted">You don\'t own this version.</p>');
    } catch (e) { document.querySelector('#mine').innerHTML = `<h2>Your copies</h2><p>${esc(e.message)}</p>`; }
  }
}

function armorCopy(a, i) {
  const arch = archetypeOf(a, i);
  return `<div class="roll">${i.tier ? `<span class="badge${i.tier === 5 ? ' good' : ''}">Tier ${i.tier}</span>` : ''}${arch ? `<span class="badge mode">${esc(arch.n)}</span>` : ''} ${esc(i.location)} · ${statTotal(a, i)} total
    ${Object.entries(a.stats).map(([h, n]) => `<div class="stat"><span class="muted">${esc(n)}</span><div class="bar"><span style="width:${Math.min(100, (i.stats[h] || 0) / 45 * 100)}%"></span></div><b>${i.stats[h] || 0}</b></div>`).join('')}</div>`;
}

async function setsPage() {
  const a = await armorData();
  const p = Bungie.token() ? await needProfile() : null;
  // what you own of each set, per class: distinct slots and best tier
  const owned = {};
  for (const i of p?.items || []) {
    const x = a.byHash[i.itemHash];
    if (!x?.set) continue;
    const o = ((owned[x.set] ||= {})[x.cl] ||= { slots: new Set(), tier: 0 });
    o.slots.add(x.ty); o.tier = Math.max(o.tier, i.tier);
  }
  const sets = await Promise.all(Object.entries(a.sets).map(async ([h, st]) => {
    const first = a.armor.find(x => x.set === h);
    return { h, ...st, src: first ? (await armorSource(a, first))[0] || '' : '' };
  }));
  sets.sort((x, y) => x.n.localeCompare(y.n));
  $app.innerHTML = `<h1>Armor sets</h1><p class="muted">Every armor set and its 2- and 4-piece bonuses${p ? ', with what you own of each' : ''}. ${p ? '' : 'Sign in to see which pieces you have.'}</p>
    <div class="filters"><input type="search" id="q" aria-label="Filter sets" placeholder="Filter by set, bonus or source (e.g. grenade, Iron Banner)"></div><div id="list"></div>`;
  const draw = () => {
    const q = $app.querySelector('#q').value.toLowerCase();
    $app.querySelector('#list').innerHTML = sets.filter(st => !q || [st.n, st.src, ...st.perks.flatMap(pk => [pk[1], pk[2]])].some(t => t.toLowerCase().includes(q)))
      .map(st => `<section class="panel"><h2><a href="#/armor?set=${st.h}">${esc(st.n)}</a></h2>${st.src ? `<p class="muted">${esc(st.src)}</p>` : ''}${setBonus(st)}
        ${p ? `<p class="owned">${['Titan', 'Hunter', 'Warlock'].map(cl => { const o = owned[st.h]?.[cl];
          return `<span class="badge${o?.slots.size === 5 ? ' good' : ''}">${cl}: ${o ? `${o.slots.size}/5 pieces${o.tier ? `, best Tier ${o.tier}` : ''}` : 'none'}</span>`; }).join('')}</p>` : ''}</section>`).join('')
      || '<p class="empty">No set matches this filter.</p>';
  };
  $app.querySelector('#q').addEventListener('input', draw);
  draw();
}

async function needProfile() {
  if (!Bungie.token()) {
    $app.innerHTML = `<h1>Sign in</h1><p>Sign in with your Bungie account to load your vault and characters. Your login stays in this browser.</p><button class="primary" id="go">Sign in with Bungie</button>`;
    $app.querySelector('#go').addEventListener('click', Bungie.signIn);
    return null;
  }
  $app.innerHTML = '<p class="muted">Loading your vault and characters…</p>';
  const p = await profile(); renderAccount();
  return p;
}

const gearTabs = on => `<div class="tabs gear">${[['', 'Weapons'], ['/armor', 'Armor'], ['/move', 'Transfer']].map(([path, label]) => `<a href="#/inventory${path}"${label === on ? ' class="on" aria-current="page"' : ''}>${label}</a>`).join('')}</div>`;

async function inventory(tab) {
  if (tab === 'armor') return armorInventory();
  if (tab === 'move') return transferPage();
  const d = await data();
  const p = await needProfile(); if (!p) return;
  const owned = p.items.filter(i => d.byHash[i.itemHash]);
  const byWeapon = Object.groupBy(owned, i => i.itemHash);
  const rows = Object.entries(byWeapon).map(([h, list]) => {
    const w = d.byHash[h], r = d.rolls[h];
    return { w, r, list, god: list.filter(i => rollMatches(r, i.plugs)).length, hasRolls: !!r?.c?.length };
  }).sort((a, b) => b.god - a.god || tierOrder(a.r) - tierOrder(b.r) || a.w.n.localeCompare(b.w.n));
  $app.innerHTML = `<h1>My gear</h1>${gearTabs('Weapons')}<p class="muted">${plural(owned.length, 'weapon')}, ${plural(rows.reduce((s, r) => s + r.god, 0), 'god roll')}, ${plural(rows.filter(r => r.list.length > 1).length, 'weapon')} with duplicates.</p>
    <div class="filters"><input type="search" id="q" aria-label="Filter your weapons" placeholder="Filter by name"><select id="show" aria-label="Show"><option value="">Everything</option><option value="god">God rolls</option><option value="nogod">Has a god roll I don't own yet</option><option value="dupe">Duplicates</option></select></div>
    <div class="grid" id="list"></div>`;
  const draw = () => {
    const q = $app.querySelector('#q').value.toLowerCase(), show = $app.querySelector('#show').value;
    $app.querySelector('#list').innerHTML = rows.filter(r => r.w.n.toLowerCase().includes(q) &&
        (!show || show === 'god' && r.god || show === 'nogod' && r.hasRolls && !r.god || show === 'dupe' && r.list.length > 1))
      .map(r => card(r.w, `<small>${tierBadge(r.r)}${esc(r.w.ty)} · owned ×${r.list.length}</small>
        <small>${r.god ? `<span class="badge good">${plural(r.god, 'god roll')}</span>` : r.hasRolls ? '<span class="badge">No god roll yet</span>' : ''}</small>`)).join('')
      || '<p class="empty">Nothing matches this filter.</p>';
  };
  $app.querySelectorAll('input,select').forEach(el => el.addEventListener('input', draw));
  draw();
}

async function armorInventory() {
  const a = await armorData();
  const p = await needProfile(); if (!p) return;
  const owned = p.items.filter(i => a.byHash[i.itemHash]).map(i => ({ i, x: a.byHash[i.itemHash], total: statTotal(a, i), arch: archetypeOf(a, i)?.n || '' }));
  const uniq = f => [...new Set(owned.map(f).filter(Boolean))].sort();
  $app.innerHTML = `<h1>My gear</h1>${gearTabs('Armor')}<p class="muted">${plural(owned.length, 'armor piece')}, ${owned.filter(o => o.i.tier === 5).length} at Tier 5.</p>
    <div class="filters"><input type="search" id="q" aria-label="Filter your armor" placeholder="Filter by name or set">
    ${select('cl', 'All classes', ['Titan', 'Hunter', 'Warlock'])}${select('ty', 'All slots', uniq(o => o.x.ty))}${select('arch', 'All archetypes', uniq(o => o.arch))}
    <select id="sort" aria-label="Sort"><option value="tier">Best tier first</option><option value="total">Highest stats first</option><option value="name">Name</option></select></div>
    <div class="grid" id="list"></div>`;
  const f = id => $app.querySelector('#' + id);
  const draw = () => {
    const q = f('q').value.toLowerCase(), by = f('sort').value;
    const list = owned.filter(o => (!q || o.x.n.toLowerCase().includes(q) || a.sets[o.x.set]?.n.toLowerCase().includes(q))
        && (!f('cl').value || o.x.cl === f('cl').value) && (!f('ty').value || o.x.ty === f('ty').value) && (!f('arch').value || o.arch === f('arch').value))
      .sort((m, n) => by === 'name' ? m.x.n.localeCompare(n.x.n) : by === 'total' ? n.total - m.total : n.i.tier - m.i.tier || n.total - m.total);
    f('list').innerHTML = list.map(({ i, x, total, arch }) => card(x, `<small>${esc(slotLabel(x))}${a.sets[x.set] ? ` · ${esc(a.sets[x.set].n)}` : ''}</small>
      <small>${i.tier ? `<span class="badge${i.tier === 5 ? ' good' : ''}">Tier ${i.tier}</span>` : ''}${arch ? `<span class="badge">${esc(arch)}</span>` : ''}${total} total</small>`, 'armor')).join('')
      || '<p class="empty">Nothing matches this filter.</p>';
  };
  $app.querySelectorAll('input,select').forEach(el => el.addEventListener('input', draw));
  draw();
}

// DIM-style mover: one row per gear slot, a column per character (equipped item first) and the vault; pick an item, then send it somewhere or equip it.
async function transferPage() {
  const [d, a] = await Promise.all([data(), armorData()]);
  const p = await needProfile(); if (!p) return;
  const def = i => d.byHash[i.itemHash] || a.byHash[i.itemHash];
  // class items are typed "Hunter Cloak", "Titan Mark" and "Warlock Bond"; they share one row
  const slotOf = i => d.byHash[i.itemHash]?.sl || (x => x && (x.ty.startsWith(x.cl) ? 'Class item' : x.ty))(a.byHash[i.itemHash]);
  const weaponSlots = ['Kinetic', 'Energy', 'Power'], armorSlots = ['Helmet', 'Gauntlets', 'Chest Armor', 'Leg Armor', 'Class item'];
  const order = (m, n) => n.equipped - m.equipped || def(m).n.localeCompare(def(n).n);
  const narrow = matchMedia('(max-width: 720px)');
  let sel = null, busy = false, msg = '', view = p.chars[0]?.id;  // view: the one character shown on phones
  $app.innerHTML = `<h1>My gear</h1>${gearTabs('Transfer')}<p class="muted">Pick an item, then choose where it goes. Moves happen in the game straight away.</p>
    <div class="filters"><input type="search" id="q" aria-label="Find an item" placeholder="Find an item">${select('kind', 'Weapons and armor', [['w', 'Weapons'], ['a', 'Armor']])}
    <button type="button" id="reload">Reload from Bungie</button></div><div id="places"></div><div id="actions" class="actionbar" aria-live="polite" hidden></div>`;
  const f = id => $app.querySelector('#' + id);
  const tile = i => `<button type="button" class="tile${i.equipped ? ' equipped' : ''}${sel === i ? ' sel' : ''}" data-id="${i.instanceId}" title="${esc(def(i).n)}" aria-label="${esc(def(i).n)}${i.equipped ? ', equipped' : ''}">${icon(def(i))}</button>`;
  const cell = (list, owner, slot) => `<div class="cell" data-owner="${owner}" data-slot="${esc(slot)}">${list.sort(order).map(tile).join('')}</div>`;
  const draw = () => {
    const q = f('q').value.trim().toLowerCase(), kind = f('kind').value;
    const items = p.items.filter(i => def(i) && (!kind || (kind === 'w') === !!d.byHash[i.itemHash]) && (!q || def(i).n.toLowerCase().includes(q)));
    const chars = narrow.matches ? p.chars.filter(c => c.id === view) : p.chars;
    const slots = [...(kind !== 'a' ? weaponSlots : []), ...(kind !== 'w' ? armorSlots : [])];
    const vault = items.filter(i => !i.owner), postmaster = items.filter(i => i.postmaster);
    f('places').innerHTML = `${narrow.matches ? `<div class="tabs charpick">${p.chars.map(c => `<button type="button" data-view="${c.id}"${c.id === view ? ' class="on" aria-pressed="true"' : ''}>${esc(c.cls)}</button>`).join('')}</div>` : ''}
      <div class="loadout" style="--chars:${chars.length}"><div></div>
        ${chars.map(c => `<div class="charhead" style="background-image:url('${c.emblem ? BNET + c.emblem : ''}')"><b>${esc(c.cls)}</b>${c.light ? `<span>${c.light}</span>` : ''}</div>`).join('')}
        <div class="charhead vault"><b>Vault</b><span>${vault.length}</span></div>
        ${slots.map(slot => `<div class="slotname">${slot}</div>${chars.map(c => cell(items.filter(i => i.owner === c.id && !i.postmaster && slotOf(i) === slot), c.id, slot)).join('')}
          ${cell(vault.filter(i => slotOf(i) === slot), 'vault', slot)}`).join('')}
      </div>
      ${postmaster.length ? `<section class="panel"><h2>Postmaster <span class="count">${postmaster.length}</span></h2><div class="cell" data-owner="postmaster">${postmaster.map(tile).join('')}</div></section>` : ''}`;
    drawBar();
  };
  // the action bar redraws on its own so picking an item doesn't rebuild every icon in the grid
  const drawBar = () => {
    const bar = f('actions');
    bar.hidden = !sel;
    if (!sel) return;
    const cls = a.byHash[sel.itemHash]?.cl;  // class armor can only go to that class
    const targets = p.chars.filter(c => !cls || c.cls === cls);
    const stuck = sel.equipped ? 'Equipped items can\'t be moved. Equip something else in that slot first.' : sel.postmaster ? 'Pull this from the Postmaster in game first.'
      : !targets.length ? `Only a ${cls} can hold this, and there's no ${cls} on this account.` : '';
    const btn = (attr, label) => `<button type="button" ${attr}${busy || stuck ? ' disabled' : ''}>${esc(label)}</button>`;
    bar.innerHTML = `${icon(def(sel))}<div class="what"><b>${esc(def(sel).n)}</b><small>${esc(sel.location)}</small><small class="${/^(Done|Moving|Equipping)/.test(msg) ? '' : 'err'}">${esc(stuck || msg)}</small></div>
      <div class="acts">${sel.owner ? btn('data-move="vault"', 'To Vault') : ''}${targets.filter(c => c.id !== sel.owner).map(c => btn(`data-move="${c.id}"`, `To ${c.cls}`)).join('')}
      ${targets.map(c => btn(`data-equip="${c.id}" class="primary"`, `Equip on ${c.cls}`)).join('')}<button type="button" data-close>Close</button></div>`;
  };
  const run = async (label, fn) => {
    busy = true; msg = label; drawBar();
    try { await fn(); msg = 'Done.'; } catch (e) { msg = e.message; }
    busy = false; draw();
  };
  f('places').addEventListener('click', e => {
    const v = e.target.closest('[data-view]');
    if (v) { view = v.dataset.view; draw(); return; }
    const t = e.target.closest('.tile'); if (!t) return;
    sel = p.items.find(i => i.instanceId === t.dataset.id); msg = '';
    f('places').querySelectorAll('.tile.sel').forEach(x => x.classList.remove('sel')); t.classList.add('sel'); drawBar();
  });
  f('actions').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    if (b.hasAttribute('data-close')) { sel = null; f('places').querySelector('.tile.sel')?.classList.remove('sel'); drawBar(); return; }
    const it = sel, to = b.dataset.move || b.dataset.equip, cls = p.chars.find(c => c.id === to)?.cls || 'Vault';
    if (b.dataset.move) run(`Moving to ${cls}…`, () => Bungie.move(p, it, to));
    else run(`Equipping on ${cls}…`, async () => {
      await Bungie.move(p, it, to);
      const old = p.items.filter(i => i !== it && i.owner === to && i.equipped && slotOf(i) === slotOf(it));
      await Bungie.equip(p, it);
      old.forEach(i => { i.equipped = false; Bungie.locate(p, i); });
    });
  });
  $app.querySelectorAll('.filters input,.filters select').forEach(el => el.addEventListener('input', draw));
  f('reload').addEventListener('click', () => { S.profile = null; transferPage(); });
  narrow.onchange = draw;
  draw();
}

// ---------- builds ----------
// DIM's share API is public (any origin, no key): dim.gg/<shareId>/<name> resolves to { loadout, shareUrl }.
const DIM_SHARE = 'https://api.destinyitemmanager.com/loadout_share?shareId=';

// A dim.gg link (or bare share id) gives a share id; a full DIM loadouts link carries the build itself as JSON.
function parseBuildLink(text) {
  const t = text.trim();
  const id = t.match(/^(?:https?:\/\/)?(?:www\.)?dim\.gg\/([a-z0-9]{7})/i)?.[1] || t.match(/^[a-z0-9]{7}$/i)?.[0];
  if (id) return { id: id.toLowerCase() };
  try { const json = new URL(t).searchParams.get('loadout'); if (json) return { loadout: JSON.parse(json) }; } catch {}
  return null;
}

// Saved builds live in this browser: [{ key, name, cls, shareUrl, saved, sub: { n, i }, icons, loadout }], newest first.
const savedBuilds = () => Bungie.store.get('d2c_builds') || [];

function showSaved(box) {
  const list = savedBuilds();
  box.innerHTML = list.length ? `<section class="panel"><h2>Saved builds <span class="count">${list.length}</span></h2><div class="grid savedgrid">${list.map(b => `<div class="card saved">
      <span class="icon">${img(b.sub?.i)}</span><div><a href="#/build/${esc(b.key)}"><b>${esc(b.name)}</b></a>
      <small>${esc([b.cls || 'Any class', b.sub?.n].filter(Boolean).join(' · '))} · saved ${new Date(b.saved).toLocaleDateString()}</small>
      <small class="minis">${b.icons.map(i => img(i)).join('')}</small></div>
      <button type="button" data-remove="${esc(b.key)}" aria-label="Remove ${esc(b.name)} from saved builds">Remove</button></div>`).join('')}</div></section>`
    : '<p class="empty">No saved builds yet. Open a build and press Save build to keep it here.</p>';
  box.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', () => {
    Bungie.store.set('d2c_builds', savedBuilds().filter(b => b.key !== btn.dataset.remove));
    showSaved(box);
  }));
}

// Quick switcher shown above an open build: every saved build, the open one marked.
const savedBar = current => `<a href="#/build" class="back">All saved builds</a>${savedBuilds().map(b => `<a href="#/build/${esc(b.key)}" class="chip"${b.key === current ? ' aria-current="page"' : ''}>${img(b.sub?.i)}<span>${esc(b.name)}</span></a>`).join('')}`;

async function buildPage(id) {
  $app.innerHTML = `<h1>Builds</h1><p class="muted">Paste a DIM loadout link to see the whole build, check what you own and equip it.</p>
    <form class="filters" id="open"><input type="search" inputmode="url" id="link" aria-label="DIM loadout link" placeholder="https://dim.gg/abc1234/Build-Name">
    <button type="submit" class="primary">Open build</button></form><p class="err" id="linkerr" hidden></p>
    <nav class="savedbar" id="savedbar" aria-label="Saved builds"${id ? '' : ' hidden'}>${id ? savedBar(id) : ''}</nav><div id="build"></div>`;
  const f = sel => $app.querySelector(sel), box = f('#build'), link = f('#link'), bar = f('#savedbar');
  f('#open').addEventListener('submit', e => {
    e.preventDefault();
    const got = parseBuildLink(link.value);
    f('#linkerr').hidden = !!got;
    f('#linkerr').textContent = 'That doesn\'t look like a DIM loadout link. It should start with https://dim.gg/ or https://app.destinyitemmanager.com/loadouts?loadout=';
    if (!got) return;
    if (got.loadout) S.build = got.loadout;
    location.hash = '#/build/' + (got.id || 'link');
  });
  if (!id) return showSaved(box);
  const saved = savedBuilds().find(b => b.key === id), isShare = /^[a-z0-9]{7}$/.test(id);
  let loadout = saved?.loadout || (id === 'link' ? S.build : null), shareUrl = saved?.shareUrl || '';
  if (!loadout && isShare) {
    box.innerHTML = '<p class="muted">Loading the build from DIM…</p>';
    const r = await fetch(DIM_SHARE + encodeURIComponent(id)).catch(() => null);
    if (!r) { box.innerHTML = '<p class="empty">Couldn\'t reach DIM. Check your connection and try again.</p>'; return; }
    if (r.status === 404) { box.innerHTML = '<p class="empty">DIM has no build with that link. It may have been deleted.</p>'; return; }
    if (!r.ok) { box.innerHTML = `<p class="empty">DIM didn't answer (error ${r.status}). Try again in a minute.</p>`; return; }
    ({ loadout, shareUrl } = await r.json());
  }
  link.value = shareUrl;
  // a pasted full link lives only in memory until it's saved, so a reload lands here
  if (!loadout) { box.innerHTML = id === 'link' ? '' : '<p class="empty">That build isn\'t saved in this browser. <a href="#/build">See your saved builds</a></p>'; return; }
  const key = isShare ? id : saved?.key || 'saved-' + String(loadout.id || Date.now().toString(36)).replace(/[^a-z0-9]/gi, '').slice(0, 16).toLowerCase();
  box.innerHTML = '<p class="muted">Looking up the build\'s items…</p>';

  const [d, a] = await Promise.all([data(), armorData()]);
  const P = loadout.parameters || {}, items = [...loadout.equipped, ...(loadout.unequipped || [])];
  // gear comes from the site's own data; subclass pieces, mods and artifact perks from Bungie's manifest
  const defs = {};
  const hashes = new Set([...items.flatMap(i => [i.hash, ...Object.values(i.socketOverrides || {})]), ...(P.mods || []), ...(P.artifactUnlocks?.unlockedItemHashes || []), P.exoticArmorHash].filter(Boolean));
  await Promise.all([...hashes].map(async h => {
    defs[h] = d.byHash[h] || a.byHash[h] || d.plugs[h] ||
      await Bungie.item(h).then(x => ({ n: x.displayProperties.name, i: x.displayProperties.icon, d: x.displayProperties.description, t: x.itemTypeDisplayName, sub: x.itemType === 16 })).catch(() => null);
  }));
  const chip = (h, extra = '') => defs[h] ? `<span class="chip" title="${esc([defs[h].t, defs[h].d].filter(Boolean).join(': '))}">${img(defs[h].i)}<span>${esc(defs[h].n)}${extra}</span></span>` : '';
  const counted = hs => Object.entries(Object.groupBy(hs, h => h)).map(([h, l]) => chip(h, l.length > 1 ? ` ×${l.length}` : '')).join('');
  const nameOf = h => (d.byHash[h] || a.byHash[h])?.n;
  const gear = items.filter(i => nameOf(i.hash));
  const subclass = loadout.equipped.find(i => defs[i.hash]?.sub);
  const cls = ['Titan', 'Hunter', 'Warlock'][loadout.classType];

  const draw = (p, status = '') => {
    const chars = p ? p.chars.filter(c => !cls || c.cls === cls) : [];
    // best copy for a character: this exact version, a god roll, already there, in the vault; never the postmaster
    const pick = (it, cid) => (p?.items || []).filter(i => !i.postmaster && nameOf(i.itemHash) === nameOf(it.hash))
      .sort((x, y) => (y.itemHash === it.hash) - (x.itemHash === it.hash) || rollMatches(d.rolls[y.itemHash], y.plugs) - rollMatches(d.rolls[x.itemHash], x.plugs)
        || (y.owner === cid) - (x.owner === cid) || !y.owner - !x.owner)[0];
    const owned = it => { const c = pick(it, chars[0]?.id);
      return !p ? '' : c ? `<span class="badge good">You have it</span>${esc(c.location)}${c.itemHash !== it.hash ? ' · other version' : ''}` : '<span class="badge">Missing</span>'; };
    const piece = it => { const w = d.byHash[it.hash], x = w || a.byHash[it.hash], perks = Object.values(it.socketOverrides || {}).map(h => defs[h]?.n).filter(Boolean);
      return card(x, `<small>${w ? tierBadge(d.rolls[w.h]) + esc(w.ty) : esc(slotLabel(x))}${loadout.equipped.includes(it) ? '' : ' · not equipped'}</small>
        ${perks.length ? `<small>${esc(perks.join(', '))}</small>` : ''}<small>${owned(it)}</small>`, w ? 'weapon' : 'armor'); };
    const have = gear.filter(it => pick(it)).length;
    const subParts = Object.entries(Object.groupBy(Object.entries(subclass?.socketOverrides || {}).sort((x, y) => x[0] - y[0]).map(([, h]) => h).filter(h => defs[h] && !/^Empty /.test(defs[h].n)),
      h => /Aspect/.test(defs[h].t) ? 'Aspects' : /Fragment/.test(defs[h].t) ? 'Fragments' : 'Abilities'));
    const stats = (P.statConstraints || []).filter(c => a.stats[c.statHash]).map(c => {
      const min = c.minStat ?? (c.minTier ? c.minTier * 10 : 0), max = c.maxStat ?? (c.maxTier != null && c.maxTier < 10 ? c.maxTier * 10 : null);
      return `<span class="badge">${esc(a.stats[c.statHash])}${min ? ` ${min}+` : ''}${max != null ? ` up to ${max}` : ''}</span>`; });
    const sets = Object.entries(P.setBonuses || {}).filter(([h]) => a.sets[h]).map(([h, n]) => `<span class="badge">${esc(a.sets[h].n)} · ${n} pieces</span>`);
    box.innerHTML = `<section class="panel buildhead"><h2>${esc(loadout.name || 'Untitled build')}${cls ? ` <span class="count">${cls}</span>` : ''}</h2>
        ${loadout.notes ? `<p class="lore">${esc(loadout.notes)}</p>` : ''}
        <p class="muted">${p ? `You have ${have} of ${gear.length} pieces of gear.` : 'Sign in with Bungie to see which pieces you have and equip them.'}
        <a href="${esc(shareUrl || 'https://app.destinyitemmanager.com/loadouts?' + new URLSearchParams({ loadout: JSON.stringify(loadout) }))}" target="_blank" rel="noopener">Open in DIM</a></p>
        <div class="acts"><button type="button" data-save>${savedBuilds().some(b => b.key === key) ? 'Remove from saved' : 'Save build'}</button><button type="button" data-farmbuild>${inFarm('builds', key) && savedBuilds().some(b => b.key === key) ? 'Stop farming this build' : 'Farm this build'}</button>${chars.map(c => `<button type="button" class="primary" data-equip="${c.id}">Equip on ${esc(c.cls)}</button>`).join('')}</div>
        ${chars.length ? '<p class="muted"><small>Equip moves and equips the weapons and armor you have. Set the subclass and mods in game.</small></p>' : ''}
        ${status ? `<p class="${/^Done/.test(status) ? 'muted' : 'err'}" aria-live="polite">${esc(status)}</p>` : ''}</section>
      ${subclass ? `<section class="panel"><h2>Subclass</h2><p>${chip(subclass.hash)}</p>${subParts.map(([k, hs]) => `<div class="eg"><span class="muted">${k}</span><div class="chips">${hs.map(h => chip(h)).join('')}</div></div>`).join('')}</section>` : ''}
      ${['weapon', 'armor'].map(k => { const list = gear.filter(it => !!d.byHash[it.hash] === (k === 'weapon'));
        return list.length ? `<section class="panel"><h2>${k === 'weapon' ? 'Weapons' : 'Armor'}</h2><div class="grid">${list.map(piece).join('')}</div></section>` : ''; }).join('')}
      ${P.exoticArmorHash && !gear.some(it => it.hash === P.exoticArmorHash) ? `<section class="panel"><h2>Exotic armor</h2><div class="chips">${chip(P.exoticArmorHash)}</div></section>` : ''}
      ${P.mods?.length ? `<section class="panel"><h2>Armor mods</h2><div class="chips">${counted(P.mods)}</div></section>` : ''}
      ${stats.length || sets.length ? `<section class="panel"><h2>Stat targets and set bonuses</h2><div class="perks">${stats.join('')}${sets.join('')}</div></section>` : ''}
      ${P.artifactUnlocks?.unlockedItemHashes?.length ? `<section class="panel"><h2>Artifact perks</h2><div class="chips">${P.artifactUnlocks.unlockedItemHashes.map(h => chip(h)).join('')}</div></section>` : ''}`;
    const toggleSave = () => {
      const rest = savedBuilds().filter(b => b.key !== key), adding = rest.length === savedBuilds().length;
      const sub = subclass && defs[subclass.hash];
      Bungie.store.set('d2c_builds', adding ? [{ key, name: loadout.name || 'Untitled build', cls, shareUrl, saved: Date.now(), sub: sub ? { n: sub.n, i: sub.i } : null,
        icons: gear.filter(it => d.byHash[it.hash]).map(it => d.byHash[it.hash].i).slice(0, 3), loadout }, ...rest] : rest);
      if (adding && id === 'link') history.replaceState(null, '', '#/build/' + key);  // so a reload finds it
      bar.innerHTML = savedBar(key);
    };
    box.querySelector('[data-save]').addEventListener('click', () => { toggleSave(); draw(p, status); });
    // farming a build saves it too, since the farming plan reads saved builds
    box.querySelector('[data-farmbuild]').addEventListener('click', () => {
      const saved = savedBuilds().some(b => b.key === key), want = !(saved && inFarm('builds', key));
      if (!saved) toggleSave();
      if (inFarm('builds', key) !== want) toggleFarm('builds', key);
      draw(p, status);
    });
    box.querySelectorAll('[data-equip]').forEach(b => b.addEventListener('click', async () => {
      const c = chars.find(x => x.id === b.dataset.equip);
      box.querySelectorAll('[data-equip]').forEach(x => { x.disabled = true; });
      b.textContent = `Equipping on ${c.cls}…`;
      const want = loadout.equipped.filter(it => nameOf(it.hash)).map(it => pick(it, c.id)).filter(Boolean);
      // Bungie can't move an item that's equipped on another character
      const stuck = want.filter(i => i.equipped && i.owner !== c.id);
      let msg;
      try {
        for (const i of want.filter(i => !stuck.includes(i))) await Bungie.move(p, i, c.id);
        const failed = await Bungie.equipAll(p, want.filter(i => !stuck.includes(i) && !i.equipped), c.id);
        const left = [...stuck, ...failed].map(i => nameOf(i.itemHash));
        msg = left.length ? `Done, except: ${left.join(', ')}. ${stuck.length ? 'Unequip those on your other characters first. ' : ''}${failed.length ? 'Bungie wouldn\'t equip some of them (often a second exotic).' : ''}`
          : `Done. Everything you have from this build is equipped on your ${c.cls}.`;
      } catch (e) { msg = e.message; }
      S.profile = null;  // re-read so every location is current
      draw(await profile().catch(() => null), msg);
    }));
  };
  draw(Bungie.token() ? await profile().catch(() => null) : null);
  renderAccount();
}

// ---------- farming ----------
// What you're farming for, kept in this browser. tier: '' (off) or the lowest Endgame Analysis tier to chase; lists hold strings.
const farmPrefs = () => ({ tier: 'S', exoticWeapons: false, exoticArmor: false, sets: [], builds: [], items: [], ...Bungie.store.get('d2c_farm') });
const inFarm = (key, value) => farmPrefs()[key].includes(String(value));
const toggleFarm = (key, value) => { const f = farmPrefs(), v = String(value); f[key] = f[key].includes(v) ? f[key].filter(x => x !== v) : [...f[key], v]; Bungie.store.set('d2c_farm', f); };
const farmLabel = h => inFarm('items', h) ? 'Remove from farming plan' : 'Add to farming plan';
const farmButton = h => `<button type="button" data-farm="${h}">${farmLabel(h)}</button>`;
const wireFarmButton = () => $app.querySelector('[data-farm]').addEventListener('click', e => { toggleFarm('items', e.target.dataset.farm); e.target.textContent = farmLabel(e.target.dataset.farm); });

// Everything you've asked to farm, one entry per item name: { x, kind, r (rating), need: 'god roll' | 'item', reasons }.
// Adept, Timelost and Harrowed copies are the same weapon for farming: a god roll on either counts
const baseName = n => n.replace(/\s*\((Adept|Timelost|Harrowed)\)$/, '');
function farmTargets(d, a, p, f) {
  const nameOf = h => d.byHash[h] ? baseName(d.byHash[h].n) : a.byHash[h] && a.byHash[h].n + a.byHash[h].cl;
  const owned = new Set((p?.items || []).map(i => nameOf(i.itemHash)).filter(Boolean));
  const haveGod = new Set((p?.items || []).filter(i => rollMatches(d.rolls[i.itemHash], i.plugs)).map(i => nameOf(i.itemHash)));
  const classes = p ? new Set(p.chars.map(c => c.cls)) : null;
  const targets = new Map();
  const add = (x, kind, reason) => {
    const r = kind === 'weapon' ? d.rolls[x.h] : null;
    // weapons with an Endgame Analysis roll are done once you own that roll; anything else once you own it
    const n = kind === 'weapon' ? baseName(x.n) : x.n + x.cl;
    const need = r?.c?.length && !haveGod.has(n) ? 'god roll' : owned.has(n) ? '' : 'item';
    if (!need) return;
    const t = targets.get(n) || targets.set(n, { x, kind, r, need, owned: owned.has(n), reasons: [] }).get(n);
    if (!t.reasons.includes(reason)) t.reasons.push(reason);
  };
  // the version to farm for a name: the newest one Aegis rated, else the newest
  const weaponByName = new Map();
  d.weapons.forEach(w => { const cur = weaponByName.get(baseName(w.n)); if (!cur || (!d.rolls[cur.h]?.c?.length && d.rolls[w.h]?.c?.length)) weaponByName.set(baseName(w.n), w); });
  // one piece per name and class, the current (Armor 3.0) version winning over legacy ones
  const armorFor = list => [...new Map(list.filter(x => !classes || classes.has(x.cl)).sort((m, n) => m.a3 - n.a3).map(x => [x.n + x.cl, x])).values()];
  if (f.tier) weaponByName.forEach(w => { const r = d.rolls[w.h]; if (r?.c?.length && TIERS.includes(r.t) && TIERS.indexOf(r.t) <= TIERS.indexOf(f.tier)) add(w, 'weapon', `Tier ${r.t} god roll`); });
  if (f.exoticWeapons) weaponByName.forEach(w => w.ti === 'Exotic' && add(w, 'weapon', 'Missing exotic'));
  if (f.exoticArmor) armorFor(a.armor.filter(x => x.ti === 'Exotic')).forEach(x => add(x, 'armor', 'Missing exotic'));
  f.sets.forEach(h => a.sets[h] && armorFor(a.armor.filter(x => x.set === h && x.a3)).forEach(x => add(x, 'armor', `${a.sets[h].n} set`)));
  const addHash = (h, reason) => { const w = d.byHash[h], x = w || a.byHash[h]; if (x) add(w ? weaponByName.get(baseName(w.n)) : x, w ? 'weapon' : 'armor', reason); };
  savedBuilds().filter(b => f.builds.includes(b.key)).forEach(b => [...b.loadout.equipped, ...(b.loadout.unequipped || []), { hash: b.loadout.parameters?.exoticArmorHash }]
    .forEach(it => addHash(it.hash, `Build: ${b.name}`)));
  f.items.forEach(h => addHash(h, 'Added by you'));
  return [...targets.values()];
}

async function farm() {
  const [d, a, rot] = await Promise.all([data(), armorData(), load('rotation')]);
  const p = Bungie.token() ? await needProfile() : null;
  // the week runs from Tuesday's 17:00 UTC reset
  const resetDay = new Date(Date.now() - 17 * 3600e3).toISOString().slice(0, 10);
  // Desert Perpetual and Equilibrium are featured every week, so fold them into each week's raids and dungeons
  const weeks = rot.weeks.map(w => ({ ...w, raids: [...w.raids, ...rot.always.raids], dungeons: [...w.dungeons, ...rot.always.dungeons] }));
  const cur = weeks.filter(w => w.start <= resetDay).at(-1) || weeks[0];
  const always = [...rot.always.raids, ...rot.always.dungeons];
  const featured = w => [...w.raids, ...w.dungeons, ...w.pantheon];
  const activities = [...new Set(weeks.flatMap(featured))];
  const pvpAlias = { 'Iron Banner': ['iron banner', 'saladin'], 'Trials of Osiris': ['trials', 'saint-14'] };
  const fmtDate = s => new Date(s + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const sets = Object.entries(a.sets).sort((x, y) => x[1].n.localeCompare(y[1].n));
  const builds = savedBuilds();

  $app.innerHTML = `<h1>Farming plan</h1><p class="muted">Week ${cur.week ?? ''} · ${fmtDate(cur.start)} reset. ${p ? '' : 'Sign in with Bungie so the plan skips what you already own.'}</p>
    <section class="panel"><h2>This week</h2><div class="eg"><span class="muted">Raids</span><div class="perks">${cur.raids.map(n => `<span class="badge${cur.master.includes(n) ? ' good' : ''}">${esc(n)}${cur.master.includes(n) ? ' · Master' : ''}</span>`).join('')}</div></div>
      <div class="eg"><span class="muted">Dungeons</span><div class="perks">${cur.dungeons.map(n => `<span class="badge${cur.master.includes(n) ? ' good' : ''}">${esc(n)}${cur.master.includes(n) ? ' · Master' : ''}</span>`).join('')}</div></div>
      <div class="eg"><span class="muted">Pantheon</span><div class="perks">${cur.pantheon.map(n => `<span class="badge">${esc(n)}</span>`).join('')}</div></div>
      <div class="eg"><span class="muted">Grandmaster</span><div class="perks"><span class="badge">${esc(cur.gm)}</span>${cur.gmWeapons.map(n => `<span class="badge">${esc(n)}</span>`).join('')}</div></div>
      <div class="eg"><span class="muted">PvP</span><div class="perks"><span class="badge">${esc(cur.pvp)}</span></div></div></section>
    <section class="panel"><details class="farmprefs" id="prefs"><summary>What you're farming for</summary>
      <div class="eg"><span class="muted">God rolls</span><div><select id="tier" aria-label="God rolls to chase"><option value="">Off</option>${TIERS.slice(0, 4).map(t => `<option value="${t}">Tier ${t}${t === 'S' ? '' : ' and up'}</option>`).join('')}</select>
        <small class="muted">Endgame Analysis rolls you don't own yet</small></div></div>
      <div class="eg"><span class="muted">Exotics</span><div class="perks"><label class="check"><input type="checkbox" id="exoticWeapons"> Weapons I don't have</label><label class="check"><input type="checkbox" id="exoticArmor"> Armor I don't have</label></div></div>
      <div class="eg"><span class="muted">Saved builds</span><div class="perks">${builds.length ? builds.map(b => `<label class="check"><input type="checkbox" data-build="${esc(b.key)}"> ${esc(b.name)}</label>`).join('') : '<small class="muted">Save a build on the <a href="#/build">Builds</a> tab to farm what it needs, including better rolls of weapons you already have.</small>'}</div></div>
      <div class="eg"><span class="muted">Armor sets</span><div class="setpick">${sets.map(([h, x]) => `<label class="check"><input type="checkbox" data-set="${h}"> ${esc(x.n)}</label>`).join('')}</div></div>
      <div class="eg"><span class="muted">Single items</span><div class="chips" id="items"></div></div></details></section>
    <div id="plan"><p class="muted">Working out where everything drops…</p></div>`;
  const $ = sel => $app.querySelector(sel), plan = $('#plan');
  let view = 'now';  // 'now' (this week) or 'later' (coming up)

  const draw = async () => {
    const f = farmPrefs();
    $('#tier').value = f.tier; $('#exoticWeapons').checked = f.exoticWeapons; $('#exoticArmor').checked = f.exoticArmor;
    $app.querySelectorAll('[data-build]').forEach(c => { c.checked = f.builds.includes(c.dataset.build); });
    $app.querySelectorAll('[data-set]').forEach(c => { c.checked = f.sets.includes(c.dataset.set); });
    $('#items').innerHTML = f.items.map(h => d.byHash[h] || a.byHash[h]).filter(Boolean).map(x => `<span class="chip"><a href="#/${d.byHash[x.h] ? 'weapon' : 'armor'}/${x.h}">${esc(x.n)}</a>
      <button type="button" class="x" data-unfarm="${x.h}" aria-label="Stop farming ${esc(x.n)}">×</button></span>`).join('')
      || '<small class="muted">Use "Add to farming plan" on any weapon or armor page.</small>';
    $('#items').querySelectorAll('[data-unfarm]').forEach(b => b.addEventListener('click', () => { toggleFarm('items', b.dataset.unfarm); draw(); }));
    const targets = farmTargets(d, a, p, f);
    $('#prefs summary').textContent = `What you're farming for · ${plural(targets.length, 'item')} to get`;
    if (!targets.length) { plan.innerHTML = '<p class="empty">Nothing to farm yet. Pick what you\'re after above.</p>'; $('#prefs').open = true; return; }

    // file each target by activity type, then activity: under this week's featured activity, the next week it's featured ('later'), or its usual source
    const plans = { now: new Map(), later: new Map() };
    const file = (view, type, act, t, extra) => {
      const types = plans[view], acts = types.get(type) || types.set(type, new Map()).get(type);
      (acts.get(act) || acts.set(act, { items: [], ...extra }).get(act)).items.push(t);
    };
    for (const t of targets) {
      const srcs = t.kind === 'weapon' ? await whereToFarm(t.x) : await armorSource(a, t.x);
      const low = srcs.map(s => s.toLowerCase());
      const acts = activities.filter(n => low.some(s => s.includes(n.toLowerCase())));
      const typeOf = (w, n) => w.raids.includes(n) ? 'Raids' : w.dungeons.includes(n) ? 'Dungeons' : 'Pantheon';
      const live = acts.find(n => featured(cur).includes(n));
      const next = !live && weeks.find(w => w.start > cur.start && acts.some(n => featured(w).includes(n)));
      if (cur.gmWeapons.includes(t.x.n)) file('now', 'Grandmaster', cur.gm, t, { note: 'Featured this week', rank: 1 });
      else if (live) file('now', typeOf(cur, live), live, t, always.includes(live) ? { note: 'Always featured', rank: 2 }
        : { note: 'Featured this week', rank: cur.pantheon.includes(live) ? 1 : 0, master: cur.master.includes(live) });
      else if ((pvpAlias[cur.pvp] || []).some(k => low.some(s => s.includes(k)))) file('now', 'PvP', cur.pvp, t, { note: 'This week\'s event', rank: 1 });
      else if (next) { const n = acts.find(x => featured(next).includes(x)); file('later', typeOf(next, n), n, t, { note: 'Featured ' + fmtDate(next.start), when: next.start }); }
      else {
        const src = srcs[0] || '', cut = src.indexOf(' · ');
        file('now', cut > 0 ? src.slice(0, cut) : 'Other sources', cut > 0 ? src.slice(cut + 3).replace(/\s*\(.*\)$/, '') : src || 'Unknown source', t, { note: 'Any time', rank: 3 });
      }
    }
    const score = g => g.items.reduce((s, t) => s + (t.r ? 4 - Math.min(3, TIERS.indexOf(t.r.t)) : 2) + t.reasons.length, 0);
    const count = acts => [...acts.values()].reduce((n, g) => n + g.items.length, 0);
    // the priority farm is this week's best rotating raid or dungeon
    const top = ['Raids', 'Dungeons'].flatMap(k => [...(plans.now.get(k)?.values() || [])]).filter(g => !g.rank).sort((x, y) => score(y) - score(x))[0];
    const topName = top && [...plans.now.values()].flatMap(acts => [...acts]).find(([, g]) => g === top)[0];
    const cards = items => `<div class="grid">${items.sort((m, n) => tierOrder(m.r) - tierOrder(n.r)).map(t => card(t.x, `<small>${tierBadge(t.r)}${t.owned ? 'You have it, not the god roll' : 'Not owned'}</small>
      <small>${t.reasons.map(esc).join(' · ')}</small>`, t.kind)).join('')}</div>`;
    const group = ([name, g]) => `<section class="panel${g === top ? ' priority' : ''}"><h2>${g === top ? 'Priority farm: ' : ''}${esc(name)} <span class="count">${g.note}${g.master ? ' · Master available' : ''} · ${plural(g.items.length, 'item')}</span></h2>${cards(g.items)}</section>`;
    const TYPES = ['Raids', 'Dungeons', 'Pantheon', 'Grandmaster', 'PvP'], rankType = k => (TYPES.indexOf(k) + 1 || 9);
    const show = which => [...plans[which]].sort((x, y) => rankType(x[0]) - rankType(y[0]) || (x[0] === 'Other sources') - (y[0] === 'Other sources') || count(y[1]) - count(x[1]))
      .map(([type, acts]) => `<h2 class="sub">${esc(type)} <span class="count">${plural(count(acts), 'item')}</span></h2>${[...acts]
        .sort((x, y) => which === 'later' ? x[1].when.localeCompare(y[1].when) || score(y[1]) - score(x[1]) : x[1].rank - y[1].rank || score(y[1]) - score(x[1])).map(group).join('')}`).join('')
      || `<p class="empty">${which === 'later' ? 'Nothing you\'re after is waiting on a future rotation.' : 'Nothing you\'re after drops this week. Check Coming up.'}</p>`;
    const total = which => [...plans[which].values()].reduce((n, acts) => n + count(acts), 0);
    plan.innerHTML = `<div class="tabs charpick farmview">${[['now', 'This week'], ['later', 'Coming up']].map(([k, label]) => `<button type="button" data-view="${k}"${k === view ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"'}>${label} · ${total(k)}</button>`).join('')}</div>
      ${top ? `<p class="muted farmtop">Priority farm this week: <b>${esc(topName)}</b>, ${plural(top.items.length, 'item')} you're after${top.master ? ', Master available' : ''}.</p>` : ''}<div id="planbody">${show(view)}</div>`;
    plan.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
      view = b.dataset.view;
      plan.querySelectorAll('[data-view]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
      $('#planbody').innerHTML = show(view);
    }));
  };
  const save = (k, v) => { Bungie.store.set('d2c_farm', { ...farmPrefs(), [k]: v }); draw(); };
  $('#tier').addEventListener('change', e => save('tier', e.target.value));
  $('#exoticWeapons').addEventListener('change', e => save('exoticWeapons', e.target.checked));
  $('#exoticArmor').addEventListener('change', e => save('exoticArmor', e.target.checked));
  $app.querySelectorAll('[data-build]').forEach(c => c.addEventListener('change', () => { toggleFarm('builds', c.dataset.build); draw(); }));
  $app.querySelectorAll('[data-set]').forEach(c => c.addEventListener('change', () => { toggleFarm('sets', c.dataset.set); draw(); }));
  await draw();
}

async function reference(idx) {
  const tabs = await sheets();
  const groups = Object.groupBy(tabs.map((t, i) => ({ ...t, i })), t => t.source);
  const t = tabs[idx];
  $app.innerHTML = `<h1>Reference</h1>${Object.entries(groups).map(([src, ts]) => `<h3>${esc(src)}</h3><div class="tabs">${ts.map(x => `<a ${x.i === idx ? 'class="on" aria-current="page"' : ''} href="#/ref/${x.i}">${esc(x.tab)}</a>`).join('')}</div>`).join('')}
    ${t ? `<section class="panel" id="sheet"><h2>${esc(t.tab)}</h2>${t.url ? `<p><a href="${esc(t.url)}" target="_blank" rel="noopener">Open the original sheet</a></p>` : ''}
      <div class="filters"><input type="search" id="q" aria-label="Filter rows" placeholder="Filter rows"></div><div class="tablewrap"><table class="sheet" id="tbl"></table></div></section>` : '<p class="muted">Pick a tab.</p>'}`;
  if (!t) return;
  const draw = () => {
    const q = $app.querySelector('#q').value.toLowerCase();
    $app.querySelector('#tbl').innerHTML = t.rows.filter((r, i) => i < 2 || !q || r.some(c => c.toLowerCase().includes(q)))
      .map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
  };
  $app.querySelector('#q').addEventListener('input', draw);
  draw();
  // on phones the tab list is long, so bring the chosen sheet into view
  const sheet = $app.querySelector('#sheet');
  if (sheet.getBoundingClientRect().top > innerHeight * 0.6) sheet.scrollIntoView();
}

function images() {
  $app.innerHTML = `<h1>Infographics</h1><p class="muted">Click an image to zoom.</p>
    <section class="panel infographic"><h2>Armor set bonuses</h2><img src="img/armor-set-bonuses.jpg" alt="Armor set bonuses infographic"></section>
    <section class="panel infographic"><h2>Artifact perks (Tony Lucente)</h2><img src="img/artifact-perks.png" alt="Artifact perks infographic"></section>`;
  $app.querySelectorAll('.infographic img').forEach(i => i.addEventListener('click', () => i.classList.toggle('zoom')));
}

async function route() {
  routeSeq++;
  const [path, query] = (location.hash.slice(1) || '/').split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query);
  renderAccount();
  document.querySelectorAll('.top nav a').forEach(a => a.toggleAttribute('aria-current', a.getAttribute('href').slice(2).split('/')[0] === (/^weapons?$/.test(parts[0]) ? '' : parts[0] || '')));
  window.scrollTo(0, 0);
  try {
    if (!parts[0] || parts[0] === 'weapons') await weaponList(params);
    else if (parts[0] === 'weapon') await weaponPage(+parts[1]);
    else if (parts[0] === 'inventory') await inventory(parts[1]);
    else if (parts[0] === 'armor') await (parts[1] ? armorPage(+parts[1]) : armorList(params));
    else if (parts[0] === 'sets') await setsPage();
    else if (parts[0] === 'build') await buildPage(parts[1]);
    else if (parts[0] === 'farm') await farm();
    else if (parts[0] === 'ref') await reference(parts[1] ? +parts[1] : -1);
    else if (parts[0] === 'images') images();
    else $app.innerHTML = '<p class="empty">Page not found. <a href="#/">Back to weapons</a></p>';
  } catch (e) {
    $app.innerHTML = `<p>Something went wrong: ${esc(e.message)}</p>`;
    console.error(e);
  }
}

window.addEventListener('hashchange', route);
Bungie.handleRedirect().catch(e => alert(e.message)).finally(route);
