// Browser test for raid pages: drop cards from Llama's Raid Loot (named encounters, adept and catalyst notes), filters, the rotation,
// and, against a mocked Bungie API, which drops you own. Pinned to week 20 (Oct 20 2026 reset: King's Fall featured).
// Run from the repo root: python3 -m http.server 8765 & npm i --no-save playwright && node tools/raid.test.mjs
import { chromium } from 'playwright';
import fs from 'fs';
import assert from 'assert';
const W = JSON.parse(fs.readFileSync('data/weapons.json')).weapons;
const R = JSON.parse(fs.readFileSync('data/godrolls.json')).rolls;
const rated = n => W.find(w => w.n === n && R[w.h]?.c?.length);
const doom = rated('Doom of Chelchis'), zaouli = W.find(w => w.n === "Zaouli's Bane (Harrowed)");
const profile = {
  characters: { data: { H1: { classType: 1, light: 480 } } },
  profileInventory: { data: { items: [{ itemHash: doom.h, itemInstanceId: '1', bucketHash: 138197802 }, { itemHash: zaouli.h, itemInstanceId: '2', bucketHash: 138197802 }] } },
  characterInventories: { data: { H1: { items: [] } } }, characterEquipment: { data: { H1: { items: [] } } },
  // the Doom of Chelchis copy has a Perk 1 and a Perk 2 pick (a god roll); the adept Zaouli's Bane has no perks
  itemComponents: { sockets: { data: { 1: { sockets: R[doom.h].c.map(col => ({ plugHash: col[0] })) }, 2: { sockets: [] } } }, reusablePlugs: { data: {} }, instances: { data: {} }, stats: { data: {} } },
};
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.route('https://www.bungie.net/Platform/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ErrorCode: 1,
  Response: route.request().url().includes('GetMemberships') ? { primaryMembershipId: '1', destinyMemberships: [{ membershipId: '1', membershipType: 3 }], bungieNetUser: { uniqueName: 'Randy#1234' } } : profile }) }));
const p = await ctx.newPage();
await p.clock.setFixedTime(new Date('2026-10-23T12:00:00Z'));
const errs = []; p.on('pageerror', e => errs.push(e.message));
const card = n => `.drop:has(.dropname b:text-is("${n}"))`;
const visible = () => p.$$eval('.drop', cs => cs.filter(c => !c.hidden).map(c => c.querySelector('b').textContent));

// signed out: every drop as a card with its picture and named encounters, Llama's spelling linked to the game's weapon
await p.goto("http://localhost:8765/#/wiki/King's%20Fall"); await p.waitForSelector('.drop');
assert.deepEqual(await p.$$eval('.drop .dropname b', bs => bs.map(x => x.textContent)),
  ['Defiance of Yasmin', 'Doom of Chelchis', "Midha's Reckoning", "Qullim's Terminus", 'Smite of Merain', "Zaouli's Bane", 'Touch of Malice']);
assert.deepEqual(await p.$$eval(`${card('Defiance of Yasmin')} .enc`, es => es.map(x => x.textContent)), ['Warpriest', 'Daughters', 'Oryx']);
assert.match(await p.getAttribute(`${card("Qullim's Terminus")} .dropname`, 'href'), /^#\/weapon\/\d+$/);
assert.match(await p.getAttribute(`${card('Defiance of Yasmin')} .dropart img`, 'src'), /screenshots/);
assert.ok((await p.innerText(card('Defiance of Yasmin'))).includes('Adept: Master encounter challenges'));
assert.ok((await p.innerText(card('Touch of Malice'))).includes('Catalyst: Raid Puzzles'));
// encounters in order, each filtering the cards
assert.deepEqual(await p.$$eval('.dropfilter button[data-enc]', bs => bs.slice(1).map(x => x.textContent.replace(/\s+/g, ' ').trim())),
  ['1Totems 2', '2Warpriest 3', '3Golgoroth 2', '4Daughters 4', '5Oryx 7']);
await p.click('.dropfilter button[data-enc="Golgoroth"]');
assert.deepEqual(await visible(), ['Doom of Chelchis', "Midha's Reckoning"]);
await p.click('.dropfilter button[data-enc=""]'); assert.equal((await visible()).length, 7);
assert.ok(!(await p.isVisible('#ownfilter')));
// armor by slot, the rotation and Llama's notes
assert.deepEqual(await p.$$eval('.armordrops dt:text-is("Helm") + dd .enc', es => es.map(x => x.textContent)), ['Golgoroth', 'Oryx']);
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
assert.match(await p.innerText('#raidmine'), /2 of 7 drops in your vault, 1 with a god roll\./);
await p.click('#ownfilter button[data-own="need"]'); assert.equal((await visible()).length, 5);
await p.click('#ownfilter button[data-own="have"]'); assert.deepEqual(await visible(), ['Doom of Chelchis', "Zaouli's Bane"]);
await p.click('.dropfilter button[data-enc="Golgoroth"]'); assert.deepEqual(await visible(), ['Doom of Chelchis']);

// Desert Perpetual: one page for Standard and Epic, Epic-only drops marked
await p.goto('http://localhost:8765/#/wiki/Desert%20Perpetual%20%26%20Epic%20DP'); await p.waitForSelector('.drop');
assert.ok(await p.$(`${card('Cusp Sempiternal')} .badge:text-is("Epic only")`));
assert.ok(!(await p.$(`${card('Antedate')} .badge:text-is("Epic only")`)));

assert.deepEqual(errs, []);
await b.close();
console.log('raid tests passed');
