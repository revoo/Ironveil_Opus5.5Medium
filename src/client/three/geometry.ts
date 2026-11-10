// Geometry helpers for the 3D view that need no DOM (so tests can import them).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/** Indexed and non-indexed pieces can't merge together: give a piece a trivial index if it has none. */
export function ensureIndex(g: THREE.BufferGeometry): THREE.BufferGeometry {
  if (!g.index) {
    const n = g.attributes.position!.count;
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  return g;
}

/** Per segment count: the index of the box grid, and for each grid vertex one triangle corner that uses it. */
const boxGrids = new Map<number, { index: Uint16Array; corner: Uint32Array }>();

/**
 * A bevelled box with shared vertices.
 *
 * three.js's RoundedBoxGeometry is a triangle soup: it starts from an indexed box grid, expands
 * it to three vertices per triangle (900 for the usual 300 triangles), then rounds each vertex.
 * But the rounding depends only on which grid vertex a corner came from, so every copy of a grid
 * vertex ends up identical, and the grid's own index welds them back exactly: 216 vertices.
 * Nearly all the scenery is these boxes, so this is a quarter of the vertex-shader work and of the
 * vertex memory, with the same triangles.
 */
export function roundedBox(width: number, height: number, depth: number, segments = 2, radius = 0.1): THREE.BufferGeometry {
  const soup = new RoundedBoxGeometry(width, height, depth, segments, radius);
  const t = segments * 2 + 1;
  if (t === 1) return soup; // a plain box: three.js leaves it indexed
  let grid = boxGrids.get(t);
  if (!grid) {
    const idx = new THREE.BoxGeometry(1, 1, 1, t, t, t).index!.array;
    const corner = new Uint32Array(6 * (t + 1) * (t + 1)).fill(0xffffffff);
    for (let i = 0; i < idx.length; i++) if (corner[idx[i]!] === 0xffffffff) corner[idx[i]!] = i;
    grid = { index: Uint16Array.from(idx), corner };
    boxGrids.set(t, grid);
  }
  const out = new THREE.BufferGeometry();
  const n = grid.corner.length;
  for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2]] as const) {
    const src = soup.attributes[name]!.array, dst = new Float32Array(n * size);
    for (let k = 0; k < n; k++) {
      const from = grid.corner[k]! * size;
      for (let c = 0; c < size; c++) dst[k * size + c] = src[from + c]!;
    }
    out.setAttribute(name, new THREE.BufferAttribute(dst, size));
  }
  out.setIndex(new THREE.BufferAttribute(grid.index, 1));
  soup.dispose();
  return out;
}
