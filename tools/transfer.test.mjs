// Browser test for the Transfer page against a mocked Bungie API.
// Run from the repo root: python3 -m http.server 8765 & npm i --no-save playwright && node tools/transfer.test.mjs
import { chromium } from 'playwright';
import fs from 'fs';
import assert from 'assert';
const OUT = (await import('os')).tmpdir() + '/';
const W = JSON.parse(fs.readFileSync('data/weapons.json')).weapons;
const A = JSON.parse(fs.readFileSync('data/armor.json'));
const fate = W.find(w => w.n === 'Fatebringer'), gjally = W.find(w => w.n === 'Gjallarhorn'), ace = W.find(w => w.n === 'Ace of Spades');
const helm = A.armor.find(x => x.a3 && x.cl === 'Titan' && x.ty === 'Helmet');
const hunterHelm = A.armor.find(x => x.a3 && x.cl === 'Hunter' && x.ty === 'Helmet');
const energy = W.find(w => w.sl === 'Energy' && w.ti === 'Legendary'), kinetic = W.find(w => w.sl === 'Kinetic' && w.ti === 'Legendary' && w !== fate);
const profile = {
  characters: { data: { T1: { classType: 0, light: 481 }, W1: { classType: 2, light: 476 } } },
  profileInventory: { data: { items: [{ itemHash: fate.h, itemInstanceId: '1', bucketHash: 138197802 }, { itemHash: hunterHelm.h, itemInstanceId: '5', bucketHash: 138197802 }] } },
  characterInventories: { data: { T1: { items: [{ itemHash: gjally.h, itemInstanceId: '2', bucketHash: 953998645 },
    // the Titan's Postmaster: two weapons and a stack of materials (no instance, so it only counts toward the 21)
    { itemHash: energy.h, itemInstanceId: '6', bucketHash: 215593132 }, { itemHash: kinetic.h, itemInstanceId: '7', bucketHash: 215593132 }, { itemHash: 1, quantity: 5, bucketHash: 215593132 }] }, W1: { items: [] } } },
  characterEquipment: { data: { T1: { items: [{ itemHash: ace.h, itemInstanceId: '3', bucketHash: 1498876634 }, { itemHash: helm.h, itemInstanceId: '4', bucketHash: 3448274439 }] }, W1: { items: [] } } },
  itemComponents: { sockets: { data: {} }, reusablePlugs: { data: {} }, instances: { data: {} }, stats: { data: {} } },
};
const posts = [];
let failNext = false;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const api = route => {
  const r = route.request(), u = r.url();
  if (r.method() === 'POST') {
    posts.push([u.split('/Items/')[1], JSON.parse(r.postData())]);
    if (failNext) { failNext = false; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ErrorCode: 1642, ErrorStatus: 'DestinyNoRoomInDestination', Message: 'There are no item slots available to transfer this item.' }) }); }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ErrorCode: 1, Response: 0 }) });
  }
  const body = u.includes('GetMemberships') ? { primaryMembershipId: '1', destinyMemberships: [{ membershipId: '1', membershipType: 3 }], bungieNetUser: { uniqueName: 'Randy#1234' } } : profile;
  route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ErrorCode: 1, Response: body }) });
};
await ctx.route('https://www.bungie.net/Platform/**', api);
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:8765/'); await p.evaluate(() => localStorage.setItem('d2c_token', JSON.stringify({ access_token: 'x', expires_at: Date.now() + 3e6 })));
await p.goto('http://localhost:8765/#/inventory/move'); await p.waitForTimeout(3000);
const placeOf = async id => p.$eval(`.tile[data-id="${id}"]`, t => t.closest('.cell').dataset.owner);
assert.equal(await placeOf('1'), 'vault');
// each item sits in its own slot row
assert.equal(await p.$eval('.tile[data-id="4"]', t => t.closest('.cell').dataset.slot), 'Helmet');
assert.equal(await p.$eval('.tile[data-id="2"]', t => t.closest('.cell').dataset.slot), 'Power');
// vault -> Warlock (one transfer)
await p.click('.tile[data-id="1"]'); await p.click('button[data-move="W1"]'); await p.waitForTimeout(300);
assert.equal(await placeOf('1'), 'W1');
assert.deepEqual(posts.at(-1), ['TransferItem/', { itemReferenceHash: fate.h, stackSize: 1, transferToVault: false, itemId: '1', characterId: 'W1', membershipType: 3 }]);
// the page only moves: no equip buttons
assert.equal(await p.$$eval('#actions button', bs => bs.map(x => x.textContent).join('|')), 'To Vault|To Titan|Close');
// Warlock -> Titan goes through the vault (two transfers) and equips nothing
posts.length = 0;
await p.click('button[data-move="T1"]'); await p.waitForTimeout(300);
assert.deepEqual(posts.map(x => [x[0], x[1].transferToVault, x[1].characterId]), [['TransferItem/', true, 'W1'], ['TransferItem/', false, 'T1']]);
assert.equal(await placeOf('1'), 'T1');
assert.equal(await p.$eval('.tile[data-id="1"]', t => t.classList.contains('equipped')), false);
assert.equal(await p.$eval('.tile[data-id="3"]', t => t.classList.contains('equipped')), true);
// equipped items can't move
await p.click('.tile[data-id="4"]');
assert.equal(await p.$eval('#actions', bar => [...bar.querySelectorAll('button[data-move]')].every(x => x.disabled)), true);
// hunter armor only offers the Hunter... and there is no hunter, so only Vault-less: no targets
await p.click('.tile[data-id="5"]');
assert.equal(await p.$$eval('#actions button[data-move]', bs => bs.length), 0);
// a Bungie error is shown and the item stays put
failNext = true;
await p.click('.tile[data-id="2"]'); await p.click('button[data-move="W1"]'); await p.waitForTimeout(300);
assert.match(await p.textContent('#actions .err'), /no item slots/);
assert.equal(await placeOf('2'), 'T1');
// drag and drop with the mouse: onto the vault's cell in the item's row moves it there
const dragTo = async (id, sel) => {
  const from = await p.$eval(`.tile[data-id="${id}"]`, t => { const r = t.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  const to = await p.$eval(sel, t => { const r = t.getBoundingClientRect(); return [r.x + Math.min(r.width / 2, 40), r.y + Math.min(r.height / 2, 30)]; });
  await p.mouse.move(...from); await p.mouse.down(); await p.mouse.move(from[0] + 10, from[1] + 10, { steps: 3 }); await p.mouse.move(...to, { steps: 8 });
  const hint = await p.$eval(sel, t => (t.closest('.cell') || t).className); await p.mouse.up(); await p.waitForTimeout(300); return hint;
};
posts.length = 0;
assert.match(await dragTo('2', '.cell[data-owner="vault"][data-slot="Power"]'), /drop-ok/);
assert.equal(await placeOf('2'), 'vault');
assert.deepEqual(posts.map(x => [x[0], x[1].transferToVault, x[1].itemId]), [['TransferItem/', true, '2']]);
// onto an equipped item in the same cell: nothing happens, a drag never equips (Fatebringer onto Ace of Spades on the Titan)
posts.length = 0;
await dragTo('1', '.tile[data-id="3"]');
assert.deepEqual(posts, []);
assert.equal(await p.$eval('.tile[data-id="3"]', t => t.classList.contains('equipped')), true);
assert.equal(await p.$eval('.tile[data-id="1"]', t => t.classList.contains('equipped')), false);
// a drop that can't happen says why and sends nothing; another row isn't a target at all
posts.length = 0;
assert.match(await dragTo('4', '.cell[data-owner="vault"][data-slot="Helmet"]'), /drop-no/);
assert.match(await p.textContent('#actions .err'), /Equipped items can't be moved/);
await dragTo('2', '.cell[data-owner="W1"][data-slot="Kinetic"]');
assert.equal(await placeOf('2'), 'vault');
assert.deepEqual(posts, []);
assert.equal(await p.$$eval('.dragghost', g => g.length), 0);
// Postmaster: a row per character above the gear, with how full it is (the materials count too)
const rowOf = async id => p.$eval(`.tile[data-id="${id}"]`, t => t.closest('.cell').dataset.slot);
assert.equal(await rowOf('6'), 'Postmaster');
assert.equal(await p.textContent('.cell.pm[data-owner="T1"] .pmcount'), '3 of 21');
assert.equal(await p.textContent('.cell.pm[data-owner="W1"] .pmcount'), '0 of 21');
// picked, its only way out is a pull to its own character
await p.click('.tile[data-id="6"]');
assert.equal(await p.$$eval('#actions button', bs => bs.map(x => x.textContent).join('|')), 'Pull to Titan|Close');
posts.length = 0;
await p.click('#actions button[data-pull]'); await p.waitForTimeout(300);
assert.deepEqual(posts, [['PullFromPostmaster/', { itemReferenceHash: energy.h, stackSize: 1, itemId: '6', characterId: 'T1', membershipType: 3 }]]);
assert.equal(await rowOf('6'), 'Energy'); assert.equal(await placeOf('6'), 'T1');
assert.equal(await p.textContent('.cell.pm[data-owner="T1"] .pmcount'), '2 of 21');
// dragged onto another character it says to pull first; onto its own character's row it's pulled
posts.length = 0;
assert.match(await dragTo('7', '.cell[data-owner="W1"][data-slot="Kinetic"]'), /drop-no/);
assert.match(await p.textContent('#actions .err'), /Pull this to your Titan first/);
assert.deepEqual(posts, []);
assert.match(await dragTo('7', '.cell[data-owner="T1"][data-slot="Kinetic"]'), /drop-ok/);
assert.deepEqual(posts.map(x => x[0]), ['PullFromPostmaster/']);
assert.equal(await rowOf('7'), 'Kinetic');
await p.screenshot({ path: OUT + 'transfer-d.png' });
await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(300);
await p.screenshot({ path: OUT + 'transfer-m.png' });

// on a phone: a quick swipe over an item scrolls the page; a long press lifts it, and dropping it on the vault moves it
const phone = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
await phone.route('https://www.bungie.net/Platform/**', api);
const m = await phone.newPage(); m.on('pageerror', e => errs.push(e.message));
await m.goto('http://localhost:8765/'); await m.evaluate(() => localStorage.setItem('d2c_token', JSON.stringify({ access_token: 'x', expires_at: Date.now() + 3e6 })));
await m.goto('http://localhost:8765/#/inventory/move'); await m.waitForSelector('.tile[data-id="2"]');
const cdp = await phone.newCDPSession(m), touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
const mid = sel => m.$eval(sel, t => { t.scrollIntoView({ block: 'center' }); const r = t.getBoundingClientRect(); return [r.x + Math.min(r.width / 2, 30), r.y + Math.min(r.height / 2, 30)]; });
let [x, y] = await mid('.tile[data-id="2"]'), top = await m.evaluate(() => scrollY);
await touch('touchStart', x, y); for (let i = 1; i <= 8; i++) await touch('touchMove', x, y - i * 20); await touch('touchEnd'); await m.waitForTimeout(400);
assert.ok(await m.evaluate(() => scrollY) > top && !(await m.$('.dragghost')));
[x, y] = await mid('.tile[data-id="2"]'); posts.length = 0;
const [tx, ty] = await m.$eval('.cell[data-owner="vault"][data-slot="Power"]', t => { const r = t.getBoundingClientRect(); return [r.x + 30, r.y + 30]; });
await touch('touchStart', x, y); await m.waitForTimeout(450); assert.ok(await m.$('.dragghost'));
for (let i = 1; i <= 10; i++) await touch('touchMove', x + (tx - x) * i / 10, y + (ty - y) * i / 10);
await touch('touchEnd'); await m.waitForTimeout(400);
assert.equal(await m.$eval('.tile[data-id="2"]', t => t.closest('.cell').dataset.owner), 'vault');
assert.deepEqual(posts.map(x => x[0]), ['TransferItem/']);

assert.deepEqual(errs, []);
console.log('transfer tests passed');
await b.close();
