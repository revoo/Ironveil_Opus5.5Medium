// All gameplay tuning lives here as data. Durations are seconds; the sim converts them
// to whole ticks (rounded up) via `ticks()`. See docs/DECISIONS.md for why values differ
// from the original spec.
import { secondsToTicks } from './math';

export const TUNING = {
  tickHz: 30,

  tank: {
    radius: 20,
    maxHp: 100,
    /** Soft tank-tank separation strength (fraction of overlap resolved per tick). */
    separation: 0.35,
  },

  movement: {
    /** Grass top speed, px/s. */
    maxSpeed: 190,
    /** Acceleration along the requested direction, px/s^2 (~0.33 s to top speed). */
    accel: 580,
    /** Acceleration when the request opposes current velocity (countersteer/brake). */
    brakeAccel: 1150,
    /** Lateral (sideways) velocity decay, px/s^2. Low = long drifts. */
    lateralGrip: 330,
    /** Velocity decay with no input, px/s^2 (coasting). */
    coastDecel: 210,
    /** Decay when above the current speed cap (e.g. entering mud), px/s^2. */
    overspeedDecel: 520,
    /** Visual hull rotation toward requested direction, rad/s. */
    hullTurnRate: (300 * Math.PI) / 180,
    turretTurnRate: (170 * Math.PI) / 180,
    silentFactor: 0.4,
    /** Charging speed factor at full charge (linear from 1.0). */
    chargeSpeedFactor: 0.55,
    wallBounce: 0.15,
  },

  terrain: {
    // speed, grip, engine-sound multiplier
    road: { speed: 1.1, grip: 1.2, sound: 1.0 },
    grass: { speed: 1.0, grip: 1.0, sound: 1.0 },
    mud: { speed: 0.65, grip: 0.7, sound: 1.25 },
    brush: { speed: 0.8, grip: 0.95, sound: 0.75 },
  },

  cannon: {
    chargeTime: 1.5,
    holdAllowance: 1.5,
    damageMin: 22,
    damageMax: 55,
    speedMin: 400,
    speedMax: 750,
    range: 900,
    reload: 0.65,
    cancelRecovery: 0.25,
    ventRecovery: 0.8,
    muzzleDistance: 30,
    shellRadius: 3,
  },

  smoke: {
    cooldown: 18,
    lifetime: 5,
    radius: 100,
  },

  vision: {
    radius: 440,
    brushRadius: 110,
    fireReveal: 1.2,
    lastKnownMarker: 3,
  },

  sound: {
    engine: 300,
    charge: 350,
    shot: 700,
    smoke: 200,
    explosion: 900,
    engineInterval: 0.25,
    nearFraction: 0.5,
  },

  tracks: {
    spacing: 32,
    maxPerSecond: 6,
    lifetime: 12,
    maxStamps: 640,
    fadeStages: 4,
  },

  match: {
    countdown: 3,
    respawn: 5,
    spawnProtection: 2,
    killTarget: 15,
    timeLimit: 8 * 60,
    suddenDeath: 60,
  },
} as const;

export type Tuning = typeof TUNING;

export const DT = 1 / TUNING.tickHz;
export const ticks = (seconds: number): number => secondsToTicks(seconds, TUNING.tickHz);
