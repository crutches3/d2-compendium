// Browser test for the Farming plan against a mocked Bungie API, pinned to week 20 (Oct 20 2026 reset: King's Fall, Sundered Doctrine...).
// Run from the repo root: python3 -m http.server 8765 & npm i --no-save playwright && node tools/farm.test.mjs
import { chromium } from 'playwright';
import fs from 'fs';
import assert from 'assert';
const W = JSON.parse(fs.readFileSync('data/weapons.json')).weapons;
const R = JSON.parse(fs.readFileSync('data/godrolls.json')).rolls;
const A = JSON.parse(fs.readFileSync('data/armor.json'));
const rated = n => W.find(w => w.n === n && R[w.h]?.c?.length);
const doom = rated('Doom of Chelchis'), zaouli = rated("Zaouli's Bane"), fate = W.find(w => w.n === 'Fatebringer');
const helm = A.armor.find(x => x.a3 && x.cl === 'Hunter' && x.ty === 'Helmet' && x.ti !== 'Exotic');
const [setHash, set] = Object.entries(A.sets).find(([h]) => A.armor.some(x => x.set === h && x.a3 && x.cl === 'Hunter'));
const profile = {
  characters: { data: { H1: { classType: 1, light: 480 } } },
  profileInventory: { data: { items: [{ itemHash: doom.h, itemInstanceId: '1', bucketHash: 138197802 }, { itemHash: zaouli.h, itemInstanceId: '2', bucketHash: 138197802 },
    { itemHash: helm.h, itemInstanceId: '3', bucketHash: 138197802 }] } },
  characterInventories: { data: { H1: { items: [] } } }, characterEquipment: { data: { H1: { items: [] } } },
  // Doom of Chelchis has a Perk 1 and a Perk 2 pick; Zaouli's Bane has neither
  itemComponents: { sockets: { data: { 1: { sockets: R[doom.h].c.map(col => ({ plugHash: col[0] })) }, 2: { sockets: [] } } }, reusablePlugs: { data: {} }, instances: { data: {} },
    // the helmet rolled Health, Class and Super, so it doesn't fit a Weapons + Health build
    stats: { data: { 3: { stats: { 392767087: { value: 30 }, 1943323491: { value: 25 }, 144602215: { value: 20 }, 2996146975: { value: 5 } } } } } },
};
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.route('https://www.bungie.net/Platform/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ErrorCode: 1,
  Response: route.request().url().includes('GetMemberships') ? { primaryMembershipId: '1', destinyMemberships: [{ membershipId: '1', membershipType: 3 }], bungieNetUser: { uniqueName: 'Randy#1234' } } : profile }) }));
const p = await ctx.newPage();
await p.clock.setFixedTime(new Date('2026-10-23T12:00:00Z'));
const errs = []; p.on('pageerror', e => errs.push(e.message));
// every data file is fetched with the page's ?v=, so a cached file from an older release can't pair with new code
const unversioned = []; p.on('request', r => r.url().includes('/data/') && !/\?v=\d+$/.test(r.url()) && unversioned.push(r.url()));
const plan = () => p.innerText('#plan');
// open an activity's tab and read its items
const section = async (type, act) => { await p.click(`.typetabs [data-type="${type}"]`); await p.click(`.tabs.act [data-act="${act}"]`); return p.innerText('#plan section'); };
// click through every type and activity tab in both views
const allText = async () => {
  let out = '';
  for (const v of ['now', 'later']) {
    await p.click(`[data-view="${v}"]`);
    for (let i = 0; i < await p.locator('.typetabs button').count(); i++) {
      await p.locator('.typetabs button').nth(i).click();
      for (let j = 0; j < await p.locator('.tabs.act button').count(); j++) { await p.locator('.tabs.act button').nth(j).click(); out += await p.innerText('#plan section'); }
    }
  }
  return out;
};

