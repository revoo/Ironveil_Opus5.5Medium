// MissionSession: one mission on one level. Owns the World (mission rules), both AI types,
// the trigger runner, delayed radio, real-time choices and checkpoints. Implements the same
// PlayableSession surface as the deathmatch LocalSession, so the client can render either.
import { World } from '../../sim/world';
import { TeamObserver, type Observation } from '../../sim/observation';
import type { SoundCue } from '../../sim/sound';
import { neutralInput, type TankInput } from '../../sim/types';
import { DT, TUNING } from '../../sim/tuning';
import type { Vec } from '../../sim/math';
import type { GameMap } from '../../sim/map';
import { BotController, type RadioLine } from '../../ai/controller';
import { SIMPLE_TUNING, SimpleController, type Posture, type SimpleBark } from '../../ai/simple';
import { degToRad, inZone, loadLevel, zoneCentre, type Level } from '../../level/load';
import type { LevelData } from '../../level/format';
import type { TimedEvent } from '../session';
import { MissionRunner, type MissionQuery, type RunnerState } from './runner';
import type { Action, ChoiceDef, MissionDef, ObjectiveState, PostureDef, UnitDef } from './types';
import { validateMission } from './validate';

export interface MissionSessionConfig {
  mission: MissionDef;
  level: LevelData;
  seed?: number;
}

/** Everything needed to resume from a checkpoint. Positions of surviving enemies reset to their posts. */
export interface Checkpoint {
  marker: string;
  /** World tick when it was taken (the restored World restarts at 0). */
  tick: number;
  runner: RunnerState;
  destroyed: string[];
  spawned: UnitDef[];
  alarm: boolean;
  /** A choice that was still open: it is offered again on restore, so dying can't skip a decision. */
  choice: ChoiceDef | null;
}

export interface ActiveChoice {
  from?: string;
  prompt: string;
  options: string[];
  startedTick: number;
  expiresTick: number;
  defaultIndex: number;
}

export interface MissionOutcome {
  result: 'success' | 'failure';
  text?: string;
  /** `destroyed`: the player's tank was lost; `scripted`: an end action. */
  reason: 'destroyed' | 'scripted';
}

export interface MissionNotice {
  tick: number;
  text: string;
}

const MAX_STEPS_PER_ADVANCE = 8;
const HZ = TUNING.tickHz;

export class MissionSession {
  readonly playerId = 0;
  readonly level: Level;
  world!: World;
  map!: GameMap;
  obs!: Observation;
  prevObs!: Observation;
  paused = false;
  needsFreshInput = false;
  runner!: MissionRunner;
  simple!: SimpleController;
  boss: BotController | null = null;
  choice: ActiveChoice | null = null;
  outcome: MissionOutcome | null = null;
  notices: MissionNotice[] = [];
  lastCheckpoint: Checkpoint | null = null;
  /** Mission unit id -> tank id, and back. */
  readonly unitTank = new Map<string, number>();
  readonly tankUnit = new Map<number, string>();
  private unitDefs = new Map<string, UnitDef>();
  private spawned: UnitDef[] = [];
  private missionRadio: RadioLine[] = [];
  private pendingRadio: { tick: number; line: RadioLine }[] = [];
  private choiceActions: Action[][] = [];
  private choiceDef: ChoiceDef | null = null;
  private pendingCheckpoint: string | null = null;
  private observers!: [TeamObserver, TeamObserver];
  private acc = 0;
  private events: TimedEvent[] = [];
  private cues: { tick: number; cue: SoundCue }[] = [];
  private seed: number;

  constructor(readonly cfg: MissionSessionConfig) {
    this.seed = cfg.seed ?? 1;
    this.level = loadLevel(cfg.level);
    const problems = validateMission(cfg.mission, this.level);
    if (problems.length) throw new Error(`invalid mission "${cfg.mission.id}":\n  - ${problems.join('\n  - ')}`);
    this.start(null);
  }

  get def(): MissionDef {
    return this.cfg.mission;
  }

