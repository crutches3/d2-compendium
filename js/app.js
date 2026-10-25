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
// a perk's stat changes, green when they help
const lowerBetter = /Charge Time|Draw Time|Heat Generated/;
const deltaList = s => s.length ? `<ul class="deltas">${s.map(([n, v]) => `<li class="${(v > 0) !== lowerBetter.test(n) ? 'up' : 'down'}">${v > 0 ? '+' : '−'}${Math.abs(v)} ${esc(n)}</li>`).join('')}</ul>` : '';
const hero = (x, badges) => `<div class="hero${x.ss ? '' : ' plain'}"${x.ss ? ` style="background-image:url('${BNET}${x.ss}')"` : ''}><div class="shade">${x.i ? icon(x) : ''}<div>
  <h1>${esc(x.n)}</h1><div>${badges}</div>${x.fl ? `<p class="flavor">${esc(x.fl)}</p>` : ''}</div></div></div>`;

async function data() {
  const [w, plugs, gr] = await Promise.all([load('weapons'), load('plugs'), load('godrolls')]);
  w.byHash ||= Object.fromEntries(w.weapons.map(x => [x.h, x]));
  return { weapons: w.weapons, byHash: w.byHash, version: w.version, scales: w.scales, plugs, rolls: gr.rolls, source: gr.source };
}

// d.rolls[hash] is Aegis's Endgame Analysis rating; exotics are rated but have no roll to match.
// How a copy lines up with a recommended roll, column by column: the Endgame Analysis Barrel, Magazine, Perk 1 and Perk 2, or a build's
// own picks (roll.build). grade: 'build' (every build pick) or 'buildpart'; for the tier list 'perfect' (every column),
// 'god' (Perk 1 and Perk 2), 'half' (one of them) or 'none'.
function rollFit(d, roll, plugs) {
  const names = new Set([...plugs].map(h => d.plugs[h]?.n));
  const cols = Object.entries(roll?.p || {}).filter(([, v]) => v.length).map(([c, v]) => ({ c, ok: v.some(n => names.has(n)) }));
  if (!cols.length) return null;
  if (roll.build) return { cols, grade: cols.every(x => x.ok) ? 'build' : 'buildpart' };
  const main = cols.filter(x => /^Perk \d$/.test(x.c));
  const grade = cols.every(x => x.ok) ? 'perfect' : main.length && main.every(x => x.ok) ? 'god' : (main.length ? main : cols).some(x => x.ok) ? 'half' : 'none';
  return { cols, grade };
}
const GRADES = { build: 'Build roll', perfect: 'Perfect roll', god: 'God roll', half: 'Partial', buildpart: 'Build roll', none: 'No match' };
const isGod = f => f?.grade === 'perfect' || f?.grade === 'god';
const gradeRank = f => f ? Object.keys(GRADES).indexOf(f.grade) * 10 - f.cols.filter(x => x.ok).length : 99;  // lower is better
const bestFit = fits => fits.filter(Boolean).sort((x, y) => gradeRank(x) - gradeRank(y))[0];
// one lettered pip per column (B, M, 1, 2), lit in the grade's color
const rollPips = f => { if (!f) return '';
  const hits = f.cols.filter(x => x.ok).length, name = f.grade === 'buildpart' ? `Build roll ${hits}/${f.cols.length}` : GRADES[f.grade];
  const label = `${name}: ${hits} of ${f.cols.length} match (${f.cols.map(x => `${x.c} ${x.ok ? 'yes' : 'no'}`).join(', ')})`;
  return `<span class="pips g-${f.grade}" role="img" aria-label="${esc(label)}" title="${esc(label)}">${f.cols.map(x => `<i${x.ok ? ' class="on"' : ''}>${esc(/^Perk \d$/.test(x.c) ? x.c.slice(-1) : x.c[0])}</i>`).join('')}<b>${name}</b></span>`; };
const rollLegend = '<small class="muted pipkey">B, M, 1, 2: the tier list\'s Barrel, Magazine, Perk 1 and Perk 2. <span class="pips g-perfect"><b>Gold</b></span> all four, <span class="pips g-god"><b>green</b></span> both main perks (god roll), <span class="pips g-half"><b>orange</b></span> one main perk, <span class="pips g-build"><b>purple</b></span> every perk of a build roll you picked.</small>';
// A saved build's goal roll for a weapon, shaped like a tier-list roll: perks picked on the weapon page (b.rolls), else the
// DIM link's own (socketOverrides). Null when the build has none.
const PERK_COLS = ['Barrel', 'Magazine', 'Perk 1', 'Perk 2'];
const perkCol = (w, h) => PERK_COLS[w.cols.filter(c => c.c === 'Weapon Perks').findIndex(c => c.p.includes(h))];
function buildRoll(d, b, w) {
  const picked = b.rolls?.[baseName(w.n)];
  if (picked) return Object.values(picked).some(v => v.length) ? { p: picked, build: true } : null;
  const it = [...b.loadout.equipped, ...(b.loadout.unequipped || [])].find(i => d.byHash[i.hash] && baseName(d.byHash[i.hash].n) === baseName(w.n)), p = {};
  Object.values(it?.socketOverrides || {}).forEach(h => { const k = perkCol(w, h); if (k) (p[k] ||= []).push(d.plugs[h].n); });
  return Object.keys(p).length ? { p, build: true } : null;
}
const usesWeapon = (d, b, w) => [...b.loadout.equipped, ...(b.loadout.unequipped || [])].some(i => d.byHash[i.hash] && baseName(d.byHash[i.hash].n) === baseName(w.n));
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
  const perk = (h, col, ci) => { const p = d.plugs[h];
    return `<button type="button" class="perk${godNames.has(p.n) ? ' god' : ''}${col.cur === h ? ' cur' : ''}" data-h="${h}" data-ci="${ci}"${perkCol(w, h) && col.c === 'Weapon Perks' ? ` data-col="${perkCol(w, h)}"` : ''}>${img(p.i)}<span>${esc(mwName(h) || p.n)}${p.e ? ' <span class="enh">enhanced</span>' : ''}</span></button>`; };
  // enhanced versions share a name with the base perk, so show one entry per name (the first, usually the base);
  // "Empty ... Socket" plugs are placeholders, not choices
  const dedupe = hs => hs.filter((h, i) => d.plugs[h] && !/^Empty .*Socket$/.test(d.plugs[h].n) && hs.findIndex(x => d.plugs[x]?.n === d.plugs[h].n) === i);
  const perkCols = cols => cols.map((c, ci) => [c, dedupe(c.p), ci]).filter(([, hs]) => hs.length)
    .map(([c, hs, ci]) => `<div class="perkcol"><h3>${esc(d.plugs[c.p[0]]?.t || c.c)}</h3>${hs.map(h => perk(h, c, ci)).join('')}</div>`).join('');
  const maxStat = Math.max(100, ...w.st.filter(s => !s[2]).map(s => s[1]));
  // Stats as light.gg shows them: the picked perks (and the hovered one, in place of its column's pick) against the bare weapon.
  // Perks add to a stat's investment value; most stats show it 1:1 (0-100), the rest (magazine, RPM, impact) follow the weapon's curve.
  const curve = (pts, v) => { const i = pts.findIndex(x => x[0] >= v); if (i < 1) return pts.at(i)[1]; const [a, b] = pts[i - 1], [c, e] = pts[i]; return b + (e - b) * (v - a) / (c - a); };
  const statAt = (st, add) => st[4] != null ? Math.round(curve(d.scales[st[4]], st[3] + add)) : Math.max(0, Math.min(100, st[1] + add));
  const sum = hs => { const t = {}; for (const h of hs) for (const [n, v] of d.plugs[h]?.s || []) t[n] = (t[n] || 0) + v; return t; };
  const always = sum(w.cols.filter(c => c.c === 'Intrinsic Traits').map(c => c.cur || c.p[0]));  // the frame is always on, and the definition leaves it out
  const picked = new Map();
  const pct = v => Math.min(100, v / maxStat * 100);
  const statRows = hover => {
    const add = sum([...new Map([...picked, ...(hover ? [[hover.dataset.ci, +hover.dataset.h]] : [])]).values()]);
    return w.st.map(st => { const [n, , num] = st, base = statAt(st, always[n] || 0), now = statAt(st, (always[n] || 0) + (add[n] || 0)), diff = now - base;
      const tone = diff && (diff > 0) !== lowerBetter.test(n) ? 'up' : 'down';
      return `<div class="stat${diff ? ' changed' : ''}" data-stat="${esc(n)}"><span class="muted">${esc(n)}</span>${num ? '<span></span>' : `<div class="bar"><span style="width:${pct(Math.min(base, now))}%"></span><span class="delta${diff ? ` ${diff > 0 ? 'more' : 'less'} ${tone}` : ''}" style="left:${pct(Math.min(base, now))}%;width:${diff ? Math.abs(pct(now) - pct(base)) : 0}%"></span></div>`}
        <b>${now}</b><small class="${tone}">${diff ? (diff > 0 ? '+' : '−') + Math.abs(diff) : ''}</small></div>`; }).join('');
  };
  // build roll: pick a saved build that uses this weapon and its perks become the goal; "Pick perks" sets them on the grid
  const goalBuilds = savedBuilds().filter(b => usesWeapon(d, b, w));
  let goalKey = goalBuilds.some(b => b.key === Bungie.store.get('d2c_goal')?.[baseName(w.n)]) ? Bungie.store.get('d2c_goal')[baseName(w.n)] : '', editing = false;
  const goal = () => { const b = savedBuilds().find(x => x.key === goalKey); return b ? buildRoll(d, b, w) : null; };
  $app.innerHTML = `
    ${hero(w, `<span class="badge">${esc(w.ti)}</span><span class="badge dmg-${esc(w.dm)}">${esc(w.dm)}</span><span class="badge">${esc(w.ty)}</span><span class="badge">${esc(w.sl)} · ${esc(w.am)}</span>${tierBadge(er)}`)}
    ${same.length ? `<p class="versions">Other versions: ${same.map((x, i) => `<a href="#/weapon/${x.h}">${esc(bungieSource(x) || 'version ' + (i + 2))}</a>`).join(' · ')}</p>` : ''}
    <div class="wtop"><section class="panel perkpanel"><h2>Perks</h2><p class="legend"><span class="key god"></span> In the Endgame Analysis roll <span class="key cur"></span> Curated roll${goalBuilds.length ? ' <span class="key goal"></span> Build roll' : ''}</p>
      ${goalBuilds.length ? `<div class="goalbar"><label for="goal">Build roll</label><select id="goal"><option value="">None</option>${goalBuilds.map(b => `<option value="${esc(b.key)}"${b.key === goalKey ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
        <button type="button" id="editgoal"${goalKey ? '' : ' hidden'}>Pick perks</button><small class="muted" id="goalhint"></small></div>` : ''}
      <div class="perkcols">${perkCols([...w.cols.filter(c => c.c !== 'Weapon Mods'), mw])}</div>
      <div class="perktip" id="perktip" hidden></div>
      <div class="perkinfo" id="perkinfo" aria-live="polite"><span class="muted">Hover a perk to preview its stats. Click one per column to build a roll.</span></div></section>
    <div class="wside">
      <section class="panel" id="stats"><h2>Stats</h2><div id="statrows">${statRows()}</div>
        <p class="statacts">${w.cols.some(c => c.cur) ? '<button type="button" id="curated">Curated roll</button>' : ''}<button type="button" id="clearroll" disabled>Clear roll</button></p></section>
      <section class="panel copies" id="mine"><h3>Your copies</h3><p class="muted">${Bungie.token() ? 'Loading your vault…' : 'Sign in with Bungie to see your copies here.'}</p></section>
    </div></div>
    <div class="cols2"><div>
      <section class="panel"><h2>Source</h2><p id="farmsrc">${esc(bungieSource(w) || 'Unknown')}</p><div id="sheetsrc" class="muted">Looking up community sheets…</div><p>${farmButton(w.h)}</p></section>
    </div><div>
      <section class="panel"><h2>Endgame Analysis</h2>${endgamePanel(d, er)}</section>
    </div></div>
    ${w.lore ? `<section class="panel"><h2>Lore</h2><div class="lore">${esc(w.lore)}</div></section>` : ''}`;

  const grid = $app.querySelector('.perkcols'), copiesBox = $app.querySelector('#mine');
  const drawGoal = () => {
    const g = goal(), names = new Set(Object.values(g?.p || {}).flat());
    grid.querySelectorAll('.perk').forEach(el => el.classList.toggle('goal', names.has(d.plugs[el.dataset.h].n)));
    grid.classList.toggle('editing', editing);
    const btn = $app.querySelector('#editgoal'), hint = $app.querySelector('#goalhint');
    if (!btn) return;
    btn.hidden = !goalKey; btn.textContent = editing ? 'Done' : 'Pick perks'; btn.setAttribute('aria-pressed', String(editing));
    hint.textContent = editing ? 'Click Barrel, Magazine and trait perks to add or remove them.' : goalKey && !g ? 'This build has no perks for this weapon yet.' : '';
    copiesBox.dispatchEvent(new Event('goal'));
  };
  $app.querySelector('#goal')?.addEventListener('change', e => {
    goalKey = e.target.value; editing = false;
    Bungie.store.set('d2c_goal', { ...Bungie.store.get('d2c_goal'), [baseName(w.n)]: goalKey });
    drawGoal();
  });
  $app.querySelector('#editgoal')?.addEventListener('click', () => { editing = !editing; drawGoal(); });
  // while picking, a perk click adds it to or removes it from the build's roll, saved with the build
  const toggleGoalPerk = el => {
    const builds = savedBuilds(), b = builds.find(x => x.key === goalKey), col = el.dataset.col, n = d.plugs[el.dataset.h].n;
    const cur = buildRoll(d, b, w)?.p || {}, list = cur[col] || [];
    b.rolls = { ...b.rolls, [baseName(w.n)]: { ...cur, [col]: list.includes(n) ? list.filter(x => x !== n) : [...list, n] } };
    Bungie.store.set('d2c_builds', builds);
    drawGoal();
  };
  drawGoal();

  $app.querySelectorAll('.perk').forEach(el => el.addEventListener('click', async () => {
    if (editing) { if (el.dataset.col) toggleGoalPerk(el); return; }
    const info = document.getElementById('perkinfo');
    const wasOn = el.classList.contains('sel');
    // one pick per column, which the stats add up; clicking the pick again takes it out and closes the details box
    grid.querySelectorAll(`.perk.sel[data-ci="${el.dataset.ci}"]`).forEach(x => { x.classList.remove('sel'); x.removeAttribute('aria-pressed'); });
    if (wasOn) picked.delete(el.dataset.ci); else picked.set(el.dataset.ci, +el.dataset.h);
    drawStats();
    if (wasOn) { info.classList.remove('on'); info.innerHTML = '<span class="muted">Hover a perk to preview its stats. Click one per column to build a roll.</span>'; return; }
    el.classList.add('sel');
    info.classList.add('on');
    const p = d.plugs[el.dataset.h];
    const extra = await sheetRows(p.n, t => t.source === 'Destiny Data Compendium');
    info.innerHTML = `<b>${esc(p.n)}</b> <span class="muted">${esc(p.t)}</span>\n${esc(p.d)}` +
      (p.s.length ? `\n${p.s.map(([n, v]) => `${v > 0 ? '+' : ''}${v} ${esc(n)}`).join(', ')}` : '') +
      (extra.length ? `\n\n<b>Destiny Data Compendium</b>\n${esc(extra[0].row.filter(c => c && c !== extra[0].row[0]).join('\n'))}` : '') +
      `\n<a href="${wikiHref(p.n)}">Everything about ${esc(p.n)} in the wiki</a>`;
    el.setAttribute('aria-pressed', 'true');
  }));
  // hovering (or tabbing to) a perk previews the stats with it in place of its column's pick, with a light.gg-style card beside it
  const statBox = $app.querySelector('#statrows'), tip = $app.querySelector('#perktip'), panel = $app.querySelector('.perkpanel');
  // updates the rows in place rather than replacing them, so the bars slide to their new values instead of jumping
  const drawStats = hover => {
    const next = document.createElement('div'); next.innerHTML = statRows(hover);
    if (statBox.children.length !== next.children.length) statBox.replaceChildren(...next.children);
    else [...next.children].forEach((n, k) => {
      const o = statBox.children[k], ns = n.querySelectorAll('.bar span');
      o.className = n.className;
      o.querySelectorAll('.bar span').forEach((s, j) => { s.className = ns[j].className; s.style.cssText = ns[j].style.cssText; });
      o.querySelector('b').textContent = n.querySelector('b').textContent;
      const os = o.querySelector('small'), nsm = n.querySelector('small'); os.className = nsm.className; os.textContent = nsm.textContent;
    });
    $app.querySelector('#clearroll').disabled = !picked.size;
  };
  let shown = null;
  const preview = el => {
    shown = el; drawStats(el);
    const p = d.plugs[el.dataset.h], r = el.getBoundingClientRect(), pr = panel.getBoundingClientRect();
    tip.innerHTML = `<b>${esc(p.n)}</b><small>${esc(p.t)}</small>${p.d ? `<p>${esc(p.d)}</p>` : ''}${deltaList(p.s)}`;
    // already showing: the card glides to the next perk; just shown: it appears in place
    tip.classList.toggle('glide', !tip.hidden);
    tip.hidden = false;
    tip.style.translate = `${Math.max(8, Math.min(r.left - pr.left, pr.width - tip.offsetWidth - 8))}px ${r.bottom - pr.top + 6}px`;
  };
  const unpreview = () => { shown = null; tip.hidden = true; drawStats(); };
  grid.addEventListener('pointerover', e => { const el = e.target.closest('.perk');
    if (e.pointerType === 'mouse' && !editing && el !== shown) el ? preview(el) : unpreview(); });
  grid.addEventListener('pointerleave', unpreview);
  // keyboard focus only: a tap focuses the perk too, and on a phone the card would cover the details box that already shows it
  grid.addEventListener('focusin', e => { const el = e.target.closest('.perk'); if (el && !editing && el.matches(':focus-visible')) preview(el); });
  grid.addEventListener('focusout', unpreview);
  const pickAll = els => { picked.clear(); grid.querySelectorAll('.perk.sel').forEach(x => { x.classList.remove('sel'); x.removeAttribute('aria-pressed'); });
    els.forEach(x => { picked.set(x.dataset.ci, +x.dataset.h); x.classList.add('sel'); x.setAttribute('aria-pressed', 'true'); }); drawStats(); };
  $app.querySelector('#curated')?.addEventListener('click', () => pickAll([...grid.querySelectorAll('.perk.cur')]));
  $app.querySelector('#clearroll').addEventListener('click', () => pickAll([]));

  wireFarmButton();
  if (Bungie.token()) showCopies(d, w, er, mw.p.filter(h => godNames.has(d.plugs[h].n)).map(h => d.plugs[h].n), goal);  // runs alongside the slower sheet lookups below

  // Community sheet rows mentioning this weapon by name, or its frame for the same weapon type.
  const frame = w.cols.find(c => c.c === 'Intrinsic Traits');
  const frameName = frame && d.plugs[frame.p[0]]?.n;
  const hits = [...await sheetRows(w.n),
    ...(frameName && w.ti !== 'Exotic' ? await sheetRows(frameName, (t, r) => t.tab === 'Weapons' && r.some(c => c.toLowerCase() === w.ty.toLowerCase())) : [])];
  document.getElementById('farmsrc').innerHTML = await sourcesHtml(w, await wikiData()) || 'Unknown';
  document.getElementById('sheetsrc').innerHTML = hits.length ? rowTable(hits) : 'Not mentioned in the community sheets.';
}

// Copies of this weapon (any version) beside the perk grid. Hovering or tapping one lights up its perks in the grid:
// filled = on this copy, dashed outline = a recommended perk it's missing.
async function showCopies(d, w, er, mwPicks, goal) {  // goal(): the selected build roll, or null
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
      // the perk showing in each column, as icons
      const shown = traitCols.map(ns => [...i.socketed].map(h => d.plugs[h]).find(p => p && ns.has(p.n))).filter(Boolean);
      return { i, n, missing, fit: rollFit(d, er, i.plugs), shown };
    });
    if (!mine.length) { box.innerHTML = '<h3>Your copies</h3><p class="muted">You don\'t own this weapon.</p>'; return; }
    let pinned = null;
    const render = () => {
      const g = goal();
      mine.forEach(c => { c.gfit = g && rollFit(d, g, c.i.plugs); });
      mine.sort((a, b) => gradeRank(a.gfit) - gradeRank(b.gfit) || gradeRank(a.fit) - gradeRank(b.fit) || a.missing.length - b.missing.length);
      pinned = null;
      box.innerHTML = `<h3>Your copies <span class="count">${mine.length}</span></h3>${mine.map((c, k) => `<button type="button" class="copy" data-k="${k}" aria-pressed="false">
        <span class="where">${c.gfit ? rollPips(c.gfit) : ''}${rollPips(c.fit)}${esc(c.i.location)}${c.i.power ? ` · ${c.i.power}` : ''}${c.i.itemHash !== w.h ? ' · other version' : ''}</span>
        <span class="minis">${c.shown.map(p => `<img src="${BNET}${p.i}" alt="${esc(p.n)}" title="${esc(p.n)}">`).join('')}</span>
        ${er?.p ? `<small class="${c.missing.length ? 'miss' : 'full'}">${c.missing.length ? 'Missing: ' + esc(c.missing.join(', ')) : 'Has every recommended pick'}</small>` : ''}</button>`).join('')}
        <p class="muted hint">Hover or tap a copy to see its perks in the grid. A dashed outline is a recommended perk it doesn't have.</p>${er?.p || g ? `<p class="hint">${rollLegend}</p>` : ''}`;
    };
    render();
    box.addEventListener('goal', render);
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
// a build's top two stats by name; DIM keeps statConstraints in the order the build ranks them
const buildTop = (a, loadout) => (loadout.parameters?.statConstraints || []).map(c => a.stats[c.statHash]).filter(Boolean).slice(0, 2);
// Armor 3.0 rolls a primary, a secondary and a third stat, so a copy fits a build when the build's top two are among its three highest.
// No archetype covers every pair (none has Weapons + Health), which is why this reads stats rather than archetypes.
const topStats = (a, item) => Object.keys(a.stats).sort((x, y) => (item.stats[y] || 0) - (item.stats[x] || 0)).slice(0, 3).map(h => a.stats[h]);
const fitsBuild = (a, item, top) => statTotal(a, item) > 0 && top.every(st => topStats(a, item).includes(st));
const minOf = c => c.minStat ?? (c.minTier ? c.minTier * 10 : 0);
// The best armor you own for a build: one piece per slot for its class, the build's exotic (else legendaries only), keeping the
// sets the build counts on. Best means fewest missing set pieces, then least short of the minimums, then the most of each stat
// weighted by priority (the first counts most).
function bestArmor(a, items, cls, loadout) {
  const P = loadout.parameters || {}, ranked = (P.statConstraints || []).filter(c => a.stats[c.statHash]);
  if (!ranked.length) return null;
  const weight = Object.fromEntries(ranked.map((c, k) => [c.statHash, ranked.length - k])), mins = ranked.map(minOf);
  const value = i => ranked.reduce((n, c) => n + weight[c.statHash] * (i.stats[c.statHash] || 0), 0);
  const build = [...loadout.equipped, ...(loadout.unequipped || [])].map(it => a.byHash[it.hash]).filter(Boolean);
  const exotic = build.find(x => x.ti === 'Exotic') || a.byHash[P.exoticArmorHash];
  // sets the build counts on: its setBonuses, or 2 or 4 of its own pieces from one set
  const sets = { ...Object.fromEntries(Object.entries(Object.groupBy(build.filter(x => x.set), x => x.set)).filter(([, l]) => l.length >= 2).map(([h, l]) => [h, l.length >= 4 ? 4 : 2])),
    ...P.setBonuses };
  const setKeys = Object.keys(sets);
  const mine = items.filter(i => !i.postmaster && a.byHash[i.itemHash]?.cl === cls);
  const haveExotic = exotic && mine.some(i => a.byHash[i.itemHash].n === exotic.n);
  const lists = Object.entries(Object.groupBy(mine, i => a.byHash[i.itemHash].ty)).map(([ty, list]) => {
    const allowed = haveExotic && ty === exotic.ty ? list.filter(i => a.byHash[i.itemHash].n === exotic.n) : list.filter(i => a.byHash[i.itemHash].ti !== 'Exotic');
    const top = (l, by, n) => [...l].sort((x, y) => by(y) - by(x)).slice(0, n);
    // shortcut: tries each slot's 12 strongest copies (for each set, each minimum, then overall) rather than every copy; widen if it misses combos
    return [...new Set([...setKeys.flatMap(h => top(allowed.filter(i => a.byHash[i.itemHash].set === h), value, 2)),
      ...ranked.filter(minOf).flatMap(c => top(allowed, i => i.stats[c.statHash] || 0, 2)), ...top(allowed, value, 12)])].slice(0, 12)
      .map(i => ({ i, s: ranked.map(c => i.stats[c.statHash] || 0), v: value(i), set: a.byHash[i.itemHash].set }));
  }).filter(l => l.length);
  const tot = ranked.map(() => 0), cnt = Object.fromEntries(setKeys.map(h => [h, 0])), picked = [];
  let best = null, val = 0;
  const walk = k => {
    if (k === lists.length) {
      const sets_ = setKeys.reduce((n, h) => n + Math.max(0, sets[h] - cnt[h]), 0), short = mins.reduce((n, m, j) => n + Math.max(0, m - tot[j]), 0);
      if (!best || sets_ < best.sets_ || sets_ === best.sets_ && (short < best.short || short === best.short && val > best.val)) best = { sets_, short, val, pieces: picked.map(x => x.i) };
      return;
    }
    for (const x of lists[k]) {
      picked.push(x); x.s.forEach((n, j) => { tot[j] += n; }); val += x.v; if (x.set in cnt) cnt[x.set]++;
      walk(k + 1);
      picked.pop(); x.s.forEach((n, j) => { tot[j] -= n; }); val -= x.v; if (x.set in cnt) cnt[x.set]--;
    }
  };
  walk(0);
  if (!best) return null;
  const totals = Object.fromEntries(ranked.map(c => [c.statHash, best.pieces.reduce((n, i) => n + (i.stats[c.statHash] || 0), 0)]));
  return { pieces: best.pieces, totals, short: best.short, missingSets: setKeys.filter(h => best.pieces.filter(i => a.byHash[i.itemHash].set === h).length < sets[h]),
    exotic, haveExotic, slots: lists.length };
}
async function armorSource(a, x) {
  const monu = await monumentSources(), set = a.sets[x.set];
  return monu.get(x.n.toLowerCase()) || (set && monu.get(`${set.n} armor`.toLowerCase())) || [bungieSource(x)].filter(Boolean);
}
const setBonus = set => set.perks.map(([n, name, desc, ic]) => `<div class="bonus">${ic ? `<img src="${BNET}${ic}" alt="">` : ''}<div><b>${n}-piece: ${esc(name)}</b><br><span class="muted">${esc(desc)}</span></div></div>`).join('');

