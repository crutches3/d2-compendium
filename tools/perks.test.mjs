// Browser test for the perk finder: guns that can roll one perk, or several together (each in its own column), from the weapon list and from a weapon page.
// Run from the repo root: python3 -m http.server 8765 & npm i --no-save playwright && node tools/perks.test.mjs
import { chromium } from 'playwright';
import fs from 'fs';
import assert from 'assert';
const OUT = (await import('os')).tmpdir() + '/';
const W = JSON.parse(fs.readFileSync('data/weapons.json')).weapons, P = JSON.parse(fs.readFileSync('data/plugs.json'));
// expected answers, worked out here independently: every way of giving each perk its own column
const cols = w => w.cols.filter(c => c.c !== 'Weapon Mods').map(c => new Set(c.p.map(h => P[h]?.n)));
const perms = (n, k) => k === 0 ? [[]] : perms(n, k - 1).flatMap(p => [...Array(n).keys()].filter(i => !p.includes(i)).map(i => [...p, i]));
const rolls = (w, names) => { const cs = cols(w); return perms(cs.length, names.length).some(p => p.every((i, k) => cs[i].has(names[k]))); };
const expect = names => new Set(W.filter(w => rolls(w, names)).map(w => w.n)).size;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
const count = async () => +(await p.textContent('#count')).match(/\d+/)[0];
const chips = () => p.$$eval('#perkchips .chip', cs => cs.map(c => c.textContent.trim()));

// one perk from the address: every gun that can roll it
await p.goto('http://localhost:8765/#/weapons?perk=Lone%20Wolf'); await p.waitForSelector('#list .card');
assert.deepEqual(await chips(), ['Lone Wolf']);
assert.equal(await count(), expect(['Lone Wolf']));
assert.match(await p.textContent('#perkhint'), /Add another perk/);
// add a second by typing its name: only guns that roll both, each card saying which column each comes from
await p.fill('#perkin', 'demoralize'); await p.press('#perkin', 'Enter');
assert.deepEqual(await chips(), ['Lone Wolf', 'Demoralize']);
const both = expect(['Lone Wolf', 'Demoralize']);
assert.ok(both > 0 && both < expect(['Lone Wolf']));
assert.equal(await count(), both);
assert.ok((await p.$$eval('#list .card b', bs => bs.map(x => x.textContent))).includes('1000 Yard Stare'));
assert.match(await p.textContent('#list .card .perkat'), /^Lone Wolf Trait · Demoralize Trait$/);
assert.equal(decodeURIComponent(new URL(p.url()).hash), '#/weapons?perk=Lone Wolf&perk=Demoralize');
await p.screenshot({ path: OUT + 'perks-d.png' });
// two perks that only ever share a column can't be on one gun
await p.click('[data-unperk="Lone Wolf"]'); await p.click('[data-unperk="Demoralize"]');
assert.equal(await count(), new Set(W.map(w => w.n)).size);
for (const n of ['Arrowhead Brake', 'Fluted Barrel']) { await p.fill('#perkin', n); await p.press('#perkin', 'Enter'); }
assert.equal(expect(['Arrowhead Brake', 'Fluted Barrel']), 0);
assert.match(await p.textContent('#list'), /No gun can roll Arrowhead Brake and Fluted Barrel together/);
// a frame and a trait work too; a name that isn't a perk says so
await p.goto('http://localhost:8765/#/weapons?perk=Adaptive%20Frame&perk=Kill%20Clip'); await p.waitForSelector('#perkchips .chip');
assert.equal(await count(), expect(['Adaptive Frame', 'Kill Clip']));
await p.fill('#perkin', 'Not A Perk'); await p.press('#perkin', 'Enter');
assert.match(await p.textContent('#perkhint'), /No perk called "Not A Perk"/);

// from a weapon page: picking a perk shows one button, to every gun with that perk (pairing happens on the list)
const yard = W.find(w => w.n === '1000 Yard Stare' && rolls(w, ['Lone Wolf', 'Demoralize']));  // one of its versions has both
await p.goto(`http://localhost:8765/#/weapon/${yard.h}`); await p.waitForSelector('.perk');
await p.click('.perk:has-text("Lone Wolf")');
await p.click('.perk:has-text("Demoralize")');
await p.waitForSelector('#perkinfo button:has-text("All guns with Demoralize")');
assert.deepEqual(await p.$$eval('#perkinfo a, #perkinfo button', els => els.map(e => `${e.tagName} ${e.textContent}`)),
  ['A Everything about Demoralize in the wiki', 'BUTTON All guns with Demoralize']);
await p.click('#perkinfo button:has-text("All guns with Demoralize")'); await p.waitForSelector('#perkchips .chip');
assert.deepEqual(await chips(), ['Demoralize']);
assert.equal(await count(), expect(['Demoralize']));
// and from the perk's wiki page
await p.goto('http://localhost:8765/#/wiki/Demoralize'); await p.waitForSelector('a:has-text("Pair Demoralize with another perk")');

await p.setViewportSize({ width: 390, height: 844 });
await p.goto('http://localhost:8765/#/weapons?perk=Lone%20Wolf&perk=Demoralize'); await p.waitForSelector('#list .card'); await p.waitForTimeout(200);
await p.screenshot({ path: OUT + 'perks-m.png' });
assert.deepEqual(errs, []);
console.log('perks tests passed');
await b.close();
