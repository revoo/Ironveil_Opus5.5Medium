// Tactical bot brain: utility-scored goals with commitment, GOAP plans built from context-
// costed actions, and action executors that drive the Motor. Inputs are the bot's own state,
// its perception memory (from the team Observation), static map geometry and squad orders.
import { angleDiff, clamp, type Vec } from '../sim/math';
import type { Observation, TankView } from '../sim/observation';
import type { GameMap } from '../sim/map';
import type { TankInput, Team } from '../sim/types';
import { Rng } from '../sim/rng';
import { shotStats } from '../sim/weapon';
import { TUNING } from '../sim/tuning';
import { plan, type ActionDef, type Symbols } from './planner';
import { interceptPoint } from './aim';
import { BotMemory, type Contact, type Disturbance } from './memory';
import { Motor } from './motor';
import type { NavGrid } from './nav';
import { findCoverSpot, findFiringSpot, findSearchSpots, los, nearestLandmarkName, type TacCtx } from './tactics';
import type { DifficultyProfile, Traits } from './personality';

export type Role = 'pressure' | 'support' | 'flank' | 'hunt';
export type GoalName = 'engage' | 'reposition' | 'retreat' | 'flank' | 'investigate' | 'search' | 'ambush' | 'hunt';

/** What the squad coordinator tells a bot. */
export interface SquadOrders {
  role: Role;
  focus: { id: number; x: number; y: number } | null;
  /** Unit vector from the focus toward the friendly pressure position. */
  flankAxis: Vec | null;
  flankerEnRoute: boolean;
  push: boolean;
  claimed: Vec[];
  patrolPoint: Vec;
}

export interface BotSituation {
  tick: number;
  self: TankView;
  pos: Vec;
  hp: number;
  target: Contact | null;
  dist: number;
  hasShot: boolean;
  threats: Vec[];
  exposed: boolean;
  ready: boolean;
  recovering: boolean;
  smokeReady: boolean;
  lost: Contact | null;
  disturbance: Disturbance | null;
  orders: SquadOrders;
  targetAimingAtUs: boolean;
  lateral: number;
  underFire: boolean;
  /** 0..1 willingness to spend smoke (difficulty x caution). */
  smokeWill: number;
  chargeBias: number;
}

const GOAL_STATE: Record<GoalName, Symbols> = {
  engage: { targetHurt: true },
  reposition: { inCover: true },
  retreat: { safe: true },
  flank: { atFlank: true },
  investigate: { investigated: true },
  search: { searched: true },
  ambush: { ambushSet: true },
  hunt: { patrolled: true },
};

type Status = 'run' | 'done' | 'fail';

interface ActionRun {
  name: string;
  started: number;
  spot?: Vec | null;
  spots?: Vec[];
  i?: number;
  until?: number;
  charge?: number;
  errAngle?: number;
  sweepBase?: number;
  firedPhaseSeen?: boolean;
  lastSeen?: number;
  disturbance?: Disturbance | null;
  contact?: Contact | null;
}

export class Bot {
  readonly memory: BotMemory;
  readonly motor: Motor;
  readonly rng: Rng;
  goal: GoalName | null = null;
  goalSince = 0;
  planNames: string[] = [];
  role: Role = 'hunt';
  /** Short radio callouts (allied bots only are shown to the player). */
  chatter: { text: string; tick: number }[] = [];
  private planDefs: ActionDef<BotSituation>[] = [];
  private step = 0;
  private run: ActionRun | null = null;
  private cooldown = new Map<GoalName, number>();
  private sit: BotSituation | null = null;
  private lastSay = -999;
  private flankDone = -1;
  private jinkUntil = 0;
  private jinkDir = 1;
  private orders: SquadOrders;

  constructor(
    readonly id: number,
    readonly team: Team,
    readonly name: string,
    readonly personaTitle: string,
    readonly traits: Traits,
    readonly diff: DifficultyProfile,
    private map: GameMap,
    private nav: NavGrid,
    seed: number,
  ) {
    this.rng = new Rng(seed);
    this.memory = new BotMemory(id, diff, traits, this.rng);
    this.motor = new Motor(nav, this.rng);
    this.orders = { role: 'hunt', focus: null, flankAxis: null, flankerEnRoute: false, push: false, claimed: [], patrolPoint: { x: map.width / 2, y: map.height / 2 } };
  }

