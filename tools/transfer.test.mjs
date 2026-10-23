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
const profile = {
  characters: { data: { T1: { classType: 0, light: 481 }, W1: { classType: 2, light: 476 } } },
  profileInventory: { data: { items: [{ itemHash: fate.h, itemInstanceId: '1', bucketHash: 138197802 }, { itemHash: hunterHelm.h, itemInstanceId: '5', bucketHash: 138197802 }] } },
  characterInventories: { data: { T1: { items: [{ itemHash: gjally.h, itemInstanceId: '2', bucketHash: 953998645 }] }, W1: { items: [] } } },
  characterEquipment: { data: { T1: { items: [{ itemHash: ace.h, itemInstanceId: '3', bucketHash: 1498876634 }, { itemHash: helm.h, itemInstanceId: '4', bucketHash: 3448274439 }] }, W1: { items: [] } } },
  itemComponents: { sockets: { data: {} }, reusablePlugs: { data: {} }, instances: { data: {} }, stats: { data: {} } },
};
const posts = [];
let failNext = false;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.route('https://www.bungie.net/Platform/**', route => {
  const r = route.request(), u = r.url();
  if (r.method() === 'POST') {
    posts.push([u.split('/Items/')[1], JSON.parse(r.postData())]);
    if (failNext) { failNext = false; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ErrorCode: 1642, ErrorStatus: 'DestinyNoRoomInDestination', Message: 'There are no item slots available to transfer this item.' }) }); }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ErrorCode: 1, Response: 0 }) });
  }
  const body = u.includes('GetMemberships') ? { primaryMembershipId: '1', destinyMemberships: [{ membershipId: '1', membershipType: 3 }], bungieNetUser: { uniqueName: 'Randy#1234' } } : profile;
  route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ErrorCode: 1, Response: body }) });
});
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
// Warlock -> Titan goes through the vault (two transfers), then equip replaces Ace of Spades
posts.length = 0;
await p.click('button[data-equip="T1"]'); await p.waitForTimeout(300);
assert.deepEqual(posts.map(x => [x[0], x[1].transferToVault, x[1].characterId]), [['TransferItem/', true, 'W1'], ['TransferItem/', false, 'T1'], ['EquipItem/', undefined, 'T1']]);
assert.equal(await p.$eval('.tile[data-id="1"]', t => t.classList.contains('equipped')), true);
assert.equal(await p.$eval('.tile[data-id="3"]', t => t.classList.contains('equipped')), false);
// equipped items can't move
await p.click('.tile[data-id="4"]');
assert.equal(await p.$eval('#actions', bar => [...bar.querySelectorAll('button[data-move],button[data-equip]')].every(x => x.disabled)), true);
// hunter armor only offers the Hunter... and there is no hunter, so only Vault-less: no targets
await p.click('.tile[data-id="5"]');
assert.equal(await p.$$eval('#actions button[data-move],#actions button[data-equip]', bs => bs.length), 0);
// a Bungie error is shown and the item stays put
failNext = true;
await p.click('.tile[data-id="2"]'); await p.click('button[data-move="W1"]'); await p.waitForTimeout(300);
assert.match(await p.textContent('#actions .err'), /no item slots/);
assert.equal(await placeOf('2'), 'T1');
await p.screenshot({ path: OUT + 'transfer-d.png' });
await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(300);
await p.screenshot({ path: OUT + 'transfer-m.png' });
assert.deepEqual(errs, []);
console.log('transfer tests passed');
await b.close();
