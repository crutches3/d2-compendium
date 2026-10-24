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

// a sheet reads as entries under headings, without the sheet's navigation cells
await p.goto(`http://localhost:8765/#/ref/${at('Arc')}`); await p.waitForSelector('#sheet .entry');
const arc = await p.innerText('#sheet');
assert.ok(!arc.includes('Go back to the top!') && !arc.includes('Support the Data Compendium') && !(await p.$('#sheet table')));
assert.equal(await p.textContent('#sheet .entry dt b'), 'Amplified');
assert.ok((await p.textContent('#sheet .entry dd')).includes('Intrinsic Arc Subclass Buff'));
// a fact next to a name, like a fragment's stat change
assert.ok(await p.$('#sheet .entry:has(b:text-is("Resistance")) .badge:text-is("+10 Melee")'));
// the class sections can be jumped to
assert.deepEqual(await p.$$eval('.refjump button', bs => bs.map(x => x.textContent)), ['Hunter', 'Titan', 'Warlocks']);
await p.click('.refjump button:text-is("Warlocks")'); await p.waitForTimeout(800);
assert.ok(await p.$eval('.refsec.major:has(h3:text-is("Warlocks"))', el => Math.abs(el.getBoundingClientRect().top) < 120));
// side-by-side sheets: each exotic shows its perk under its name, split by class; armor mods by slot, the two raid columns as one group
await p.goto(`http://localhost:8765/#/ref/${at('Exotic Armors')}`); await p.waitForSelector('#sheet .entry');
assert.equal(await p.innerText('#sheet .entry dt'), "Assassin's Cowl\nVanishing Execution");
assert.deepEqual(await p.$$eval('.refjump button', bs => bs.map(x => x.textContent)), ['Hunters', 'Titans', 'Warlocks']);
await p.goto(`http://localhost:8765/#/ref/${at('Armor Mods')}`); await p.waitForSelector('#sheet .entry');
const groups = await p.$$eval('.refsec h3', hs => hs.map(h => h.textContent));
assert.ok(groups.includes('Helmet') && groups.includes("Crota's End") && !groups.includes('Raid Specific'), groups.join());
// number-heavy sheets stay tables, with whole numbers losing the sheet's .0 and numbers lined up right
await p.goto(`http://localhost:8765/#/ref/${at('Bosses')}`); await p.waitForSelector('#sheet table.data');
const bosses = await p.innerText('#sheet');
assert.ok(bosses.includes('299440') && !bosses.includes('299440.0'));
assert.equal(await p.$eval('#sheet td:text-is("299440")', td => getComputedStyle(td).textAlign), 'right');

// one search across every table, linking back to each; clearing it shows the open table again
await p.fill('#q', 'kill clip');
assert.ok((await p.innerText('#refbody')).includes('Kill Clip'));
assert.equal(await p.textContent('#refbody mark'), 'Kill Clip');
assert.equal(await p.getAttribute('#refbody h2 a >> text=Weapon perks', 'href'), `#/ref/${at('Weapon Perks')}`);
await p.fill('#q', 'zzzz no such perk');
assert.ok((await p.innerText('#refbody')).includes('Nothing in the tables matches'));
await p.fill('#q', '');
assert.ok((await p.innerText('#refbody')).includes('Boss health'));

assert.deepEqual(errs, []);
await b.close();
console.log('reference tests passed');
