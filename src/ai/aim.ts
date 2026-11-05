import type { Vec } from '../sim/math';

/**
 * Point where a shell fired now from `shooter` (leaving `muzzle` px ahead) meets a target moving
 * at constant velocity. Falls back to the target's current position when no solution exists.
 */
export function interceptPoint(shooter: Vec, target: Vec, vel: Vec, shellSpeed: number, muzzle = 30): Vec {
  const dx = target.x - shooter.x;
  const dy = target.y - shooter.y;
  // |d + v t| = muzzle + w t
  const a = vel.x * vel.x + vel.y * vel.y - shellSpeed * shellSpeed;
  const b = 2 * (dx * vel.x + dy * vel.y) - 2 * muzzle * shellSpeed;
  const c = dx * dx + dy * dy - muzzle * muzzle;
  let t: number;
  if (Math.abs(a) < 1e-9) {
    t = Math.abs(b) > 1e-9 ? -c / b : -1;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return { x: target.x, y: target.y };
    const s = Math.sqrt(disc);
    const t1 = (-b - s) / (2 * a);
    const t2 = (-b + s) / (2 * a);
    t = Math.min(t1, t2) > 0 ? Math.min(t1, t2) : Math.max(t1, t2);
  }
  if (!(t > 0) || t > 3) return { x: target.x, y: target.y };
  return { x: target.x + vel.x * t, y: target.y + vel.y * t };
}
