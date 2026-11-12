// Responsive, momentum-preserving ("slippery") movement.
//
// WASD requests a world-space direction. Velocity responds immediately: the component along
// the request accelerates (or brakes hard when opposed), while the sideways component decays
// slowly, producing drifts through turns. The hull only rotates *visually* toward the request.
import { angleOf, rotateToward, wrapAngle, type Vec } from './math';
import { Terrain, terrainAt, resolveCircleWalls, type GameMap, type TerrainId } from './map';
import type { Tank, TankInput } from './types';
import { TUNING } from './tuning';

const M = TUNING.movement;

export function terrainProfile(t: TerrainId): { speed: number; grip: number; sound: number } {
  switch (t) {
    case Terrain.Road:
      return TUNING.terrain.road;
    case Terrain.Mud:
      return TUNING.terrain.mud;
    case Terrain.Brush:
      return TUNING.terrain.brush;
    default:
      return TUNING.terrain.grass;
  }
}

/** Normal (non-silent, non-charging) top speed at a location. */
export function terrainTopSpeed(map: GameMap, p: Vec): number {
  return M.maxSpeed * terrainProfile(terrainAt(map, p.x, p.y)).speed;
}

/**
 * Advance one tank's movement for one tick.
 * @param chargeFactor speed multiplier from the weapon charge (1 = not charging).
 */
export function stepMovement(tank: Tank, input: TankInput, map: GameMap, dt: number, chargeFactor: number): void {
  tank.prevPos.x = tank.pos.x;
  tank.prevPos.y = tank.pos.y;

  const prof = terrainProfile(terrainAt(map, tank.pos.x, tank.pos.y));
  const terrainTop = M.maxSpeed * prof.speed;
  tank.silent = input.silent;
  const cap = terrainTop * chargeFactor * (input.silent ? M.silentFactor : 1);

  let mx = Number.isFinite(input.moveX) ? input.moveX : 0;
  let my = Number.isFinite(input.moveY) ? input.moveY : 0;
  const ml = Math.hypot(mx, my);
  const v = tank.vel;
  /** Speed the engine is driving: along the input when there is input, else the whole speed. */
  let driven = -1;

  if (ml > 1e-3) {
    mx /= ml;
    my /= ml;
    const throttle = Math.min(1, ml);
    const target = cap * throttle;
    let vpar = v.x * mx + v.y * my;
    let px = v.x - mx * vpar;
    let py = v.y - my * vpar;
    if (vpar < target) {
      const a = vpar < 0 ? M.brakeAccel : M.accel;
      vpar = Math.min(target, vpar + a * prof.grip * dt);
    } else {
      vpar = Math.max(target, vpar - M.overspeedDecel * dt);
    }
    const pl = Math.hypot(px, py);
    if (pl > 0) {
      const npl = Math.max(0, pl - M.lateralGrip * prof.grip * dt);
      px *= npl / pl;
      py *= npl / pl;
    }
    v.x = mx * vpar + px;
    v.y = my * vpar + py;
    driven = vpar;
    tank.hull = rotateToward(tank.hull, Math.atan2(my, mx), M.hullTurnRate * dt);
  } else {
    const s = Math.hypot(v.x, v.y);
    if (s > 0) {
      const ns = Math.max(0, s - M.coastDecel * prof.grip * dt);
      v.x *= ns / s;
      v.y *= ns / s;
    }
    if (ns2(v) > 15 * 15) tank.hull = rotateToward(tank.hull, angleOf(v), M.hullTurnRate * 0.5 * dt);
  }

  // Overall speed cap when slowed (silent / charging / terrain) — decays, not snaps, so
  // braking into silence is audible for a moment.
  const sp = Math.hypot(v.x, v.y);
  if (sp > cap && ml <= 1e-3) {
    const ns = Math.max(cap, sp - M.overspeedDecel * dt);
    v.x *= ns / sp;
    v.y *= ns / sp;
  }

  // Integrate with substeps so fast motion cannot skip through walls.
  const r = TUNING.tank.radius;
  const totalX = v.x * dt;
  const totalY = v.y * dt;
  const steps = Math.max(1, Math.ceil(Math.hypot(totalX, totalY) / 8));
  for (let i = 0; i < steps; i++) {
    tank.pos.x += totalX / steps;
    tank.pos.y += totalY / steps;
    const normals = resolveCircleWalls(map, tank.pos, r);
    for (const n of normals) {
      const into = v.x * n.x + v.y * n.y;
      if (into < 0) {
        v.x -= n.x * into * (1 + M.wallBounce);
        v.y -= n.y * into * (1 + M.wallBounce);
      }
    }
  }

  // Turret traverse toward the aim point (world-relative; hull rotation does not drag it).
  const desired = Math.atan2(input.aimY - tank.pos.y, input.aimX - tank.pos.x);
  if (Number.isFinite(desired)) tank.turret = rotateToward(tank.turret, desired, M.turretTurnRate * dt);
  tank.turret = wrapAngle(tank.turret);

  // Quiet is judged on the driven speed. In a turn the old heading's momentum slides sideways for a
  // moment and the total speed rises above the silent cap, but that slide is not engine noise: judged
  // on the total, a diagonal turn while silent counted as loud (engine heard, headlights back on).
  const speed = driven >= 0 ? driven : Math.hypot(v.x, v.y);
  tank.quiet = input.silent && speed <= terrainTop * M.silentFactor + 1e-6;
}

function ns2(v: Vec): number {
  return v.x * v.x + v.y * v.y;
}
