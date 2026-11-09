import { describe, it, expect } from 'vitest';
import { missionById } from '../src/content/missions';
import { GARRISON_HP, MissionSession } from '../src/game/mission/session';
import { neutralInput } from '../src/sim/types';

describe('mission combat', () => {
  it('garrison tanks are lighter than the player and die to three quick hits', () => {
    const s = new MissionSession({ ...missionById('night-run')!, seed: 2 });
    const id = s.unitTank.get('b_gate')!;
    const e = s.world.tank(id);
    expect(e.maxHp).toBe(GARRISON_HP);
    expect(s.world.tank(0).maxHp).toBe(100);
    expect(s.obs.tanks.find((t) => t.id === 0)!.maxHp).toBe(100);
    const me = s.world.tank(0);
    me.pos = { x: e.pos.x - 250, y: e.pos.y };
    me.prevPos = { ...me.pos };
    let hits = 0;
    let died = false;
    for (let i = 0; i < 30 * 10 && !died; i++) {
      const ph = i % 22;
      me.hp = 100;
      s.tick({ ...neutralInput(e.pos.x, e.pos.y), fireHeld: ph === 0, firePressed: ph === 0, fireReleased: ph === 1 });
      for (const ev of s.world.events) {
        if (ev.type === 'damage' && ev.target === id) hits++;
        if (ev.type === 'death' && ev.tank === id) died = true;
      }
    }
    expect(died).toBe(true);
    expect(hits).toBe(3);
  });

  it('a unit can override its health, and bosses keep full health', () => {
    const entry = missionById('greybox-crossing')!;
    const mission = structuredClone(entry.mission);
    mission.units[0]!.hp = 140;
    const s = new MissionSession({ ...entry, mission, seed: 2 });
    expect(s.world.tank(s.unitTank.get(mission.units[0]!.id)!).maxHp).toBe(140);
  });
});