// signed out: S-tier god rolls, with this week's rotating raid or dungeon as the priority
await p.goto('http://localhost:8765/#/farm'); await p.waitForSelector('#plan section');
assert.ok((await p.innerText('#app')).includes('Sign in with Bungie so the plan skips what you already own.'));
assert.match(await p.innerText('#plan section.priority h2'), /^PRIORITY FARM: (KING'S FALL|SUNDERED DOCTRINE|GRASP OF AVARICE|GARDEN OF SALVATION) /);
// tabs: This week / Coming up, then activity type, then activity, showing one activity at a time
const types = () => p.$$eval('.typetabs button', bs => bs.map(b => b.dataset.type));
assert.deepEqual((await types()).slice(0, 5), ['Raids', 'Dungeons', 'Pantheon', 'Grandmaster', 'PvP']);
assert.equal(await p.getAttribute('[data-view="now"]', 'aria-pressed'), 'true');
assert.equal(await p.locator('#plan section').count(), 1);
assert.ok((await section('Raids', "King's Fall")).includes('Doom of Chelchis'));
assert.ok(!(await plan()).includes('Doom of Chelchis (Harrowed)'), 'Harrowed copies merge into the base weapon');
// the priority callout jumps back to its tab
await section('PvP', 'Iron Banner');
await p.click('.farmtop .linkbtn');
assert.match(await p.innerText('#plan section.priority h2'), /^PRIORITY FARM: /);
assert.ok(!(await p.$$eval('.tabs.act button', bs => bs.map(b => b.dataset.act))).includes('Deep Stone Crypt'));
await p.click('[data-view="later"]');
assert.deepEqual(await types(), ['Raids', 'Dungeons']);
assert.ok((await section('Raids', 'Deep Stone Crypt')).includes('Featured Oct 27'.toUpperCase()));
await p.click('[data-view="now"]');
assert.equal(await p.getAttribute('.typetabs [data-type="Raids"]', 'aria-pressed'), 'true');

// signed in: a god roll you own drops off, a copy without it stays
await p.evaluate(() => localStorage.setItem('d2c_token', JSON.stringify({ access_token: 'x', expires_at: Date.now() + 3e6 })));
await p.reload(); await p.waitForSelector('#plan section');
assert.ok(!(await p.innerText('#app')).includes('Sign in with Bungie so the plan'));
const kf = await section('Raids', "King's Fall");
assert.ok(!kf.includes('Doom of Chelchis'), 'owned god roll should be skipped');
assert.ok(kf.includes("Zaouli's Bane") && kf.includes('You have it, not the god roll'));

// an armor set: only pieces for your classes (this account is Hunter only)
await p.click('#prefs summary');
await p.check(`[data-set="${setHash}"]`);
const setPieces = A.armor.filter(x => x.set === setHash && x.a3 && x.cl === 'Hunter');
const text = await allText();
assert.ok(setPieces.every(x => text.includes(x.n)), 'every Hunter piece of the set');
assert.ok(text.includes(`${set.n} set`));
assert.ok(!A.armor.filter(x => x.set === setHash && x.a3 && x.cl === 'Titan').some(x => text.includes(x.n) && !setPieces.some(h => h.n === x.n)), 'no Titan pieces');

// a single item added from its page shows up in the plan and can be removed again
await p.goto(`http://localhost:8765/#/weapon/${fate.h}`); await p.waitForSelector('[data-farm]');
await p.click('[data-farm]');
assert.equal(await p.textContent('[data-farm]'), 'Remove from farming plan');
await p.goto('http://localhost:8765/#/farm'); await p.waitForSelector('#plan section');
assert.ok((await p.textContent('#items')).includes('Fatebringer'));
await p.click('[data-view="later"]');  // Fatebringer is a Vault of Glass drop, which isn't featured this week
assert.ok((await section('Raids', 'Vault of Glass')).includes('Added by you'));
await p.click('#prefs summary'); await p.click('[data-unfarm]');
assert.ok(!(await p.textContent('#items')).includes('Fatebringer'));

// a saved build's weapons count, including better rolls of ones you own
await p.evaluate(([z, h]) => { localStorage.setItem('d2c_builds', JSON.stringify([{ key: 'b1', name: 'Spite', loadout: { name: 'Spite', equipped: [{ hash: z }, { hash: h }], parameters: { statConstraints: [{ statHash: 2996146975 }, { statHash: 392767087 }] } } }]));
  localStorage.setItem('d2c_farm', JSON.stringify({ tier: '' })); }, [zaouli.h, helm.h]);  // god-roll targets and the set off, so only the build counts
await p.reload(); await p.waitForSelector('#plan');
assert.ok((await plan()).includes('Nothing to farm'), await plan());
await p.check('[data-build="b1"]');
const kf2 = await section('Raids', "King's Fall");
assert.ok(kf2.includes("Zaouli's Bane") && kf2.includes('Build: Spite'));
assert.ok(await p.isChecked('[data-build="b1"]'));
// a build's armor stays on the list until you own a copy with its top two stats
assert.ok((await allText()).includes(`${helm.n}\nYou have it, but not with Weapons + Health\nBuild: Spite`));

assert.deepEqual(errs, []);
assert.deepEqual(unversioned, []);
await b.close();
console.log('farm tests passed');
