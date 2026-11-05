import { describe, it, expect } from 'vitest';
import { parseAsciiMap, terrainAt, Terrain, raycastWalls, resolveCircleWalls, validateMap, lineOfSightClear } from '../src/sim/map';
import { openMap } from './helpers';

describe('map parsing and terrain', () => {
  const m = parseAsciiMap(['#####', '#.=~#', '#"..#', '#####']);
  it('parses glyphs into terrain', () => {
    expect(m.cols).toBe(5);
    expect(m.rows).toBe(4);
    expect(terrainAt(m, 32 + 16, 32 + 16)).toBe(Terrain.Grass);
    expect(terrainAt(m, 64 + 16, 32 + 16)).toBe(Terrain.Road);
    expect(terrainAt(m, 96 + 16, 32 + 16)).toBe(Terrain.Mud);
    expect(terrainAt(m, 32 + 16, 64 + 16)).toBe(Terrain.Brush);
    expect(terrainAt(m, 5, 5)).toBe(Terrain.Wall);
  });
  it('treats outside the map as wall', () => {
    expect(terrainAt(m, -10, 50)).toBe(Terrain.Wall);
    expect(terrainAt(m, 50, 9999)).toBe(Terrain.Wall);
  });
});

describe('raycastWalls', () => {
  const m = parseAsciiMap(['##########', '#........#', '#....#...#', '#........#', '##########']);
  it('returns Infinity on a clear segment', () => {
    expect(raycastWalls(m, 48, 48, 280, 48)).toBe(Infinity);
  });
  it('finds the earliest wall entry', () => {
    // wall tile at col 5 row 2 spans x 160..192
    const t = raycastWalls(m, 48, 80, 280, 80);
    expect(t).toBeGreaterThan(0);
    expect(48 + (280 - 48) * t).toBeCloseTo(160, 5);
  });
  it('returns 0 when starting inside a wall', () => {
    expect(raycastWalls(m, 170, 80, 280, 80)).toBe(0);
  });
  it('does not leak through a thin wall at any angle (no tunneling)', () => {
    for (let a = -0.6; a <= 0.6; a += 0.05) {
      // aim from left of the single wall tile through its body
      const ax = 100;
      const ay = 80;
      const bx = 176 + Math.cos(a) * 1;
      const by = 80 + Math.sin(a) * 10;
      const t = raycastWalls(m, ax, ay, bx, by);
      expect(t).toBeLessThan(Infinity);
    }
  });
  it('blocks diagonal leaks through touching corners', () => {
    const d = parseAsciiMap(['######', '#....#', '#.#..#', '#..#.#', '#....#', '######']);
    // tile (2,2) and (3,3) touch at corner (96,96); segment through that corner
    expect(raycastWalls(d, 72, 120, 120, 72)).toBeLessThan(Infinity);
  });
  it('lineOfSightClear is the boolean convenience', () => {
    expect(lineOfSightClear(m, { x: 48, y: 48 }, { x: 280, y: 48 })).toBe(true);
    expect(lineOfSightClear(m, { x: 48, y: 80 }, { x: 280, y: 80 })).toBe(false);
  });
});

describe('resolveCircleWalls', () => {
  it('pushes a circle out of a wall and reports the normal', () => {
    const m = openMap(10, 10);
    const p = { x: 32 + 10, y: 160 }; // overlapping left border wall (x<32)
    const normals = resolveCircleWalls(m, p, 20);
    expect(p.x).toBeCloseTo(52, 5);
    expect(normals.length).toBeGreaterThan(0);
    expect(normals[0]!.x).toBeCloseTo(1, 5);
  });
  it('leaves a free circle untouched', () => {
    const m = openMap(10, 10);
    const p = { x: 160, y: 160 };
    expect(resolveCircleWalls(m, p, 20)).toEqual([]);
    expect(p).toEqual({ x: 160, y: 160 });
  });
});

describe('validateMap', () => {
  it('accepts a sane map with spawns', () => {
    const m = openMap(20, 12);
    m.spawns = [[{ x: 80, y: 80 }], [{ x: 500, y: 300 }]];
    expect(validateMap(m)).toEqual([]);
  });
  it('rejects a spawn overlapping a wall', () => {
    const m = openMap(20, 12);
    m.spawns = [[{ x: 20, y: 80 }], [{ x: 500, y: 300 }]];
    expect(validateMap(m).join(' ')).toMatch(/spawn/i);
  });
  it('rejects unreachable spawns', () => {
    const m = parseAsciiMap(['##########', '#...#....#', '#...#....#', '#...#....#', '##########']);
    m.spawns = [[{ x: 64, y: 96 }], [{ x: 240, y: 96 }]];
    expect(validateMap(m).join(' ')).toMatch(/reach/i);
  });
  it('rejects a map without spawns for both teams', () => {
    const m = openMap(20, 12);
    m.spawns = [[{ x: 80, y: 80 }], []];
    expect(validateMap(m).join(' ')).toMatch(/spawn/i);
  });
});
