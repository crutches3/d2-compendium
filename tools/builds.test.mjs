// Browser test for the Builds page against a mocked DIM share API and Bungie API.
// Run from the repo root: python3 -m http.server 8765 & npm i --no-save playwright && node tools/builds.test.mjs
import { chromium } from 'playwright';
import fs from 'fs';
import assert from 'assert';
const W = JSON.parse(fs.readFileSync('data/weapons.json')).weapons;
const A = JSON.parse(fs.readFileSync('data/armor.json'));
const ARTS = JSON.parse(fs.readFileSync('data/artifacts.json'));
const SLOTS = JSON.parse(fs.readFileSync('data/loadouts.json')), slotName = n => SLOTS.names.find(x => x[1] === n)[0];
const fate = W.find(w => w.n === 'Fatebringer'), gjally = W.find(w => w.n === 'Gjallarhorn'), ace = W.find(w => w.n === 'Ace of Spades'), threat = W.find(w => w.n === 'Threat Level');
const helm = A.armor.find(x => x.a3 && x.cl === 'Hunter' && x.ty === 'Helmet');
const defs = { 4282591831: ['Prismatic Hunter', 16, 'Hunter Subclass'], 2370269390: ['Golden Gun: Marksman', 19, 'Solar Super | Light Ability'],
  2835214900: ['Stylish Executioner', 19, 'Void Aspect | Light Ability'], 2626922121: ['Facet of Grace', 19, 'Prismatic Fragment'], 1001: ['Heavy Ammo Finder', 19, 'Leg Armor Mod'] };
const loadout = { id: 'x', name: 'The Build Of Spite', classType: 1, notes: 'Shoot the boss.',
  equipped: [{ hash: 4282591831, socketOverrides: { 2: 2370269390, 7: 2835214900, 9: 2626922121 } }, { hash: fate.h, id: '91' }, { hash: gjally.h, id: '92' }, { hash: helm.h, id: '93' }, { hash: threat.h, id: '94' }],
  unequipped: [], parameters: { mods: [1001, 1001], artifactUnlocks: { unlockedItemHashes: [ARTS[2].tiers[0].perks[0].h] }, statConstraints: [{ statHash: 2996146975, minStat: 100 }, { statHash: 392767087 }] } };
// DIM can name a perk by another artifact's or season's copy of it, or keep the perks on an artifact item in the loadout
const named = n => ARTS.flatMap(x => x.tiers.flatMap(t => t.perks)).filter(k => k.n === n).length === 1;
const uniq = ARTS[1].tiers[1].perks.find(k => named(k.n)), inItem = ARTS[3].tiers[2].perks[0];
Object.assign(defs, { 777001: [uniq.n, 19, 'Artifact Perk'], 777002: ['Old Season Perk', 19, 'Artifact Perk'], 777003: [ARTS[3].n, 0, 'Seasonal Artifact'], 777004: ['Empty Artifact Perk', 19, 'Artifact Perk'] });
const shares = { igeavhy: loadout,
  artname: { ...loadout, name: 'Renamed Perks', parameters: { artifactUnlocks: { unlockedItemHashes: [777001, 777002], seasonNumber: 27 } } },
  artitem: { ...loadout, name: 'Artifact Item', parameters: {}, equipped: [...loadout.equipped, { hash: 777003, socketOverrides: { 0: inItem.h, 1: 777004 } }] } };
