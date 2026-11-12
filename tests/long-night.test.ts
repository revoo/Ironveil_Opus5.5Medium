import { describe, it, expect } from 'vitest';
import { missionById } from '../src/content/missions';
import { MissionSession } from '../src/game/mission/session';
import { NavGrid } from '../src/ai/nav';
import { neutralInput } from '../src/sim/types';
import type { Vec } from '../src/sim/math';
import { dialogueSeconds } from '../src/client/three/comms';
import { validateMission } from '../src/game/mission/validate';
import { TUNING } from '../src/sim/tuning';
import type { Action } from '../src/game/mission/types';

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

const CHECKPOINTS = ['cp_garage', 'cp_oldtown', 'cp_boulevard', 'cp_factory', 'cp_river', 'cp_park', 'cp_railyard', 'cp_border', 'cp_approach'];

describe('The Long Night', () => {
  const entry = missionById('long-night')!;

  it('the route passes all nine checkpoints in order and ends at the extraction', () => {
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

  it('starts quiet with 22 units, and no checkpoint is in sight of a guard', () => {
    const s = new MissionSession({ ...entry, seed: 3 });
    for (let i = 0; i < 30 * 8; i++) s.tick();
    expect(s.simple.alarmRaised).toBe(false);
    expect(s.unitTank.size).toBe(22);
    for (const cp of CHECKPOINTS) {
      const t = new MissionSession({ ...entry, seed: 3 });
      teleport(t, cp);
      for (let i = 0; i < 30 * 5; i++) t.tick();
      expect(t.simple.alarmRaised, cp).toBe(false);
      expect(t.simple.maxSuspicion(), cp).toBeLessThan(0.25);
    }
  });

  it('the opening stretch outlasts the intro dialogue, and the first enemy only arrives after it', () => {
    const s = new MissionSession({ ...entry, seed: 11 });
    const intro = entry.mission.triggers.find((t) => t.id === 'intro')!;
    const lines = intro.do.filter((a): a is Extract<Action, { radio: string }> => 'radio' in a).map((a) => ({ from: a.from, text: a.radio }));
    expect(lines.length).toBeGreaterThanOrEqual(3); // world building, not a one-liner
    const talk = 1 + dialogueSeconds(lines); // the intro fires at 1 s
    // Flat out along the Wall road: nobody is on the map's first stretch, and nobody notices us.
    const zone = s.level.zone('wall_end');
    const inZone = (p: Vec) => p.x >= zone.x && p.x <= zone.x + zone.w && p.y >= zone.y && p.y <= zone.y + zone.h;
    let reached = -1;
    let contact = -1;
    drive(s, s.level.marker('cp_garage'), 60, () => {
      const p = s.world.tank(0).pos;
      if (reached < 0 && inZone(p)) reached = s.world.tick / 30;
      if (contact < 0 && s.unitTank.has('allot_watch')) {
        contact = s.world.tick / 30;
        const e = s.world.tank(s.unitTank.get('allot_watch')!).pos;
        // it drives in from the far end of the allotments: well off screen when it appears
        expect(Math.hypot(e.x - p.x, e.y - p.y)).toBeGreaterThan(TUNING.vision.radius * 2);
      }
      if (contact < 0) expect(s.simple.maxSuspicion()).toBe(0);
    });
    expect(reached).toBeGreaterThan(talk);
    expect(contact).toBeGreaterThanOrEqual(reached);
    expect(s.crewBarks.map((b) => b.from)).toContain('Gunner');
    expect(s.lastCheckpoint?.marker).toBe('cp_garage');
    expect(s.simple.alarmRaised).toBe(false);
  });

  it('after the intro the crew only talks in barks, and barks are short', () => {
    for (const id of ['long-night', 'night-run']) {
      const m = missionById(id)!;
      const walk = (as: Action[], fn: (a: Action) => void): void => as.forEach((a) => { fn(a); if ('choice' in a) a.choice.options.forEach((o) => walk(o.do, fn)); });
      let barks = 0;
      for (const t of m.mission.triggers) walk(t.do, (a) => {
        if ('radio' in a) expect(t.id, `${id}: "${a.radio}"`).toBe('intro');
        if ('bark' in a) barks++;
      });
      expect(barks).toBeGreaterThan(8);
    }
    const s = new MissionSession({ ...entry, seed: 1 });
    const long = structuredClone(entry.mission);
    long.triggers[0]!.do.push({ bark: 'x'.repeat(65), from: 'Driver' });
    expect(validateMission(long, s.level).join('\n')).toMatch(/bark .* is 65 characters/);
  });

  it('an alarm stays inside its stretch', () => {
    for (const [at, near, far] of [
      ['ot_plaza', 'ot_lane', ['fac_gate', 'convoy_lead', 'riv_north']],
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
    drive(s, { x: 111 * 32 + 16, y: 117 * 32 + 16 }, 30);
    expect(s.choice?.prompt).toBe('Where does the flare go?');
    s.choose(0);
    const gate = s.world.tank(s.unitTank.get('fo_gate_n')!);
    const start = { ...gate.pos };
    for (let i = 0; i < 30 * 12; i++) s.tick();
    expect(Math.hypot(gate.pos.x - start.x, gate.pos.y - start.y)).toBeGreaterThan(200);
    // Retrying from the approach checkpoint offers the choice again.
    const r = new MissionSession({ ...entry, seed: 5 });
    r.loadCheckpoint(cp);
    drive(r, { x: 111 * 32 + 16, y: 117 * 32 + 16 }, 30);
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
