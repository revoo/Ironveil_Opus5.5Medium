// The surface the client needs from any playable session (deathmatch LocalSession or MissionSession).
import type { GameMap } from '../sim/map';
import type { Observation } from '../sim/observation';
import type { SoundCue } from '../sim/sound';
import type { TankInput, Team } from '../sim/types';
import type { World } from '../sim/world';
import type { RadioLine } from '../ai/controller';
import type { TimedEvent } from './session';
import type { TrainingTracker } from './training';

export interface PlayableSession {
  readonly playerId: number;
  world: World;
  map: GameMap;
  obs: Observation;
  prevObs: Observation;
  paused: boolean;
  needsFreshInput: boolean;
  training: TrainingTracker | null;
  readonly alpha: number;
  readonly radio: RadioLine[];
  pause(): void;
  resume(): void;
  restart(newSeed?: boolean): void;
  botInfo(id: number): { persona: string; team: Team } | undefined;
  advance(dt: number, sample: () => TankInput): number;
  drainEvents(): TimedEvent[];
  drainCues(): { tick: number; cue: SoundCue }[];
}