const profile = {
  characters: { data: { H1: { classType: 1, light: 480 }, T1: { classType: 0, light: 481 } } },
  profileInventory: { data: { items: [{ itemHash: fate.h, itemInstanceId: '1', bucketHash: 138197802 }, { itemHash: helm.h, itemInstanceId: '3', bucketHash: 138197802 }] } },
  characterInventories: { data: { T1: { items: [{ itemHash: gjally.h, itemInstanceId: '2', bucketHash: 953998645 }] }, H1: { items: [] } } },
  characterEquipment: { data: { H1: { items: [{ itemHash: ace.h, itemInstanceId: '4', bucketHash: 1498876634 }] }, T1: { items: [] } } },
  // the Hunter's in-game loadouts: slot 1 is used, slot 2 is free
  characterLoadouts: { data: { H1: { loadouts: [
    { nameHash: slotName('PvP'), iconHash: SLOTS.icons[3][0], colorHash: SLOTS.colors[2][0], items: [{ itemInstanceId: '4' }, { itemInstanceId: '0' }] },
    { nameHash: slotName('Beta'), iconHash: SLOTS.icons[1][0], colorHash: SLOTS.colors[1][0], items: [{ itemInstanceId: '0' }] }] } } },
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
  if (!shares[id]) return route.fulfill({ status: 404, body: '' });
  route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ loadout: shares[id], shareUrl: `https://dim.gg/${id}/${shares[id].name.replace(/ /g, '-')}` }) });
});
await ctx.route('https://www.bungie.net/Platform/**', route => {
  const r = route.request(), u = r.url();
  const ok = Response => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ErrorCode: 1, Response }) });
  if (r.method() === 'POST') {
    const body = JSON.parse(r.postData());
    posts.push([u.split(/\/(?:Items|Loadouts)\//)[1], body]);
    return ok(body.itemIds ? { equipResults: body.itemIds.map(itemInstanceId => ({ itemInstanceId, equipStatus: 1 })) } : 0);
  }
  const def = u.match(/DestinyInventoryItemDefinition\/(\d+)/);
  if (def && !defs[def[1]]) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ErrorCode: 7, Message: 'not found' }) });
  if (def) { const [name, itemType, type] = defs[def[1]]; return ok({ displayProperties: { name, icon: '', description: name + ' does things.' }, itemType, itemTypeDisplayName: type }); }
  ok(u.includes('GetMemberships') ? { primaryMembershipId: '1', destinyMemberships: [{ membershipId: '1', membershipType: 3 }], bungieNetUser: { uniqueName: 'Randy#1234' } } : profile);
});
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:8765/#/weapons'); await p.evaluate(() => localStorage.setItem('d2c_token', JSON.stringify({ access_token: 'x', expires_at: Date.now() + 3e6 })));
await p.waitForSelector('#list .card');  // let the weapon list finish so it can't redraw over the Builds page
const open = async link => { await p.goto('http://localhost:8765/#/build'); await p.fill('#link', link); await p.click('#open button'); await p.waitForTimeout(1500); };

// a dim.gg link resolves through DIM's share API
await open('https://dim.gg/igeavhy/The-Build-Of-Spite');
assert.equal(new URL(p.url()).hash, '#/build/igeavhy');
const text = await p.locator('#build').innerText();
for (const s of ['THE BUILD OF SPITE', 'Shoot the boss.', 'Prismatic Hunter', 'Golden Gun: Marksman', 'Stylish Executioner', 'Facet of Grace', 'Heavy Ammo Finder ×2', 'You have 3 of 4 pieces of gear.'])
  assert.ok(text.includes(s), 'missing: ' + s);
// stat priorities in the build's order, and the helmet you own is checked against the top two
// a DIM minimum is checked against what your armor for the build adds up to
assert.deepEqual(await p.$$eval('.statrank li', ls => ls.map(l => l.innerText)), ['Weapons 100+ best you own 30', 'Health best you own 20']);
assert.ok(text.includes('Fits') && text.includes('Weapons 30, Grenade 25, Health 20'));
assert.ok(text.includes('Missing'), 'Threat Level should be missing');
// the artifact comes from the perks the link unlocks
assert.ok(text.includes(ARTS[2].n) && text.includes(ARTS[2].tiers[0].perks[0].n) && text.includes('Change artifact'));
// a perk DIM names by another copy's hash matches by name, and one no artifact has is still listed
await open('https://dim.gg/artname/Renamed-Perks');
let artBox = await p.locator('#build section', { hasText: 'Change artifact' }).innerText();
assert.ok(artBox.includes(ARTS[1].n) && artBox.includes(uniq.n) && artBox.includes('DIM also lists') && artBox.includes('Old Season Perk'), artBox);
// an artifact in the loadout brings its socketed perks, without its empty sockets
await open('https://dim.gg/artitem/Artifact-Item');
artBox = await p.locator('#build section', { hasText: 'Change artifact' }).innerText();
assert.ok(artBox.includes(ARTS[3].n) && artBox.includes(inItem.n) && !artBox.includes('Empty') && !artBox.includes('DIM also lists'), artBox);
await open('https://dim.gg/igeavhy/The-Build-Of-Spite');
// only the build's class can equip it
assert.deepEqual(await p.$$eval('[data-equip]', bs => bs.map(x => x.textContent)), ['Equip on Hunter']);

// equip: vault items move once, Titan's Gjallarhorn goes through the vault, then one EquipItems call
await p.click('[data-equip="H1"]'); await p.waitForTimeout(800);
assert.deepEqual(posts.map(([path, x]) => [path, x.itemId, x.transferToVault, x.characterId]), [
  ['TransferItem/', '1', false, 'H1'], ['TransferItem/', '2', true, 'T1'], ['TransferItem/', '2', false, 'H1'], ['TransferItem/', '3', false, 'H1'], ['EquipItems/', undefined, undefined, 'H1']]);
