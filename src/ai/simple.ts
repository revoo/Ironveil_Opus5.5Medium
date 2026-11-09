// Simple mission AI for regular (non-boss) units. Boss encounters keep the full tactical
// BotController; ordinary garrison tanks use this: readable, predictable, tunable.
//
// Each unit has a posture (patrol a path, guard a post, hold a point) and an alert state:
//
//   calm ──(sees you: suspicion fills / hears something)──► suspicious ──(meter full, hit, alarm)──► combat
//    ▲                                                          │                                     │
//    └────────────── gives up after a while ◄── searching ◄─────┴────────── loses sight ◄─────────────┘
//
// Suspicion is the stealth contract with the player: seeing you fills a 0..1 meter, faster the
// closer you are (instantly within point-blank range or if you fire); out of sight it drains.
// When it fills, the unit enters combat and raises the alarm, which pulls nearby units in.
//
// Like the tactical AI, it reads only its team's Observation (never the World).
import { angleDiff, type Vec } from '../sim/math';
import { lineOfSightClear, type GameMap } from '../sim/map';
import type { Observation, TankView } from '../sim/observation';
import { sectorDir } from '../sim/sound';
import { neutralInput, type TankInput, type Team } from '../sim/types';
import { Rng } from '../sim/rng';
import { TUNING } from '../sim/tuning';
import { NavGrid } from './nav';
import { Motor } from './motor';
import { interceptPoint } from './aim';

export type Posture =
  | { kind: 'patrol'; path: Vec[]; loop: boolean }
  | { kind: 'guard'; pos: Vec; facing: number }
  | { kind: 'hold'; pos: Vec };

export type AlertState = 'calm' | 'suspicious' | 'searching' | 'combat';

export interface SimpleUnitSpec {
  id: number;
  name: string;
  posture: Posture;
  /** 0..1: aim quality and reaction speed. Default 0.5. */
  skill?: number;
}

export interface SimpleTuning {
  /** Seconds for suspicion to fill when the target is at the edge of vision. */
  noticeFar: number;
  /** Seconds to fill at close range. */
  noticeNear: number;
  /** Within this distance (px), seeing you is instant. */
  instantRange: number;
  /** Suspicion lost per second without sight. */
  drain: number;
  /** Seconds spent searching a last-known position before giving up. */
  searchTime: number;
  /** Seconds a suspicious unit investigates before calming down. */
  investigateTime: number;
  /** Distance (px) at which an alarm pulls other units in. */
  alarmRadius: number;
  /** Preferred engagement range (px). */
  engageRange: number;
  /** Seconds between shots at skill 0.5 (x1.25 at skill 0, x0.75 at skill 1). Garrison crews are not aces. */
  shotGap: number;
}

export const SIMPLE_TUNING: SimpleTuning = {
  noticeFar: 2.2,
  noticeNear: 0.6,
  instantRange: 130,
  drain: 0.25,
  searchTime: 9,
  investigateTime: 6,
  alarmRadius: 900,
  engageRange: 300,
  shotGap: 1.5,
};

/** What a unit is reacting to; picks the line pool and the bubble's tone. */
export type BarkKind =
  | 'sawSomething' | 'heardSomething' | 'heardShot' | 'investigate' | 'nothing'
  | 'spotted' | 'hit' | 'heavyHit' | 'critical' | 'reloading' | 'lost' | 'giveUp' | 'support' | 'allyDown';

/** Line pools. Picked deterministically (no RNG draw), so barks never change the simulation. */
export const BARK_LINES: Record<BarkKind, readonly string[]> = {
  sawSomething: ['Hm? Movement.', 'Did something move out there?', 'Eyes up. I saw something.', 'Wait… what was that?'],
  heardSomething: ['You hear that?', 'Engine noise. Close.', "Something's out there.", 'Quiet. Listen.'],
  heardShot: ['Gunfire!', 'Shots fired!', 'That was a cannon!'],
  investigate: ['Going to check it out.', 'Moving to investigate.', "I'll take a look.", 'Checking it out.'],
  nothing: ['Must have been nothing.', 'Just the wind.', 'Nothing here. Back to it.', 'Jumpy tonight…'],
  spotted: ['Enemy spotted!', 'Contact! Engaging!', 'Tank! Right there!', 'Hostile in sight!'],
  hit: ["I've been hit!", 'Taking fire!', "I'm hit! Where'd that come from?", 'Armour hit!'],
  heavyHit: ["I've sustained major damage!", 'Major damage! Armour breached!', 'That went right through us!', "Heavy round! We're burning!"],
  critical: ['Hull breached!', "I can't take another one!", 'Need support, now!'],
  reloading: ['Reloading!', 'Loading!', 'Reloading, cover me!'],
  lost: ['Lost them. Searching.', 'Where did they go?', 'Lost visual!'],
  giveUp: ["They're gone. Stay sharp.", 'Area clear… for now.', 'Back to your posts.'],
  support: ['Copy, moving to support.', 'On my way!', 'Moving up!'],
  allyDown: ['Man down!', "They got one of ours!", 'We lost a tank!'],
};