  // ------------------------------------------------------------------ lifecycle
  private start(cp: Checkpoint | null): void {
    const def = this.def;
    const level = this.level;
    this.map = level.map;
    const startId = cp?.marker ?? def.start ?? level.markersTagged('player-start')[0]!.id;
    const sm = level.marker(startId);
    this.world = new World({
      map: level.map,
      seed: this.seed,
      rules: 'mission',
      countdown: 0,
      tanks: [{ name: def.playerName ?? 'You', team: 0, isBot: false, pos: { x: sm.x, y: sm.y }, ...(sm.facing !== undefined ? { facing: degToRad(sm.facing) } : {}) }],
    });
    this.unitTank.clear();
    this.tankUnit.clear();
    this.unitDefs.clear();
    this.spawned = cp ? structuredClone(cp.spawned) : [];
    this.simple = new SimpleController(level.map, 1, this.seed ^ 0x51, [], def.alarmRadius ? { ...SIMPLE_TUNING, alarmRadius: def.alarmRadius } : SIMPLE_TUNING);
    this.boss = null;
    const destroyed = new Set(cp?.destroyed ?? []);
    for (const u of [...def.units, ...this.spawned]) {
      if (destroyed.has(u.id)) {
        this.unitDefs.set(u.id, u); // remembered so destroyed() conditions stay true
        continue;
      }
      this.addUnit(u, false);
    }
    this.rebuildBoss();

    this.runner = new MissionRunner(def, cp?.runner);
    if (cp) {
      // The new World restarts at tick 0: shift remembered ticks so timers keep their meaning.
      const shift = (t: number) => t - cp.tick;
      this.runner.state.startTick = shift(this.runner.state.startTick);
      for (const k of Object.keys(this.runner.state.fired)) this.runner.state.fired[k] = shift(this.runner.state.fired[k]!);
      if (cp.alarm) this.simple.alarmRaised = true;
      this.restoredDestroyed = destroyed;
    } else this.restoredDestroyed = new Set();

    this.observers = [new TeamObserver(0), new TeamObserver(1)];
    this.obs = this.observers[0].observe(this.world);
    this.prevObs = this.obs;
    this.acc = 0;
    this.events = [];
    this.cues = [];
    this.missionRadio = [];
    this.pendingRadio = [];
    this.choice = null;
    this.choiceActions = [];
    this.choiceDef = null;
    this.outcome = null;
    this.paused = false;
    this.pendingCheckpoint = null;
    if (!cp) this.lastCheckpoint = this.makeCheckpoint(startId);
    else if (cp.choice) this.openChoice(cp.choice);
  }

  /** Units destroyed before the checkpoint we restored from (they have no tank in this World). */
  private restoredDestroyed = new Set<string>();

  /** Retry from the last checkpoint (or the mission start). */
  restart(): void {
    this.start(this.lastCheckpoint);
  }

  /** Resume from a saved checkpoint (e.g. after the client rebuilt its scene). */
  loadCheckpoint(cp: Checkpoint): void {
    this.lastCheckpoint = structuredClone(cp);
    this.start(this.lastCheckpoint);
  }

  restartMission(): void {
    this.lastCheckpoint = null;
    this.start(null);
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.acc = 0;
    this.needsFreshInput = true;
  }

  get alpha(): number {
    return Math.min(1, this.acc / DT);
  }

  // ------------------------------------------------------------------ units
  private posture(p: PostureDef | undefined, u: UnitDef): Posture {
    const level = this.level;
    if (p && 'patrol' in p) {
      const path = level.path(p.patrol);
      return { kind: 'patrol', path: path.points.map((q) => ({ ...q })), loop: !!path.loop };
    }
    if (p && 'hold' in p) {
      const m = level.marker(p.hold);
      return { kind: 'hold', pos: { x: m.x, y: m.y } };
    }
    const m = level.marker(p && 'guard' in p ? p.guard : u.marker);
    return { kind: 'guard', pos: { x: m.x, y: m.y }, facing: degToRad(m.facing ?? 180) };
  }

  private addUnit(u: UnitDef, rebuild = true): void {
    const m = this.level.marker(u.marker);
    const id = this.world.addTank({ name: u.name, team: 1, isBot: true, pos: { x: m.x, y: m.y }, ...(m.facing !== undefined ? { facing: degToRad(m.facing) } : {}) });
    this.unitTank.set(u.id, id);
    this.tankUnit.set(id, u.id);
    this.unitDefs.set(u.id, u);
    if (u.ai === 'simple') this.simple.add({ id, name: u.name, posture: this.posture(u.posture, u), ...(u.skill !== undefined ? { skill: u.skill } : {}) });
    else if (rebuild) this.rebuildBoss();
  }

  /** The tactical controller is built for a fixed squad; rebuild it when bosses join. */
  private rebuildBoss(): void {
    const members = [...this.unitTank]
      .filter(([uid]) => this.unitDefs.get(uid)?.ai === 'boss')
      .map(([uid, id]) => {
        const d = this.unitDefs.get(uid)!;
        return { id, name: d.name, ...(d.persona ? { persona: d.persona } : {}) };
      });
    this.boss = members.length ? new BotController({ map: this.map, team: 1, seed: this.seed ^ 0xb055, difficulty: 'normal', members }) : null;
  }