assert.deepEqual(posts.at(-1)[1].itemIds, ['1', '2', '3']);
assert.ok((await p.locator('#build').innerText()).includes('Done. Everything you have from this build is equipped on your Hunter.'));

// send: the same pieces move to the Hunter, and nothing is equipped
const moves = [['TransferItem/', '1', false, 'H1'], ['TransferItem/', '2', true, 'T1'], ['TransferItem/', '2', false, 'H1'], ['TransferItem/', '3', false, 'H1']];
const sent = () => posts.splice(0).map(([path, x]) => [path, x.itemId ?? x.loadoutIndex, x.transferToVault, x.characterId]);
posts.length = 0;
await p.click('[data-send="H1"]'); await p.waitForTimeout(800);
assert.deepEqual(sent(), moves);
assert.ok((await p.locator('#build').innerText()).includes('Done. Everything you have from this build is on your Hunter.'));

// save as loadout: equip, then snapshot into the first free slot, named for the subclass and keeping the slot's icon and color
profile.characterLoadouts.data.H1.loadouts[1].items = [{ itemInstanceId: '1' }];  // the re-read after saving sees every slot used
await p.click('[data-ingame="H1"]'); await p.waitForTimeout(800);
const snap = posts.at(-1)[1];
assert.deepEqual(sent(), [...moves, ['EquipItems/', undefined, undefined, 'H1'], ['SnapshotLoadout/', 1, undefined, 'H1']]);
assert.deepEqual([snap.nameHash, snap.iconHash, snap.colorHash, snap.membershipType], [slotName('Prismatic'), SLOTS.icons[1][0], SLOTS.colors[1][0], 3]);
assert.ok((await p.locator('#build').innerText()).includes('Saved as in-game loadout 2 (Prismatic) on your Hunter.'));
// every slot used: it asks which to replace, and Cancel asks nothing
await p.click('[data-ingame="H1"]');
assert.deepEqual(await p.$$eval('.slotpick [data-slot]', bs => bs.map(x => x.innerText.replace(/\s+/g, ' ').trim())), ['1. PvP 1 item', '2. Beta 1 item']);
assert.ok((await p.textContent('.slotpick')).includes('All 2 in-game loadout slots on your Hunter are full.'));
assert.equal(posts.length, 0);
await p.click('[data-slot-cancel]'); assert.equal(await p.locator('.slotpick').count(), 0);
await p.click('[data-ingame="H1"]'); await p.click('.slotpick [data-slot="0"]'); await p.waitForTimeout(800);
assert.deepEqual(sent().at(-1), ['SnapshotLoadout/', 0, undefined, 'H1']);
assert.equal(await p.locator('.slotpick').count(), 0);
assert.ok((await p.locator('#build').innerText()).includes('Saved as in-game loadout 1 (Prismatic) on your Hunter.'));

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
assert.deepEqual(await p.$$eval('.statrank li', ls => ls.map(l => l.innerText)), ['Health best you own 20', 'Weapons best you own 30']);
assert.equal(await p.textContent('[data-stat="2996146975"]'), '2. Weapons');
// minimum totals: compared with what your armor for the build adds up to (the helmet: Weapons 30, Health 20)
await p.fill('[data-min="2996146975"]', '100'); await p.press('[data-min="2996146975"]', 'Enter');
await p.fill('[data-min="392767087"]', '20'); await p.press('[data-min="392767087"]', 'Enter');
assert.deepEqual(await p.$$eval('.statrank li', ls => ls.map(l => [l.innerText, l.querySelector('span')?.className])), [['Health 20+ best you own 20', 'met'], ['Weapons 100+ best you own 30', 'short']]);
await p.click('[data-stats-done]');
assert.equal(await p.textContent('[data-stats-edit]'), 'Change stat priorities');
assert.ok((await p.locator('#build').innerText()).includes('Fits'));  // the helmet rolled Weapons, Grenade, Health
const bestText = await p.locator('#build').innerText();
assert.ok(bestText.includes('Best armor you own for this build') && bestText.includes('Still 70 short of the minimums'));
await p.reload(); await p.waitForSelector('.statrank');
assert.deepEqual(await p.$$eval('.statrank li', ls => ls.map(l => l.innerText)), ['Health 20+ best you own 20', 'Weapons 100+ best you own 30']);
assert.deepEqual(await p.evaluate(() => JSON.parse(localStorage.getItem('d2c_builds')).find(b => b.key === 'saved-y').loadout.parameters.statConstraints),
  [{ statHash: 392767087, minStat: 20 }, { statHash: 2996146975, minStat: 100 }]);
