// LDtk project -> Ironveil LevelData. See docs/LEVELS.md for the expected project setup:
//
//   IntGrid layer "Terrain"   values 1 grass, 2 road, 3 mud, 4 brush, 5 wall (0/empty = grass)
//   Entity layer  "Entities"  entities Marker, Zone, Path, Prop (fields below)
//
//   Marker  point   fields: id (String), tags (String, comma separated, or Array<String>), facing (Int/Float, degrees)
//   Zone    resizable rectangle   fields: id, tags
//   Path    point   fields: id, points (Array<Point>), loop (Bool). The entity itself is the first point.
//   Prop    resizable rectangle   fields: kind (String or Enum), height (Int/Float), rotation (Int/Float)
//
// Only the parts of the LDtk JSON we read are typed; everything else is ignored.
import { LEVEL_FORMAT, LEVEL_FORMAT_VERSION, type LevelData, type LevelMarker, type LevelPath, type LevelProp, type LevelZone } from './format';

interface LdtkField {
  __identifier: string;
  __type: string;
  __value: unknown;
}
interface LdtkEntity {
  __identifier: string;
  iid?: string;
  px: [number, number];
  __pivot?: [number, number];
  width: number;
  height: number;
  fieldInstances: LdtkField[];
}
interface LdtkLayer {
  __identifier: string;
  __type: string;
  __gridSize: number;
  __cWid: number;
  __cHei: number;
  intGridCsv?: number[];
  entityInstances?: LdtkEntity[];
}
interface LdtkLevel {
  identifier: string;
  pxWid: number;
  pxHei: number;
  layerInstances: LdtkLayer[] | null;
}
export interface LdtkProject {
  levels: LdtkLevel[];
}

const TERRAIN_GLYPH: Record<number, string> = { 0: '.', 1: '.', 2: '=', 3: '~', 4: '"', 5: '#' };

export class LdtkImportError extends Error {}

function field(e: LdtkEntity, name: string): unknown {
  return e.fieldInstances.find((f) => f.__identifier === name)?.__value ?? undefined;
}
function str(e: LdtkEntity, name: string): string | undefined {
  const v = field(e, name);
  return v === null || v === undefined ? undefined : String(v);
}
function num(e: LdtkEntity, name: string): number | undefined {
  const v = field(e, name);
  return typeof v === 'number' ? v : undefined;
}
function tags(e: LdtkEntity): string[] | undefined {
  const v = field(e, 'tags');
  const list = Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(',') : [];
  const clean = list.map((t) => t.trim()).filter(Boolean);
  return clean.length ? clean : undefined;
}
function topLeft(e: LdtkEntity): { x: number; y: number } {
  const [px, py] = e.__pivot ?? [0, 0];
  return { x: e.px[0] - px * e.width, y: e.px[1] - py * e.height };
}

/**
 * Convert one level of an LDtk project. `levelId` defaults to the first level.
 * `id`/`version` set the Ironveil level identity (LDtk level identifiers are often "Level_0").
 */
export function ldtkToLevel(project: LdtkProject, opts: { levelId?: string; id?: string; name?: string; version?: number } = {}): LevelData {
  const lvl = opts.levelId ? project.levels.find((l) => l.identifier === opts.levelId) : project.levels[0];
  if (!lvl) throw new LdtkImportError(`no LDtk level "${opts.levelId ?? '(first)'}"`);
  const layers = lvl.layerInstances ?? [];
  const terrainLayer = layers.find((l) => l.__identifier === 'Terrain' && l.__type === 'IntGrid');
  if (!terrainLayer?.intGridCsv) throw new LdtkImportError(`level "${lvl.identifier}" has no IntGrid layer named "Terrain"`);
  const { __cWid: cols, __cHei: rows, __gridSize: tile, intGridCsv } = terrainLayer;
  const terrain: string[] = [];
  for (let r = 0; r < rows; r++) {
    let row = '';
    for (let c = 0; c < cols; c++) {
      const v = intGridCsv[r * cols + c] ?? 0;
      const g = TERRAIN_GLYPH[v];
      if (g === undefined) throw new LdtkImportError(`Terrain value ${v} at col ${c}, row ${r} is not one of 1-5`);
      row += g;
    }
    terrain.push(row);
  }

  const markers: LevelMarker[] = [];
  const zones: LevelZone[] = [];
  const paths: LevelPath[] = [];
  const props: LevelProp[] = [];
  const entities = layers.find((l) => l.__identifier === 'Entities' && l.__type === 'Entities')?.entityInstances ?? [];
  for (const e of entities) {
    const tl = topLeft(e);
    const centre = { x: tl.x + e.width / 2, y: tl.y + e.height / 2 };
    const id = str(e, 'id') ?? '';
    switch (e.__identifier) {
      case 'Marker': {
        const m: LevelMarker = { id, x: centre.x, y: centre.y };
        const f = num(e, 'facing');
        if (f !== undefined) m.facing = f;
        const t = tags(e);
        if (t) m.tags = t;
        markers.push(m);
        break;
      }
      case 'Zone': {
        const z: LevelZone = { id, x: tl.x, y: tl.y, w: e.width, h: e.height };
        const t = tags(e);
        if (t) z.tags = t;
        zones.push(z);
        break;
      }
      case 'Path': {
        const pts = field(e, 'points');
        const extra = Array.isArray(pts) ? (pts as { cx: number; cy: number }[]).map((q) => ({ x: (q.cx + 0.5) * tile, y: (q.cy + 0.5) * tile })) : [];
        const p: LevelPath = { id, points: [centre, ...extra] };
        if (field(e, 'loop') === true) p.loop = true;
        paths.push(p);
        break;
      }
      case 'Prop': {
        const p: LevelProp = { kind: str(e, 'kind') ?? 'prop', x: tl.x, y: tl.y, w: e.width, h: e.height };
        const h = num(e, 'height');
        if (h !== undefined) p.height = h;
        const r = num(e, 'rotation');
        if (r !== undefined) p.rotation = r;
        props.push(p);
        break;
      }
      default:
        throw new LdtkImportError(`unknown entity "${e.__identifier}" (expected Marker, Zone, Path or Prop)`);
    }
  }
  return {
    format: LEVEL_FORMAT,
    formatVersion: LEVEL_FORMAT_VERSION,
    id: opts.id ?? lvl.identifier,
    version: opts.version ?? 1,
    name: opts.name ?? lvl.identifier,
    tile,
    terrain,
    markers,
    zones,
    paths,
    props,
  };
}
