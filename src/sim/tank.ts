import type { Vec } from './math';
import { neutralInput, type Tank, type Team } from './types';
import { TUNING } from './tuning';

export function createTank(id: number, team: Team, name: string, pos: Vec, isBot: boolean): Tank {
  return {
    id,
    team,
    name,
    isBot,
    pos: { x: pos.x, y: pos.y },
    prevPos: { x: pos.x, y: pos.y },
    vel: { x: 0, y: 0 },
    hull: team === 0 ? 0 : Math.PI,
    turret: team === 0 ? 0 : Math.PI,
    hp: TUNING.tank.maxHp,
    alive: true,
    respawnTick: -1,
    protectedUntil: -1,
    weapon: { phase: 'ready', timer: 0, chargeTicks: 0 },
    smokeReadyTick: 0,
    silent: false,
    quiet: false,
    revealUntil: -1,
    mudAccum: 0,
    lastTrackTick: -999,
    lastEngineSoundTick: -999,
    lastChargeSoundTick: -999,
    kills: 0,
    deaths: 0,
    damageDealt: 0,
    shotsFired: 0,
    shotsHit: 0,
    lastInput: neutralInput(pos.x, pos.y),
  };
}
