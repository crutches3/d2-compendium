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
assert.equal(await p.textContent('.hero .badge.craft'), 'Craftable');  // signed out, no pattern progress
// the masterwork stacks under a one-choice frame instead of taking a column; its picks still count toward the stats
const colHeads = () => p.$$eval('.perkcol', cs => cs.map(c => [...c.querySelectorAll('h3')].map(h => h.textContent).join(' + ')));
assert.deepEqual(await colHeads(), ['Intrinsic + Masterwork', 'Barrel', 'Magazine', 'Trait', 'Trait']);
await p.click('.perkcol .stacked .perk:has-text("Handling")'); await p.hover('.hero');
assert.match(await stat('Handling'), /^Handling \d+ \+\d+$/);
await p.click('.perkcol .stacked .perk:has-text("Handling")'); await p.hover('.hero');
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
// no curated roll anywhere
assert.equal(await p.$('#curated, .perk.cur'), null);

// a frame with many choices (Barrow-Dyad's five Panic Responses) keeps its column to itself
await p.goto(`http://localhost:8765/#/weapon/${W.find(w => w.n === 'Barrow-Dyad').h}`); await p.waitForSelector('.perkcol');
assert.equal(await p.$('.perkcol .stacked'), null);
assert.equal((await colHeads())[0], 'Intrinsic');
// the weapon list's craftable filter
await p.goto('http://localhost:8765/#/weapons'); await p.waitForSelector('#list .card');
await p.selectOption('#cr', 'yes'); assert.equal(await p.locator('#list .card .icon.craftable').count(), await p.locator('#list .card').count()); assert.equal(await p.textContent('#count'), '219 weapons');
await p.selectOption('#cr', 'no'); assert.equal(await p.locator('#list .card .icon.craftable').count(), 0); assert.ok(!(await p.innerText('#list')).includes('Defiance of Yasmin'));
// retired versions (reissued since) are left out of lists, but their page still opens and says so
const coup = W.filter(w => w.n === 'Midnight Coup'), oldCoup = coup.find(w => w.old);
assert.ok(oldCoup && coup.some(w => !w.old));
await p.selectOption('#cr', ''); await p.fill('#q', 'midnight coup');
const hrefs = await p.$$eval('#list .card', cs => cs.map(c => (c.closest('a') || c.querySelector('a')).getAttribute('href')));
assert.ok(hrefs.length && hrefs.every(h => !coup.find(w => w.old && h.endsWith('/' + w.h))), hrefs.join());
await p.goto(`http://localhost:8765/#/weapon/${oldCoup.h}`); await p.waitForSelector('.versions');
assert.match(await p.innerText('#app'), /Retired version/);

// the Endgame Analysis ranking sits beside how to get it, above the perks
await p.goto(`http://localhost:8765/#/weapon/${W.find(w => w.n === 'Fatebringer' && !w.old).h}`); await p.waitForSelector('#bossshot .brow');
assert.deepEqual(await p.$$eval('.toprow > section', ss => ss.map(x => x.id)), ['obtain', 'endgame']);
assert.match(await p.textContent('#endgame'), /#\d+ of \d+/);
// boss damage per shot: its frame (Adaptive) is marked among primary hand cannons, with the average and every setup in a table
const bars = id => p.$$eval(`#${id} .brow`, rs => rs.map(r => [r.querySelector('.bname').textContent.trim(), +r.querySelector('.bval').textContent.replace(/,/g, ''), r.classList.contains('me')]));
const fate = await bars('bossshot');
assert.ok(fate.some(([n, , me]) => n.startsWith('Adaptive frame') && me) && fate.filter(x => x[2]).length === 1, JSON.stringify(fate));
assert.ok(fate.every((x, i) => !i || fate[i - 1][1] >= x[1]), 'bars biggest first');
assert.match(await p.innerText('#bossshot .bhead'), /for its frame \(Adaptive frame\) · \d+\w\w of \d+ primary hand cannons · \d+% (above|below) their average/);
assert.ok(await p.$$eval('#bossshot .btable tbody tr', rs => rs.length) >= fate.length);
// sustained DPS: a gun the sheet tested by name gets its own bar, first among heavy rocket launchers
await p.goto(`http://localhost:8765/#/weapon/${W.find(w => w.n === 'Bellowing Giant' && !w.old).h}`); await p.waitForSelector('#bossdps .brow');
const giant = await bars('bossdps');
assert.deepEqual(giant[0].slice(0, 1).concat(giant[0][2]), ['Bellowing Giant this gun', true]);
assert.match(await p.innerText('#bossdps .bhead'), /^\s*[\d,]+ DPS · 1st of \d+ heavy rocket launchers/);
// the sheet's setup shows on hover and keyboard focus
await p.focus('#bossdps .brow >> nth=1'); assert.ok(await p.isVisible('#bossdps .brow:nth-child(2) .btip'));
assert.deepEqual(errs, []);
await b.close();
console.log('weapon tests passed');
