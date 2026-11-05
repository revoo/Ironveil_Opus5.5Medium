import { describe, it, expect } from 'vitest';
import { World } from '../src/sim/world';
import { TeamObserver } from '../src/sim/observation';
import { sectorOf } from '../src/sim/sound';
import { neutralInput, type TankInput } from '../src/sim/types';
import { openMap, mapWith } from './helpers';
import { TUNING } from '../src/sim/tuning';

type Spec = { name: string; team: 0 | 1; pos: { x: number; y: number } };
const mk = (specs: Spec[], map = openMap(80, 50)) =>
  new World({ map, seed: 5, countdown: 0, tanks: specs.map((s) => ({ ...s, isBot: false })) });

function run(w: World, obs: TeamObserver, n: number, inputs: Record<number, TankInput> = {}) {
  let o = obs.observe(w);
  for (let i = 0; i < n; i++) {
    w.step(inputs);
    o = obs.observe(w);
  }
  return o;
}

describe('team observation filtering', () => {
  it('includes all teammates and only visible enemies', () => {
    const w = mk([
      { name: 'me', team: 0, pos: { x: 200, y: 400 } },
      { name: 'ally', team: 0, pos: { x: 2000, y: 1400 } },
      { name: 'seen', team: 1, pos: { x: 500, y: 400 } },
      { name: 'hidden', team: 1, pos: { x: 1200, y: 400 } },
    ]);
    const o = new TeamObserver(0).observe(w);
    const ids = o.tanks.map((t) => t.id).sort();
    expect(ids).toEqual([0, 1, 2]);
    expect(JSON.stringify(o.tanks)).not.toContain('"hidden"');
  });

  it('keeps a stale last-known marker for 3 s without updating it', () => {
    const w = mk([
      { name: 'me', team: 0, pos: { x: 200, y: 400 } },
      { name: 'b', team: 1, pos: { x: 600, y: 400 } },
    ]);
    const obs = new TeamObserver(0);
    obs.observe(w);
    w.tank(1).pos = { x: 1500, y: 400 }; // teleport out of sight
    w.tank(1).prevPos = { x: 1500, y: 400 };
    let o = run(w, obs, 1);
    expect(o.tanks.find((t) => t.id === 1)).toBeUndefined();
    expect(o.lastKnown).toEqual([expect.objectContaining({ id: 1, x: 600, y: 400 })]);
    w.tank(1).pos = { x: 1700, y: 900 };
    o = run(w, obs, 30);
    expect(o.lastKnown[0]).toMatchObject({ x: 600, y: 400 });
    o = run(w, obs, Math.ceil(TUNING.vision.lastKnownMarker * 30));
    expect(o.lastKnown).toEqual([]);
  });

  it('shows an enemy shell in vision without revealing the hidden shooter', () => {
    const w = mk([
      { name: 'me', team: 0, pos: { x: 1000, y: 400 } },
      { name: 'b', team: 1, pos: { x: 300, y: 400 } },
    ]);
    const obs = new TeamObserver(0);
    for (let i = 0; i < 40; i++) w.step({ 1: neutralInput(1000, 400) });
    w.step({ 1: { ...neutralInput(1000, 400), firePressed: true, fireReleased: true } });
    let o = obs.observe(w);
    expect(o.tanks.some((t) => t.id === 1)).toBe(false);
    expect(o.events.some((e) => e.type === 'shot')).toBe(false);
    // shell enters vision later
    let seen = false;
    for (let i = 0; i < 40 && !seen; i++) {
      w.step({});
      o = obs.observe(w);
      seen = o.projectiles.length > 0;
    }
    expect(seen).toBe(true);
    expect(Object.keys(o.projectiles[0]!).sort()).toEqual(['charge', 'id', 'team', 'vx', 'vy', 'x', 'y']);
  });

  it('turns hidden sounds into coarse sector/band cues with no coordinates', () => {
    const w = mk([
      { name: 'me', team: 0, pos: { x: 1000, y: 800 } },
      { name: 'b', team: 1, pos: { x: 1000 + 500, y: 800 } }, // out of sight, inside shot radius
    ]);
    const obs = new TeamObserver(0);
    w.step({ 1: { ...neutralInput(0, 800), firePressed: true, fireReleased: true } });
    const o = obs.observe(w);
    const cues = o.sounds[0] ?? [];
    expect(cues.length).toBe(1);
    expect(cues[0]).toEqual({ kind: 'shot', sector: 0, band: 'far' });
  });

  it('computes 8 sectors clockwise from east', () => {
    const c = { x: 0, y: 0 };
    expect(sectorOf(c, { x: 10, y: 0 })).toBe(0);
    expect(sectorOf(c, { x: 0, y: 10 })).toBe(2);
    expect(sectorOf(c, { x: -10, y: 0 })).toBe(4);
    expect(sectorOf(c, { x: 0, y: -10 })).toBe(6);
    expect(sectorOf(c, { x: 10, y: 10.5 })).toBe(1);
  });

  it('does not emit hidden cues for visible sources', () => {
    const w = mk([
      { name: 'me', team: 0, pos: { x: 1000, y: 800 } },
      { name: 'b', team: 1, pos: { x: 1200, y: 800 } },
    ]);
    const obs = new TeamObserver(0);
    w.step({ 1: { ...neutralInput(0, 800), firePressed: true, fireReleased: true } });
    const o = obs.observe(w);
    expect(o.sounds[0] ?? []).toEqual([]);
    expect(o.events.some((e) => e.type === 'shot')).toBe(true);
  });

  it('filters impacts at hidden locations', () => {
    const w = mk([
      { name: 'me', team: 0, pos: { x: 200, y: 400 } },
      { name: 'b', team: 1, pos: { x: 1500, y: 400 } },
    ]);
    const obs = new TeamObserver(0);
    for (let i = 0; i < 40; i++) w.step({ 1: neutralInput(1500, 1200) });
    w.step({ 1: { ...neutralInput(1500, 1200), firePressed: true, fireReleased: true } });
    let sawImpact = false;
    for (let i = 0; i < 90; i++) {
      w.step({});
      sawImpact ||= obs.observe(w).events.some((e) => e.type === 'impact');
    }
    expect(sawImpact).toBe(false);
  });
});

