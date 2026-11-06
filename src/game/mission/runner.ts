// Mission trigger evaluation. Pure logic over a small query interface, so it can be unit-tested
// without a World and its state can be snapshotted for checkpoints.
import type { Vec } from '../../sim/math';
import type { Action, Condition, FlagValue, MissionDef, ObjectiveState, TriggerDef } from './types';

/** What the runner may ask about the world. */
export interface MissionQuery {
  tick: number;
  /** Position of a unit by mission id, or the player ("player"); null if destroyed or not present. */
  pos(who: string): Vec | null;
  /** True if the unit existed and has been destroyed. */
  destroyed(unit: string): boolean;
  enemyPositions(): Vec[];
  inZone(zone: string, p: Vec): boolean;
  alarm: boolean;
}

/** What the runner may do. The session implements these. */
export interface MissionEffects {
  run(action: Action): void;
}

export interface RunnerState {
  flags: Record<string, FlagValue>;
  objectives: Record<string, ObjectiveState>;
  /** Trigger id -> tick it last fired. */
  fired: Record<string, number>;
  startTick: number;
}

const TICK_HZ = 30;

export class MissionRunner {
  state: RunnerState;
  /** Repeating triggers: last evaluation result, for rising-edge detection. */
  private wasTrue = new Map<string, boolean>();
  /** Ids of triggers currently being fired, to stop a trigger re-entering itself. */
  private firing = new Set<string>();

  constructor(
    readonly def: MissionDef,
    state?: RunnerState,
  ) {
    this.state = state
      ? structuredClone(state)
      : {
          flags: {},
          objectives: Object.fromEntries(def.objectives.map((o) => [o.id, o.state ?? 'active'])),
          fired: {},
          startTick: 0,
        };
  }

  snapshot(): RunnerState {
    return structuredClone(this.state);
  }

  /** Evaluate every trigger once (call after each simulation tick). */
  update(q: MissionQuery, fx: MissionEffects): void {
    for (const t of this.def.triggers) this.consider(t, q, fx);
  }

  private consider(t: TriggerDef, q: MissionQuery, fx: MissionEffects): void {
    const once = t.once ?? true;
    if (once && t.id in this.state.fired) return;
    if (this.firing.has(t.id)) return;
    const now = this.test(t.when, q);
    const rising = now && !(this.wasTrue.get(t.id) ?? false);
    this.wasTrue.set(t.id, now);
    if (!now || (!once && !rising)) return;
    this.state.fired[t.id] = q.tick;
    this.firing.add(t.id);
    try {
      this.runActions(t.do, fx);
    } finally {
      this.firing.delete(t.id);
    }
  }

  /** Run actions in order. Flag and objective changes are applied here; the rest go to `fx`. */
  runActions(actions: Action[], fx: MissionEffects): void {
    for (const a of actions) {
      if ('setFlag' in a) this.state.flags[a.setFlag] = a.value ?? true;
      else if ('addFlag' in a) {
        const cur = this.state.flags[a.addFlag];
        this.state.flags[a.addFlag] = (typeof cur === 'number' ? cur : 0) + (a.by ?? 1);
      } else if ('objective' in a) this.state.objectives[a.objective] = a.state;
      fx.run(a);
    }
  }

  test(c: Condition, q: MissionQuery): boolean {
    if ('all' in c) return c.all.every((x) => this.test(x, q));
    if ('any' in c) return c.any.some((x) => this.test(x, q));
    if ('not' in c) return !this.test(c.not, q);
    if ('enter' in c) {
      const who = c.who ?? 'player';
      if (who === 'any-enemy') return q.enemyPositions().some((p) => q.inZone(c.enter, p));
      const p = q.pos(who);
      return !!p && q.inZone(c.enter, p);
    }
    if ('destroyed' in c) return (Array.isArray(c.destroyed) ? c.destroyed : [c.destroyed]).every((u) => q.destroyed(u));
    if ('playerDestroyed' in c) return q.pos('player') === null;
    if ('alarm' in c) return q.alarm;
    if ('flag' in c) {
      const v = this.state.flags[c.flag];
      return c.is === undefined ? !!v : v === c.is;
    }
    if ('after' in c) {
      const since = c.since === undefined ? this.state.startTick : this.state.fired[c.since];
      return since !== undefined && q.tick - since >= c.after * TICK_HZ;
    }
    if ('objective' in c) return this.state.objectives[c.objective] === c.is;
    return false;
  }
}