  get claim(): Vec | null {
    return this.run?.spot ?? null;
  }

  get situation(): BotSituation | null {
    return this.sit;
  }

  setOrders(o: SquadOrders): void {
    this.orders = o;
    this.role = o.role;
  }

  update(obs: Observation, self: TankView): TankInput {
    const tick = obs.tick;
    this.memory.update(obs, self);
    if (!self.alive) {
      this.goal = null;
      this.run = null;
      this.motor.stop();
      this.motor.fire = null;
      return this.motor.produce(self, tick);
    }
    const tac: TacCtx = { map: this.map, nav: this.nav, smokes: obs.smokes };
    this.reflexes(obs, self, tick);
    if ((tick + this.id * 7) % this.diff.thinkTicks === 0 || !this.sit) this.think(obs, self, tac, tick);
    if (this.sit) {
      this.sit.self = self;
      this.sit.pos = { x: self.x, y: self.y };
    }
    this.execute(self, tac, tick);
    return this.motor.produce(self, tick);
  }

  // ---------------------------------------------------------------- perception -> situation
  private assess(_obs: Observation, self: TankView, tac: TacCtx, tick: number): BotSituation {
    const pos = { x: self.x, y: self.y };
    const ack = this.memory.acknowledged(tick);
    let target: Contact | null = null;
    let best = Infinity;
    for (const c of ack) {
      const d = Math.hypot(c.x - pos.x, c.y - pos.y);
      let s = d / 400 + (c.hp / 100) * 0.5;
      if (this.orders.focus?.id === c.id) s -= 0.3 * this.traits.teamwork;
      if (!los(tac, pos, c)) s += 0.8;
      if (s < best) {
        best = s;
        target = c;
      }
    }
    const threats: Vec[] = ack.map((c) => ({ x: c.x, y: c.y }));
    for (const c of this.memory.contacts.values()) if (!c.visible && tick - c.lastSeen < 60) threats.push({ x: c.x, y: c.y });
    const exposed = ack.some((c) => los(tac, c, pos) && Math.hypot(c.x - pos.x, c.y - pos.y) < TUNING.vision.radius + 60);
    const dist = target ? Math.hypot(target.x - pos.x, target.y - pos.y) : Infinity;
    const hasShot = !!target && dist < TUNING.cannon.range - 60 && los(tac, pos, target);
    let lost: Contact | null = null;
    for (const c of this.memory.lost()) if (!lost || c.lastSeen > lost.lastSeen) lost = c;
    const disturbance = this.memory.bestDisturbance(pos.x, pos.y, tick);
    let aimingAtUs = false;
    let lateral = 0;
    if (target) {
      const bearing = Math.atan2(pos.y - target.y, pos.x - target.x);
      aimingAtUs = Math.abs(angleDiff(target.turret, bearing)) < 0.2;
      const ux = (target.x - pos.x) / dist;
      const uy = (target.y - pos.y) / dist;
      lateral = Math.abs(target.vx * -uy + target.vy * ux);
    }
    return {
      tick,
      self,
      pos,
      hp: self.hp / TUNING.tank.maxHp,
      target,
      dist,
      hasShot,
      threats,
      exposed,
      ready: self.phase === 'ready' || self.phase === 'charging',
      recovering: self.phase === 'reloading' || self.phase === 'vent' || self.phase === 'cancel',
      smokeReady: tick >= self.smokeReadyTick,
      lost,
      disturbance,
      orders: this.orders,
      targetAimingAtUs: aimingAtUs,
      lateral,
      underFire: tick < this.memory.underFireUntil,
      smokeWill: smokeWillingness(this.diff, this.traits),
      chargeBias: this.traits.chargeBias,
    };
  }

