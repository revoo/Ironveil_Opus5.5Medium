import { describe, it, expect } from 'vitest';
import { NavGrid } from '../src/ai/nav';
import { mapWith, openMap } from './helpers';
import { circleFree, lineOfSightClear } from '../src/sim/map';
import { relayYard } from '../src/content/relayYard';

function wallMap() {
  // vertical wall with a gap at the bottom
  const rows = ['#'.repeat(30)];
  for (let r = 0; r < 18; r++) rows.push('#' + '.'.repeat(13) + (r < 14 ? '#' : '.') + '.'.repeat(14) + '#');
  rows.push('#'.repeat(30));
  return mapWith(rows);
}

describe('navigation', () => {
  it('finds a hull-safe path around a wall', () => {
    const m = wallMap();
    const nav = new NavGrid(m);
    const path = nav.findPath({ x: 200, y: 100 }, { x: 700, y: 100 });
    expect(path).not.toBeNull();
    for (const p of path!) expect(circleFree(m, p.x, p.y, 20)).toBe(true);
    // must go through the gap near the bottom
    expect(Math.max(...path!.map((p) => p.y))).toBeGreaterThan(14 * 32);
  });

  it('never cuts diagonal corners between walls', () => {
    const m = wallMap();
    const nav = new NavGrid(m);
    const raw = nav.findCellPath({ x: 200, y: 100 }, { x: 700, y: 100 })!;
    for (let i = 1; i < raw.length; i++) {
      const [ax, ay] = nav.xy(raw[i - 1]!);
      const [bx, by] = nav.xy(raw[i]!);
      if (ax !== bx && ay !== by) {
        expect(nav.walkableCell(bx, ay)).toBe(true);
        expect(nav.walkableCell(ax, by)).toBe(true);
      }
    }
  });

  it('returns null for an unreachable target', () => {
    const rows = ['#'.repeat(20)];
    for (let r = 0; r < 10; r++) rows.push('#' + '.'.repeat(8) + '#' + '.'.repeat(9) + '#');
    rows.push('#'.repeat(20));
    const nav = new NavGrid(mapWith(rows));
    expect(nav.findPath({ x: 100, y: 100 }, { x: 450, y: 100 })).toBeNull();
  });

  it('prefers a covered route over one exposed to a known threat', () => {
    // two corridors separated by a wall block; a threat watches the top corridor
    const rows = ['#'.repeat(40)];
    for (let r = 0; r < 4; r++) rows.push('#' + '.'.repeat(38) + '#');
    for (let r = 0; r < 4; r++) rows.push('#....' + '#'.repeat(30) + '....#');
    for (let r = 0; r < 4; r++) rows.push('#' + '.'.repeat(38) + '#');
    rows.push('#'.repeat(40));
    const m = mapWith(rows);
    const nav = new NavGrid(m);
    const threat = { x: 640, y: 40 };
    const from = { x: 64, y: 200 };
    const to = { x: 1210, y: 200 };
    const plain = nav.findPath(from, to)!;
    const careful = nav.findPath(from, to, { threats: [threat], exposureWeight: 6 })!;
    const exposed = (path: { x: number; y: number }[]) =>
      path.filter((p) => Math.hypot(p.x - threat.x, p.y - threat.y) < 480 && lineOfSightClear(m, threat, p)).length;
    expect(plain.length).toBeGreaterThan(0);
    expect(exposed(careful)).toBeLessThan(exposed(plain) + 1);
    expect(Math.max(...careful.map((p) => p.y))).toBeGreaterThan(9 * 32); // took the lower corridor
  });

  it('smooths paths into few waypoints on open ground', () => {
    const nav = new NavGrid(openMap(40, 30));
    const path = nav.findPath({ x: 100, y: 100 }, { x: 1100, y: 800 })!;
    expect(path.length).toBeLessThanOrEqual(3);
  });

  it('plans across Relay Yard between team spawns quickly', () => {
    const m = relayYard();
    const nav = new NavGrid(m);
    const t0 = performance.now();
    const path = nav.findPath(m.spawns[0]![0]!, m.spawns[1]![0]!);
    const ms = performance.now() - t0;
    expect(path).not.toBeNull();
    expect(ms).toBeLessThan(60);
  });

  it('snaps an unwalkable point to the nearest walkable one', () => {
    const m = wallMap();
    const nav = new NavGrid(m);
    const p = nav.nearestWalkable({ x: 14 * 32 + 16, y: 100 })!;
    expect(circleFree(m, p.x, p.y, 20)).toBe(true);
  });
});
