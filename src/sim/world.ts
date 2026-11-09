// Authoritative headless simulation. Fixed 30 Hz tick with documented, stable ordering:
//   respawns -> per-tank intents (smoke, movement, weapon) -> tank separation -> shell spawn
//   -> projectile resolution (all impacts gathered first) -> damage/deaths -> tracks
//   -> sounds -> match transition -> smoke expiry.
import { fromAngle, segmentCircleT, wrapAngle, type Vec } from './math';
import { raycastWalls, type GameMap } from './map';
import { Rng } from './rng';
import { createTank } from './tank';
import { stepMovement } from './movement';
import { chargeSpeedFactor, interruptCharge, resetWeapon, shotStats, stepWeapon } from './weapon';
import { TrackStore, updateTankTracks } from './tracks';
import { sightClear } from './vision';
import { terrainProfile } from './movement';
import { terrainAt } from './map';
import {
  neutralInput,
  type MatchState,
  type Projectile,
  type SmokeCloud,
  type SoundEvent,
  type Tank,
  type TankInput,
  type Team,
  type WorldEvent,
} from './types';
import { DT, TUNING, ticks } from './tuning';

export interface TankSpec {
  name: string;
  team: Team;
  isBot: boolean;
  pos?: Vec;
  /** Initial hull/turret facing in radians (default: toward the map centre line). */
  facing?: number;
  /** Full health (default TUNING.tank.maxHp). */
  hp?: number;
}

/**
 * `deathmatch`: respawns, kill target, timer, sudden death (the original mode).
 * `mission`: no respawns and no automatic end; the mission layer decides the outcome via `endMission`.
 */
export type WorldRules = 'deathmatch' | 'mission';

export interface WorldConfig {
  map: GameMap;
  seed: number;
  tanks: TankSpec[];
  /** Seconds; default from tuning. */
  countdown?: number;
  killTarget?: number;
  /** Seconds. */
  timeLimit?: number;
  rules?: WorldRules;
}

interface PendingHit {
  target: number;
  attacker: number;
  team: Team;
  damage: number;
  charge: number;
  dir: number;
}

const R = TUNING.tank.radius;
const C = TUNING.cannon;

export class World {
  readonly map: GameMap;
  readonly rng: Rng;
  readonly rules: WorldRules;
  tick = 0;
  tanks: Tank[] = [];
  projectiles: Projectile[] = [];
  smokes: SmokeCloud[] = [];
  tracks: TrackStore;
  match: MatchState;
  /** Events emitted during the most recent step (unfiltered — never hand these to a client). */
  events: WorldEvent[] = [];
  sounds: SoundEvent[] = [];
  lastImpact: { pos: Vec; kind: 'wall' | 'tank' | 'expire' } | null = null;
  private nextProjectileId = 1;
  private nextSmokeId = 1;
  private countdownTicks: number;
  private initialPos = new Map<number, Vec>();
  private pendingHits: PendingHit[] = [];
  /** Events raised between steps (e.g. mid-mission spawns), delivered with the next step. */
  private queued: WorldEvent[] = [];

  constructor(cfg: WorldConfig) {
    this.map = cfg.map;
    this.rng = new Rng(cfg.seed);
    this.rules = cfg.rules ?? 'deathmatch';
    this.tracks = new TrackStore(cfg.seed);
    this.countdownTicks = ticks(cfg.countdown ?? TUNING.match.countdown);
    this.match = {
      phase: this.countdownTicks > 0 ? 'countdown' : 'live',
      phaseStartTick: 0,
      scores: [0, 0],
      killTarget: cfg.killTarget ?? TUNING.match.killTarget,
      timeLimitTicks: ticks(cfg.timeLimit ?? TUNING.match.timeLimit),
      liveStartTick: this.countdownTicks > 0 ? -1 : 0,
      winner: null,
    };
    const perTeam = [0, 0];
    cfg.tanks.forEach((s) => {
      const spawns = this.map.spawns[s.team] ?? [];
      const idx = perTeam[s.team]!++;
      this.addTank({ ...s, pos: s.pos ?? spawns[idx % Math.max(1, spawns.length)] ?? { x: this.map.width / 2, y: this.map.height / 2 } });
    });
  }

