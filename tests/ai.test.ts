import { describe, it, expect } from 'vitest';
import { harness } from './aiharness';
import { openMap, mapWith } from './helpers';
import { neutralInput, type TankInput } from '../src/sim/types';
import { relayYard } from '../src/content/relayYard';
import { World } from '../src/sim/world';
import { TeamObserver } from '../src/sim/observation';
import { BotController } from '../src/ai/controller';
import { DIFFICULTY } from '../src/ai/personality';

const sec = (s: number) => Math.round(s * 30);

describe('bot perception (fair, delayed, fallible)', () => {
  it('acknowledges a new contact only after a reaction delay', () => {
    const h = harness(openMap(60, 40), [
      { name: 'bot', team: 0, isBot: true, pos: { x: 300, y: 600 } },
      { name: 'enemy', team: 1, isBot: false, pos: { x: 1400, y: 600 } },
    ], 1, 'hard');
    h.run(5);
    h.world.tank(1).pos = { x: 650, y: 600 };
    h.step();
    const bot = h.controllers[0]!.bot(0);
    expect(bot.memory.contact(1)?.visible).toBe(true);
    expect(bot.memory.acknowledged(h.world.tick).length).toBe(0);
    const [lo, hi] = DIFFICULTY.hard.reactionMs;
    h.run(Math.ceil((hi / 1000) * 30) + 1);
    expect(bot.memory.acknowledged(h.world.tick).map((c) => c.id)).toEqual([1]);
    expect(lo).toBeGreaterThan(0);
  });

  it('decisions are identical regardless of where a hidden, silent enemy really is', () => {
    const run = (hiddenPos: { x: number; y: number }) => {
      const map = relayYard();
      const world = new World({
        map,
        seed: 2,
        countdown: 0,
        tanks: [
          { name: 'bot', team: 0, isBot: true, pos: map.spawns[0]![0]! },
          { name: 'ghost', team: 1, isBot: false, pos: hiddenPos },
        ],
      });
      const obs = new TeamObserver(0);
      const ctl = new BotController({ map, team: 0, seed: 5, difficulty: 'normal', members: [{ id: 0, name: 'bot' }] });
      const log: TankInput[] = [];
      for (let i = 0; i < sec(6); i++) {
        const o = obs.observe(world);
        const inp = ctl.update(o);
        log.push(inp[0]!);
        world.step(inp);
      }
      return log;
    };
    const a = run({ x: 2300, y: 120 });
    const b = run({ x: 2300, y: 1480 });
    expect(a).toEqual(b);
  });
});

