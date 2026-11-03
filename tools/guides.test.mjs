// Browser test for the wiki's encounter guides: raid, dungeon and exotic mission pages get a Guide tab beside Drops (Drops opens first and
// is unchanged), one encounter at a time kept in the address, sources credited, text escaped. Expected content is read from data/guides at run time, so new
// writing never breaks it. Pinned to week 20 (Oct 20 2026 reset: King's Fall featured with Master).
// Run from the repo root: python3 -m http.server 8765 & npm i --no-save playwright && node tools/guides.test.mjs
import { chromium } from 'playwright';
import fs from 'fs';
import assert from 'assert';
const G = new Map((fs.existsSync('data/guides') ? fs.readdirSync('data/guides') : []).filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(fs.readFileSync('data/guides/' + f))).map(g => [g.name, g]));
// held by the owner until checked in game (Nov 2026), as in guidedata.test.mjs: their pages work, with no guide
const HELD = ['Starcrossed', 'The Sunless Cell', 'Pantheon', 'Desert Perpetual & Epic DP'];
const S = { tab: t => `.typetabs button[data-pane="${t}"]`, pills: '#guide .dropfilter button[data-step]', step: '#guide .gstep', src: '#guide .refsrc a' };
const W = JSON.parse(fs.readFileSync('data/weapons.json')).weapons, doom = W.find(w => w.n === 'Doom of Chelchis');
const profile = { characters: { data: { H1: { classType: 1, light: 480 } } }, profileInventory: { data: { items: [{ itemHash: doom.h, itemInstanceId: '1', bucketHash: 138197802 }] } },
  characterInventories: { data: { H1: { items: [] } } }, characterEquipment: { data: { H1: { items: [] } } }, itemComponents: { sockets: { data: {} }, reusablePlugs: { data: {} }, instances: { data: {} }, stats: { data: {} } } };
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'UTC' });
await ctx.route('https://www.bungie.net/Platform/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ErrorCode: 1,
  Response: route.request().url().includes('GetMemberships') ? { primaryMembershipId: '1', destinyMemberships: [{ membershipId: '1', membershipType: 3 }], bungieNetUser: { uniqueName: 'Randy#1234' } } : profile }) }));
const p = await ctx.newPage();
await p.clock.setFixedTime(new Date('2026-10-23T12:00:00Z'));
const errs = []; p.on('pageerror', e => errs.push(e.message));
// the guides ship with the page's ?v= like every data file, or a release could pair new code with a cached old guide
const unversioned = []; p.on('request', r => r.url().includes('/data/') && !/\?v=\d+$/.test(r.url()) && unversioned.push(r.url()));
const href = (n, tail = '') => `http://localhost:8765/#/wiki/${encodeURIComponent(n)}${tail}`;
// the wiki routes by hash, and here the same page often opens again, so wait for a fresh render: the old title is marked, and the
// page's re-render replaces it (the very same address is no navigation at all, so that one goes by a blank page)
const openWiki = async (n, tail = '', m = p) => { await m.evaluate(() => document.querySelector('.hero h1')?.setAttribute('data-old', ''));
  if (m.url() === href(n, tail)) await m.goto('about:blank');
  await m.goto(href(n, tail)); await m.waitForSelector(`.hero h1:not([data-old]):text-is("${n.replace(/"/g, '\\"')}")`, { timeout: 10000 }); };
