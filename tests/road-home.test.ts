import { describe, it, expect } from 'vitest';
import { missionById } from '../src/content/missions';
import { MissionSession } from '../src/game/mission/session';
import { NavGrid } from '../src/ai/nav';
import { neutralInput } from '../src/sim/types';
import type { Vec } from '../src/sim/math';

/** Drive along a nav path (invulnerable), stopping at the goal. */
function drive(s: MissionSession, goal: Vec, seconds: number, each?: () => void): void {
  const nav = new NavGrid(s.map);
  let path: Vec[] = [];
  let idx = 0;
  for (let i = 0; i < seconds * 30 && !s.outcome; i++) {
    const me = s.world.tank(0);
    me.hp = 1000; // invulnerable: several hits can land in one tick
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

function teleport(s: MissionSession, marker: string): void {
  const me = s.world.tank(0);
  const m = s.level.marker(marker);
  me.pos = { x: m.x, y: m.y };
  me.prevPos = { ...me.pos };
}

const kill = (s: MissionSession, unit: string): void => {
  s.world.applyDamageForTest(s.unitTank.get(unit)!, 500, 0);
  s.tick();
};

const CHECKPOINTS = ['cp_village', 'cp_turn', 'cp_strip', 'cp_bend', 'cp_gate'];
const YARD = ['g_walk', 'g_post_n', 'g_post_s'];

describe('demo: The Road Home', () => {
  const entry = missionById('road-home')!;

  it('the route passes every checkpoint in order; the gate only opens once the garrison is broken', () => {
    const s = new MissionSession({ ...entry, seed: 7 });
    const seen: string[] = [];
    let route = 0;
    let last = s.world.tank(0).pos;
    const each = () => {
      const p = s.world.tank(0).pos;
      route += Math.hypot(p.x - last.x, p.y - last.y);
      last = { ...p };
      const m = s.lastCheckpoint?.marker;
      if (m && m !== 'start' && seen[seen.length - 1] !== m) seen.push(m);
    };
    for (const cp of CHECKPOINTS) drive(s, s.level.marker(cp), 180, each);
    expect(seen).toEqual(CHECKPOINTS);
    expect(s.runner.state.objectives.o_garrison).toBe('active');
    expect(route).toBeGreaterThan(9000);

    // Driving through with the garrison alive ends nothing.
    drive(s, s.level.marker('home'), 60, each);
    for (let i = 0; i < 30; i++) s.tick();
    expect(s.outcome).toBeNull();
    expect(s.radio.some((r) => /guns at our back/.test(r.text))).toBe(true);

    // The fight comes in three waves, each one called by the last.
    teleport(s, 'cp_gate');
    kill(s, 'g_walk');
    expect(s.unitTank.has('res_n')).toBe(false);
    kill(s, 'g_post_n');
    expect(s.unitTank.has('res_n') && s.unitTank.has('res_s')).toBe(true);
    kill(s, 'g_post_s');
    expect(s.unitTank.has('hauptmann')).toBe(false);
    kill(s, 'res_n');
    kill(s, 'res_s');
    expect(s.world.tank(s.unitTank.get('hauptmann')!).maxHp).toBe(120);
    expect(s.runner.state.objectives.o_garrison).toBe('active');
    kill(s, 'hauptmann');
    expect(s.runner.state.objectives.o_garrison).toBe('complete');
    expect(s.runner.state.objectives.o_home).toBe('active');

    teleport(s, 'home');
    s.tick();
    expect(s.outcome?.result).toBe('success');
    expect(s.runner.state.objectives.stay_hidden).toBe('failed');
    expect(s.outcome?.text).toMatch(/didn't look back/);
  });

  it('starts solemn: nobody near the lane, eleven units calm, crew talking', () => {
    const s = new MissionSession({ ...entry, seed: 3 });
    for (let i = 0; i < 30 * 10; i++) s.tick();
    expect(s.simple.alarmRaised).toBe(false);
    expect(s.unitTank.size).toBe(11);
    expect(s.radio.map((r) => r.from)).toEqual(['Commander', 'Driver']);
    // The whole first stretch is out of every guard's sight, even driven flat out.
    drive(s, s.level.marker('cp_village'), 60);
    expect(s.simple.maxSuspicion()).toBe(0);
  });

  it('no checkpoint is in sight of a guard', () => {
    for (const cp of CHECKPOINTS) {
      const t = new MissionSession({ ...entry, seed: 3 });
      teleport(t, cp);
      for (let i = 0; i < 30 * 12; i++) t.tick();
      expect(t.simple.alarmRaised, cp).toBe(false);
      expect(t.simple.maxSuspicion(), cp).toBeLessThan(0.25);
    }
  });

  it('enemy numbers rise stretch by stretch, and an alarm stays inside its stretch', () => {
    const s = new MissionSession({ ...entry, seed: 3 });
    const band = (u: string) => entry.mission.units.filter((x) => x.id.startsWith(u)).length;
    expect([band('v_'), band('ch_'), band('st_'), band('ow_'), band('g_')]).toEqual([1, 2, 2, 3, 3]);
    s.tick(); // units learn their positions on the first update
    const post = s.level.marker('ch_post');
    s.simple.raiseAlarm({ x: post.x, y: post.y }, s.world.tick, -1, entry.mission.alarmRadius);
    for (let i = 0; i < 30 * 3; i++) s.tick();
    const state = (u: string) => s.simple.state(s.unitTank.get(u)!);
    expect(state('ch_walk')).not.toBe('calm');
    for (const u of ['v_sentry', 'st_lead', 'st_tail', 'ow_gate', 'ow_walk', ...YARD]) expect(state(u), u).toBe('calm');
  });

  it('reaching the gate unseen is remembered in the ending, whatever the fight does', () => {
    const s = new MissionSession({ ...entry, seed: 5 });
    teleport(s, 'cp_gate');
    s.tick();
    s.tick();
    expect(s.runner.state.objectives.stay_hidden).toBe('complete');
    expect(s.world.tank(0).hp).toBe(100);
    for (const u of [...YARD, 'res_n', 'res_s', 'hauptmann']) kill(s, u);
    s.simple.alarmRaised = true;
    s.tick();
    expect(s.runner.state.objectives.stay_hidden).toBe('complete');
    teleport(s, 'home');
    s.tick();
    expect(s.outcome?.text).toMatch(/nobody in the village heard us/);
  });

  it('a retry in the middle of the fight keeps the kills and brings the reserve back', () => {
    const s = new MissionSession({ ...entry, seed: 5 });
    teleport(s, 'cp_gate');
    s.tick();
    kill(s, 'g_walk');
    kill(s, 'g_post_n');
    s.tick();
    const cp = s.lastCheckpoint!;
    expect(cp.destroyed.sort()).toEqual(['g_post_n', 'g_walk']);
    const again = new MissionSession({ ...entry, seed: 6 });
    again.loadCheckpoint(cp);
    again.tick();
    expect(again.unitTank.has('res_n') && again.unitTank.has('res_s')).toBe(true);
    expect(again.unitTank.has('g_walk')).toBe(false);
  });
});
