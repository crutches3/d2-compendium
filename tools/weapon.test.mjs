// Browser test for the weapon page's stats: hovering a perk previews its stat changes, clicking builds a roll, the curve stats (magazine) follow Bungie's scaling.
// Run from the repo root: python3 -m http.server 8765 & npm i --no-save playwright && node tools/weapon.test.mjs
import { chromium } from 'playwright';
import fs from 'fs';
import assert from 'assert';
const W = JSON.parse(fs.readFileSync('data/weapons.json')).weapons;
const yasmin = W.find(w => w.n === 'Defiance of Yasmin');
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
const stat = async n => (await p.innerText(`#statrows .stat[data-stat="${n}"]`)).replace(/\s+/g, ' ').trim();

await p.goto(`http://localhost:8765/#/weapon/${yasmin.h}`); await p.waitForSelector('#statrows .stat');
assert.equal(await stat('Handling'), 'Handling 46');
// hover: Arrowhead Brake's +30 recoil and +10 handling show on the bars and in a card beside the perk
await p.hover('.perk:has-text("Arrowhead Brake")');
assert.equal(await stat('Handling'), 'Handling 56 +10');
assert.equal(await stat('Recoil Direction'), 'Recoil Direction 92 +30');
assert.ok(await p.$('#statrows .stat[data-stat="Handling"] .bar .more.up'));
assert.ok(await p.isVisible('#perktip'));
assert.deepEqual(await p.$$eval('#perktip li', ls => ls.map(l => l.textContent)), ['+30 Recoil Direction', '+10 Handling']);
await p.hover('.hero'); assert.equal(await stat('Handling'), 'Handling 46'); assert.ok(!(await p.isVisible('#perktip')));
// a pick stays; magazine follows the weapon's curve (+10 investment is one more round here), not +10 rounds
await p.click('.perk:has-text("Tactical Mag")'); await p.hover('.hero');
assert.equal(await stat('Magazine'), 'Magazine 5 +1');
// a second pick in the same column replaces the first; hovering a perk in that column swaps it in for the preview
await p.click('.perk:has-text("Extended Mag")'); await p.hover('.hero');
assert.equal(await p.$$eval('.perk.sel', s => s.length), 1);
assert.match(await stat('Reload Speed'), /−20$/);
await p.hover('.perk:has-text("Accurized Rounds")'); assert.equal(await stat('Reload Speed'), 'Reload Speed 42');
await p.click('#clearroll'); await p.hover('.hero');
assert.equal(await stat('Magazine'), 'Magazine 4'); assert.ok(await p.isDisabled('#clearroll'));
// the curated roll picks every curated perk
await p.click('#curated');
assert.equal(await p.$$eval('.perk.sel', s => s.length), await p.$$eval('.perk.cur', s => s.length));

assert.deepEqual(errs, []);
await b.close();
console.log('weapon tests passed');
