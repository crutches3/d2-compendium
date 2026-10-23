// Browser test for the Reference page: only the useful tables, without sheet clutter, and one search across them.
// Run from the repo root: python3 -m http.server 8765 & npm i --no-save playwright && node tools/reference.test.mjs
import { chromium } from 'playwright';
import fs from 'fs';
import assert from 'assert';
const T = JSON.parse(fs.readFileSync('data/tabs.json'));
const at = tab => T.findIndex(t => t.tab === tab);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));

// topics, with landing pages and tabs the site already covers left out; infographic sheets link to the original
await p.goto('http://localhost:8765/#/ref'); await p.waitForSelector('#q');
assert.deepEqual(await p.$$eval('#app h3', hs => hs.map(h => h.textContent)), ['Weapons', 'Armor', 'Subclasses', 'Damage', 'Mechanics']);
const chips = await p.$$eval('#app .tabs a', as => as.map(a => a.textContent));
for (const gone of ['Landing', 'Orbit', 'Weekly Reset', 'Raid Loot', 'Vendors', 'Graphing (S29)', 'CATALYSTS']) assert.ok(!chips.includes(gone), gone);
assert.match(await p.getAttribute('a[title="Opens the original sheet"] >> text=Champion counters', 'href'), /^https:\/\/docs\.google\.com\//);

// a table loses the sheet's navigation cells and its empty columns
await p.goto(`http://localhost:8765/#/ref/${at('Arc')}`); await p.waitForSelector('#sheet table');
const arc = await p.innerText('#sheet');
assert.ok(arc.includes('Amplified') && !arc.includes('Go back to the top!') && !arc.includes('Support the Data Compendium'));
assert.ok(await p.$$eval('#sheet tr', rows => [...rows[0].cells].every((_, i) => rows.some(r => r.cells[i]?.textContent.trim()))), 'no empty columns');
// whole numbers lose the sheet's .0
await p.goto(`http://localhost:8765/#/ref/${at('Bosses')}`); await p.waitForSelector('#sheet table');
const bosses = await p.innerText('#sheet');
assert.ok(bosses.includes('299440') && !bosses.includes('299440.0'));

// one search across every table, linking back to each; clearing it shows the open table again
await p.fill('#q', 'kill clip');
assert.ok((await p.innerText('#refbody')).includes('Kill Clip'));
assert.equal(await p.getAttribute('#refbody h2 a >> text=Weapon perks', 'href'), `#/ref/${at('Weapon Perks')}`);
await p.fill('#q', 'zzzz no such perk');
assert.ok((await p.innerText('#refbody')).includes('Nothing in the tables matches'));
await p.fill('#q', '');
assert.ok((await p.innerText('#refbody')).includes('BOSS HEALTH'));

assert.deepEqual(errs, []);
await b.close();
console.log('reference tests passed');
