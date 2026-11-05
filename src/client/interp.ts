// Pure interpolation helpers between consecutive fixed-tick observations.
import { lerp, lerpAngle, type Vec } from '../sim/math';
import type { TankView } from '../sim/observation';
import { DT } from '../sim/tuning';

/** Above this jump between ticks a tank is treated as newly revealed/respawned: no lerp. */
export const SNAP_DISTANCE = 60;

export interface TankPose {
  x: number;
  y: number;
  hull: number;
  turret: number;
}

export function interpolateTank(prev: TankView | undefined, cur: TankView, alpha: number): TankPose {
  if (!prev || !prev.alive || !cur.alive || Math.hypot(prev.x - cur.x, prev.y - cur.y) >= SNAP_DISTANCE) {
    return { x: cur.x, y: cur.y, hull: cur.hull, turret: cur.turret };
  }
  return {
    x: lerp(prev.x, cur.x, alpha),
    y: lerp(prev.y, cur.y, alpha),
    hull: lerpAngle(prev.hull, cur.hull, alpha),
    turret: lerpAngle(prev.turret, cur.turret, alpha),
  };
}

/** Shells fly in straight lines: back-project from the latest authorised state (exact). */
export function shellRenderPos(p: { x: number; y: number; vx: number; vy: number }, alpha: number): Vec {
  return { x: p.x - p.vx * DT * (1 - alpha), y: p.y - p.vy * DT * (1 - alpha) };
}
