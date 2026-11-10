// The same region of one shot from several screenshot sets, side by side and zoomed, for a look by eye.
//   node tools/perf/crop.mjs <shot> <x> <y> <w> <h> <zoom> <labelA> <labelB> [...]
//   e.g. node tools/perf/crop.mjs border 560 160 400 340 2 before after   ->  tools/perf/out/crop-border-before-after.png
import { createRequire } from 'module';
import fs from 'fs';
import { OUT } from './lib.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [name, x, y, w, h, zoom, ...sets] = process.argv.slice(2);
if (sets.length < 1) throw new Error('usage: node tools/perf/crop.mjs <shot> <x> <y> <w> <h> <zoom> <label> [<label> ...]');
const browser = await chromium.launch();
const page = await browser.newPage();
const us = sets.map((d) => 'data:image/png;base64,' + fs.readFileSync(`${OUT}${d}/${name}.png`).toString('base64'));
const png = await page.evaluate(async ([us, x, y, w, h, z]) => {
  const load = (u) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = u; });
  const imgs = await Promise.all(us.map(load));
  const c = document.createElement('canvas'); c.width = (w * z + 4) * imgs.length - 4; c.height = h * z; const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  imgs.forEach((im, i) => g.drawImage(im, x, y, w, h, i * (w * z + 4), 0, w * z, h * z));
  return c.toDataURL('image/png').split(',')[1];
}, [us, +x, +y, +w, +h, +zoom]);
const out = `${OUT}crop-${name}-${sets.join('-')}.png`;
fs.writeFileSync(out, Buffer.from(png, 'base64'));
console.log(out);
await browser.close();
