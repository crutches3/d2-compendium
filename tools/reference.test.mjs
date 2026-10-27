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
// smooth scroll over a long sheet can take a couple of seconds, so wait for it to land rather than a fixed time
await p.click('.refjump button:text-is("Warlocks")');
await p.waitForFunction(() => [...document.querySelectorAll('.refsec.major')].some(el => el.querySelector('h3')?.textContent === 'Warlocks' && Math.abs(el.getBoundingClientRect().top) < 120), null, { timeout: 5000 });
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

// a raid's drops link to the weapon page, which links back (raid, dungeon and mission pages have their own test: tools/raid.test.mjs)
await p.goto("http://localhost:8765/#/wiki/King's%20Fall"); await p.waitForSelector('.drop');
await p.click('.dropname:has(b:text-is("Defiance of Yasmin"))'); await p.waitForSelector('#obtain a.obtain');
assert.equal(await p.getAttribute('#obtain a.obtain', 'href'), "#/wiki/King's%20Fall");
// a perk on the weapon page offers the perk finder, not a wiki link
await p.click('.perk >> nth=0'); await p.waitForSelector('#perkinfo .findguns.primary');
assert.equal(await p.$('#perkinfo a'), null);
// how to get it: a card per source with its kind, the encounters that drop it and the wiki page
const cards = sel => p.$$eval(sel, cs => cs.map(c => [c.getAttribute('href'), c.querySelector('small').textContent, c.querySelector('b').textContent,
  [...c.querySelectorAll('.enc')].map(e => e.textContent), [...c.querySelectorAll('.ohow')].map(e => e.textContent)]));
const [yasmin] = await cards('#obtain .obtain');
assert.deepEqual(yasmin.slice(0, 3), ["#/wiki/King's%20Fall", 'Raid', "King's Fall"]);
assert.ok(yasmin[3].length > 0, 'King\'s Fall should name the encounters');
// armor: a dungeon's encounters for that slot (Llama's sheets), and a vendor with how it sells it
const A = JSON.parse(fs.readFileSync('data/armor.json')).armor, piece = (n, cl) => A.find(x => x.n === n && (!cl || x.cl === cl) && x.a3) || A.find(x => x.n === n);
await p.goto(`http://localhost:8765/#/armor/${piece("Apostate's Blade Mask").h}`); await p.waitForSelector('#obtain .obtain');
const apostate = await cards('#obtain .obtain');
assert.deepEqual(apostate.map(c => c.slice(0, 3)), [['#/wiki/Pit%20of%20Heresy', 'Dungeon', 'Pit of Heresy'], ['#/wiki/Ada-1', 'Vendor', 'Ada-1']]);
assert.ok(apostate[0][3].length > 0 && apostate[1][4].includes('Vendor Exclusive'), JSON.stringify(apostate));
// Bungie's own text links the activity it names, and keeps the text when it says more
await p.goto(`http://localhost:8765/#/weapon/${JSON.parse(fs.readFileSync('data/weapons.json')).weapons.find(w => w.n === 'Dimensional Hypotrochoid').h}`); await p.waitForSelector('#obtain .obtain');
assert.deepEqual((await cards('#obtain .obtain'))[0], ['#/wiki/Neomuna', 'Destination', 'Neomuna', [], ['Lightfall Campaign']]);
assert.deepEqual(await p.evaluate(async () => { const W = await wikiData();
  return ['Complete Iron Banner matches and earn rank-up packages from Lord Saladin.', 'Xûr', 'Exotic engrams; extremely rare world drops.', 'Complete activities and earn rank-up packages on Saturn\'s Moon, Titan.']
    .map(t => actsIn(W, t).map(x => x.name)); }), [['Iron Banner'], ['Xur'], [], []]);
// a wiki page for a gun shows the same cards beside its gun card, not inside it
await p.goto('http://localhost:8765/#/wiki/Fatebringer'); await p.waitForSelector('.obtains .obtain');
assert.equal(await p.$('a.card a'), null);
assert.equal(await p.getAttribute('.obtains a.obtain', 'href'), '#/wiki/Vault%20of%20Glass');
// armor sets link their source's activity
await p.goto('http://localhost:8765/#/sets'); await p.waitForSelector('#list section');
assert.equal(await p.getAttribute('#list section:has(h2 a:text-is("Apostate\'s Blade")) p.muted a', 'href'), '#/wiki/Pit%20of%20Heresy');

// pages look like gun pages: a banner with the raid's art, or the perk's icon and Bungie's description, and a perk's stat changes
await p.goto("http://localhost:8765/#/wiki/King's%20Fall"); await p.waitForSelector('.hero h1');
assert.match(await p.getAttribute('.hero', 'style'), /raid_kings_fall/);
await p.goto('http://localhost:8765/#/wiki/Arrowhead%20Brake'); await p.waitForSelector('.hero h1');
assert.ok(await p.$('.hero.plain .icon img') && (await p.textContent('.hero .flavor')).includes('vented'));
assert.deepEqual(await p.$$eval('.wside .deltas li', ls => ls.map(l => l.textContent)), ['+30 Recoil Direction', '+10 Handling']);

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
