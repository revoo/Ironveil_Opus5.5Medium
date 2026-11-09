import type { Vec } from './math';

export type Team = 0 | 1;

/** Control intent for one tank for one simulation tick. Never carries outcomes. */
export interface TankInput {
  /** Requested world-space movement direction; magnitude is clamped to 1. */
  moveX: number;
  moveY: number;
  /** Desired aim point in world space. */
  aimX: number;
  aimY: number;
  fireHeld: boolean;
  /** At least one press edge occurred since the previous tick. */
  firePressed: boolean;
  /** At least one release edge occurred since the previous tick. */
  fireReleased: boolean;
  cancel: boolean;
  smoke: boolean;
  silent: boolean;
}

export const neutralInput = (aimX = 0, aimY = 0): TankInput => ({
  moveX: 0,
  moveY: 0,
  aimX,
  aimY,
  fireHeld: false,
  firePressed: false,
  fireReleased: false,
  cancel: false,
  smoke: false,
  silent: false,
});

export type WeaponPhase = 'ready' | 'charging' | 'reloading' | 'cancel' | 'vent';

export interface WeaponState {
  phase: WeaponPhase;
  /** Remaining ticks for recovery phases. */
  timer: number;
  /** Elapsed ticks while charging. */
  chargeTicks: number;
  /** Length of the current reload in ticks (heavier shots reload longer). */
  reloadTicks: number;
}

export interface Tank {
  id: number;
  team: Team;
  name: string;
  isBot: boolean;
  pos: Vec;
  prevPos: Vec;
  vel: Vec;
  hull: number;
  turret: number;
  hp: number;
  /** Full health for this tank (missions give garrison tanks less than the default). */
  maxHp: number;
  alive: boolean;
  respawnTick: number;
  protectedUntil: number;
  weapon: WeaponState;
  smokeReadyTick: number;
  silent: boolean;
  quiet: boolean;
  revealUntil: number;
  mudAccum: number;
  lastTrackTick: number;
  lastEngineSoundTick: number;
  lastChargeSoundTick: number;
  kills: number;
  deaths: number;
  damageDealt: number;
  shotsFired: number;
  shotsHit: number;
  lastInput: TankInput;
}

export interface Projectile {
  id: number;
  owner: number;
  team: Team;
  pos: Vec;
  prevPos: Vec;
  vel: Vec;
  charge: number;
  damage: number;
  traveled: number;
  range: number;
}

export interface SmokeCloud {
  id: number;
  team: Team;
  pos: Vec;
  radius: number;
  createdTick: number;
  expiresTick: number;
}

export interface TrackStamp {
  /** Opaque id; not derived from the creating tank. */
  id: number;
  x: number;
  y: number;
  /** Tread axis angle in [0, PI). */
  axis: number;
  expiresTick: number;
}

export type SoundKind = 'engine' | 'charge' | 'shot' | 'smoke' | 'explosion';

export interface SoundEvent {
  kind: SoundKind;
  source: number;
  team: Team;
  pos: Vec;
  radius: number;
}

/** Authority-side events emitted during a tick (unfiltered). */
export type WorldEvent =
  | { type: 'shot'; tank: number; team: Team; pos: Vec; angle: number; charge: number; projectile: number }
  | { type: 'impact'; pos: Vec; kind: 'wall' | 'tank' | 'expire'; charge: number; angle: number; target?: number; projectile: number }
  | { type: 'damage'; target: number; amount: number; from: Vec; hp: number; charge: number; attacker: number }
  | { type: 'death'; tank: number; team: Team; pos: Vec; killer: number; hull: number; turret: number }
  | { type: 'smoke'; cloud: number; tank: number; pos: Vec }
  | { type: 'vent'; tank: number }
  | { type: 'cancel'; tank: number }
  | { type: 'spawn'; tank: number; pos: Vec }
  | { type: 'match'; phase: MatchPhase; winner?: Team | 'draw' };

export type MatchPhase = 'countdown' | 'live' | 'suddenDeath' | 'ended';

export interface MatchState {
  phase: MatchPhase;
  phaseStartTick: number;
  scores: [number, number];
  killTarget: number;
  timeLimitTicks: number;
  liveStartTick: number;
  winner: Team | 'draw' | null;
}