const pressed = (sel, m = p) => m.$$eval(sel, bs => bs.filter(x => x.getAttribute('aria-pressed') === 'true').map(x => x.textContent.trim()));
// shown means laid out, not just lacking the hidden attribute (a display rule beats [hidden])
const shown = (sel, m = p) => m.$$eval(sel, l => l.filter(x => x.checkVisibility()).length);
const visibleDrops = () => p.$$eval('.drop[data-h]', cs => cs.filter(c => !c.hidden).map(c => c.querySelector('b').textContent));
// open the guide and check every encounter against its file: one shown at a time, in file order, with all its parts
const checkGuide = async (name, m = p) => {
  const g = G.get(name); assert.ok(g, `no guide for ${name}`);
  if (await m.$(S.tab('guide'))) await m.click(S.tab('guide'));  // a strike page is all guide, so it has no Drops | Guide row
  await m.waitForSelector('#guide');
  const n = g.encounters.length;
  assert.deepEqual(await m.$$eval(S.pills, bs => bs.map(x => x.textContent.trim())), n > 1 ? g.encounters.map((e, i) => `${i + 1}${e.name}`) : [], name);
  for (const [i, e] of g.encounters.entries()) {
    if (n > 1) { await m.click(`${S.pills} >> nth=${i}`); assert.deepEqual(await pressed(S.pills, m), [`${i + 1}${e.name}`]); }
    assert.equal(await shown(S.step, m), 1, `${name}: one encounter at a time`);
    const [h, t, labels] = await m.$$eval(S.step, l => { const x = l.find(y => y.checkVisibility());
      return [x.querySelector('h3').textContent, x.innerText, [...x.querySelectorAll('.entry dt')].map(d => d.textContent)]; });
    assert.equal(h, `${i + 1}. ${e.title || e.name}`, name);
    for (const line of [e.what, e.before, ...e.steps, ...e.roles.flat(), ...e.wipes, ...(e.chests || []), ...(e.master || []), ...(e.epic || [])].filter(Boolean))
      assert.ok(t.includes(line), `${name} / ${e.name}: missing "${line.slice(0, 50)}"`);
    assert.deepEqual(labels, [['Roles', e.roles], ['Common wipes', e.wipes], ['Secret chests', e.chests], ['Master', e.master], ['Epic', e.epic]].filter(([, l]) => l).map(([k]) => k), name);
  }
  const all = await m.innerText('#guide');
  for (const line of [g.about, g.caveat, ...(g.master || []), ...(g.epic || [])].filter(Boolean)) assert.ok(all.includes(line), `${name}: missing "${line.slice(0, 50)}"`);
  if (g.caveat) assert.equal(await m.textContent('#guide > p.muted'), g.caveat);
  // each source credited by its title, opening in a new tab, and the day they were checked
  assert.deepEqual(await m.$$eval(S.src, as => as.map(a => [a.textContent.trim(), a.getAttribute('href'), a.target, a.rel])), g.sources.map(([t, u]) => [`${t} ↗`, u, '_blank', 'noopener']), name);
  assert.ok((await m.textContent('#guide .refsrc')).includes(`checked ${g.checked}`), name);
  return g;
};

