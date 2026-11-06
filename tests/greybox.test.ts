import { describe, it, expect } from 'vitest';
import { MISSIONS, missionById } from '../src/content/missions';
import { MissionSession } from '../src/game/mission/session';
import { validateMission } from '../src/game/mission/validate';
import { loadLevel, validateLevel } from '../src/level/load';
import { NavGrid } from '../src/ai/nav';
import { neutralInput } from '../src/sim/types';
import type { Vec } from '../src/sim/math';

describe('shipped missions', () => {
  for (const { mission, level } of MISSIONS) {
    it(`${mission.id}: level and mission validate`, () => {
      expect(validateLevel(level)).toEqual([]);
      expect(validateMission(mission, loadLevel(level))).toEqual([]);
    });
  }
});

/** Drive the player along a nav path, like a very patient human with WASD. */
function autopilot(s: MissionSession, goal: Vec, seconds: number, invulnerable = false, each?: () => void): void {
  const nav = new NavGrid(s.map);
  let path: Vec[] = [];
  let idx = 0;
  for (let i = 0; i < seconds * 30 && !s.outcome; i++) {
    const me = s.world.tank(0);
    if (invulnerable) me.hp = 100;
    if (i % 30 === 0) {
      path = nav.findPath(me.pos, goal) ?? [];
      idx = 0;
    }
    while (idx < path.length - 1 && Math.hypot(path[idx]!.x - me.pos.x, path[idx]!.y - me.pos.y) < 30) idx++;
    const wp = path[idx] ?? goal;
    const dx = wp.x - me.pos.x, dy = wp.y - me.pos.y, d = Math.hypot(dx, dy) || 1;
    s.tick({ ...neutralInput(wp.x, wp.y), moveX: dx / d, moveY: dy / d });
    each?.();
  }
}

describe('grey box: The Crossing', () => {
  const entry = missionById('greybox-crossing')!;

  it('starts quiet: objectives, intro radio, units at their posts, nobody alerted', () => {
    const s = new MissionSession({ ...entry, seed: 4 });
    for (let i = 0; i < 30 * 5; i++) s.tick();
    expect(s.objectives().map((o) => o.id)).toEqual(['cross', 'stay_hidden']);
    expect(s.radio.some((r) => r.from === 'Commander')).toBe(true);
    expect(s.radio.some((r) => r.from === 'Driver')).toBe(true);
    expect(s.simple.alarmRaised).toBe(false);
    expect(s.unitTank.size).toBe(5);
  });

  it('a loud run through the gate: checkpoint, choice, alarm, reinforcements and boss, then extraction', () => {
    const s = new MissionSession({ ...entry, seed: 4 });
    const depot = s.level.marker('depot');
    let asked = '';
    autopilot(s, depot, 90, true, () => {
      if (s.choice) {
        asked = s.choice.prompt;
        s.choose(1); // "Straight through the gate"
      }
    });
    expect(asked).toBe('How do we cross?');
    expect(s.lastCheckpoint?.marker).toBe('cp_past');
    expect(s.runner.state.flags.route).toBe('gate');
    expect(s.runner.state.flags.crew_tension).toBe(1);
    expect(s.simple.alarmRaised).toBe(true);
    expect(s.unitTank.has('qrf')).toBe(true);
    expect(s.unitTank.has('depot_commander')).toBe(true);
    expect(s.boss).not.toBeNull();
    expect(s.outcome?.result).toBe('success');
    expect(s.outcome?.text).toMatch(/looking for us/);
    expect(s.runner.state.objectives.stay_hidden).toBe('failed');
  });

  it('reaching the depot unseen ends with the clean outcome', () => {
    const s = new MissionSession({ ...entry, seed: 4 });
    const me = s.world.tank(0);
    const depot = s.level.marker('depot');
    me.pos = { x: depot.x, y: depot.y };
    me.prevPos = { ...me.pos };
    s.tick();
    expect(s.outcome?.text).toMatch(/Clean crossing/);
    expect(s.runner.state.objectives.stay_hidden).toBe('complete');
  });

  it('a mission tick stays cheap', () => {
    const s = new MissionSession({ ...entry, seed: 4 });
    const t0 = performance.now();
    for (let i = 0; i < 30 * 20; i++) s.tick();
    const per = (performance.now() - t0) / (30 * 20);
    expect(per).toBeLessThan(2);
  });
});
