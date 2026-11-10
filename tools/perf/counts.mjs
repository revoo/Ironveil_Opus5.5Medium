// Exact per-frame counts, the same on any machine: draw calls, triangles and vertex-shader runs
// while driving at nine places, then what a kill adds over the following seconds.
//   node tools/perf/counts.mjs
import { open, SPOTS } from './lib.mjs';
// counts do not depend on resolution (same aspect ratio, same culling): a small window is 4x faster here
const { browser, page, errors } = await open({ w: 657, h: 352 });
let tot = { c: 0, t: 0, v: 0 }, n = 0;
console.log('DRIVING (mean of six frames, ~4 units a frame)');
for (const [name, [x, y]] of Object.entries(SPOTS)) {
  const r = await page.evaluate(([x, y]) => {
    const v = window.__ironveil.view();
    window.__settle(x, y);
    const out = { calls: 0, tris: 0, vs: 0 }, F = 6;
    for (let i = 0; i < F; i++) {
      window.__goto(x + 4 * (i + 1), y); window.__vs = 0; window.__step(1);
      out.calls += v.renderer.info.render.calls / F; out.tris += v.renderer.info.render.triangles / F; out.vs += window.__vs / F;
    }
    return out;
  }, [x, y]);
  console.log(`  ${name.padEnd(10)} draws ${r.calls.toFixed(0).padStart(4)}  tris ${(r.tris / 1e3).toFixed(0).padStart(4)}k  vertex runs ${(r.vs / 1e3).toFixed(0).padStart(5)}k`);
  tot.c += r.calls; tot.t += r.tris; tot.v += r.vs; n++;
}
console.log(`  ${'MEAN'.padEnd(10)} draws ${(tot.c / n).toFixed(0).padStart(4)}  tris ${(tot.t / n / 1e3).toFixed(0).padStart(4)}k  vertex runs ${(tot.v / n / 1e3).toFixed(0).padStart(5)}k`);

console.log('A KILL at the plaza (camera fixed)');
const fight = await page.evaluate(() => {
  const v = window.__ironveil.view();
  window.__settle(2544, 500);
  const snap = (label) => {
    let sprites = 0, puffs = 0, objects = 0;
    v.scene.traverse((o) => { objects++; if (!o.visible) return; if (o.isSprite) sprites++; else if (o.isMesh && o.material && o.material.isMeshLambertMaterial) puffs++; });
    return { label, draws: v.renderer.info.render.calls, ktris: Math.round(v.renderer.info.render.triangles / 1000), sprites, puffs, objects };
  };
  const out = [snap('calm')];
  window.__kill();
  for (const [frames, label] of [[6, '0.2 s after'], [24, '1 s'], [30, '2 s'], [60, '4 s'], [120, '8 s']]) {
    for (let i = 0; i < frames; i++) { v.camTarget.set(2544, 0, 500); window.__step(1); }
    out.push(snap(label));
  }
  return out;
});
for (const s of fight) console.log(`  ${s.label.padEnd(12)} draws ${String(s.draws).padStart(4)}  tris ${String(s.ktris).padStart(4)}k  sprites ${String(s.sprites).padStart(3)}  smoke billboards ${String(s.puffs).padStart(3)}  scene objects ${s.objects}`);
console.log(errors.length ? `ERRORS: ${errors.length}` : 'no page errors');
await browser.close();
