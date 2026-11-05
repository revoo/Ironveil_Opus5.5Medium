// Relay Yard — the single production map (75 x 50 tiles of 32 px = 2400 x 1600 px).
// Authored as point-symmetric builder operations so both teams get identical geometry.
// Regions: Radio Tower (centre), Depot (NW) / Foundry (SE), Broken Bridge (SW) / Quarry Cut (NE).
import { createMap, setTile, tileAt, Terrain, type GameMap, type TerrainId } from '../sim/map';

export const RELAY_YARD_VERSION = 3;
const COLS = 75;
const ROWS = 50;

type Op = { c: number; r: number; w: number; h: number; t: TerrainId };

function build(): GameMap {
  const m = createMap(COLS, ROWS, 32, Terrain.Grass);
  m.id = 'relay-yard';
  m.name = 'Relay Yard';
  m.version = RELAY_YARD_VERSION;
  const ops: Op[] = [];
  const rect = (c: number, r: number, w: number, h: number, t: TerrainId) => ops.push({ c, r, w, h, t });
  const W = Terrain.Wall;
  const B = Terrain.Brush;
  const MUD = Terrain.Mud;
  const RD = Terrain.Road;

  // ---- Ground layers first (roads, mud, brush), walls last ----
  // Spawn yard road and the west trunk road (stops short of the tower compound).
  rect(1, 24, 26, 2, RD);
  // North service road (mirrors to the south road).
  rect(10, 7, 50, 2, RD);
  // West ring road linking north road to the trunk.
  rect(17, 8, 2, 17, RD);
  // Diagonal-ish feeder toward the tower (stepped).
  rect(27, 18, 4, 2, RD);
  rect(29, 20, 3, 2, RD);

  // Depot mud yard
  rect(16, 9, 5, 4, MUD);
  // Broken Bridge ditch: long mud channel in the SW
  rect(10, 37, 24, 3, MUD);
  // Mud wallow near the tower approach
  rect(29, 13, 4, 3, MUD);
  rect(44, 25, 3, 3, MUD);

  // Brush fields
  rect(25, 9, 4, 5, B); // depot east hedge
  rect(9, 17, 4, 4, B); // spawn-side thicket
  rect(34, 12, 7, 3, B); // tower north hedgerow
  rect(12, 34, 5, 2, B); // ditch north bank
  rect(21, 40, 3, 1, B); // ditch south bank (bridge gap)
  rect(30, 31, 3, 4, B); // tower SW scrub
  rect(2, 4, 4, 3, B);   // north-west corner scrub
  rect(46, 18, 3, 3, B); // east lane cover

  // ---- Walls ----
  // Spawn shelter (west base): staggered barriers with multiple exits.
  rect(8, 14, 1, 4, W);
  rect(8, 21, 1, 2, W);
  rect(8, 27, 1, 2, W);
  rect(8, 32, 1, 4, W);
  rect(4, 11, 4, 1, W);
  rect(4, 38, 4, 1, W);

  // Depot warehouses (NW)
  rect(12, 2, 4, 4, W);
  rect(20, 2, 5, 3, W);
  rect(12, 10, 3, 3, W);
  rect(21, 10, 3, 2, W);
  rect(23, 13, 1, 3, W);
  rect(28, 3, 3, 2, W);

  // Broken Bridge: two parapet walls over the ditch with a collapsed gap.
  rect(17, 36, 4, 1, W);
  rect(24, 36, 4, 1, W);
  rect(17, 40, 3, 1, W);
  rect(25, 40, 2, 1, W);
  rect(14, 43, 2, 2, W); // abutment
  rect(30, 43, 2, 3, W);

  // Lane rocks and low cover in the west half
  rect(13, 27, 2, 2, W);
  rect(22, 20, 2, 2, W);
  rect(21, 30, 3, 1, W);
  rect(27, 25, 1, 3, W);
  rect(33, 6, 2, 2, W);
  rect(38, 9, 1, 2, W);
  rect(3, 44, 3, 1, W);
  rect(10, 46, 1, 2, W);

  for (const o of ops) {
    paint(m, o);
    // point-symmetric mirror
    paint(m, { c: COLS - o.c - o.w, r: ROWS - o.r - o.h, w: o.w, h: o.h, t: o.t });
  }

  // ---- Self-symmetric centre: Radio Tower compound ----
  const centre: Op[] = [
    // outer ring (gaps on all four sides and corners)
    { c: 32, r: 19, w: 4, h: 1, t: W },
    { c: 39, r: 19, w: 4, h: 1, t: W },
    { c: 32, r: 30, w: 4, h: 1, t: W },
    { c: 39, r: 30, w: 4, h: 1, t: W },
    { c: 31, r: 21, w: 1, h: 3, t: W },
    { c: 31, r: 26, w: 1, h: 3, t: W },
    { c: 43, r: 21, w: 1, h: 3, t: W },
    { c: 43, r: 26, w: 1, h: 3, t: W },
    // the tower itself
    { c: 36, r: 23, w: 3, h: 4, t: W },
  ];
  for (const o of centre) paint(m, o);
  // a little road apron through the compound
  for (let c = 33; c <= 41; c++) for (const r of [24, 25]) if (tileAt(m, c, r) !== W) setTile(m, c, r, RD);

  // Border
  for (let c = 0; c < COLS; c++) {
    setTile(m, c, 0, W);
    setTile(m, c, ROWS - 1, W);
  }
  for (let r = 0; r < ROWS; r++) {
    setTile(m, 0, r, W);
    setTile(m, COLS - 1, r, W);
  }

  const px = (c: number) => c * 32 + 16;
  const west = [
    { x: px(3), y: px(18) },
    { x: px(3), y: px(24) + 16 },
    { x: px(3), y: px(31) },
    { x: px(6), y: px(15) },
    { x: px(6), y: px(34) },
    { x: px(5), y: px(21) },
  ];
  const east = west.map((p) => ({ x: m.width - p.x, y: m.height - p.y }));
  m.spawns = [west, east];
  m.landmarks = [
    { name: 'Radio Tower', x: px(37), y: px(21) },
    { name: 'Depot', x: px(18), y: px(6) },
    { name: 'Foundry', x: m.width - px(18), y: m.height - px(6) },
    { name: 'Broken Bridge', x: px(22), y: px(39) },
    { name: 'Quarry Cut', x: m.width - px(22), y: m.height - px(39) },
    { name: 'West Gate', x: px(5), y: px(25) },
    { name: 'East Gate', x: m.width - px(5), y: m.height - px(25) },
  ];
  return m;
}

function paint(m: GameMap, o: Op): void {
  for (let r = o.r; r < o.r + o.h; r++) for (let c = o.c; c < o.c + o.w; c++) setTile(m, c, r, o.t);
}

let cached: GameMap | null = null;
/** Returns a fresh copy (callers may not mutate shared tiles). */
export function relayYard(): GameMap {
  cached ??= build();
  return { ...cached, tiles: cached.tiles.slice(), spawns: cached.spawns.map((s) => s.map((p) => ({ ...p }))), landmarks: cached.landmarks.map((l) => ({ ...l })) };
}

export function mapToAscii(m: GameMap): string[] {
  const g = ['.', '=', '~', '"', '#'];
  const out: string[] = [];
  for (let r = 0; r < m.rows; r++) {
    let s = '';
    for (let c = 0; c < m.cols; c++) s += g[m.tiles[r * m.cols + c]!];
    out.push(s);
  }
  for (const [team, list] of m.spawns.entries()) {
    for (const p of list) {
      const r = Math.floor(p.y / 32);
      const c = Math.floor(p.x / 32);
      out[r] = out[r]!.slice(0, c) + String(team) + out[r]!.slice(c + 1);
    }
  }
  return out;
}
