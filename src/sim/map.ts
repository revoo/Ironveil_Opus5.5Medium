// Map data, terrain queries, wall raycasts and circle-vs-wall collision.
import type { Vec } from './math';

export const Terrain = {
  Grass: 0,
  Road: 1,
  Mud: 2,
  Brush: 3,
  Wall: 4,
} as const;
export type TerrainId = (typeof Terrain)[keyof typeof Terrain];

export interface Landmark {
  name: string;
  x: number;
  y: number;
}

export interface GameMap {
  id: string;
  version: number;
  name: string;
  tile: number;
  cols: number;
  rows: number;
  width: number;
  height: number;
  tiles: Uint8Array;
  /** Spawn points per team. */
  spawns: Vec[][];
  landmarks: Landmark[];
}

export const GLYPHS: Record<string, TerrainId> = {
  '#': Terrain.Wall,
  '.': Terrain.Grass,
  '=': Terrain.Road,
  '~': Terrain.Mud,
  '"': Terrain.Brush,
};

export function createMap(cols: number, rows: number, tile = 32, fill: TerrainId = Terrain.Grass): GameMap {
  const tiles = new Uint8Array(cols * rows).fill(fill);
  return {
    id: 'custom',
    version: 1,
    name: 'Custom',
    tile,
    cols,
    rows,
    width: cols * tile,
    height: rows * tile,
    tiles,
    spawns: [[], []],
    landmarks: [],
  };
}

export function parseAsciiMap(lines: string[], tile = 32): GameMap {
  const rows = lines.length;
  const cols = Math.max(...lines.map((l) => l.length));
  const m = createMap(cols, rows, tile);
  for (let r = 0; r < rows; r++) {
    const line = lines[r]!;
    for (let c = 0; c < cols; c++) {
      const g = line[c] ?? '#';
      m.tiles[r * cols + c] = GLYPHS[g] ?? Terrain.Grass;
    }
  }
  return m;
}

export function tileAt(map: GameMap, c: number, r: number): TerrainId {
  if (c < 0 || r < 0 || c >= map.cols || r >= map.rows) return Terrain.Wall;
  return map.tiles[r * map.cols + c] as TerrainId;
}

export function setTile(map: GameMap, c: number, r: number, t: TerrainId): void {
  if (c < 0 || r < 0 || c >= map.cols || r >= map.rows) return;
  map.tiles[r * map.cols + c] = t;
}

export function terrainAt(map: GameMap, x: number, y: number): TerrainId {
  return tileAt(map, Math.floor(x / map.tile), Math.floor(y / map.tile));
}

export const isWallTile = (map: GameMap, c: number, r: number): boolean => tileAt(map, c, r) === Terrain.Wall;

/**
 * Earliest parameter t in [0,1] at which segment a->b enters a wall tile (Amanatides–Woo DDA).
 * Returns 0 when starting inside a wall and Infinity when the segment is clear.
 * Passing exactly through a corner shared by two diagonal walls counts as blocked.
 */
export function raycastWalls(map: GameMap, ax: number, ay: number, bx: number, by: number): number {
  const ts = map.tile;
  let cx = Math.floor(ax / ts);
  let cy = Math.floor(ay / ts);
  if (isWallTile(map, cx, cy)) return 0;
  const dx = bx - ax;
  const dy = by - ay;
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const tDeltaX = stepX !== 0 ? ts / Math.abs(dx) : Infinity;
  const tDeltaY = stepY !== 0 ? ts / Math.abs(dy) : Infinity;
  let tMaxX = stepX > 0 ? ((cx + 1) * ts - ax) / dx : stepX < 0 ? (cx * ts - ax) / dx : Infinity;
  let tMaxY = stepY > 0 ? ((cy + 1) * ts - ay) / dy : stepY < 0 ? (cy * ts - ay) / dy : Infinity;
  for (let guard = 0; guard < 10000; guard++) {
    if (Math.abs(tMaxX - tMaxY) < 1e-12 && tMaxX <= 1) {
      // Exact corner crossing: treat either orthogonal neighbour being a wall as a hit.
      const t = tMaxX;
      if (isWallTile(map, cx + stepX, cy) || isWallTile(map, cx, cy + stepY)) return t;
      cx += stepX;
      cy += stepY;
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
      if (isWallTile(map, cx, cy)) return t;
      continue;
    }
    let t: number;
    if (tMaxX < tMaxY) {
      t = tMaxX;
      if (t > 1) return Infinity;
      cx += stepX;
      tMaxX += tDeltaX;
    } else {
      t = tMaxY;
      if (t > 1) return Infinity;
      cy += stepY;
      tMaxY += tDeltaY;
    }
    if (isWallTile(map, cx, cy)) return t;
  }
  return Infinity;
}

export function lineOfSightClear(map: GameMap, a: Vec, b: Vec): boolean {
  return raycastWalls(map, a.x, a.y, b.x, b.y) === Infinity;
}

