// Bot perception memory. Built ONLY from the team Observation (shared team vision, stale
// markers, coarse sound cues for this bot, observed tracks, own damage events).
import type { Observation, TankView } from '../sim/observation';
import { sectorDir } from '../sim/sound';
import type { Rng } from '../sim/rng';
import type { DifficultyProfile, Traits } from './personality';
import { TUNING } from '../sim/tuning';

export interface Contact {
  id: number;
  x: number;
  y: number;
  /** Perceived (noisy) velocity. */
  vx: number;
  vy: number;
  hp: number;
  visible: boolean;
  firstSeen: number;
  lastSeen: number;
  /** Tick from which the bot has "registered" this sighting (reaction delay). */
  noticedAt: number;
  phase: TankView['phase'];
  charge: number;
  turret: number;
  /** Persistent per-acquisition velocity perception bias. */
  biasX: number;
  biasY: number;
  searched: boolean;
}

export type DisturbanceKind = 'sound' | 'track' | 'damage' | 'lost';

export interface Disturbance {
  id: number;
  kind: DisturbanceKind;
  x: number;
  y: number;
  tick: number;
  priority: number;
  resolved: boolean;
  /** Sound band hint (near cues suggest an imminent threat). */
  near: boolean;
  /** Most recent sound kind that fed this hypothesis (if any). */
  cue: string | null;
}

export interface ShellTrack {
  id: number;
  firstSeen: number;
  decided: boolean;
}

const SOUND_PRIORITY: Record<string, number> = { shot: 0.85, charge: 0.75, engine: 0.55, smoke: 0.45, explosion: 0.35 };

export class BotMemory {
  contacts = new Map<number, Contact>();
  disturbances: Disturbance[] = [];
  shells = new Map<number, ShellTrack>();
  underFireUntil = -1;
  lastHitFrom: { x: number; y: number; tick: number } | null = null;
  private seenTracks = new Set<number>();
  private nextId = 1;

  constructor(
    readonly selfId: number,
    private diff: DifficultyProfile,
    private traits: Traits,
    private rng: Rng,
  ) {}

  contact(id: number): Contact | undefined {
    return this.contacts.get(id);
  }

  reactionTicks(alerted: boolean): number {
    const [lo, hi] = this.diff.reactionMs;
    let ms = lo + (hi - lo) * this.rng.next();
    if (alerted) ms *= 0.7;
    return Math.max(1, Math.round((ms / 1000) * TUNING.tickHz));
  }

