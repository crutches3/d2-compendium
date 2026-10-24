// Browser test for the Wiki: the sheet pages without their clutter, one search across them, and a page for every name.
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
assert.deepEqual(await p.$$eval('#app h3', hs => hs.map(h => h.textContent)),
  ['Raids', 'Dungeons', 'Exotic missions', 'Portal', 'Destinations', 'Vendors', 'Champions', 'Weapons', 'Armor', 'Subclasses', 'Damage', 'Mechanics']);
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
assert.ok(await p.$('#sheet .entry:has(dt a:text-is("Resistance")) .badge:text-is("+10 Melee")'));
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
assert.ok((await p.innerText('#refbody')).includes('Nothing in the wiki matches'));
await p.fill('#q', '');
assert.ok((await p.innerText('#refbody')).includes('Boss health'));

// names in the sheets link to their wiki pages, except an entry's own name
await p.goto(`http://localhost:8765/#/ref/${at('Arc')}`); await p.waitForSelector('#sheet .entry');
assert.ok(await p.$('.entry:has(dt a:text-is("Bolt Charge"))') && !(await p.$('.entry:has(dt a:text-is("Bolt Charge")) dd a:text-is("Bolt Charge")')));
await p.click('#sheet dd a:text-is("Jolted")'); await p.waitForSelector('h1:text-is("Jolted")');

// a status: what it does, its tag, and every entry that mentions it
assert.deepEqual(await p.$$eval('.wikitags .badge', bs => bs.map(x => x.textContent)), ['Arc']);
assert.ok((await p.innerText('.entry dd')).includes('chain lightning'));
assert.ok(await p.$('ul.mentions a:text-is("Ions")'));
assert.equal(await p.textContent('ul.mentions li:has(a:text-is("Ions")) mark'), 'Jolted');

// a raid: its loot and which encounters drop each piece, linked to the weapon page, which links back
await p.goto("http://localhost:8765/#/wiki/King's%20Fall"); await p.waitForSelector('table.data');
assert.deepEqual(await p.$$eval('table.data th', ths => ths.map(x => x.textContent)), ['Item', 'Type', 'Element', 'Encounters']);
assert.equal(await p.textContent('tr:has(a.lootname:text-is("Defiance of Yasmin")) td:last-child'), '2nd, 4th, 5th');
await p.click('a.lootname:text-is("Defiance of Yasmin")'); await p.waitForSelector('#farmsrc a');
assert.equal(await p.getAttribute('#farmsrc a', 'href'), "#/wiki/King's%20Fall");
// a perk on the weapon page links to its wiki page
await p.click('.perk >> nth=0'); await p.waitForSelector('#perkinfo a');
assert.match(await p.textContent('#perkinfo a'), /^Everything about .+ in the wiki$/);

// a dungeon's encounters come from Llama's sheet
await p.goto('http://localhost:8765/#/wiki/Equilibrium'); await p.waitForSelector('table.data');
assert.match(await p.textContent('tr:has(a.lootname:text-is("Bitter End")) td:last-child'), /Harrow, Dredgen Sere/);

// a perk: one tag, and the weapons that can roll it, 24 at first
await p.goto('http://localhost:8765/#/wiki/Kill%20Clip'); await p.waitForSelector('#rollers .card');
assert.deepEqual(await p.$$eval('.wikitags .badge', bs => bs.map(x => x.textContent)), ['Weapon perks']);
assert.equal((await p.$$('#rollers .card')).length, 24);
const all = +(await p.textContent('#morerollers')).match(/\d+/)[0];
await p.click('#morerollers'); assert.equal((await p.$$('#rollers .card')).length, all);

// a champion type: the counters sheet and what stuns it
await p.goto('http://localhost:8765/#/wiki/Unstoppable'); await p.waitForSelector('ul.mentions');
assert.match(await p.getAttribute('a:text("Champion counters sheet")', 'href'), /^https:\/\/docs\.google\.com\//);
assert.ok(await p.$("ul.mentions a:text-is(\"Athrys's Embrace\")"));

// the home search finds pages by name; an unknown name says so
await p.goto('http://localhost:8765/#/wiki'); await p.waitForSelector('#q');
await p.fill('#q', 'king');
assert.equal(await p.getAttribute('#refbody a:text-is("King\'s Fall")', 'href'), "#/wiki/King's%20Fall");
await p.goto('http://localhost:8765/#/wiki/Nothing%20Here'); await p.waitForSelector('.empty');

assert.deepEqual(errs, []);
await b.close();
console.log('reference tests passed');