  /** Add a tank (at construction, or mid-mission for reinforcements). Returns its id. */
  addTank(s: TankSpec): number {
    const id = this.tanks.length;
    const pos = s.pos ?? { x: this.map.width / 2, y: this.map.height / 2 };
    const t = createTank(id, s.team, s.name, pos, s.isBot, s.hp);
    if (s.facing !== undefined) t.hull = t.turret = s.facing;
    this.initialPos.set(id, { x: pos.x, y: pos.y });
    this.tanks.push(t);
    if (this.tick > 0) this.queued.push({ type: 'spawn', tank: id, pos: { ...pos } });
    return id;
  }

  /** Mission rules: end the match with an outcome decided outside the simulation. */
  endMission(winner: Team | 'draw'): void {
    if (this.match.phase === 'ended') return;
    this.match.phase = 'ended';
    this.match.phaseStartTick = this.tick;
    this.match.winner = winner;
    this.queued.push({ type: 'match', phase: 'ended', winner });
  }

  tank(id: number): Tank {
    const t = this.tanks[id];
    if (!t) throw new Error(`no tank ${id}`);
    return t;
  }

  get isLive(): boolean {
    return this.match.phase === 'live' || this.match.phase === 'suddenDeath';
  }

  addSmoke(team: Team, pos: Vec): SmokeCloud {
    const s: SmokeCloud = {
      id: this.nextSmokeId++,
      team,
      pos: { x: pos.x, y: pos.y },
      radius: TUNING.smoke.radius,
      createdTick: this.tick,
      expiresTick: this.tick + ticks(TUNING.smoke.lifetime),
    };
    this.smokes.push(s);
    return s;
  }

  /** Test/diagnostic hook: apply damage immediately through the normal death path. */
  applyDamageForTest(target: number, amount: number, attacker: number): void {
    const a = this.tank(attacker);
    this.pendingHits.push({ target, attacker, team: a.team, damage: amount, charge: 1, dir: 0 });
    this.resolveHits();
  }

  step(inputs: Partial<Record<number, TankInput>>): void {
    const tick = this.tick;
    this.events = this.queued;
    this.queued = [];
    this.sounds = [];
    const live = this.isLive;

    // Respawns
    for (const t of this.tanks) {
      if (!t.alive && t.respawnTick >= 0 && tick >= t.respawnTick && this.match.phase !== 'ended') this.respawn(t);
    }

    // Per-tank intents
    const fired: { tank: Tank; charge: number }[] = [];
    for (const t of this.tanks) {
      if (!t.alive) continue;
      let inp = sanitize(inputs[t.id], t);
      if (!live) inp = { ...neutralInput(inp.aimX, inp.aimY) };
      t.lastInput = inp;

      if (inp.smoke && tick >= t.smokeReadyTick) {
        interruptCharge(t.weapon);
        const cloud = this.addSmoke(t.team, t.pos);
        t.smokeReadyTick = tick + ticks(TUNING.smoke.cooldown);
        this.events.push({ type: 'smoke', cloud: cloud.id, tank: t.id, pos: { ...t.pos } });
        this.sounds.push({ kind: 'smoke', source: t.id, team: t.team, pos: { ...t.pos }, radius: TUNING.sound.smoke });
      }

      stepMovement(t, inp, this.map, DT, chargeSpeedFactor(t.weapon));
      const r = stepWeapon(t.weapon, inp);
      if (r.fired !== null) fired.push({ tank: t, charge: r.fired });
      if (r.vented) this.events.push({ type: 'vent', tank: t.id });
      if (r.canceled) this.events.push({ type: 'cancel', tank: t.id });
    }

    this.separateTanks();

    for (const f of fired) this.fireShell(f.tank, f.charge, tick);
    this.stepProjectiles();
    this.resolveHits();

    // Tracks
    for (const t of this.tanks) updateTankTracks(t, this.map, this.tracks, tick);
    this.tracks.expire(tick);

    // Engine / charge sounds (bounded ~4 Hz)
    const interval = ticks(TUNING.sound.engineInterval);
    for (const t of this.tanks) {
      if (!t.alive) continue;
      const speed = Math.hypot(t.vel.x, t.vel.y);
      if (speed > 12 && !t.quiet && tick - t.lastEngineSoundTick >= interval) {
        t.lastEngineSoundTick = tick;
        const mult = terrainProfile(terrainAt(this.map, t.pos.x, t.pos.y)).sound;
        this.sounds.push({ kind: 'engine', source: t.id, team: t.team, pos: { ...t.pos }, radius: TUNING.sound.engine * mult });
      }
      if (t.weapon.phase === 'charging' && tick - t.lastChargeSoundTick >= interval) {
        t.lastChargeSoundTick = tick;
        this.sounds.push({ kind: 'charge', source: t.id, team: t.team, pos: { ...t.pos }, radius: TUNING.sound.charge });
      }
    }

    this.updateMatch(tick);

    this.tick = tick + 1;
    this.smokes = this.smokes.filter((s) => s.expiresTick > this.tick);
  }

