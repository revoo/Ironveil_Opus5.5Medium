// Headless soak: run complete bot-vs-bot matches on Relay Yard and print behaviour metrics.
// Usage: npm run soak -- [matches=10] [teamSize=3] [difficulty=normal]
import { relayYard } from '../src/content/relayYard';
import { World } from '../src/sim/world';
import { TeamObserver } from '../src/sim/observation';
import { BotController } from '../src/ai/controller';
import { CALLSIGNS, personaFor, type Difficulty } from '../src/ai/personality';
import { Rng } from '../src/sim/rng';
import type { TankInput, Team } from '../src/sim/types';

const matches = Number(process.argv[2] ?? 10);
const size = Number(process.argv[3] ?? 3);
const difficulty = (process.argv[4] ?? 'normal') as Difficulty;

const goalTicks: Record<string, number> = {};
const actionStarts: Record<string, number> = {};
let totalKills = 0;
let shots = 0;
let hits = 0;
let smokes = 0;
let maxStill = 0;
let tickMs = 0;
let ticksRun = 0;
let tapShots = 0;
let chargedShots = 0;
const results: string[] = [];
const persona: Record<string, { k: number; d: number; n: number }> = {};

for (let m = 0; m < matches; m++) {
  const map = relayYard();
  // Fisher–Yates shuffle so each side gets varied rosters (personas are fixed per callsign).
  const shuffle = new Rng(4242 + m * 977);
  const names = [...CALLSIGNS];
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(shuffle.next() * (i + 1));
    [names[i], names[j]] = [names[j]!, names[i]!];
  }
  const tanks = [0, 1].flatMap((team) => Array.from({ length: size }, (_, i) => ({ name: names[team * size + i]!, team: team as Team, isBot: true })));
  const world = new World({ map, seed: 1000 + m, tanks, countdown: 0 });
  const obs = [new TeamObserver(0), new TeamObserver(1)];
  const ctl = ([0, 1] as Team[]).map(
    (team) => new BotController({ map, team, seed: 77 + m * 13 + team, difficulty, members: tanks.map((t, id) => ({ t, id })).filter(({ t }) => t.team === team).map(({ t, id }) => ({ id, name: t.name })) }),
  );
  const still = new Map<number, { x: number; y: number; since: number }>();
  while (world.match.phase !== 'ended') {
    const t0 = performance.now();
    const inputs: Record<number, TankInput> = {};
    for (const team of [0, 1] as Team[]) Object.assign(inputs, ctl[team]!.update(obs[team]!.observe(world)));
    world.step(inputs);
    tickMs += performance.now() - t0;
    ticksRun++;
    for (const e of world.events) {
      if (e.type === 'shot') {
        shots++;
        if (e.charge < 0.1) tapShots++;
        else chargedShots++;
      }
      if (e.type === 'damage') hits++;
      if (e.type === 'smoke') smokes++;
    }
    for (const c of ctl) for (const b of c.allBots()) if (b.goal) goalTicks[b.goal] = (goalTicks[b.goal] ?? 0) + 1;
    for (const t of world.tanks) {
      if (!t.alive) {
        still.delete(t.id);
        continue;
      }
      const s = still.get(t.id);
      if (!s || Math.hypot(t.pos.x - s.x, t.pos.y - s.y) > 24) still.set(t.id, { x: t.pos.x, y: t.pos.y, since: world.tick });
      else maxStill = Math.max(maxStill, world.tick - s.since);
    }
    if (world.tick > 30 * 60 * 12) break;
  }
  for (const c of ctl) for (const b of c.allBots()) for (const n of b.planNames) actionStarts[n] = (actionStarts[n] ?? 0) + 1;
  totalKills += world.match.scores[0] + world.match.scores[1];
  for (const t of world.tanks) {
    const p = (persona[personaFor(t.name).title] ??= { k: 0, d: 0, n: 0 });
    p.k += t.kills;
    p.d += t.deaths;
    p.n++;
  }
  results.push(`match ${m}: ${world.match.scores.join('-')} winner=${world.match.winner} in ${(world.tick / 30).toFixed(0)}s`);
}

console.log(results.join('\n'));
const totalGoal = Object.values(goalTicks).reduce((a, b) => a + b, 0);
console.log('\nGoal time share:');
for (const [g, n] of Object.entries(goalTicks).sort((a, b) => b[1] - a[1])) console.log(`  ${g.padEnd(12)} ${((100 * n) / totalGoal).toFixed(1)}%`);
console.log('\nPersona kills / deaths per match appearance:');
for (const [k, v] of Object.entries(persona).sort()) console.log(`  ${k.padEnd(10)} ${(v.k / v.n).toFixed(2)} / ${(v.d / v.n).toFixed(2)}  (n=${v.n})`);
const w0 = results.filter((r) => r.includes('winner=0')).length;
const w1 = results.filter((r) => r.includes('winner=1')).length;
console.log(`\nside wins: west ${w0}  east ${w1}  draws ${matches - w0 - w1}`);
console.log(`kills/match ${(totalKills / matches).toFixed(1)}  shots ${shots}  hit rate ${((100 * hits) / Math.max(1, shots)).toFixed(1)}%  tap ${tapShots} / charged ${chargedShots}  smokes ${smokes}`);
console.log(`max stationary ${(maxStill / 30).toFixed(1)}s   mean tick ${(tickMs / ticksRun).toFixed(3)} ms (6 bots incl. perception)`);
