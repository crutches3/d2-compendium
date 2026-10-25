// Browser test for the Armor list: a section per class, and Bungie's class logos as the class filter, each naming its class on hover.
// Run from the repo root: python3 -m http.server 8765 & npm i --no-save playwright && node tools/armor.test.mjs
import { chromium } from 'playwright';
import fs from 'fs';
import assert from 'assert';
const OUT = (await import('os')).tmpdir() + '/';
const A = JSON.parse(fs.readFileSync('data/armor.json'));
const clOf = new Map(A.armor.map(x => [String(x.h), x.cl]));
const current = c => new Set(A.armor.filter(x => x.a3 && x.cl === c).map(x => x.n)).size;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
const heads = () => p.$$eval('.classhead', hs => hs.map(h => h.textContent.replace(/\s+/g, ' ').trim()));
const classesShown = () => p.$$eval('#list .card', cs => cs.map(c => c.getAttribute('href').split('/').pop())).then(hs => [...new Set(hs.map(h => clOf.get(h)))]);

// no class picked: Hunter, Titan and Warlock each get a section with their logo, the first 48 pieces and a way to see the rest
await p.goto('http://localhost:8765/#/armor'); await p.waitForSelector('.classhead');
assert.deepEqual(await heads(), ['Hunter', 'Titan', 'Warlock'].map(c => `${c} ${current(c)}`));
assert.deepEqual(await p.$$eval('.classgroup', gs => gs.map(g => g.querySelectorAll('.card').length)), [48, 48, 48]);
assert.ok((await p.$$('.classhead img')).length === 3);
assert.deepEqual(await p.$$eval('.showall', bs => bs.map(x => x.textContent)), ['Hunter', 'Titan', 'Warlock'].map(c => `Show all ${current(c)} ${c} pieces`));

// the class buttons are the logos, named for screen readers and on hover
assert.deepEqual(await p.$$eval('.classpick button', bs => bs.map(x => [x.getAttribute('aria-label'), x.getAttribute('aria-pressed'), !!x.querySelector('img')])),
  [['Hunter', 'false', true], ['Titan', 'false', true], ['Warlock', 'false', true]]);
const tip = sel => p.$eval(sel, el => { const s = getComputedStyle(el, '::after'); return [s.content, +s.opacity]; });
assert.deepEqual(await tip('.classpick [data-cl="Titan"]'), ['"Titan"', 0]);
await p.hover('.classpick [data-cl="Titan"]'); await p.waitForTimeout(350);
assert.deepEqual(await tip('.classpick [data-cl="Titan"]'), ['"Titan"', 1]);
await p.screenshot({ path: OUT + 'armor-d.png' });

// a logo shows just that class, in full; pressing it again brings every class back
await p.click('.classpick [data-cl="Titan"]');
assert.deepEqual(await heads(), [`Titan ${current('Titan')}`]);
assert.deepEqual(await classesShown(), ['Titan']);
assert.equal(await p.$$eval('#list .card', cs => cs.length), current('Titan'));
assert.equal(await p.getAttribute('.classpick [data-cl="Titan"]', 'aria-pressed'), 'true');
await p.click('.classpick [data-cl="Warlock"]');
assert.deepEqual(await classesShown(), ['Warlock']);
await p.click('.classpick [data-cl="Warlock"]');
assert.equal((await heads()).length, 3);
assert.deepEqual(await p.$$eval('.classpick [aria-pressed="true"]', bs => bs.length), 0);

// "Show all" picks that class
await p.click('.showall[data-cl="Hunter"]');
assert.deepEqual(await classesShown(), ['Hunter']);
assert.equal(await p.getAttribute('.classpick [data-cl="Hunter"]', 'aria-pressed'), 'true');
await p.click('.classpick [data-cl="Hunter"]');

// filters and search still work inside the sections; a section with no matches drops out
await p.selectOption('#ty', 'Hunter Cloak');
assert.deepEqual((await heads()).map(h => h.split(' ')[0]), ['Hunter']);
await p.selectOption('#ty', '');
await p.fill('#q', 'zzzz no such armor');
assert.match(await p.textContent('#list'), /No armor matches/);
await p.fill('#q', '');

// ?cl= opens on a class; leaving and coming back doesn't double up the click handling
await p.goto('http://localhost:8765/#/armor?cl=Warlock'); await p.waitForSelector('.classhead');
assert.deepEqual(await classesShown(), ['Warlock']);
await p.goto('http://localhost:8765/#/sets'); await p.goto('http://localhost:8765/#/armor'); await p.waitForSelector('.classhead');
await p.click('.classpick [data-cl="Titan"]'); assert.deepEqual(await classesShown(), ['Titan']);

await p.setViewportSize({ width: 390, height: 844 }); await p.click('.classpick [data-cl="Titan"]'); await p.waitForTimeout(200);
await p.screenshot({ path: OUT + 'armor-m.png' });
assert.deepEqual(errs, []);
console.log('armor tests passed');
await b.close();
