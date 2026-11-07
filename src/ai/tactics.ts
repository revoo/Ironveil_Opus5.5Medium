// Tactical position search: firing spots, cover and flank angles. (Search spots live in bot.ts.)
// Uses only static map geometry and *known* smoke clouds.
import { pointSegmentDistance, type Vec } from '../sim/math';
import { raycastWalls, terrainAt, Terrain, type GameMap } from '../sim/map';
import type { SmokeView } from '../sim/observation';
import type { NavGrid } from './nav';
import type { Rng } from '../sim/rng';

export interface TacCtx {
  map: GameMap;
  nav: NavGrid;
  smokes: SmokeView[];
}

export function los(ctx: TacCtx, a: Vec, b: Vec): boolean {
  for (const s of ctx.smokes) if (pointSegmentDistance({ x: s.x, y: s.y }, a, b) < s.radius) return false;
  return raycastWalls(ctx.map, a.x, a.y, b.x, b.y) === Infinity;
}

export function wallLos(map: GameMap, a: Vec, b: Vec): boolean {
  return raycastWalls(map, a.x, a.y, b.x, b.y) === Infinity;
}

const RADII = [0, 40, 80, 125, 175, 230, 290, 350, 420];

export function candidates(nav: NavGrid, centre: Vec, maxR = 420, step = 16): Vec[] {
  const out: Vec[] = [];
  for (const r of RADII) {
    if (r > maxR) break;
    const n = r === 0 ? 1 : Math.max(8, Math.round((2 * Math.PI * r) / 70));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r * 0.013;
      const p = { x: centre.x + Math.cos(a) * r, y: centre.y + Math.sin(a) * r };
      if (p.x < 0 || p.y < 0 || p.x > nav.map.width || p.y > nav.map.height) continue;
      if (nav.isWalkable(p)) out.push(p);
    }
  }
  void step;
  return out;
}

/** Cover available within a short hop (a nearby point hidden from `threat`). */
function coverNear(ctx: TacCtx, p: Vec, threat: Vec): boolean {
  for (let a = 0; a < 8; a++) {
    const q = { x: p.x + Math.cos((a * Math.PI) / 4) * 56, y: p.y + Math.sin((a * Math.PI) / 4) * 56 };
    if (ctx.nav.isWalkable(q) && !wallLos(ctx.map, threat, q)) return true;
  }
  return false;
}

export interface FiringOpts {
  from: Vec;
  preferredRange: number;
  otherThreats: Vec[];
  claimed: Vec[];
  /** Unit vector from target toward the friendly pressure axis; flank spots must deviate from it. */
  flankAxis?: Vec;
  flankMinAngle?: number;
  maxTravel?: number;
  brushBonus?: number;
}

export function findFiringSpot(ctx: TacCtx, target: Vec, o: FiringOpts): Vec | null {
  let best: Vec | null = null;
  let bestS = -Infinity;
  const centre = o.flankAxis ? target : { x: (o.from.x + target.x) / 2, y: (o.from.y + target.y) / 2 };
  const maxTravel = o.maxTravel ?? 700;
  for (const p of candidates(ctx.nav, centre, 420)) {
    const d = Math.hypot(p.x - target.x, p.y - target.y);
    if (d < 140 || d > 600) continue;
    const travel = Math.hypot(p.x - o.from.x, p.y - o.from.y);
    if (travel > maxTravel) continue;
    if (o.flankAxis) {
      const ux = (p.x - target.x) / d;
      const uy = (p.y - target.y) / d;
      const ang = Math.acos(Math.max(-1, Math.min(1, ux * o.flankAxis.x + uy * o.flankAxis.y)));
      if (ang < (o.flankMinAngle ?? 1)) continue;
    }
    if (!los(ctx, p, target)) continue;
    let s = -Math.abs(d - o.preferredRange) / 160 - travel / 300;
    for (const t of o.otherThreats) if (Math.hypot(t.x - p.x, t.y - p.y) < 480 && wallLos(ctx.map, t, p)) s -= 0.7;
    if (coverNear(ctx, p, target)) s += 0.6;
    if (terrainAt(ctx.map, p.x, p.y) === Terrain.Brush) s += o.brushBonus ?? 0.2;
    if (terrainAt(ctx.map, p.x, p.y) === Terrain.Mud) s -= 0.3;
    for (const c of o.claimed) if (Math.hypot(c.x - p.x, c.y - p.y) < 110) s -= 0.9;
    if (s > bestS) {
      bestS = s;
      best = p;
    }
  }
  return best;
}

export interface CoverOpts {
  from: Vec;
  maxTravel?: number;
  claimed: Vec[];
  preferBrush?: number;
  /** Prefer spots farther from threats (retreat) instead of nearest cover. */
  retreat?: boolean;
}

