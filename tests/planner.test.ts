import { describe, it, expect } from 'vitest';
import { plan, type ActionDef } from '../src/ai/planner';
import { interceptPoint } from '../src/ai/aim';

type Ctx = { far: boolean; smoke: boolean };
const A = (name: string, pre: Record<string, boolean>, eff: Record<string, boolean>, cost: (c: Ctx) => number, valid?: (c: Ctx) => boolean): ActionDef<Ctx> => {
  const a: ActionDef<Ctx> = { name, pre, eff, cost };
  if (valid) a.valid = valid;
  return a;
};

const actions: ActionDef<Ctx>[] = [
  A('moveToShot', {}, { hasShot: true }, () => 2),
  A('tap', { hasShot: true, weaponReady: true }, { targetHurt: true }, (c) => (c.far ? 4 : 1)),
  A('charge', { hasShot: true, weaponReady: true }, { targetHurt: true }, (c) => (c.far ? 1.5 : 3)),
  A('waitReload', {}, { weaponReady: true }, () => 1),
  A('smoke', {}, { concealed: true }, () => 1, (c) => c.smoke),
  A('fleeConcealed', { concealed: true }, { safe: true }, () => 1),
  A('flee', {}, { safe: true }, () => 4),
];

describe('GOAP planner', () => {
  it('chains preconditions into a plan', () => {
    const p = plan({ hasShot: false, weaponReady: false }, { targetHurt: true }, actions, { far: false, smoke: true });
    expect(p!.map((a) => a.name).sort()).toEqual(['moveToShot', 'tap', 'waitReload'].sort());
    expect(p![p!.length - 1]!.name).toBe('tap');
  });

  it('chooses the cheaper firing action from context (tap close, charge far)', () => {
    const close = plan({ hasShot: true, weaponReady: true }, { targetHurt: true }, actions, { far: false, smoke: true });
    const far = plan({ hasShot: true, weaponReady: true }, { targetHurt: true }, actions, { far: true, smoke: true });
    expect(close!.map((a) => a.name)).toEqual(['tap']);
    expect(far!.map((a) => a.name)).toEqual(['charge']);
  });

  it('uses smoke when available and falls back when not', () => {
    expect(plan({}, { safe: true }, actions, { far: false, smoke: true })!.map((a) => a.name)).toEqual(['smoke', 'fleeConcealed']);
    expect(plan({}, { safe: true }, actions, { far: false, smoke: false })!.map((a) => a.name)).toEqual(['flee']);
  });

  it('returns an empty plan when the goal already holds and null when impossible', () => {
    expect(plan({ safe: true }, { safe: true }, actions, { far: false, smoke: true })).toEqual([]);
    expect(plan({}, { flying: true }, actions, { far: false, smoke: true })).toBeNull();
  });
});

describe('lead targeting', () => {
  it('aims at a stationary target directly', () => {
    const p = interceptPoint({ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 0, y: 0 }, 500);
    expect(p.x).toBeCloseTo(300, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });
  it('leads a crossing target so the shell and target meet', () => {
    const s = { x: 0, y: 0 };
    const t = { x: 400, y: 0 };
    const v = { x: 0, y: 150 };
    const w = 600;
    const p = interceptPoint(s, t, v, w, 0);
    const time = (p.y - t.y) / v.y;
    expect(time).toBeGreaterThan(0);
    expect(Math.hypot(p.x - s.x, p.y - s.y)).toBeCloseTo(w * time, 3);
  });
  it('falls back to the current position when interception is impossible', () => {
    const p = interceptPoint({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 1000, y: 0 }, 300);
    expect(p).toEqual({ x: 100, y: 0 });
  });
});
