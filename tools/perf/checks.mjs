// Functional checks of the 3D view, each printing PASS or FAIL. Exit code 1 if anything fails.
//   node tools/perf/checks.mjs
// 1. No page errors through: Low preset, switching presets mid-mission, a dynamic-resolution step,
//    two mission restarts (dispose + rebuild), a kill with its explosion.
// 2. Shadows leave nothing behind: after driving, mid-fight and once the debris has faded, the
//    picture must equal one whose moon shadow map was redrawn from scratch.
import fs from 'fs';
import { open, takeOver, compare, OUT } from './lib.mjs';
const dir = `${OUT}checks/`;
fs.mkdirSync(dir, { recursive: true });
let failed = 0;
const report = (ok, what, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? '  ' + detail : ''}`); if (!ok) failed++; };

// ---- 1. presets, resize, restart, fight (small window: speed)
{
  const { browser, page, errors } = await open({ w: 657, h: 352, low: true });
  const settle = () => page.evaluate(() => window.__settle(2544, 500, 6));
  await settle();
  await page.evaluate(() => { const iv = window.__ironveil; iv.settings.lowEffects = false; iv.view().applySettings(); });
  await settle();
  await page.evaluate(() => { const iv = window.__ironveil; iv.settings.lowEffects = true; iv.view().applySettings(); });
  await settle();
  await page.evaluate(() => { const iv = window.__ironveil; iv.settings.lowEffects = false; const v = iv.view(); v.applySettings(); v.dynRes.scale = 0.7; v.resize(); });
  await settle();
  report(errors.length === 0, 'Low preset, preset switches and a resolution step', errors.join(' | '));
  errors.length = 0;
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('Escape');
    await page.waitForSelector('#restart');
    await page.evaluate(() => document.querySelector('#restart').click());
    await page.waitForFunction(() => window.__ironveil.view() && !window.__ironveil.view().__frame, null, { timeout: 600000 });
    await takeOver(page);
    await settle();
  }
  const lost = await page.evaluate(() => window.__ironveil.view().renderer.getContext().isContextLost());
  report(errors.length === 0 && !lost, 'two mission restarts', errors.join(' | '));
  errors.length = 0;
  await page.evaluate(() => { const v = window.__ironveil.view(); window.__kill(); v.smoke.wreck(2600, 470); v.sparks.burst(2560, 10, 500, 1, 0, 60, 260); for (let k = 0; k < 40; k++) { v.camTarget.set(2544, 0, 500); window.__step(1); } });
  await page.screenshot({ path: `${dir}fight.png`, timeout: 600000 });
  report(errors.length === 0, 'a kill with explosion, fire and smoke', errors.join(' | ') || `(look at ${dir}fight.png)`);
  await browser.close();
}

// ---- 2. incremental shadows equal a full redraw
{
  const { browser, page, errors } = await open({ w: 657, h: 352, hideHud: true });
  const pair = async (name) => {
    // two frames with dt = 0: nothing moves between them; the second has its shadow caches thrown away
    await page.evaluate(() => { const v = window.__ironveil.view(); v.barrelMark.visible = false; window.__step(1, 0); v.barrelMark.visible = false; });
    await page.screenshot({ path: `${dir}${name}-kept.png`, timeout: 600000 });
    await page.evaluate(() => {
      const v = window.__ironveil.view();
      v.moonShadow.key[0] = NaN; // scenery layer stale: everything redrawn
      v.scene.traverse((o) => { if (o.isSpotLight && o.castShadow) o.shadow.needsUpdate = true; });
      if (v.lampLights.invalidate) v.lampLights.invalidate();
      window.__step(1, 0);
    });
    await page.screenshot({ path: `${dir}${name}-fresh.png`, timeout: 600000 });
    const r = await compare(`${dir}${name}-kept.png`, `${dir}${name}-fresh.png`);
    report(r.offPct < 0.005 && r.max < 40, `shadows after ${name} equal a full redraw`, `mean ${r.mean} off>8 ${r.offPct}% max ${r.max}`);
  };
  // the aim marker follows the turret between frames: keep it out of the comparison
  await page.evaluate(() => { const v = window.__ironveil.view(); window.__settle(2500, 520, 6);
    for (let i = 0; i < 25; i++) { const s = v.session, t = s.world.tank(s.playerId); t.pos.x = 2500 + i * 5; t.pos.y = 520 - i * 2; v.camTarget.set(2544, 0, 500); window.__step(1); } });
  await pair('driving');
  await page.evaluate(() => { const v = window.__ironveil.view(); window.__kill(); for (let i = 0; i < 12; i++) { v.camTarget.set(2544, 0, 500); window.__step(1); } });
  await pair('a kill');
  await page.evaluate(() => { const v = window.__ironveil.view(); let n = 0; while (v.blasts.debrisInFlight && n < 200) { v.camTarget.set(2544, 0, 500); window.__step(1, 100); n++; } for (let i = 0; i < 3; i++) { v.camTarget.set(2544, 0, 500); window.__step(1, 100); } });
  await pair('the debris fading');
  report(errors.length === 0, 'no page errors in the shadow run', errors.join(' | '));
  await browser.close();
}
console.log(failed ? `${failed} FAILED` : 'ALL PASS');
process.exit(failed ? 1 : 0);
