// Per-team information boundary. Everything a client renders and everything a bot decides on
// comes from an Observation built here; hidden live state never crosses this line.
import { hearCue, type SoundCue } from './sound';
import { inBrush, pointVisibleToTeam, teamVisibleEnemies, type SimView } from './vision';
import { chargeFraction, holdRemaining } from './weapon';
import { TRACK_LIFETIME_TICKS } from './tracks';
import type {
  MatchState,
  Projectile,
  SoundEvent,
  Team,
  TrackStamp,
  WeaponPhase,
  WorldEvent,
} from './types';
import { TUNING, ticks } from './tuning';

export interface TankView {
  id: number;
  team: Team;
  name: string;
  isBot: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hull: number;
  turret: number;
  hp: number;
  alive: boolean;
  phase: WeaponPhase;
  charge: number;
  /** Remaining hold-window ticks at full charge, else null. */
  hold: number | null;
  weaponTimer: number;
  silent: boolean;
  quiet: boolean;
  protected: boolean;
  inBrush: boolean;
  revealed: boolean;
  /** Own team only: tick when smoke is ready again. */
  smokeReadyTick: number;
  respawnTick: number;
  aimX: number;
  aimY: number;
}

export interface ProjectileView {
  id: number;
  team: Team;
  x: number;
  y: number;
  vx: number;
  vy: number;
  charge: number;
}

export interface SmokeView {
  id: number;
  x: number;
  y: number;
  radius: number;
  remaining: number;
}

export interface TrackView {
  id: number;
  x: number;
  y: number;
  axis: number;
  /** Coarse freshness, fadeStages (fresh) .. 1 (about to expire). */
  stage: number;
}

export interface LastKnown {
  id: number;
  x: number;
  y: number;
  /** Ticks since last seen. */
  age: number;
}

export type ObsEvent =
  | { type: 'shot'; tank: number; x: number; y: number; angle: number; charge: number }
  | { type: 'impact'; x: number; y: number; kind: 'wall' | 'tank' | 'expire'; charge: number; angle: number; projectile: number }
  | { type: 'damage'; target: number; amount: number; fromX: number; fromY: number; charge: number; byUs: boolean }
  | { type: 'death'; tank: number; team: Team; x: number; y: number; hull: number; turret: number }
  | { type: 'kill'; killer: string; killerTeam: Team; victim: string; victimTeam: Team; byUs: boolean }
  | { type: 'smoke'; x: number; y: number }
  | { type: 'vent'; tank: number }
  | { type: 'cancel'; tank: number }
  | { type: 'spawn'; tank: number; x: number; y: number }
  | { type: 'match'; phase: MatchState['phase']; winner?: Team | 'draw' };

export interface ScoreRow {
  id: number;
  name: string;
  team: Team;
  kills: number;
  deaths: number;
  isBot: boolean;
}

export interface Observation {
  tick: number;
  team: Team;
  match: { phase: MatchState['phase']; scores: [number, number]; killTarget: number; timeRemaining: number; winner: Team | 'draw' | null };
  tanks: TankView[];
  lastKnown: LastKnown[];
  projectiles: ProjectileView[];
  smokes: SmokeView[];
  tracks: TrackView[];
  events: ObsEvent[];
  /** Hidden-source sound cues per listening teammate id. */
  sounds: Record<number, SoundCue[]>;
  scoreboard: ScoreRow[];
}

/** The authority-side data the observer filters. */
export interface ObservableWorld extends SimView {
  projectiles: Projectile[];
  events: WorldEvent[];
  sounds: SoundEvent[];
  tracks: { stamps: TrackStamp[] };
  match: MatchState;
  timeRemaining(): number;
}

export class TeamObserver {
  private lastSeen = new Map<number, { x: number; y: number; tick: number }>();
  private knownTracks = new Map<number, TrackStamp>();

  constructor(readonly team: Team) {}

