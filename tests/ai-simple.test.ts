import { describe, it, expect } from 'vitest';
import { World } from '../src/sim/world';
import { TeamObserver } from '../src/sim/observation';
import { neutralInput, type TankInput } from '../src/sim/types';
import { BARK_LINES, SimpleController, type Posture } from '../src/ai/simple';
import { mapWith, openMap } from './helpers';
import type { GameMap } from '../src/sim/map';

function setup(map: GameMap, player: { x: number; y: number }, guard: { x: number; y: number }, posture?: Posture) {
  const world = new World({
    map,
    seed: 1,
    rules: 'mission',
    countdown: 0,
    tanks: [
      { name: 'Player', team: 0, isBot: false, pos: player },
      { name: 'Guard', team: 1, isBot: true, pos: guard, facing: Math.PI },
    ],
  });
  const ai = new SimpleController(map, 1, 7, [{ id: 1, name: 'Guard', posture: posture ?? { kind: 'guard', pos: guard, facing: Math.PI } }]);
  const obs1 = new TeamObserver(1);
  const run = (seconds: number, player: () => TankInput = () => neutralInput(guard.x, guard.y), each?: () => void) => {
    for (let i = 0; i < seconds * 30; i++) {
      const inputs = { 0: player(), ...ai.update(obs1.observe(world)) };
      world.step(inputs);
      each?.();
    }
  };
  return { world, ai, run };
}

describe('simple mission AI', () => {
  it('a guard with nobody in sight stays calm at its post', () => {
    const { world, ai, run } = setup(openMap(60, 30), { x: 100, y: 100 }, { x: 1700, y: 800 });
    run(4);
    expect(ai.state(1)).toBe('calm');
    expect(Math.hypot(world.tank(1).pos.x - 1700, world.tank(1).pos.y - 800)).toBeLessThan(40);
  });

  it('suspicion builds over time at mid range, then the unit engages and raises the alarm', () => {
    const { ai, run } = setup(openMap(60, 30), { x: 600, y: 400 }, { x: 950, y: 400 });
    run(0.3);
    expect(ai.suspicion(1)).toBeGreaterThan(0);
    expect(ai.state(1)).not.toBe('combat');
    run(3);
    expect(ai.state(1)).toBe('combat');
    expect(ai.alarmRaised).toBe(true);
    expect(ai.events.some((e) => e.type === 'alarm')).toBe(true);
  });

  it('point-blank sightings are instant', () => {
    const { ai, run } = setup(openMap(40, 20), { x: 500, y: 300 }, { x: 600, y: 300 });
    run(0.1);
    expect(ai.state(1)).toBe('combat');
  });

  it('a unit killed in combat no longer holds the detection meter at spotted', () => {
    const { world, ai, run } = setup(openMap(40, 20), { x: 500, y: 300 }, { x: 600, y: 300 });
    run(0.1);
    expect(ai.maxSuspicion()).toBe(1);
    world.tank(1).alive = false;
    run(0.1);
    expect(ai.maxSuspicion()).toBe(0);
    expect(ai.state(1)).toBe('calm');
  });

  it('walls block detection', () => {
    const lines: string[] = [];
    for (let r = 0; r < 20; r++) {
      let row = '';
      for (let c = 0; c < 40; c++) row += r === 0 || r === 19 || c === 0 || c === 39 || (c === 20 && r > 0 && r < 19) ? '#' : '.';
      lines.push(row);
    }
    const { ai, run } = setup(mapWith(lines), { x: 560, y: 300 }, { x: 760, y: 300 });
    run(3);
    expect(ai.suspicion(1)).toBe(0);
    expect(ai.state(1)).toBe('calm');
  });

  it('a patrol visits every waypoint of its path', () => {
    const path = [
      { x: 1200, y: 200 },
      { x: 1600, y: 200 },
      { x: 1600, y: 600 },
    ];
    const { world, run } = setup(openMap(60, 30), { x: 80, y: 880 }, path[0]!, { kind: 'patrol', path, loop: true });
    const visited = new Set<number>();
    run(25, undefined, () => path.forEach((p, i) => Math.hypot(world.tank(1).pos.x - p.x, world.tank(1).pos.y - p.y) < 60 && visited.add(i)));
    expect([...visited].sort()).toEqual([0, 1, 2]);
  });

  it('in combat it shoots at the player', () => {
    const { world, run } = setup(openMap(50, 20), { x: 500, y: 300 }, { x: 760, y: 300 });
    run(6);
    expect(world.tank(1).shotsFired).toBeGreaterThan(0);
  });

  describe('barks', () => {
    it('calls out the spot and reloads, tagged with the speaker for the speech bubble', () => {
      const { ai, run } = setup(openMap(50, 20), { x: 500, y: 300 }, { x: 760, y: 300 });
      run(8);
      const kinds = ai.barks.map((b) => b.kind);
      expect(kinds).toContain('spotted');
      expect(kinds).toContain('reloading');
      for (const b of ai.barks) {
        expect(b.unit).toBe(1);
        expect(BARK_LINES[b.kind]).toContain(b.text);
      }
    });

    it('a calm unit that is shot says it was hit', () => {
      const { world, ai, run } = setup(openMap(60, 20), { x: 300, y: 300 }, { x: 1000, y: 300 }); // beyond sight, within cannon range
      let fired = false;
      run(3, () => {
        const i = neutralInput(1000, 300);
        if (!fired) [i.firePressed, i.fireHeld, i.fireReleased, fired] = [true, true, true, true];
        return i;
      });
      expect(world.tank(1).hp).toBeLessThan(100);
      expect(ai.barks.map((b) => b.kind)).toContain('hit');
    });

    it('barks never change what the units do (no RNG draws)', () => {
      const a = setup(openMap(50, 20), { x: 500, y: 300 }, { x: 760, y: 300 });
      const b = setup(openMap(50, 20), { x: 500, y: 300 }, { x: 760, y: 300 });
      a.run(6);
      b.ai.barks = [];
      b.run(6, undefined, () => (b.ai.barks.length = 0));
      expect(b.world.tank(1).pos).toEqual(a.world.tank(1).pos);
      expect(b.world.tank(0).hp).toBe(a.world.tank(0).hp);
    });
  });
});
