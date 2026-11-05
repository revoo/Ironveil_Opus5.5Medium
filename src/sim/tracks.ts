// Short-lived mud track stamps: the only persistent tactical decal. No owner identity.
import { Rng } from './rng';
import { Terrain, terrainAt, type GameMap } from './map';
import type { Tank, TrackStamp } from './types';
import { TUNING, ticks } from './tuning';

const T = TUNING.tracks;
export const TRACK_LIFETIME_TICKS = ticks(T.lifetime);
const MIN_INTERVAL = Math.ceil(TUNING.tickHz / T.maxPerSecond);

export class TrackStore {
  stamps: TrackStamp[] = [];
  private rng: Rng;
  private used = new Set<number>();

  constructor(seed: number) {
    this.rng = new Rng(seed ^ 0x5eed7a4c);
  }

  add(x: number, y: number, axis: number, expiresTick: number): TrackStamp {
    let id = 0;
    do id = Math.floor(this.rng.next() * 0x7fffffff) + 1000;
    while (this.used.has(id));
    this.used.add(id);
    let a = axis % Math.PI;
    if (a < 0) a += Math.PI;
    const s: TrackStamp = { id, x, y, axis: a, expiresTick };
    this.stamps.push(s);
    while (this.stamps.length > T.maxStamps) this.evict(0);
    return s;
  }

  expire(tick: number): void {
    let i = 0;
    while (i < this.stamps.length) {
      if (this.stamps[i]!.expiresTick <= tick) this.evict(i);
      else i++;
    }
  }

  private evict(i: number): void {
    const [s] = this.stamps.splice(i, 1);
    if (s) this.used.delete(s.id);
  }
}

export function updateTankTracks(tank: Tank, map: GameMap, store: TrackStore, tick: number): void {
  if (!tank.alive) return;
  if (terrainAt(map, tank.pos.x, tank.pos.y) !== Terrain.Mud) {
    tank.mudAccum = 0;
    return;
  }
  const d = Math.hypot(tank.pos.x - tank.prevPos.x, tank.pos.y - tank.prevPos.y);
  tank.mudAccum = Math.min(tank.mudAccum + d, T.spacing * 2);
  if (tank.mudAccum >= T.spacing && tick - tank.lastTrackTick >= MIN_INTERVAL) {
    tank.mudAccum -= T.spacing;
    tank.lastTrackTick = tick;
    const axis = Math.hypot(tank.vel.x, tank.vel.y) > 1 ? Math.atan2(tank.vel.y, tank.vel.x) : tank.hull;
    store.add(tank.pos.x, tank.pos.y, axis, tick + TRACK_LIFETIME_TICKS);
  }
}