  update(obs: Observation, self: TankView): void {
    const tick = obs.tick;
    const alerted = tick < this.underFireUntil;
    const seen = new Set<number>();
    for (const t of obs.tanks) {
      if (t.team === self.team || !t.alive) continue;
      seen.add(t.id);
      let c = this.contacts.get(t.id);
      const reacquired = !c || !c.visible;
      const isNew = !c;
      if (!c) {
        c = {
          id: t.id, x: t.x, y: t.y, vx: 0, vy: 0, hp: t.hp, visible: true, firstSeen: tick, lastSeen: tick,
          noticedAt: tick, phase: t.phase, charge: t.charge, turret: t.turret, biasX: 0, biasY: 0, searched: false,
        };
        this.contacts.set(t.id, c);
      }
      if (reacquired) {
        // A contact re-acquired within a moment of losing it is tracked continuously.
        const continuity = !isNew && tick - c.lastSeen <= 6 && c.noticedAt <= c.lastSeen;
        c.noticedAt = continuity ? tick : tick + this.reactionTicks(alerted);
        c.firstSeen = tick;
        c.biasX = this.rng.gauss() * this.diff.velNoise;
        c.biasY = this.rng.gauss() * this.diff.velNoise;
      }
      c.visible = true;
      c.x = t.x;
      c.y = t.y;
      const sp = Math.hypot(t.vx, t.vy);
      c.vx = t.vx + c.biasX * sp;
      c.vy = t.vy + c.biasY * sp;
      c.hp = t.hp;
      c.lastSeen = tick;
      c.phase = t.phase;
      c.charge = t.charge;
      c.turret = t.turret;
      c.searched = false;
    }
    const memTicks = this.diff.memorySec * TUNING.tickHz;
    for (const c of this.contacts.values()) {
      if (seen.has(c.id)) continue;
      if (c.visible) {
        c.visible = false;
        this.addDisturbance('lost', c.x + c.vx * 0.6, c.y + c.vy * 0.6, tick, 0.7, false);
      }
      if (tick - c.lastSeen > memTicks) this.contacts.delete(c.id);
    }
    // Dead enemies seen dying are forgotten.
    for (const e of obs.events) if (e.type === 'death' && e.team !== self.team) this.contacts.delete(e.tank);

    // Sound cues (coarse): place a hypothesis along the sector with jitter.
    const cues = obs.sounds[this.selfId] ?? [];
    for (const cue of cues) {
      const radius = cue.kind === 'shot' ? TUNING.sound.shot : cue.kind === 'charge' ? TUNING.sound.charge : cue.kind === 'smoke' ? TUNING.sound.smoke : cue.kind === 'explosion' ? TUNING.sound.explosion : TUNING.sound.engine;
      const frac = cue.band === 'near' ? 0.3 : 0.72;
      const ang = Math.atan2(sectorDir(cue.sector).y, sectorDir(cue.sector).x) + (this.rng.next() - 0.5) * (Math.PI / 4);
      const d = radius * frac * (0.8 + this.rng.next() * 0.4);
      this.addDisturbance('sound', self.x + Math.cos(ang) * d, self.y + Math.sin(ang) * d, tick, SOUND_PRIORITY[cue.kind] ?? 0.4, cue.band === 'near', cue.kind);
    }

    // Tracks: newly observed stamps suggest a route.
    let freshest: { x: number; y: number; stage: number } | null = null;
    for (const tr of obs.tracks) {
      if (this.seenTracks.has(tr.id)) continue;
      this.seenTracks.add(tr.id);
      if (Math.hypot(tr.x - self.x, tr.y - self.y) < 60) continue; // probably ours / a teammate's
      if (!freshest || tr.stage > freshest.stage) freshest = tr;
    }
    if (freshest && freshest.stage >= 2) this.addDisturbance('track', freshest.x, freshest.y, tick, 0.25 + freshest.stage * 0.08, false);
    if (this.seenTracks.size > 2000) this.seenTracks.clear();

    // Damage on self: strong alert in the incoming direction.
    for (const e of obs.events) {
      if (e.type === 'damage' && e.target === this.selfId) {
        this.underFireUntil = tick + 90;
        this.lastHitFrom = { x: e.fromX, y: e.fromY, tick };
        const dx = e.fromX - self.x;
        const dy = e.fromY - self.y;
        const l = Math.hypot(dx, dy) || 1;
        this.addDisturbance('damage', self.x + (dx / l) * 380, self.y + (dy / l) * 380, tick, 1, true);
      }
    }

    // Visible enemy shells.
    const live = new Set<number>();
    for (const p of obs.projectiles) {
      if (p.team === self.team) continue;
      live.add(p.id);
      if (!this.shells.has(p.id)) this.shells.set(p.id, { id: p.id, firstSeen: tick, decided: false });
    }
    for (const id of this.shells.keys()) if (!live.has(id)) this.shells.delete(id);

    // Age out disturbances.
    this.disturbances = this.disturbances.filter((d) => !d.resolved && tick - d.tick < 30 * 14);
  }

  addDisturbance(kind: DisturbanceKind, x: number, y: number, tick: number, priority: number, near: boolean, cue: string | null = null): void {
    for (const d of this.disturbances) {
      if (Math.hypot(d.x - x, d.y - y) < 220) {
        // Merge: newer evidence nudges the estimate and refreshes it.
        d.x = d.x * 0.5 + x * 0.5;
        d.y = d.y * 0.5 + y * 0.5;
        d.tick = tick;
        d.priority = Math.min(1, Math.max(d.priority, priority) + 0.02);
        d.near ||= near;
        if (cue) d.cue = cue;
        d.resolved = false;
        if (kind === 'damage') d.kind = 'damage';
        return;
      }
    }
    this.disturbances.push({ id: this.nextId++, kind, x, y, tick, priority, resolved: false, near, cue });
    if (this.disturbances.length > 12) this.disturbances.sort((a, b) => b.tick - a.tick).length = 12;
  }

  acknowledged(tick: number): Contact[] {
    return [...this.contacts.values()].filter((c) => c.visible && tick >= c.noticedAt);
  }

  /** Remembered but not currently visible contacts that haven't been searched. */
  lost(): Contact[] {
    return [...this.contacts.values()].filter((c) => !c.visible && !c.searched);
  }

  /** Disturbance with highest priority adjusted for freshness and distance. */
  bestDisturbance(x: number, y: number, tick: number, exclude: (d: Disturbance) => boolean = () => false): Disturbance | null {
    let best: Disturbance | null = null;
    let bestS = 0;
    for (const d of this.disturbances) {
      if (d.resolved || exclude(d)) continue;
      const age = (tick - d.tick) / 30;
      const s = d.priority * Math.max(0, 1 - age / 14) * (1 - Math.min(0.5, Math.hypot(d.x - x, d.y - y) / 3000));
      if (s > bestS) {
        bestS = s;
        best = d;
      }
    }
    return best;
  }

  resolveNear(x: number, y: number, r: number): void {
    for (const d of this.disturbances) if (Math.hypot(d.x - x, d.y - y) < r) d.resolved = true;
  }

  disturbanceScore(d: Disturbance, tick: number): number {
    const age = (tick - d.tick) / 30;
    return d.priority * Math.max(0, 1 - age / 14);
  }

  get traitsRef(): Traits {
    return this.traits;
  }
}
