import { describe, it, expect } from 'vitest';
import { Spring, recoilImpulse } from '../src/client/feel';
import { interpolateTank, shellRenderPos } from '../src/client/interp';
import { DT } from '../src/sim/tuning';
import type { TankView } from '../src/sim/observation';

describe('inertial recoil feel (cosmetic)', () => {
  it('a kicked spring overshoots and settles (spring-like recovery)', () => {
    const s = new Spring(420, 20);
    s.kick(-300);
    let minX = 0;
    let crossed = false;
    for (let i = 0; i < 120; i++) {
      s.step(1 / 120);
      minX = Math.min(minX, s.x);
      if (s.x > 0.05) crossed = true;
    }
    expect(minX).toBeLessThan(-3);
    expect(crossed).toBe(true);
    for (let i = 0; i < 60; i++) s.step(1 / 60);
    expect(Math.abs(s.x)).toBeLessThan(0.05);
  });

  it('is frame-rate independent', () => {
    const a = new Spring(420, 20);
    const b = new Spring(420, 20);
    a.kick(-300);
    b.kick(-300);
    for (let i = 0; i < 6; i++) a.step(1 / 30);
    for (let i = 0; i < 29; i++) b.step(1 / 144);
    b.step(0.2 - 29 / 144);
    expect(a.x).toBeCloseTo(b.x, 4);
  });

  it('heavier shots kick harder; reduced motion removes hull/camera kick', () => {
    const tap = recoilImpulse(0, false);
    const full = recoilImpulse(1, false);
    const mid = recoilImpulse(0.5, false);
    expect(full.barrel).toBeGreaterThan(tap.barrel * 2.5);
    expect(mid.barrel).toBeGreaterThan(tap.barrel);
    expect(mid.barrel).toBeLessThan(full.barrel);
    expect(full.hull).toBeGreaterThan(tap.hull * 3);
    expect(full.camera).toBeGreaterThan(tap.camera * 3);
    const r = recoilImpulse(1, true);
    expect(r.hull).toBe(0);
    expect(r.camera).toBe(0);
    expect(r.barrel).toBeLessThanOrEqual(full.barrel * 0.5);
  });
});

const view = (p: Partial<TankView>): TankView => ({
  id: 1, team: 0, name: 'x', isBot: true, x: 0, y: 0, vx: 0, vy: 0, hull: 0, turret: 0, hp: 100, maxHp: 100, alive: true, reloadTicks: 0,
  phase: 'ready', charge: 0, hold: null, weaponTimer: 0, silent: false, quiet: false, protected: false,
  inBrush: false, revealed: false, smokeReadyTick: 0, respawnTick: -1, aimX: 0, aimY: 0, ...p,
});

describe('presentation interpolation', () => {
  it('lerps position and takes the short way round for angles', () => {
    const r = interpolateTank(view({ x: 0, y: 0, hull: 3.0, turret: -3.0 }), view({ x: 10, y: 4, hull: -3.0, turret: 3.0 }), 0.5);
    expect(r.x).toBeCloseTo(5, 6);
    expect(r.y).toBeCloseTo(2, 6);
    expect(Math.abs(Math.abs(r.hull) - Math.PI)).toBeLessThan(0.3);
  });
  it('a newly revealed or teleported tank snaps to its authorised state', () => {
    expect(interpolateTank(undefined, view({ x: 50 }), 0.2).x).toBe(50);
    expect(interpolateTank(view({ x: 0 }), view({ x: 400 }), 0.5).x).toBe(400);
    expect(interpolateTank(view({ x: 0, alive: false }), view({ x: 10 }), 0.5).x).toBe(10);
  });
  it('back-projects shells exactly along their linear flight', () => {
    const p = { x: 100, y: 50, vx: 600, vy: -300 };
    expect(shellRenderPos(p, 1)).toEqual({ x: 100, y: 50 });
    const z = shellRenderPos(p, 0);
    expect(z.x).toBeCloseTo(100 - 600 * DT, 9);
    expect(z.y).toBeCloseTo(50 + 300 * DT, 9);
  });
});
