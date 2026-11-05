import { harness } from '../../tests/aiharness';
import { mapWith } from '../../tests/helpers';
import { neutralInput } from '../../src/sim/types';
const rows = ['#'.repeat(60)];
for (let r = 0; r < 38; r++) rows.push('#' + '.'.repeat(28) + (r > 8 && r < 30 ? '#' : '.') + '.'.repeat(29) + '#');
rows.push('#'.repeat(60));
const h = harness(mapWith(rows), [
  { name: 'bot', team: 0, isBot: true, pos: { x: 700, y: 640 } },
  { name: 'sniper', team: 1, isBot: false, pos: { x: 1300, y: 640 } },
]);
const bot = h.controllers[0]!.bot(0);
for (let i = 0; i < 240; i++) {
  const tick = h.world.tick;
  h.step(tick % 60 === 0 ? { 1: { ...neutralInput(1300, 1200), firePressed: true, fireReleased: true } } : { 1: neutralInput(1300, 1200) });
  if (i % 15 === 0) {
    const t = h.world.tank(0);
    console.log(i, t.pos.x.toFixed(0), t.pos.y.toFixed(0), bot.goal, bot.planNames.join('>'), JSON.stringify(bot.memory.disturbances.map(d=>[d.kind,d.x|0,d.y|0,d.resolved])), 'dest', JSON.stringify(bot.motor.dest), bot.motor.failed, bot.motor.arrived, 'sounds', JSON.stringify(h.observers[0].observe(h.world).sounds));
  }
}
