// Six deterministic screenshots (HUD hidden) into tools/perf/out/<label>/.
//   node tools/perf/shots.mjs before          (then change the code)
//   node tools/perf/shots.mjs after
//   node tools/perf/diff.mjs before after
import fs from 'fs';
import { open, OUT } from './lib.mjs';
const label = process.argv[2];
if (!label) throw new Error('usage: node tools/perf/shots.mjs <label>');
const dir = `${OUT}${label}/`;
fs.mkdirSync(dir, { recursive: true });
const { browser, page, errors } = await open({ hideHud: true, low: process.argv.includes('--low') });
for (const [name, [x, y]] of Object.entries({ start: [144, 848], plaza: [2544, 916], factory: [4016, 1796], river: [1840, 1648], border: [3632, 2736] })) {
  await page.evaluate(([x, y]) => { window.__goto(x, y); window.__step(8); }, [x, y]);
  await page.screenshot({ path: `${dir}${name}.png`, timeout: 600000 });
  console.log('shot', name);
}
// a fight: a kill at the lit plaza, 0.3 s in
await page.evaluate(() => { const v = window.__ironveil.view(); window.__settle(2544, 916, 3); window.__kill(); v.flashes.add(2500, 936, 'impact'); for (let i = 0; i < 9; i++) { v.camTarget.set(2544, 0, 916); window.__step(1); } });
await page.screenshot({ path: `${dir}fight.png`, timeout: 600000 });
console.log('shot fight');
console.log(errors.length ? `ERRORS: ${errors.length}` : 'no page errors');
await browser.close();
