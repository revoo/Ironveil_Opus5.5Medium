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

const CHECKPOINTS = ['cp_oldtown', 'cp_boulevard', 'cp_factory', 'cp_river', 'cp_park', 'cp_railyard', 'cp_border', 'cp_approach'];

describe('The Long Night', () => {
  const entry = missionById('long-night')!;

  it('the route passes all eight checkpoints in order and ends at the extraction', () => {
    const s = new MissionSession({ ...entry, seed: 11 });
    const seen: string[] = [];
    let route = 0;
    let last = s.world.tank(0).pos;
    for (const cp of [...CHECKPOINTS, 'extract']) {
      drive(s, s.level.marker(cp), 240, () => {
        const p = s.world.tank(0).pos;
        route += Math.hypot(p.x - last.x, p.y - last.y);
        last = { ...p };
        const m = s.lastCheckpoint?.marker;
        if (m && m !== 'start' && seen[seen.length - 1] !== m) seen.push(m);
        if (s.choice) s.choose(2);
      });
    }
    expect(seen).toEqual(CHECKPOINTS);
    expect(s.outcome?.result).toBe('success');
    // About 1.8x the Night Run route: ~100 s at full speed, ~4 min silent, before any waiting or fighting.
    expect(route).toBeGreaterThan(18000);
  });

  it('starts quiet with 23 units, and no checkpoint is in sight of a guard', () => {
    const s = new MissionSession({ ...entry, seed: 3 });
    for (let i = 0; i < 30 * 8; i++) s.tick();
    expect(s.simple.alarmRaised).toBe(false);
    expect(s.unitTank.size).toBe(23);
    for (const cp of CHECKPOINTS) {
      const t = new MissionSession({ ...entry, seed: 3 });
      teleport(t, cp);
      for (let i = 0; i < 30 * 5; i++) t.tick();
      expect(t.simple.alarmRaised, cp).toBe(false);
      expect(t.simple.maxSuspicion(), cp).toBeLessThan(0.25);
    }
  });

  it('an alarm stays inside its stretch', () => {
    for (const [at, near, far] of [
      ['ot_plaza', 'ot_lane', ['allot_watch', 'convoy_lead', 'riv_north']],
      ['fac_gate', 'fac_yard', ['convoy_tail', 'riv_north', 'bc_gate_n']],
      ['ry_tower', 'ry_east', ['riv_south', 'fo_keep', 'bc_gate_n']],
      ['fo_gate_n', 'fo_culvert', ['bc_ruins', 'ry_east']],
    ] as const) {
      const s = new MissionSession({ ...entry, seed: 3 });
      s.tick();
      const m = s.level.marker(at);
      s.simple.raiseAlarm({ x: m.x, y: m.y }, s.world.tick, -1, entry.mission.alarmRadius);
      const st = (u: string) => s.simple.state(s.unitTank.get(u)!);
      expect(st(near), `${at} → ${near}`).not.toBe('calm');
      for (const u of far) expect(st(u), `${at} → ${u}`).toBe('calm');
    }
  });

  it('the flare choice moves the chosen guards, and survives a retry from the approach checkpoint', () => {
    const s = new MissionSession({ ...entry, seed: 5 });
    teleport(s, 'cp_approach');
    s.tick();
    expect(s.lastCheckpoint?.marker).toBe('cp_approach');
    const cp = s.lastCheckpoint!;
    drive(s, { x: 111 * 32 + 16, y: 104 * 32 + 16 }, 30);
    expect(s.choice?.prompt).toBe('Where does the flare go?');
    s.choose(0);
    const gate = s.world.tank(s.unitTank.get('fo_gate_n')!);
    const start = { ...gate.pos };
    for (let i = 0; i < 30 * 12; i++) s.tick();
    expect(Math.hypot(gate.pos.x - start.x, gate.pos.y - start.y)).toBeGreaterThan(200);
    // Retrying from the approach checkpoint offers the choice again.
    const r = new MissionSession({ ...entry, seed: 5 });
    r.loadCheckpoint(cp);
    drive(r, { x: 111 * 32 + 16, y: 104 * 32 + 16 }, 30);
    expect(r.choice?.prompt).toBe('Where does the flare go?');
  });

  it('the fortress is reinforced if they are alerted and the signal truck survives, not otherwise', () => {
    const loud = new MissionSession({ ...entry, seed: 5 });
    loud.simple.alarmRaised = true;
    teleport(loud, 'fo_inner');
    loud.tick();
    expect(loud.unitTank.has('fo_qrf')).toBe(true);

    const quietTruck = new MissionSession({ ...entry, seed: 5 });
    quietTruck.world.applyDamageForTest(quietTruck.unitTank.get("signal_truck")!, 500, 0);
    quietTruck.tick();
    expect(quietTruck.runner.state.objectives.opt_truck).toBe('complete');
    quietTruck.simple.alarmRaised = true;
    teleport(quietTruck, 'fo_inner');
    quietTruck.tick();
    expect(quietTruck.unitTank.has('fo_qrf')).toBe(false);
  });
});
