// Browser test for the Builds page against a mocked DIM share API and Bungie API.
// Run from the repo root: python3 -m http.server 8765 & npm i --no-save playwright && node tools/builds.test.mjs
import { chromium } from 'playwright';
import fs from 'fs';
import assert from 'assert';
const W = JSON.parse(fs.readFileSync('data/weapons.json')).weapons;
const A = JSON.parse(fs.readFileSync('data/armor.json'));
const fate = W.find(w => w.n === 'Fatebringer'), gjally = W.find(w => w.n === 'Gjallarhorn'), ace = W.find(w => w.n === 'Ace of Spades'), threat = W.find(w => w.n === 'Threat Level');
const helm = A.armor.find(x => x.a3 && x.cl === 'Hunter' && x.ty === 'Helmet');
const defs = { 4282591831: ['Prismatic Hunter', 16, 'Hunter Subclass'], 2370269390: ['Golden Gun: Marksman', 19, 'Solar Super | Light Ability'],
  2835214900: ['Stylish Executioner', 19, 'Void Aspect | Light Ability'], 2626922121: ['Facet of Grace', 19, 'Prismatic Fragment'], 1001: ['Heavy Ammo Finder', 19, 'Leg Armor Mod'] };
const loadout = { id: 'x', name: 'The Build Of Spite', classType: 1, notes: 'Shoot the boss.',
  equipped: [{ hash: 4282591831, socketOverrides: { 2: 2370269390, 7: 2835214900, 9: 2626922121 } }, { hash: fate.h, id: '91' }, { hash: gjally.h, id: '92' }, { hash: helm.h, id: '93' }, { hash: threat.h, id: '94' }],
  unequipped: [], parameters: { mods: [1001, 1001], statConstraints: [{ statHash: 2996146975, minStat: 100 }, { statHash: 392767087 }] } };
const profile = {
  characters: { data: { H1: { classType: 1, light: 480 }, T1: { classType: 0, light: 481 } } },
  profileInventory: { data: { items: [{ itemHash: fate.h, itemInstanceId: '1', bucketHash: 138197802 }, { itemHash: helm.h, itemInstanceId: '3', bucketHash: 138197802 }] } },
  characterInventories: { data: { T1: { items: [{ itemHash: gjally.h, itemInstanceId: '2', bucketHash: 953998645 }] }, H1: { items: [] } } },
  characterEquipment: { data: { H1: { items: [{ itemHash: ace.h, itemInstanceId: '4', bucketHash: 1498876634 }] }, T1: { items: [] } } },
  itemComponents: { sockets: { data: {} }, reusablePlugs: { data: {} }, instances: { data: {} },
    stats: { data: { 3: { stats: { 2996146975: { value: 30 }, 1735777505: { value: 25 }, 392767087: { value: 20 }, 1943323491: { value: 5 }, 144602215: { value: 5 }, 4244567218: { value: 5 } } } } } },
};
const posts = [];
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
let shareCalls = 0;
await ctx.route('https://api.destinyitemmanager.com/**', route => {
  shareCalls++;
  const id = new URL(route.request().url()).searchParams.get('shareId');
  if (id !== 'igeavhy') return route.fulfill({ status: 404, body: '' });
  route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ loadout, shareUrl: 'https://dim.gg/igeavhy/The-Build-Of-Spite' }) });
});
await ctx.route('https://www.bungie.net/Platform/**', route => {
  const r = route.request(), u = r.url();
  const ok = Response => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ErrorCode: 1, Response }) });
  if (r.method() === 'POST') {
    const body = JSON.parse(r.postData());
    posts.push([u.split('/Items/')[1], body]);
    return ok(body.itemIds ? { equipResults: body.itemIds.map(itemInstanceId => ({ itemInstanceId, equipStatus: 1 })) } : 0);
  }
  const def = u.match(/DestinyInventoryItemDefinition\/(\d+)/);
  if (def) { const [name, itemType, type] = defs[def[1]]; return ok({ displayProperties: { name, icon: '', description: name + ' does things.' }, itemType, itemTypeDisplayName: type }); }
  ok(u.includes('GetMemberships') ? { primaryMembershipId: '1', destinyMemberships: [{ membershipId: '1', membershipType: 3 }], bungieNetUser: { uniqueName: 'Randy#1234' } } : profile);
});
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:8765/'); await p.evaluate(() => localStorage.setItem('d2c_token', JSON.stringify({ access_token: 'x', expires_at: Date.now() + 3e6 })));
await p.waitForSelector('#list .card');  // let the weapon list finish so it can't redraw over the Builds page
const open = async link => { await p.goto('http://localhost:8765/#/build'); await p.fill('#link', link); await p.click('#open button'); await p.waitForTimeout(1500); };

// a dim.gg link resolves through DIM's share API
await open('https://dim.gg/igeavhy/The-Build-Of-Spite');
assert.equal(new URL(p.url()).hash, '#/build/igeavhy');
const text = await p.locator('#build').innerText();
for (const s of ['THE BUILD OF SPITE', 'Shoot the boss.', 'Prismatic Hunter', 'Golden Gun: Marksman', 'Stylish Executioner', 'Facet of Grace', 'Heavy Ammo Finder ×2', 'You have 3 of 4 pieces of gear.'])
  assert.ok(text.includes(s), 'missing: ' + s);
