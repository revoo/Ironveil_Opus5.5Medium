// Local solo host: owns the authoritative World, both bot controllers and the player's team
// observer. Fixed-step 30 Hz with an accumulator; presentation interpolates prevObs -> obs.
// The presentation layer only ever sees the player's team Observation.
import { World } from '../sim/world';
import { TeamObserver, type Observation, type ObsEvent } from '../sim/observation';
import type { SoundCue } from '../sim/sound';
import { BotController, type RadioLine } from '../ai/controller';
import { CALLSIGNS, type Difficulty } from '../ai/personality';
import { relayYard } from '../content/relayYard';
import { neutralInput, type TankInput, type Team } from '../sim/types';
import { DT } from '../sim/tuning';
import { hashString, Rng } from '../sim/rng';
import type { GameMap } from '../sim/map';
import { DummyController, TrainingTracker, trainingTargetPositions } from './training';

export interface SessionConfig {
  teamSize: number;
  difficulty: Difficulty;
  seed?: number;
  playerName: string;
  countdown?: number;
  killTarget?: number;
  timeLimit?: number;
  /** Guided practice against harmless scripted targets. */
  training?: boolean;
}

export interface TimedEvent {
  tick: number;
  event: ObsEvent;
}

const MAX_STEPS_PER_ADVANCE = 8;

export class LocalSession {
  world!: World;
  map!: GameMap;
  obs!: Observation;
  prevObs!: Observation;
  readonly playerId = 0;
  paused = false;
  /** After resume, held buttons are ignored until released and pressed again. */
  needsFreshInput = false;
  training: TrainingTracker | null = null;
  private dummy: DummyController | null = null;
  private observers!: [TeamObserver, TeamObserver];
  private controllers!: [BotController, BotController];
  private acc = 0;
  private events: TimedEvent[] = [];
  private cues: { tick: number; cue: SoundCue }[] = [];
  private seed: number;
  private botMeta = new Map<number, { persona: string; team: Team }>();

  constructor(readonly cfg: SessionConfig) {
    this.seed = cfg.seed ?? (Date.now() & 0x7fffffff);
    this.start();
  }

  private start(): void {
    const cfg = this.cfg;
    const map = relayYard();
    this.map = map;
    const rng = new Rng(this.seed);
    const pool = [...CALLSIGNS];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    const size = Math.max(1, Math.min(4, cfg.teamSize));
    const tanks: { name: string; team: Team; isBot: boolean; pos?: { x: number; y: number } }[] = [{ name: cfg.playerName, team: 0, isBot: false }];
    if (cfg.training) {
      const targets = trainingTargetPositions(map, map.spawns[0]![0]!);
      ['Target A', 'Mover', 'Hidden'].forEach((name, i) => tanks.push({ name, team: 1, isBot: true, pos: targets[i]! }));
    } else {
      for (let i = 1; i < size; i++) tanks.push({ name: pool.pop()!, team: 0, isBot: true });
      for (let i = 0; i < size; i++) tanks.push({ name: pool.pop()!, team: 1, isBot: true });
    }
    const wc: ConstructorParameters<typeof World>[0] = { map, seed: this.seed, tanks };
    if (cfg.training) {
      wc.killTarget = 999;
      wc.timeLimit = 60 * 60;
      wc.countdown = 0;
    }
    if (cfg.countdown !== undefined) wc.countdown = cfg.countdown;
    if (cfg.killTarget !== undefined) wc.killTarget = cfg.killTarget;
    if (cfg.timeLimit !== undefined) wc.timeLimit = cfg.timeLimit;
    this.world = new World(wc);
    this.observers = [new TeamObserver(0), new TeamObserver(1)];
    const members = (team: Team) =>
      tanks.map((t, id) => ({ t, id })).filter(({ t }) => t.team === team && t.isBot).map(({ t, id }) => ({ id, name: t.name }));
    this.controllers = [
      new BotController({ map, team: 0, seed: this.seed ^ 0x1234, difficulty: cfg.difficulty, members: members(0) }),
      new BotController({ map, team: 1, seed: this.seed ^ 0x4321, difficulty: cfg.difficulty, members: members(1) }),
    ];
    this.training = cfg.training ? new TrainingTracker(this.playerId) : null;
    this.dummy = cfg.training ? new DummyController(tanks.map((t, id) => ({ t, id })).filter(({ t }) => t.team === 1).map(({ id }) => id)) : null;
    if (cfg.training) this.controllers[1] = new BotController({ map, team: 1, seed: 1, difficulty: cfg.difficulty, members: [] });
    this.botMeta.clear();
    for (const c of this.controllers) for (const b of c.allBots()) this.botMeta.set(b.id, { persona: b.personaTitle, team: b.team });
    this.obs = this.observers[0].observe(this.world);
    this.prevObs = this.obs;
    this.acc = 0;
    this.events = [];
    this.cues = [];
    this.paused = false;
  }

  restart(newSeed = true): void {
    if (newSeed) this.seed = (hashString(String(this.seed)) + 1) & 0x7fffffff;
    this.start();
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

  get radio(): RadioLine[] {
    return this.controllers[0].radio;
  }

  botInfo(id: number): { persona: string; team: Team } | undefined {
    return this.botMeta.get(id);
  }

  /** Advance by real elapsed seconds; `sample` is called exactly once per simulated tick. */
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

  private tick(playerInput: TankInput): void {
    if (this.needsFreshInput) {
      if (!playerInput.fireHeld) this.needsFreshInput = false;
      // A charge held through the pause is cancelled, not fired.
      playerInput = { ...playerInput, fireHeld: false, firePressed: false, fireReleased: false, cancel: true };
    }
    const inputs: Record<number, TankInput> = { [this.playerId]: playerInput };
    const enemyObs = this.observers[1].observe(this.world);
    Object.assign(inputs, this.dummy ? this.dummy.update(enemyObs, this.world.tick) : this.controllers[1].update(enemyObs));
    Object.assign(inputs, this.controllers[0].update(this.obs));
    this.world.step(inputs);
    this.prevObs = this.obs;
    this.obs = this.observers[0].observe(this.world);
    for (const e of this.obs.events) this.events.push({ tick: this.obs.tick, event: e });
    this.training?.update(this.obs, this.obs.events);
    for (const c of this.obs.sounds[this.playerId] ?? []) this.cues.push({ tick: this.obs.tick, cue: c });
    if (this.events.length > 500) this.events.splice(0, this.events.length - 500);
    if (this.cues.length > 100) this.cues.splice(0, this.cues.length - 100);
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

  /** Inputs for when the window loses focus: release everything. */
  static idleInput(aimX: number, aimY: number): TankInput {
    return neutralInput(aimX, aimY);
  }
}
