import { describe, expect, it } from 'vitest';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { roundedBox } from '../src/client/three/geometry';

// roundedBox() welds three.js's triangle-soup rounded box using the index of the box grid it was
// expanded from. That relies on how RoundedBoxGeometry is built; if a three.js upgrade changes it,
// the scenery would come out scrambled. This checks the welded box is the same triangles.
describe('roundedBox', () => {
  const cases: [number, number, number, number, number][] = [
    [54, 10, 8, 2, 3.5],
    [140, 96, 220, 2, 2],
    [4, 3, 3, 1, 0.8],
    [12, 1.2, 16, 1, 0.5],
    [30, 30, 30, 3, 40], // radius clamped to half the size
  ];
  it.each(cases)('matches RoundedBoxGeometry(%d, %d, %d, %d, %d) corner for corner', (w, h, d, seg, r) => {
    const soup = new RoundedBoxGeometry(w, h, d, seg, r);
    const box = roundedBox(w, h, d, seg, r);
    const index = box.index!.array;
    expect(index.length).toBe(soup.attributes.position!.count);
    for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2]] as const) {
      const a = soup.attributes[name]!.array, b = box.attributes[name]!.array;
      const expanded = new Float32Array(index.length * size);
      for (let i = 0; i < index.length; i++) for (let c = 0; c < size; c++) expanded[i * size + c] = b[index[i]! * size + c]!;
      expect(Array.from(expanded)).toEqual(Array.from(a));
    }
  });
  it('shares vertices: 216 for the usual 300 triangles', () => {
    const box = roundedBox(40, 60, 20, 2, 1.6);
    expect(box.index!.count).toBe(900);
    expect(box.attributes.position!.count).toBe(216);
  });
});
