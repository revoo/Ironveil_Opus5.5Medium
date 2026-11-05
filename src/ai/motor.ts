// Motor layer: turns high-level intents (go there, aim here, fire with charge c, dodge)
// into the same TankInput a human produces. Movement is quantised to 8 directions like WASD.
import { angleDiff, type Vec } from '../sim/math';
import type { TankView } from '../sim/observation';
import type { TankInput } from '../sim/types';
import type { Rng } from '../sim/rng';
import type { NavGrid, PathOptions } from './nav';
import { TUNING } from '../sim/tuning';

export interface MoveOpts extends PathOptions {
  silent?: boolean;
  arrive?: number;
}

export interface FireOrder {
  /** Desired charge fraction (0 = tap). */
  charge: number;
  aim: Vec;
  /** Angular tolerance (rad) for releasing. */
  tolerance: number;
  /** When the hold window is about to vent and aim is poor: cancel instead of forcing it. */
  allowCancel: boolean;
}

const OCT = Math.PI / 4;

export class Motor {
  dest: Vec | null = null;
  arrived = false;
  failed = false;
  aim: Vec = { x: 0, y: 0 };
  fire: FireOrder | null = null;
  strafe: Vec | null = null;
  dodge: { dir: Vec; until: number } | null = null;
  smokeRequest = false;
  cancelRequest = false;
  silent = false;
  path: Vec[] = [];
  private opts: MoveOpts = {};
  private idx = 0;
  private needPlan = false;
  private lastPlanTick = -999;
  private holding = false;
  private progress = { x: 0, y: 0, tick: 0 };
  private stuckCount = 0;
  private unstick: { dir: Vec; until: number } | null = null;

  constructor(
    private nav: NavGrid,
    private rng: Rng,
  ) {}

  goTo(p: Vec, opts: MoveOpts = {}): void {
    const changed = !this.dest || Math.hypot(this.dest.x - p.x, this.dest.y - p.y) > 40;
    this.opts = opts;
    this.silent = !!opts.silent;
    if (changed) {
      this.dest = { x: p.x, y: p.y };
      this.arrived = false;
      this.failed = false;
      this.needPlan = true;
      this.stuckCount = 0;
    }
  }

  stop(): void {
    this.dest = null;
    this.path = [];
    this.arrived = false;
    this.failed = false;
    this.strafe = null;
  }

  get pathTarget(): Vec | null {
    return this.path[this.idx] ?? null;
  }

  produce(self: TankView, tick: number): TankInput {
    const pos = { x: self.x, y: self.y };
    let move: Vec | null = null;

    if (this.dodge && tick < this.dodge.until) move = this.dodge.dir;
    else this.dodge = null;

    if (!move && this.unstick && tick < this.unstick.until) move = this.unstick.dir;
    else if (this.unstick && tick >= this.unstick.until) this.unstick = null;

    if (!move && this.dest && !this.arrived && !this.failed) move = this.follow(self, pos, tick);
    if (!move && this.strafe) move = this.strafe;
    if (!move) {
      const sp = Math.hypot(self.vx, self.vy);
      if (sp > 35) move = { x: -self.vx / sp, y: -self.vy / sp };
    }

    // Quantise like a keyboard.
    let mx = 0;
    let my = 0;
    if (move && Math.hypot(move.x, move.y) > 1e-3) {
      const a = Math.round(Math.atan2(move.y, move.x) / OCT) * OCT;
      mx = Math.round(Math.cos(a));
      my = Math.round(Math.sin(a));
    }

    // Trigger discipline.
    let press = false;
    let release = false;
    let cancel = this.cancelRequest;
    this.cancelRequest = false;
    const charging = self.phase === 'charging';
    if (this.fire) {
      const f = this.fire;
      const want = Math.atan2(f.aim.y - self.y, f.aim.x - self.x);
      const err = Math.abs(angleDiff(self.turret, want));
      const aimed = err <= f.tolerance;
      if (self.phase === 'ready' && !this.holding) {
        if (f.charge <= 0.04) {
          if (aimed) {
            press = true;
            release = true;
          }
        } else if (err < 0.7) {
          press = true;
          this.holding = true;
        }
      } else if (charging && this.holding) {
        if (self.charge >= f.charge - 1e-3 && aimed) {
          release = true;
          this.holding = false;
        } else if (self.hold !== null && self.hold <= 4) {
          if (aimed || !f.allowCancel) release = true;
          else cancel = true;
          this.holding = false;
        }
      } else if (this.holding && !charging) {
        this.holding = false;
      }
    } else if (this.holding) {
      if (charging) cancel = true;
      this.holding = false;
    }
    if (cancel) this.holding = false;

    const smoke = this.smokeRequest;
    this.smokeRequest = false;

    return {
      moveX: mx,
      moveY: my,
      aimX: this.aim.x,
      aimY: this.aim.y,
      fireHeld: this.holding,
      firePressed: press,
      fireReleased: release,
      cancel,
      smoke,
      silent: this.silent,
    };
  }

  private follow(self: TankView, pos: Vec, tick: number): Vec | null {
    const dest = this.dest!;
    if (this.needPlan || (this.path.length === 0 && tick - this.lastPlanTick > 10)) {
      if (tick - this.lastPlanTick >= 4 || this.needPlan) {
        this.lastPlanTick = tick;
        this.needPlan = false;
        const p = this.nav.findPath(pos, dest, this.opts);
        if (!p) {
          this.failed = true;
          return null;
        }
        this.path = p;
        this.idx = 0;
        this.progress = { x: pos.x, y: pos.y, tick };
      }
    }
    if (this.path.length === 0) return null;

    // Advance along the path.
    while (this.idx < this.path.length - 1) {
      const wp = this.path[this.idx]!;
      if (Math.hypot(wp.x - pos.x, wp.y - pos.y) < 30) this.idx++;
      else if ((tick + self.id) % 6 === 0 && this.nav.straightWalkable(pos, this.path[this.idx + 1]!)) this.idx++;
      else break;
    }
    const wp = this.path[this.idx]!;
    const final = this.idx === this.path.length - 1;
    const dx = wp.x - pos.x;
    const dy = wp.y - pos.y;
    const d = Math.hypot(dx, dy);
    const arrive = this.opts.arrive ?? 22;
    const sp = Math.hypot(self.vx, self.vy);
    if (final && d < arrive) {
      this.arrived = true;
      return sp > 35 ? { x: -self.vx / sp, y: -self.vy / sp } : null;
    }

    // Stuck detection.
    if (tick - this.progress.tick >= 30) {
      const moved = Math.hypot(pos.x - this.progress.x, pos.y - this.progress.y);
      this.progress = { x: pos.x, y: pos.y, tick };
      if (moved < 14) {
        this.stuckCount++;
        if (this.stuckCount >= 4) {
          this.failed = true;
          return null;
        }
        const a = Math.atan2(dy, dx) + (this.rng.next() < 0.5 ? 1 : -1) * (Math.PI / 2 + this.rng.next() * 0.8);
        this.unstick = { dir: { x: Math.cos(a), y: Math.sin(a) }, until: tick + 12 };
        this.needPlan = true;
      } else this.stuckCount = 0;
    }

    const top = TUNING.movement.maxSpeed * (this.silent ? TUNING.movement.silentFactor : 1);
    const target = final ? Math.min(top, Math.sqrt(2 * 520 * Math.max(0, d - 6))) : top;
    const dvx = (dx / d) * target - self.vx;
    const dvy = (dy / d) * target - self.vy;
    if (Math.hypot(dvx, dvy) < 28) return { x: dx / d, y: dy / d };
    return { x: dvx, y: dvy };
  }
}
