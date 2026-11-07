// Browser test for the header search. Run from the repo root: python3 -m http.server 8765 & node tools/search.test.mjs
import { chromium } from 'playwright';
import assert from 'assert';
const b = await chromium.launch();
const errs = [];
for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  const p = await (await b.newContext({ viewport })).newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => localStorage.setItem('d2c_builds', JSON.stringify([{ key: 'k1', name: 'Gyrfalcon Void Hunter', loadout: { equipped: [] } }])));
  await p.goto('http://localhost:8765/#/'); await p.waitForSelector('#app h1, #app .act');
  const q = '.sitesearch input', res = async () => p.$$eval('.sres a b', l => l.map(x => x.textContent));
  const find = async t => { await p.fill(q, t); await p.waitForFunction(() => { const r = document.querySelector('.sres'); return !r.hidden && !r.textContent.startsWith('Loading'); }); };
  // a weapon, the whole name first
  await find('fatebringer'); assert.equal((await res())[0], 'Fatebringer');
  assert((await p.textContent('.sres a small')).startsWith('Weapon'));
  // a raid's wiki page
  await find('vault of glass'); assert.equal((await res())[0], 'Vault of Glass');
  // a vendor, an exotic armor piece and a champion
  await find('xur'); assert((await res()).some(n => /X[uû]r/.test(n)), 'Xur');
  await find('celestial nighthawk'); assert.equal((await res())[0], 'Celestial Nighthawk');
  await find('overload'); assert((await res()).includes('Overload'));
  // a saved build
  await find('gyrfalcon void'); assert.equal((await res())[0], 'Gyrfalcon Void Hunter');
  // Enter opens the first result and clears the box
  await find('fatebringer'); await p.press(q, 'Enter'); await p.waitForFunction(() => location.hash.startsWith('#/weapon/') && !document.querySelector('.sitesearch input').value);
  assert(p.url().includes('#/weapon/')); assert.equal(await p.inputValue(q), ''); assert(await p.$eval('.sres', e => e.hidden));
  // arrows move through results, a click opens one
  await find('vault of glass'); await p.press(q, 'ArrowDown');
  assert.equal(await p.evaluate(() => document.activeElement.closest('.sres') !== null), true);
  await p.click('.sres a >> nth=0'); await p.waitForFunction(() => location.hash.startsWith('#/wiki/'));
  // nothing found
  await find('zzqqx'); assert((await p.textContent('.sres')).includes('Nothing called'));
  // "/" focuses the box
  await p.press(q, 'Escape'); await p.click('footer'); await p.keyboard.press('/');
  assert(await p.evaluate(() => document.activeElement.matches('.sitesearch input')));
  // the header doesn't scroll sideways
  assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await p.fill(q, 'fate'); await p.waitForSelector('.sres a');
  await p.screenshot({ path: `/tmp/claude-0/search-${viewport.width}.png` });
}
assert.deepEqual(errs, []);
await b.close();
console.log('search ok');