describe('mud tracks as evidence', () => {
  function mudWorld() {
    const rows = ['#'.repeat(80)];
    for (let r = 0; r < 40; r++) rows.push('#' + '.'.repeat(30) + '~'.repeat(20) + '.'.repeat(28) + '#');
    rows.push('#'.repeat(80));
    return mk(
      [
        { name: 'me', team: 0, pos: { x: 100, y: 300 } },
        { name: 'b', team: 1, pos: { x: 31 * 32 + 20, y: 1100 } },
      ],
      mapWith(rows),
    );
  }

  it('creates bounded stamps without owner identity', () => {
    const w = mudWorld();
    for (let i = 0; i < 60; i++) w.step({ 1: { ...neutralInput(0, 0), moveX: 1 } });
    const s = w.tracks.stamps;
    expect(s.length).toBeGreaterThan(3);
    expect(s.length).toBeLessThanOrEqual(12); // <= 6 per second
    expect(Object.keys(s[0]!).sort()).toEqual(['axis', 'expiresTick', 'id', 'x', 'y']);
    expect(s.every((st) => st.id !== 1)).toBe(true);
  });

  it('is never transmitted while unseen, can be discovered later, and expires', () => {
    const w = mudWorld();
    const obs = new TeamObserver(0);
    let o = run(w, obs, 45, { 1: { ...neutralInput(0, 0), moveX: 1 } });
    expect(o.tracks).toEqual([]);
    // drive the enemy away, then move our observer to the mud
    w.tank(1).pos = { x: 70 * 32, y: 1100 };
    w.tank(1).vel = { x: 0, y: 0 };
    w.tank(0).pos = { x: 40 * 32, y: 900 };
    o = run(w, obs, 1);
    const n = o.tracks.length;
    expect(n).toBeGreaterThan(0);
    expect(Object.keys(o.tracks[0]!).sort()).toEqual(['axis', 'id', 'stage', 'x', 'y']);
    // leave; memory persists
    w.tank(0).pos = { x: 100, y: 300 };
    o = run(w, obs, 30);
    expect(o.tracks.length).toBe(n);
    // expire
    o = run(w, obs, TUNING.tracks.lifetime * 30);
    expect(o.tracks).toEqual([]);
  });

  it('caps authority storage', () => {
    const w = mudWorld();
    for (let i = 0; i < 1000; i++) w.tracks.add(100, 100, 0, w.tick + 10000);
    expect(w.tracks.stamps.length).toBe(TUNING.tracks.maxStamps);
  });
});
