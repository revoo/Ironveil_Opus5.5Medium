// Coarse sound cues for unseen sources: 8 sectors and a near/far band. No coordinates or ids.
import type { Vec } from './math';
import type { SoundEvent, SoundKind } from './types';
import { TUNING } from './tuning';

export interface SoundCue {
  kind: SoundKind;
  /** 0 = east, increasing clockwise (screen space), 45 degrees each. */
  sector: number;
  band: 'near' | 'far';
}

export function sectorOf(from: Vec, to: Vec): number {
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  const s = Math.round(a / (Math.PI / 4));
  return ((s % 8) + 8) % 8;
}

/** Unit direction at the centre of a sector. */
export function sectorDir(sector: number): Vec {
  const a = (sector * Math.PI) / 4;
  return { x: Math.cos(a), y: Math.sin(a) };
}

export function hearCue(listener: Vec, ev: SoundEvent): SoundCue | null {
  const d = Math.hypot(ev.pos.x - listener.x, ev.pos.y - listener.y);
  if (d > ev.radius) return null;
  return {
    kind: ev.kind,
    sector: sectorOf(listener, ev.pos),
    band: d <= ev.radius * TUNING.sound.nearFraction ? 'near' : 'far',
  };
}
