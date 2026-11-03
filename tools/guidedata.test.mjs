// Data test for the wiki's encounter guides (node only: no browser, no server, no port): every raid, dungeon and exotic mission page and
// every Grandmaster strike has exactly one guide in data/guides/, named and filed the way the page looks it up; each encounter has what a
// player needs mid-run; Master and Epic notes are there exactly where the game offers the mode; sources are credited with a link and a
// checked date; the text is plain (the page escapes it, so markup would show as typed).
// It runs js/app.js in a node:vm sandbox to use the page's own guideFile() and wikiData() (the Drops chips), so a writer gets an answer in
// a fraction of a second, and works the page list out independently from the sheets so an app bug can't shrink what it checks.
// Run from the repo root: node tools/guidedata.test.mjs
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';
const T = JSON.parse(fs.readFileSync('data/tabs.json')), rot = JSON.parse(fs.readFileSync('data/rotation.json'));
// held by the owner until checked in game (Nov 2026): these pages must have no guide, so lifting the hold is a deliberate edit here
const HELD = ['Starcrossed', 'The Sunless Cell', 'Pantheon', 'Desert Perpetual & Epic DP'];
// the pages: a Monument of Triumph row with only a second cell starts an activity (as wikiData() reads them), plus the schedule's Grandmasters
const KINDS = { Raids: 'Raid', Dungeons: 'Dungeon', 'Legacy Exotic Mission Gear (Cla': 'Exotic mission' }, pages = new Map();
for (const t of T) if (t.source.startsWith('Monument') && KINDS[t.tab]) for (const r of t.rows.slice(1)) if (!r[0] && r[1]) pages.set(r[1], KINDS[t.tab]);
for (const k of Object.values(KINDS)) assert.ok([...pages.values()].includes(k), `no ${k} pages in data/tabs.json (a renamed tab would check nothing)`);
// each of the six comes round about every six weeks, so a Tuesday refresh keeps them all; a new or re-spelt one fails here until it has a guide
for (const n of new Set(rot.weeks.map(w => w.gm).filter(Boolean))) pages.set(n, 'Strike');
for (const n of HELD) assert.ok(pages.has(n), `HELD names no page: ${n}`);
// the page's own code, with just enough of a browser for its top level (no DOM work happens until a route runs)
const ctx = vm.createContext({ console, URL, document: { getElementById: () => ({}), currentScript: { src: 'http://x/js/app.js?v=0' } }, window: { addEventListener() {} },
  localStorage: { removeItem() {} }, Bungie: { handleRedirect: () => new Promise(() => {}), token: () => null },
  fetch: async u => { const f = new URL(u, 'http://x/').pathname.slice(1); return { ok: fs.existsSync(f), json: async () => JSON.parse(fs.readFileSync(f)) }; } });
vm.runInContext(fs.readFileSync('js/app.js', 'utf8'), ctx, { filename: 'js/app.js' });
const guideFile = vm.runInContext('typeof guideFile === "function" ? guideFile : null', ctx);
assert.ok(guideFile, 'js/app.js has no guideFile()');
const W = await ctx.wikiData();
// the app shows a page for every name worked out above, and no other raid, dungeon, mission or strike
assert.deepEqual([...W.acts.values()].filter(a => /Raid|Dungeon|mission|Strike/.test(a.kind)).map(a => a.name).sort(), [...pages.keys()].sort());

