// Mission data format. A mission is plain JSON-compatible data: units placed on a level, objectives,
// and triggers (when <condition> do <actions>). See docs/MISSIONS.md.

export type FlagValue = boolean | number | string;
export type ObjectiveState = 'hidden' | 'active' | 'complete' | 'failed';

/** How a unit behaves while calm. Ids refer to the level's paths and markers. */
export type PostureDef = { patrol: string } | { guard: string } | { hold: string };

export interface UnitDef {
  /** Mission-unique id used by triggers ("gate_guard_west"). */
  id: string;
  /** Callsign shown in radio barks. */
  name: string;
  /** Level marker where it spawns (facing comes from the marker). */
  marker: string;
  /** `simple`: garrison AI. `boss`: the full tactical squad AI. */
  ai: 'simple' | 'boss';
  /** Default: guard its spawn marker. */
  posture?: PostureDef;
  /** 0..1, simple AI only. */
  skill?: number;
  /** Tactical AI persona id, boss only. */
  persona?: string;
}

export interface ObjectiveDef {
  id: string;
  text: string;
  /** Default `active`. Hidden objectives appear when a trigger activates them. */
  state?: ObjectiveState;
}

export type Condition =
  /** `who`: "player" (default), a unit id, or "any-enemy". */
  | { enter: string; who?: string }
  | { destroyed: string | string[] }
  | { playerDestroyed: true }
  | { alarm: true }
  | { flag: string; is?: FlagValue }
  /** Seconds since mission start, or since trigger `since` fired (false until it has). */
  | { after: number; since?: string }
  | { objective: string; is: ObjectiveState }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

export interface ChoiceDef {
  /** Who is asking, e.g. the commander. */
  from?: string;
  prompt: string;
  options: { text: string; do: Action[] }[];
  /** Seconds before the default option is taken. Real time: the game keeps running. Default 12. */
  timeout?: number;
  /** Index taken on timeout. Default 0. */
  default?: number;
}

export type Action =
  | { radio: string; from: string; delay?: number }
  | { setFlag: string; value?: FlagValue }
  | { addFlag: string; by?: number }
  | { objective: string; state: ObjectiveState }
  | { spawn: UnitDef | UnitDef[] }
  | { order: string; posture: PostureDef }
  /** Alarm at a marker/zone id (default: the player's position), optional radius in px. */
  | { alarm: true; at?: string; radius?: number }
  /** Save a checkpoint; the player restarts at this marker. */
  | { checkpoint: string }
  | { choice: ChoiceDef }
  | { end: 'success' | 'failure'; text?: string };

export interface TriggerDef {
  id: string;
  when: Condition;
  do: Action[];
  /** Fire at most once (default true). Repeating triggers re-fire on every rising edge. */
  once?: boolean;
}

export interface MissionDef {
  id: string;
  title: string;
  /** Level id (see src/content/levels). */
  level: string;
  briefing?: string;
  /** Marker tagged player-start used at mission start (default: first player-start marker). */
  start?: string;
  playerName?: string;
  units: UnitDef[];
  objectives: ObjectiveDef[];
  triggers: TriggerDef[];
}
