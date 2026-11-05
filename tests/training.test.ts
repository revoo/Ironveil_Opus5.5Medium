import { describe, it, expect } from 'vitest';
import { TrainingTracker } from '../src/game/training';
import { LocalSession } from '../src/game/session';
import type { Observation, ObsEvent, TankView } from '../src/sim/observation';
import { neutralInput } from '../src/sim/types';

const me = (p: Partial<TankView>): TankView => ({
  id: 0, team: 0, name: 'You', isBot: false, x: 0, y: 0, vx: 0, vy: 0, hull: 0, turret: 0, hp: 100, alive: true,
  phase: 'ready', charge: 0, hold: null, weaponTimer: 0, silent: false, quiet: false, protected: false,
  inBrush: false, revealed: false, smokeReadyTick: 0, respawnTick: -1, aimX: 0, aimY: 0, ...p,
});
const obs = (tanks: TankView[], tick = 1): Observation => ({
  tick, team: 0, match: { phase: 'live', scores: [0, 0], killTarget: 99, timeRemaining: 999, winner: null },
  tanks, lastKnown: [], projectiles: [], smokes: [], tracks: [], events: [], sounds: {}, scoreboard: [],
});

describe('training tracker', () => {
  it('walks the steps in order as the player demonstrates each skill', () => {
    const t = new TrainingTracker(0);
    expect(t.current()?.id).toBe('drive');
    for (let i = 0; i < 30; i++) t.update(obs([me({ x: i * 20, vx: 190 })]), []);
    expect(t.isDone('drive')).toBe(true);
    t.update(obs([me({ vx: 150, vy: 20, hull: Math.PI / 2 })]), []);
    expect(t.isDone('drift')).toBe(true);
    const ev = (e: ObsEvent) => t.update(obs([me({})]), [e]);
    ev({ type: 'shot', tank: 0, x: 0, y: 0, angle: 0, charge: 0 });
    expect(t.isDone('tap')).toBe(true);
    ev({ type: 'shot', tank: 0, x: 0, y: 0, angle: 0, charge: 1 });
    expect(t.isDone('charge')).toBe(true);
    ev({ type: 'cancel', tank: 0 });
    expect(t.isDone('cancel')).toBe(true);
    t.update(obs([me({}), { ...me({ id: 2, team: 1, vx: 150 }) }]), [{ type: 'damage', target: 2, amount: 22, fromX: 0, fromY: 0, charge: 0, byUs: true }]);
    expect(t.isDone('hitMoving')).toBe(true);
    ev({ type: 'smoke', x: 0, y: 0 });
    expect(t.isDone('smoke')).toBe(true);
    for (let i = 0; i < 50; i++) t.update(obs([me({ quiet: true, silent: true, vx: 60 })]), []);
    expect(t.isDone('silent')).toBe(true);
    t.update(obs([me({ inBrush: true })]), []);
    expect(t.complete).toBe(true);
  });

  it('ignores other tanks’ shots and stationary-target hits for the moving-target step', () => {
    const t = new TrainingTracker(0);
    t.update(obs([me({})]), [{ type: 'shot', tank: 3, x: 0, y: 0, angle: 0, charge: 0 }]);
    expect(t.isDone('tap')).toBe(false);
    t.update(obs([me({}), me({ id: 2, team: 1, vx: 0 })]), [{ type: 'damage', target: 2, amount: 22, fromX: 0, fromY: 0, charge: 0, byUs: true }]);
    expect(t.isDone('hitMoving')).toBe(false);
  });
});

describe('training session', () => {
  it('spawns harmless practice targets near the player, one of them moving', () => {
    const s = new LocalSession({ teamSize: 1, difficulty: 'normal', playerName: 'You', seed: 3, countdown: 0, training: true });
    expect(s.training).not.toBeNull();
    const dummies = s.world.tanks.filter((t) => t.team === 1);
    expect(dummies.length).toBe(3);
    const p = s.world.tank(0).pos;
    for (const d of dummies) expect(Math.hypot(d.pos.x - p.x, d.pos.y - p.y)).toBeLessThan(900);
    const start = dummies.map((d) => ({ ...d.pos }));
    for (let i = 0; i < 90; i++) s.advance(1 / 30, () => neutralInput(p.x, p.y));
    expect(dummies.some((d, i) => Math.hypot(d.pos.x - start[i]!.x, d.pos.y - start[i]!.y) > 100)).toBe(true);
    expect(s.world.projectiles.filter((pr) => pr.team === 1).length).toBe(0);
    expect(s.world.tank(0).hp).toBe(100);
  });
});
