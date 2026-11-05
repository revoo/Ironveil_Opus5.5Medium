// Guided training: a checklist that advances as the player demonstrates each skill, and
// harmless scripted practice targets. Uses only the player's team Observation.
import type { Observation, ObsEvent } from '../sim/observation';
import { angleDiff, type Vec } from '../sim/math';
import { circleFree, Terrain, type GameMap } from '../sim/map';
import { neutralInput, type TankInput } from '../sim/types';

export type StepId = 'drive' | 'drift' | 'tap' | 'charge' | 'cancel' | 'hitMoving' | 'smoke' | 'silent' | 'brush';

export interface TrainingStep {
  id: StepId;
  /** {fire},{cancel},{smoke},{silent} are replaced by the current key bindings in the HUD. */
  label: string;
  hint: string;
  done: boolean;
}

export class TrainingTracker {
  steps: TrainingStep[] = [
    { id: 'drive', label: 'Drive around', hint: 'WASD moves you in that direction immediately.', done: false },
    { id: 'drift', label: 'Drift through a turn', hint: 'At speed, switch direction: momentum carries you sideways.', done: false },
    { id: 'tap', label: 'Tap-fire a quick shot', hint: 'Tap {fire}: fast follow-ups, steady damage.', done: false },
    { id: 'charge', label: 'Fire a fully charged shot', hint: 'Hold {fire} until the bar is full, then release. Heavy, fast, but loud.', done: false },
    { id: 'cancel', label: 'Cancel a charge', hint: 'While charging, press {cancel} to abort without firing.', done: false },
    { id: 'hitMoving', label: 'Hit the moving target', hint: 'Lead it: aim where it will be.', done: false },
    { id: 'smoke', label: 'Deploy smoke', hint: 'Press {smoke}: blocks sight for everyone (not shells).', done: false },
    { id: 'silent', label: 'Run silent for two seconds', hint: 'Hold {silent} while moving. Quiet, not invisible — mud still leaves tracks.', done: false },
    { id: 'brush', label: 'Hide in brush', hint: 'Brush hides you beyond close range until you fire.', done: false },
  ];
  private dist = 0;
  private last: Vec | null = null;
  private quietTicks = 0;

  constructor(readonly playerId: number) {}

  isDone(id: StepId): boolean {
    return this.steps.find((s) => s.id === id)!.done;
  }

  current(): TrainingStep | null {
    return this.steps.find((s) => !s.done) ?? null;
  }

  get complete(): boolean {
    return this.steps.every((s) => s.done);
  }

  private mark(id: StepId): void {
    this.steps.find((s) => s.id === id)!.done = true;
  }

  update(obs: Observation, events: ObsEvent[]): void {
    const me = obs.tanks.find((t) => t.id === this.playerId);
    if (!me || !me.alive) {
      this.last = null;
      return;
    }
    if (this.last) this.dist += Math.hypot(me.x - this.last.x, me.y - this.last.y);
    this.last = { x: me.x, y: me.y };
    if (this.dist > 400) this.mark('drive');
    const speed = Math.hypot(me.vx, me.vy);
    if (speed > 120 && Math.abs(angleDiff(Math.atan2(me.vy, me.vx), me.hull)) > 0.6) this.mark('drift');
    this.quietTicks = me.quiet && speed > 10 ? this.quietTicks + 1 : 0;
    if (this.quietTicks >= 45) this.mark('silent');
    if (me.inBrush) this.mark('brush');
    for (const e of events) {
      if (e.type === 'shot' && e.tank === this.playerId) {
        if (e.charge < 0.25) this.mark('tap');
        if (e.charge >= 0.99) this.mark('charge');
      }
      if (e.type === 'cancel' && e.tank === this.playerId) this.mark('cancel');
      if (e.type === 'smoke' && Math.hypot(e.x - me.x, e.y - me.y) < 60) this.mark('smoke');
      if (e.type === 'damage' && e.byUs) {
        const target = obs.tanks.find((t) => t.id === e.target);
        if (target && Math.hypot(target.vx, target.vy) > 60) this.mark('hitMoving');
      }
    }
  }
}

/** Places three practice targets near the player: open ground, a mover, and one in brush. */
export function trainingTargetPositions(map: GameMap, from: Vec): Vec[] {
  const open: Vec[] = [];
  for (const r of [360, 420, 480, 540, 600]) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const p = { x: from.x + Math.cos(a) * r, y: from.y + Math.sin(a) * r };
      if (circleFree(map, p.x, p.y, 70) && open.every((q) => Math.hypot(q.x - p.x, q.y - p.y) > 220)) open.push(p);
    }
  }
  let brush: Vec | null = null;
  let bd = Infinity;
  for (let row = 0; row < map.rows; row++)
    for (let col = 0; col < map.cols; col++) {
      if (map.tiles[row * map.cols + col] !== Terrain.Brush) continue;
      const p = { x: col * map.tile + 16, y: row * map.tile + 16 };
      const d = Math.hypot(p.x - from.x, p.y - from.y);
      if (d > 200 && d < bd && circleFree(map, p.x, p.y, 22)) {
        bd = d;
        brush = p;
      }
    }
  const out = open.slice(0, 2);
  out.push(brush ?? open[2] ?? { x: from.x + 300, y: from.y });
  return out;
}

/** Scripted, harmless targets: index 1 strafes back and forth; none of them ever fires. */
export class DummyController {
  constructor(private ids: number[]) {}
  update(obs: Observation, tickParity: number): Record<number, TankInput> {
    const out: Record<number, TankInput> = {};
    this.ids.forEach((id, i) => {
      const inp = neutralInput(0, 0);
      if (i === 1) inp.moveY = Math.floor(tickParity / 75) % 2 === 0 ? 1 : -1;
      out[id] = inp;
    });
    void obs;
    return out;
  }
}
