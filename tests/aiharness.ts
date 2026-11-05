import { World, type TankSpec } from '../src/sim/world';
import { TeamObserver } from '../src/sim/observation';
import { BotController, type BotOptions } from '../src/ai/controller';
import type { GameMap } from '../src/sim/map';
import type { TankInput, Team } from '../src/sim/types';

export interface Harness {
  world: World;
  observers: [TeamObserver, TeamObserver];
  controllers: (BotController | null)[];
  step(extra?: Record<number, TankInput>): void;
  run(n: number, extra?: (tick: number) => Record<number, TankInput>): void;
}

/** Builds a world where tanks flagged isBot are driven by per-team BotControllers. */
export function harness(map: GameMap, tanks: (TankSpec & { bot?: Partial<BotOptions['members'][number]> })[], seed = 1, difficulty: BotOptions['difficulty'] = 'normal'): Harness {
  const world = new World({ map, seed, countdown: 0, tanks });
  const observers: [TeamObserver, TeamObserver] = [new TeamObserver(0), new TeamObserver(1)];
  const controllers = ([0, 1] as Team[]).map((team) => {
    const members = tanks
      .map((t, id) => ({ t, id }))
      .filter(({ t }) => t.team === team && t.isBot)
      .map(({ t, id }) => ({ id, name: t.name, ...(t.bot ?? {}) }));
    return members.length ? new BotController({ map, team, seed: seed * 31 + team, difficulty, members }) : null;
  });
  const h: Harness = {
    world,
    observers,
    controllers,
    step(extra = {}) {
      const inputs: Record<number, TankInput> = {};
      for (const team of [0, 1] as Team[]) {
        const obs = observers[team].observe(world);
        const c = controllers[team];
        if (c) Object.assign(inputs, c.update(obs));
      }
      Object.assign(inputs, extra);
      world.step(inputs);
    },
    run(n, extra) {
      for (let i = 0; i < n; i++) h.step(extra ? extra(world.tick) : {});
    },
  };
  return h;
}