// Bungie's own class logos (the Hunter, Titan and Warlock nodes in Collections): white on transparent
const CLASS_LOGOS = { Hunter: '/common/destiny2_content/icons/05e32a388d9a65a0ef59b2193eee2db4.png',
  Titan: '/common/destiny2_content/icons/46a19ddd00d0f6ca822230943103b54a.png', Warlock: '/common/destiny2_content/icons/e4006d9a8fe167bd7e83193d7601c89a.png' };
// Both armor lists (the Armor page and My gear's Armor tab) pick a class with the logos and list armor in a section per class: with no
// class picked, every class with its first `cap` pieces and a "Show all"; with one picked, just that class, up to `full`.
const classPick = cl => `<div class="classpick" role="group" aria-label="Class">${Object.entries(CLASS_LOGOS).map(([c, i]) =>
  `<button type="button" data-cl="${c}" aria-pressed="${c === cl}" aria-label="${c}" data-tip="${c}"><img src="${BNET}${i}" alt=""></button>`).join('')}</div>`;
const classSections = (cl, items, cardOf, cap = 48, full = 400) => Object.keys(CLASS_LOGOS).filter(c => !cl || c === cl).map(c => {
  const mine = items.filter(o => o.x.cl === c), n = cl ? full : cap; if (!mine.length) return '';
  return `<section class="classgroup"><h2 class="classhead"><img src="${BNET}${CLASS_LOGOS[c]}" alt="">${c} <span class="count">${mine.length}</span></h2>
    <div class="grid">${mine.slice(0, n).map(cardOf).join('')}</div>
    ${mine.length > n && !cl ? `<button type="button" class="showall" data-cl="${c}">Show all ${mine.length} ${c} pieces</button>` : ''}</section>`;
}).join('');
// a logo picks that class (again shows every class); "Show all" picks its class and goes back up to the filters
const wireClassPick = (get, set) => {
  const pick = e => {
    const b = e.target.closest('[data-cl]'); if (!b) return;
    const cl = b.classList.contains('showall') || get() !== b.dataset.cl ? b.dataset.cl : '';
    $app.querySelectorAll('.classpick button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.cl === cl)));
    set(cl);
    if (b.classList.contains('showall')) $app.querySelector('.filters').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  [$app.querySelector('.classpick'), $app.querySelector('#list')].forEach(el => el.addEventListener('click', pick));
};

async function armorList(params) {
  const a = await armorData();
  const uniq = k => [...new Set(a.armor.map(x => x[k]).filter(Boolean))].sort();
  const sets = Object.entries(a.sets).map(([h, st]) => [h, st.n]).sort((x, y) => x[1].localeCompare(y[1]));
  let cl = CLASS_LOGOS[params.get('cl')] ? params.get('cl') : '';
  $app.innerHTML = `<h1>Armor</h1><p class="muted">Every armor piece, with set bonuses, archetypes, exotic perks and where it drops.</p><div class="filters">
    <input type="search" id="q" aria-label="Search armor" placeholder="Search armor, sets or exotic perks" value="${esc(params.get('q') || '')}">
    ${classPick(cl)}${select('ty', 'All slots', uniq('ty'))}${select('ti', 'All rarities', uniq('ti'))}${select('set', 'All sets', sets, params.get('set') || '')}
    <label class="check"><input type="checkbox" id="cur" checked> Current armor only</label></div><p id="count" class="muted"></p><div id="list"></div>`;
  const f = id => $app.querySelector('#' + id);
  const pieceCard = ({ x, count }) => card(x, `<small>${esc(slotLabel(x))}${x.ex ? ` · ${esc(x.ex[0])}` : ''}</small>
      <small>${esc(a.sets[x.set]?.n || bungieSource(x))}${count > 1 ? ` · ${count} versions` : ''}</small>`, 'armor');
  const draw = () => {
    const q = f('q').value.trim().toLowerCase();
    const list = a.armor.filter(x => (!q || x.n.toLowerCase().includes(q) || a.sets[x.set]?.n.toLowerCase().includes(q) || x.ex?.[0].toLowerCase().includes(q))
      && (!cl || x.cl === cl) && ['ty', 'ti', 'set'].every(k => !f(k).value || x[k] === f(k).value) && (!f('cur').checked || x.a3));
    // older copies of a piece share its name; list each name once and link the rest from its page
    const byName = new Map();
    list.forEach(x => byName.has(x.n + x.cl) ? byName.get(x.n + x.cl).count++ : byName.set(x.n + x.cl, { x, count: 1 }));
    const names = [...byName.values()];
    f('count').textContent = plural(names.length, 'piece');
    f('list').innerHTML = classSections(cl, names, pieceCard)
      || '<p class="empty">No armor matches. Try a shorter search, clear a filter, or untick "Current armor only".</p>';
  };
  $app.querySelectorAll('input,select').forEach(el => el.addEventListener('input', draw));
  wireClassPick(() => cl, v => { cl = v; draw(); });
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

// Transfer is My gear's first tab and what it opens to; #/inventory/move still works for older links
const gearTabs = on => `<div class="tabs gear">${[['', 'Transfer'], ['/weapons', 'Weapons'], ['/armor', 'Armor']].map(([path, label]) => `<a href="#/inventory${path}"${label === on ? ' class="on" aria-current="page"' : ''}>${label}</a>`).join('')}</div>`;

async function inventory(tab) {
  if (!tab || tab === 'move') return transferPage();
  if (tab === 'armor') return armorInventory();
  const d = await data();
  const p = await needProfile(); if (!p) return;
  const owned = p.items.filter(i => d.byHash[i.itemHash]);
  const byWeapon = Object.groupBy(owned, i => i.itemHash);
  const rows = Object.entries(byWeapon).map(([h, list]) => {
    const w = d.byHash[h], r = d.rolls[h];
    const fits = list.map(i => rollFit(d, r, i.plugs));
    return { w, r, list, best: bestFit(fits), god: fits.filter(isGod).length, hasRolls: !!r?.c?.length };
  }).sort((a, b) => gradeRank(a.best) - gradeRank(b.best) || tierOrder(a.r) - tierOrder(b.r) || a.w.n.localeCompare(b.w.n));
  $app.innerHTML = `<h1>My gear</h1>${gearTabs('Weapons')}<p class="muted">${plural(owned.length, 'weapon')}, ${plural(rows.reduce((s, r) => s + r.god, 0), 'god roll')}, ${plural(rows.filter(r => r.list.length > 1).length, 'weapon')} with duplicates.</p>
    <div class="filters"><input type="search" id="q" aria-label="Filter your weapons" placeholder="Filter by name"><select id="show" aria-label="Show"><option value="">Everything</option><option value="god">God rolls</option><option value="nogod">Has a god roll I don't own yet</option><option value="dupe">Duplicates</option></select></div>
    <p>${rollLegend}</p><div class="grid" id="list"></div>`;
  const draw = () => {
    const q = $app.querySelector('#q').value.toLowerCase(), show = $app.querySelector('#show').value;
    $app.querySelector('#list').innerHTML = rows.filter(r => r.w.n.toLowerCase().includes(q) &&
        (!show || show === 'god' && r.god || show === 'nogod' && r.hasRolls && !r.god || show === 'dupe' && r.list.length > 1))
      .map(r => card(r.w, `<small>${tierBadge(r.r)}${esc(r.w.ty)} · owned ×${r.list.length}</small>
        <small>${rollPips(r.best)}${r.god > 1 ? ` · ${r.god} god rolls` : ''}</small>`)).join('')
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
    ${classPick('')}${select('ty', 'All slots', uniq(o => o.x.ty))}${select('arch', 'All archetypes', uniq(o => o.arch))}
    <select id="sort" aria-label="Sort"><option value="tier">Best tier first</option><option value="total">Highest stats first</option><option value="name">Name</option></select></div>
    <div id="list"></div>`;
  const f = id => $app.querySelector('#' + id);
  let cl = '';
  const draw = () => {
    const q = f('q').value.toLowerCase(), by = f('sort').value;
    const list = owned.filter(o => (!q || o.x.n.toLowerCase().includes(q) || a.sets[o.x.set]?.n.toLowerCase().includes(q))
        && (!cl || o.x.cl === cl) && (!f('ty').value || o.x.ty === f('ty').value) && (!f('arch').value || o.arch === f('arch').value))
      .sort((m, n) => by === 'name' ? m.x.n.localeCompare(n.x.n) : by === 'total' ? n.total - m.total : n.i.tier - m.i.tier || n.total - m.total);
    f('list').innerHTML = classSections(cl, list, ({ i, x, total, arch }) => card(x, `<small>${esc(slotLabel(x))}${a.sets[x.set] ? ` · ${esc(a.sets[x.set].n)}` : ''}</small>
      <small>${i.tier ? `<span class="badge${i.tier === 5 ? ' good' : ''}">Tier ${i.tier}</span>` : ''}${arch ? `<span class="badge">${esc(arch)}</span>` : ''}${total} total</small>`, 'armor'), 48, Infinity)
      || '<p class="empty">Nothing matches this filter.</p>';
  };
  $app.querySelectorAll('input,select').forEach(el => el.addEventListener('input', draw));
  wireClassPick(() => cl, v => { cl = v; draw(); });
  draw();
}

// DIM-style mover: one row per gear slot, a column per character (equipped item first) and the vault; pick an item, then send it somewhere,
// or drag it there. Equipping happens in game.
async function transferPage() {
  const [d, a] = await Promise.all([data(), armorData()]);
  const p = await needProfile(); if (!p) return;
  const def = i => d.byHash[i.itemHash] || a.byHash[i.itemHash];
  // class items are typed "Hunter Cloak", "Titan Mark" and "Warlock Bond"; they share one row
  const slotOf = i => d.byHash[i.itemHash]?.sl || (x => x && (x.ty.startsWith(x.cl) ? 'Class item' : x.ty))(a.byHash[i.itemHash]);
  const weaponSlots = ['Kinetic', 'Energy', 'Power'], armorSlots = ['Helmet', 'Gauntlets', 'Chest Armor', 'Leg Armor', 'Class item'];
  const order = (m, n) => n.equipped - m.equipped || def(m).n.localeCompare(def(n).n);
  const narrow = matchMedia('(max-width: 720px)');
  let sel = null, busy = false, msg = '', open = false, view = p.chars[0]?.id;  // view: the one character shown on phones; open: details shown
  // items marked to dismantle (Bungie's API can't dismantle, so it's a reminder for in game); kept in this browser by instance id, and
  // anything no longer on the account (dismantled already) drops off
  let junk = new Set((Bungie.store.get('d2c_junk') || []).filter(id => p.items.some(i => i.instanceId === id))), junkOnly = false;
  const saveJunk = () => Bungie.store.set('d2c_junk', [...junk]);
  saveJunk();
  // this copy's details: a weapon's grade against the tier list, power and the perk in each column; armor's tier, archetype and stats
  const details = i => { const w = d.byHash[i.itemHash];
    if (!w) return `${armorCopy(a, i)}<a href="#/armor/${i.itemHash}">Armor page</a>`;
    // frame and perk columns, plus the masterwork from the mod sockets (the rest there is mementos, deepsight and level-ups)
    const perks = w.cols.flatMap(c => c.p.filter(h => i.socketed.has(h) && d.plugs[h]).slice(0, 1).map(h => ({ pl: d.plugs[h], mod: c.c === 'Weapon Mods' })))
      .filter(x => !/^Empty /.test(x.pl.n) && (!x.mod || /^Masterworked: /.test(x.pl.n))).map(x => x.pl);
    return `<div class="roll">${tierBadge(d.rolls[w.h])}${rollPips(rollFit(d, d.rolls[w.h], i.plugs))}${esc(w.ty)}${i.power ? ` · Power ${i.power}` : ''}
      <ul class="dperks">${perks.map(pl => `<li>${pl.i ? `<img src="${BNET}${pl.i}" alt="">` : ''}${esc(pl.n)}</li>`).join('')}</ul></div><a href="#/weapon/${w.h}">Weapon page</a>`; };
  $app.innerHTML = `<h1>My gear</h1>${gearTabs('Transfer')}<p class="muted">Drag an item to another character or the vault, or onto a character's equipped item (gold border) to equip it there. You can also pick an item, then choose where it goes. Pull gear out of the Postmaster the same way. Moves happen in the game straight away.</p>
    <div class="filters"><input type="search" id="q" aria-label="Find an item" placeholder="Find an item">${select('kind', 'Weapons and armor', [['w', 'Weapons'], ['a', 'Armor']])}
    <button type="button" id="junkonly" aria-pressed="false"></button><button type="button" id="reload">Reload from Bungie</button></div><div id="places"></div><div id="actions" class="actionbar" aria-live="polite" hidden></div>`;
  const f = id => $app.querySelector('#' + id);
  const tile = i => `<button type="button" class="tile${i.equipped ? ' equipped' : ''}${junk.has(i.instanceId) ? ' junk' : ''}${sel === i ? ' sel' : ''}" data-id="${i.instanceId}" title="${esc(def(i).n)}${junk.has(i.instanceId) ? ' (marked to dismantle)' : ''}" aria-label="${esc(def(i).n)}${i.equipped ? ', equipped' : ''}${junk.has(i.instanceId) ? ', marked to dismantle' : ''}">${icon(def(i))}</button>`;
  const cell = (list, owner, slot) => `<div class="cell" data-owner="${owner}" data-slot="${esc(slot)}">${list.sort(order).map(tile).join('')}</div>`;
  const draw = () => {
    const q = f('q').value.trim().toLowerCase(), kind = f('kind').value;
    const items = p.items.filter(i => def(i) && (!kind || (kind === 'w') === !!d.byHash[i.itemHash]) && (!q || def(i).n.toLowerCase().includes(q)) && (!junkOnly || junk.has(i.instanceId)));
    f('junkonly').textContent = `Marked to dismantle (${junk.size})`; f('junkonly').setAttribute('aria-pressed', junkOnly);
    const chars = narrow.matches ? p.chars.filter(c => c.id === view) : p.chars;
    const slots = [...(kind !== 'a' ? weaponSlots : []), ...(kind !== 'w' ? armorSlots : [])];
    const vault = items.filter(i => !i.owner);
    // each character's Postmaster sits above its gear; the count is every slot in use, engrams and materials included
    const pm = c => { const used = p.postmasterUsed?.[c.id] || 0;
      return `<div class="cell pm" data-owner="${c.id}" data-slot="Postmaster"><small class="pmcount${used >= 18 ? ' full' : ''}" title="Postmaster slots in use, counting engrams and materials not shown here">${used} of 21</small>${items.filter(i => i.owner === c.id && i.postmaster).sort(order).map(tile).join('')}</div>`; };
    f('places').innerHTML = `${narrow.matches ? `<div class="tabs charpick">${p.chars.map(c => `<button type="button" data-view="${c.id}"${c.id === view ? ' class="on" aria-pressed="true"' : ''}>${esc(c.cls)}</button>`).join('')}</div>` : ''}
      <div class="loadout" style="--chars:${chars.length}"><div></div>
        ${chars.map(c => `<div class="charhead" style="background-image:url('${c.emblem ? BNET + c.emblem : ''}')"><b>${esc(c.cls)}</b>${c.light ? `<span>${c.light}</span>` : ''}</div>`).join('')}
        <div class="charhead vault"><b>Vault</b><span>${vault.length}</span></div>
        <div class="slotname">Postmaster</div>${chars.map(pm).join('')}<div class="cell pm"></div>
        ${slots.map(slot => `<div class="slotname">${slot}</div>${chars.map(c => cell(items.filter(i => i.owner === c.id && !i.postmaster && slotOf(i) === slot), c.id, slot)).join('')}
          ${cell(vault.filter(i => slotOf(i) === slot), 'vault', slot)}`).join('')}
      </div>`;
    drawBar();
  };
  // the action bar redraws on its own so picking an item doesn't rebuild every icon in the grid
  const drawBar = () => {
    const bar = f('actions');
    bar.hidden = !sel; bar.classList.toggle('busy', busy);
    if (!sel) return;
    const cls = a.byHash[sel.itemHash]?.cl;  // class armor can only go to that class
    const targets = p.chars.filter(c => !cls || c.cls === cls);
    const stuck = sel.equipped ? 'Equipped items can\'t be moved. Equip something else in that slot in game first.'
      : !sel.postmaster && !targets.length ? `Only a ${cls} can hold this, and there's no ${cls} on this account.` : '';
    const btn = (attr, label) => `<button type="button" ${attr}${busy || stuck ? ' disabled' : ''}>${esc(label)}</button>`;
    // a Postmaster item can only be pulled to the character whose Postmaster it's in; after that it moves like anything else
    const acts = sel.postmaster ? btn('data-pull class="primary"', `Pull to ${p.chars.find(c => c.id === sel.owner)?.cls}`)
      : `${sel.owner ? btn('data-move="vault"', 'To Vault') : ''}${targets.filter(c => c.id !== sel.owner).map(c => btn(`data-move="${c.id}"`, `To ${c.cls}`)).join('')}`;
    bar.innerHTML = `${open ? `<div class="details">${details(sel)}</div>` : ''}${icon(def(sel))}<div class="what"><b>${esc(def(sel).n)}</b><small>${esc(sel.location)}</small><small class="${/^(Done|Moving|Pulling|Equipping)/.test(msg) ? '' : 'err'}">${esc(stuck || msg)}</small></div>
      <div class="acts">${acts}<button type="button" data-junk>${junk.has(sel.instanceId) ? 'Unmark dismantle' : 'Mark to dismantle'}</button><button type="button" data-details aria-expanded="${open}">${open ? 'Hide details' : 'Full details'}</button><button type="button" data-close>Close</button></div>`;
  };
  // After a move, pull or equip, every tile that changed place flies from where it was to where it landed (growing or shrinking as it
  // takes or leaves an equipped slot), and the item you moved lands with a ring. Reduced motion skips both; the item stays selected where it landed.
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const places = () => new Map([...f('places').querySelectorAll('.tile[data-id]')].map(t => [t.dataset.id, t.getBoundingClientRect()]));
  const fly = (from, id) => {
    if (!still.matches) f('places').querySelectorAll('.tile[data-id]').forEach(t => {
      const b = from.get(t.dataset.id), a = t.getBoundingClientRect(); if (!b) return;
      const dx = b.left - a.left, dy = b.top - a.top, s = b.width / a.width;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(s - 1) < .01) return;
      t.style.transformOrigin = '0 0'; t.classList.add('flying');
      t.animate([{ translate: `${dx}px ${dy}px`, scale: `${s}` }, { translate: '0 0', scale: '1' }], { duration: 460, easing: 'cubic-bezier(.16, 1, .3, 1)' })
        .finished.then(() => { t.style.transformOrigin = ''; t.classList.remove('flying'); }, () => {});
    });
    f('places').querySelector(`.tile[data-id="${id}"]`)?.classList.add('landed');
  };
  const run = async (label, fn) => {
    const it = sel, from = places(); let ok = false;
    busy = true; msg = label; drawBar();
    try { await fn(); msg = 'Done.'; ok = true; } catch (e) { msg = e.message; }
    busy = false; draw();
    if (ok) fly(from, it.instanceId);
  };
  f('places').addEventListener('click', e => {
    const v = e.target.closest('[data-view]');
    if (v) { view = v.dataset.view; draw(); return; }
    const t = e.target.closest('.tile'); if (!t || dragged) return;  // the click that ends a drag isn't a pick
    sel = p.items.find(i => i.instanceId === t.dataset.id); msg = '';
    f('places').querySelectorAll('.tile.sel').forEach(x => x.classList.remove('sel')); t.classList.add('sel'); drawBar();
  });
  const act = (it, to) => run(`Moving to ${p.chars.find(c => c.id === to)?.cls || 'Vault'}…`, () => Bungie.move(p, it, to));
  const pull = it => run(`Pulling to ${p.chars.find(c => c.id === it.owner)?.cls}…`, () => Bungie.pull(p, it));
  // only by drag: out of the Postmaster or over from wherever it is, then equipped in place of what that character had on
  const equip = (it, to) => run(`Equipping on ${p.chars.find(c => c.id === to)?.cls}…`, async () => {
    if (it.postmaster) await Bungie.pull(p, it);
    await Bungie.move(p, it, to);
    const old = p.items.filter(i => i !== it && i.owner === to && i.equipped && slotOf(i) === slotOf(it));
    await Bungie.equip(p, it);
    old.forEach(i => { i.equipped = false; Bungie.locate(p, i); });
  });
  f('actions').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    if (b.hasAttribute('data-close')) { sel = null; f('places').querySelector('.tile.sel')?.classList.remove('sel'); drawBar(); return; }
    if (b.hasAttribute('data-details')) { open = !open; drawBar(); return; }
    if (b.hasAttribute('data-junk')) {
      const id = sel.instanceId, marking = !junk.has(id);
      marking ? junk.add(id) : junk.delete(id); saveJunk(); msg = ''; draw();
      if (marking) f('places').querySelector(`.tile[data-id="${id}"]`)?.classList.add('justmarked');  // the badge pops in on this one only
      return;
    }
    if (b.dataset.move) act(sel, b.dataset.move);
    else if (b.hasAttribute('data-pull')) pull(sel);
  });
  // Drag and drop: onto another cell in the item's row to move it there, onto a character's equipped item in that row to equip it there,
  // or a Postmaster item onto its own character's row to pull it. Touch needs a long press first, so a swipe still scrolls the page.
  // Dropping shows the move in the action bar like the buttons do.
  let drag = null, dragged = false;
  const blocked = (it, to) => { const cls = a.byHash[it.itemHash]?.cl, c = p.chars.find(x => x.id === to);
    return it.postmaster ? (to === it.owner ? '' : `Pull this to your ${p.chars.find(x => x.id === it.owner)?.cls} first.`)
      : it.equipped ? 'Equipped items can\'t be moved. Equip something else in that slot in game first.'
      : c && cls && c.cls !== cls ? `Only a ${cls} can hold this.` : ''; };
  const targetAt = (x, y) => { const el = document.elementFromPoint(x, y), cell = el?.closest('#places .cell[data-slot]');
    if (!cell || cell.dataset.slot !== slotOf(drag.it)) return null;
    const to = cell.dataset.owner, equip = to !== 'vault' && !!el.closest('.tile.equipped') && !drag.it.equipped;
    return to === drag.it.owner && !drag.it.postmaster && !equip ? null : { cell, to, equip };  // dropping where it already is does nothing
  };
  const mark = t => { f('places').querySelectorAll('.drop-ok,.drop-no,.drop-equip').forEach(x => x.classList.remove('drop-ok', 'drop-no', 'drop-equip'));
    if (!t) return;
    const no = blocked(drag.it, t.to); t.cell.classList.add(no ? 'drop-no' : 'drop-ok');
    if (t.equip && !no) t.cell.querySelector('.tile.equipped').classList.add('drop-equip'); };
  const lift = () => { drag.ghost = Object.assign(document.createElement('div'), { className: 'dragghost', innerHTML: icon(def(drag.it)) });
    document.body.append(drag.ghost); drag.tile.classList.add('dragging'); dragged = true; follow(drag); };
  const follow = e => { Object.assign(drag.ghost.style, { left: e.x + 'px', top: e.y + 'px' }); drag.target = targetAt(e.x, e.y); mark(drag.target);
    if (e.y < 90) scrollBy(0, -14); else if (e.y > innerHeight - 90) scrollBy(0, 14); };
  const onMove = e => {
    if (drag.ghost) return follow({ x: e.clientX, y: e.clientY });
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
    if (drag.touch) return end();  // moved before the long press: a scroll
    lift();
  };
  const onUp = () => {
    const { it, target: t, ghost } = drag; end();
    if (!ghost || !t) return;
    sel = it; msg = blocked(it, t.to);
    if (msg) drawBar(); else if (t.equip) equip(it, t.to); else if (it.postmaster) pull(it); else act(it, t.to);
  };
  const end = () => { clearTimeout(drag.timer); drag.ghost?.remove(); drag.tile.classList.remove('dragging'); mark(null); drag = null;
    removeEventListener('pointermove', onMove); removeEventListener('pointerup', onUp); removeEventListener('pointercancel', end);
    setTimeout(() => dragged = false); };
  f('places').addEventListener('pointerdown', e => {
    const t = e.target.closest('.tile'); if (!t || e.button || busy || drag) return;
    drag = { it: p.items.find(i => i.instanceId === t.dataset.id), tile: t, x: e.clientX, y: e.clientY, touch: e.pointerType === 'touch' };
    if (drag.touch) drag.timer = setTimeout(lift, 350);
    addEventListener('pointermove', onMove); addEventListener('pointerup', onUp); addEventListener('pointercancel', end);
  });
  // while dragging on a phone, the finger moves the item, not the page; and a long press shouldn't open the image menu
  f('places').addEventListener('touchmove', e => drag?.ghost && e.preventDefault(), { passive: false });
  f('places').addEventListener('contextmenu', e => e.target.closest('.tile') && e.preventDefault());
  f('places').addEventListener('dragstart', e => e.preventDefault());
  $app.querySelectorAll('.filters input,.filters select').forEach(el => el.addEventListener('input', draw));
  f('junkonly').addEventListener('click', () => { junkOnly = !junkOnly; draw(); });
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

  const [d, a, arts] = await Promise.all([data(), armorData(), load('artifacts')]);
  const P = loadout.parameters ||= {}, items = [...loadout.equipped, ...(loadout.unequipped || [])];
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
  let editStats = false;  // picking stat priorities for a build whose link has none
  let editArt = false, artDraft = null;  // picking the build's artifact and its perks
  // DIM keeps unlocked artifact perks in the build's parameters, or as socket overrides on an artifact in the loadout.
  // A perk can have another hash on another artifact or season, so names match too.
  const isArt = (x, h) => x.h === h || x.n === defs[h]?.n, isPerk = (k, h) => k.h === h || k.n === defs[h]?.n;
  const artItem = items.find(i => arts.some(x => isArt(x, i.hash)));
  const dimPerks = [...new Set([...(P.artifactUnlocks?.unlockedItemHashes || []), ...Object.values(artItem?.socketOverrides || {})])].filter(h => !/^Empty /.test(defs[h]?.n));
  // the build's artifact: picked here (saved with the build), else the one in the loadout or whose perks the DIM link unlocks
  const artOf = () => {
    const own = savedBuilds().find(b => b.key === key)?.artifact;
    if (own) return { ...own, custom: true };
    const best = arts.filter(x => !artItem || isArt(x, artItem.hash)).map(x => ({ h: x.h, perks: x.tiers.flatMap(t => t.perks).filter(k => dimPerks.some(h => isPerk(k, h))).map(k => k.h) }))
      .sort((x, y) => y.perks.length - x.perks.length)[0];
    return artItem || best?.perks.length ? best : null;
  };

  const draw = (p, status = '') => {
    const top = buildTop(a, loadout), custom = !!savedBuilds().find(b => b.key === key)?.customStats;
    const chars = p ? p.chars.filter(c => !cls || c.cls === cls) : [];
    // best copy for a character: this exact version, a god roll, already there, in the vault; never the postmaster
    const fit = i => !!a.byHash[i.itemHash] && top.length > 0 && fitsBuild(a, i, top);
    // a weapon's build roll, from this build as saved (perks picked on the weapon page) or as linked
    const goalOf = it => d.byHash[it.hash] && buildRoll(d, savedBuilds().find(b => b.key === key) || { loadout }, d.byHash[it.hash]);
    const pick = (it, cid) => (p?.items || []).filter(i => !i.postmaster && nameOf(i.itemHash) === nameOf(it.hash))
      .sort((x, y) => (y.itemHash === it.hash) - (x.itemHash === it.hash) || gradeRank(rollFit(d, goalOf(it) || d.rolls[x.itemHash], x.plugs)) - gradeRank(rollFit(d, goalOf(it) || d.rolls[y.itemHash], y.plugs)) || fit(y) - fit(x) || y.tier - x.tier
        || (y.owner === cid) - (x.owner === cid) || !y.owner - !x.owner)[0];
    const owned = it => { const c = pick(it, chars[0]?.id);
      if (!p) return '';
      if (!c) return '<span class="badge">Missing</span>';
      const where = `${esc(c.location)}${c.itemHash !== it.hash ? ' · other version' : ''}`;
      if (d.byHash[it.hash]) { const f = rollFit(d, goalOf(it) || d.rolls[c.itemHash], c.plugs); return f ? `${rollPips(f)}</small><small>${where}` : `<span class="badge good">You have it</span>${where}`; }
      if (!top.length) return `<span class="badge good">You have it</span>${where}`;
      const best = topStats(a, c).map(st => `${st} ${c.stats[Object.keys(a.stats).find(h => a.stats[h] === st)] || 0}`).join(', ');
      return fit(c) ? `<span class="badge good">Fits</span>${esc(best)}</small><small>${where}` : `<span class="badge">Wrong stats</span>Best copy: ${esc(best)}</small><small>${where}`; };
    const piece = it => { const w = d.byHash[it.hash], x = w || a.byHash[it.hash], perks = w ? Object.values(goalOf(it)?.p || {}).flat() : Object.values(it.socketOverrides || {}).map(h => defs[h]?.n).filter(Boolean);
      return card(x, `<small>${w ? tierBadge(d.rolls[w.h]) + esc(w.ty) : esc(slotLabel(x))}${loadout.equipped.includes(it) ? '' : ' · not equipped'}</small>
        ${perks.length ? `<small>${esc(perks.join(', '))}</small>` : ''}<small>${owned(it)}</small>`, w ? 'weapon' : 'armor'); };
    const have = gear.filter(it => pick(it)).length;
    const subParts = Object.entries(Object.groupBy(Object.entries(subclass?.socketOverrides || {}).sort((x, y) => x[0] - y[0]).map(([, h]) => h).filter(h => defs[h] && !/^Empty /.test(defs[h].n)),
      h => /Aspect/.test(defs[h].t) ? 'Aspects' : /Fragment/.test(defs[h].t) ? 'Fragments' : 'Abilities'));
    const best = p && cls ? bestArmor(a, p.items, cls, loadout) : null;
    const art = artOf(), artDef = art && arts.find(x => x.h === art.h);
    const extra = art?.custom ? [] : dimPerks.filter(h => defs[h] && !artDef?.tiers.some(t => t.perks.some(k => isPerk(k, h))));  // DIM perks we can't place on an artifact
    // a tier's slots also take lower-tier perks, so from tier k up you can pick at most the slots of tier k and above
    const artEditor = () => { const cur = arts.find(x => x.h === artDraft.h);
      const tierOf = h => cur.tiers.findIndex(t => t.perks.some(x => x.h === h)), room = k => cur.tiers.slice(k).reduce((n, t) => n + t.slots, 0);
      const fits = sel => cur.tiers.every((_, k) => sel.filter(h => tierOf(h) >= k).length <= room(k));
      return `<div class="goalbar"><label for="artpick">Artifact</label><select id="artpick">${arts.map(x => `<option value="${x.h}"${x.h === cur.h ? ' selected' : ''}>${esc(x.n)}</option>`).join('')}</select></div>
        <p class="muted"><small>Works best with ${esc([...cur.el, ...cur.wp].join(', '))}. ${artDraft.perks.filter(h => tierOf(h) >= 0).length} of ${room(0)} picked:
          at most ${cur.tiers.slice(1).map((t, k) => `${room(k + 1)} from Tier ${k + 2}${k + 2 < cur.tiers.length ? ' and up' : ''}`).reverse().join(', ')}. Hover a perk to read what it does.</small></p>
        ${cur.tiers.map((t, k) => `<div class="eg"><span class="muted">Tier ${k + 1}</span><div class="tabs charpick artpick">${t.perks.map(x => { const on = artDraft.perks.includes(x.h);
            return `<button type="button" data-perk="${x.h}" title="${esc(x.d)}" aria-pressed="${on}"${on ? ' class="on"' : fits([...artDraft.perks, x.h]) ? '' : ' disabled'}>${img(x.i)}${esc(x.n)}</button>`; }).join('')}</div></div>`).join('')}
        <div class="statacts"><button type="button" class="primary" data-art-done>Done</button><button type="button" data-art-clear>Clear</button></div>`; };
    const stats = (P.statConstraints || []).filter(c => a.stats[c.statHash]).map(c => {
      const min = minOf(c), max = c.maxStat ?? (c.maxTier != null && c.maxTier < 10 ? c.maxTier * 10 : null);
      return `<li><b>${esc(a.stats[c.statHash])}</b>${min ? ` ${min}+` : ''}${max != null ? ` up to ${max}` : ''}${best ? ` <span class="${!min || best.totals[c.statHash] >= min ? 'met' : 'short'}">best you own ${best.totals[c.statHash]}</span>` : ''}</li>`; });
    const sets = Object.entries(P.setBonuses || {}).filter(([h]) => a.sets[h]).map(([h, n]) => `<span class="badge">${esc(a.sets[h].n)} · ${n} pieces</span>`);
    box.innerHTML = `<section class="panel buildhead"><h2>${esc(loadout.name || 'Untitled build')}${cls ? ` <span class="count">${cls}</span>` : ''}</h2>
        ${loadout.notes ? `<p class="lore">${esc(loadout.notes)}</p>` : ''}
        <p class="muted">${p ? `You have ${have} of ${gear.length} pieces of gear.` : 'Sign in with Bungie to see which pieces you have and equip them.'}
        <a href="${esc(shareUrl || 'https://app.destinyitemmanager.com/loadouts?' + new URLSearchParams({ loadout: JSON.stringify(loadout) }))}" target="_blank" rel="noopener">Open in DIM</a></p>
        <div class="acts"><button type="button" data-save>${savedBuilds().some(b => b.key === key) ? 'Remove from saved' : 'Save build'}</button><button type="button" data-farmbuild>${inFarm('builds', key) && savedBuilds().some(b => b.key === key) ? 'Stop farming this build' : 'Farm this build'}</button>${chars.map(c => `<button type="button" class="primary" data-equip="${c.id}">Equip on ${esc(c.cls)}</button>`).join('')}</div>
        ${chars.length ? '<p class="muted"><small>Equip moves and equips the weapons and armor you have. Set the subclass and mods in game.</small></p>' : ''}
        ${status ? `<p class="${/^Done/.test(status) ? 'muted' : 'err'}" aria-live="polite">${esc(status)}</p>` : ''}</section>
      ${subclass ? `<section class="panel"><h2>Subclass</h2><p>${chip(subclass.hash)}</p>${subParts.map(([k, hs]) => `<div class="eg"><span class="muted">${k}</span><div class="chips">${hs.map(h => chip(h)).join('')}</div></div>`).join('')}</section>` : ''}
      ${stats.length || custom || gear.some(it => a.byHash[it.hash]) ? `<section class="panel"><h2>Stat priorities${custom ? ' <span class="count">set by you</span>' : ''}</h2>
        ${stats.length ? `<ol class="statrank">${stats.join('')}</ol>` : editStats ? '' : '<p class="muted">This build doesn\'t rank armor stats.</p>'}
        ${editStats ? `<p class="muted"><small>Click stats in priority order. Click a ranked stat to take it out. Give a ranked stat a minimum total to aim for across all your armor.</small></p>
          <div class="tabs charpick statpick">${Object.entries(a.stats).map(([h, n]) => { const k = P.statConstraints.findIndex(c => c.statHash == h);
            return `<button type="button" data-stat="${h}"${k >= 0 ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"'}>${k >= 0 ? `${k + 1}. ` : ''}${esc(n)}</button>`; }).join('')}</div>
          ${P.statConstraints.length ? `<div class="statmins">${P.statConstraints.map(c => `<label>${esc(a.stats[c.statHash])} at least <input type="number" inputmode="numeric" min="0" max="200" step="5" data-min="${c.statHash}" value="${minOf(c) || ''}" placeholder="any"></label>`).join('')}</div>` : ''}
          <div class="statacts"><button type="button" class="primary" data-stats-done>Done</button><button type="button" data-stats-clear>Clear</button></div>`
          : custom || !stats.length ? `<p><button type="button" data-stats-edit>${stats.length ? 'Change stat priorities' : 'Add stat priorities'}</button></p>` : ''}
        ${top.length ? `<p class="muted"><small>An armor piece fits when ${esc(top.join(' and '))} are among its three highest stats.</small></p>` : ''}
        ${best ? `<h3 class="bestarmor">Best armor you own for this build</h3><div class="grid">${best.pieces.map(i => { const x = a.byHash[i.itemHash], arch = archetypeOf(a, i);
            return card(x, `<small>${esc(slotLabel(x))}${i.tier ? ` · Tier ${i.tier}` : ''}${arch ? ` · ${esc(arch.n)}` : ''}</small><small>${esc(topStats(a, i).map(st => `${st} ${i.stats[Object.keys(a.stats).find(h => a.stats[h] === st)] || 0}`).join(', '))}</small><small>${esc(i.location)}</small>`, 'armor'); }).join('')}</div>
          <p class="muted"><small>${[best.short ? `Still ${best.short} short of the minimums with what you own.` : (P.statConstraints || []).some(minOf) ? 'Meets every minimum.' : '',
            best.exotic && !best.haveExotic ? `You don't own ${esc(best.exotic.n)}, so this uses legendaries only.` : '',
            best.missingSets.length ? `Couldn't make the ${best.missingSets.map(h => esc(a.sets[h]?.n || 'set')).join(' and ')} bonus from what you own.` : '',
            best.slots < 5 ? `You own nothing for ${5 - best.slots} slot${best.slots === 4 ? '' : 's'}.` : '',
            'Totals are armor only, before mods and fonts.'].filter(Boolean).join(' ')}</small></p>` : ''}</section>` : ''}
      ${['weapon', 'armor'].map(k => { const list = gear.filter(it => !!d.byHash[it.hash] === (k === 'weapon'));
        return list.length ? `<section class="panel"><h2>${k === 'weapon' ? 'Weapons' : 'Armor'}</h2><div class="grid">${list.map(piece).join('')}</div></section>` : ''; }).join('')}
      ${P.exoticArmorHash && !gear.some(it => it.hash === P.exoticArmorHash) ? `<section class="panel"><h2>Exotic armor</h2><div class="chips">${chip(P.exoticArmorHash)}</div></section>` : ''}
      ${P.mods?.length ? `<section class="panel"><h2>Armor mods</h2><div class="chips">${counted(P.mods)}</div></section>` : ''}
      ${sets.length ? `<section class="panel"><h2>Set bonuses</h2><div class="perks">${sets.join('')}</div></section>` : ''}
      <section class="panel"><h2>Artifact${art?.custom ? ' <span class="count">set by you</span>' : ''}</h2>${editArt ? artEditor() : artDef ? `<div class="arthead">${img(artDef.i)}<div><b>${esc(artDef.n)}</b>
          <div class="perks">${[...artDef.el, ...artDef.wp].map(n => `<span class="badge">${esc(n)}</span>`).join('')}</div></div></div>
        ${artDef.tiers.map((t, k) => { const on = t.perks.filter(x => art.perks.includes(x.h));
          return on.length ? `<div class="eg"><span class="muted">Tier ${k + 1}</span><div class="artperks">${on.map(x => `<div class="bonus">${img(x.i)}<div><b>${esc(x.n)}</b><br><span class="muted">${esc(x.d)}</span></div></div>`).join('')}</div></div>` : ''; }).join('')}`
        : extra.length ? '' : '<p class="muted">This build doesn\'t pick an artifact.</p>'}
        ${extra.length && !editArt ? `<p class="muted">${artDef ? 'DIM also lists these perks, which aren\'t on this artifact:' : 'DIM lists these artifact perks, but they aren\'t on any artifact the site knows:'}</p><div class="chips">${extra.map(h => chip(h)).join('')}</div>` : ''}
        ${editArt ? '' : `<p><button type="button" data-art-edit>${artDef ? 'Change artifact' : 'Pick an artifact'}</button></p>`}</section>`;
    const toggleSave = () => {
      const rest = savedBuilds().filter(b => b.key !== key), adding = rest.length === savedBuilds().length;
      const sub = subclass && defs[subclass.hash];
      Bungie.store.set('d2c_builds', adding ? [{ key, name: loadout.name || 'Untitled build', cls, shareUrl, saved: Date.now(), sub: sub ? { n: sub.n, i: sub.i } : null,
        icons: gear.filter(it => d.byHash[it.hash]).map(it => d.byHash[it.hash].i).slice(0, 3), loadout }, ...rest] : rest);
      if (adding && id === 'link') history.replaceState(null, '', '#/build/' + key);  // so a reload finds it
      bar.innerHTML = savedBar(key);
    };
    box.querySelector('[data-save]').addEventListener('click', () => { toggleSave(); draw(p, status); });
    // your own stat priorities are kept in the saved build's statConstraints, so every page that reads a build's stats uses them
    const saveStats = list => {
      if (!savedBuilds().some(b => b.key === key)) toggleSave();
      P.statConstraints = list;
      Bungie.store.set('d2c_builds', savedBuilds().map(b => b.key === key ? { ...b, loadout, customStats: list.length > 0 } : b));
    };
    box.querySelector('[data-stats-edit]')?.addEventListener('click', () => { P.statConstraints ||= []; editStats = true; draw(p, status); });
    box.querySelectorAll('[data-stat]').forEach(b => b.addEventListener('click', () => {
      const h = +b.dataset.stat, list = P.statConstraints.filter(c => c.statHash != h);
      saveStats(list.length < P.statConstraints.length ? list : [...list, { statHash: h }]);
      draw(p, status);
    }));
    box.querySelectorAll('[data-min]').forEach(el => el.addEventListener('change', () => {
      const n = Math.max(0, Math.min(200, Math.round(+el.value || 0)));
      saveStats(P.statConstraints.map(c => c.statHash == el.dataset.min ? (n ? { statHash: c.statHash, minStat: n } : { statHash: c.statHash }) : c));
      draw(p, status);
    }));
    box.querySelector('[data-stats-done]')?.addEventListener('click', () => { editStats = false; draw(p, status); });
    const saveArt = artifact => {
      if (!savedBuilds().some(b => b.key === key)) toggleSave();
      Bungie.store.set('d2c_builds', savedBuilds().map(b => b.key === key ? { ...b, artifact } : b));
      draw(p, status);
    };
    box.querySelector('[data-art-edit]')?.addEventListener('click', () => { artDraft = art ? { h: art.h, perks: [...art.perks] } : { h: arts[0].h, perks: [] }; editArt = true; draw(p, status); });
    box.querySelector('#artpick')?.addEventListener('change', e => { artDraft = { h: +e.target.value, perks: [] }; saveArt(artDraft); });
    box.querySelectorAll('[data-perk]').forEach(b => b.addEventListener('click', () => {
      const h = +b.dataset.perk;
      artDraft.perks = artDraft.perks.includes(h) ? artDraft.perks.filter(x => x !== h) : [...artDraft.perks, h];
      saveArt({ ...artDraft });
    }));
    box.querySelector('[data-art-done]')?.addEventListener('click', () => { editArt = false; draw(p, status); });
    box.querySelector('[data-art-clear]')?.addEventListener('click', () => { editArt = false; saveArt(null); });
    box.querySelector('[data-stats-clear]')?.addEventListener('click', () => { saveStats([]); draw(p, status); });
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
  const haveGod = new Set((p?.items || []).filter(i => isGod(rollFit(d, d.rolls[i.itemHash], i.plugs))).map(i => nameOf(i.itemHash)));
  const classes = p ? new Set(p.chars.map(c => c.cls)) : null;
  const targets = new Map();
  const add = (x, kind, reason, top = [], broll = null) => {
    const r = kind === 'weapon' ? d.rolls[x.h] : null;
    // weapons with an Endgame Analysis roll are done once you own that roll; anything else once you own it
    const n = kind === 'weapon' ? baseName(x.n) : x.n + x.cl;
    const want = kind === 'armor' && top.length && !(p?.items || []).some(i => nameOf(i.itemHash) === n && fitsBuild(a, i, top)) ? top.join(' + ') : '';
    const bfit = broll && bestFit((p?.items || []).filter(i => nameOf(i.itemHash) === n).map(i => rollFit(d, broll, i.plugs)));
    const need = broll ? (bfit?.grade === 'build' ? '' : 'build roll') : r?.c?.length && !haveGod.has(n) ? 'god roll' : want ? 'stats' : owned.has(n) ? '' : 'item';
    if (!need) return;
    const best = bfit || kind === 'weapon' && r && bestFit((p?.items || []).filter(i => nameOf(i.itemHash) === n).map(i => rollFit(d, d.rolls[i.itemHash] || r, i.plugs)));
    const t = targets.get(n) || targets.set(n, { x, kind, r, need, want, best, owned: owned.has(n), reasons: [] }).get(n);
    t.want ||= want;
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
  const addHash = (h, reason, top, b) => { const w = d.byHash[h], x = w || a.byHash[h]; if (x) add(w ? weaponByName.get(baseName(w.n)) : x, w ? 'weapon' : 'armor', reason, top, w && b && buildRoll(d, b, w)); };
  savedBuilds().filter(b => f.builds.includes(b.key)).forEach(b => [...b.loadout.equipped, ...(b.loadout.unequipped || []), { hash: b.loadout.parameters?.exoticArmorHash }]
    .forEach(it => addHash(it.hash, `Build: ${b.name}`, buildTop(a, b.loadout), b)));
  f.items.forEach(h => addHash(h, 'Added by you'));
  return [...targets.values()];
}

// the week runs from Tuesday's 17:00 UTC reset; Desert Perpetual and Equilibrium are featured every week, so they're folded into each week
function rotationWeeks(rot) {
  const resetDay = new Date(Date.now() - 17 * 3600e3).toISOString().slice(0, 10);
  const weeks = rot.weeks.map(w => ({ ...w, raids: [...w.raids, ...rot.always.raids], dungeons: [...w.dungeons, ...rot.always.dungeons] }));
  return { weeks, cur: weeks.filter(w => w.start <= resetDay).at(-1) || weeks[0] };
}

async function farm() {
  const [d, a, rot] = await Promise.all([data(), armorData(), load('rotation')]);
  const p = Bungie.token() ? await needProfile() : null;
  const { weeks, cur } = rotationWeeks(rot);
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
  let view = 'now', pick = {};  // the open tabs: 'now' (this week) or 'later' (coming up), then { type, act }

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
    const count = acts => [...acts].reduce((n, [, g]) => n + g.items.length, 0);  // a Map or sorted [name, group] pairs
    // the priority farm is this week's best rotating raid or dungeon
    const top = ['Raids', 'Dungeons'].flatMap(k => [...(plans.now.get(k)?.values() || [])]).filter(g => !g.rank).sort((x, y) => score(y) - score(x))[0];
    const [topType, topName] = top ? [...plans.now].flatMap(([k, acts]) => [...acts].map(([n, g]) => [k, n, g])).find(x => x[2] === top) : [];
    const cards = items => `<div class="grid">${items.sort((m, n) => tierOrder(m.r) - tierOrder(n.r)).map(t => card(t.x, `<small>${tierBadge(t.r)}${t.want ? `${t.owned ? 'You have it, but not with' : 'Not owned · want'} ${esc(t.want)}` : t.owned && t.best ? `Your best: ${rollPips(t.best)}` : t.owned ? 'You have it, not the god roll' : 'Not owned'}</small>
      <small>${t.reasons.map(esc).join(' · ')}</small>`, t.kind)).join('')}</div>`;
    const group = ([name, g]) => `<section class="panel${g === top ? ' priority' : ''}"><h2>${g === top ? 'Priority farm: ' : ''}${esc(name)} <span class="count">${g.note}${g.master ? ' · Master available' : ''} · ${plural(g.items.length, 'item')}</span></h2>${cards(g.items)}</section>`;
    const TYPES = ['Raids', 'Dungeons', 'Pantheon', 'Grandmaster', 'PvP'], rankType = k => (TYPES.indexOf(k) + 1 || 9);
    // one tab row per level: This week / Coming up, then activity type, then activity; only the open activity's items show
    const sorted = which => [...plans[which]].sort((x, y) => rankType(x[0]) - rankType(y[0]) || (x[0] === 'Other sources') - (y[0] === 'Other sources') || count(y[1]) - count(x[1]))
      .map(([k, acts]) => [k, [...acts].sort((x, y) => which === 'later' ? x[1].when.localeCompare(y[1].when) || score(y[1]) - score(x[1]) : x[1].rank - y[1].rank || score(y[1]) - score(x[1]))]);
    const tabs = (level, list, on, cls = 'charpick') => `<div class="tabs ${cls} ${level}">${list.map(([k, label]) => `<button type="button" data-${level}="${esc(k)}"${k === on ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"'}>${label}</button>`).join('')}</div>`;
    const total = which => [...plans[which].values()].reduce((n, acts) => n + count(acts), 0);
    const render = () => {
      const types = sorted(view), [k, acts] = types.find(x => x[0] === pick.type) || types[0] || [];
      const g = acts?.find(x => x[0] === pick.act) || acts?.[0];
      pick = { type: k, act: g?.[0] };
      plan.innerHTML = tabs('view', [['now', 'This week'], ['later', 'Coming up']].map(([v, label]) => [v, `${label} · ${total(v)}`]), view)
        + (top ? `<p class="muted farmtop">Priority farm this week: <button type="button" class="linkbtn" data-view="now" data-type="${esc(topType)}" data-act="${esc(topName)}">${esc(topName)}</button>, ${plural(top.items.length, 'item')} you're after${top.master ? ', Master available' : ''}.</p>` : '')
        + (g ? tabs('type', types.map(([t, a]) => [t, `${esc(t)} <span class="count">${count(a)}</span>`]), k, 'typetabs')
          + tabs('act', acts.map(([n, x]) => [n, `${esc(n)} · ${x.items.length}`]), g[0]) + group(g)
          : `<p class="empty">${view === 'later' ? 'Nothing you\'re after is waiting on a future rotation.' : 'Nothing you\'re after drops this week. Check Coming up.'}</p>`);
    };
    plan.onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.view) { view = b.dataset.view; pick = {}; }
      if (b.dataset.type) pick = { type: b.dataset.type };
      if (b.dataset.act) pick.act = b.dataset.act;
      render();
    };
    render();
  };
  const save = (k, v) => { Bungie.store.set('d2c_farm', { ...farmPrefs(), [k]: v }); draw(); };
  $('#tier').addEventListener('change', e => save('tier', e.target.value));
  $('#exoticWeapons').addEventListener('change', e => save('exoticWeapons', e.target.checked));
  $('#exoticArmor').addEventListener('change', e => save('exoticArmor', e.target.checked));
  $app.querySelectorAll('[data-build]').forEach(c => c.addEventListener('change', () => { toggleFarm('builds', c.dataset.build); draw(); }));
  $app.querySelectorAll('[data-set]').forEach(c => c.addEventListener('change', () => { toggleFarm('sets', c.dataset.set); draw(); }));
  await draw();
}

