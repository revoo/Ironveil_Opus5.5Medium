import { describe, it, expect } from 'vitest';
import { MissionRunner, type MissionQuery } from '../src/game/mission/runner';
import { MissionSession } from '../src/game/mission/session';
import { validateMission } from '../src/game/mission/validate';
import type { Action, MissionDef } from '../src/game/mission/types';
import { LEVEL_FORMAT, LEVEL_FORMAT_VERSION, type LevelData } from '../src/level/format';
import { loadLevel } from '../src/level/load';
import { neutralInput } from '../src/sim/types';

// ---------------------------------------------------------------- runner (no world)
function fakeQuery(over: Partial<MissionQuery> = {}): MissionQuery {
  return { tick: 0, pos: () => ({ x: 0, y: 0 }), destroyed: () => false, enemyPositions: () => [], inZone: () => false, alarm: false, ...over };
}
const mission = (triggers: MissionDef['triggers'], objectives: MissionDef['objectives'] = []): MissionDef => ({ id: 'm', title: 'M', level: 'l', units: [], objectives, triggers });

describe('mission runner', () => {
  it('fires a once-trigger a single time and applies flags and objectives itself', () => {
    const r = new MissionRunner(mission([{ id: 't', when: { alarm: true }, do: [{ setFlag: 'seen' }, { addFlag: 'count', by: 2 }, { objective: 'o', state: 'failed' }] }], [{ id: 'o', text: 'Stay hidden' }]));
    const ran: Action[] = [];
    const fx = { run: (a: Action) => ran.push(a) };
    r.update(fakeQuery(), fx);
    expect(ran).toHaveLength(0);
    r.update(fakeQuery({ alarm: true }), fx);
    r.update(fakeQuery({ alarm: true, tick: 5 }), fx);
    expect(ran).toHaveLength(3);
    expect(r.state.flags).toEqual({ seen: true, count: 2 });
    expect(r.state.objectives.o).toBe('failed');
    expect(r.state.fired.t).toBe(0);
  });

  it('timers count from mission start or from another trigger', () => {
    const r = new MissionRunner(mission([
      { id: 'a', when: { flag: 'go' }, do: [] },
      { id: 'b', when: { after: 2, since: 'a' }, do: [{ setFlag: 'b' }] },
      { id: 'c', when: { after: 1 }, do: [{ setFlag: 'c' }] },
    ]));
    const fx = { run: () => {} };
    r.update(fakeQuery({ tick: 29 }), fx);
    expect(r.state.flags.c).toBeUndefined();
    r.update(fakeQuery({ tick: 30 }), fx);
    expect(r.state.flags.c).toBe(true);
    r.state.flags.go = true;
    r.update(fakeQuery({ tick: 100 }), fx);
    r.update(fakeQuery({ tick: 159 }), fx);
    expect(r.state.flags.b).toBeUndefined();
    r.update(fakeQuery({ tick: 160 }), fx);
    expect(r.state.flags.b).toBe(true);
  });

  it('combinators and flag values', () => {
    const r = new MissionRunner(mission([]));
    r.state.flags = { mood: 'grim', n: 3 };
    const q = fakeQuery({ alarm: true });
    expect(r.test({ all: [{ alarm: true }, { flag: 'mood', is: 'grim' }] }, q)).toBe(true);
    expect(r.test({ any: [{ flag: 'n', is: 4 }, { not: { alarm: true } }] }, q)).toBe(false);
    expect(r.test({ flag: 'missing' }, q)).toBe(false);
  });

  it('repeating triggers fire on each rising edge only', () => {
    const r = new MissionRunner(mission([{ id: 'rep', once: false, when: { alarm: true }, do: [{ addFlag: 'n' }] }]));
    const fx = { run: () => {} };
    for (const a of [true, true, false, true, true]) r.update(fakeQuery({ alarm: a }), fx);
    expect(r.state.flags.n).toBe(2);
  });
});