// King's Fall: Drops opens first and works as before; Guide sits beside it and hides the whole Drops view, side column included
await openWiki("King's Fall");
assert.deepEqual(await p.$$eval('.typetabs button[data-pane]', bs => bs.map(x => x.textContent.trim())), ['Drops', 'Guide']);
assert.deepEqual(await pressed('.typetabs button[data-pane]'), ['Drops']);
assert.ok(await p.isVisible('.drops') && !(await p.isVisible('#guide')));
await p.click('.dropfilter button[data-enc="Golgoroth"]');
const top = await p.evaluate(() => scrollY);
await checkGuide("King's Fall");
assert.deepEqual(await pressed('.typetabs button[data-pane]'), ['Guide']);
assert.ok(!(await p.isVisible('.drops')) && !(await p.isVisible('#raidmine')), 'Guide hides Drops and its side column');
assert.ok(!(await p.$('#guide [data-enc], #guide .drop, #guide .drops')), "the guide's tabs are no drop filters or cards");
// the open encounter is in the address (replaceState, so no re-render), and a reload or a shared link comes back to it
assert.ok(p.url().endsWith(`/wiki/King's%20Fall/guide/${G.get("King's Fall").encounters.length}`), p.url());
await p.click(`${S.pills} >> nth=0`); assert.ok(p.url().endsWith("/wiki/King's%20Fall/guide"), p.url());
await p.click(`${S.pills} >> nth=2`); assert.ok(p.url().endsWith('/guide/3'), p.url());
// back on Drops: the same cards with the filter still on, at the same scroll (switching tabs never rebuilds the page)
await p.click(S.tab('drops'));
assert.ok(await p.isVisible('.drops') && !(await p.isVisible('#guide')) && p.url().endsWith("/wiki/King's%20Fall"), p.url());
assert.deepEqual(await visibleDrops(), ['Doom of Chelchis', "Midha's Reckoning"]);
assert.equal(await p.evaluate(() => scrollY), top);
await p.click(S.tab('guide')); assert.ok(p.url().endsWith('/guide/3'), p.url()); await p.click(S.tab('drops'));
await openWiki("King's Fall", '/guide/3');
assert.ok(await p.isVisible('#guide') && !(await p.isVisible('.drops')));
assert.deepEqual([await pressed('.typetabs button[data-pane]'), await pressed(S.pills)], [['Guide'], [`3${G.get("King's Fall").encounters[2].name}`]]);
await openWiki("King's Fall", '/guide/99'); assert.deepEqual(await pressed(S.pills), [`1${G.get("King's Fall").encounters[0].name}`]);
// signed in, the vault fills whichever tab is open, even when the page opens on Guide
await p.evaluate(() => localStorage.setItem('d2c_token', JSON.stringify({ access_token: 'x', expires_at: Date.now() + 3e6 })));
await openWiki("King's Fall", '/guide'); await p.click(S.tab('drops'));
await p.waitForSelector('.drop:has(.dropname b:text-is("Doom of Chelchis")) .own .have');
assert.match(await p.innerText('#raidmine'), /\b1 of 7 weapons/);
await p.evaluate(() => localStorage.removeItem('d2c_token'));

// a dungeon and an exotic mission get the same tabs; the mission's perk panels (Encore is also a perk) go with Drops
await openWiki('Equilibrium'); await checkGuide('Equilibrium');
await openWiki('Encore'); await checkGuide('Encore');
assert.ok(!(await p.isVisible('h2:text-is("What it does")')) && !(await p.$('#guide .dropfilter button[data-enc]')));

// every raid, dungeon and exotic mission page has a Guide tab, except the held ones, which keep Drops alone; destinations get none
const acts = await p.evaluate(async () => [...(await wikiData()).acts.values()].map(a => ({ name: a.name, kind: a.kind })));
for (const a of acts.filter(a => /Raid|Dungeon|mission/.test(a.kind))) {
  await openWiki(a.name);
  if (HELD.includes(a.name)) assert.ok(await p.isVisible('.drops') && !(await p.$('.typetabs button[data-pane]')), `${a.name} is held but has tabs`);
  else assert.ok(await p.$(S.tab('guide')), `${a.name} has no Guide tab`);
}
for (const n of ['European Dead Zone', 'Nessus', 'The Lawless Frontier']) { await openWiki(n); assert.ok(!(await p.$('.typetabs button[data-pane]')), `${n} has tabs`); }

// fake guides served in place of the real files: a page with none (a dungeon new to the Monument sheet), one with a single encounter,
// and one whose text tries to be HTML. load() keeps each file for the life of the document, so each fake starts on a fresh one.
const serve = async fn => { await p.route('**/data/guides/**', async route => { const res = await route.fetch(), g = res.ok() ? await res.json() : null, x = g && fn(g);
  return x === undefined ? route.fulfill({ response: res }) : x === null ? route.fulfill({ status: 404, body: '' }) : route.fulfill({ response: res, json: x }); }); await p.goto('about:blank'); };
