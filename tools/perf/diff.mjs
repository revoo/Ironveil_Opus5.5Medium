// Compare two screenshot sets made by shots.mjs.
//   node tools/perf/diff.mjs before after
// mean: average over pixels of the largest channel difference (0-255). offPct: pixels off by more than 8.
import fs from 'fs';
import { compare, OUT } from './lib.mjs';
const [a, b] = process.argv.slice(2);
if (!a || !b) throw new Error('usage: node tools/perf/diff.mjs <labelA> <labelB>');
for (const f of fs.readdirSync(OUT + a).sort()) {
  if (!fs.existsSync(`${OUT}${b}/${f}`)) continue;
  const r = await compare(`${OUT}${a}/${f}`, `${OUT}${b}/${f}`);
  console.log(f.padEnd(14), `mean ${String(r.mean).padStart(7)}   off>8 ${String(r.offPct).padStart(7)}%   max ${r.max}`);
}
