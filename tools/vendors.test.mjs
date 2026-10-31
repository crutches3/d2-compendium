// Browser test for the Vendors page against a mocked Bungie API, signed out (public Xûr stock) and signed in (graded rolls).
// Run from the repo root: python3 -m http.server 8765 & npm i --no-save playwright && node tools/vendors.test.mjs
import { chromium } from 'playwright';
import fs from 'fs';
import assert from 'assert';
const W = JSON.parse(fs.readFileSync('data/weapons.json')).weapons, A = JSON.parse(fs.readFileSync('data/armor.json'));
const nh = W.find(w => w.h === 1801007332), helm = A.armor.find(x => x.a3 && x.cl === 'Titan' && x.ty === 'Helmet');
const perks = nh.cols.filter(c => c.c === 'Weapon Perks').map(c => c.p[0]);  // Arrowhead Brake, Accurized Rounds, Physic, Incandescent
const [wst, hst] = Object.keys(A.stats);
const sale = (i, itemHash) => ({ [i]: { vendorItemIndex: i, itemHash, quantity: 1, costs: [] } });
const pub = { sales: { data: { 100: { saleItems: { ...sale(0, nh.h), ...sale(1, 3158812152) } } } } };
const char = { sales: { data: { 100: { saleItems: { ...sale(0, nh.h), ...sale(1, helm.h) } }, 200: { saleItems: sale(0, 3158812152) } } },
  itemComponents: { 100: { sockets: { data: { 0: { sockets: perks.map(plugHash => ({ plugHash })) } } }, stats: { data: { 1: { stats: { [wst]: { value: 30 }, [hst]: { value: 12 } } } } } } } };
const urls = [];
const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.route('https://www.bungie.net/Platform/**', route => {
  const u = route.request().url(); urls.push(u);
  const body = u.includes('GetMemberships') ? { primaryMembershipId: '9', destinyMemberships: [{ membershipId: '9', membershipType: 3 }], bungieNetUser: { uniqueName: 'Randy#1' } }
    : u.includes('DestinyVendorDefinition/2779423129') ? { displayCategories: [{ index: 0, displayProperties: { name: 'The Final Shape Exotics' } }, { index: 1, displayProperties: { name: 'Empty' } }],
        itemList: [{ itemHash: nh.h, displayCategoryIndex: 0 }, { itemHash: 3158812152, displayCategoryIndex: 1 }] }
    : u.includes('DestinyVendorDefinition/523199268') || u.includes('DestinyVendorDefinition/1092954315') ? { displayCategories: [], itemList: [] }
    : u.includes('DestinyVendorDefinition/100') ? { displayProperties: { name: 'Banshee-44', smallTransparentIcon: '/x.png' } }
    : u.includes('/Destiny2/Vendors/') ? pub : u.includes('/Vendors/') ? char
    : { characters: { data: { T1: { classType: 0 }, H1: { classType: 1 } } }, profileInventory: { data: { items: [] } }, characterInventories: { data: {} }, characterEquipment: { data: {} },
        itemComponents: { sockets: { data: {} }, reusablePlugs: { data: {} }, instances: { data: {} }, stats: { data: {} } } };
  route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ErrorCode: 1, Response: body }) });
});
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
// signed out: Xûr-only public list, unknown items (engrams) dropped, no grading
await p.goto('http://localhost:8765/#/vendors'); await p.waitForSelector('#vendors .vitem');
assert.equal(await p.textContent('#vendors .vhead'), 'Banshee-44');
assert.deepEqual(await p.$$eval('#vendors .vitem b', l => l.map(x => x.textContent)), ['No Hesitation']);
assert.equal(await p.$$eval('#vendors .pips', l => l.length), 0);
assert(await p.isVisible('#vsign'));
// signed in: the character endpoint, with the weapon graded and armor stats shown
await p.evaluate(() => localStorage.setItem('d2c_token', JSON.stringify({ access_token: 'x', membership_id: '9', expires_at: Date.now() + 3e6 })));
await p.reload(); await p.waitForSelector('#vendors .vitem .pips');
assert(urls.some(u => u.includes('/Destiny2/3/Profile/9/Character/T1/Vendors/?components=400,402,304,305,310')));
assert.match(await p.getAttribute('#vendors .vitem .pips', 'aria-label'), /^God roll: 3 of 4/);  // Arrowhead Brake isn't the tier list's Full Bore
assert.equal(await p.$$eval('#vendors .vitem .minis img', l => l.length), 4);
const armor = await p.textContent('#vendors .vitem:nth-child(2) .vsub');
assert(armor.includes('42 total') && armor.includes(`${A.stats[wst]} 30`), armor);
assert.equal(await p.$$eval('#vendors .vhead', l => l.length), 1);  // vendor 200 only sells an engram
// switching character refetches for the Hunter
await p.click('#vendors [data-ci="1"]'); await p.waitForSelector('#vendors [data-ci="1"].on');
assert(urls.some(u => u.includes('/Character/H1/Vendors/')));
// the Monument tab: its archive vendors' lists by category, categories with nothing the site knows left out
await p.click('.tabs a[href="#/vendors/monument"]'); await p.waitForSelector('#vendors .vhead:text("The Final Shape Exotics")');
assert.deepEqual(await p.$$eval('#vendors .vhead', l => l.map(x => x.textContent)), ['The Final Shape Exotics']);
assert.deepEqual(await p.$$eval('#vendors .vitem b', l => l.map(x => x.textContent)), ['No Hesitation']);
assert.equal(await p.getAttribute('.tabs a[href="#/vendors/monument"]', 'aria-current'), 'page');
// the home page no longer lists vendors
await p.click('nav a[href="#/"]'); await p.waitForSelector('#distort .sphere');
assert.equal(await p.$('#vendors'), null);
assert.deepEqual(errs, []);
await b.close();
console.log('vendors ok');