// The sheet tabs worth reading on their own, by topic. Landing pages, link lists, empty tabs and raw graph data are left out, and so are
// loot sources, the weekly reset, set bonuses and artifact perks, which Weapons, Farming, Armor sets and Builds already show.
const REF_TOPICS = {
  Weapons: { 'Weapon Perks': 'Weapon perks', 'Exotic Weapons': 'Exotic weapons' },
  Armor: { 'Armor Mods': 'Armor mods', 'Exotic Armors': 'Exotic armor', 'Exotic Class': 'Exotic class items', 'Armor Archetypes': 'Armor archetypes' },
  Subclasses: { Arc: 'Arc', Solar: 'Solar', Void: 'Void', Stasis: 'Stasis', Strand: 'Strand', Prismatic: 'Prismatic', 'Class Abilities': 'Class abilities' },
  Damage: { 'STACKING GUIDE': 'Damage stacking', Weapons: 'Weapon damage', Abilties: 'Ability damage', Sustained: 'Sustained damage', Swap: 'Swap damage', Bosses: 'Boss health' },
  Mechanics: { 'Game Mechanics': 'Game mechanics', 'CHAMP COUNTERS LIST': 'Champion counters' },
};
// sheet navigation and promo cells, image-only columns, stray one-letter cells, and whole-page dumps from merged cells
const junkCell = c => /^(go back to the top!?|support the data compendium|click here (to|for)\b[\s\S]*|↺ return to orbit|llama's (youtube|twitch|discord)|icon|🖼️|[-–])$/i.test(c.trim())
  || /^(like these guides|patreon|court's\s+(website|discord)|questions\? want to use|find this and other|spreadsheet made by|check out llama|sourced via)/i.test(c.trim()) || /^[a-z]$/.test(c.trim()) || c.length > 3000;
// Game Mechanics opens with a banner of merged intro text that reads as nonsense once flattened
const REF_BANNER = new Set(['Game Mechanics']);
// laid out as infographics, so they only make sense in the original sheet
const REF_EXTERNAL = new Set(['STACKING GUIDE', 'CHAMP COUNTERS LIST']);
// whole numbers lose the sheet's ".0", long decimals keep two places
const tidyCell = c => junkCell(c) ? '' : c.replace(/^(-?\d+)\.0+$/, '$1').replace(/^-?\d+\.\d{4,}$/, n => (+n).toFixed(2));
const refRows = new Map();
function cleanRows(t) {
  if (refRows.has(t)) return refRows.get(t);
  const rows = t.rows.slice(REF_BANNER.has(t.tab) ? 1 : 0).map(r => r.map(tidyCell)).filter(r => r.some(Boolean));
  // a column with nothing below the title rows is a section link or a lost image, not data
  const body = rows.length > 3 ? rows.slice(3) : rows, cols = [...Array(Math.max(0, ...rows.map(r => r.length))).keys()].filter(i => body.some(r => r[i]));
  const out = rows.map(r => cols.map(i => r[i] || ''));
  refRows.set(t, out);
  return out;
}
// Each tab reads as entries (a name, what it does, a few facts) under headings, or as a data table for the number-heavy sheets.
const REF_TABLES = new Set(['Weapons', 'Abilties', 'Sustained', 'Swap', 'Bosses', 'Armor Archetypes', 'Game Mechanics']);
// sheets set side by side as name/effect column pairs; a name with no effect is a heading, or on exotic armor the perk of the piece above
const REF_PAIRS = { 'Armor Mods': 'heading', 'Exotic Armors': 'perk' };
// "Ace of Spades\n\nMemento Mori" is a name with its perks underneath; "[3 Energy]" a mod's cost
const refEntry = (name, desc = '') => { const [term, ...sub] = name.split('\n').map(x => x.trim()).filter(Boolean); return { term, sub: sub.map(x => x.replace(/^\[(.*)\]$/, '$1')), desc, meta: [] }; };
const refSection = (title = '', major = false) => ({ title, major, notes: [], entries: [] });

function entrySections(rows) {
  const items = [];
  for (const r of rows) {
    const c = r.filter(Boolean), short = c.every(x => x.length <= 25);
    // "Hunter | Hunters" names a class; "Fragments | Information | Stat Changes" is a column header naming the section below
    const cls = c.length === 2 && short && c[1].toLowerCase().startsWith(c[0].toLowerCase().replace(/s$/, ''));
    if (c.length === 1 ? c[0].length <= 60 && !c[0].includes('\n') : cls || short && c.slice(1).some(x => /^(information|description|effects?|notes?|stat changes|fragment slots)$/i.test(x))) items.push({ head: c[0], cls });
    else if (c.length === 1) items.push({ note: c[0] });
    else if (short && c.length > 2) items.push({ note: c.join(' · ') });  // a list of names, like the abilities a class shares
    else for (let i = 0; i < c.length; i += 2) {
      if (c[i].split('\n')[0].length > 50) { items.push(...c.slice(i, i + 2).map(note => ({ note }))); continue; }  // a remark, not a name
      const e = refEntry(c[i], c[i + 1]);
      // one cell left after a name and its effect is a fact about it (stat change, cooldown), or more of the effect
      if (i + 3 === c.length) { c[i + 2].length <= 80 ? e.meta.push(c[i + 2]) : e.desc += '\n\n' + c[i + 2]; i++; }
      items.push({ entry: e });
    }
  }
  // the sheet's title and navigation rows come before the first real effect: of those, only notes and the last heading stay
  const first = items.findIndex(x => x.entry?.desc.length > 25), lead = items.slice(0, first).findLastIndex(x => x.head);
  const kept = items.filter((x, k) => k >= first || x.note || k === lead), out = [];
  kept.forEach((x, k) => {
    if (x.head || !out.length) out.push(refSection(x.head, !!x.cls || !!x.head && !!kept[k + 1]?.head));
    if (x.note) out.at(-1).notes.push(x.note);
    if (x.entry) out.at(-1).entries.push(x.entry);
  });
  return out;
}

function pairSections(rows, lone) {
  const first = rows.findIndex(r => r.some((c, i) => i % 2 && c.length > 25)), blocks = Math.ceil(rows[0].length / 2);
  // block names: the first title row naming every block differently (Helmet, Arms… or Hunters, Titans, Warlocks)
  const names = rows.slice(0, first).find(r => { const l = [...Array(blocks).keys()].map(k => r[2 * k]); return l.every(Boolean) && new Set(l).size === blocks; });
  const same = k => k > 0 && names?.[2 * k].toLowerCase().replace(/\W/g, '') === names[2 * k - 2].toLowerCase().replace(/\W/g, '');
  return [...Array(blocks).keys()].flatMap(k => {
    const secs = [same(k) ? refSection() : refSection(names?.[2 * k], true)];  // "Raid-Specific" and "Raid Specific" side by side are one group
    let prev = null;
    for (const r of rows.slice(first)) {
      const [name, eff] = [r[2 * k], r[2 * k + 1]];
      if (name && eff) { secs.at(-1).entries.push(prev = refEntry(name, eff)); continue; }
      if (name && lone === 'perk' && prev) prev.sub.push(name);
      else if (name) secs.push(refSection(name));
      else if (eff) secs.at(-1).notes.push(eff);
      prev = null;
    }
    return secs;
  });
}

const refDocs = new Map();
function refDoc(t) {
  if (!refDocs.has(t)) {
    const rows = cleanRows(t), h = REF_TABLES.has(t.tab) && rows.indexOf(headerRow({ rows }));
    refDocs.set(t, REF_TABLES.has(t.tab) ? { head: rows[h], rows: rows.slice(h + 1) } : { sections: REF_PAIRS[t.tab] ? pairSections(rows, REF_PAIRS[t.tab]) : entrySections(rows) });
  }
  return refDocs.get(t);
}

const markText = (text, q) => { const h = esc(text); return q ? h.replace(new RegExp(esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), m => `<mark>${m}</mark>`) : h; };
// o.q marks search matches; o.W links the names the wiki knows (except o.self); o.where says where the entry comes from, as html
const entryHtml = (e, o = {}) => `<div class="entry"><dt><b><a href="${wikiHref(e.term)}">${markText(e.term, o.q)}</a></b>${e.sub.map(x => `<small>${markText(x, o.q)}</small>`).join('')}${o.where ? `<small>${o.where}</small>` : ''}
  ${e.meta.length ? `<span class="facts">${e.meta.map(m => `<span class="badge">${markText(m, o.q)}</span>`).join('')}</span>` : ''}</dt><dd>${o.W ? linkify(o.W, esc(e.desc), o.self) : markText(e.desc, o.q)}</dd></div>`;
const isNum = c => /^[-+~]?[\d.,]+\s?(%|x|s|m)?$/.test(c);
function dataTable(head, rows, q) {
  // mostly-number columns line up on the right; columns with long text get room so rows stay short
  const cls = head.map((_, i) => { const col = rows.map(r => r[i]).filter(Boolean);
    return col.length && col.filter(isNum).length >= col.length * .6 ? ' class="num"' : col.some(c => c.length > 30) ? ' class="wide"' : ''; });
  return `<div class="datawrap"><table class="data"><thead><tr>${head.map((c, i) => `<th scope="col"${cls[i]}>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td${cls[i]}>${markText(c, q)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
const entryText = e => [e.term, ...e.sub, e.desc, ...e.meta].join('\n').toLowerCase();

function refDocHtml(doc, W) {
  if (doc.head) return dataTable(doc.head, doc.rows);
  const secs = doc.sections, majors = secs.filter(s => s.major && s.title), jump = majors.length > 1 ? majors : secs.filter(s => s.title);
  return `${jump.length > 2 ? `<nav class="refjump" aria-label="Sections">${jump.map(s => `<button type="button" data-jump="${secs.indexOf(s)}">${esc(s.title)}</button>`).join('')}</nav>` : ''}
    ${secs.map((s, k) => `<section class="refsec${s.major ? ' major' : ''}" id="refsec-${k}">${s.title ? `<h3>${esc(s.title)}</h3>` : ''}${s.notes.map(n => `<p class="refnote">${linkify(W, esc(n))}</p>`).join('')}
      ${s.entries.length ? `<dl class="entries">${s.entries.map(e => entryHtml(e, { W, self: e.term })).join('')}</dl>` : ''}</section>`).join('')}`;
}

async function reference(idx) {
  const [tabs, W] = await Promise.all([sheets(), wikiData()]);
  const kept = Object.entries(REF_TOPICS).map(([topic, names]) => [topic, Object.entries(names).map(([tab, name]) => ({ name, i: tabs.findIndex(t => t.tab === tab), ext: REF_EXTERNAL.has(tab) }))
    .filter(x => x.i >= 0 && (!x.ext || tabs[x.i].url))]);
  const own = kept.flatMap(([, ts]) => ts).filter(x => !x.ext), t = own.some(x => x.i === idx) && tabs[idx], nameOf = i => own.find(x => x.i === i).name;
  const chips = l => `<div class="tabs">${l.map(x => `<a href="${wikiHref(x)}">${esc(x)}</a>`).join('')}</div>`;
  $app.innerHTML = `<h1>Wiki</h1><p class="muted">Every raid, dungeon, perk, status, ability and exotic has a page: click a name anywhere to see everything about it. ↗ opens the original sheet.</p>
    <div class="filters"><input type="search" id="q" aria-label="Search the wiki" placeholder="Search raids, perks, statuses, exotics, bosses…"></div>
    <h2 class="wikihead">Activities</h2>${Object.values(WIKI_KINDS).map(([kind, plural]) => [plural, [...W.acts.values()].filter(x => x.kind === kind).map(x => x.name)]).filter(([, l]) => l.length)
      .map(([plural, l]) => `<h3>${esc(plural)}</h3>${chips(l)}`).join('')}
    <h3>Champions</h3>${chips(CHAMPIONS)}
    <h2 class="wikihead">Perks, abilities and damage</h2>
    ${kept.map(([topic, ts]) => `<h3>${esc(topic)}</h3><div class="tabs">${ts.map(x => x.ext ? `<a href="${esc(tabs[x.i].url)}" target="_blank" rel="noopener" title="Opens the original sheet">${esc(x.name)} ↗</a>`
      : `<a ${x.i === idx ? 'class="on" aria-current="page"' : ''} href="#/ref/${x.i}">${esc(x.name)}</a>`).join('')}</div>`).join('')}
    <div id="refbody"></div>`;
  const body = $app.querySelector('#refbody'), open = t ? `<section class="panel refdoc" id="sheet"><h2>${esc(nameOf(idx))}</h2>
      <p class="refsrc">From ${esc(t.source)}${t.url ? ` · <a href="${esc(t.url)}" target="_blank" rel="noopener">open the original sheet</a>` : ''}</p>${refDocHtml(refDoc(t), W)}</section>` : '<p class="empty">Pick a page or search them all.</p>';
  const draw = () => {
    const q = $app.querySelector('#q').value.trim().toLowerCase();
    if (!q) { body.innerHTML = open; return; }
    const hits = own.map(x => {
      const doc = refDoc(tabs[x.i]);
      if (doc.head) { const rows = doc.rows.filter(r => r.some(c => c.toLowerCase().includes(q))); return { ...x, n: rows.length, html: rows.length && dataTable(doc.head, rows.slice(0, 25), q) }; }
      const found = doc.sections.flatMap(s => s.entries.filter(e => entryText(e).includes(q)).map(e => entryHtml(e, { q, where: esc(s.title) })));
      return { ...x, n: found.length, html: found.length && `<dl class="entries">${found.slice(0, 25).join('')}</dl>` };
    }).filter(x => x.n);
    const pages = W.names.filter(n => n.toLowerCase().includes(q)).sort((x, y) => !y.toLowerCase().startsWith(q) - !x.toLowerCase().startsWith(q) || x.length - y.length).slice(0, 18);
    body.innerHTML = (pages.length ? `<section class="panel refdoc"><h2>Pages</h2>${chips(pages)}</section>` : '') + (hits.length || pages.length ? hits.map(x => `<section class="panel refdoc"><h2><a href="#/ref/${x.i}">${esc(x.name)}</a> <span class="count">${x.n}</span></h2>
        ${x.html}${x.n > 25 ? `<p class="refsrc"><a href="#/ref/${x.i}">See all of ${esc(x.name)}</a></p>` : ''}</section>`).join('')
      : `<p class="empty">Nothing in the wiki matches “${esc(q)}”.</p>`);
  };
  $app.querySelector('#q').addEventListener('input', draw);
  body.addEventListener('click', e => { const b = e.target.closest('[data-jump]'); if (b) $app.querySelector('#refsec-' + b.dataset.jump).scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); });
  draw();
  // on phones the tab list is long, so bring the chosen sheet into view
  const sheet = $app.querySelector('#sheet');
  if (sheet && sheet.getBoundingClientRect().top > innerHeight * 0.6) sheet.scrollIntoView();
}

// ---------- wiki ----------
// One page per name with everything the site knows about it: an activity's loot and the encounters that drop it, what a perk, status,
// ability or exotic does in every sheet that defines it, the weapons that can roll a perk, and every entry that mentions it.
const WIKI_KINDS = { Raids: ['Raid', 'Raids'], Dungeons: ['Dungeon', 'Dungeons'], 'Legacy Exotic Mission Gear (Cla': ['Exotic mission', 'Exotic missions'],
  'Portal Attuneable Gear': ['Portal activity', 'Portal'], Destinations: ['Destination', 'Destinations'], Vendors: ['Vendor', 'Vendors'] };
const CHAMPIONS = ['Barrier', 'Overload', 'Unstoppable'];
const wikiHref = n => '#/wiki/' + encodeURIComponent(n);
// names as the sheets and Bungie spell them differently: case, accents, curly quotes, a leading "The"
const fold = t => t.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[’‘]/g, "'").toLowerCase().replace(/^the /, '').trim();
// the same name give or take one letter ("Quillim's" in one sheet, "Qullim's" in the game)
// a sheet's typo: one letter off, or two in a long name ("Dimensional Hypertrochoid" for Hypotrochoid)
const near = (a, b) => { a = fold(a).replace(/[^a-z0-9]/g, ''); b = fold(b).replace(/[^a-z0-9]/g, '');
  if (a === b) return true; if (a.length < 8 || /\d/.test(a + b)) return false;  // IKELOS_SG and IKELOS_SMG differ
  const k = Math.min(a.length, b.length) >= 16 ? 2 : 1;
  const within = (x, y, k) => { let i = 0; while (i < x.length && x[i] === y[i]) i++; x = x.slice(i); y = y.slice(i);
    return !x || !y ? Math.max(x.length, y.length) <= k : k > 0 && (within(x.slice(1), y.slice(1), k - 1) || within(x.slice(1), y, k - 1) || within(x, y.slice(1), k - 1)); };
  return Math.abs(a.length - b.length) <= k && within(a, b, k); };
const rxEsc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// a name on its own, not inside a longer word ("Shock" but not "Shockwave")
const nameRe = (alts, flags) => new RegExp(`(?<![\\w'’])(${alts})(?![\\w'’])`, flags);
const linkify = (W, html, self = '') => html.replace(W.linkRe, n => n === esc(self) ? n : `<a href="${wikiHref(W.linkNames.get(n))}">${n}</a>`);

let wikiIndex;
async function wikiData() {
  if (wikiIndex) return wikiIndex;
  const [tabs, arts, art] = await Promise.all([sheets(), load('artifacts'), load('wiki')]);
  const acts = new Map(), terms = new Map();
  // activities and their loot from the Monument of Triumph tabs, where a row with only a second cell starts a group
  for (const t of tabs) {
    const kind = t.source.startsWith('Monument') && WIKI_KINDS[t.tab]?.[0], col = n => t.rows[0].indexOf(n);
    let act;
    if (kind) for (const r of t.rows.slice(1)) {
      if (!r[0] && r[1]) acts.set(r[1].toLowerCase(), act = { name: r[1], kind, loot: [] });
      else if (r[0] && act) act.loot.push({ n: r[0], key: r[0].replace(/\s*(\|.*|\((Adept|Timelost|Harrowed)\))$/i, '').trim().toLowerCase(), type: r[col('Loot Type')] || '', el: r[col('Element')] || '',
        enc: r[col('Encounter(s)')] || '', how: r[col('Acquisition Method')] || '' });
    }
  }
  // raids and dungeons from Llama's Raid Loot and Dungeon Loot (made by Court): a block per activity (its name in capitals, launch and refresh
  // dates), "Loot | 1st | 2nd…" headers, then a row per item with the encounter that drops it under each column. A cell can open with the
  // mode ("Standard & Epic\nAgraios" is Agraios) or wrap a name over two lines ("Dredgen\nSere").
  let llama, cols, adept, blk = 0, label;
  const ord = c => /^\d+(st|nd|rd|th)$/.test(c), lines = c => c.split('\n').map(x => x.trim()).filter(Boolean);
  const cellName = c => { const l = lines(c); if (l.length > 1 && /^(standard|epic)\b/i.test(l[0])) l.shift(); return l.join(' ').replace(/\*+$/, ''); };  // "Gahlran**" points at a footnote
  for (const [tab, kind] of [['Raid Loot', 'Raid'], ['Dungeon Loot', 'Dungeon']]) for (const r of tabs.find(t => t.tab === tab)?.rows || []) {
    if (r[0] && r[6]?.includes('\n')) {
      const ls = lines(r[6]), title = ls.find(x => /[A-Z]/.test(x) && x === x.toUpperCase() && !/\d/.test(x));
      const act = title && [...acts.values()].find(a => a.kind === kind && fold(a.name).startsWith(fold(title)));
      const date = k => ls.find(x => x.startsWith(k))?.split(':').slice(1).join(':').trim() || '';
      llama = act && (act.llama ||= { title, tab, launched: date('Launched'), refreshed: date('Refreshed'), notes: [], items: [] });
      label = ls[0] === title ? '' : ls[0]; cols = null; continue;
    }
    if (!llama) continue;
    if (/Loot$/.test(r[2]) && r.some(ord)) { cols = r.flatMap((c, i) => ord(c) ? [i] : []); adept = /adept/i.test(r[2]); blk++; continue; }
    const long = r.slice(2).filter(c => c.length > 90 || (c.length > 40 && !r[3] && c === r[2]));
    long.forEach(c => llama.notes.includes(c) || /@/.test(c) || llama.notes.push(c));
    if (!cols || !r[3]) continue;
    llama.items.push({ n: lines(r[3]).at(-1).replace(/\*+$/, ''), adept, blk, label, cells: cols.map(i => r[i] && r[i] !== '-' && !/@/.test(r[i]) ? cellName(r[i]) : ''),
      note: r.slice(cols.at(-1) + 1).find(c => c && c.length <= 90) || '' });
  }
  // A column's encounter is the name most of its rows give. "If attuned" or "If Dungeon is featured" means that encounter drops it only then;
  // Pantheon weapons unlock from the encounter in their row, then drop "After unlock" from all of them; anything else ("Raid Puzzles",
  // "Complete any Master Encounter Challenge") says how to get it.
  for (const R of [...acts.values()].map(a => a.llama).filter(Boolean)) {
    const votes = {}, when = c => /^(after unlock|if .+)$/i.test(c);
    for (const it of R.items) if (!it.adept) it.cells.forEach((c, j) => { if (c && !when(c)) { const v = (votes[it.blk + '.' + j] ||= {}); v[c] = (v[c] || 0) + 1; } });
    const enc = k => Object.entries(votes[k] || {}).sort((x, y) => y[1] - x[1])[0]?.[0];
    R.encs = [...new Set(Object.keys(votes).sort((x, y) => parseFloat(x) - parseFloat(y)).map(enc))];
    for (const it of R.items) { it.encs = []; it.how = [];
      const unlocks = it.cells.some(c => /^after unlock$/i.test(c)), only = {};
      it.cells.forEach((c, j) => { if (!c) return; const e = enc(it.blk + '.' + j);
        if (/^if /i.test(c)) (only[c.toLowerCase()] ||= []).push(e);
        else if (!when(c)) (!it.adept && (unlocks || c === e) ? it.encs : it.how).push(c); });
      for (const [c, es] of Object.entries(only)) it.how.push(`Also ${es.filter(Boolean).join(' and ')} ${c.replace('dungeon', 'the dungeon')}`);
      if (unlocks) it.how.push('Unlocks from that encounter, then drops from every encounter'); }
  }
  // everything the sheets and the artifacts define, by name
  const add = (k, v) => terms.set(k.toLowerCase(), [...(terms.get(k.toLowerCase()) || []), v]);
  for (const [tab, name] of Object.values(REF_TOPICS).flatMap(Object.entries)) {
    const i = tabs.findIndex(x => x.tab === tab);
    if (i < 0 || REF_TABLES.has(tab) || REF_EXTERNAL.has(tab)) continue;
    for (const sec of refDoc(tabs[i]).sections) for (const e of sec.entries) add(e.term, { e, where: name, section: sec.title, i, glossary: /glossary/i.test(sec.title) });
  }
  for (const x of arts) for (const t of x.tiers) for (const k of t.perks) {
    const same = terms.get(k.n.toLowerCase())?.find(y => y.where === 'Artifact perks' && y.e.desc === k.d);
    if (same) same.section += ', ' + x.n; else add(k.n, { e: { term: k.n, sub: [], desc: k.d, meta: [] }, where: 'Artifact perks', section: x.n, icon: k.i });
  }
  // linked in running text: raids, dungeons, missions, champions, statuses from the subclass glossaries, exotics, and names of two or more words
  // (single-word perk names like "Focus" or "Momentum" read as plain words too often)
  const linkable = [...[...acts.values()].filter(x => /Raid|Dungeon|mission/.test(x.kind)).map(x => x.name), ...CHAMPIONS,
    ...[...terms.values()].flat().filter(x => x.glossary || /^Exotic/.test(x.where) || x.e.term.includes(' ')).map(x => x.e.term)].filter(n => n.length > 3);
  const linkNames = new Map(linkable.map(n => [esc(n), n]));
  const names = [...new Set([...[...acts.values()].map(x => x.name), ...CHAMPIONS, ...[...terms.values()].map(l => l[0].e.term)])];
  return wikiIndex = { tabs, art, acts, terms, names, linkNames, linkRe: nameRe([...linkNames.keys()].sort((x, y) => y.length - x.length).map(rxEsc).join('|'), 'g') };
}

async function wikiPage(raw) {
  const name = decodeURIComponent(raw), key = name.toLowerCase();
  const [W, d, a, rot, places] = await live(Promise.all([wikiData(), data(), armorData(), load('rotation'), load('destinations')]));
  const act = W.acts.get(key), defs = W.terms.get(key) || [], champ = CHAMPIONS.find(c => c.toLowerCase() === key);
  const weapon = d.weapons.find(w => w.n.toLowerCase() === key), armor = a.armor.find(x => x.n.toLowerCase() === key);
  // weapons that can roll a perk or frame of this name, one per weapon name, best rated first
  const plugs = new Set(Object.keys(d.plugs).filter(h => d.plugs[h].n.toLowerCase() === key).map(Number)), rank = w => 'SABCDF'.indexOf(d.rolls[w.h]?.t) + 1 || 9;
  const rollers = plugs.size ? [...new Map(d.weapons.filter(w => w.cols.some(c => c.c !== 'Weapon Mods' && c.p.some(h => plugs.has(h)))).map(w => [w.n, w])).values()]
    .sort((x, y) => rank(x) - rank(y) || x.n.localeCompare(y.n)) : [];
  const re = nameRe(rxEsc(name), 'i'), mentions = [...W.terms.values()].flat().filter(x => x.e.term.toLowerCase() !== key && re.test(x.e.desc));
  const srcHtml = await sourcesHtml(weapon, W);
  // the loot table links each weapon to its page: the version from this activity if the names repeat, else a rated one
  const lootWeapon = x => { const l = d.weapons.filter(w => w.n.toLowerCase() === x.key); return l.find(w => act && w.src.includes(act.name)) || l.find(w => d.rolls[w.h]) || l[0]; };
  const tags = [act?.kind, champ && 'Champion', weapon && `${weapon.ti} ${weapon.ty}`, armor && `${armor.ti} ${armor.ty}`, ...new Set(defs.map(x => x.where === 'Artifact perks' ? 'Artifact perk' : x.where)), rollers.length && !defs.some(x => x.where === 'Weapon perks') && 'Weapon perk'].filter(Boolean);
  const raid = act && /Raid|Dungeon|mission|Destination/.test(act.kind) && lootPage(act, d, a, rot, act.kind === 'Destination' && { ...places.places[act.name], how: places.events, distortions: places.distortions, art: W.art.places[fold(act.name)] });
  const loot = act && !raid && `<section class="panel"><h2>Loot <span class="count">${act.loot.length}</span></h2>${act.loot.some(x => x.enc) || act.kind === 'Dungeon' ? '<p class="refsrc">Which encounters drop each item, from the Monument of Triumph and Llama\'s loot sheets.</p>' : ''}
    <div class="datawrap"><table class="data"><thead><tr><th scope="col">Item</th><th scope="col">Type</th><th scope="col">Element</th>${act.loot.some(x => x.enc) ? '<th scope="col">Encounters</th>' : ''}${act.loot.some(x => x.how) ? '<th scope="col">How</th>' : ''}</tr></thead>
    <tbody>${act.loot.map(x => { const w = lootWeapon(x);
      return `<tr><td class="wide">${w ? `<a class="lootname" href="#/weapon/${w.h}">${img(w.i)}${esc(x.n)}</a>` : esc(x.n)}</td><td>${esc(x.type)}</td><td>${x.el && x.el !== 'Armor' ? `<span class="badge dmg-${esc(x.el)}">${esc(x.el)}</span>` : ''}</td>
        ${act.loot.some(y => y.enc) ? `<td class="wide">${esc(x.enc)}</td>` : ''}${act.loot.some(y => y.how) ? `<td class="wide">${esc(x.how)}</td>` : ''}</tr>`; }).join('')}</tbody></table></div></section>`;
  const byWhere = Object.entries(Object.groupBy(mentions, x => x.where));
  const counters = W.tabs.find(t => t.tab === 'CHAMP COUNTERS LIST')?.url;
  const title = act?.name || champ || defs[0]?.e.term || weapon?.n || armor?.n || name, plug = d.plugs[[...plugs][0]];
  // laid out like a gun page: a banner (the activity's art, the item, or the perk's icon), the main panels, and a sticky side column
  const art = weapon || armor || { n: title, ss: W.art.img[key] || W.art.places[fold(name)]?.img, fl: raid ? raid.flavor : plug?.d,
    // an activity named like a perk (the Encore mission) keeps its own banner, not the perk's icon and text
    i: raid ? null : plug?.i || W.art.icon[key] || defs.find(x => x.icon)?.icon || W.art.icon[defs[0]?.where.toLowerCase()] };
  const main = `${raid?.main || loot || ''}
    ${defs.length ? `<section class="panel"><h2>What it does</h2><dl class="entries">${defs.map(x => entryHtml(x.e, { W, self: name,
      where: x.i != null ? `<a href="#/ref/${x.i}">${esc(x.where)}</a>${x.section ? ' · ' + esc(x.section) : ''}` : `${esc(x.where)} · ${esc(x.section)}` })).join('')}</dl></section>` : ''}
    ${rollers.length ? `<section class="panel"><h2>Weapons that can roll it <span class="count">${rollers.length}</span></h2><div class="grid" id="rollers"></div>
      ${rollers.length > 24 ? `<p><button type="button" id="morerollers">Show all ${rollers.length}</button></p>` : ''}</section>` : ''}
    ${mentions.length ? `<section class="panel"><h2>Mentioned in <span class="count">${mentions.length}</span></h2>${byWhere.map(([where, l]) => `<h3 class="mentionhead">${esc(where)}</h3><ul class="mentions">${l.map(x => {
      const line = x.e.desc.split('\n').find(t => re.test(t)) || '';
      return `<li><a href="${wikiHref(x.e.term)}">${esc(x.e.term)}</a><span>${esc(line).replace(nameRe(rxEsc(esc(name)), 'gi'), m => `<mark>${m}</mark>`)}</span></li>`; }).join('')}</ul>`).join('')}</section>` : ''}`.trim();
  const side = `${raid?.side || ''}${weapon || armor ? `<section class="panel"><h2>${weapon ? 'Gun page' : 'Armor page'}</h2><div class="grid">${weapon ? card(weapon, `<small>${tierBadge(d.rolls[weapon.h])}${esc(weapon.ty)}</small>${srcHtml ? `<small>${srcHtml}</small>` : ''}`) : ''}${armor ? card(armor, `<small>${esc(armor.ty)}</small>`, 'armor') : ''}</div></section>` : ''}
    ${plug?.s.length ? `<section class="panel"><h2>Stat changes</h2>${deltaList(plug.s)}</section>` : ''}
    ${champ ? `<section class="panel"><h2>Counters</h2><p>Everything here mentions ${esc(champ)} champions.${counters ? ` Court's full list of what stuns them is in the <a href="${esc(counters)}" target="_blank" rel="noopener">Champion counters sheet ↗</a>.` : ''}</p></section>` : ''}`.trim();
  const found = main || side;
  $app.innerHTML = `<p class="crumbs"><a href="#/wiki">Wiki</a></p>${found ? hero({ ...art, n: title }, `<span class="wikitags">${tags.map(t => `<span class="badge">${esc(t)}</span>`).join('')}${raid?.badge || ''}</span>`) : `<h1>${esc(title)}</h1>`}
    ${main && side ? `<div class="wtop wiki"><div>${main}</div><div class="wside">${side}</div></div>` : main || side}
    ${found ? '' : `<p class="empty">The wiki has nothing on “${esc(name)}” yet. <a href="#/wiki">Search the wiki</a></p>`}`;
  raid?.wire();
  const showRollers = n => { const box = $app.querySelector('#rollers'); if (box) box.innerHTML = rollers.slice(0, n).map(w => card(w, `<small>${tierBadge(d.rolls[w.h])}${esc(w.ty)}</small>`)).join(''); };
  showRollers(24);
  $app.querySelector('#morerollers')?.addEventListener('click', e => { showRollers(Infinity); e.target.remove(); });
}

// A raid, dungeon or exotic mission page: every weapon and armor piece as a card with its picture and the encounters that drop it (Llama's
// Raid and Dungeon Loot, then the Monument's list for anything they leave out), adept and catalyst notes, this week's rotation, and, signed
// in, which drops you own. Exotic missions have no encounter list, so their cards come from the Monument's list and the exotic's source.
// A destination (place: data/destinations.json plus the manifest's lost sectors) adds its public events, lost sectors and other activities.
function lootPage(act, d, a, rot, place) {
  const R = act.llama || { title: act.name, notes: [], items: [], encs: [] }, drops = [], armor = [], extras = [];
  const letters = t => fold(t).replace(/[^a-z0-9]/g, '');
  const find = n => { const l = d.weapons.filter(w => near(w.n, n)); return l.find(w => w.src.includes(act.name)) || l.find(w => d.rolls[w.h]) || l[0]; };
  const SLOT = { helm: 'Helm', helmet: 'Helm', arms: 'Arms', gauntlets: 'Arms', chest: 'Chest', legs: 'Legs', class: 'Class Item', 'class item': 'Class Item' };
  for (const it of R.items) {
    if (SLOT[it.n.toLowerCase()]) { if (!it.adept) armor.push({ ...it, slot: SLOT[it.n.toLowerCase()], epic: /epic/i.test(it.label) }); continue; }
    const cat = it.n.match(/^(.+) Catalyst$/i), base = drops.find(x => near(x.n, cat ? cat[1] : it.n));
    if (cat && base) base.catalyst = [...it.encs, ...it.how].join(', ') || 'Yes';
    else if (it.adept) { if (base) base.adept = it.how.some(h => /master/i.test(h)) ? 'Master encounter challenges' : it.how.join(' · ') || 'Yes'; }
    else if (base) base.encs = [...new Set([...base.encs, ...it.encs])];
    else if (find(cat ? cat[1] : it.n)) drops.push({ n: it.n, w: find(cat ? cat[1] : it.n), encs: it.encs, how: it.how, note: it.note, epic: /epic/i.test(it.label) });
    else extras.push(`${it.n}: ${[...it.encs, ...it.how].join(', ')}`);  // not a weapon (Equilibrium's crystals)
  }
  for (const x of act.loot) {
    if (x.type === 'Armor') continue;
    const base = drops.find(y => near(y.n, x.key)), isAdept = /\((adept|timelost|harrowed)\)/i.test(x.n);
    if (base) { if (isAdept) base.adept ||= x.enc; }
    else if (!isAdept) drops.push({ n: x.n.replace(/\s*\|.*$/, ''), w: find(x.key), encs: x.enc ? x.enc.split(/,\s*/) : [], how: [], note: '' });
  }
  // an exotic mission's exotic, which only its Bungie source names
  for (const w of d.weapons) if (w.ti === 'Exotic' && !place && act.kind !== 'Raid' && letters(w.src).includes(letters(act.name)) && !drops.some(x => near(x.n, w.n)))
    drops.push({ n: w.n, w, encs: [], how: [], note: '' });
  // the raid's armor, one piece per slot and class (its Bungie source names the raid), with the encounters Llama lists for that slot
  const slotOf = ty => /Helmet/.test(ty) ? 'Helm' : /Gauntlets/.test(ty) ? 'Arms' : /Chest/.test(ty) ? 'Chest' : /Leg/.test(ty) ? 'Legs' : 'Class Item';
  const order = ['Helm', 'Arms', 'Chest', 'Legs', 'Class Item'], CLASSES = ['Hunter', 'Titan', 'Warlock'];
  // armor whose Bungie source names the activity, or from a set the Monument lists for it ("Untethered Edge Armor")
  const sets = act.loot.filter(x => x.type === 'Armor').map(x => x.n.replace(/\s+Armor$/i, '')).filter(n => !SLOT[n.toLowerCase()]);
  const setOf = x => sets.findIndex(n => fold(x.n).startsWith(fold(n) + ' '));
  // one piece per name and class, the current (Armor 3.0) version when a set was reissued
  const pieces = [...new Map(a.armor.filter(x => x.ti === 'Legendary' && x.cl && (!place && letters(x.src).includes(letters(R.title)) || sets.some(n => fold(x.n).startsWith(fold(n) + ' '))))
    .sort((p, q) => (p.a3 || 0) - (q.a3 || 0)).map(x => [x.n + x.cl, x])).values()]
    .map(x => { const epic = /epic/i.test(x.src), row = armor.find(r => r.slot === slotOf(x.ty) && r.epic === epic);
      return { x, epic, slot: slotOf(x.ty), encs: row?.encs || [], notes: row ? [...row.how, row.note] : [] }; })
    .sort((p, q) => p.epic - q.epic || setOf(p.x) - setOf(q.x) || order.indexOf(p.slot) - order.indexOf(q.slot));
  const list = { Raid: 'raids', Dungeon: 'dungeons' }[act.kind], { weeks, cur } = rotationWeeks(rot), on = w => list && w[list].find(n => fold(act.name).startsWith(fold(n)));
  const next = weeks.find(w => w.start > cur.start && on(w));
  const fmt = s => new Date(s + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const chips = l => l.length ? `<p class="encs">${l.map(e => `<span class="enc">${esc(e)}</span>`).join('')}</p>` : '';
  const dropCard = (x, href, sub, facts, notes, attrs) => `<article class="drop" data-encs="${esc(x.encs.join('|'))}"${attrs}>
      <a class="dropart" href="${href}" tabindex="-1" aria-hidden="true">${x.ss ? `<img loading="lazy" src="${BNET}${x.ss}" alt="">` : ''}</a>
      <div class="dropbody"><a class="dropname" href="${href}">${x.i ? icon(x) : ''}<span class="dropttl"><b>${esc(x.n)}</b><small>${sub}</small></span></a>
        <p class="dropfacts">${facts}</p>${chips(x.encs)}${notes.filter(Boolean).map(t => `<p class="dropnote">${esc(t)}</p>`).join('')}
        <p class="own"></p></div></article>`;
  const gunCard = x => { const w = x.w;
    return dropCard({ ...w, n: w ? baseName(w.n) : x.n, encs: x.encs }, w ? `#/weapon/${w.h}` : wikiHref(x.n), w ? `${tierBadge(d.rolls[w.h])}${esc(w.ty)}` : '',
      `${w ? `<span class="badge dmg-${esc(w.dm)}">${esc(w.dm)}</span>` : ''}${w?.ti === 'Exotic' ? '<span class="badge exotic">Exotic</span>' : ''}${x.epic ? '<span class="badge">Epic only</span>' : ''}`,
      [x.how.join(' · '), x.adept && `Adept: ${x.adept}`, x.catalyst && `Catalyst: ${x.catalyst}`, x.note], w ? ` data-h="${w.h}"` : ''); };
  const armorCard = p => dropCard({ ...p.x, encs: p.encs }, `#/armor/${p.x.h}`, esc(p.x.ty), p.epic ? '<span class="badge">Epic only</span>' : '', p.notes, ` data-a="${p.x.h}" data-class="${esc(p.x.cl)}"`);
  const count = e => drops.filter(x => x.encs.includes(e)).length + (pieces.length ? armor : []).filter(r => r.encs.includes(e)).length;
  const buttons = (attr, label, l, cur) => `<div class="dropfilter" role="group" aria-label="${label}">${l.map(([v, t]) => `<button type="button" data-${attr}="${esc(v)}" aria-pressed="${v === cur}">${t}</button>`).join('')}</div>`;
  const main = `<section class="panel"><h2>Drops</h2>
      ${R.encs.length ? buttons('enc', 'Show drops from', [['', 'Every encounter'], ...R.encs.map((e, i) => [e, `<small>${i + 1}</small>${esc(e)} <span class="count">${count(e)}</span>`])], '') : ''}
      <div id="ownfilter" hidden>${buttons('own', 'Show', [['', 'All'], ['need', 'Missing'], ['have', 'Owned']], '')}</div>
      <h3 class="drophead">Weapons <span class="count">${drops.length}</span></h3><div class="drops">${drops.map(gunCard).join('')}</div>
      ${pieces.length ? `<h3 class="drophead">Armor</h3>${buttons('cls', 'Armor for', CLASSES.map(c => [c, c]), 'Hunter')}<div class="drops">${pieces.map(armorCard).join('')}</div>`
        : armor.length ? `<h3 class="drophead">Armor</h3><dl class="armordrops">${armor.map(it => `<dt>${esc(it.n)}</dt><dd>${chips(it.encs)}</dd>`).join('')}</dl>` : ''}</section>
    ${place ? placePanels(place) : ''}`;
  const side = `<section class="panel" id="raidmine"><h2>Your collection</h2><p class="muted">${Bungie.token() ? 'Loading your vault…' : 'Sign in with Bungie to see which drops you own and how good your best copy is.'}</p></section>
    ${place?.distorted ? `<section class="panel raidnotes"><h2>Distortions</h2><dl class="sidelist">${place.distortions.map(([t, x]) => `<dt>${esc(t)}</dt><dd>${esc(x)}</dd>`).join('')}</dl>
      <p class="refsrc">From Bungie's Monument of Triumph notes.</p></section>` : ''}
    ${list ? `<section class="panel"><h2>Rotation</h2><p>${on(cur) ? `Featured this week${cur.master.some(n => fold(act.name).startsWith(fold(n))) ? ', with Master' : ''}.` : `Not featured this week.${next ? ` Next featured the week of ${fmt(next.start)}.` : ''}`}</p></section>` : ''}
    ${R.notes.length || extras.length ? `<section class="panel raidnotes"><h2>Notes</h2>${[...extras, ...R.notes].map(n => `<p class="raidnote">${esc(n)}</p>`).join('')}
      ${R.tab ? `<p class="refsrc">From Llama's sheets (${R.tab}, by Court).</p>` : ''}</section>` : ''}`;
  const wire = () => {
    const panel = $app.querySelector('.drops').closest('section'), filt = { enc: '', own: '', cls: 'Hunter' };
    // a few of Bungie's screenshots are missing; leave the card's plain background instead of a broken image
    $app.querySelectorAll('.dropart img').forEach(i => i.addEventListener('error', () => i.remove()));
    const apply = () => panel.querySelectorAll('.drop').forEach(c => c.hidden = (filt.enc && !c.dataset.encs.split('|').includes(filt.enc))
      || (c.dataset.class && c.dataset.class !== filt.cls) || (filt.own && c.dataset.own !== filt.own));
    const pick = (attr, v) => { filt[attr] = v; panel.querySelectorAll(`[data-${attr}]`).forEach(x => x.setAttribute('aria-pressed', String(x.dataset[attr] === v))); apply(); };
    panel.addEventListener('click', e => { const b = e.target.closest('.dropfilter button'); if (b) for (const k of ['enc', 'own', 'cls']) if (k in b.dataset) pick(k, b.dataset[k]); });
    apply();
    // signed in, armor starts on your first character's class
    if (Bungie.token()) showRaidCopies(d, a, panel).then(cls => CLASSES.includes(cls) && pick('cls', cls));
  };
  return { main, side, wire, flavor: place ? (place.art?.d.length > 40 ? place.art.d : '') : [R.launched && `Launched ${R.launched}`, R.refreshed && `refreshed ${R.refreshed}`].filter(Boolean).join(' · '),
    badge: on(cur) ? '<span class="badge good">Featured this week</span>' : place?.distorted ? '<span class="badge">Distortions</span>' : '' };
}

// A destination's public events (with how to make each Heroic), its lost sectors as cards (entrance, difficulties, champions, shields,
// modifiers) and its other activities and encounters.
function placePanels(place) {
  const lost = place.art?.lost || [];
  const lostCard = x => `<article class="drop lost"><div class="dropart">${x.img ? `<img loading="lazy" src="${BNET}${x.img}" alt="">` : ''}</div>
    <div class="dropbody"><p class="dropname"><span class="dropttl"><b>${esc(x.n)}</b><small>${place.lost?.[x.n] ? `Entrance: ${esc(place.lost[x.n])}` : 'Entrance not listed'}</small></span></p>
      <p class="dropfacts">${x.champs.map(c => `<a class="badge" href="${wikiHref(c)}">${esc(c)}</a>`).join('')}${x.shields.map(e => `<span class="badge dmg-${esc(e)}">${esc(e)} shields</span>`).join('')}</p>
      <p class="encs">${x.diffs.map(t => `<span class="enc">${esc(t)}</span>`).join('')}</p>
      ${x.threat.length ? `<p class="dropnote">Threat: ${esc(x.threat.join(', '))}</p>` : ''}${x.mods.length ? `<p class="dropnote">Modifiers: ${esc(x.mods.join(', '))}</p>` : ''}</div></article>`;
  const events = place.events || [];
  return `${events.length ? `<section class="panel"><h2>Public events <span class="count">${events.length}</span></h2>
      <p class="refsrc">A normal clear drops this destination's gear at Tier 3 and a Heroic clear at Tier 4, each with a chance to roll higher (Bungie, 9.7.0).</p>
      <dl class="entries">${events.map(([n, bungie]) => `<div class="entry"><dt><b>${esc(n)}</b><small>${bungie ? 'Listed here by Bungie' : 'Listed here by community guides'}</small></dt>
        <dd><b>Make it Heroic:</b> ${esc(place.how[n])}</dd></div>`).join('')}</dl>
      <p class="refsrc">Heroic steps are from community guides, since Bungie doesn't publish them.</p></section>` : ''}
    ${lost.length ? `<section class="panel"><h2>Lost sectors <span class="count">${lost.length}</span></h2>
      <p class="refsrc">Champions, shields and modifiers are from the hardest version in Bungie's data. Entrances are from community guides.</p>
      <div class="drops">${lost.map(lostCard).join('')}</div></section>` : ''}
    ${place.also?.length ? `<section class="panel"><h2>Also here</h2><dl class="entries">${place.also.map(([t, x]) => `<div class="entry"><dt><b>${esc(t)}</b></dt><dd>${esc(x)}</dd></div>`).join('')}</dl></section>` : ''}`;
}

// On a raid's drop cards: how many copies you own (any version, adept included) with the best weapon roll or armor tier.
// Returns your first character's class.
async function showRaidCopies(d, a, panel) {
  const box = $app.querySelector('#raidmine');
  try {
    const prof = await profile(); renderAccount();
    if (!panel.isConnected) return;
    let guns = 0, god = 0, worn = 0;
    const gunCards = [...panel.querySelectorAll('.drop[data-h]')], armorCards = [...panel.querySelectorAll('.drop[data-a]')];
    for (const c of gunCards) {
      const w = d.byHash[c.dataset.h], mine = prof.items.filter(i => { const x = d.byHash[i.itemHash]; return x && baseName(x.n) === baseName(w.n) && x.ty === w.ty; });
      const best = bestFit(mine.map(i => rollFit(d, d.rolls[i.itemHash] || d.rolls[w.h], i.plugs))), adept = mine.filter(i => d.byHash[i.itemHash].n !== baseName(w.n)).length;
      c.dataset.own = mine.length ? 'have' : 'need'; guns += !!mine.length; god += isGod(best);
      c.querySelector('.own').innerHTML = mine.length ? `<span class="have">You have ${mine.length}${adept ? ` · ${adept} adept` : ''}</span>${rollPips(best)}` : '<span class="need">Not in your vault</span>';
    }
    for (const c of armorCards) {
      const x = a.byHash[c.dataset.a], mine = prof.items.filter(i => { const y = a.byHash[i.itemHash]; return y && y.n === x.n && y.cl === x.cl; });
      const tier = Math.max(0, ...mine.map(i => i.tier || 0));
      c.dataset.own = mine.length ? 'have' : 'need'; worn += !!mine.length;
      c.querySelector('.own').innerHTML = mine.length ? `<span class="have">You have ${mine.length}</span>${tier ? `<span class="badge${tier === 5 ? ' good' : ''}">Best: Tier ${tier}</span>` : ''}` : '<span class="need">Not in your vault</span>';
    }
    $app.querySelector('#ownfilter').hidden = false;
    box.innerHTML = `<h2>Your collection</h2><p><b>${guns}</b> of ${gunCards.length} weapons${god ? `, <b>${god}</b> with a god roll` : ''}.</p>
      ${armorCards.length ? `<p><b>${worn}</b> of ${armorCards.length} armor pieces (all classes).</p>` : ''}<p class="hint">${rollLegend}</p>`;
    return prof.chars[0]?.cls;
  } catch (e) { box.innerHTML = `<h2>Your collection</h2><p>${esc(e.message)}</p>`; }
}

// a weapon's drop sources, with each activity linked to its wiki page
async function sourcesHtml(w, W) {
  if (!w) return '';
  return (await whereToFarm(w)).map(s => { const [, pre = '', act, rest = ''] = s.match(/^(.*? · )?(.*?)( \(.*\))?$/);
    return W.acts.has(act.toLowerCase()) ? `${esc(pre)}<a href="${wikiHref(act)}">${esc(act)}</a>${esc(rest)}` : esc(s); }).join(' · also: ');
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
  document.querySelectorAll('.top nav a').forEach(a => a.toggleAttribute('aria-current', a.getAttribute('href').slice(2).split('/')[0] === (/^weapons?$/.test(parts[0]) ? '' : parts[0] === 'ref' ? 'wiki' : parts[0] || '')));
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
    else if (parts[0] === 'wiki') await (parts[1] ? wikiPage(parts[1]) : reference(-1));
    else if (parts[0] === 'images') images();
    else $app.innerHTML = '<p class="empty">Page not found. <a href="#/">Back to weapons</a></p>';
  } catch (e) {
    $app.innerHTML = `<p>Something went wrong: ${esc(e.message)}</p>`;
    console.error(e);
  }
}

window.addEventListener('hashchange', route);
Bungie.handleRedirect().catch(e => alert(e.message)).finally(route);
