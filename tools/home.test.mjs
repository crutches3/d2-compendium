// Browser test for the home page, pinned to Thu Oct 29 2026 05:30 UTC (week 21: Root of Nightmares, Deep Stone Crypt...).
// Run from the repo root: python3 -m http.server 8765 & npm i --no-save playwright && node tools/home.test.mjs
import { chromium } from 'playwright';
import assert from 'assert';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'UTC' })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.clock.setFixedTime(new Date('2026-10-29T05:30:00Z'));
await p.goto('http://localhost:8765/#/'); await p.waitForSelector('#distort .sphere');
const names = async () => p.$$eval('#distort .sphere b', l => l.map(x => x.textContent));
// 36.5 hours after Tuesday's reset: hour 36 is 36 % 7 = 1 step past the reset's EDZ
assert.deepEqual(await names(), ['Dreaming City', "Savathûn's\nThrone World", 'Moon', 'Europa', 'Nessus', 'Cosmodrome', 'EDZ']);
assert.equal(await p.textContent('#dcount'), '30m 00s');
assert.equal(await p.textContent('#rcount'), '5d 11h');
assert.deepEqual(await p.$$eval('#distort .sphere.next small', l => l.map(x => x.textContent)), ['From 6:00 AM', 'From 7:00 AM', 'From 8:00 AM', 'From 9:00 AM', 'From 10:00 AM', 'From 11:00 AM']);
// every destination has its round picture
assert(await p.$$eval('#distort .sphere img', l => l.every(i => i.complete && i.naturalWidth > 0)));
const text = await p.textContent('#app');
for (const n of ['Root of Nightmares', 'Deep Stone Crypt', 'Desert Perpetual', 'Duality', 'Equilibrium', 'Defiant BG: EDZ', 'Trials of Osiris', 'Warpriest']) assert(text.includes(n), n);
// the Grandmaster's reward weapons sit on its picture and open their weapon pages
await p.waitForSelector('#gmguns a');
assert.equal(await p.$$eval('#gmguns a', l => l.length), 2);
await p.click('#gmguns a'); await p.waitForSelector('#app h1'); assert(p.url().includes('#/weapon/'));
await p.goBack(); await p.waitForSelector('#distort .sphere');
// calibrating to Nessus makes it current and the rest follow the cycle; it sticks across a reload
await p.click('.calibrate summary'); await p.click('[data-distort="6"]');
assert.deepEqual((await names()).slice(0, 3), ['Nessus', 'Cosmodrome', 'EDZ']);
await p.reload(); await p.waitForSelector('#distort .sphere');
assert.equal((await names())[0], 'Nessus');
// Randy's sighting: Europa at 16:44 UTC on Oct 31
await p.evaluate(() => localStorage.removeItem('d2c_distort')); await p.clock.setFixedTime(new Date('2026-10-31T16:44:00Z'));
await p.reload(); await p.waitForSelector('#distort .sphere');
assert.equal((await names())[0], 'Europa');
// the weapon list moved to #/weapons, and its nav link lights up there
await p.click('nav a[href="#/weapons"]'); await p.waitForSelector('#list .card');
assert.equal(await p.getAttribute('nav a[href="#/weapons"]', 'aria-current'), '');
assert.deepEqual(errs, []);
await b.close();
console.log('home ok');
