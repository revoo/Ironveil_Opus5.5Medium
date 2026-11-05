import { describe, it, expect } from 'vitest';
import { World } from '../src/sim/world';
import { neutralInput } from '../src/sim/types';
import { openMap } from './helpers';
import { TUNING } from '../src/sim/tuning';
import { lineOfSightClear } from '../src/sim/map';

type Spec = { name: string; team: 0 | 1; pos?: { x: number; y: number } };

function mk(specs: Spec[], opts: Partial<{ countdown: number; killTarget: number; timeLimit: number }> = {}) {
  const map = openMap(60, 40);
  map.spawns = [
    [
      { x: 100, y: 100 },
      { x: 100, y: 1100 },
    ],
    [
      { x: 1800, y: 100 },
      { x: 1800, y: 1100 },
    ],
  ];
  return new World({ map, seed: 9, tanks: specs.map((s) => ({ ...s, isBot: false })), ...opts });
}

function killTank(w: World, victim: number, killer: number) {
  w.applyDamageForTest(victim, 1000, killer);
}

describe('team deathmatch rules', () => {
  it('countdown freezes movement and firing, then goes live', () => {
    const w = mk([{ name: 'a', team: 0 }], { countdown: 1 });
    expect(w.match.phase).toBe('countdown');
    const p0 = { ...w.tank(0).pos };
    w.step({ 0: { ...neutralInput(500, 100), moveX: 1, firePressed: true, fireReleased: true } });
    expect(w.tank(0).pos).toEqual(p0);
    expect(w.projectiles.length).toBe(0);
    for (let i = 0; i < 30; i++) w.step({});
    expect(w.match.phase).toBe('live');
  });

  it('first team to the kill target wins', () => {
    const w = mk([{ name: 'a', team: 0 }, { name: 'b', team: 1 }], { countdown: 0, killTarget: 2 });
    killTank(w, 1, 0);
    w.step({});
    expect(w.match.phase).toBe('live');
    for (let i = 0; i < (TUNING.match.respawn + TUNING.match.spawnProtection) * 30 + 2; i++) w.step({});
    killTank(w, 1, 0);
    w.step({});
    expect(w.match.phase).toBe('ended');
    expect(w.match.winner).toBe(0);
  });

  it('time limit: highest score wins', () => {
    const w = mk([{ name: 'a', team: 0 }, { name: 'b', team: 1 }], { countdown: 0, timeLimit: 2 });
    killTank(w, 0, 1);
    for (let i = 0; i < 61; i++) w.step({});
    expect(w.match.phase).toBe('ended');
    expect(w.match.winner).toBe(1);
  });

  it('a tie enters sudden death; the next kill wins', () => {
    const w = mk([{ name: 'a', team: 0 }, { name: 'b', team: 1 }], { countdown: 0, timeLimit: 1 });
    for (let i = 0; i < 31; i++) w.step({});
    expect(w.match.phase).toBe('suddenDeath');
    killTank(w, 1, 0);
    w.step({});
    expect(w.match.phase).toBe('ended');
    expect(w.match.winner).toBe(0);
  });

  it('sudden death without a kill is a draw', () => {
    const w = mk([{ name: 'a', team: 0 }, { name: 'b', team: 1 }], { countdown: 0, timeLimit: 1 });
    for (let i = 0; i < 31 + TUNING.match.suddenDeath * 30 + 1; i++) w.step({});
    expect(w.match.phase).toBe('ended');
    expect(w.match.winner).toBe('draw');
  });

  it('respawns at a spawn without enemy line of sight when possible, with protection', () => {
    const w = mk([{ name: 'a', team: 0 }, { name: 'b', team: 1, pos: { x: 300, y: 150 } }], { countdown: 0 });
    // enemy stands near the first team-0 spawn
    killTank(w, 0, 1);
    for (let i = 0; i < TUNING.match.respawn * 30 + 2; i++) w.step({});
    const a = w.tank(0);
    expect(a.alive).toBe(true);
    expect(a.pos).toEqual({ x: 100, y: 1100 });
    expect(a.protectedUntil).toBeGreaterThan(w.tick);
    expect(lineOfSightClear(w.map, a.pos, w.tank(1).pos)).toBe(true); // open map: picks farthest
  });

  it('pausing is achieved by not stepping: timers are tick-based', () => {
    const w = mk([{ name: 'a', team: 0 }], { countdown: 0 });
    const t = w.tick;
    w.step({});
    expect(w.tick).toBe(t + 1);
  });
});
