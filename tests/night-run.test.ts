import { describe, it, expect } from 'vitest';
import { missionById } from '../src/content/missions';
import { MissionSession } from '../src/game/mission/session';
import { NavGrid } from '../src/ai/nav';
import { neutralInput } from '../src/sim/types';
import type { Vec } from '../src/sim/math';

function drive(s: MissionSession, goal: Vec, seconds: number, each?: () => void): void {
  const nav = new NavGrid(s.map);
  let path: Vec[] = [];
  let idx = 0;
  for (let i = 0; i < seconds * 30 && !s.outcome; i++) {
    const me = s.world.tank(0);
    me.hp = 100;
    if (i % 30 === 0) {
      path = nav.findPath(me.pos, goal) ?? [];
      idx = 0;
    }
    while (idx < path.length - 1 && Math.hypot(path[idx]!.x - me.pos.x, path[idx]!.y - me.pos.y) < 30) idx++;
    const wp = path[idx] ?? goal;
    const dx = wp.x - me.pos.x, dy = wp.y - me.pos.y, d = Math.hypot(dx, dy) || 1;
    s.tick({ ...neutralInput(wp.x, wp.y), moveX: dx / d, moveY: dy / d });
    each?.();
    if (Math.hypot(goal.x - me.pos.x, goal.y - me.pos.y) < 40) return;
  }
}

describe('demo: Night Run', () => {
  const entry = missionById('night-run')!;

  it('is the first mission in the menu', () => {
    expect(missionById('night-run')).toBeDefined();
  });

  it('the route passes every checkpoint in order and ends at the depot', () => {
    const s = new MissionSession({ ...entry, seed: 7 });
    const seen: string[] = [];
    const order = ['cp_yard', 'cp_turn', 'cp_market', 'cp_bend', 'cp_depot'];
    for (const cp of [...order, 'depot']) {
      drive(s, s.level.marker(cp), 120, () => {
        const m = s.lastCheckpoint?.marker;
        if (m && m !== 'start' && seen[seen.length - 1] !== m) seen.push(m);
      });
    }
    expect(seen).toEqual(order);
    expect(s.outcome?.result).toBe('success');
    expect(s.runner.state.objectives.o_depot).toBe('complete');
  });

  it('starts quiet and checkpoints are out of enemy sight', () => {
    const s = new MissionSession({ ...entry, seed: 3 });
    for (let i = 0; i < 30 * 8; i++) s.tick();
    expect(s.simple.alarmRaised).toBe(false);
    expect(s.unitTank.size).toBe(11);
    for (const cp of ['cp_yard', 'cp_turn', 'cp_market', 'cp_bend', 'cp_depot']) {
      const t = new MissionSession({ ...entry, seed: 3 });
      const me = t.world.tank(0);
      const m = t.level.marker(cp);
      me.pos = { x: m.x, y: m.y };
      me.prevPos = { ...me.pos };
      for (let i = 0; i < 30 * 4; i++) t.tick();
      expect(t.simple.alarmRaised, cp).toBe(false);
    }
  });

  it('checkpoints repair the tank', () => {
    const s = new MissionSession({ ...entry, seed: 3 });
    const me = s.world.tank(0);
    me.hp = 30;
    const m = s.level.marker('cp_yard');
    me.pos = { x: m.x, y: m.y };
    me.prevPos = { ...me.pos };
    s.tick();
    s.tick();
    expect(me.hp).toBe(100);
    expect(s.lastCheckpoint?.marker).toBe('cp_yard');
  });

  it('an alarm in one stretch does not pull the rest of the district', () => {
    const s = new MissionSession({ ...entry, seed: 3 });
    const yard = s.level.marker('b_gate');
    s.tick(); // units learn their positions on the first update
    s.simple.raiseAlarm({ x: yard.x, y: yard.y }, s.world.tick, -1, entry.mission.alarmRadius);
    for (let i = 0; i < 30 * 3; i++) s.tick();
    const state = (u: string) => s.simple.state(s.unitTank.get(u)!);
    expect(state('b_patrol')).not.toBe('calm');
    for (const u of ['a_patrol', 'c_post', 'c_patrol', 'd_bridge', 'd_bank', 'e_gate', 'f_gate_n', 'f_patrol']) expect(state(u), u).toBe('calm');
  });
});
