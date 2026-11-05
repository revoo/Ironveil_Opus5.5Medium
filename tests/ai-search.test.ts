import { describe, it, expect } from 'vitest';
import { NavGrid } from '../src/ai/nav';
import { possiblePositions, type TacCtx } from '../src/ai/tactics';
import { openMap, mapWith } from './helpers';
import { terrainAt, Terrain, lineOfSightClear } from '../src/sim/map';

const ctx = (map: ReturnType<typeof openMap>): TacCtx => ({ map, nav: new NavGrid(map), smokes: [] });
const sec = (s: number) => Math.round(s * 30);

describe('lost-contact hypotheses with negative evidence', () => {
  it('spreads over a larger area the longer contact has been lost', () => {
    const c = ctx(openMap(80, 50));
    const last = { x: 1200, y: 800 };
    const far = (ps: { x: number; y: number }[]) => Math.max(...ps.map((p) => Math.hypot(p.x - last.x, p.y - last.y)));
    const early = possiblePositions(c, last, sec(0.5), []);
    const late = possiblePositions(c, last, sec(3), []);
    expect(early.length).toBeGreaterThan(0);
    expect(far(late)).toBeGreaterThan(far(early) + 200);
  });

  it('drops every place a teammate can currently see is empty', () => {
    const c = ctx(openMap(80, 50));
    const last = { x: 1200, y: 800 };
    const watcher = { x: 1100, y: 800 };
    const ps = possiblePositions(c, last, sec(3), [watcher]);
    for (const p of ps) {
      const seen = Math.hypot(p.x - watcher.x, p.y - watcher.y) <= 440 && lineOfSightClear(c.map, watcher, p);
      expect(seen).toBe(false);
    }
    expect(ps.length).toBeGreaterThan(0); // the far side is still possible
  });

  it('keeps brush the watcher is too far from to see into', () => {
    const rows = ['#'.repeat(60)];
    for (let r = 0; r < 38; r++) rows.push('#' + '.'.repeat(30) + '""""""' + '.'.repeat(22) + '#');
    rows.push('#'.repeat(60));
    const c = ctx(mapWith(rows));
    const last = { x: 31 * 32 + 96, y: 600 };
    const watcher = { x: 31 * 32 - 160, y: 600 };
    const ps = possiblePositions(c, last, sec(1.5), [watcher]);
    expect(ps.some((p) => terrainAt(c.map, p.x, p.y) === Terrain.Brush)).toBe(true);
    for (const p of ps) {
      if (terrainAt(c.map, p.x, p.y) !== Terrain.Brush) {
        const seen = Math.hypot(p.x - watcher.x, p.y - watcher.y) <= 440 && lineOfSightClear(c.map, watcher, p);
        expect(seen).toBe(false);
      }
    }
  });

  it('follows reachable ground around corners but never into sealed-off areas', () => {
    // last seen just west of a wall with a gap at the bottom; a sealed room sits to the north-west
    const rows = ['#'.repeat(50)];
    for (let r = 0; r < 30; r++) {
      let line = '#' + '.'.repeat(48) + '#';
      if (r < 24) line = line.slice(0, 25) + '#' + line.slice(26); // wall column 25 with gap below row 24
      if (r >= 2 && r <= 8) line = line.slice(0, 8) + (r === 2 || r === 8 ? '#######' : '#.....#') + line.slice(15);
      rows.push(line);
    }
    rows.push('#'.repeat(50));
    const c = ctx(mapWith(rows));
    const last = { x: 24 * 32 - 20, y: 400 };
    const ps = possiblePositions(c, last, sec(6), []);
    // around the corner: east of the wall, not in a straight line from the last sighting
    expect(ps.some((p) => p.x > 26 * 32 && !lineOfSightClear(c.map, last, p))).toBe(true);
    // never inside the sealed room (cols 9-13, rows 4-8 in map coords)
    for (const p of ps) expect(p.x > 9 * 32 && p.x < 14 * 32 && p.y > 4 * 32 && p.y < 9 * 32).toBe(false);
  });

  it('is bounded', () => {
    const c = ctx(openMap(80, 50));
    expect(possiblePositions(c, { x: 1200, y: 800 }, sec(10), []).length).toBeLessThanOrEqual(160);
  });
});