describe('bot combat behaviour', () => {
  it('engages and damages a visible stationary enemy', () => {
    const h = harness(openMap(60, 40), [
      { name: 'bot', team: 0, isBot: true, pos: { x: 300, y: 600 } },
      { name: 'dummy', team: 1, isBot: false, pos: { x: 650, y: 600 } },
    ]);
    h.run(sec(6));
    expect(h.world.tank(1).hp).toBeLessThan(100);
  });

  it('leads a strafing target well enough to land hits', () => {
    const h = harness(openMap(60, 40), [
      { name: 'bot', team: 0, isBot: true, pos: { x: 300, y: 600 } },
      { name: 'runner', team: 1, isBot: false, pos: { x: 680, y: 450 } },
    ], 3, 'hard');
    const runner = h.world.tank(1);
    let hits = 0;
    h.run(sec(20), (tick) => {
      const dir = Math.floor(tick / sec(2.5)) % 2 === 0 ? 1 : -1;
      return { 1: { ...neutralInput(300, 600), moveY: dir } };
    });
    hits = Math.round((100 * (runner.deaths) + (100 - runner.hp)) / 22);
    expect(runner.deaths > 0 || runner.hp < 100).toBe(true);
    expect(hits).toBeGreaterThanOrEqual(2);
  });

  it('investigates the coarse direction of an unseen shot', () => {
    const rows = ['#'.repeat(60)];
    for (let r = 0; r < 38; r++) rows.push('#' + '.'.repeat(28) + (r > 8 && r < 30 ? '#' : '.') + '.'.repeat(29) + '#');
    rows.push('#'.repeat(60));
    const h = harness(mapWith(rows), [
      { name: 'bot', team: 0, isBot: true, pos: { x: 700, y: 640 } },
      { name: 'sniper', team: 1, isBot: false, pos: { x: 1300, y: 640 } },
    ]);
    const d0 = Math.hypot(700 - 1300, 0);
    h.run(sec(8), (tick) => (tick % sec(2) === 0 ? { 1: { ...neutralInput(1300, 1200), firePressed: true, fireReleased: true } } : { 1: neutralInput(1300, 1200) }));
    const b = h.world.tank(0);
    expect(Math.hypot(b.pos.x - 1300, b.pos.y - 640)).toBeLessThan(d0 - 200);
  });

  it('searches the last known position after losing contact instead of tracking the hidden enemy', () => {
    const h = harness(openMap(70, 50), [
      { name: 'bot', team: 0, isBot: true, pos: { x: 400, y: 800 } },
      { name: 'ghost', team: 1, isBot: false, pos: { x: 780, y: 800 } },
    ]);
    h.run(sec(1.5));
    const g = h.world.tank(1);
    g.pos = { x: 2000, y: 200 };
    g.prevPos = { ...g.pos };
    let minToLast = Infinity;
    let minToGhost = Infinity;
    h.run(sec(7), () => {
      const b = h.world.tank(0);
      minToLast = Math.min(minToLast, Math.hypot(b.pos.x - 780, b.pos.y - 800));
      minToGhost = Math.min(minToGhost, Math.hypot(b.pos.x - g.pos.x, b.pos.y - g.pos.y));
      return {};
    });
    expect(minToLast).toBeLessThan(140);
    expect(minToGhost).toBeGreaterThan(500);
  });

  it('uses smoke or breaks contact when badly hurt under fire', () => {
    const rows = ['#'.repeat(60)];
    for (let r = 0; r < 38; r++) rows.push('#' + '.'.repeat(58) + '#');
    rows.push('#'.repeat(60));
    // cover blocks near the bot
    const m = mapWith(rows.map((l, r) => (r >= 14 && r <= 16 ? l.slice(0, 6) + '###' + l.slice(9) : l)));
    const h = harness(m, [
      { name: 'bot', team: 0, isBot: true, pos: { x: 360, y: 600 }, bot: { traits: { caution: 1, aggression: 0.1 } } },
      { name: 'attacker', team: 1, isBot: false, pos: { x: 620, y: 600 } },
    ]);
    h.world.tank(0).hp = 30;
    let smoked = false;
    let brokeContact = false;
    h.run(sec(4), () => {
      smoked ||= h.world.smokes.length > 0;
      const o = h.observers[1].observe(h.world);
      if (h.world.tick > sec(1.5) && !o.tanks.some((t) => t.id === 0)) brokeContact = true;
      return { 1: neutralInput(h.world.tank(0).pos.x, h.world.tank(0).pos.y) };
    });
    expect(smoked || brokeContact).toBe(true);
  });

  it('reacts to a visible incoming shell by moving off its line', () => {
    const h = harness(openMap(70, 40), [
      { name: 'bot', team: 0, isBot: true, pos: { x: 400, y: 600 }, bot: { traits: { reflex: 1 } } },
      { name: 'far', team: 1, isBot: false, pos: { x: 1900, y: 1150 } },
    ], 4, 'hard');
    h.run(sec(1));
    h.world.projectiles.push({
      id: 999, owner: 1, team: 1,
      pos: { x: 1150, y: 600 }, prevPos: { x: 1150, y: 600 },
      vel: { x: -400, y: 0 }, charge: 0, damage: 22, traveled: 0, range: 900,
    });
    h.run(sec(1.6));
    expect(h.world.tank(0).hp).toBe(100);
  });

  it('keeps moving rather than sitting exposed during a duel', () => {
    const h = harness(openMap(60, 40), [
      { name: 'bot', team: 0, isBot: true, pos: { x: 300, y: 600 } },
      { name: 'dummy', team: 1, isBot: false, pos: { x: 700, y: 600 } },
    ]);
    let travelled = 0;
    let last = { ...h.world.tank(0).pos };
    h.run(sec(6), () => {
      const p = h.world.tank(0).pos;
      travelled += Math.hypot(p.x - last.x, p.y - last.y);
      last = { ...p };
      return { 1: neutralInput(300, 600) };
    });
    expect(travelled).toBeGreaterThan(120);
  });

  it('assigns squad roles including pressure and a flanker when an enemy is known', () => {
    const map = relayYard();
    const h = harness(map, [
      { name: 'a', team: 0, isBot: true, pos: { x: 600, y: 1345 } },
      { name: 'b', team: 0, isBot: true, pos: { x: 560, y: 1320 } },
      { name: 'c', team: 0, isBot: true, pos: { x: 560, y: 1365 } },
      { name: 'enemy', team: 1, isBot: false, pos: { x: 950, y: 1345 } },
    ]);
    h.run(sec(2));
    const roles = h.controllers[0]!.roles();
    expect(Object.values(roles)).toContain('pressure');
    expect(Object.values(roles)).toContain('flank');
  });
});

describe('bot robustness', () => {
  it('3v3 bots on Relay Yard fight, score kills and never stay stuck', () => {
    const map = relayYard();
    const tanks = [0, 1].flatMap((team) =>
      [0, 1, 2].map((i) => ({ name: `t${team}b${i}`, team: team as 0 | 1, isBot: true })),
    );
    const h = harness(map, tanks, 11);
    const still = new Map<number, { x: number; y: number; since: number }>();
    let maxStill = 0;
    h.run(sec(150), (tick) => {
      for (const t of h.world.tanks) {
        if (!t.alive) {
          still.delete(t.id);
          continue;
        }
        const s = still.get(t.id);
        if (!s || Math.hypot(t.pos.x - s.x, t.pos.y - s.y) > 24) still.set(t.id, { x: t.pos.x, y: t.pos.y, since: tick });
        else maxStill = Math.max(maxStill, tick - s.since);
      }
      return {};
    });
    const kills = h.world.match.scores[0] + h.world.match.scores[1];
    expect(kills).toBeGreaterThanOrEqual(2);
    expect(maxStill).toBeLessThan(sec(20));
  });

  it('is deterministic for a given seed', () => {
    const map = relayYard();
    const tanks = [0, 1].flatMap((team) => [0, 1].map((i) => ({ name: `t${team}${i}`, team: team as 0 | 1, isBot: true })));
    const a = harness(map, tanks, 21);
    const b = harness(relayYard(), tanks, 21);
    a.run(sec(10));
    b.run(sec(10));
    expect(a.world.tanks.map((t) => t.pos)).toEqual(b.world.tanks.map((t) => t.pos));
  });
});
