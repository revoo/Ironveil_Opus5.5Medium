import { describe, it, expect } from 'vitest';
import { createTank } from '../src/sim/tank';
import { stepMovement } from '../src/sim/movement';
import { neutralInput, type TankInput, type Tank } from '../src/sim/types';
import { TUNING, DT } from '../src/sim/tuning';
import { openMap, mapWith } from './helpers';
import { len, angleDiff } from '../src/sim/math';

const M = TUNING.movement;
const map = openMap(80, 60);

function drive(t: Tank, input: Partial<TankInput>, n: number, m = map, chargeFactor = 1) {
  for (let i = 0; i < n; i++) stepMovement(t, { ...neutralInput(t.pos.x + 100, t.pos.y), ...input }, m, DT, chargeFactor);
}

function fresh(x = 1200, y = 960): Tank {
  return createTank(1, 0, 'T', { x, y }, false);
}

describe('responsive slippery movement', () => {
  it('responds on the very first tick without waiting for hull alignment', () => {
    const t = fresh();
    t.hull = Math.PI; // facing west
    drive(t, { moveX: 1 }, 1); // request east
    expect(t.vel.x).toBeGreaterThan(0);
    expect(t.pos.x).toBeGreaterThan(1200);
  });

  it('reaches roughly top speed within ~0.4 s', () => {
    const t = fresh();
    drive(t, { moveX: 1 }, 12);
    expect(len(t.vel)).toBeGreaterThan(M.maxSpeed * 0.95);
    expect(len(t.vel)).toBeLessThanOrEqual(M.maxSpeed + 1e-6);
  });

  it('normalizes diagonal input to the same top speed', () => {
    const a = fresh();
    const b = fresh();
    drive(a, { moveX: 1 }, 40);
    drive(b, { moveX: 1, moveY: 1 }, 40);
    expect(len(b.vel)).toBeCloseTo(len(a.vel), 3);
  });

  it('preserves momentum through a 90 degree turn (drift)', () => {
    const t = fresh();
    drive(t, { moveX: 1 }, 30);
    drive(t, { moveY: 1 }, 3);
    expect(t.vel.x).toBeGreaterThan(M.maxSpeed * 0.6); // still sliding east
    expect(t.vel.y).toBeGreaterThan(40); // already heading south
    drive(t, { moveY: 1 }, 30);
    expect(Math.abs(t.vel.x)).toBeLessThan(5); // drift resolves
  });

  it('coasts after releasing input, then stops', () => {
    const t = fresh();
    drive(t, { moveX: 1 }, 30);
    const x0 = t.pos.x;
    drive(t, {}, 6);
    expect(t.pos.x - x0).toBeGreaterThan(25); // keeps sliding
    drive(t, {}, 60);
    expect(len(t.vel)).toBe(0);
  });

  it('countersteering brakes harder than coasting', () => {
    const coast = fresh();
    const brake = fresh();
    drive(coast, { moveX: 1 }, 30);
    drive(brake, { moveX: 1 }, 30);
    drive(coast, {}, 6);
    drive(brake, { moveX: -1 }, 6);
    expect(brake.vel.x).toBeLessThan(coast.vel.x - 50);
  });

  it('rotates the hull visually toward the requested direction at a bounded rate', () => {
    const t = fresh();
    t.hull = 0;
    drive(t, { moveY: 1 }, 1);
    const turned = angleDiff(0, t.hull);
    expect(turned).toBeGreaterThan(0);
    expect(turned).toBeLessThanOrEqual(M.hullTurnRate * DT + 1e-9);
    drive(t, { moveY: 1 }, 30);
    expect(t.hull).toBeCloseTo(Math.PI / 2, 5);
  });

  it('limits turret traverse rate independent of hull', () => {
    const t = fresh();
    t.turret = 0;
    stepMovement(t, { ...neutralInput(t.pos.x, t.pos.y + 300) }, map, DT, 1);
    expect(t.turret).toBeCloseTo(M.turretTurnRate * DT, 6);
  });

  it('applies terrain speed factors (mud slower than grass, road faster)', () => {
    const rows = ['#'.repeat(80)];
    for (let r = 0; r < 8; r++) rows.push('#' + '~'.repeat(78) + '#');
    for (let r = 0; r < 8; r++) rows.push('#' + '='.repeat(78) + '#');
    rows.push('#'.repeat(80));
    const m = mapWith(rows);
    const mud = fresh(200, 32 * 4);
    const road = fresh(200, 32 * 12);
    drive(mud, { moveX: 1 }, 60, m);
    drive(road, { moveX: 1 }, 60, m);
    expect(len(mud.vel)).toBeCloseTo(M.maxSpeed * TUNING.terrain.mud.speed, 0);
    expect(len(road.vel)).toBeCloseTo(M.maxSpeed * TUNING.terrain.road.speed, 0);
  });

  it('silent running caps speed and becomes quiet only once slow enough', () => {
    const t = fresh();
    drive(t, { moveX: 1 }, 30);
    drive(t, { moveX: 1, silent: true }, 1);
    expect(t.silent).toBe(true);
    expect(t.quiet).toBe(false); // braking into silence is not instantly quiet
    drive(t, { moveX: 1, silent: true }, 40);
    expect(len(t.vel)).toBeLessThanOrEqual(M.maxSpeed * M.silentFactor + 1e-6);
    expect(t.quiet).toBe(true);
  });

  it('charging scales speed down to the full-charge factor', () => {
    const t = fresh();
    drive(t, { moveX: 1 }, 60, map, M.chargeSpeedFactor);
    expect(len(t.vel)).toBeCloseTo(M.maxSpeed * M.chargeSpeedFactor, 0);
  });

  it('slides along walls instead of sticking', () => {
    const t = fresh(32 + 21, 600); // touching west border wall
    drive(t, { moveX: -1, moveY: 1 }, 30);
    expect(t.pos.x).toBeGreaterThanOrEqual(32 + 20 - 1e-6);
    expect(t.pos.y).toBeGreaterThan(700);
  });

  it('never ends a tick overlapping a wall even at high speed', () => {
    const t = fresh(200, 200);
    t.vel = { x: -2000, y: -1500 };
    drive(t, {}, 3);
    expect(t.pos.x).toBeGreaterThanOrEqual(52 - 1e-6);
    expect(t.pos.y).toBeGreaterThanOrEqual(52 - 1e-6);
  });

  it('is deterministic: same inputs give bit-identical positions', () => {
    const a = fresh();
    const b = fresh();
    drive(a, { moveX: 1, moveY: -0.3 }, 45);
    for (let i = 0; i < 9; i++) drive(b, { moveX: 1, moveY: -0.3 }, 5);
    expect(b.pos).toEqual(a.pos);
  });
});
