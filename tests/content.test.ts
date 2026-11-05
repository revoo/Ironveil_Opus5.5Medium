import { describe, it, expect } from 'vitest';
import { relayYard } from '../src/content/relayYard';
import { validateMap, circleFree } from '../src/sim/map';

describe('Relay Yard content', () => {
  const m = relayYard();
  it('validates (spawn clearance, reachability, landmarks)', () => {
    expect(validateMap(m)).toEqual([]);
  });
  it('is 2400 x 1600 with stable id/version', () => {
    expect([m.width, m.height]).toEqual([2400, 1600]);
    expect(m.id).toBe('relay-yard');
    expect(m.version).toBeGreaterThan(0);
  });
  it('is point-symmetric so both teams get identical geometry', () => {
    for (let r = 0; r < m.rows; r++)
      for (let c = 0; c < m.cols; c++)
        expect(m.tiles[r * m.cols + c], `${c},${r}`).toBe(m.tiles[(m.rows - 1 - r) * m.cols + (m.cols - 1 - c)]);
  });
  it('has enough spawns for four tanks per team, each clear of walls', () => {
    for (const list of m.spawns) {
      expect(list.length).toBeGreaterThanOrEqual(4);
      for (const s of list) expect(circleFree(m, s.x, s.y, 22)).toBe(true);
    }
  });
  it('returns independent copies', () => {
    const a = relayYard();
    a.tiles[100] = 4;
    expect(relayYard().tiles[100]).toBe(m.tiles[100]);
  });
});
