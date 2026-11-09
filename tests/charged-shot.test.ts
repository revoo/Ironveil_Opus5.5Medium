import { describe, it, expect } from 'vitest';
import { World } from '../src/sim/world';
import { neutralInput, type TankInput } from '../src/sim/types';
import { TUNING } from '../src/sim/tuning';
import { WEAPON_TICKS, reloadTicksFor, shotStats, splashStats } from '../src/sim/weapon';
import { openMap, mapWith } from './helpers';

type Spec = { name: string; team: 0 | 1; pos: { x: number; y: number }; hp?: number };
const world = (specs: Spec[], map = openMap(60, 40)) => new World({ map, seed: 7, countdown: 0, tanks: specs.map((s) => ({ ...s, isBot: false })) });

/** Hold fire for `ticks`, then release at the target; then let the shell fly. */
function chargedShot(w: World, at: { x: number; y: number }, ticks: number): void {
  for (let i = 0; i < 30; i++) w.step({ 0: neutralInput(at.x, at.y) }); // traverse the turret
  const hold = (extra: Partial<TankInput>): TankInput => ({ ...neutralInput(at.x, at.y), fireHeld: true, ...extra });
  w.step({ 0: hold({ firePressed: true }) });
  for (let i = 0; i < ticks; i++) w.step({ 0: hold({}) });
  w.step({ 0: { ...neutralInput(at.x, at.y), fireReleased: true } });
  for (let i = 0; i < 60; i++) w.step({});
}

describe('charged shot: a strategic choice', () => {
  it('damage climbs steeply: a tap 22, half charge barely more, full charge 80', () => {
    expect(shotStats(0).damage).toBe(22);
    expect(shotStats(0.5).damage).toBeLessThan(43);
    expect(shotStats(1).damage).toBe(80);
    expect(shotStats(1).speed).toBe(TUNING.cannon.speedMax);
    expect(shotStats(1).speed).toBeGreaterThan(shotStats(0.5).speed);
  });

  it('a full charge commits you: reload goes from 0.65 s to 1.7 s', () => {
    expect(reloadTicksFor(0)).toBe(WEAPON_TICKS.reload);
    expect(reloadTicksFor(1)).toBe(Math.ceil(1.7 * 30));
    expect(reloadTicksFor(0.5)).toBeLessThan(reloadTicksFor(1));
  });

  it('only shells charged past half burst', () => {
    expect(splashStats(0.45).radius).toBe(0);
    expect(splashStats(0.6).radius).toBeGreaterThan(0);
    expect(splashStats(1)).toEqual({ radius: TUNING.cannon.splashRadius, damage: TUNING.cannon.splashDamage });
  });

  it('a full charge one-shots a 60 HP garrison tank and splashes its neighbour', () => {
    const w = world([
      { name: 'me', team: 0, pos: { x: 200, y: 400 } },
      { name: 'target', team: 1, pos: { x: 600, y: 400 }, hp: 60 },
      { name: 'neighbour', team: 1, pos: { x: 600, y: 460 }, hp: 60 },
      { name: 'far', team: 1, pos: { x: 600, y: 700 }, hp: 60 },
    ]);
    chargedShot(w, { x: 600, y: 400 }, WEAPON_TICKS.charge);
    expect(w.tank(1).alive).toBe(false);
    expect(w.tank(2).hp).toBeLessThan(60);
    expect(w.tank(2).hp).toBeGreaterThan(30);
    expect(w.tank(3).hp).toBe(60);
    expect(w.tank(0).weapon.reloadTicks).toBe(reloadTicksFor(1));
  });

  it('a tap never splashes', () => {
    const w = world([
      { name: 'me', team: 0, pos: { x: 200, y: 400 } },
      { name: 'target', team: 1, pos: { x: 600, y: 400 } },
      { name: 'neighbour', team: 1, pos: { x: 600, y: 450 } },
    ]);
    chargedShot(w, { x: 600, y: 400 }, 0);
    expect(w.tank(1).hp).toBe(100 - 22);
    expect(w.tank(2).hp).toBe(100);
  });

  it('a charged shell into a wall still hurts an enemy beside it, but not one behind it', () => {
    const rows = Array.from({ length: 30 }, (_, r) => {
      let row = '.'.repeat(40);
      if (r >= 8 && r <= 20) row = row.slice(0, 20) + '#' + row.slice(21); // a wall at column 20
      return row;
    });
    const w = world(
      [
        { name: 'me', team: 0, pos: { x: 300, y: 450 } },
        { name: 'beside', team: 1, pos: { x: 610, y: 520 } }, // same side as the shooter, near the impact
        { name: 'behind', team: 1, pos: { x: 700, y: 450 } }, // other side of the wall
      ],
      mapWith(rows),
    );
    chargedShot(w, { x: 700, y: 450 }, WEAPON_TICKS.charge);
    expect(w.tank(1).hp).toBeLessThan(100);
    expect(w.tank(2).hp).toBe(100);
  });
});

import { missionById } from '../src/content/missions';
import { MissionSession } from '../src/game/mission/session';

describe('garrison reaction to a heavy round', () => {
  it('a surviving garrison tank hit hard calls out major damage', () => {
    const entry = missionById('night-run')!;
    const mission = structuredClone(entry.mission);
    mission.units.find((u) => u.id === 'b_gate')!.hp = 120; // survives a full charge
    const s = new MissionSession({ ...entry, mission, seed: 2 });
    const id = s.unitTank.get('b_gate')!;
    const e = s.world.tank(id);
    const me = s.world.tank(0);
    me.pos = { x: e.pos.x - 260, y: e.pos.y };
    me.prevPos = { ...me.pos };
    const at = (extra: Partial<TankInput>): TankInput => ({ ...neutralInput(e.pos.x, e.pos.y), ...extra });
    for (let i = 0; i < 20; i++) { me.hp = 100; s.tick(at({})); }
    s.tick(at({ fireHeld: true, firePressed: true }));
    for (let i = 0; i < WEAPON_TICKS.charge; i++) { me.hp = 100; s.tick(at({ fireHeld: true })); }
    s.tick(at({ fireReleased: true }));
    for (let i = 0; i < 30; i++) { me.hp = 100; s.tick(at({})); }
    const lines = s.barks.filter((b) => b.unit === id);
    expect(lines.some((b) => b.kind === 'heavyHit')).toBe(true);
  });
});

describe('pausing mid-charge', () => {
  it('a charge held through a pause is cancelled on resume, not fired', () => {
    const s = new MissionSession({ ...missionById('night-run')!, seed: 2 });
    const held = (extra: Partial<TankInput> = {}): TankInput => ({ ...neutralInput(900, 400), fireHeld: true, ...extra });
    s.tick(held({ firePressed: true }));
    for (let i = 0; i < 20; i++) s.tick(held());
    expect(s.world.tank(0).weapon.phase).toBe('charging');
    s.pause();
    s.resume();
    let shots = 0;
    for (let i = 0; i < 5; i++) {
      s.tick(held());
      shots += s.world.events.filter((e) => e.type === 'shot' && e.tank === 0).length;
    }
    expect(shots).toBe(0);
    expect(s.world.tank(0).weapon.phase).not.toBe('charging');
  });
});