// ---------------------------------------------------------------- session on a small level
const LEVEL: LevelData = {
  format: LEVEL_FORMAT,
  formatVersion: LEVEL_FORMAT_VERSION,
  id: 'test-yard',
  version: 1,
  name: 'Test Yard',
  tile: 32,
  terrain: (() => {
    const rows: string[] = [];
    for (let r = 0; r < 24; r++) {
      let s = '';
      for (let c = 0; c < 60; c++) s += r === 0 || r === 23 || c === 0 || c === 59 || (c === 30 && r > 2 && r < 21) ? '#' : '.';
      rows.push(s);
    }
    return rows;
  })(),
  markers: [
    { id: 'start', x: 100, y: 380, facing: 0, tags: ['player-start'] },
    { id: 'mid', x: 600, y: 380, tags: ['checkpoint'] },
    { id: 'guard_post', x: 1700, y: 380, facing: 180 },
    { id: 'reinforce', x: 1800, y: 600 },
  ],
  zones: [
    { id: 'halfway', x: 560, y: 300, w: 120, h: 160 },
    { id: 'far', x: 1500, y: 60, w: 300, h: 120 },
  ],
  paths: [
    {
      id: 'loop',
      points: [
        { x: 1500, y: 600 },
        { x: 1800, y: 600 },
      ],
      loop: true,
    },
  ],
  props: [],
};

const MISSION: MissionDef = {
  id: 'test',
  title: 'Test',
  level: 'test-yard',
  units: [{ id: 'guard', name: 'Guard', marker: 'guard_post', ai: 'simple' }],
  objectives: [
    { id: 'reach', text: 'Reach the halfway point' },
    { id: 'secret', text: 'Hidden one', state: 'hidden' },
  ],
  triggers: [
    { id: 'hello', when: { after: 0.5 }, do: [{ radio: 'Moving out.', from: 'Commander' }, { radio: 'Delayed line.', from: 'Driver', delay: 1 }] },
    {
      id: 'halfway',
      when: { enter: 'halfway' },
      do: [
        { objective: 'reach', state: 'complete' },
        { checkpoint: 'mid' },
        { spawn: { id: 'late', name: 'Late', marker: 'reinforce', ai: 'simple', posture: { patrol: 'loop' } } },
        { choice: { from: 'Commander', prompt: 'Left or right?', options: [{ text: 'Left', do: [{ setFlag: 'side', value: 'left' }] }, { text: 'Right', do: [{ setFlag: 'side', value: 'right' }] }], timeout: 2, default: 1 } },
      ],
    },
    { id: 'win', when: { flag: 'side' }, do: [{ objective: 'secret', state: 'active' }] },
  ],
};

function driveTo(s: MissionSession, x: number, y: number, seconds = 8): void {
  for (let i = 0; i < seconds * 30; i++) {
    const p = s.world.tank(0).pos;
    const dx = x - p.x, dy = y - p.y, d = Math.hypot(dx, dy);
    if (d < 20) return;
    s.tick({ ...neutralInput(x, y), moveX: dx / d, moveY: dy / d });
  }
}
const idle = (s: MissionSession, seconds: number) => {
  for (let i = 0; i < seconds * 30; i++) s.tick(neutralInput());
};

describe('mission validation', () => {
  it('accepts the test mission and reports broken references', () => {
    const level = loadLevel(LEVEL);
    expect(validateMission(MISSION, level)).toEqual([]);
    const bad: MissionDef = {
      ...MISSION,
      units: [{ id: 'guard', name: 'G', marker: 'nowhere', ai: 'simple', posture: { patrol: 'nope' } }],
      triggers: [{ id: 'x', when: { enter: 'zzz', who: 'ghost' }, do: [{ objective: 'missing', state: 'active' }, { checkpoint: 'nowhere' }] }],
    };
    const p = validateMission(bad, level);
    expect(p).toContain('units: unit "guard" spawn marker "nowhere" does not exist');
    expect(p).toContain('units unit "guard": path "nope" does not exist');
    expect(p).toContain('trigger "x": zone "zzz" does not exist');
    expect(p).toContain('trigger "x": unit "ghost" does not exist');
    expect(p).toContain('trigger "x": objective "missing" does not exist');
    expect(p).toContain('trigger "x": checkpoint marker "nowhere" does not exist');
  });
});