await serve(g => g.name === 'Equilibrium' ? null : undefined);
await openWiki('Equilibrium'); assert.ok(await p.isVisible('.drops') && !(await p.$('.typetabs button[data-pane]')));
await openWiki('Equilibrium', '/guide'); assert.ok(await p.isVisible('.drops'));
await p.unroute('**/data/guides/**');
await serve(g => g.name === 'Prophecy' ? { ...g, encounters: g.encounters.slice(0, 1) } : undefined);
await openWiki('Prophecy'); await p.click(S.tab('guide')); assert.equal(await p.$(S.pills), null); assert.equal(await shown(S.step), 1);
await p.unroute('**/data/guides/**');
const hits = []; p.on('request', r => r.url().includes('x-xss') && hits.push(r.url()));
await serve(g => { if (g.name !== "King's Fall") return; const e = g.encounters[0];
  return { ...g, sources: [['<i>Source</i>', g.sources[0][1]], ['Bad link', 'javascript:window.__xss=3']],
    encounters: [{ ...e, what: 'Plain <b>bold</b> text', steps: ['<img src="x-xss" onerror="window.__xss=1">', ...e.steps], roles: [['<script>window.__xss=2</script>', 'x']] }, ...g.encounters.slice(1)] }; });
await openWiki("King's Fall", '/guide'); await p.waitForTimeout(300);
const body = await p.innerText('#guide');
assert.ok(body.includes('Plain <b>bold</b> text') && body.includes('<img src="x-xss"') && body.includes('<script>') && body.includes('Bad link'), body.slice(0, 200));
assert.deepEqual([await p.evaluate(() => window.__xss), hits, await p.$$eval('#guide b:text-is("bold"), #guide img[src="x-xss"], #guide script, #guide a[href^="javascript"]', l => l.length)], [undefined, [], 0]);
assert.equal(await p.textContent(`${S.src} >> nth=0`), '<i>Source</i> ↗');
await p.unroute('**/data/guides/**');

// on a phone: the tab row is on the first screen, above the side panels phones move up; the tabs wrap rather than push the page
// sideways; tapping one switches. Checked on the guides with the most encounters and the longest tab names, whatever they are today.
const phone = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const m = await phone.newPage(); m.on('pageerror', e => errs.push(e.message));
await m.clock.setFixedTime(new Date('2026-10-23T12:00:00Z'));
const tabbed = [...G.values()].filter(g => acts.some(a => a.name === g.name && /Raid|Dungeon|mission/.test(a.kind)));
const most = (f, l = tabbed) => [...l].sort((x, y) => f(y) - f(x))[0]?.name;
for (const n of new Set(["King's Fall", most(g => g.encounters.length), most(g => g.encounters.map(e => e.name).join('').length), most(g => g.encounters.length, tabbed.filter(g => !/Raid|Dungeon/.test(acts.find(a => a.name === g.name).kind)))])) {
  await openWiki(n, '', m);
  assert.ok(await m.$eval(S.tab('guide'), (x, side) => x.getBoundingClientRect().bottom < Math.min(innerHeight, side.getBoundingClientRect().top), await m.$('#raidmine')), `${n}: tab row below the fold`);
  await m.tap(S.tab('guide')); await m.waitForSelector('#guide');
  assert.deepEqual(await m.evaluate(() => [document.documentElement.scrollWidth, innerWidth]), [390, 390], `${n} scrolls sideways`);
  assert.deepEqual(await m.$$eval(`.typetabs button, ${S.pills}`, bs => bs.filter(x => { const r = x.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth; }).map(x => x.textContent)), [], `${n}: tabs off screen`);
  const last = G.get(n).encounters.length - 1;
  if (last) { await m.tap(`${S.pills} >> nth=${last}`); assert.equal(await m.$eval(`${S.pills} >> nth=${last}`, x => x.getAttribute('aria-pressed')), 'true', n); }
}

assert.deepEqual(unversioned, []);
assert.deepEqual(errs, []);
await b.close();
console.log('guide tests passed');
