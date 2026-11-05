import { describe, it, expect } from 'vitest';
import { World } from '../src/sim/world';
import { neutralInput, type TankInput } from '../src/sim/types';
import { openMap, mapWith } from './helpers';
import { TUNING } from '../src/sim/tuning';
import { WEAPON_TICKS } from '../src/sim/weapon';

type Spec = { name: string; team: 0 | 1; pos: { x: number; y: number } };

function world(specs: Spec[], map = openMap(60, 40)) {
  return new World({ map, seed: 7, countdown: 0, tanks: specs.map((s) => ({ ...s, isBot: false })) });
}

const tap = (aimX: number, aimY: number): TankInput => ({
  ...neutralInput(aimX, aimY),
  firePressed: true,
  fireReleased: true,
});

function aimAll(w: World, targets: Record<number, { x: number; y: number }>, n = 40) {
  // let turrets traverse
  for (let i = 0; i < n; i++) {
    const inputs: Record<number, TankInput> = {};
    for (const [id, p] of Object.entries(targets)) inputs[+id] = neutralInput(p.x, p.y);
    w.step(inputs);
  }
}

describe('projectiles and damage', () => {
  it('spawns a shell at the muzzle that travels at charge speed', () => {
    const w = world([{ name: 'a', team: 0, pos: { x: 300, y: 300 } }]);
    w.step({ 0: tap(900, 300) });
    expect(w.projectiles.length).toBe(1);
    const p = w.projectiles[0]!;
    expect(p.pos.x).toBeCloseTo(300 + TUNING.cannon.muzzleDistance + TUNING.cannon.speedMin / 30, 3);
    expect(w.events.some((e) => e.type === 'shot')).toBe(true);
  });

  it('expires at max range regardless of charge', () => {
    const w = world([{ name: 'a', team: 0, pos: { x: 100, y: 600 } }], openMap(80, 40));
    w.step({ 0: tap(2000, 600) });
    let expired = false;
    for (let i = 0; i < 120 && !expired; i++) {
      w.step({});
      expired = w.events.some((e) => e.type === 'impact' && e.kind === 'expire');
    }
    expect(expired).toBe(true);
    const imp = w.lastImpact!;
    expect(imp.pos.x - 100).toBeCloseTo(TUNING.cannon.range + TUNING.cannon.muzzleDistance, 0);
  });

  it('a fast shell cannot tunnel through a single thin wall', () => {
    const rows = ['#'.repeat(40)];
    for (let r = 0; r < 10; r++) rows.push('#' + '.'.repeat(19) + '#' + '.'.repeat(18) + '#');
    rows.push('#'.repeat(40));
    const w = world(
      [
        { name: 'a', team: 0, pos: { x: 200, y: 160 } },
        { name: 'b', team: 1, pos: { x: 900, y: 160 } },
      ],
      mapWith(rows),
    );
    // full charge
    w.step({ 0: { ...neutralInput(900, 160), firePressed: true, fireHeld: true } });
    for (let i = 0; i < WEAPON_TICKS.charge; i++) w.step({ 0: { ...neutralInput(900, 160), fireHeld: true } });
    w.step({ 0: { ...neutralInput(900, 160), fireReleased: true } });
    for (let i = 0; i < 60; i++) w.step({});
    expect(w.tank(1).hp).toBe(100);
    expect(w.lastImpact!.kind).toBe('wall');
    expect(w.lastImpact!.pos.x).toBeCloseTo(640, 0);
  });

  it('an obstructed muzzle impacts the wall immediately and cannot hit through it', () => {
    const rows = ['#'.repeat(30)];
    for (let r = 0; r < 10; r++) rows.push('#' + '.'.repeat(9) + '#' + '.'.repeat(18) + '#');
    rows.push('#'.repeat(30));
    // wall column at x 320..352; tank hugging it at x=299
    const w = world(
      [
        { name: 'a', team: 0, pos: { x: 299, y: 160 } },
        { name: 'b', team: 1, pos: { x: 380, y: 160 } },
      ],
      mapWith(rows),
    );
    w.step({ 0: tap(380, 160) });
    expect(w.projectiles.length).toBe(0);
    expect(w.events.some((e) => e.type === 'impact' && e.kind === 'wall')).toBe(true);
    for (let i = 0; i < 10; i++) w.step({});
    expect(w.tank(1).hp).toBe(100);
  });

  it('hits a target moving across the shell path (swept collision)', () => {
    const w = world([
      { name: 'a', team: 0, pos: { x: 200, y: 400 } },
      { name: 'b', team: 1, pos: { x: 600, y: 230 } },
    ]);
    const b = w.tank(1);
    b.vel = { x: 0, y: 190 };
    w.step({ 0: tap(600, 400), 1: { ...neutralInput(0, 0), moveY: 1 } });
    for (let i = 0; i < 40; i++) w.step({ 1: { ...neutralInput(0, 0), moveY: 1 } });
    expect(b.hp).toBe(100 - TUNING.cannon.damageMin);
  });

  it('stops on the earliest enemy only', () => {
    const w = world([
      { name: 'a', team: 0, pos: { x: 200, y: 400 } },
      { name: 'b', team: 1, pos: { x: 400, y: 400 } },
      { name: 'c', team: 1, pos: { x: 600, y: 400 } },
    ]);
    w.step({ 0: tap(800, 400) });
    for (let i = 0; i < 40; i++) w.step({});
    expect(w.tank(1).hp).toBe(100 - TUNING.cannon.damageMin);
    expect(w.tank(2).hp).toBe(100);
  });

  it('allied shells pass through teammates', () => {
    const w = world([
      { name: 'a', team: 0, pos: { x: 200, y: 400 } },
      { name: 'ally', team: 0, pos: { x: 400, y: 400 } },
      { name: 'c', team: 1, pos: { x: 600, y: 400 } },
    ]);
    w.step({ 0: tap(800, 400) });
    for (let i = 0; i < 40; i++) w.step({});
    expect(w.tank(1).hp).toBe(100);
    expect(w.tank(2).hp).toBe(100 - TUNING.cannon.damageMin);
  });

  it('a same-tick trade kills both tanks regardless of iteration order', () => {
    const w = world([
      { name: 'a', team: 0, pos: { x: 300, y: 400 } },
      { name: 'b', team: 1, pos: { x: 500, y: 400 } },
    ]);
    aimAll(w, { 0: { x: 500, y: 400 }, 1: { x: 300, y: 400 } });
    w.tank(0).hp = 20;
    w.tank(1).hp = 20;
    w.step({ 0: tap(500, 400), 1: tap(300, 400) });
    for (let i = 0; i < 20; i++) w.step({});
    expect(w.tank(0).alive).toBe(false);
    expect(w.tank(1).alive).toBe(false);
    expect(w.match.scores).toEqual([1, 1]);
  });

  it('death while charging cancels the charge without firing', () => {
    const w = world([
      { name: 'a', team: 0, pos: { x: 300, y: 400 } },
      { name: 'b', team: 1, pos: { x: 500, y: 400 } },
    ]);
    aimAll(w, { 0: { x: 500, y: 400 }, 1: { x: 300, y: 400 } });
    w.tank(1).hp = 10;
    w.step({ 1: { ...neutralInput(300, 400), firePressed: true, fireHeld: true }, 0: tap(500, 400) });
    for (let i = 0; i < 15; i++) w.step({ 1: { ...neutralInput(300, 400), fireHeld: true } });
    expect(w.tank(1).alive).toBe(false);
    w.step({ 1: { ...neutralInput(300, 400), fireReleased: true } });
    expect(w.projectiles.filter((p) => p.team === 1).length).toBe(0);
    expect(w.events.some((e) => e.type === 'shot' && e.tank === 1)).toBe(false);
  });

  it('a duplicated tap input does not double fire', () => {
    const w = world([{ name: 'a', team: 0, pos: { x: 300, y: 400 } }]);
    w.step({ 0: tap(900, 400) });
    w.step({ 0: tap(900, 400) });
    expect(w.tank(0).shotsFired).toBe(1);
  });

  it('a kill scores for the killer team and schedules a respawn', () => {
    const w = world([
      { name: 'a', team: 0, pos: { x: 300, y: 400 } },
      { name: 'b', team: 1, pos: { x: 500, y: 400 } },
    ]);
    aimAll(w, { 0: { x: 500, y: 400 } });
    w.tank(1).hp = 10;
    w.step({ 0: tap(500, 400) });
    for (let i = 0; i < 20; i++) w.step({});
    expect(w.match.scores).toEqual([1, 0]);
    expect(w.tank(0).kills).toBe(1);
    const b = w.tank(1);
    expect(b.alive).toBe(false);
    for (let i = 0; i < 30 * TUNING.match.respawn + 2; i++) w.step({});
    expect(b.alive).toBe(true);
    expect(b.hp).toBe(100);
  });

  it('spawn protection blocks damage until the protected tank fires', () => {
    const w = world([
      { name: 'a', team: 0, pos: { x: 300, y: 400 } },
      { name: 'b', team: 1, pos: { x: 500, y: 400 } },
    ]);
    aimAll(w, { 0: { x: 500, y: 400 } });
    const b = w.tank(1);
    b.protectedUntil = w.tick + 60;
    w.step({ 0: tap(500, 400) });
    for (let i = 0; i < 20; i++) w.step({});
    expect(b.hp).toBe(100);
    w.step({ 1: tap(300, 400) });
    expect(b.protectedUntil).toBeLessThanOrEqual(w.tick);
  });
});