export type BarkTone = 'calm' | 'sus' | 'combat';

const BARK_TONE: Record<BarkKind, BarkTone> = {
  sawSomething: 'sus', heardSomething: 'sus', heardShot: 'sus', investigate: 'sus', nothing: 'calm', giveUp: 'calm',
  spotted: 'combat', hit: 'combat', heavyHit: 'combat', critical: 'combat', reloading: 'combat', lost: 'sus', support: 'sus', allyDown: 'combat',
};

/** Damage from one hit that counts as a heavy (well-charged) round. */
const HEAVY_HIT = 45;

/** Urgent kinds cut through the per-unit cooldown sooner. */
const URGENT: ReadonlySet<BarkKind> = new Set(['spotted', 'hit', 'heavyHit', 'critical', 'allyDown']);

export interface SimpleBark {
  /** Speaking unit (tank id). */
  unit: number;
  from: string;
  kind: BarkKind;
  tone: BarkTone;
  text: string;
  tick: number;
}

/** Things the mission layer listens for. */
export type SimpleEvent =
  | { type: 'alarm'; unit: number; x: number; y: number; tick: number }
  | { type: 'alert'; unit: number; state: AlertState; tick: number };

interface Unit {
  spec: SimpleUnitSpec;
  posture: Posture;
  state: AlertState;
  suspicion: number;
  motor: Motor;
  rng: Rng;
  waypoint: number;
  dir: 1 | -1;
  /** Where the unit's attention is (last seen / heard). */
  focus: Vec | null;
  focusTarget: number | null;
  stateSince: number;
  lastSeenTick: number;
  aimJitter: Vec;
  jitterTick: number;
  lastBark: number;
  lastLine: string;
  barkCount: number;
  /** Suspicious unit has started driving to the focus point (said so once). */
  moving: boolean;
  lastPhase: string;
  saidCritical: boolean;
  shots: number;
  lastShotTick: number;
  /** Last observed own position. */
  pos: Vec | null;
}

const HZ = TUNING.tickHz;

export class SimpleController {
  readonly nav: NavGrid;
  private units = new Map<number, Unit>();
  barks: SimpleBark[] = [];
  /** Drained by the mission layer every tick. */
  events: SimpleEvent[] = [];
  alarmRaised = false;

  constructor(
    private map: GameMap,
    readonly team: Team,
    private seed: number,
    specs: SimpleUnitSpec[] = [],
    private tune: SimpleTuning = SIMPLE_TUNING,
    nav?: NavGrid,
  ) {
    this.nav = nav ?? new NavGrid(map);
    for (const s of specs) this.add(s);
  }

  add(spec: SimpleUnitSpec): void {
    const rng = new Rng((this.seed ^ (spec.id * 2654435761)) >>> 0);
    this.units.set(spec.id, {
      spec,
      posture: spec.posture,
      state: 'calm',
      suspicion: 0,
      motor: new Motor(this.nav, rng),
      rng,
      waypoint: 0,
      dir: 1,
      focus: null,
      focusTarget: null,
      stateSince: 0,
      lastSeenTick: -9999,
      aimJitter: { x: 0, y: 0 },
      jitterTick: -9999,
      lastBark: -9999,
      lastLine: '',
      barkCount: 0,
      moving: false,
      lastPhase: 'ready',
      saidCritical: false,
      shots: 0,
      lastShotTick: -9999,
      pos: null,
    });
  }

  has(id: number): boolean {
    return this.units.has(id);
  }

  setPosture(id: number, p: Posture): void {
    const u = this.units.get(id);
    if (!u) return;
    u.posture = p;
    u.waypoint = 0;
    u.dir = 1;
  }

