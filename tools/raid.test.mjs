// Browser test for raid, dungeon, exotic mission and destination pages: drop cards from Llama's Raid Loot (named encounters, adept and catalyst notes), filters, the rotation,
// and, against a mocked Bungie API, which drops you own. Pinned to week 20 (Oct 20 2026 reset: King's Fall featured).
// Run from the repo root: python3 -m http.server 8765 & npm i --no-save playwright && node tools/raid.test.mjs
import { chromium } from 'playwright';
import fs from 'fs';
import assert from 'assert';
const W = JSON.parse(fs.readFileSync('data/weapons.json')).weapons;
const R = JSON.parse(fs.readFileSync('data/godrolls.json')).rolls;
const rated = n => W.find(w => w.n === n && R[w.h]?.c?.length);
const A = JSON.parse(fs.readFileSync('data/armor.json')), mask = A.armor.find(x => x.n === 'Darkhollow Mask');
const doom = rated('Doom of Chelchis'), zaouli = W.find(w => w.n === "Zaouli's Bane (Harrowed)");
const profile = {
  characters: { data: { H1: { classType: 1, light: 480 } } },
  profileInventory: { data: { items: [{ itemHash: doom.h, itemInstanceId: '1', bucketHash: 138197802 }, { itemHash: zaouli.h, itemInstanceId: '2', bucketHash: 138197802 },
    { itemHash: mask.h, itemInstanceId: '3', bucketHash: 138197802 }] } },
  characterInventories: { data: { H1: { items: [] } } }, characterEquipment: { data: { H1: { items: [] } } },
  // the Doom of Chelchis copy has a Perk 1 and a Perk 2 pick (a god roll); the adept Zaouli's Bane has no perks
  itemComponents: { sockets: { data: { 1: { sockets: R[doom.h].c.map(col => ({ plugHash: col[0] })) }, 2: { sockets: [] } } }, reusablePlugs: { data: {} }, instances: { data: { 3: { gearTier: 4 } } }, stats: { data: {} } },
};
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.route('https://www.bungie.net/Platform/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ErrorCode: 1,
  Response: route.request().url().includes('GetMemberships') ? { primaryMembershipId: '1', destinyMemberships: [{ membershipId: '1', membershipType: 3 }], bungieNetUser: { uniqueName: 'Randy#1234' } } : profile }) }));
const p = await ctx.newPage();
await p.clock.setFixedTime(new Date('2026-10-23T12:00:00Z'));
const errs = []; p.on('pageerror', e => errs.push(e.message));
const card = n => `.drop:has(.dropname b:text-is("${n}"))`;
// the wiki routes by hash, so wait for the new page's title rather than cards the last page also had
const openWiki = async name => { await p.goto(`http://localhost:8765/#/wiki/${encodeURIComponent(name)}`); await p.waitForSelector(`.hero h1:text-is("${name}")`); };
const visible = (sel = '.drop[data-h]') => p.$$eval(sel, cs => cs.filter(c => !c.hidden).map(c => c.querySelector('b').textContent));

// signed out: every drop as a card with its picture and named encounters, Llama's spelling linked to the game's weapon
await p.goto("http://localhost:8765/#/wiki/King's%20Fall"); await p.waitForSelector('.drop');
assert.deepEqual(await p.$$eval('.drop[data-h] .dropname b', bs => bs.map(x => x.textContent)),
  ['Defiance of Yasmin', 'Doom of Chelchis', "Midha's Reckoning", "Qullim's Terminus", 'Smite of Merain', "Zaouli's Bane", 'Touch of Malice']);
