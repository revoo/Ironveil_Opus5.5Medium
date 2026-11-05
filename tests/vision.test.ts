import { describe, it, expect } from 'vitest';
import { World } from '../src/sim/world';
import { canObserveTank, teamVisibleEnemies, sightClear, pointVisibleToTeam } from '../src/sim/vision';
import { neutralInput } from '../src/sim/types';
import { openMap, mapWith } from './helpers';
import { TUNING } from '../src/sim/tuning';

type Spec = { name: string; team: 0 | 1; pos: { x: number; y: number } };
const mk = (specs: Spec[], map = openMap(60, 40)) =>
  new World({ map, seed: 3, countdown: 0, tanks: specs.map((s) => ({ ...s, isBot: false })) });

describe('vision rules', () => {
  it('sees within 440 px and not beyond', () => {
    const w = mk([
      { name: 'a', team: 0, pos: { x: 200, y: 400 } },
      { name: 'b', team: 1, pos: { x: 200 + 430, y: 400 } },
      { name: 'c', team: 1, pos: { x: 200, y: 400 + 450 } },
    ]);
    const vis = teamVisibleEnemies(w, 0);
    expect(vis.has(1)).toBe(true);
    expect(vis.has(2)).toBe(false);
  });

  it('walls block sight', () => {
    const rows = ['#'.repeat(30)];
    for (let r = 0; r < 10; r++) rows.push('#' + '.'.repeat(9) + '#' + '.'.repeat(18) + '#');
    rows.push('#'.repeat(30));
    const w = mk(
      [
        { name: 'a', team: 0, pos: { x: 200, y: 160 } },
        { name: 'b', team: 1, pos: { x: 450, y: 160 } },
      ],
      mapWith(rows),
    );
    expect(teamVisibleEnemies(w, 0).has(1)).toBe(false);
  });

  it('smoke blocks sight for both teams, including rays originating inside it', () => {
    const w = mk([
      { name: 'a', team: 0, pos: { x: 200, y: 400 } },
      { name: 'b', team: 1, pos: { x: 500, y: 400 } },
    ]);
    w.addSmoke(0, { x: 350, y: 400 });
    expect(teamVisibleEnemies(w, 0).has(1)).toBe(false);
    expect(teamVisibleEnemies(w, 1).has(0)).toBe(false);
    w.smokes.length = 0;
    w.addSmoke(0, { x: 200, y: 400 }); // observer sits inside smoke
    expect(teamVisibleEnemies(w, 0).has(1)).toBe(false);
    expect(sightClear(w.map, w.smokes, { x: 600, y: 600 }, { x: 700, y: 600 })).toBe(true);
  });

  it('brush conceals beyond 110 px; firing reveals briefly but never through hard cover', () => {
    const rows = ['#'.repeat(40)];
    for (let r = 0; r < 20; r++) rows.push('#' + '.'.repeat(14) + '""""' + '.'.repeat(20) + '#');
    rows.push('#'.repeat(40));
    const map = mapWith(rows);
    const brushX = 15 * 32 + 64; // centre of brush strip
    const w = mk(
      [
        { name: 'a', team: 0, pos: { x: brushX - 300, y: 300 } },
        { name: 'b', team: 1, pos: { x: brushX, y: 300 } },
      ],
      map,
    );
    const a = w.tank(0);
    const b = w.tank(1);
    expect(canObserveTank(w.map, w.smokes, a, b, w.tick)).toBe(false);
    a.pos.x = brushX - 100;
    expect(canObserveTank(w.map, w.smokes, a, b, w.tick)).toBe(true);
    a.pos.x = brushX - 300;
    b.revealUntil = w.tick + 36;
    expect(canObserveTank(w.map, w.smokes, a, b, w.tick)).toBe(true);
    w.addSmoke(1, { x: brushX - 150, y: 300 });
    expect(canObserveTank(w.map, w.smokes, a, b, w.tick)).toBe(false);
  });

  it('firing from brush sets a 1.2 s reveal window', () => {
    const rows = ['#'.repeat(40)];
    for (let r = 0; r < 20; r++) rows.push('#' + '.'.repeat(14) + '""""' + '.'.repeat(20) + '#');
    rows.push('#'.repeat(40));
    const brushX = 15 * 32 + 64;
    const w = mk(
      [
        { name: 'a', team: 0, pos: { x: brushX - 300, y: 300 } },
        { name: 'b', team: 1, pos: { x: brushX, y: 300 } },
      ],
      mapWith(rows),
    );
    w.step({ 1: { ...neutralInput(0, 300), firePressed: true, fireReleased: true } });
    expect(teamVisibleEnemies(w, 0).has(1)).toBe(true);
    for (let i = 0; i < Math.ceil(TUNING.vision.fireReveal * 30) + 1; i++) w.step({});
    expect(teamVisibleEnemies(w, 0).has(1)).toBe(false);
  });

  it('team vision is the union of living observers', () => {
    const w = mk([
      { name: 'a', team: 0, pos: { x: 200, y: 400 } },
      { name: 'a2', team: 0, pos: { x: 1400, y: 400 } },
      { name: 'b', team: 1, pos: { x: 1600, y: 400 } },
    ]);
    expect(teamVisibleEnemies(w, 0).has(2)).toBe(true);
    w.tank(1).alive = false;
    expect(teamVisibleEnemies(w, 0).has(2)).toBe(false);
  });

  it('ground points use range and line of sight but not brush', () => {
    const w = mk([{ name: 'a', team: 0, pos: { x: 200, y: 400 } }]);
    expect(pointVisibleToTeam(w, 0, { x: 600, y: 400 })).toBe(true);
    expect(pointVisibleToTeam(w, 0, { x: 700, y: 400 })).toBe(false);
  });
});