  state(id: number): AlertState | undefined {
    return this.units.get(id)?.state;
  }

  suspicion(id: number): number {
    return this.units.get(id)?.suspicion ?? 0;
  }

  /** Highest suspicion of any unit, for a HUD detection meter. */
  maxSuspicion(): number {
    let m = 0;
    for (const u of this.units.values()) m = Math.max(m, u.state === 'combat' ? 1 : u.suspicion);
    return m;
  }

  /**
   * Raise the alarm at `at`: units within `radius` (default: the tuning's alarm radius) that aren't
   * already fighting start searching there. Missions call this with Infinity for a base-wide alarm.
   */
  raiseAlarm(at: Vec, tick: number, source = -1, radius = this.tune.alarmRadius): void {
    if (!this.alarmRaised) this.events.push({ type: 'alarm', unit: source, x: at.x, y: at.y, tick });
    this.alarmRaised = true;
    for (const u of this.units.values()) {
      if (u.spec.id === source || u.state === 'combat') continue;
      if (u.pos && Math.hypot(at.x - u.pos.x, at.y - u.pos.y) > radius) continue;
      u.focus = { x: at.x, y: at.y };
      u.focusTarget = null;
      this.setState(u, 'searching', tick, 'support');
    }
  }

  update(obs: Observation): Record<number, TankInput> {
    const out: Record<number, TankInput> = {};
    const tick = obs.tick;
    const views = new Map(obs.tanks.map((t) => [t.id, t]));
    this.reactToLosses(obs);
    for (const [id, u] of this.units) {
      const self = views.get(id);
      if (!self || !self.alive) {
        out[id] = neutralInput();
        continue;
      }
      u.pos = { x: self.x, y: self.y };
      this.perceive(u, self, obs);
      this.act(u, self, obs);
      // Called after the gun goes off: not every time, or it turns into a chant.
      if (self.phase === 'reloading' && u.lastPhase !== 'reloading') {
        u.lastShotTick = tick;
        if (u.state === 'combat' && u.shots++ % 2 === 0) this.bark(u, 'reloading', tick);
      }
      u.lastPhase = self.phase;
      out[id] = u.motor.produce(self, tick);
    }
    return out;
  }

  // ------------------------------------------------------------------ perception
  private perceive(u: Unit, self: TankView, obs: Observation): void {
    const tick = obs.tick;
    const dt = 1 / HZ;
    const t = this.tune;
    // Enemies this unit can see itself (team vision already applied brush/smoke; we add own range + LOS).
    let best: { v: TankView; d: number } | null = null;
    for (const v of obs.tanks) {
      if (v.team === this.team || !v.alive) continue;
      const d = Math.hypot(v.x - self.x, v.y - self.y);
      if (d > TUNING.vision.radius || !lineOfSightClear(this.map, self, v)) continue;
      if (!best || d < best.d) best = { v, d };
    }
    if (best) {
      const { v, d } = best;
      u.lastSeenTick = tick;
      u.focus = { x: v.x, y: v.y };
      u.focusTarget = v.id;
      if (u.state !== 'combat') {
        const k = Math.min(1, Math.max(0, (d - t.instantRange) / (TUNING.vision.radius - t.instantRange)));
        const fill = t.noticeNear + (t.noticeFar - t.noticeNear) * k;
        const skill = u.spec.skill ?? 0.5;
        u.suspicion = d <= t.instantRange || v.revealed ? 1 : Math.min(1, u.suspicion + (dt / fill) * (0.75 + skill * 0.5));
        if (u.suspicion >= 1) this.enterCombat(u, self, tick);
        else if (u.state === 'calm' && u.suspicion > 0.25) this.setState(u, 'suspicious', tick, 'sawSomething');
      }
    } else {
      if (u.state !== 'combat') u.suspicion = Math.max(0, u.suspicion - t.drain * dt);
      if (u.state === 'combat' && tick - u.lastSeenTick > HZ * 1.5) this.setState(u, 'searching', tick, 'lost');
    }

    // Hit: straight to combat, looking back along the shell.
    for (const e of obs.events) {
      if (e.type === 'damage' && e.target === self.id) {
        u.focus = { x: e.fromX, y: e.fromY };
        // A heavy (charged) round gets its own line: the crew knows the difference.
        const heavy = e.amount >= HEAVY_HIT;
        const critical = !heavy && self.hp <= 30 && !u.saidCritical;
        if (critical) u.saidCritical = true;
        const kind: BarkKind = heavy ? 'heavyHit' : critical ? 'critical' : 'hit';
        if (u.state !== 'combat') this.enterCombat(u, self, tick, heavy ? 'heavyHit' : 'hit');
        else this.bark(u, kind, tick);
      }
    }

    // Sounds: a calm or suspicious unit turns toward what it heard.
    if (u.state === 'calm' || u.state === 'suspicious') {
      for (const c of obs.sounds[self.id] ?? []) {
        const dir = sectorDir(c.sector);
        const dist = c.band === 'near' ? 160 : 360;
        u.focus = { x: self.x + dir.x * dist, y: self.y + dir.y * dist };
        u.focusTarget = null;
        u.suspicion = Math.max(u.suspicion, c.kind === 'shot' ? 0.6 : 0.3);
        if (u.state === 'calm') this.setState(u, 'suspicious', tick, c.kind === 'shot' ? 'heardShot' : 'heardSomething');
        else u.stateSince = tick; // renew the investigation
      }
    }
  }

