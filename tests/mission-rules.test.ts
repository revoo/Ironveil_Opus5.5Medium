import { describe, it, expect } from 'vitest';
import { World } from '../src/sim/world';
import { neutralInput } from '../src/sim/types';
import { openMap } from './helpers';
import { TUNING } from '../src/sim/tuning';

function mk() {
  const map = openMap(60, 40);
  return new World({
    map,
    seed: 3,
    rules: 'mission',
    countdown: 0,
    killTarget: 1,
    tanks: [
      { name: 'Player', team: 0, isBot: false, pos: { x: 200, y: 200 } },
      { name: 'Guard', team: 1, isBot: true, pos: { x: 900, y: 200 }, facing: 1.5 },
    ],
  });
}

const stepN = (w: World, n: number) => {
  for (let i = 0; i < n; i++) w.step({});
};

describe('mission world rules', () => {
  it('honours an explicit initial facing', () => {
    const w = mk();
    expect(w.tank(1).hull).toBeCloseTo(1.5);
    expect(w.tank(1).turret).toBeCloseTo(1.5);
  });

  it('destroyed tanks never respawn', () => {
    const w = mk();
    w.applyDamageForTest(1, 1000, 0);
    expect(w.tank(1).alive).toBe(false);
    expect(w.tank(1).respawnTick).toBe(-1);
    stepN(w, TUNING.tickHz * (TUNING.match.respawn + 2));
    expect(w.tank(1).alive).toBe(false);
  });

  it('reaching the kill target or the time limit does not end a mission', () => {
    const w = mk();
    w.applyDamageForTest(1, 1000, 0);
    stepN(w, TUNING.tickHz * 2);
    expect(w.match.phase).toBe('live');
    expect(w.timeRemaining()).toBe(0);
  });

  it('endMission ends the match and reports the outcome as an event on the next step', () => {
    const w = mk();
    w.endMission(0);
    expect(w.match.phase).toBe('ended');
    expect(w.match.winner).toBe(0);
    w.step({});
    expect(w.events).toContainEqual({ type: 'match', phase: 'ended', winner: 0 });
  });

  it('addTank mid-mission creates a live tank with the next id and a spawn event', () => {
    const w = mk();
    stepN(w, 5);
    const id = w.addTank({ name: 'Reinforcement', team: 1, isBot: true, pos: { x: 1200, y: 600 } });
    expect(id).toBe(2);
    expect(w.tank(2).alive).toBe(true);
    w.step({ 0: neutralInput() });
    expect(w.events.some((e) => e.type === 'spawn' && e.tank === 2)).toBe(true);
  });
});