  observe(w: ObservableWorld): Observation {
    const team = this.team;
    const tick = w.tick;
    const visible = teamVisibleEnemies(w, team);
    const isKnown = (id: number) => {
      const t = w.tanks[id];
      return !!t && (t.team === team || visible.has(id));
    };

    const tanks: TankView[] = [];
    for (const t of w.tanks) {
      if (t.team !== team && !visible.has(t.id)) continue;
      const own = t.team === team;
      tanks.push({
        id: t.id,
        team: t.team,
        name: t.name,
        isBot: t.isBot,
        x: t.pos.x,
        y: t.pos.y,
        vx: t.vel.x,
        vy: t.vel.y,
        hull: t.hull,
        turret: t.turret,
        hp: t.hp,
        alive: t.alive,
        phase: t.weapon.phase,
        charge: chargeFraction(t.weapon),
        hold: holdRemaining(t.weapon),
        weaponTimer: own ? t.weapon.timer : 0,
        silent: t.silent,
        quiet: t.quiet,
        protected: t.protectedUntil > tick,
        inBrush: inBrush(w.map, t.pos),
        revealed: t.revealUntil > tick,
        smokeReadyTick: own ? t.smokeReadyTick : 0,
        respawnTick: own ? t.respawnTick : -1,
        aimX: own ? t.lastInput.aimX : 0,
        aimY: own ? t.lastInput.aimY : 0,
      });
      if (!own) this.lastSeen.set(t.id, { x: t.pos.x, y: t.pos.y, tick });
    }

    const markerTicks = ticks(TUNING.vision.lastKnownMarker);
    const lastKnown: LastKnown[] = [];
    for (const [id, s] of this.lastSeen) {
      const age = tick - s.tick;
      const enemy = w.tanks[id];
      if (age > markerTicks || !enemy) {
        this.lastSeen.delete(id);
        continue;
      }
      if (visible.has(id)) continue;
      lastKnown.push({ id, x: s.x, y: s.y, age });
    }

    const projectiles: ProjectileView[] = [];
    for (const p of w.projectiles) {
      if (p.team === team || pointVisibleToTeam(w, team, p.pos)) {
        projectiles.push({ id: p.id, team: p.team, x: p.pos.x, y: p.pos.y, vx: p.vel.x, vy: p.vel.y, charge: p.charge });
      }
    }

    const smokes: SmokeView[] = [];
    for (const s of w.smokes) {
      // Smoke billows above walls: known when the cloud is within sight range of a teammate.
      let near = false;
      for (const o of w.tanks) {
        if (o.team === team && o.alive && Math.hypot(o.pos.x - s.pos.x, o.pos.y - s.pos.y) <= TUNING.vision.radius + s.radius) near = true;
      }
      if (near) smokes.push({ id: s.id, x: s.pos.x, y: s.pos.y, radius: s.radius, remaining: s.expiresTick - tick });
    }

    // Tracks: add newly visible stamps; keep remembered ones until they expire.
    for (const s of w.tracks.stamps) {
      if (this.knownTracks.has(s.id)) continue;
      if (pointVisibleToTeam(w, team, s)) this.knownTracks.set(s.id, s);
    }
    const tracks: TrackView[] = [];
    const stageLen = TRACK_LIFETIME_TICKS / TUNING.tracks.fadeStages;
    for (const [id, s] of this.knownTracks) {
      const remaining = s.expiresTick - tick;
      if (remaining <= 0) {
        this.knownTracks.delete(id);
        continue;
      }
      tracks.push({ id, x: s.x, y: s.y, axis: s.axis, stage: Math.ceil(remaining / stageLen) });
    }

    const events: ObsEvent[] = [];
    const visPoint = (p: { x: number; y: number }) => pointVisibleToTeam(w, team, p, 30);
    for (const e of w.events) {
      switch (e.type) {
        case 'shot':
          if (isKnown(e.tank)) events.push({ type: 'shot', tank: e.tank, x: e.pos.x, y: e.pos.y, angle: e.angle, charge: e.charge });
          break;
        case 'impact':
          if (visPoint(e.pos))
            events.push({ type: 'impact', x: e.pos.x, y: e.pos.y, kind: e.kind, charge: e.charge, angle: e.angle, projectile: e.projectile });
          break;
        case 'damage': {
          const target = w.tanks[e.target]!;
          const attacker = w.tanks[e.attacker];
          const byUs = attacker?.team === team;
          if (target.team === team || byUs || visible.has(e.target) || visPoint(target.pos))
            events.push({ type: 'damage', target: e.target, amount: e.amount, fromX: e.from.x, fromY: e.from.y, charge: e.charge, byUs });
          break;
        }
        case 'death': {
          if (e.team === team || visPoint(e.pos))
            events.push({ type: 'death', tank: e.tank, team: e.team, x: e.pos.x, y: e.pos.y, hull: e.hull, turret: e.turret });
          const k = w.tanks[e.killer];
          const v = w.tanks[e.tank]!;
          events.push({
            type: 'kill',
            killer: k?.name ?? '?',
            killerTeam: k?.team ?? (1 - v.team as Team),
            victim: v.name,
            victimTeam: v.team,
            byUs: k?.team === team,
          });
          break;
        }
        case 'smoke':
          if (isKnown(e.tank) || visPoint(e.pos)) events.push({ type: 'smoke', x: e.pos.x, y: e.pos.y });
          break;
        case 'vent':
        case 'cancel':
          if (isKnown(e.tank)) events.push({ type: e.type, tank: e.tank });
          break;
        case 'spawn':
          if (w.tanks[e.tank]!.team === team) events.push({ type: 'spawn', tank: e.tank, x: e.pos.x, y: e.pos.y });
          break;
        case 'match':
          events.push(e.winner !== undefined ? { type: 'match', phase: e.phase, winner: e.winner } : { type: 'match', phase: e.phase });
          break;
      }
    }

    const sounds: Record<number, SoundCue[]> = {};
    for (const listener of w.tanks) {
      if (listener.team !== team || !listener.alive) continue;
      const cues: SoundCue[] = [];
      for (const s of w.sounds) {
        if (s.team === team) continue;
        if (visible.has(s.source)) continue; // visible sources are explained visually
        const cue = hearCue(listener.pos, s);
        if (!cue) continue;
        if (!cues.some((c) => c.kind === cue.kind && c.sector === cue.sector && c.band === cue.band)) cues.push(cue);
      }
      if (cues.length) sounds[listener.id] = cues;
    }

    return {
      tick,
      team,
      match: {
        phase: w.match.phase,
        scores: [w.match.scores[0], w.match.scores[1]],
        killTarget: w.match.killTarget,
        timeRemaining: w.timeRemaining(),
        winner: w.match.winner,
      },
      tanks,
      lastKnown,
      projectiles,
      smokes,
      tracks,
      events,
      sounds,
      scoreboard: w.tanks.map((t) => ({ id: t.id, name: t.name, team: t.team, kills: t.kills, deaths: t.deaths, isBot: t.isBot })),
    };
  }
}