  // ---------------------------------------------------------------- goal selection
  scoreGoals(s: BotSituation): Record<GoalName, number> {
    const T = this.traits;
    const sc: Record<GoalName, number> = { engage: 0, reposition: 0, retreat: 0, flank: 0, investigate: 0, search: 0, ambush: 0, hunt: 0.15 };
    if (s.target) {
      sc.engage = 0.6 + 0.25 * T.aggression + (s.target.hp < 40 ? 0.1 : 0) - (s.hp < 0.4 ? 0.15 * T.caution : 0);
      if (s.orders.role === 'support' && s.dist > 700) sc.engage -= 0.1;
    }
    if (s.target && s.exposed && s.recovering && s.dist < 560 && T.caution > 0.2) {
      sc.reposition = 0.45 + 0.4 * T.caution + (s.underFire ? 0.1 : 0) + (s.threats.length > 1 ? 0.15 : 0);
    }
    if (s.hp <= 0.45 && (s.exposed || s.underFire) && s.threats.length > 0) {
      sc.retreat = 0.55 + (0.45 - s.hp) * 1.2 + 0.25 * T.caution - 0.2 * T.aggression;
    }
    const focus = s.orders.focus;
    if (s.orders.role === 'flank' && focus && this.flankDone !== focus.id && !(s.target && s.dist < 380 && s.hasShot)) {
      sc.flank = 0.58 + 0.3 * T.flank;
    }
    if (s.disturbance) {
      sc.investigate = 0.25 + 0.5 * this.memory.disturbanceScore(s.disturbance, s.tick);
      const age = s.tick - s.disturbance.tick;
      if (!s.target && T.patience * T.stealth > 0.35 && age < 90 && s.disturbance.near && s.disturbance.kind === 'sound') {
        sc.ambush = 0.35 + 0.5 * T.patience * T.stealth;
      }
    }
    if (s.lost && s.tick - s.lost.lastSeen < this.diff.memorySec * 30) sc.search = 0.42 + 0.15 * T.patience + 0.1 * T.aggression;
    if (s.target) {
      sc.investigate *= 0.3;
      sc.search *= 0.3;
      sc.ambush = 0;
      sc.hunt = 0;
    }
    for (const [g, until] of this.cooldown) if (s.tick < until) sc[g] = 0;
    return sc;
  }

  private think(_obs: Observation, self: TankView, tac: TacCtx, tick: number): void {
    const s = this.assess(_obs, self, tac, tick);
    this.sit = s;
    const scores = this.scoreGoals(s);
    const age = tick - this.goalSince;
    const commit = this.goal ? (age < 24 ? 0.22 : 0.12) : 0;
    let bestG: GoalName = 'hunt';
    let bestV = -1;
    for (const g of Object.keys(scores) as GoalName[]) {
      const v = scores[g] + (g === this.goal ? commit : 0);
      if (v > bestV) {
        bestV = v;
        bestG = g;
      }
    }
    // Commitment: keep running the current plan unless something clearly better appears.
    if (this.goal === bestG && this.run) return;
    if (this.goal && this.run && scores[this.goal] > 0 && bestG !== this.goal && bestV < scores[this.goal] + commit) return;
    this.adopt(bestG, s, tac, tick);
  }

  private adopt(goal: GoalName, s: BotSituation, tac: TacCtx, tick: number): void {
    const start: Symbols = {
      hasShot: s.hasShot,
      weaponReady: s.ready,
      inCover: !s.exposed,
      smokeReady: s.smokeReady,
      safe: !s.exposed && !s.underFire,
    };
    const p = plan(start, GOAL_STATE[goal], ACTIONS, s);
    if (!p || p.length === 0) {
      this.cooldown.set(goal, tick + (p ? 20 : 45));
      this.goal = null;
      this.run = null;
      if (goal !== 'hunt') this.adopt('hunt', s, tac, tick);
      return;
    }
    if (goal !== this.goal) {
      this.goalSince = tick;
      this.announce(goal, s);
    }
    this.goal = goal;
    this.planDefs = p;
    this.planNames = p.map((a) => a.name);
    this.step = 0;
    this.motor.fire = null;
    this.startAction(tac, tick);
  }

  private startAction(tac: TacCtx, tick: number): void {
    const def = this.planDefs[this.step];
    if (!def) {
      this.run = null;
      return;
    }
    this.run = { name: def.name, started: tick };
    const st = this.startExec(this.run, tac, tick);
    if (st === 'fail') this.fail(tick);
  }

  private fail(tick: number): void {
    if (this.goal) this.cooldown.set(this.goal, tick + 40);
    this.goal = null;
    this.run = null;
    this.motor.fire = null;
    this.motor.stop();
  }

  private execute(self: TankView, tac: TacCtx, tick: number): void {
    if (!this.run || !this.sit) return;
    const st = this.tickExec(this.run, self, tac, tick);
    if (st === 'run') return;
    if (st === 'fail') {
      this.fail(tick);
      return;
    }
    this.step++;
    if (this.step >= this.planDefs.length) {
      if (this.goal === 'flank' && this.orders.focus) this.flankDone = this.orders.focus.id;
      this.goal = null;
      this.run = null;
      this.motor.fire = null;
      return;
    }
    this.startAction(tac, tick);
  }