const dir = 'data/guides', files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')) : [];
const guides = files.map(f => { try { return { f, g: JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8')) }; } catch (e) { return { f, broken: e.message }; } });
const bad = [], need = (ok, msg) => ok || bad.push(msg);
// plain text: trimmed, one line, no tags, angle brackets, entities or Markdown, which the page would show as typed
const text = (v, max = 400) => typeof v === 'string' && v.trim().length > 0 && v === v.trim() && v.length <= max && !/[<>\n\r\t]|&(#\d+|#x[0-9a-f]+|[a-z]+);|\*\*|__|\]\(|^#|^- /i.test(v);
const list = v => Array.isArray(v) && v.length > 0 && v.every(x => text(x));
const pairs = v => Array.isArray(v) && v.length > 0 && v.every(p => Array.isArray(p) && p.length === 2 && p.every(x => text(x)));
const TOP = ['name', 'checked', 'about', 'caveat', 'master', 'epic', 'sources', 'encounters'];
const ENC = ['name', 'title', 'what', 'before', 'steps', 'roles', 'wipes', 'chests', 'master', 'epic'];
const masters = new Set(rot.weeks.flatMap(w => w.master));
for (const x of guides) need(!x.broken && x.g && typeof x.g === 'object' && !Array.isArray(x.g), `${x.f}: ${x.broken || 'not an object'}`);
const ok = guides.filter(x => x.g && typeof x.g === 'object' && !Array.isArray(x.g));
// exactly one guide per page, its name the page's exact spelling and its file where the page looks; none for a held page
for (const n of pages.keys()) { const l = ok.filter(x => x.g.name === n), want = HELD.includes(n) ? 0 : 1;
  need(l.length === want, `${n}: ${l.length} guides${l.length ? ` (${l.map(x => x.f).join(', ')})` : ''}${want ? '' : ', but it is HELD'}`); }
for (const n of HELD) need(!files.includes(guideFile(n) + '.json'), `${n} is HELD, so ${dir}/${guideFile(n)}.json must not exist`);
for (const { f, g } of ok) {
  const at = typeof g.name === 'string' ? g.name : f;
  need(pages.has(g.name), `${f}: "${g.name}" is no wiki page (spelling?)`);
  need(f === guideFile(String(g.name || '')) + '.json', `${f}: the page looks for ${guideFile(String(g.name || ''))}.json`);
  for (const k of Object.keys(g)) need(TOP.includes(k), `${at}: unknown field ${k}`);
  need(typeof g.checked === 'string' && /^\d{4}-\d\d-\d\d$/.test(g.checked) && !isNaN(new Date(g.checked)) && new Date(g.checked).toISOString().startsWith(g.checked)
    && g.checked <= new Date(Date.now() + 864e5).toISOString().slice(0, 10), `${at}: checked "${g.checked}" is no past date`);  // a day's grace east of UTC
  need(pairs(g.sources) && g.sources.length >= 2 && g.sources.every(([, u]) => /^https:\/\/[^\s<>"]+\.[^\s<>"]+$/.test(u)), `${at}: sources must be 2 or more [title, https url] pairs`);
  need(Array.isArray(g.sources) && new Set(g.sources.map(s => s?.[1])).size === g.sources.length, `${at}: a source URL is listed twice`);
  for (const k of ['about', 'caveat']) if (k in g) need(text(g[k]), `${at}: ${k}`);
  for (const k of ['master', 'epic']) if (k in g) need(list(g[k]), `${at}: ${k} is there but empty or not plain strings`);
  need(Array.isArray(g.encounters) && g.encounters.length > 0, `${at}: no encounters`);
  const encs = Array.isArray(g.encounters) ? g.encounters : [], names = encs.map(e => e?.name);
  need(new Set(names.map(n => String(n).toLowerCase())).size === names.length, `${at}: two encounters share a name`);
  for (const [i, e] of encs.entries()) {
    const en = `${at} / ${i + 1} ${e?.name}`;
    if (!e || typeof e !== 'object' || Array.isArray(e)) { need(false, `${en}: not an object`); continue; }
    for (const k of Object.keys(e)) need(ENC.includes(k), `${en}: unknown field ${k}`);
    need(text(e.name, 24), `${en}: name (the tab label) is plain text, 24 characters at most`);
    if ('title' in e) need(text(e.title, 80), `${en}: title is plain text, 80 characters at most`);
    need(text(e.what), `${en}: what`); if ('before' in e) need(text(e.before), `${en}: before`);
    need(list(e.steps) && e.steps.length >= 2, `${en}: steps (2 or more)`); need(pairs(e.roles), `${en}: roles must be [role, what they do] pairs`); need(list(e.wipes), `${en}: wipes`);
    for (const k of ['chests', 'master', 'epic']) if (k in e) need(list(e[k]), `${en}: ${k} is there but empty or not plain strings`);
  }
  // Master notes exactly where the schedule ever offers Master, Epic notes only for the Epic raid
  const hasM = 'master' in g || encs.some(e => e && 'master' in e), hasE = 'epic' in g || encs.some(e => e && 'epic' in e);
  need(masters.has(g.name) ? hasM : !hasM, masters.has(g.name) ? `${at}: rotation.json offers Master, but no Master notes` : `${at}: rotation.json never offers Master, so no Master notes`);
  need(/\bEpic\b/.test(g.name) ? hasE : !hasE, /\bEpic\b/.test(g.name) ? `${at}: has Epic but no Epic notes` : `${at}: only the Epic raid has Epic notes`);
  // every encounter the Drops panel has a chip for gets a tab of exactly that name (openings and traversal may add more)
  for (const c of W.acts.get(String(g.name).toLowerCase())?.llama?.encs || []) need(names.filter(n => n === c).length === 1, `${at}: no tab named "${c}" (a Drops chip)`);
}
assert.deepEqual(bad, []);
console.log(`guide data ok: ${ok.length} guides, ${ok.reduce((n, x) => n + x.g.encounters.length, 0)} encounters, ${HELD.length} held`);