assert.deepEqual(await p.$$eval(`${card('Defiance of Yasmin')} .enc`, es => es.map(x => x.textContent)), ['Warpriest', 'Daughters', 'Oryx']);
assert.match(await p.getAttribute(`${card("Qullim's Terminus")} .dropname`, 'href'), /^#\/weapon\/\d+$/);
assert.match(await p.getAttribute(`${card('Defiance of Yasmin')} .dropart img`, 'src'), /screenshots/);
assert.ok((await p.innerText(card('Defiance of Yasmin'))).includes('Adept: Master encounter challenges'));
assert.ok((await p.innerText(card('Touch of Malice'))).includes('Catalyst: Raid Puzzles'));
// encounters in order, each filtering the cards
// the small icon sits beside the name, not pushed down under it
assert.ok(await p.$eval(`${card('Defiance of Yasmin')} .dropname`, a => { const i = a.querySelector('.icon img').getBoundingClientRect(), b = a.querySelector('.icon').getBoundingClientRect(); return Math.abs(i.top - b.top) < 4; }));
// encounters in order (counting weapons and armor slots), each filtering the cards
assert.deepEqual(await p.$$eval('.dropfilter button[data-enc]', bs => bs.slice(1).map(x => x.textContent.replace(/\s+/g, ' ').trim())),
  ['1Totems 4', '2Warpriest 5', '3Golgoroth 4', '4Daughters 6', '5Oryx 9']);
await p.click('.dropfilter button[data-enc="Golgoroth"]');
assert.deepEqual(await visible(), ['Doom of Chelchis', "Midha's Reckoning"]);
await p.click('.dropfilter button[data-enc=""]'); assert.equal((await visible()).length, 7);
assert.ok(!(await p.isVisible('#ownfilter')));
// armor as cards too, one class at a time: each piece with its picture and the encounters Llama lists for its slot
assert.deepEqual(await visible('.drop[data-a]'), ['Darkhollow Mask', 'Darkhollow Grasps', 'Darkhollow Chiton', 'Darkhollow Treads', 'Darkhollow Mantle']);
assert.deepEqual(await p.$$eval(`${card('Darkhollow Mask')} .enc`, es => es.map(x => x.textContent)), ['Golgoroth', 'Oryx']);
assert.match(await p.getAttribute(`${card('Darkhollow Mask')} .dropname`, 'href'), new RegExp(`^#/armor/${mask.h}$`));
await p.click('.dropfilter button[data-cls="Titan"]'); assert.equal((await visible('.drop[data-a]')).length, 5);
assert.ok(!(await visible('.drop[data-a]')).includes('Darkhollow Mask'));
await p.click('.dropfilter button[data-enc="Golgoroth"]'); assert.equal((await visible('.drop[data-a]')).length, 2);
await p.click('.dropfilter button[data-enc=""]'); await p.click('.dropfilter button[data-cls="Hunter"]');
// the rotation and Llama's notes
assert.ok(await p.$('.hero .badge:text-is("Featured this week")'));
assert.match(await p.innerText('.wside'), /Featured this week, with Master\./);
assert.ok((await p.innerText('.wside')).includes('has a vendor after defeating Oryx'));

// signed in: what's in the vault, adept copies counted with their weapon, and the best copy's roll
await p.evaluate(() => localStorage.setItem('d2c_token', JSON.stringify({ access_token: 'x', expires_at: Date.now() + 3e6 })));
await p.reload(); await p.waitForSelector(`${card('Doom of Chelchis')} .own .have`);
assert.match(await p.innerText(`${card('Doom of Chelchis')} .own`), /^You have 1/);
assert.ok(await p.$(`${card('Doom of Chelchis')} .own .pips.g-god`));
assert.equal(await p.innerText(`${card("Zaouli's Bane")} .own .have`), 'You have 1 · 1 adept');
assert.equal(await p.innerText(`${card('Defiance of Yasmin')} .own`), 'Not in your vault');
assert.match(await p.innerText('#raidmine'), /2 of 7 weapons, 1 with a god roll\.\s+1 of 15 armor pieces/);
assert.equal(await p.innerText(`${card('Darkhollow Mask')} .own`), 'You have 1\nBest: Tier 4');
assert.equal(await p.innerText(`${card('Darkhollow Grasps')} .own`), 'Not in your vault');
await p.click('#ownfilter button[data-own="need"]'); assert.equal((await visible()).length, 5); assert.equal((await visible('.drop[data-a]')).length, 4);
await p.click('#ownfilter button[data-own="have"]'); assert.deepEqual(await visible(), ['Doom of Chelchis', "Zaouli's Bane"]); assert.deepEqual(await visible('.drop[data-a]'), ['Darkhollow Mask']);
await p.click('.dropfilter button[data-enc="Golgoroth"]'); assert.deepEqual(await visible(), ['Doom of Chelchis']);

// Desert Perpetual: one page for Standard and Epic, Epic-only drops marked
await p.goto('http://localhost:8765/#/wiki/Desert%20Perpetual%20%26%20Epic%20DP'); await p.waitForSelector('.drop');
assert.ok(await p.$(`${card('Cusp Sempiternal')} .badge:text-is("Epic only")`));
assert.ok(!(await p.$(`${card('Antedate')} .badge:text-is("Epic only")`)));
// its Standard and Epic armor sets, each with its own encounters
assert.equal((await visible('.drop[data-a]')).length, 10);
assert.ok(await p.$('.drop[data-a]:not([hidden]) .badge:text-is("Epic only")'));

// a dungeon gets the same page: Llama's Dungeon Loot encounters, attunement and catalyst notes, its armor, and the rotation
await openWiki('Equilibrium');
assert.deepEqual(await p.$$eval(`${card('Bitter End')} .enc`, es => es.map(x => x.textContent)), ['Harrow', 'Dredgen Sere']);
assert.ok((await p.innerText(card('Bitter End'))).includes('Also Assault if attuned'));
assert.ok(await p.$(`${card('Heirloom')} .badge:text-is("Exotic")`) && (await p.innerText(card('Heirloom'))).includes('Catalyst:'));
assert.deepEqual(await visible('.drop[data-a]'), ['Sage Protector Cowl', 'Sage Protector Grips', 'Sage Protector Vest', 'Sage Protector Strides', 'Sage Protector Cloak']);
assert.match(await p.innerText('.wside'), /Featured this week/);
// an exotic mission: the Monument's list plus its exotic, with no encounters or rotation, and the mission's banner rather than the Encore perk's icon
await openWiki('Encore');
assert.ok(await p.$(`${card('Choir of One')} .badge:text-is("Exotic")`));
assert.equal((await visible('.drop[data-a]')).length, 5);
assert.ok(!(await p.$('.dropfilter button[data-enc]')) && !(await p.$$eval('.wside h2', hs => hs.map(h => h.textContent))).includes('Rotation'));
assert.ok(!(await p.$('.hero .icon')) && !(await p.$('.hero .flavor')));

// a destination: its surface weapons and armor sets, public events with how to make each Heroic, lost sectors with entrances, and Distortions
await openWiki('European Dead Zone');
assert.equal((await visible()).length, 6);
assert.deepEqual(await visible('.drop[data-a]'), ['Wildwood Mask', 'Wildwood Grips', 'Wildwood Vest', 'Wildwood Strides', 'Wildwood Cloak']);
assert.ok((await p.innerText('.entry:has(b:text-is("Glimmer Extraction"))')).includes('Destroy all three'));
assert.equal(await p.$$eval('.drop.lost', cs => cs.length), 4);
assert.ok((await p.innerText('.drop.lost:has(b:text-is("Excavation Site XII"))')).includes('Entrance: Firebase Hades'));
assert.ok(await p.$('.drop.lost a.badge[href="#/wiki/Barrier"]'));
assert.ok(await p.$('.hero .badge:text-is("Distortions")') && (await p.innerText('.wside')).includes('Distortion Breaches'));
// Nessus's banner comes from its patrol zone; the Lawless Frontier has no public events or lost sectors, just its jobs, and two armor sets one after the other
await openWiki('Nessus');
assert.match(await p.getAttribute('.hero', 'style'), /patrol_nessus/);
await openWiki('The Lawless Frontier');
assert.deepEqual((await visible('.drop[data-a]')).slice(0, 3), ['Shrewd Survivor Cowl', 'Shrewd Survivor Grips', 'Shrewd Survivor Vest']);
assert.ok(!(await p.$('.drop.lost')) && !(await p.$('.hero .badge:text-is("Distortions")')));
assert.ok(await p.$('.entry b:text-is("Invasions")'));
// a sheet's typo two letters off still finds the gun, shown under Bungie's name
await openWiki('Neomuna');
assert.match(await p.getAttribute(`${card('Dimensional Hypotrochoid')} .dropart img`, 'src'), /screenshots/);

assert.deepEqual(errs, []);
await b.close();
console.log('raid tests passed');
