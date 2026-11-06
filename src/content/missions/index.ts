// Mission registry. Missions and levels are JSON; MissionSession validates them when it starts,
// and tests/greybox.test.ts validates every entry here.
import type { MissionDef } from '../../game/mission/types';
import type { LevelData } from '../../level/format';
import greyboxMission from './greybox-crossing.json';
import greyboxLevel from '../levels/greybox-crossing.json';

export interface MissionEntry {
  mission: MissionDef;
  level: LevelData;
}

// JSON imports widen string literals, so they are cast here and checked at runtime instead.
export const MISSIONS: MissionEntry[] = [{ mission: greyboxMission as unknown as MissionDef, level: greyboxLevel as unknown as LevelData }];

export function missionById(id: string): MissionEntry | undefined {
  return MISSIONS.find((m) => m.mission.id === id);
}
