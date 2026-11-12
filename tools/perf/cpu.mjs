// JavaScript time per frame by part, while driving. Real CPU numbers (of this machine), but the
// `render` figure is inflated here: the software renderer back-pressures the main thread.
// Use it to compare the other parts, and `render` only between two runs on the same machine.
//   node tools/perf/cpu.mjs
import { open } from './lib.mjs';
const { browser, page } = await open({ w: 657, h: 352 });
for (const [name, [x, y]] of Object.entries({ start: [144, 848], plaza: [2544, 916] })) {
  const r = await page.evaluate(([x, y]) => {
    const v = window.__ironveil.view();
    window.__settle(x, y, 5); window.__sync();
    const acc = {};
    const wrap = (obj, fn, key) => { if (!obj || !obj[fn]) return () => {}; const o = obj[fn].bind(obj); obj[fn] = (...a) => { const t = performance.now(); const r = o(...a); acc[key] = (acc[key] || 0) + performance.now() - t; return r; }; return () => (obj[fn] = o); };
    const undo = [
      wrap(v.post, 'render', 'render'), wrap(v.moonShadow, 'update', 'moonShadow'), wrap(v.hud, 'update', 'hud'), wrap(v.session, 'advance', 'sim'),
      wrap(v.rain, 'update', 'rain'), wrap(v.sparks, 'update', 'sparks'), wrap(v.smoke, 'update', 'smoke'), wrap(v.blasts, 'update', 'blasts'), wrap(v.decals, 'syncTracks', 'tracks'),
      wrap(v.lampLights, 'update', 'lamps'), wrap(v, 'renderTanks', 'tanks'), wrap(v, 'directAudio', 'audio'), wrap(v.comms, 'update', 'comms'),
    ];
    const N = 40; let total = 0;
    for (let i = 0; i < N; i++) { const s = v.session, t = s.world.tank(s.playerId); window.__goto(t.pos.x + 2, t.pos.y); const t0 = performance.now(); window.__step(1, 16.7); total += performance.now() - t0; if (i % 8 === 7) window.__sync(); }
    undo.forEach((u) => u());
    const out = { total: +(total / N).toFixed(2) };
    for (const k in acc) out[k] = +(acc[k] / N).toFixed(2);
    return out;
  }, [x, y]);
  console.log(name.padEnd(6), JSON.stringify(r));
}
await browser.close();
