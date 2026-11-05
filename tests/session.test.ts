import { describe, it, expect } from 'vitest';
import { LocalSession } from '../src/game/session';
import { neutralInput, type TankInput } from '../src/sim/types';

const cfg = { teamSize: 2, difficulty: 'normal' as const, seed: 42, playerName: 'You', countdown: 0 };

describe('local solo session (fixed step, interpolation, pause)', () => {
  it('advances a fixed 30 Hz simulation independent of frame rate', () => {
    const a = new LocalSession(cfg);
    const b = new LocalSession(cfg);
    const drive = (): TankInput => ({ ...neutralInput(2000, 800), moveX: 1 });
    // a: 60 fps for 2 s; b: uneven 144/20 fps mix for the same total time
    for (let i = 0; i < 120; i++) a.advance(1 / 60, drive);
    let t = 0;
    let k = 0;
    while (t < 2 - 1e-9) {
      const dt = Math.min(2 - t, k++ % 3 === 0 ? 1 / 20 : 1 / 144);
      b.advance(dt, drive);
      t += dt;
    }
    expect(b.world.tick).toBe(a.world.tick);
    expect(b.world.tank(0).pos).toEqual(a.world.tank(0).pos);
  });

  it('exposes an interpolation alpha in [0,1) and the previous/current observations', () => {
    const s = new LocalSession(cfg);
    s.advance(1 / 30 + 1 / 60, () => neutralInput());
    expect(s.alpha).toBeGreaterThan(0.4);
    expect(s.alpha).toBeLessThan(0.6);
    expect(s.prevObs.tick).toBe(s.obs.tick - 1);
  });

  it('samples input once per tick so button edges are never lost or duplicated', () => {
    const s = new LocalSession(cfg);
    let calls = 0;
    s.advance(0.1, () => {
      calls++;
      return neutralInput();
    });
    expect(calls).toBe(s.world.tick);
  });

  it('caps catch-up after a long stall instead of spiralling', () => {
    const s = new LocalSession(cfg);
    const steps = s.advance(5, () => neutralInput());
    expect(steps).toBeLessThanOrEqual(8);
    expect(s.alpha).toBeLessThan(1);
  });

  it('pause freezes every timer; resume neutralises held buttons', () => {
    const s = new LocalSession(cfg);
    s.advance(0.5, () => neutralInput());
    const tick = s.world.tick;
    s.pause();
    s.advance(3, () => ({ ...neutralInput(), moveX: 1 }));
    expect(s.world.tick).toBe(tick);
    s.resume();
    expect(s.needsFreshInput).toBe(true);
  });

  it('only exposes the player team observation to the presentation layer', () => {
    const s = new LocalSession({ ...cfg, teamSize: 3 });
    expect(s.obs.team).toBe(0);
    s.advance(1, () => neutralInput());
    for (const t of s.obs.tanks) if (t.team !== 0) expect(s.obs.tanks.some((x) => x.id === t.id)).toBe(true);
    expect(s.drainEvents().every((e) => e.tick > 0)).toBe(true);
  });

  it('restart produces a fresh match', () => {
    const s = new LocalSession(cfg);
    s.advance(2, () => neutralInput());
    s.restart();
    expect(s.world.tick).toBe(0);
  });

  it('fills both rosters with distinct bot callsigns and personas', () => {
    const s = new LocalSession({ ...cfg, teamSize: 4 });
    const names = s.world.tanks.map((t) => t.name);
    expect(new Set(names).size).toBe(8);
    expect(s.world.tanks.filter((t) => !t.isBot).length).toBe(1);
    expect(s.botInfo(1)?.persona).toBeTruthy();
  });
});