// stat priorities in the build's order, and the helmet you own is checked against the top two
assert.deepEqual(await p.$$eval('.statrank li', ls => ls.map(l => l.innerText)), ['Weapons 100+', 'Health']);
assert.ok(text.includes('Fits') && text.includes('Weapons 30, Grenade 25, Health 20'));
assert.ok(text.includes('Missing'), 'Threat Level should be missing');
// only the build's class can equip it
assert.deepEqual(await p.$$eval('[data-equip]', bs => bs.map(x => x.textContent)), ['Equip on Hunter']);

// equip: vault items move once, Titan's Gjallarhorn goes through the vault, then one EquipItems call
await p.click('[data-equip="H1"]'); await p.waitForTimeout(800);
assert.deepEqual(posts.map(([path, x]) => [path, x.itemId, x.transferToVault, x.characterId]), [
  ['TransferItem/', '1', false, 'H1'], ['TransferItem/', '2', true, 'T1'], ['TransferItem/', '2', false, 'H1'], ['TransferItem/', '3', false, 'H1'], ['EquipItems/', undefined, undefined, 'H1']]);
assert.deepEqual(posts.at(-1)[1].itemIds, ['1', '2', '3']);
assert.ok((await p.locator('#build').innerText()).includes('Done. Everything you have from this build is equipped on your Hunter.'));

// save it, find it in the saved list, and reopen it without asking DIM again
await p.click('[data-save]');
assert.equal(await p.textContent('[data-save]'), 'Remove from saved');
// the open build is marked in the saved-builds bar, which links back to the full list
assert.equal(await p.textContent('#savedbar .chip[aria-current]'), 'The Build Of Spite');
await p.click('#savedbar .back'); await p.waitForSelector('.card.saved');
assert.equal(new URL(p.url()).hash, '#/build');
assert.equal(await p.isVisible('#savedbar'), false);
assert.ok((await p.textContent('.card.saved')).includes('The Build Of Spite'));
assert.ok((await p.textContent('.card.saved')).includes('Hunter · Prismatic Hunter'));
const dimCalls = shareCalls;
await p.click('.card.saved a'); await p.waitForSelector('.buildhead');
assert.equal(new URL(p.url()).hash, '#/build/igeavhy');
assert.equal(shareCalls, dimCalls);
await p.goto('http://localhost:8765/#/build'); await p.waitForSelector('.card.saved');
await p.click('[data-remove="igeavhy"]');
assert.ok((await p.textContent('#build')).includes('No saved builds yet'));

// a full DIM loadouts link carries the build in the URL; saving it gives it an address that survives a reload
await open('https://app.destinyitemmanager.com/loadouts?' + new URLSearchParams({ loadout: JSON.stringify(loadout) }));
assert.equal(new URL(p.url()).hash, '#/build/link');
assert.ok((await p.locator('#build').innerText()).includes('THE BUILD OF SPITE'));
// farming a build saves it first, since the farming plan reads saved builds
await p.click('[data-farmbuild]');
assert.equal(new URL(p.url()).hash, '#/build/saved-x');
assert.equal(await p.textContent('[data-save]'), 'Remove from saved');
assert.equal(await p.textContent('[data-farmbuild]'), 'Stop farming this build');
assert.deepEqual(await p.evaluate(() => JSON.parse(localStorage.getItem('d2c_farm')).builds), ['saved-x']);
await p.reload(); await p.waitForSelector('.buildhead');
assert.ok((await p.locator('#build').innerText()).includes('THE BUILD OF SPITE'));

// a build without stat priorities can get your own; adding them saves the build, and they drive the armor check
const bare = { ...loadout, id: 'y', name: 'No Stats', parameters: {} };
await open('https://app.destinyitemmanager.com/loadouts?' + new URLSearchParams({ loadout: JSON.stringify(bare) }));
assert.ok((await p.locator('#build').innerText()).includes("This build doesn't rank armor stats."));
assert.ok(!(await p.locator('#build').innerText()).includes('Fits'));
await p.click('[data-stats-edit]');
await p.click('[data-stat="392767087"]'); await p.click('[data-stat="2996146975"]');  // Health, then Weapons
assert.equal(new URL(p.url()).hash, '#/build/saved-y');
assert.deepEqual(await p.$$eval('.statrank li', ls => ls.map(l => l.innerText)), ['Health', 'Weapons']);
assert.equal(await p.textContent('[data-stat="2996146975"]'), '2. Weapons');
await p.click('[data-stats-done]');
assert.equal(await p.textContent('[data-stats-edit]'), 'Change stat priorities');
assert.ok((await p.locator('#build').innerText()).includes('Fits'));  // the helmet rolled Weapons, Grenade, Health
await p.reload(); await p.waitForSelector('.statrank');
assert.deepEqual(await p.$$eval('.statrank li', ls => ls.map(l => l.innerText)), ['Health', 'Weapons']);
assert.deepEqual(await p.evaluate(() => JSON.parse(localStorage.getItem('d2c_builds')).find(b => b.key === 'saved-y').loadout.parameters.statConstraints),
  [{ statHash: 392767087 }, { statHash: 2996146975 }]);
// links that carry their own priorities can't be changed here
await p.goto('http://localhost:8765/#/build/saved-x'); await p.waitForSelector('.statrank');
assert.equal(await p.locator('[data-stats-edit]').count(), 0);

// bad and unknown links explain themselves
await open('https://example.com/nope');
assert.equal(await p.isVisible('#linkerr'), true);
await open('https://dim.gg/zzzzzzz/Gone');
assert.ok((await p.locator('#build').innerText()).includes('DIM has no build with that link'));

assert.deepEqual(errs, []);
await b.close();
console.log('builds tests passed');