  // ------------------------------------------------------------------ queries for triggers
  private query(): MissionQuery {
    const w = this.world;
    const pos = (who: string): Vec | null => {
      const id = who === 'player' ? this.playerId : this.unitTank.get(who);
      if (id === undefined) return null;
      const t = w.tanks[id];
      return t && t.alive ? { x: t.pos.x, y: t.pos.y } : null;
    };
    return {
      tick: w.tick,
      pos,
      destroyed: (u) => {
        if (this.restoredDestroyed.has(u)) return true;
        const id = this.unitTank.get(u);
        return id !== undefined && !w.tanks[id]!.alive;
      },
      enemyPositions: () => w.tanks.filter((t) => t.team === 1 && t.alive).map((t) => ({ x: t.pos.x, y: t.pos.y })),
      inZone: (z, p) => inZone(this.level.zone(z), p),
      alarm: this.simple.alarmRaised,
    };
  }

  private placeOf(id: string): Vec {
    const m = this.level.data.markers.find((x) => x.id === id);
    if (m) return { x: m.x, y: m.y };
    return zoneCentre(this.level.zone(id));
  }

  // ------------------------------------------------------------------ actions
  private readonly effects = {
    run: (a: Action): void => {
      const tick = this.world.tick;
      if ('radio' in a) {
        const line = { from: a.from, text: a.radio, tick };
        if (a.delay) this.pendingRadio.push({ tick: tick + Math.round(a.delay * HZ), line });
        else this.pushRadio(line);
      } else if ('objective' in a) this.notice(objectiveNotice(a.state, this.def.objectives.find((o) => o.id === a.objective)?.text ?? a.objective));
      else if ('spawn' in a) {
        for (const u of Array.isArray(a.spawn) ? a.spawn : [a.spawn]) {
          if (this.unitTank.has(u.id)) continue;
          this.spawned.push(structuredClone(u));
          this.addUnit(u);
        }
      } else if ('order' in a) {
        const id = this.unitTank.get(a.order);
        const u = this.unitDefs.get(a.order);
        if (id !== undefined && u) this.simple.setPosture(id, this.posture(a.posture, u));
      } else if ('alarm' in a) {
        const p = this.world.tank(this.playerId).pos;
        this.simple.raiseAlarm(a.at ? this.placeOf(a.at) : { x: p.x, y: p.y }, tick, -1, a.radius ?? Infinity);
      } else if ('repair' in a) this.world.tank(this.playerId).hp = TUNING.tank.maxHp;
      else if ('checkpoint' in a) this.pendingCheckpoint = a.checkpoint;
      else if ('choice' in a) this.openChoice(a.choice);
      else if ('end' in a) this.finish({ result: a.end, reason: 'scripted', ...(a.text ? { text: a.text } : {}) });
    },
  };

  private openChoice(c: ChoiceDef): void {
    const tick = this.world.tick;
    this.choiceDef = structuredClone(c);
    this.choice = {
      ...(c.from ? { from: c.from } : {}),
      prompt: c.prompt,
      options: c.options.map((o) => o.text),
      startedTick: tick,
      expiresTick: tick + Math.round((c.timeout ?? 12) * HZ),
      defaultIndex: c.default ?? 0,
    };
    this.choiceActions = c.options.map((o) => o.do);
  }

  /** Pick an option of the active choice (1-based keys map to 0-based indices in the client). */
  choose(index: number): void {
    if (!this.choice || index < 0 || index >= this.choiceActions.length) return;
    const actions = this.choiceActions[index]!;
    this.choice = null;
    this.choiceActions = [];
    this.choiceDef = null;
    this.runner.runActions(actions, this.effects);
  }

  private pushRadio(line: RadioLine): void {
    this.missionRadio.push(line);
    if (this.missionRadio.length > 40) this.missionRadio.shift();
  }

  private notice(text: string): void {
    this.notices.push({ tick: this.world.tick, text });
    if (this.notices.length > 20) this.notices.shift();
  }

  private finish(o: MissionOutcome): void {
    if (this.outcome) return;
    this.outcome = o;
    this.choice = null;
    this.choiceDef = null;
    this.world.endMission(o.result === 'success' ? 0 : 1);
  }