  private respawn(t: Tank): void {
    const pos = this.chooseSpawn(t);
    t.pos = { ...pos };
    t.prevPos = { ...pos };
    t.vel = { x: 0, y: 0 };
    t.hp = t.maxHp;
    t.alive = true;
    t.respawnTick = -1;
    t.protectedUntil = this.tick + ticks(TUNING.match.spawnProtection);
    t.smokeReadyTick = this.tick;
    t.revealUntil = -1;
    t.mudAccum = 0;
    resetWeapon(t.weapon);
    const cx = this.map.width / 2;
    t.hull = t.turret = pos.x < cx ? 0 : Math.PI;
    this.events.push({ type: 'spawn', tank: t.id, pos: { ...pos } });
  }

  /** Authority spawn choice: avoid live enemy sight, maximise distance, avoid stacking. */
  chooseSpawn(t: Tank): Vec {
    const list = this.map.spawns[t.team] ?? [];
    if (list.length === 0) return this.initialPos.get(t.id)!;
    let best = list[0]!;
    let bestScore = -Infinity;
    for (const s of list) {
      let minD = 5000;
      let seen = false;
      for (const e of this.tanks) {
        if (e.team === t.team || !e.alive) continue;
        const d = Math.hypot(e.pos.x - s.x, e.pos.y - s.y);
        minD = Math.min(minD, d);
        if (d < TUNING.vision.radius + 60 && sightClear(this.map, this.smokes, e.pos, s)) seen = true;
      }
      let crowd = 0;
      for (const a of this.tanks) {
        if (a.team === t.team && a.alive && a.id !== t.id && Math.hypot(a.pos.x - s.x, a.pos.y - s.y) < 60) crowd++;
      }
      const score = minD - (seen ? 10000 : 0) - crowd * 400 + this.rng.next() * 30;
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  private separateTanks(): void {
    const k = TUNING.tank.separation;
    const alive = this.tanks.filter((t) => t.alive);
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i]!;
        const b = alive[j]!;
        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const d = Math.hypot(dx, dy);
        const min = R * 2;
        if (d >= min || d < 1e-6) continue;
        const push = ((min - d) * k) / 2;
        const nx = dx / d;
        const ny = dy / d;
        a.pos.x -= nx * push;
        a.pos.y -= ny * push;
        b.pos.x += nx * push;
        b.pos.y += ny * push;
      }
    }
  }

  private fireShell(t: Tank, charge: number, tick: number): void {
    if (!t.alive) return;
    const { damage, speed } = shotStats(charge);
    const dir = fromAngle(t.turret);
    const muzzle = { x: t.pos.x + dir.x * C.muzzleDistance, y: t.pos.y + dir.y * C.muzzleDistance };
    t.revealUntil = tick + ticks(TUNING.vision.fireReveal);
    if (t.protectedUntil > tick) t.protectedUntil = tick;
    t.shotsFired++;
    const pid = this.nextProjectileId++;
    this.events.push({ type: 'shot', tank: t.id, team: t.team, pos: { ...muzzle }, angle: t.turret, charge, projectile: pid });
    this.sounds.push({ kind: 'shot', source: t.id, team: t.team, pos: { ...t.pos }, radius: TUNING.sound.shot });

    // Validate the firing segment hull-centre -> muzzle against cover and point-blank enemies.
    const wallT = raycastWalls(this.map, t.pos.x, t.pos.y, muzzle.x, muzzle.y);
    let tankT = Infinity;
    let hitTank: Tank | null = null;
    for (const e of this.tanks) {
      if (!e.alive || e.team === t.team) continue;
      const tt = segmentCircleT(t.pos, muzzle, e.pos, R + C.shellRadius);
      if (tt < tankT) {
        tankT = tt;
        hitTank = e;
      }
    }
    if (wallT !== Infinity && wallT <= tankT) {
      const pos = { x: t.pos.x + (muzzle.x - t.pos.x) * wallT, y: t.pos.y + (muzzle.y - t.pos.y) * wallT };
      this.impact(pos, 'wall', charge, t.turret, pid);
      return;
    }
    if (hitTank) {
      const pos = { x: t.pos.x + (muzzle.x - t.pos.x) * tankT, y: t.pos.y + (muzzle.y - t.pos.y) * tankT };
      this.impact(pos, 'tank', charge, t.turret, pid, hitTank.id);
      this.pendingHits.push({ target: hitTank.id, attacker: t.id, team: t.team, damage, charge, dir: t.turret });
      return;
    }
    this.projectiles.push({
      id: pid,
      owner: t.id,
      team: t.team,
      pos: muzzle,
      prevPos: { ...muzzle },
      vel: { x: dir.x * speed, y: dir.y * speed },
      charge,
      damage,
      traveled: 0,
      range: C.range,
    });
  }

  private stepProjectiles(): void {
    const keep: Projectile[] = [];
    for (const p of this.projectiles) {
      p.prevPos = { ...p.pos };
      const speed = Math.hypot(p.vel.x, p.vel.y);
      const remaining = p.range - p.traveled;
      const seg = Math.min(speed * DT, remaining);
      const ux = p.vel.x / speed;
      const uy = p.vel.y / speed;
      const end = { x: p.pos.x + ux * seg, y: p.pos.y + uy * seg };
      const tWall = raycastWalls(this.map, p.pos.x, p.pos.y, end.x, end.y);
      let tTank = Infinity;
      let target: Tank | null = null;
      for (const e of this.tanks) {
        if (!e.alive || e.team === p.team) continue;
        // Relative motion sweep: shell path in the target's moving frame.
        const r0 = { x: p.pos.x - e.prevPos.x, y: p.pos.y - e.prevPos.y };
        const r1 = { x: end.x - e.pos.x, y: end.y - e.pos.y };
        const tt = segmentCircleT(r0, r1, { x: 0, y: 0 }, R + C.shellRadius);
        if (tt < tTank) {
          tTank = tt;
          target = e;
        }
      }
      const angle = Math.atan2(uy, ux);
      if (tWall !== Infinity && tWall <= tTank) {
        this.impact({ x: p.pos.x + ux * seg * tWall, y: p.pos.y + uy * seg * tWall }, 'wall', p.charge, angle, p.id);
        continue;
      }
      if (target) {
        const pos = { x: p.pos.x + ux * seg * tTank, y: p.pos.y + uy * seg * tTank };
        this.impact(pos, 'tank', p.charge, angle, p.id, target.id);
        this.pendingHits.push({ target: target.id, attacker: p.owner, team: p.team, damage: p.damage, charge: p.charge, dir: angle });
        continue;
      }
      p.pos = end;
      p.traveled += seg;
      if (p.traveled >= p.range - 1e-6) {
        this.impact(end, 'expire', p.charge, angle, p.id);
        continue;
      }
      keep.push(p);
    }
    this.projectiles = keep;
  }

  private impact(pos: Vec, kind: 'wall' | 'tank' | 'expire', charge: number, angle: number, projectile: number, target?: number): void {
    this.lastImpact = { pos, kind };
    const ev: WorldEvent = { type: 'impact', pos, kind, charge, angle: wrapAngle(angle), projectile };
    if (target !== undefined) ev.target = target;
    this.events.push(ev);
  }

  /** Apply all hits gathered this tick at once, so same-tick trades are order independent. */
  private resolveHits(): void {
    if (this.pendingHits.length === 0) return;
    const hits = this.pendingHits;
    this.pendingHits = [];
    const tick = this.tick;
    const dying: { t: Tank; killer: number }[] = [];
    for (const h of hits) {
      const t = this.tanks[h.target];
      if (!t || !t.alive) continue;
      if (t.protectedUntil > tick) continue;
      if (!this.isLive && this.match.phase !== 'countdown') continue;
      t.hp = Math.max(0, t.hp - h.damage);
      const a = this.tanks[h.attacker];
      if (a) {
        a.damageDealt += h.damage;
        a.shotsHit++;
      }
      const back = h.dir + Math.PI;
      this.events.push({
        type: 'damage',
        target: t.id,
        amount: h.damage,
        from: { x: t.pos.x + Math.cos(back) * 200, y: t.pos.y + Math.sin(back) * 200 },
        hp: t.hp,
        charge: h.charge,
        attacker: h.attacker,
      });
      if (t.hp <= 0 && !dying.some((d) => d.t === t)) dying.push({ t, killer: h.attacker });
    }
    for (const { t, killer } of dying) {
      t.alive = false;
      t.deaths++;
      resetWeapon(t.weapon);
      t.respawnTick = this.rules === 'mission' ? -1 : tick + ticks(TUNING.match.respawn);
      const k = this.tanks[killer];
      if (k && k.team !== t.team) {
        k.kills++;
        this.match.scores[k.team]++;
      }
      this.events.push({ type: 'death', tank: t.id, team: t.team, pos: { ...t.pos }, killer, hull: t.hull, turret: t.turret });
      this.sounds.push({ kind: 'explosion', source: t.id, team: t.team, pos: { ...t.pos }, radius: TUNING.sound.explosion });
    }
  }

  private setPhase(phase: MatchState['phase'], tick: number, winner?: Team | 'draw'): void {
    this.match.phase = phase;
    this.match.phaseStartTick = tick;
    if (winner !== undefined) this.match.winner = winner;
    const ev: WorldEvent = { type: 'match', phase };
    if (winner !== undefined) ev.winner = winner;
    this.events.push(ev);
  }

  private updateMatch(tick: number): void {
    const m = this.match;
    const next = tick + 1;
    const [a, b] = m.scores;
    switch (m.phase) {
      case 'countdown':
        if (next - m.phaseStartTick >= this.countdownTicks) {
          m.liveStartTick = next;
          this.setPhase('live', next);
        }
        break;
      case 'live':
        if (this.rules === 'mission') break;
        if (a >= m.killTarget || b >= m.killTarget) this.setPhase('ended', next, a > b ? 0 : b > a ? 1 : 'draw');
        else if (next - m.liveStartTick >= m.timeLimitTicks) {
          if (a !== b) this.setPhase('ended', next, a > b ? 0 : 1);
          else this.setPhase('suddenDeath', next);
        }
        break;
      case 'suddenDeath':
        if (a !== b) this.setPhase('ended', next, a > b ? 0 : 1);
        else if (next - m.phaseStartTick >= ticks(TUNING.match.suddenDeath)) this.setPhase('ended', next, 'draw');
        break;
      case 'ended':
        break;
    }
  }

  /** Seconds remaining in the current timed phase (for HUD). */
  timeRemaining(): number {
    const m = this.match;
    if (m.phase === 'countdown') return (this.countdownTicks - (this.tick - m.phaseStartTick)) / TUNING.tickHz;
    if (m.phase === 'live' && this.rules === 'mission') return 0;
    if (m.phase === 'live') return (m.timeLimitTicks - (this.tick - m.liveStartTick)) / TUNING.tickHz;
    if (m.phase === 'suddenDeath') return (ticks(TUNING.match.suddenDeath) - (this.tick - m.phaseStartTick)) / TUNING.tickHz;
    return 0;
  }
}

function sanitize(inp: TankInput | undefined, t: Tank): TankInput {
  if (!inp) {
    const d = fromAngle(t.turret, 100);
    return neutralInput(t.pos.x + d.x, t.pos.y + d.y);
  }
  const f = (n: number, fallback: number) => (Number.isFinite(n) ? n : fallback);
  let mx = f(inp.moveX, 0);
  let my = f(inp.moveY, 0);
  const l = Math.hypot(mx, my);
  if (l > 1) {
    mx /= l;
    my /= l;
  }
  return {
    moveX: mx,
    moveY: my,
    aimX: f(inp.aimX, t.pos.x + 1),
    aimY: f(inp.aimY, t.pos.y),
    fireHeld: !!inp.fireHeld,
    firePressed: !!inp.firePressed,
    fireReleased: !!inp.fireReleased,
    cancel: !!inp.cancel,
    smoke: !!inp.smoke,
    silent: !!inp.silent,
  };
}