/** Push a circle out of overlapping wall tiles (mutates p). Returns contact normals. */
export function resolveCircleWalls(map: GameMap, p: Vec, r: number): Vec[] {
  const normals: Vec[] = [];
  const ts = map.tile;
  for (let iter = 0; iter < 4; iter++) {
    let moved = false;
    const c0 = Math.floor((p.x - r) / ts);
    const c1 = Math.floor((p.x + r) / ts);
    const r0 = Math.floor((p.y - r) / ts);
    const r1 = Math.floor((p.y + r) / ts);
    // Resolve the deepest overlap first for stable sliding.
    let best: { nx: number; ny: number; depth: number } | null = null;
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        if (!isWallTile(map, col, row)) continue;
        const minX = col * ts;
        const minY = row * ts;
        const maxX = minX + ts;
        const maxY = minY + ts;
        const qx = Math.max(minX, Math.min(p.x, maxX));
        const qy = Math.max(minY, Math.min(p.y, maxY));
        const dx = p.x - qx;
        const dy = p.y - qy;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        let nx: number;
        let ny: number;
        let depth: number;
        if (d2 > 1e-12) {
          const d = Math.sqrt(d2);
          nx = dx / d;
          ny = dy / d;
          depth = r - d;
        } else {
          // Centre inside the tile: exit through the nearest face that leads to open space.
          const opts = [
            { nx: -1, ny: 0, d: p.x - minX, open: !isWallTile(map, col - 1, row) },
            { nx: 1, ny: 0, d: maxX - p.x, open: !isWallTile(map, col + 1, row) },
            { nx: 0, ny: -1, d: p.y - minY, open: !isWallTile(map, col, row - 1) },
            { nx: 0, ny: 1, d: maxY - p.y, open: !isWallTile(map, col, row + 1) },
          ].sort((a, b) => (a.open === b.open ? a.d - b.d : a.open ? -1 : 1));
          const o = opts[0]!;
          nx = o.nx;
          ny = o.ny;
          depth = o.d + r;
        }
        if (!best || depth > best.depth) best = { nx, ny, depth };
      }
    }
    if (best) {
      p.x += best.nx * best.depth;
      p.y += best.ny * best.depth;
      normals.push({ x: best.nx, y: best.ny });
      moved = true;
    }
    if (!moved) break;
  }
  return normals;
}

/** True when a circle at (x,y) overlaps no wall tile. */
export function circleFree(map: GameMap, x: number, y: number, r: number): boolean {
  const ts = map.tile;
  const c0 = Math.floor((x - r) / ts);
  const c1 = Math.floor((x + r) / ts);
  const r0 = Math.floor((y - r) / ts);
  const r1 = Math.floor((y + r) / ts);
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      if (!isWallTile(map, col, row)) continue;
      const qx = Math.max(col * ts, Math.min(x, col * ts + ts));
      const qy = Math.max(row * ts, Math.min(y, row * ts + ts));
      if ((x - qx) ** 2 + (y - qy) ** 2 < r * r) return false;
    }
  }
  return true;
}

/** Distance from (x,y) to the nearest wall tile, capped at `cap`. */
export function wallDistance(map: GameMap, x: number, y: number, cap: number): number {
  const ts = map.tile;
  let best = cap;
  const c0 = Math.floor((x - cap) / ts);
  const c1 = Math.floor((x + cap) / ts);
  const r0 = Math.floor((y - cap) / ts);
  const r1 = Math.floor((y + cap) / ts);
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      if (!isWallTile(map, col, row)) continue;
      const qx = Math.max(col * ts, Math.min(x, col * ts + ts));
      const qy = Math.max(row * ts, Math.min(y, row * ts + ts));
      const d = Math.hypot(x - qx, y - qy);
      if (d < best) best = d;
    }
  }
  return best;
}

export const NAV_CELL = 16;

/** Walkability grid at NAV_CELL resolution for a circle of radius r (cells whose centre keeps the circle wall-free). */
export function buildWalkGrid(map: GameMap, r: number): { cols: number; rows: number; cell: number; walk: Uint8Array } {
  const cell = NAV_CELL;
  const cols = Math.floor(map.width / cell);
  const rows = Math.floor(map.height / cell);
  const walk = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      walk[y * cols + x] = circleFree(map, x * cell + cell / 2, y * cell + cell / 2, r + 0.5) ? 1 : 0;
    }
  }
  return { cols, rows, cell, walk };
}

/** Structural validation; returns human-readable errors (empty = valid). */
export function validateMap(map: GameMap, tankRadius = 20): string[] {
  const errors: string[] = [];
  if (map.tiles.length !== map.cols * map.rows) errors.push('tile array size mismatch');
  for (let i = 0; i < map.tiles.length; i++) {
    if (map.tiles[i]! > Terrain.Wall) {
      errors.push(`unsupported terrain id ${map.tiles[i]} at index ${i}`);
      break;
    }
  }
  if (map.spawns.length < 2 || map.spawns.some((s) => s.length === 0)) {
    errors.push('both teams need at least one spawn');
    return errors;
  }
  map.spawns.forEach((list, team) =>
    list.forEach((s, i) => {
      if (!circleFree(map, s.x, s.y, tankRadius)) errors.push(`spawn ${team}:${i} overlaps a wall`);
    }),
  );
  if (errors.length) return errors;
  // Reachability over the walk grid from the first team-0 spawn.
  const g = buildWalkGrid(map, tankRadius);
  const idx = (p: Vec) => Math.floor(p.y / g.cell) * g.cols + Math.floor(p.x / g.cell);
  const seen = new Uint8Array(g.walk.length);
  const start = idx(map.spawns[0]![0]!);
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % g.cols;
    const y = (i - x) / g.cols;
    const nbrs = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];
    for (const [nx, ny] of nbrs) {
      if (nx! < 0 || ny! < 0 || nx! >= g.cols || ny! >= g.rows) continue;
      const j = ny! * g.cols + nx!;
      if (!seen[j] && g.walk[j]) {
        seen[j] = 1;
        stack.push(j);
      }
    }
  }
  map.spawns.forEach((list, team) =>
    list.forEach((s, i) => {
      if (!seen[idx(s)]) errors.push(`spawn ${team}:${i} cannot reach team 0 spawn`);
    }),
  );
  for (const l of map.landmarks) {
    if (!seen[idx(l)]) errors.push(`landmark ${l.name} unreachable`);
  }
  return errors;
}
