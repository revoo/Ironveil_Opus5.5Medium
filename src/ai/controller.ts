// Per-team bot controller with a squad coordinator (roles, focus, flank axis, claims).
// Receives only that team's Observation.
import type { Vec } from '../sim/math';
import type { GameMap } from '../sim/map';
import type { Observation, TankView } from '../sim/observation';
import type { TankInput, Team } from '../sim/types';
import { neutralInput } from '../sim/types';
import { Rng, hashString } from '../sim/rng';
import { NavGrid } from './nav';
import { Bot, type Role, type SquadOrders } from './bot';
import { DIFFICULTY, individualTraits, personaFor, PERSONAS, type Difficulty, type Traits } from './personality';

export interface BotOptions {
  map: GameMap;
  team: Team;
  seed: number;
  difficulty: Difficulty;
  members: { id: number; name: string; persona?: string; traits?: Partial<Traits> }[];
}

const navCache = new Map<string, { tiles: Uint8Array; nav: NavGrid }>();
function navFor(map: GameMap): NavGrid {
  const key = `${map.id}:${map.version}:${map.cols}x${map.rows}`;
  const hit = navCache.get(key);
  if (hit && hit.tiles.length === map.tiles.length && hit.tiles.every((v, i) => v === map.tiles[i])) return hit.nav;
  const nav = new NavGrid(map);
  navCache.set(key, { tiles: map.tiles.slice(), nav });
  return nav;
}

export interface RadioLine {
  from: string;
  text: string;
  tick: number;
}

export class BotController {
  readonly nav: NavGrid;
  private bots = new Map<number, Bot>();
  private rng: Rng;
  private roleMap = new Map<number, Role>();
  private lastRoleTick = -999;
  private focus: { id: number; x: number; y: number; tick: number } | null = null;
  private patrol = new Map<number, Vec>();
  private patrolSince = new Map<number, number>();
  radio: RadioLine[] = [];

  constructor(private opts: BotOptions) {
    this.nav = navFor(opts.map);
    this.rng = new Rng(opts.seed);
    for (const m of opts.members) {
      const persona = m.persona ? PERSONAS.find((p) => p.id === m.persona) ?? personaFor(m.name) : personaFor(m.name);
      const traits = individualTraits(m.name, persona.traits, m.traits);
      this.bots.set(m.id, new Bot(m.id, opts.team, m.name, persona.title, traits, DIFFICULTY[opts.difficulty], opts.map, this.nav, (opts.seed ^ hashString(m.name)) >>> 0));
    }
  }

  bot(id: number): Bot {
    const b = this.bots.get(id);
    if (!b) throw new Error(`no bot ${id}`);
    return b;
  }

  allBots(): Bot[] {
    return [...this.bots.values()];
  }

  roles(): Record<number, Role> {
    return Object.fromEntries(this.roleMap);
  }

  update(obs: Observation): Record<number, TankInput> {
    const out: Record<number, TankInput> = {};
    const views = new Map<number, TankView>(obs.tanks.map((t) => [t.id, t]));
    if (obs.tick - this.lastRoleTick >= 15) this.coordinate(obs, views);
    for (const [id, bot] of this.bots) {
      const self = views.get(id);
      if (!self) {
        out[id] = neutralInput();
        continue;
      }
      bot.setOrders(this.ordersFor(id, obs, views));
      const before = bot.chatter.length ? bot.chatter[bot.chatter.length - 1] : undefined;
      out[id] = bot.update(obs, self);
      const after = bot.chatter[bot.chatter.length - 1];
      if (after && after !== before) {
        this.radio.push({ from: bot.name, text: after.text, tick: after.tick });
        if (this.radio.length > 20) this.radio.shift();
      }
    }
    return out;
  }

