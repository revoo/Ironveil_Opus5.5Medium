// Perception rules: range, hard cover, smoke, brush concealment, firing reveal.
import { pointSegmentDistance, type Vec } from './math';
import { raycastWalls, terrainAt, Terrain, type GameMap } from './map';
import type { SmokeCloud, Tank, Team } from './types';
import { TUNING } from './tuning';

const V = TUNING.vision;

export interface SimView {
  map: GameMap;
  smokes: SmokeCloud[];
  tanks: Tank[];
  tick: number;
}

/** Smoke blocks any sight segment that touches its disc, including segments starting inside. */
export function segmentHitsSmoke(a: Vec, b: Vec, smokes: readonly SmokeCloud[]): boolean {
  for (const s of smokes) {
    if (pointSegmentDistance(s.pos, a, b) < s.radius) return true;
  }
  return false;
}

export function sightClear(map: GameMap, smokes: readonly SmokeCloud[], a: Vec, b: Vec): boolean {
  if (segmentHitsSmoke(a, b, smokes)) return false;
  return raycastWalls(map, a.x, a.y, b.x, b.y) === Infinity;
}

export const inBrush = (map: GameMap, p: Vec): boolean => terrainAt(map, p.x, p.y) === Terrain.Brush;

export function canObserveTank(map: GameMap, smokes: readonly SmokeCloud[], observer: Tank, target: Tank, tick: number): boolean {
  if (!observer.alive || !target.alive) return false;
  const d = Math.hypot(target.pos.x - observer.pos.x, target.pos.y - observer.pos.y);
  if (d > V.radius) return false;
  if (!sightClear(map, smokes, observer.pos, target.pos)) return false;
  if (inBrush(map, target.pos) && d > V.brushRadius && target.revealUntil <= tick) return false;
  return true;
}

/** Union of valid individual observations by living members of `team`. */
export function teamVisibleEnemies(view: SimView, team: Team): Set<number> {
  const out = new Set<number>();
  for (const target of view.tanks) {
    if (target.team === team || !target.alive) continue;
    for (const obs of view.tanks) {
      if (obs.team !== team || !obs.alive) continue;
      if (canObserveTank(view.map, view.smokes, obs, target, view.tick)) {
        out.add(target.id);
        break;
      }
    }
  }
  return out;
}

/** Ground / projectile visibility: range and clear line from some living teammate (brush irrelevant). */
export function pointVisibleToTeam(view: SimView, team: Team, p: Vec, extra = 0): boolean {
  const r2 = (V.radius + extra) ** 2;
  for (const obs of view.tanks) {
    if (obs.team !== team || !obs.alive) continue;
    const dx = p.x - obs.pos.x;
    const dy = p.y - obs.pos.y;
    if (dx * dx + dy * dy > r2) continue;
    if (sightClear(view.map, view.smokes, obs.pos, p)) return true;
  }
  return false;
}