export function findCoverSpot(ctx: TacCtx, threats: Vec[], o: CoverOpts): Vec | null {
  if (threats.length === 0) return null;
  let best: Vec | null = null;
  let bestS = -Infinity;
  const maxTravel = o.maxTravel ?? 360;
  for (const p of candidates(ctx.nav, o.from, Math.min(420, maxTravel))) {
    let hidden = true;
    let minD = Infinity;
    for (const t of threats) {
      minD = Math.min(minD, Math.hypot(t.x - p.x, t.y - p.y));
      if (los(ctx, t, p)) {
        hidden = false;
        break;
      }
    }
    if (!hidden) continue;
    const travel = Math.hypot(p.x - o.from.x, p.y - o.from.y);
    let s = -travel / 140;
    if (o.retreat) s += Math.min(minD, 700) / 250;
    else if (minD < 160) s -= 1;
    if (terrainAt(ctx.map, p.x, p.y) === Terrain.Brush) s += o.preferBrush ?? 0.3;
    if (terrainAt(ctx.map, p.x, p.y) === Terrain.Mud) s -= 0.4;
    // Must not require running straight past the threat.
    for (const t of threats) if (Math.hypot(t.x - p.x, t.y - p.y) < Math.hypot(t.x - o.from.x, t.y - o.from.y) - 120) s -= 1.5;
    for (const c of o.claimed) if (Math.hypot(c.x - p.x, c.y - p.y) < 90) s -= 0.8;
    if (s > bestS) {
      bestS = s;
      best = p;
    }
  }
  return best;
}

/** How far a hidden tank is assumed to be able to get per second (a little under top speed). */
const SPREAD_SPEED = 170;
const MAX_HYPOTHESES = 160;

/**
 * Where a lost contact could plausibly be now: hull-reachable ground within the distance it could
 * have covered since it was last seen, minus every spot a living teammate can currently see is
 * empty ("negative evidence"). Brush beyond 110 px of an observer is never ruled out, because a
 * tank there would not be visible. Uses only memory, static geometry, known smoke and teammates.
 */
export function possiblePositions(ctx: TacCtx, last: Vec, ageTicks: number, observers: Vec[]): Vec[] {
  const radius = Math.min(560, 40 + (ageTicks / 30) * SPREAD_SPEED);
  const pts = ctx.nav.reachableLattice(last, radius);
  const vision = 440;
  const brushVision = 110;
  const out = pts.filter((p) => {
    const brush = terrainAt(ctx.map, p.x, p.y) === Terrain.Brush;
    for (const o of observers) {
      const d = Math.hypot(p.x - o.x, p.y - o.y);
      if (d > vision || (brush && d > brushVision)) continue;
      if (los(ctx, o, p)) return false;
    }
    return true;
  });
  if (out.length <= MAX_HYPOTHESES) return out;
  const stride = out.length / MAX_HYPOTHESES;
  return Array.from({ length: MAX_HYPOTHESES }, (_, i) => out[Math.floor(i * stride)]!);
}

/** Pick well-separated places worth checking from the possible positions. */
export function chooseSearchSpots(ctx: TacCtx, possible: Vec[], last: Vec, heading: Vec | null, from: Vec, claimed: Vec[], rng: Rng, count: number): Vec[] {
  const scored = possible.map((p) => {
    let s = rng.next() * 0.4 - Math.hypot(p.x - from.x, p.y - from.y) / 700;
    if (terrainAt(ctx.map, p.x, p.y) === Terrain.Brush) s += 0.7;
    if (heading) {
      const dx = p.x - last.x;
      const dy = p.y - last.y;
      const l = Math.hypot(dx, dy) || 1;
      s += ((dx * heading.x + dy * heading.y) / l) * 0.6;
    }
    for (const c of claimed) if (Math.hypot(c.x - p.x, c.y - p.y) < 160) s -= 1;
    return { p, s };
  });
  scored.sort((a, b) => b.s - a.s);
  const out: Vec[] = [];
  for (const c of scored) {
    if (out.length >= count) break;
    if (out.every((q) => Math.hypot(q.x - c.p.x, q.y - c.p.y) > 140)) out.push(c.p);
  }
  return out;
}

/** True when a living teammate can currently see that a spot is empty. */
export function clearedByTeam(ctx: TacCtx, p: Vec, observers: Vec[]): boolean {
  const brush = terrainAt(ctx.map, p.x, p.y) === Terrain.Brush;
  return observers.some((o) => {
    const d = Math.hypot(p.x - o.x, p.y - o.y);
    return d <= (brush ? 110 : 440) && los(ctx, o, p);
  });
}

export function nearestLandmarkName(map: GameMap, p: Vec): string {
  let best = '';
  let bd = Infinity;
  for (const l of map.landmarks) {
    const d = Math.hypot(l.x - p.x, l.y - p.y);
    if (d < bd) {
      bd = d;
      best = l.name;
    }
  }
  return best;
}
