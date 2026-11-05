import { LocalSession } from '../../src/game/session';
import { neutralInput } from '../../src/sim/types';
const s = new LocalSession({ teamSize: 1, difficulty: 'normal', playerName: 'You', seed: 3, countdown: 0, training: true });
console.log(s.world.tanks.map(t => [t.name, t.team, Math.round(t.pos.x), Math.round(t.pos.y)]));
const p = s.world.tank(0).pos;
s.advance(3, () => neutralInput(p.x, p.y));
console.log(s.world.tanks.map(t => [t.name, Math.round(t.pos.x), Math.round(t.pos.y), t.alive]), s.world.tick, s.world.match.phase);
