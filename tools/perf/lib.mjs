// Headless harness for the 3D mission view: open the game, start a mission, and take manual control
// of the frame loop so two builds can be compared exactly. See tools/perf/README.md.
//
// Needs a dev server:  npx vite --port 5199 --strictPort   (PORT=... overrides the port)
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

export const PORT = Number(process.env.PORT || 5199);
export const OUT = new URL('./out/', import.meta.url).pathname;

/** Places along The Long Night (world x, y): open start, old town, a lit plaza with guards, and so on. */
export const SPOTS = { start: [144, 432], oldtown: [1520, 432], plaza: [2544, 500], boulevard: [3280, 432], factory: [4016, 1380], river: [1840, 1232], railyard: [1808, 2300], border: [3632, 2320], approach: [4848, 3056] };

/**
 * Open the game and start a mission with the page's own frame loop switched off.
 * In the page afterwards:
 *   __step(n = 1, dtMs = 33.4)  run n frames (one simulation tick each at the default dt)
 *   __goto(x, y)                teleport the player and the camera
 *   __settle(x, y, n = 8)       goto + step, n times (camera, lamp slots and shadows settle)
 *   __sync()                    wait for the GPU (for timing)
 *   __vs                        vertex-shader runs since you last zeroed it
 */
export async function open({ port = PORT, w = 1314, h = 704, mission = 'long-night', low = false, hideHud = false } = {}) {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message); console.log('PAGEERROR', e.message); });
  page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); console.log('CONSOLE', m.text()); } });
  await page.addInitScript(() => {
    // Deterministic runs: seeded Math.random (re-seeded before every stepped frame), a fixed
    // mission seed (it comes from Date.now), and no frames until the harness steps them.
    let seed = 1234567;
    Math.random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    window.__reseed = () => { seed = 1234567; };
    window.requestAnimationFrame = () => 0;
    Date.now = () => 1700000000000;
  });
  await page.goto(`http://localhost:${port}/`);
  await page.evaluate((low) => { window.__ironveil.settings.lowEffects = low; }, low);
  await page.click(`[data-mission="${mission}"]`);
  await page.click('#mission');
  // The click builds the world and draws the warm-up frame synchronously (tens of seconds here):
  // trigger it from inside the page, not with page.click and its timeout.
  await page.evaluate(() => { window.__reseed(); document.querySelector('#go').click(); });
  await page.waitForFunction(() => !!window.__ironveil.view(), null, { timeout: 600000 });
  await takeOver(page);
  if (hideHud) await page.addStyleTag({ content: '.h3 { visibility: hidden !important; }' });
  return { browser, page, errors };
}

/** Take over the frame loop of the current view (call again after a mission restart). */
export async function takeOver(page) {
  await page.evaluate(() => {
    const v = window.__ironveil.view();
    if (v.__frame) return;
    v.__frame = v.frame.bind(v);
    v.frame = () => {};
    v.ended = true; // no results screen if the unattended player dies
    // three.js draws object UUIDs from Math.random, so two builds that create different numbers of
    // objects would deal the rain differently: re-deal it from a private generator.
    { let s = 99; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      if (v.rain && v.rain.drops) for (const d of v.rain.drops) { d.x = r() * 1400 - 700; d.y = r() * 400; d.z = r() * 1400 - 700; d.v = 520 + r() * 160; } }
    v.dynRes.update = () => false; v.dynRes.scale = 1; v.resize();
    window.__t = 100000;
    window.__step = (n = 1, dt = 33.4) => { window.__reseed(); for (let i = 0; i < n; i++) { window.__t += dt; v.__frame(window.__t); } };
    window.__goto = (x, y) => { const s = v.session; const t = s.world.tank(s.playerId); t.pos.x = x; t.pos.y = y; v.camTarget.set(x, 0, y); };
    window.__settle = (x, y, n = 8) => { for (let i = 0; i < n; i++) { window.__goto(x, y); window.__step(1); } };
    window.__sync = () => { const gl = v.renderer.getContext(); gl.finish(); const f = new Float32Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, f); if (gl.getError()) { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); gl.getError(); } };
    // vertex-shader runs: unique vertices submitted per draw
    window.__vs = 0;
    const r = v.renderer, direct = r.renderBufferDirect.bind(r);
    r.renderBufferDirect = (camera, scene, geometry, material, object, group) => {
      const pos = geometry.attributes.position, dr = geometry.drawRange;
      const n = geometry.index ? pos.count : Math.min(pos.count, dr.count === Infinity ? pos.count : dr.count);
      window.__vs += n * (object.isInstancedMesh ? object.count : geometry.isInstancedBufferGeometry ? geometry.instanceCount : 1);
      return direct(camera, scene, geometry, material, object, group);
    };
    // kill the first visible enemy through the view's own event path (explosion, wreck, fire, smoke)
    window.__kill = () => { const o = v.session.obs; const foe = o.tanks.find((t) => t.team !== o.team && t.alive); if (foe) v.onEvent({ type: 'death', tank: foe.id, x: foe.x, y: foe.y }); else v.blasts.destroy(v.camTarget.x + 60, v.camTarget.z - 30); return !!foe; };
  });
}

/** Compare two PNG files: mean of the per-pixel largest channel difference (0-255), share of pixels off by more than 8, largest difference. */
export async function compare(fileA, fileB) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const u = (f) => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
  const r = await page.evaluate(async ([ua, ub]) => {
    const load = (u) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = u; });
    const [ia, ib] = await Promise.all([load(ua), load(ub)]);
    const px = (i) => { const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.drawImage(i, 0, 0); return x.getImageData(0, 0, i.width, i.height).data; };
    const da = px(ia), db = px(ib); let sum = 0, off = 0, max = 0;
    for (let i = 0; i < da.length; i += 4) { const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2])); sum += d; if (d > 8) off++; if (d > max) max = d; }
    const n = da.length / 4;
    return { mean: +(sum / n).toFixed(3), offPct: +((off / n) * 100).toFixed(3), max };
  }, [u(fileA), u(fileB)]);
  await browser.close();
  return r;
}
