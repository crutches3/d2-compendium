// Browser test for the home page, pinned to Thu Oct 29 2026 05:30 UTC (week 21: Root of Nightmares, Deep Stone Crypt...).
// Run from the repo root: python3 -m http.server 8765 & npm i --no-save playwright && node tools/home.test.mjs
import { chromium } from 'playwright';
import assert from 'assert';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'UTC' })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.clock.setFixedTime(new Date('2026-10-29T05:30:00Z'));
await p.goto('http://localhost:8765/#/'); await p.waitForSelector('#distort .obtain');
const names = async () => p.$$eval('#distort .obody > b', l => l.map(x => x.textContent));
// 36.5 hours after Tuesday's reset: hour 36 is 36 % 7 = 1 step past the reset's Cosmodrome
assert.deepEqual(await names(), ['European Dead Zone', 'The Dreaming City', "Savathun's Throne World", 'Moon']);
assert.equal(await p.textContent('#dcount'), '30m 00s');
assert.equal(await p.textContent('#rcount'), '5d 11h');
assert.deepEqual(await p.$$eval('#distort h3 + .obtains small', l => l.map(x => x.textContent)), ['From 6:00 AM', 'From 7:00 AM', 'From 8:00 AM']);
const text = await p.textContent('#app');
for (const n of ['Root of Nightmares', 'Deep Stone Crypt', 'Desert Perpetual', 'Duality', 'Equilibrium', 'Defiant BG: EDZ', 'Trials of Osiris', 'Warpriest']) assert(text.includes(n), n);
// calibrating to Nessus makes it current and the rest follow the cycle; it sticks across a reload
await p.click('.calibrate summary'); await p.click('[data-distort="6"]');
assert.deepEqual(await names(), ['Nessus', 'Cosmodrome', 'European Dead Zone', 'The Dreaming City']);
await p.reload(); await p.waitForSelector('#distort .obtain');
assert.equal((await names())[0], 'Nessus');
// the weapon list moved to #/weapons, and its nav link lights up there
await p.click('nav a[href="#/weapons"]'); await p.waitForSelector('#list .card');
assert.equal(await p.getAttribute('nav a[href="#/weapons"]', 'aria-current'), '');
assert.deepEqual(errs, []);
await b.close();
console.log('home ok');
