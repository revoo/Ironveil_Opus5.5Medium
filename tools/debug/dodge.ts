import { harness } from '../../tests/aiharness';
import { openMap } from '../../tests/helpers';
const h = harness(openMap(70, 40), [
  { name: 'bot', team: 0, isBot: true, pos: { x: 400, y: 600 }, bot: { traits: { reflex: 1 } } },
  { name: 'far', team: 1, isBot: false, pos: { x: 1900, y: 1150 } },
], 4, 'hard');
h.run(30);
h.world.projectiles.push({ id: 999, owner: 1, team: 1, pos: { x: 820, y: 600 }, prevPos: { x: 820, y: 600 }, vel: { x: -400, y: 0 }, charge: 0, damage: 22, traveled: 0, range: 900 });
const bot = h.controllers[0]!.bot(0);
for (let i = 0; i < 48; i++) { h.step(); const t = h.world.tank(0); const p = h.world.projectiles[0];
  console.log(i, t.pos.x.toFixed(0), t.pos.y.toFixed(0), t.vel.x.toFixed(0), t.vel.y.toFixed(0), p ? p.pos.x.toFixed(0) : '-', JSON.stringify(bot.motor.dodge), JSON.stringify([...bot.memory.shells.values()]), t.hp); }