// pick an artifact and its perks: each tier takes as many as the artifact has room for
assert.ok((await p.locator('#build').innerText()).includes("This build doesn't pick an artifact."));
await p.click('[data-art-edit]');
await p.selectOption('#artpick', String(ARTS[0].h));
// a tier's slots also take lower-tier perks, so at most 2 Tier 3 perks, at most 5 from Tiers 2 and 3, 7 in all
const [t1, , t3] = ARTS[0].tiers, chosen = [...t3.perks.slice(0, 2), ...t1.perks.slice(0, 5)];
for (const k of t3.perks.slice(0, 2)) await p.click(`[data-perk="${k.h}"]`);
assert.equal(await p.isDisabled(`[data-perk="${t3.perks[2].h}"]`), true);
assert.equal(await p.isDisabled(`[data-perk="${t1.perks[0].h}"]`), false);
for (const k of t1.perks.slice(0, 5)) await p.click(`[data-perk="${k.h}"]`);
assert.equal(await p.isDisabled(`[data-perk="${t1.perks[5].h}"]`), true);  // all 7 used
assert.ok((await p.locator('#build').innerText()).includes('7 of 7 picked'));
await p.click('[data-art-done]');
const artText = await p.locator('#build').innerText();
assert.ok(artText.includes(ARTS[0].n) && chosen.every(k => artText.includes(k.n)) && artText.includes('ARTIFACT SET BY YOU'));
await p.reload(); await p.waitForSelector('.arthead');
assert.deepEqual(await p.evaluate(() => JSON.parse(localStorage.getItem('d2c_builds')).find(b => b.key === 'saved-y').artifact),
  { h: ARTS[0].h, perks: chosen.map(k => k.h) });

// links that carry their own priorities can't be changed here
await p.goto('http://localhost:8765/#/build/saved-x'); await p.waitForSelector('.statrank');
assert.equal(await p.locator('[data-stats-edit]').count(), 0);

// bad and unknown links explain themselves
await open('https://example.com/nope');
assert.equal(await p.isVisible('#linkerr'), true);
await open('https://dim.gg/zzzzzzz/Gone');
assert.ok((await p.locator('#build').innerText()).includes('DIM has no build with that link'));

// best armor you own: one piece per slot, the build's exotic, its set bonus, minimums before raw stats
const picks = await p.evaluate(() => {
  const L = (n, ty, x = {}) => ({ n, ty, cl: 'Hunter', ti: 'Legendary', set: '', ...x });
  const a = { stats: { 1: 'Weapons', 2: 'Health' }, byHash: { 10: L('Helm A', 'Helmet'), 11: L('Helm Set', 'Helmet', { set: 'S' }), 20: L('Arms A', 'Gauntlets'),
    21: L('Arms Set', 'Gauntlets', { set: 'S' }), 30: L('Chest A', 'Chest Armor'), 31: L('Chest Exotic', 'Chest Armor', { ti: 'Exotic' }), 40: L('Titan Helm', 'Helmet', { cl: 'Titan' }) } };
  const it = (h, w, hp) => ({ itemHash: h, stats: { 1: w, 2: hp } });
  const items = [it(10, 30, 0), it(11, 5, 20), it(20, 30, 0), it(21, 10, 5), it(30, 40, 40), it(31, 5, 5), it(40, 99, 99)];
  const run = params => bestArmor(a, items, 'Hunter', { equipped: params.equipped || [], parameters: params }).pieces.map(i => a.byHash[i.itemHash].n);
  return [run({ statConstraints: [{ statHash: 1 }, { statHash: 2 }] }),
    run({ statConstraints: [{ statHash: 1 }, { statHash: 2, minStat: 50 }] }),
    run({ statConstraints: [{ statHash: 1 }], setBonuses: { S: 2 } }),
    run({ statConstraints: [{ statHash: 1 }], equipped: [{ hash: 31 }] })];
});
assert.deepEqual(picks, [['Helm A', 'Arms A', 'Chest A'], ['Helm Set', 'Arms A', 'Chest A'], ['Helm Set', 'Arms Set', 'Chest A'], ['Helm A', 'Arms A', 'Chest Exotic']]);

assert.deepEqual(errs, []);
await b.close();
console.log('builds tests passed');