  // ---------------------------------------------------------------- reflexes
  private reflexes(obs: Observation, self: TankView, tick: number): void {
    const react = this.memory.reactionTicks(false);
    const chance = clamp(this.diff.dodgeChance + (this.traits.reflex - 0.5) * 0.6, 0, 1);
    for (const p of obs.projectiles) {
      if (p.team === this.team) continue;
      const tr = this.memory.shells.get(p.id);
      if (!tr || tr.decided || tick - tr.firstSeen < Math.min(react, 9)) continue;
      // Closest approach assuming we keep our velocity.
      const rx = self.x - p.x;
      const ry = self.y - p.y;
      const ux = self.vx - p.vx;
      const uy = self.vy - p.vy;
      const uu = ux * ux + uy * uy;
      if (uu < 1) continue;
      const tc = -(rx * ux + ry * uy) / uu;
      if (tc <= 0 || tc > 1.3) continue;
      const mx = rx + ux * tc;
      const my = ry + uy * tc;
      const miss = Math.hypot(mx, my);
      if (miss > TUNING.tank.radius + 14) continue;
      tr.decided = true;
      if (this.rng.next() > chance) continue;
      const sp = Math.hypot(p.vx, p.vy);
      let px = -p.vy / sp;
      let py = p.vx / sp;
      if (px * mx + py * my < 0) {
        px = -px;
        py = -py;
      }
      if (!this.nav.isWalkable({ x: self.x + px * 40, y: self.y + py * 40 })) {
        px = -px;
        py = -py;
      }
      // Veer: sideways plus a component along the shell travel to cut the closing speed.
      const dx = px + (p.vx / sp) * 0.75;
      const dy = py + (p.vy / sp) * 0.75;
      this.motor.dodge = { dir: { x: dx, y: dy }, until: tick + Math.ceil(tc * 30) + 6 };
    }
  }

  // ---------------------------------------------------------------- callouts
  private say(text: string, tick: number, force = false): void {
    if (!force && tick - this.lastSay < 120) return;
    if (this.chatter.some((c) => c.text === text && tick - c.tick < 300)) return;
    this.lastSay = tick;
    this.chatter.push({ text, tick });
    if (this.chatter.length > 8) this.chatter.shift();
  }

