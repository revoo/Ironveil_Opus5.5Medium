// Turn LevelData into the simulation's GameMap plus fast lookups for the mission layer.
import { GLYPHS, buildWalkGrid, circleFree, createMap, Terrain, type GameMap } from '../sim/map';
import type { Vec } from '../sim/math';
import { LEVEL_FORMAT, LEVEL_FORMAT_VERSION, type LevelData, type LevelMarker, type LevelPath, type LevelZone } from './format';

export interface Level {
  data: LevelData;
  map: GameMap;
  marker(id: string): LevelMarker;
  zone(id: string): LevelZone;
  path(id: string): LevelPath;
  markersTagged(tag: string): LevelMarker[];
  zonesTagged(tag: string): LevelZone[];
}

export class LevelError extends Error {
  constructor(readonly problems: string[]) {
    super(`invalid level:\n  - ${problems.join('\n  - ')}`);
  }
}

export const degToRad = (d: number): number => (d * Math.PI) / 180;

export function inZone(z: LevelZone, p: Vec): boolean {
  return p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h;
}

export function zoneCentre(z: LevelZone): Vec {
  return { x: z.x + z.w / 2, y: z.y + z.h / 2 };
}

/** Build the GameMap. Throws LevelError if the level fails validation. */
export function loadLevel(data: LevelData): Level {
  const problems = validateLevel(data);
  if (problems.length) throw new LevelError(problems);
  return buildLevel(data);
}

function buildLevel(data: LevelData): Level {
  const rows = data.terrain.length;
  const cols = data.terrain[0]!.length;
  const map = createMap(cols, rows, data.tile);
  map.id = data.id;
  map.name = data.name;
  map.version = data.version;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) map.tiles[r * cols + c] = GLYPHS[data.terrain[r]![c]!] ?? Terrain.Grass;
  const tagged = (tag: string) => data.markers.filter((m) => m.tags?.includes(tag));
  map.spawns = [tagged('player-start').map(pt), tagged('enemy-spawn').map(pt)];
  map.landmarks = tagged('landmark').map((m) => ({ name: m.id, x: m.x, y: m.y }));
  const byId = <T extends { id: string }>(list: T[], kind: string) => {
    const m = new Map(list.map((x) => [x.id, x]));
    return (id: string): T => {
      const v = m.get(id);
      if (!v) throw new Error(`level ${data.id}: no ${kind} "${id}"`);
      return v;
    };
  };
  return {
    data,
    map,
    marker: byId(data.markers, 'marker'),
    zone: byId(data.zones, 'zone'),
    path: byId(data.paths, 'path'),
    markersTagged: tagged,
    zonesTagged: (tag) => data.zones.filter((z) => z.tags?.includes(tag)),
  };
}

const pt = (m: LevelMarker): Vec => ({ x: m.x, y: m.y });

/**
 * Everything a designer can get wrong, as readable messages (empty = valid):
 * shape, glyphs, duplicate ids, things outside the map or inside walls, and anything a tank
 * starting at the player start could never reach.
 */
export function validateLevel(data: LevelData, tankRadius = 20): string[] {
  const p: string[] = [];
  if (data.format !== LEVEL_FORMAT) p.push(`format must be "${LEVEL_FORMAT}"`);
  if (data.formatVersion !== LEVEL_FORMAT_VERSION) p.push(`unsupported formatVersion ${data.formatVersion}`);
  if (!data.terrain.length) return [...p, 'terrain is empty'];
  const cols = data.terrain[0]!.length;
  data.terrain.forEach((row, r) => {
    if (row.length !== cols) p.push(`terrain row ${r} has ${row.length} tiles, expected ${cols}`);
    for (let c = 0; c < row.length; c++) {
      if (!(row[c]! in GLYPHS)) {
        p.push(`terrain row ${r} col ${c}: unknown glyph "${row[c]}"`);
        break;
      }
    }
  });
  if (p.length) return p;

  const ids = new Map<string, string>();
  const claim = (id: string, kind: string) => {
    if (!id) p.push(`a ${kind} has no id`);
    else if (ids.has(id)) p.push(`duplicate id "${id}" (${ids.get(id)} and ${kind})`);
    else ids.set(id, kind);
  };
  data.markers.forEach((m) => claim(m.id, 'marker'));
  data.zones.forEach((z) => claim(z.id, 'zone'));
  data.paths.forEach((pa) => claim(pa.id, 'path'));

  const level = buildLevel(data);
  const { map } = level;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x <= map.width && y <= map.height;
  if (!level.markersTagged('player-start').length) p.push('no marker tagged "player-start"');

  for (const m of data.markers) {
    if (!inside(m.x, m.y)) p.push(`marker "${m.id}" is outside the map`);
    else if (!circleFree(map, m.x, m.y, tankRadius)) p.push(`marker "${m.id}" is too close to a wall for a tank`);
  }
  for (const z of data.zones) {
    if (z.w <= 0 || z.h <= 0) p.push(`zone "${z.id}" has no area`);
    if (!inside(z.x, z.y) || !inside(z.x + z.w, z.y + z.h)) p.push(`zone "${z.id}" extends outside the map`);
  }
  for (const pa of data.paths) {
    if (pa.points.length < 2) p.push(`path "${pa.id}" needs at least two points`);
    pa.points.forEach((q, i) => {
      if (!inside(q.x, q.y)) p.push(`path "${pa.id}" point ${i} is outside the map`);
      else if (!circleFree(map, q.x, q.y, tankRadius)) p.push(`path "${pa.id}" point ${i} is too close to a wall`);
    });
  }
  if (p.length) return p;

  // Reachability from the player start over the same walk grid the AI navigates.
  const g = buildWalkGrid(map, tankRadius);
  const cell = (q: Vec) => Math.floor(q.y / g.cell) * g.cols + Math.floor(q.x / g.cell);
  const seen = new Uint8Array(g.walk.length);
  const start = cell(level.markersTagged('player-start')[0]!);
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % g.cols;
    const y = (i - x) / g.cols;
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ] as const) {
      if (nx < 0 || ny < 0 || nx >= g.cols || ny >= g.rows) continue;
      const j = ny * g.cols + nx;
      if (!seen[j] && g.walk[j]) {
        seen[j] = 1;
        stack.push(j);
      }
    }
  }
  for (const m of data.markers) if (!seen[cell(m)]) p.push(`marker "${m.id}" cannot be reached from the player start`);
  for (const pa of data.paths) pa.points.forEach((q, i) => !seen[cell(q)] && p.push(`path "${pa.id}" point ${i} cannot be reached`));
  for (const z of data.zones) {
    let any = false;
    for (let y = z.y + g.cell / 2; y < z.y + z.h && !any; y += g.cell) for (let x = z.x + g.cell / 2; x < z.x + z.w && !any; x += g.cell) any = !!seen[cell({ x, y })];
    if (!any) p.push(`zone "${z.id}" cannot be entered from the player start`);
  }
  return p;
}
