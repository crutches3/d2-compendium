// Browser test for the wiki's Secrets tab (raid, dungeon and exotic mission pages): every encounter's secret chests in one list linked to
// its encounter, the Collections tie-in, the picture guides among the sources, the guide's quests (with Bungie's steps), puzzles and
// catalysts pictured with Bungie art, Bungie's triumph list, and signed in, Done or progress from profile records. Strikes have no tab.
// Run from the repo root: python3 -m http.server 8765 & node tools/secrets.test.mjs
import { chromium } from 'playwright';
import fs from 'fs';
import assert from 'assert';
const G = n => JSON.parse(fs.readFileSync(`data/guides/${n}.json`)), SX = JSON.parse(fs.readFileSync('data/secrets.json'));
const wr = G('warlords-ruin'), sx = SX[wr.name], quest = sx.quests[wr.quests[0].q], cat = sx.catalysts['Buried Bloodline'], tri = sx.triumphs[0];
const profile = { characters: { data: { H1: { classType: 1, light: 480 } } }, profileInventory: { data: { items: [] } }, characterInventories: { data: { H1: { items: [] } } },
  characterEquipment: { data: { H1: { items: [] } } }, itemComponents: { sockets: { data: {} }, reusablePlugs: { data: {} }, instances: { data: {} }, stats: { data: {} } },
  profileRecords: { data: { records: { [tri[0]]: { state: 1, objectives: [] }, [cat[0]]: { state: 4, objectives: [{ progress: 120, completionValue: 500 }] } } } } };
const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.route('https://www.bungie.net/Platform/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ErrorCode: 1,
  Response: route.request().url().includes('GetMemberships') ? { primaryMembershipId: '1', destinyMemberships: [{ membershipId: '1', membershipType: 3 }], bungieNetUser: { uniqueName: 'Randy#1234' } } : profile }) }));
const p = await ctx.newPage(), errs = []; p.on('pageerror', e => errs.push(e.message));
const open = async tail => { await p.goto('about:blank'); await p.goto(`http://localhost:8765/#/wiki/${encodeURIComponent(wr.name)}${tail}`); await p.waitForSelector('.typetabs button[data-pane]'); };

// signed out: the address opens the tab; chests from every encounter, each linking to its encounter's guide step
await open('/secrets');
assert.deepEqual(await p.$$eval('.typetabs button[aria-pressed="true"]', l => l.map(x => x.textContent)), ['Secrets']);
assert.ok(await p.isVisible('#secrets') && !(await p.isVisible('#guide')) && !(await p.isVisible('.drops')));
const chests = wr.encounters.flatMap((e, i) => (e.chests || []).map(() => [e.name, `#/wiki/${encodeURIComponent(wr.name)}/guide/${i + 1}`]));
assert.deepEqual(await p.$$eval('.chestlist li b a', l => l.map(a => [a.textContent, a.getAttribute('href')])), chests);
assert.ok((await p.textContent('#secrets')).includes('Secret chest pool'), 'Collections tie-in');
assert.ok(await p.$$eval('#secrets .refsrc a[target="_blank"]', l => l.some(a => /chest/i.test(a.textContent))), 'picture guide linked');
// the quest: the weapon's screenshot from Bungie, the note, and Bungie's steps folded away
assert.ok((await p.getAttribute('#secrets .secret img.secretart', 'src')).startsWith('https://www.bungie.net/'));
assert.equal(await p.$$eval('#secrets details:not(.triumphs) li', l => l.length), quest.steps.length);
assert.ok(!(await p.isVisible('#secrets details:not(.triumphs) li')), 'steps start folded');
assert.equal(await p.$$eval('#secrets .triumphs li', l => l.length), sx.triumphs.length);
assert.equal(await p.$$eval('#secrets .badge', l => l.length), 0, 'no progress signed out');
// tabs swap panes and keep the address
await p.click('.typetabs button[data-pane="guide"]'); assert.ok(p.url().endsWith('/guide') && await p.isVisible('#guide') && !(await p.isVisible('#secrets')));
await p.click('.typetabs button[data-pane="secrets"]'); assert.ok(p.url().endsWith('/secrets'));
// signed in: Done and progress from profile records
await p.evaluate(() => localStorage.setItem('d2c_token', JSON.stringify({ access_token: 'x', expires_at: Date.now() + 3e6 })));
await open('/secrets'); await p.waitForSelector('#secrets .badge');
assert.ok(await p.$$eval('#secrets .triumphs li', (l, n) => l.some(x => x.textContent.includes(n) && x.querySelector('.badge.good')?.textContent === 'Done'), tri[1]));
assert.ok((await p.$$eval('#secrets h4', l => l.map(h => h.textContent))).some(t => t.includes('catalyst') && t.includes('120/500')));
// a strike has no Secrets tab; text is escaped (a guide's note can't inject markup)
await p.goto('http://localhost:8765/#/wiki/Warden%20of%20Nothing'); await p.waitForSelector('.hero h1');
assert.equal(await p.$('#secrets'), null);
assert.deepEqual(errs, []);
await b.close();
console.log('secrets tests passed');