  private enterCombat(u: Unit, self: TankView, tick: number, kind: BarkKind = 'spotted'): void {
    u.suspicion = 1;
    if (u.state === 'combat') return;
    this.setState(u, 'combat', tick, kind);
    this.raiseAlarm(u.focus ?? { x: self.x, y: self.y }, tick, u.spec.id);
  }

  private setState(u: Unit, s: AlertState, tick: number, bark?: BarkKind): void {
    if (u.state === s) return;
    u.state = s;
    u.stateSince = tick;
    u.moving = false;
    this.events.push({ type: 'alert', unit: u.spec.id, state: s, tick });
    if (bark) this.bark(u, bark, tick);
  }

  /** Say a line from the pool unless this unit spoke very recently (urgent lines wait less). */
  private bark(u: Unit, kind: BarkKind, tick: number): void {
    if (tick - u.lastBark < HZ * (URGENT.has(kind) ? 0.4 : 2)) return;
    const lines = BARK_LINES[kind];
    let i = (u.spec.id * 7 + u.barkCount * 3 + Math.floor(tick / 11)) % lines.length;
    if (lines.length > 1 && lines[i] === u.lastLine) i = (i + 1) % lines.length;
    const text = lines[i]!;
    u.lastBark = tick;
    u.lastLine = text;
    u.barkCount++;
    this.barks.push({ unit: u.spec.id, from: u.spec.name, kind, tone: BARK_TONE[kind], text, tick });
    if (this.barks.length > 30) this.barks.shift();
  }

  /** When a unit dies, the nearest comrade within earshot calls it out. */
  private reactToLosses(obs: Observation): void {
    for (const e of obs.events) {
      if (e.type !== 'death' || !this.units.has(e.tank)) continue;
      let best: { u: Unit; d: number } | null = null;
      for (const u of this.units.values()) {
        if (u.spec.id === e.tank || !u.pos) continue;
        const v = obs.tanks.find((t) => t.id === u.spec.id);
        if (!v?.alive) continue;
        const d = Math.hypot(u.pos.x - e.x, u.pos.y - e.y);
        if (d < 700 && (!best || d < best.d)) best = { u, d };
      }
      if (best) this.bark(best.u, 'allyDown', obs.tick);
    }
  }

  // ------------------------------------------------------------------ behaviour
  private act(u: Unit, self: TankView, obs: Observation): void {
    const tick = obs.tick;
    const m = u.motor;
    m.fire = null;
    const age = (tick - u.stateSince) / HZ;
    switch (u.state) {
      case 'calm':
        this.followPosture(u, self, tick);
        break;
      case 'suspicious': {
        // Stop and look first, then drive over to have a look.
        const f = u.focus;
        if (f) m.aim = f;
        if (age < 1.2) m.stop();
        else if (f) {
          if (!u.moving) {
            u.moving = true;
            this.bark(u, 'investigate', tick);
          }
          m.goTo(f, { arrive: 70 });
        }
        if (age > this.tune.investigateTime && u.suspicion < 0.25) this.setState(u, 'calm', tick, 'nothing');
        break;
      }
      case 'searching': {
        const f = u.focus;
        if (f) {
          m.goTo(f, { arrive: 60 });
          // sweep the turret around the search point
          const a = Math.atan2(f.y - self.y, f.x - self.x) + Math.sin(tick / 20 + u.spec.id) * 1.1;
          m.aim = m.arrived ? { x: self.x + Math.cos(tick / 25 + u.spec.id) * 200, y: self.y + Math.sin(tick / 25 + u.spec.id) * 200 } : { x: self.x + Math.cos(a) * 200, y: self.y + Math.sin(a) * 200 };
        }
        if (age > this.tune.searchTime) {
          u.suspicion = 0.3;
          this.setState(u, 'suspicious', tick, 'giveUp');
          u.stateSince = tick - HZ * (this.tune.investigateTime - 1.5);
        }
        break;
      }
      case 'combat':
        this.fight(u, self, obs);
        break;
    }
  }

