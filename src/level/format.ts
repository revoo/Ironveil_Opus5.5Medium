// The Ironveil level format: plain data, authored in LDtk (see docs/LEVELS.md) or by hand.
// Coordinates are world pixels with y pointing down. Facing is in degrees, 0 = east, 90 = south.
//
// Gameplay reads terrain, markers, zones and paths. Props are presentation only (heights for the
// 3D renderer, set dressing); anything that blocks movement or sight must be a wall tile.

export const LEVEL_FORMAT = 'ironveil-level';
export const LEVEL_FORMAT_VERSION = 1;

export interface LevelMarker {
  id: string;
  x: number;
  y: number;
  /** Degrees, 0 = east, clockwise (screen space). */
  facing?: number;
  /** Free-form tags. Recognised: `player-start`, `enemy-spawn`, `landmark`, `checkpoint`. */
  tags?: string[];
}

export interface LevelZone {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  tags?: string[];
}

export interface LevelPath {
  id: string;
  points: { x: number; y: number }[];
  /** Loop back to the first point (patrol circuit) or ping-pong (default). */
  loop?: boolean;
}

export interface LevelProp {
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** World units above the ground, for the 3D renderer. */
  height?: number;
  /** Degrees. */
  rotation?: number;
}

export interface LevelData {
  format: typeof LEVEL_FORMAT;
  formatVersion: number;
  id: string;
  version: number;
  name: string;
  /** Pixels per terrain tile. */
  tile: number;
  /**
   * One string per row, one glyph per tile:
   * `.` grass  `=` road  `~` mud  `"` brush  `#` wall (blocks movement, sight and shells).
   */
  terrain: string[];
  markers: LevelMarker[];
  zones: LevelZone[];
  paths: LevelPath[];
  props: LevelProp[];
}