  private coordinate(obs: Observation, views: Map<number, TankView>): void {
    this.lastRoleTick = obs.tick;
    const team = this.opts.team;
    // Focus: most relevant enemy known to the team (visible first, then remembered by bots).
    const friends = obs.tanks.filter((t) => t.team === team && t.alive);
    const centroid = friends.length
      ? { x: friends.reduce((a, t) => a + t.x, 0) / friends.length, y: friends.reduce((a, t) => a + t.y, 0) / friends.length }
      : { x: this.opts.map.width / 2, y: this.opts.map.height / 2 };
    let focus: { id: number; x: number; y: number; tick: number } | null = null;
    let bestD = Infinity;
    for (const t of obs.tanks) {
      if (t.team === team || !t.alive) continue;
      const d = Math.hypot(t.x - centroid.x, t.y - centroid.y);
      if (d < bestD) {
        bestD = d;
        focus = { id: t.id, x: t.x, y: t.y, tick: obs.tick };
      }
    }
    if (!focus) {
      for (const b of this.bots.values()) {
        for (const c of b.memory.contacts.values()) {
          if (obs.tick - c.lastSeen > 150) continue;
          if (!focus || c.lastSeen > focus.tick) focus = { id: c.id, x: c.x, y: c.y, tick: c.lastSeen };
        }
      }
    }
    if (!focus && this.focus && obs.tick - this.focus.tick < 180) focus = this.focus;
    this.focus = focus;

    const alive = [...this.bots.keys()].filter((id) => views.get(id)?.alive);
    const prev = new Map(this.roleMap);
    this.roleMap.clear();
    if (!focus) {
      for (const id of this.bots.keys()) this.roleMap.set(id, 'hunt');
      return;
    }
    const dist = (id: number) => {
      const v = views.get(id)!;
      return Math.hypot(v.x - focus!.x, v.y - focus!.y);
    };
    alive.sort((a, b) => dist(a) - dist(b));
    const humanCloser = friends.some((t) => !t.isBot && Math.hypot(t.x - focus!.x, t.y - focus!.y) < (alive.length ? dist(alive[0]!) : Infinity));
    const diff = DIFFICULTY[this.opts.difficulty];
    let flanker: number | null = null;
    const pool = humanCloser ? alive : alive.slice(1);
    if (pool.length && (alive.length + (humanCloser ? 1 : 0) >= 2) && (diff.flankUse >= 0.5 || this.rng.next() < diff.flankUse)) {
      // Keep an existing flanker for stability.
      flanker = pool.find((id) => prev.get(id) === 'flank') ?? [...pool].sort((a, b) => this.bot(b).traits.flank - this.bot(a).traits.flank)[0]!;
    }
    alive.forEach((id, i) => {
      if (id === flanker) this.roleMap.set(id, 'flank');
      else if (i === 0 && !humanCloser) this.roleMap.set(id, 'pressure');
      else this.roleMap.set(id, 'support');
    });
    for (const id of this.bots.keys()) if (!this.roleMap.has(id)) this.roleMap.set(id, 'hunt');
  }

  private ordersFor(id: number, obs: Observation, views: Map<number, TankView>): SquadOrders {
    const role = this.roleMap.get(id) ?? 'hunt';
    const f = this.focus;
    let flankAxis: Vec | null = null;
    if (f) {
      // Axis from focus toward the pressure element (or squad centroid).
      const pressure = [...this.roleMap].find(([, r]) => r === 'pressure')?.[0];
      const anchor = (pressure !== undefined ? views.get(pressure) : undefined) ?? obs.tanks.find((t) => t.team === this.opts.team && !t.isBot && t.alive) ?? views.get(id);
      if (anchor) {
        const dx = anchor.x - f.x;
        const dy = anchor.y - f.y;
        const l = Math.hypot(dx, dy) || 1;
        flankAxis = { x: dx / l, y: dy / l };
      }
    }
    const flankerEnRoute = [...this.roleMap].some(([bid, r]) => r === 'flank' && this.bots.get(bid)?.goal === 'flank');
    const flankerEngaged = [...this.roleMap].some(([bid, r]) => r === 'flank' && this.bots.get(bid)?.goal === 'engage');
    const claimed: Vec[] = [];
    for (const [bid, b] of this.bots) if (bid !== id && b.claim) claimed.push(b.claim);
    return {
      role,
      focus: f ? { id: f.id, x: f.x, y: f.y } : null,
      flankAxis,
      flankerEnRoute,
      push: flankerEngaged,
      claimed,
      patrolPoint: this.patrolPointFor(id, obs, views),
    };
  }

  /** Spread hunting bots over different landmarks, biased toward the enemy side, rotating over time. */
  private patrolPointFor(id: number, obs: Observation, views: Map<number, TankView>): Vec {
    const map = this.opts.map;
    const cur = this.patrol.get(id);
    const self = views.get(id);
    const since = this.patrolSince.get(id) ?? -9999;
    if (cur && self && Math.hypot(cur.x - self.x, cur.y - self.y) > 90 && obs.tick - since < 30 * 25) return cur;
    const taken = [...this.patrol.entries()].filter(([k]) => k !== id).map(([, v]) => v);
    const enemySpawns = map.spawns[1 - this.opts.team] ?? [];
    const pts: Vec[] = [...map.landmarks.map((l) => ({ x: l.x, y: l.y }))];
    if (enemySpawns[0]) pts.push(enemySpawns[0]);
    if (pts.length === 0) pts.push({ x: map.width / 2, y: map.height / 2 }, { x: map.width * 0.75, y: map.height * 0.3 }, { x: map.width * 0.3, y: map.height * 0.7 });
    let best = pts[0]!;
    let bestS = -Infinity;
    for (const p of pts) {
      let s = this.rng.next() * 1.2;
      if (self) s -= Math.hypot(p.x - self.x, p.y - self.y) / 1800;
      if (cur && Math.hypot(p.x - cur.x, p.y - cur.y) < 100) s -= 2;
      for (const t of taken) if (Math.hypot(t.x - p.x, t.y - p.y) < 300) s -= 1;
      const own = map.spawns[this.opts.team]?.[0];
      if (own && Math.hypot(p.x - own.x, p.y - own.y) < 400) s -= 1.5;
      if (s > bestS) {
        bestS = s;
        best = p;
      }
    }
    this.patrol.set(id, best);
    this.patrolSince.set(id, obs.tick);
    return best;
  }
}
