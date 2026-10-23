// D2 Compendium: hash-routed single page app over data/*.json plus live Bungie profile data.
const BNET = 'https://www.bungie.net';
const $app = document.getElementById('app');
const S = { profile: null };
const cache = {};
const load = name => cache[name] ||= fetch(`data/${name}.json`).then(r => r.json());

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
  if (!w.byHash) {
    w.byHash = Object.fromEntries(w.weapons.map(x => [x.h, x]));
    // reissues share perk hashes, so a roll written for any version applies to every version with that name
    const byName = {};
    w.weapons.forEach(x => (byName[x.n] ||= []).push(...(gr.rolls[x.h] || [])));
    w.rolls = Object.fromEntries(w.weapons.filter(x => byName[x.n].length).map(x => [x.h, byName[x.n]]));
  }
  return { weapons: w.weapons, byHash: w.byHash, version: w.version, plugs, rolls: w.rolls, notes: gr.notes };
}

// A wishlist roll matches when every column has at least one of its perks on the item.
const rollMatches = (roll, plugs) => roll.c.every(col => col.some(p => plugs.has(p)));

async function profile() {
  if (S.profile || !Bungie.token()) return S.profile;
  S.profile = await Bungie.loadProfile();
  return S.profile;
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
  $app.innerHTML = `<h1>Weapons</h1><p class="muted">Every weapon in the game, with perks, stats, community god rolls and what your sheets say about it.</p><div class="filters">
    <input type="search" id="q" aria-label="Search weapons" placeholder="Search weapons, perks or sources" value="${esc(params.get('q') || '')}">
    ${select('ty', 'All types', uniq('ty'))}${select('dm', 'All elements', uniq('dm'))}${select('am', 'All ammo', uniq('am'))}${select('ti', 'All rarities', uniq('ti'))}
    <label class="check"><input type="checkbox" id="gr"> Has god roll</label></div><p id="count" class="muted"></p><div class="grid" id="list"></div>`;
  const f = id => $app.querySelector('#' + id);
  const draw = () => {
    const q = f('q').value.trim().toLowerCase();
    const list = d.weapons.filter(w => (!q || w.n.toLowerCase().includes(q) || w.src.toLowerCase().includes(q) ||
        w.cols.some(c => c.p.some(p => d.plugs[p]?.n.toLowerCase() === q)))
      && ['ty', 'dm', 'am', 'ti'].every(k => !f(k).value || w[k] === f(k).value) && (!f('gr').checked || d.rolls[w.h]));
    // reissues share a name; list each name once (newest version first, by the build's sort) and link the rest from its page
    const byName = new Map();
    list.forEach(w => byName.has(w.n) ? byName.get(w.n).count++ : byName.set(w.n, { w, count: 1 }));
    const names = [...byName.values()];
    f('count').textContent = plural(names.length, 'weapon') + (names.length > 300 ? ', showing the first 300' : '');
    f('list').innerHTML = names.slice(0, 300).map(({ w, count }) => card(w, `<small><span class="dmg-${esc(w.dm)}">${esc(w.dm)}</span> ${esc(w.ty)} · ${esc(w.am)}</small>
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
  const rolls = d.rolls[w.h] || [];
  const godPerks = new Set(rolls.flatMap(r => r.c.flat()));
  const godNames = new Set([...godPerks].map(h => d.plugs[h]?.n));
  const perk = (h, col) => { const p = d.plugs[h];
    return `<button type="button" class="perk${godNames.has(p.n) ? ' god' : ''}${col.cur === h ? ' cur' : ''}" data-h="${h}">${img(p.i)}<span>${esc(p.n)}${p.e ? ' <span class="enh">enhanced</span>' : ''}</span></button>`; };
  // enhanced versions share a name with the base perk, so show one entry per name (the first, usually the base);
  // "Empty ... Socket" plugs are placeholders, not choices
  const dedupe = hs => hs.filter((h, i) => d.plugs[h] && !/^Empty .*Socket$/.test(d.plugs[h].n) && hs.findIndex(x => d.plugs[x]?.n === d.plugs[h].n) === i);
  const perkCols = cols => cols.map(c => [c, dedupe(c.p)]).filter(([, hs]) => hs.length)
    .map(([c, hs]) => `<div class="perkcol"><h3>${esc(d.plugs[c.p[0]]?.t || c.c)}</h3>${hs.map(h => perk(h, c)).join('')}</div>`).join('');
  const mods = w.cols.filter(c => c.c === 'Weapon Mods');
  const maxStat = Math.max(100, ...w.st.filter(s => !s[2]).map(s => s[1]));
  $app.innerHTML = `
    ${hero(w, `<span class="badge">${esc(w.ti)}</span><span class="badge dmg-${esc(w.dm)}">${esc(w.dm)}</span><span class="badge">${esc(w.ty)}</span><span class="badge">${esc(w.sl)} · ${esc(w.am)}</span>${rolls.length ? '<span class="badge good">God rolls</span>' : ''}`)}
    ${same.length ? `<p class="versions">Other versions: ${same.map((x, i) => `<a href="#/weapon/${x.h}">${esc(bungieSource(x) || 'version ' + (i + 2))}</a>`).join(' · ')}</p>` : ''}
    <section class="panel"><h2>Perks</h2><p class="legend"><span class="key god"></span> In a community god roll <span class="key cur"></span> Curated roll</p>
      <div class="perkcols">${perkCols(w.cols.filter(c => c.c !== 'Weapon Mods'))}</div>
      ${mods.length ? `<details class="more"><summary>Masterwork and mods</summary><div class="perkcols">${perkCols(mods)}</div></details>` : ''}
      <div class="perkinfo" id="perkinfo" aria-live="polite"><span class="muted">Select a perk to see what it does.</span></div></section>
    <div class="cols2"><div>
      <section class="panel"><h2>Stats</h2>${w.st.map(([n, v, num]) => `<div class="stat"><span class="muted">${esc(n)}</span>${num ? '<span></span>' : `<div class="bar"><span style="width:${Math.min(100, v / maxStat * 100)}%"></span></div>`}<b>${v}</b></div>`).join('')}</section>
      <section class="panel"><h2>Source</h2><p id="farmsrc">${esc(bungieSource(w) || 'Unknown')}</p><div id="sheetsrc" class="muted">Looking up community sheets…</div></section>
      <section class="panel" id="mine"><h2>Your copies</h2><p class="muted">${Bungie.token() ? 'Loading your vault…' : 'Sign in with Bungie to see your copies and which of them are god rolls.'}</p></section>
    </div><div>
      <section class="panel"><h2>God rolls</h2><p class="muted">From the Voltron community wishlist. Open one to see every perk combination it accepts.</p>${rolls.length ? rollGroups(d, rolls) : '<p class="muted">No community god roll for this weapon.</p>'}</section>
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

  // Community sheet rows mentioning this weapon by name, or its frame for the same weapon type.
  const frame = w.cols.find(c => c.c === 'Intrinsic Traits');
  const frameName = frame && d.plugs[frame.p[0]]?.n;
  const hits = [...await sheetRows(w.n),
    ...(frameName && w.ti !== 'Exotic' ? await sheetRows(frameName, (t, r) => t.tab === 'Weapons' && r.some(c => c.toLowerCase() === w.ty.toLowerCase())) : [])];
  document.getElementById('farmsrc').textContent = (await whereToFarm(w)).join(' · also: ') || 'Unknown';
  document.getElementById('sheetsrc').innerHTML = hits.length ? rowTable(hits) : 'Not mentioned in the community sheets.';

  if (Bungie.token()) {
    try {
      const prof = await profile(); renderAccount();
      const mine = prof.items.filter(i => i.itemHash === w.h);
      document.querySelector('#mine').innerHTML = `<h2>Your copies</h2>` + (mine.length ? mine.map(i => {
        const hit = rolls.filter(r => rollMatches(r, i.plugs));
        return `<div class="roll">${hit.length ? '<span class="badge good">God roll</span>' : '<span class="badge">Not a god roll</span>'} ${esc(i.location)}${i.power ? ` · ${i.power} power` : ''}
          <div class="perks">${w.cols.filter(c => c.c === 'Weapon Perks').flatMap(c => c.p).filter(p => i.plugs.has(p) && !/^Empty .*Socket$/.test(d.plugs[p].n)).map(p => `<span class="badge${godPerks.has(p) ? ' good' : ''}">${esc(d.plugs[p].n)}</span>`).join('')}</div>
          ${hit[0] ? `<small class="muted note">${esc(noteTitle(d.notes[hit[0].note]))}</small>` : ''}</div>`;
      }).join('') : '<p class="muted">You don\'t own this version.</p>');
    } catch (e) { document.querySelector('#mine').innerHTML = `<h2>Your copies</h2><p>${esc(e.message)}</p>`; }
  }
}

// Wishlist notes end in machine tags ("...|tags:pve,god-pve"); keep the human part.
const noteTitle = n => (n || '').replace(/\s*\|\s*tags:.*$/i, '').replace(/^File auto generated from csv\s*/i, '').replace(/\s*\(tags:[^)]*\)/i, '').trim() || 'No notes';
const noteModes = n => ['PvE', 'PvP'].filter(m => new RegExp(m, 'i').test(n || ''));

// One collapsible block per wishlist note, listing every perk combination that note recommends.
function rollGroups(d, rolls) {
  const groups = Object.groupBy(rolls, r => r.note);
  const combo = r => r.c.map(col => `<span class="badge">${[...new Set(col.map(p => d.plugs[p]?.n || p))].map(esc).join(' / ')}</span>`).join('');
  return Object.entries(groups).map(([note, rs]) => `<details class="roll"><summary>${noteModes(d.notes[note]).map(m => `<span class="badge mode">${m}</span>`).join('')}<span class="note">${esc(noteTitle(d.notes[note]))}</span></summary>
    ${rs.slice(0, 6).map(r => `<div class="perks">${combo(r)}</div>`).join('')}${rs.length > 6 ? `<small class="muted">and ${rs.length - 6} more combinations</small>` : ''}</details>`).join('');
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
      <section class="panel"><h2>Source</h2><p id="farmsrc">${esc(bungieSource(x) || 'Unknown')}</p><div id="sheetsrc" class="muted">Looking up community sheets…</div></section>
    </div><div>
      <section class="panel" id="mine"><h2>Your copies</h2><p class="muted">${Bungie.token() ? 'Loading your vault…' : 'Sign in with Bungie to see your copies, their tier, archetype and stats.'}</p></section>
      ${x.a3 ? `<section class="panel"><h2>Archetypes</h2><p class="muted">Every current armor piece can drop as any of these. The archetype sets its two highest stats.</p>
        <table class="sheet"><tr><td class="muted">Archetype</td><td class="muted">Primary stat</td><td class="muted">Secondary stat</td></tr>
        ${Object.values(Object.fromEntries(Object.values(a.archetypes).map(t => [t.n, t]))).sort((p, q) => p.n.localeCompare(q.n)).map(t => `<tr><td>${esc(t.n)}</td>${archetypeStats(t.d).map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</table></section>` : ''}
    </div></div>`;

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

const gearTabs = on => `<div class="tabs gear">${[['', 'Weapons'], ['/armor', 'Armor']].map(([path, label]) => `<a href="#/inventory${path}"${label === on ? ' class="on" aria-current="page"' : ''}>${label}</a>`).join('')}</div>`;

async function inventory(tab) {
  if (tab === 'armor') return armorInventory();
  const d = await data();
  const p = await needProfile(); if (!p) return;
  const owned = p.items.filter(i => d.byHash[i.itemHash]);
  const byWeapon = Object.groupBy(owned, i => i.itemHash);
  const rows = Object.entries(byWeapon).map(([h, list]) => {
    const w = d.byHash[h], rolls = d.rolls[h] || [];
    return { w, list, god: list.filter(i => rolls.some(r => rollMatches(r, i.plugs))).length, hasRolls: rolls.length > 0 };
  }).sort((a, b) => b.god - a.god || a.w.n.localeCompare(b.w.n));
  $app.innerHTML = `<h1>My gear</h1>${gearTabs('Weapons')}<p class="muted">${plural(owned.length, 'weapon')}, ${plural(rows.reduce((s, r) => s + r.god, 0), 'god roll')}, ${plural(rows.filter(r => r.list.length > 1).length, 'weapon')} with duplicates.</p>
    <div class="filters"><input type="search" id="q" aria-label="Filter your weapons" placeholder="Filter by name"><select id="show" aria-label="Show"><option value="">Everything</option><option value="god">God rolls</option><option value="nogod">Has a god roll I don't own yet</option><option value="dupe">Duplicates</option></select></div>
    <div class="grid" id="list"></div>`;
  const draw = () => {
    const q = $app.querySelector('#q').value.toLowerCase(), show = $app.querySelector('#show').value;
    $app.querySelector('#list').innerHTML = rows.filter(r => r.w.n.toLowerCase().includes(q) &&
        (!show || show === 'god' && r.god || show === 'nogod' && r.hasRolls && !r.god || show === 'dupe' && r.list.length > 1))
      .map(r => card(r.w, `<small>${esc(r.w.ty)} · owned ×${r.list.length}</small>
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

async function farm() {
  const d = await data();
  const p = Bungie.token() ? await needProfile() : null;
  const haveGod = new Set((p?.items || []).filter(i => (d.rolls[i.itemHash] || []).some(r => rollMatches(r, i.plugs))).map(i => d.byHash[i.itemHash]?.n));
  // one entry per weapon name, sourced from Monument of Triumph first, then Bungie's collection text
  const chase = new Map();
  for (const w of d.weapons.filter(w => d.rolls[w.h] && !haveGod.has(w.n))) {
    const src = (await whereToFarm(w))[0];
    if (src && (!chase.has(w.n) || !chase.get(w.n).src)) chase.set(w.n, { ...w, src }); // keep a version with a known source
    else if (!chase.has(w.n)) chase.set(w.n, { ...w, src: 'Unknown source' });
  }
  const bySource = Object.groupBy([...chase.values()], w => w.src);
  const sources = Object.keys(bySource).sort((a, b) => bySource[b].length - bySource[a].length);
  $app.innerHTML = `<h1>Farming plan</h1>
    <p class="muted">${p ? `God rolls you don't own yet` : 'Every weapon with a community god roll'}, grouped by where it drops. ${p ? '' : 'Sign in to hide the ones you already have.'}</p>
    <div class="filters"><input type="search" id="q" aria-label="Filter the farming plan" placeholder="Filter by source or weapon (e.g. Zavala, Nightfall, Last Wish)"></div><div id="list"></div>`;
  const draw = () => {
    const q = $app.querySelector('#q').value.toLowerCase();
    $app.querySelector('#list').innerHTML = sources.map(s => {
      const ws = bySource[s].filter(w => !q || s.toLowerCase().includes(q) || w.n.toLowerCase().includes(q));
      return ws.length ? `<section class="panel"><h2>${esc(s)} <span class="count">${ws.length}</span></h2><div class="grid">${ws.map(w => card(w, `<small>${esc(w.ty)} · <span class="dmg-${esc(w.dm)}">${esc(w.dm)}</span></small>`)).join('')}</div></section>` : '';
    }).join('') || '<p class="empty">Nothing matches this filter.</p>';
  };
  $app.querySelector('#q').addEventListener('input', draw);
  draw();
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