  private followPosture(u: Unit, self: TankView, tick: number): void {
    const m = u.motor;
    const p = u.posture;
    if (p.kind === 'patrol') {
      const pts = p.path;
      const wp = pts[u.waypoint]!;
      m.goTo(wp, { arrive: 40, silent: true });
      m.aim = { x: self.x + Math.cos(self.hull) * 200 + Math.sin(tick / 40 + u.spec.id) * 60, y: self.y + Math.sin(self.hull) * 200 };
      if (m.arrived || Math.hypot(wp.x - self.x, wp.y - self.y) < 40) {
        if (p.loop) u.waypoint = (u.waypoint + 1) % pts.length;
        else {
          if (u.waypoint + u.dir >= pts.length || u.waypoint + u.dir < 0) u.dir = (-u.dir) as 1 | -1;
          u.waypoint += u.dir;
        }
      }
      if (m.failed) u.waypoint = (u.waypoint + 1) % pts.length;
    } else {
      const pos = p.pos;
      if (Math.hypot(pos.x - self.x, pos.y - self.y) > 30) m.goTo(pos, { arrive: 20, silent: true });
      else m.stop();
      const base = p.kind === 'guard' ? p.facing : self.hull;
      const scan = base + Math.sin(tick / 60 + u.spec.id) * 0.5;
      m.aim = { x: self.x + Math.cos(scan) * 200, y: self.y + Math.sin(scan) * 200 };
    }
  }

  private fight(u: Unit, self: TankView, obs: Observation): void {
    const m = u.motor;
    const tick = obs.tick;
    const target = u.focusTarget !== null ? obs.tanks.find((t) => t.id === u.focusTarget && t.alive) : undefined;
    const visible = target && tick - u.lastSeenTick <= 1;
    if (!target || !visible) {
      if (u.focus) {
        m.aim = u.focus;
        m.goTo(u.focus, { arrive: 80 });
      }
      return;
    }
    const d = Math.hypot(target.x - self.x, target.y - self.y);
    // Range keeping: close in when far, hold when in range, back off when too close.
    if (d > this.tune.engageRange + 60) m.goTo({ x: target.x, y: target.y }, { arrive: this.tune.engageRange });
    else if (d < 140) {
      const away = { x: self.x + ((self.x - target.x) / d) * 120, y: self.y + ((self.y - target.y) / d) * 120 };
      m.goTo(away, { arrive: 30 });
    } else m.stop();

    // Aim with lead and skill-dependent error that re-rolls once a second.
    const skill = u.spec.skill ?? 0.5;
    if (tick - u.jitterTick > HZ) {
      u.jitterTick = tick;
      const err = (1 - skill) * 46 + 8;
      const a = u.rng.next() * Math.PI * 2;
      u.aimJitter = { x: Math.cos(a) * err * u.rng.next(), y: Math.sin(a) * err * u.rng.next() };
    }
    const charge = d < 220 ? 0.45 : 0;
    const speed = TUNING.cannon.speedMin + (TUNING.cannon.speedMax - TUNING.cannon.speedMin) * charge;
    const lead = interceptPoint(self, target, { x: target.vx * skill, y: target.vy * skill }, speed);
    const aim = { x: lead.x + u.aimJitter.x, y: lead.y + u.aimJitter.y };
    m.aim = aim;
    const want = Math.atan2(aim.y - self.y, aim.x - self.x);
    const gap = this.tune.shotGap * (1.25 - skill * 0.5) * HZ;
    if (tick - u.lastShotTick >= gap && Math.abs(angleDiff(self.turret, want)) < 0.5) m.fire = { charge, aim, tolerance: 0.06 + (1 - skill) * 0.06, allowCancel: true };
  }
}