describe('mission session', () => {
  it('runs radio (with delays), zone triggers, spawns, objectives and real-time choices', () => {
    const s = new MissionSession({ mission: MISSION, level: LEVEL });
    expect(s.objectives().map((o) => o.id)).toEqual(['reach']);
    idle(s, 0.6);
    expect(s.radio.map((r) => r.text)).toContain('Moving out.');
    expect(s.radio.map((r) => r.text)).not.toContain('Delayed line.');
    idle(s, 1.1);
    expect(s.radio.map((r) => r.text)).toContain('Delayed line.');

    driveTo(s, 620, 380);
    expect(s.objectives().find((o) => o.id === 'reach')?.state).toBe('complete');
    expect(s.unitTank.has('late')).toBe(true);
    expect(s.choice?.prompt).toBe('Left or right?');
    // nobody answers: the default (Right) is taken when it times out, and the game kept running
    idle(s, 2.2);
    expect(s.choice).toBeNull();
    expect(s.runner.state.flags.side).toBe('right');
    expect(s.objectives().map((o) => o.id)).toContain('secret');
    expect(s.lastCheckpoint?.marker).toBe('mid');
  });

  it('choosing an option runs its actions', () => {
    const s = new MissionSession({ mission: MISSION, level: LEVEL });
    driveTo(s, 620, 380);
    s.choose(0);
    expect(s.runner.state.flags.side).toBe('left');
  });

  it('losing the tank fails the mission; retry restores the checkpoint state', () => {
    const s = new MissionSession({ mission: MISSION, level: LEVEL });
    driveTo(s, 620, 380);
    s.choose(0);
    // destroy the late reinforcement, then the player
    s.world.applyDamageForTest(s.unitTank.get('late')!, 1000, 0);
    s.world.applyDamageForTest(0, 1000, s.unitTank.get('guard')!);
    s.tick();
    expect(s.outcome).toEqual({ result: 'failure', reason: 'destroyed', text: 'Your tank was destroyed.' });
    expect(s.world.match.phase).toBe('ended');

    s.restart();
    expect(s.outcome).toBeNull();
    const p = s.world.tank(0).pos;
    expect(Math.hypot(p.x - 600, p.y - 380)).toBeLessThan(1);
    // Flags from before the checkpoint survive; the halfway trigger does not fire again.
    expect(s.runner.state.objectives.reach).toBe('complete');
    expect(s.runner.state.fired.halfway).toBeDefined();
    // The reinforcement spawned before the checkpoint comes back (it died after the checkpoint).
    expect(s.unitTank.has('late')).toBe(true);
    // The choice was still open when the checkpoint was taken, so it is asked again.
    expect(s.runner.state.flags.side).toBeUndefined();
    expect(s.choice?.prompt).toBe('Left or right?');
  });

  it('an end action finishes the mission', () => {
    const s = new MissionSession({ mission: { ...MISSION, triggers: [{ id: 'done', when: { after: 0.1 }, do: [{ end: 'success', text: 'Well done.' }] }] }, level: LEVEL });
    idle(s, 0.2);
    expect(s.outcome).toEqual({ result: 'success', reason: 'scripted', text: 'Well done.' });
    expect(s.world.match.winner).toBe(0);
  });

  it('the guard spots a player who drives up to it and the alarm condition becomes true', () => {
    const s = new MissionSession({
      mission: { ...MISSION, triggers: [{ id: 'spotted', when: { alarm: true }, do: [{ setFlag: 'spotted' }] }] },
      level: { ...LEVEL, terrain: LEVEL.terrain.map((r) => r.replace(/#/g, (m, i) => (i === 30 ? '.' : m))) },
    });
    driveTo(s, 1400, 380, 10);
    idle(s, 2);
    expect(s.runner.state.flags.spotted).toBe(true);
  });
});