  private announce(goal: GoalName, s: BotSituation): void {
    const where = (p: Vec) => nearestLandmarkName(this.map, p);
    switch (goal) {
      case 'engage':
        if (s.target) this.say(`Contact near ${where(s.target)}!`, s.tick);
        break;
      case 'flank':
        if (s.orders.focus) this.say(`Flanking — going wide of ${where(s.orders.focus)}.`, s.tick, true);
        break;
      case 'retreat':
        this.say(s.smokeReady ? 'Taking heavy damage, popping smoke!' : 'I’m hurt, falling back!', s.tick, true);
        break;
      case 'investigate':
        if (s.disturbance) this.say(s.disturbance.kind === 'track' ? `Fresh tracks by ${where(s.disturbance)}, checking.` : `Heard something toward ${where(s.disturbance)}.`, s.tick);
        break;
      case 'search':
        if (s.lost) this.say(`Lost them near ${where(s.lost)}. Sweeping.`, s.tick);
        break;
      case 'ambush':
        this.say('Holding here. Let them come to me.', s.tick);
        break;
      case 'reposition':
        this.say('Reloading — moving to cover.', s.tick);
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- action executors
  private aimAtTarget(s: BotSituation, charge: number, err: number): Vec {
    const t = s.target!;
    const speed = shotStats(charge).speed;
    const lead = this.diff.leadSkill;
    const p = interceptPoint(s.pos, t, { x: t.vx * lead, y: t.vy * lead }, speed, TUNING.cannon.muzzleDistance);
    const a = Math.atan2(p.y - s.pos.y, p.x - s.pos.x) + err;
    const d = Math.hypot(p.x - s.pos.x, p.y - s.pos.y);
    return { x: s.pos.x + Math.cos(a) * d, y: s.pos.y + Math.sin(a) * d };
  }

  private jink(s: BotSituation, tick: number, freq = 1): void {
    if (!s.target) return;
    if (tick >= this.jinkUntil) {
      this.jinkDir = this.rng.next() < 0.5 ? 1 : -1;
      this.jinkUntil = tick + Math.round((18 + this.rng.next() * 26) / freq);
    }
    const dx = s.target.x - s.pos.x;
    const dy = s.target.y - s.pos.y;
    const l = Math.hypot(dx, dy) || 1;
    let px = (-dy / l) * this.jinkDir;
    let py = (dx / l) * this.jinkDir;
    // keep preferred range while strafing
    const want = this.traits.preferredRange - (s.orders.push ? 90 : 0);
    const radial = clamp((l - want) / 200, -0.6, 0.6);
    px += (dx / l) * radial;
    py += (dy / l) * radial;
    if (!this.nav.isWalkable({ x: s.pos.x + px * 36, y: s.pos.y + py * 36 })) {
      this.jinkDir *= -1;
      px = -px;
      py = -py;
    }
    this.motor.strafe = { x: px, y: py };
  }

  private lookAround(run: ActionRun, s: BotSituation, tick: number, centre: Vec | null): void {
    run.sweepBase ??= centre ? Math.atan2(centre.y - s.pos.y, centre.x - s.pos.x) : s.self.turret;
    const a = run.sweepBase + Math.sin((tick - run.started) / 14) * 1.3;
    this.motor.aim = { x: s.pos.x + Math.cos(a) * 200, y: s.pos.y + Math.sin(a) * 200 };
  }

  private moveOpts(s: BotSituation, extra: { silentNear?: Vec; exposure?: number; brush?: number } = {}) {
    const silent = !!extra.silentNear && this.traits.stealth > 0.5 && Math.hypot(extra.silentNear.x - s.pos.x, extra.silentNear.y - s.pos.y) < 420;
    return {
      threats: s.threats.slice(0, 3),
      exposureWeight: extra.exposure ?? 1 + 3 * this.traits.caution,
      brushBias: extra.brush ?? -0.15 * this.traits.stealth,
      silent,
    };
  }

  private startExec(run: ActionRun, tac: TacCtx, tick: number): Status {
    const s = this.sit!;
    const T = this.traits;
    switch (run.name) {
      case 'approach': {
        if (!s.target) return 'fail';
        const pref = T.preferredRange + (s.orders.role === 'support' ? 90 : s.orders.role === 'pressure' ? -40 : 0) - (s.orders.push ? 100 : 0);
        run.spot = findFiringSpot(tac, s.target, {
          from: s.pos,
          preferredRange: pref,
          otherThreats: s.threats.filter((t) => Math.hypot(t.x - s.target!.x, t.y - s.target!.y) > 40),
          claimed: s.orders.claimed,
        });
        if (!run.spot) return 'fail';
        this.motor.goTo(run.spot, this.moveOpts(s, { exposure: 1.5 }));
        return 'run';
      }
      case 'tap':
      case 'charge': {
        run.charge = run.name === 'tap' ? 0 : chargeLevel(s, T);
        const sigma = (this.diff.aimSigmaDeg * Math.PI) / 180;
        run.errAngle = this.rng.gauss() * sigma * (s.underFire ? 1.3 : 1) * (s.target && s.lateral > 100 ? 1.2 : 1);
        run.lastSeen = tick;
        return 'run';
      }
      case 'waitReload':
        return 'run';
      case 'takeCover':
      case 'withdraw':
      case 'flee':
      case 'slipAway': {
        const retreat = run.name !== 'takeCover';
        run.spot = findCoverSpot(tac, s.threats, { from: s.pos, claimed: s.orders.claimed, retreat, maxTravel: retreat ? 420 : 300, preferBrush: 0.3 + 0.4 * T.stealth });
        if (!run.spot) return 'fail';
        this.motor.goTo(run.spot, { ...this.moveOpts(s, { exposure: 3 }), silent: false });
        return 'run';
      }
      case 'deploySmoke':
        this.motor.smokeRequest = true;
        this.motor.fire = null;
        run.until = tick + 2;
        return 'run';
      case 'moveFlank': {
        const f = s.orders.focus;
        if (!f || !s.orders.flankAxis) return 'fail';
        run.spot = findFiringSpot(tac, f, {
          from: s.pos,
          preferredRange: T.preferredRange,
          otherThreats: [],
          claimed: s.orders.claimed,
          flankAxis: s.orders.flankAxis,
          flankMinAngle: 1.0,
          maxTravel: 1300,
          brushBonus: 0.4,
        });
        if (!run.spot) return 'fail';
        this.motor.goTo(run.spot, { threats: [f], exposureWeight: 5, brushBias: -0.3, silent: false });
        return 'run';
      }
      case 'goInvestigate': {
        const d = s.disturbance;
        if (!d) return 'fail';
        run.disturbance = d;
        const p = this.nav.nearestWalkable(d);
        if (!p) {
          d.resolved = true;
          return 'fail';
        }
        run.spot = p;
        this.motor.goTo(p, { ...this.moveOpts(s, { exposure: 1 + 2 * T.caution }), threats: [d], arrive: 60 });
        return 'run';
      }
      case 'sweep':
        run.until = tick + 30 + Math.round(T.patience * 40);
        this.motor.stop();
        return 'run';
      case 'search': {
        const c = s.lost;
        if (!c) return 'fail';
        run.contact = c;
        const sp = Math.hypot(c.vx, c.vy);
        const heading = sp > 20 ? { x: c.vx / sp, y: c.vy / sp } : null;
        run.spots = findSearchSpots(tac, c, heading, s.pos, this.rng, 1 + Math.round(T.patience * 2));
        run.i = 0;
        run.until = 0;
        this.motor.goTo(run.spots[0]!, { ...this.moveOpts(s, { silentNear: c }), arrive: 50 });
        return 'run';
      }
      case 'ambush': {
        const d = s.disturbance;
        if (!d) return 'fail';
        run.disturbance = d;
        // Hide near current position facing the disturbance.
        run.spot = findCoverSpot(tac, [d], { from: s.pos, claimed: s.orders.claimed, maxTravel: 180, preferBrush: 1.2 }) ?? s.pos;
        run.until = tick + 90 + Math.round(T.patience * 180);
        this.motor.goTo(run.spot, { ...this.moveOpts(s), silent: true, arrive: 30 });
        return 'run';
      }
      case 'patrol': {
        const p = this.nav.nearestWalkable(s.orders.patrolPoint) ?? s.orders.patrolPoint;
        run.spot = p;
        const enemySide = Math.hypot(p.x - s.pos.x, p.y - s.pos.y) < 500;
        this.motor.goTo(p, { ...this.moveOpts(s), silent: enemySide && T.stealth > 0.75, arrive: 70 });
        return 'run';
      }
    }
    return 'fail';
  }

  private tickExec(run: ActionRun, self: TankView, tac: TacCtx, tick: number): Status {
    const s = this.sit!;
    const elapsed = tick - run.started;
    const target = s.target ? this.memory.contact(s.target.id) ?? null : null;
    if (target) s.target = target;
    switch (run.name) {
      case 'approach': {
        if (!target || !target.visible) return elapsed > 30 ? 'fail' : 'run';
        this.motor.aim = this.aimAtTarget(s, 0.5, 0);
        const d = Math.hypot(target.x - s.pos.x, target.y - s.pos.y);
        if (los(tac, s.pos, target) && d < TUNING.cannon.range - 80 && (this.motor.arrived || d < this.traits.preferredRange + 120)) return 'done';
        if (this.motor.arrived) return los(tac, s.pos, target) ? 'done' : 'fail';
        if (this.motor.failed || elapsed > 180) return 'fail';
        return 'run';
      }
      case 'tap':
      case 'charge': {
        if (!target) return 'fail';
        if (target.visible) run.lastSeen = tick;
        if (tick - (run.lastSeen ?? tick) > 12 || !los(tac, s.pos, target)) {
          this.motor.fire = null; // hold fire: lost the shot (cancels a charge)
          return 'fail';
        }
        this.motor.stop();
        const sup = s.orders.role === 'support' || run.name === 'charge';
        if (!sup || this.traits.aggression > 0.6) this.jink(s, tick, sup ? 0.6 : 1);
        else this.motor.strafe = null;
        const aim = this.aimAtTarget(s, run.charge!, run.errAngle!);
        this.motor.aim = aim;
        const d = Math.hypot(aim.x - s.pos.x, aim.y - s.pos.y);
        this.motor.fire = {
          charge: run.charge!,
          aim,
          tolerance: Math.max(0.02, Math.atan2(9, d)),
          allowCancel: this.rng.next() < this.diff.holdDiscipline,
        };
        if (self.phase === 'charging') run.firedPhaseSeen = true;
        if (self.phase === 'reloading' && (run.firedPhaseSeen || run.charge === 0 || elapsed > 0)) {
          this.motor.fire = null;
          return 'done';
        }
        if (self.phase === 'cancel' || self.phase === 'vent') {
          this.motor.fire = null;
          return 'fail';
        }
        return elapsed > 150 ? 'fail' : 'run';
      }
      case 'waitReload': {
        if (self.phase === 'ready') return 'done';
        if (target) {
          this.motor.aim = this.aimAtTarget(s, 0, 0);
          this.jink(s, tick, 1.2);
        }
        return elapsed > 60 ? 'fail' : 'run';
      }
      case 'takeCover':
      case 'withdraw':
      case 'flee':
      case 'slipAway': {
        if (target) this.motor.aim = this.aimAtTarget(s, 0, 0);
        if (this.motor.arrived) return 'done';
        if (this.motor.failed) return 'fail';
        return elapsed > 150 ? 'done' : 'run';
      }
      case 'deploySmoke':
        return tick >= (run.until ?? 0) ? 'done' : 'run';
      case 'moveFlank': {
        const f = s.orders.focus;
        if (f) this.motor.aim = { x: f.x, y: f.y };
        if (run.spot) this.motor.silent = this.traits.stealth > 0.45 && Math.hypot(run.spot.x - s.pos.x, run.spot.y - s.pos.y) < 260;
        if (target && target.visible && los(tac, s.pos, target) && Math.hypot(target.x - s.pos.x, target.y - s.pos.y) < 470) return 'done';
        if (this.motor.arrived) return 'done';
        if (this.motor.failed) return 'fail';
        return elapsed > 420 ? 'fail' : 'run';
      }
      case 'goInvestigate': {
        const d = run.disturbance!;
        if (d.resolved) return 'done';
        this.lookAround(run, s, tick, d);
        this.motor.silent = this.traits.stealth > 0.55 && Math.hypot(d.x - s.pos.x, d.y - s.pos.y) < 400;
        if (this.motor.arrived || Math.hypot(d.x - s.pos.x, d.y - s.pos.y) < 90) return 'done';
        if (this.motor.failed) {
          d.resolved = true;
          return 'fail';
        }
        return elapsed > 450 ? 'fail' : 'run';
      }
      case 'sweep': {
        this.lookAround(run, s, tick, null);
        if (tick >= (run.until ?? 0)) {
          const d = run.disturbance ?? s.disturbance;
          this.memory.resolveNear(s.pos.x, s.pos.y, 260);
          if (d) d.resolved = true;
          return 'done';
        }
        return 'run';
      }
      case 'search': {
        const spots = run.spots!;
        const i = run.i!;
        const spot = spots[i]!;
        if (run.until && tick < run.until) {
          this.lookAround(run, s, tick, null);
          return 'run';
        }
        if (run.until && tick >= run.until) {
          run.i = i + 1;
          run.until = 0;
          run.sweepBase = undefined;
          if (run.i >= spots.length) {
            if (run.contact) run.contact.searched = true;
            this.memory.resolveNear(spot.x, spot.y, 300);
            this.say('Nothing here.', tick);
            return 'done';
          }
          this.motor.goTo(spots[run.i]!, { ...this.moveOpts(s, { silentNear: spots[run.i] }), arrive: 50 });
          return 'run';
        }
        this.motor.aim = { x: spot.x + (spot.x - s.pos.x), y: spot.y + (spot.y - s.pos.y) };
        if (this.motor.arrived || Math.hypot(spot.x - s.pos.x, spot.y - s.pos.y) < 60) {
          run.until = tick + 20 + Math.round(this.traits.patience * 30);
          this.motor.stop();
          return 'run';
        }
        if (this.motor.failed) {
          run.until = tick + 1;
          return 'run';
        }
        return elapsed > 600 ? 'done' : 'run';
      }
      case 'ambush': {
        const d = run.disturbance!;
        this.motor.aim = { x: d.x, y: d.y };
        this.motor.silent = true;
        if (tick >= (run.until ?? 0)) {
          d.resolved = true;
          return 'done';
        }
        if (this.motor.failed) this.motor.stop();
        return 'run';
      }
      case 'patrol': {
        if (this.motor.dest && run.spot) this.lookAround(run, s, tick, run.spot);
        if (this.motor.arrived) return 'done';
        if (this.motor.failed) return 'fail';
        return elapsed > 600 ? 'done' : 'run';
      }
    }
    return 'fail';
  }
}

function chargeLevel(s: BotSituation, T: Traits): number {
  const base = clamp((s.dist - 180) / 420, 0.35, 1);
  return clamp(base + T.chargeBias * 0.25 - (s.targetAimingAtUs ? 0.15 : 0), 0.35, 1);
}

// ------------------------------------------------------------------ GOAP action set
const ACTIONS: ActionDef<BotSituation>[] = [
  { name: 'approach', pre: {}, eff: { hasShot: true }, cost: (s) => 1.5 + (s.exposed ? 0.5 : 0) },
  {
    name: 'waitReload',
    pre: {},
    eff: { weaponReady: true },
    valid: (s) => !s.ready,
    cost: (s) => 1 + (s.exposed ? 1 : 0),
  },
  {
    name: 'tap',
    pre: { hasShot: true, weaponReady: true },
    eff: { targetHurt: true },
    cost: (s) => {
      let c = 1 + (Math.max(0, s.dist - 250) / 250) * 0.8;
      if (s.dist < 200) c -= 0.5;
      if (s.lateral > 120) c -= 0.25;
      if (s.targetAimingAtUs && s.dist < 360) c -= 0.4;
      if (s.target && s.target.hp <= 22) c -= 0.7;
      if (s.orders.flankerEnRoute && s.orders.role === 'pressure') c -= 0.3;
      c += s.chargeBias * 0.4;
      return c;
    },
  },
  {
    name: 'charge',
    pre: { hasShot: true, weaponReady: true },
    eff: { targetHurt: true },
    cost: (s) => {
      let c = 1.3 - (Math.max(0, s.dist - 300) / 300) * 0.8;
      if (s.dist < 220) c += 0.8;
      if (s.exposed && s.threats.length > 1) c += 0.6;
      if (s.targetAimingAtUs && s.dist < 400) c += 0.4;
      if (s.orders.role === 'support') c -= 0.3;
      c += 0.3 - s.chargeBias * 0.7;
      if (s.target && s.target.phase !== 'charging' && Math.hypot(s.target.vx, s.target.vy) < 40) c -= 0.4;
      return c;
    },
  },
  { name: 'takeCover', pre: {}, eff: { inCover: true }, cost: (s) => 1.5 + Math.max(0, s.threats.length - 1) * 0.8 },
  {
    name: 'deploySmoke',
    pre: { smokeReady: true },
    eff: { concealed: true, smokeReady: false },
    valid: (s) => s.smokeReady && s.threats.length > 0 && (s.exposed || s.underFire) && s.dist < 520,
    cost: (s) => {
      // Difficulty/persona gate expressed as cost: rarely used by easy bots or the reckless.
      let c = 2.9 + (1 - s.smokeWill) * 2.5;
      if (s.dist < 320 || s.underFire) c -= 0.6;
      if (s.hp < 0.35) c -= 0.4;
      if (s.threats.length > 1) c -= 0.4;
      return c;
    },
  },
  { name: 'slipAway', pre: { concealed: true }, eff: { inCover: true }, cost: () => 0.8 },
  { name: 'withdraw', pre: { concealed: true }, eff: { safe: true }, cost: () => 1 },
  { name: 'flee', pre: {}, eff: { safe: true }, cost: (s) => 2.6 + (s.exposed ? 0.8 : 0) },
  { name: 'moveFlank', pre: {}, eff: { atFlank: true }, cost: () => 1 },
  { name: 'goInvestigate', pre: {}, eff: { atPoint: true }, cost: () => 1 },
  { name: 'sweep', pre: { atPoint: true }, eff: { investigated: true }, cost: () => 1 },
  { name: 'search', pre: {}, eff: { searched: true }, cost: () => 1 },
  { name: 'ambush', pre: {}, eff: { ambushSet: true }, cost: () => 1 },
  { name: 'patrol', pre: {}, eff: { patrolled: true }, cost: () => 1 },
];

/** Smoke willingness differs by difficulty & caution; applied by the controller as a cost tweak. */
export function smokeWillingness(diff: DifficultyProfile, traits: Traits): number {
  return diff.smokeUse * (0.4 + traits.caution * 0.6);
}
