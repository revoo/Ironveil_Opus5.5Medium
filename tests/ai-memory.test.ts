import { describe, it, expect } from 'vitest';
import { BotMemory } from '../src/ai/memory';
import { DIFFICULTY, PERSONAS } from '../src/ai/personality';
import { Rng } from '../src/sim/rng';
import type { Observation, TankView } from '../src/sim/observation';

const view = (p: Partial<TankView>): TankView => ({
  id: 0, team: 0, name: 'x', isBot: true, x: 0, y: 0, vx: 0, vy: 0, hull: 0, turret: 0, hp: 100, maxHp: 100, alive: true,
  phase: 'ready', charge: 0, hold: null, weaponTimer: 0, silent: false, quiet: false, protected: false,
  inBrush: false, revealed: false, smokeReadyTick: 0, respawnTick: -1, aimX: 0, aimY: 0, ...p,
});
const obs = (tick: number, tanks: TankView[]): Observation => ({
  tick, team: 0, match: { phase: 'live', scores: [0, 0], killTarget: 15, timeRemaining: 300, winner: null },
  tanks, lastKnown: [], projectiles: [], smokes: [], tracks: [], events: [], sounds: {}, scoreboard: [],
});

function mem() {
  // hard difficulty has the least velocity noise, so the lag is what we measure
  return new BotMemory(0, { ...DIFFICULTY.hard, velNoise: 0 }, PERSONAS[0]!.traits, new Rng(1));
}
const me = view({ id: 0, x: 0, y: 0 });
const enemy = (x: number, y: number, vx = 9999, vy = 9999) => view({ id: 5, team: 1, x, y, vx, vy });

describe('bot velocity is inferred from what it has seen, not read from data', () => {
  it('ignores the velocity field entirely (only successive positions count)', () => {
    const m = mem();
    for (let t = 1; t <= 10; t++) m.update(obs(t, [me, enemy(400, 300)]), me);
    expect(m.contact(5)!.vx).toBe(0);
    expect(m.contact(5)!.vy).toBe(0);
  });

  it('has no motion estimate on the first sighting', () => {
    const m = mem();
    m.update(obs(1, [me, enemy(400, 300)]), me);
    expect(Math.hypot(m.contact(5)!.vx, m.contact(5)!.vy)).toBe(0);
  });

  it('converges on steady motion within about half a second', () => {
    const m = mem();
    for (let t = 1; t <= 20; t++) m.update(obs(t, [me, enemy(300 + t * (190 / 30), 300)]), me);
    expect(m.contact(5)!.vx).toBeGreaterThan(170);
    expect(Math.abs(m.contact(5)!.vy)).toBeLessThan(1);
  });

  it('lags behind a sudden direction reversal (jukes work)', () => {
    const m = mem();
    let x = 300;
    for (let t = 1; t <= 30; t++) {
      x += 190 / 30;
      m.update(obs(t, [me, enemy(x, 300)]), me);
    }
    for (let t = 31; t <= 33; t++) {
      x -= 190 / 30;
      m.update(obs(t, [me, enemy(x, 300)]), me);
    }
    // true velocity is now -190; three ticks later the bot still believes it is far less negative
    expect(m.contact(5)!.vx).toBeGreaterThan(-120);
  });

  it('resets the estimate after a visibility gap', () => {
    const m = mem();
    for (let t = 1; t <= 20; t++) m.update(obs(t, [me, enemy(300 + t * 6, 300)]), me);
    for (let t = 21; t <= 40; t++) m.update(obs(t, [me]), me); // hidden
    m.update(obs(41, [me, enemy(700, 300)]), me);
    expect(m.contact(5)!.vx).toBe(0);
  });
});