  private makeCheckpoint(marker: string): Checkpoint {
    const destroyed = [...this.restoredDestroyed];
    for (const [uid, id] of this.unitTank) if (!this.world.tanks[id]!.alive) destroyed.push(uid);
    const runner = this.runner ? this.runner.snapshot() : { flags: {}, objectives: Object.fromEntries(this.def.objectives.map((o) => [o.id, o.state ?? 'active'])), fired: {}, startTick: 0 };
    return { marker, tick: this.world.tick, runner, destroyed, spawned: structuredClone(this.spawned), alarm: this.simple.alarmRaised, choice: this.choiceDef ? structuredClone(this.choiceDef) : null };
  }

  // ------------------------------------------------------------------ HUD helpers
  objectives(): { id: string; text: string; state: ObjectiveState }[] {
    return this.def.objectives.map((o) => ({ id: o.id, text: o.text, state: this.runner.state.objectives[o.id] ?? 'active' })).filter((o) => o.state !== 'hidden');
  }

  /** 0..1, how close any enemy is to spotting you (1 = in combat). */
  detection(): number {
    return this.simple.maxSuspicion();
  }

  /** Crew and mission radio plus intercepted boss chatter. Garrison barks are not radio: the
   *  3D view shows them as speech bubbles over the tank that said them (see `barks`). */
  get radio(): RadioLine[] {
    const boss = this.boss ? this.boss.radio.map((b) => ({ ...b, from: `${b.from} (enemy)` })) : [];
    return [...this.missionRadio, ...boss].sort((a, b) => a.tick - b.tick);
  }

  /** Garrison barks (speaker id, line, tone), for in-world speech bubbles. */
  get barks(): readonly SimpleBark[] {
    return this.simple.barks;
  }

  // ------------------------------------------------------------------ simulation
  advance(dt: number, sample: () => TankInput): number {
    if (this.paused) return 0;
    this.acc += Math.max(0, Math.min(dt, 1));
    let steps = 0;
    while (this.acc >= DT - 1e-9 && steps < MAX_STEPS_PER_ADVANCE) {
      this.acc -= DT;
      this.tick(sample());
      steps++;
    }
    if (steps >= MAX_STEPS_PER_ADVANCE) this.acc = Math.min(this.acc, DT * 0.5);
    if (this.acc < 0) this.acc = 0;
    return steps;
  }

  /** One fixed tick. Public so headless tests and tools can drive a mission directly. */
  tick(playerInput: TankInput = neutralInput()): void {
    if (this.needsFreshInput) {
      if (!playerInput.fireHeld) this.needsFreshInput = false;
      playerInput = { ...playerInput, fireHeld: false, firePressed: false, fireReleased: false };
    }
    const enemyObs = this.observers[1].observe(this.world);
    const inputs: Record<number, TankInput> = { [this.playerId]: playerInput, ...this.simple.update(enemyObs) };
    if (this.boss) Object.assign(inputs, this.boss.update(enemyObs));
    this.world.step(inputs);
    this.prevObs = this.obs;
    this.obs = this.observers[0].observe(this.world);
    for (const e of this.obs.events) this.events.push({ tick: this.obs.tick, event: e });
    for (const c of this.obs.sounds[this.playerId] ?? []) this.cues.push({ tick: this.obs.tick, cue: c });
    if (this.events.length > 500) this.events.splice(0, this.events.length - 500);
    if (this.cues.length > 100) this.cues.splice(0, this.cues.length - 100);
    this.simple.events = [];

    if (this.outcome) return;
    const tick = this.world.tick;
    while (this.pendingRadio.length && this.pendingRadio[0]!.tick <= tick) this.pushRadio({ ...this.pendingRadio.shift()!.line, tick });
    this.pendingRadio.sort((a, b) => a.tick - b.tick);
    if (this.choice && tick >= this.choice.expiresTick) this.choose(this.choice.defaultIndex);
    this.runner.update(this.query(), this.effects);
    if (this.pendingCheckpoint) {
      this.lastCheckpoint = this.makeCheckpoint(this.pendingCheckpoint);
      this.pendingCheckpoint = null;
      this.notice('Checkpoint');
    }
    if (!this.outcome && !this.world.tank(this.playerId).alive) this.finish({ result: 'failure', reason: 'destroyed', text: 'Your tank was destroyed.' });
  }

  drainEvents(): TimedEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  drainCues(): { tick: number; cue: SoundCue }[] {
    const c = this.cues;
    this.cues = [];
    return c;
  }
}

function objectiveNotice(state: ObjectiveState, text: string): string {
  switch (state) {
    case 'active':
      return `New objective: ${text}`;
    case 'complete':
      return `Objective complete: ${text}`;
    case 'failed':
      return `Objective failed: ${text}`;
    default:
      return text;
  }
}
