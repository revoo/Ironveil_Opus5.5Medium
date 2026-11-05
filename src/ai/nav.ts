// Weighted A* on a 16 px grid inflated by the hull radius. Terrain-, clearance- and
// exposure-aware (cells visible from known threat positions cost more).
import type { Vec } from '../sim/math';
import { buildWalkGrid, lineOfSightClear, terrainAt, Terrain, wallDistance, type GameMap } from '../sim/map';
import { TUNING } from '../sim/tuning';

export interface PathOptions {
  /** Known/suspected threat positions; cells in their line of sight get extra cost. */
  threats?: Vec[];
  exposureWeight?: number;
  /** Extra cost for brush (negative to prefer it, e.g. stealthy approach). */
  brushBias?: number;
  maxExpansions?: number;
}

const SQRT2 = Math.SQRT2;

class MinHeap {
  private idx: number[] = [];
  private pri: number[] = [];
  get size() {
    return this.idx.length;
  }
  clear() {
    this.idx.length = 0;
    this.pri.length = 0;
  }
  push(i: number, p: number) {
    const a = this.idx;
    const q = this.pri;
    a.push(i);
    q.push(p);
    let n = a.length - 1;
    while (n > 0) {
      const parent = (n - 1) >> 1;
      if (q[parent]! <= p) break;
      a[n] = a[parent]!;
      q[n] = q[parent]!;
      n = parent;
    }
    a[n] = i;
    q[n] = p;
  }
  pop(): number {
    const a = this.idx;
    const q = this.pri;
    const top = a[0]!;
    const li = a.pop()!;
    const lp = q.pop()!;
    if (a.length > 0) {
      let n = 0;
      const len = a.length;
      for (;;) {
        const l = 2 * n + 1;
        if (l >= len) break;
        const r = l + 1;
        const c = r < len && q[r]! < q[l]! ? r : l;
        if (q[c]! >= lp) break;
        a[n] = a[c]!;
        q[n] = q[c]!;
        n = c;
      }
      a[n] = li;
      q[n] = lp;
    }
    return top;
  }
}

export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cell: number;
  readonly walk: Uint8Array;
  readonly baseCost: Float32Array;
  private g: Float32Array;
  private parent: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private gen = 1;
  private heap = new MinHeap();
  private exposureCache = new Map<string, Uint8Array>();

  constructor(readonly map: GameMap) {
    const w = buildWalkGrid(map, TUNING.tank.radius + 1);
    this.cols = w.cols;
    this.rows = w.rows;
    this.cell = w.cell;
    this.walk = w.walk;
    const n = this.cols * this.rows;
    this.baseCost = new Float32Array(n);
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const i = y * this.cols + x;
        if (!this.walk[i]) continue;
        const cx = x * this.cell + this.cell / 2;
        const cy = y * this.cell + this.cell / 2;
        const t = terrainAt(map, cx, cy);
        let c = t === Terrain.Road ? 0.9 : t === Terrain.Mud ? 1.6 : t === Terrain.Brush ? 1.15 : 1;
        const clear = wallDistance(map, cx, cy, 40);
        if (clear < 30) c += ((30 - clear) / 30) * 0.8;
        this.baseCost[i] = c;
      }
    }
    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
  }

  xy(i: number): [number, number] {
    const x = i % this.cols;
    return [x, (i - x) / this.cols];
  }

  walkableCell(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows && this.walk[y * this.cols + x] === 1;
  }

  cellIndex(p: Vec): number {
    const x = Math.max(0, Math.min(this.cols - 1, Math.floor(p.x / this.cell)));
    const y = Math.max(0, Math.min(this.rows - 1, Math.floor(p.y / this.cell)));
    return y * this.cols + x;
  }

  centre(i: number): Vec {
    const [x, y] = this.xy(i);
    return { x: x * this.cell + this.cell / 2, y: y * this.cell + this.cell / 2 };
  }

  isWalkable(p: Vec): boolean {
    return this.walk[this.cellIndex(p)] === 1;
  }

  nearestWalkable(p: Vec, maxRing = 12): Vec | null {
    const [cx, cy] = this.xy(this.cellIndex(p));
    if (this.walkableCell(cx, cy)) return this.centre(cy * this.cols + cx);
    let best: number | null = null;
    let bestD = Infinity;
    for (let r = 1; r <= maxRing && best === null; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = cx + dx;
          const y = cy + dy;
          if (!this.walkableCell(x, y)) continue;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = y * this.cols + x;
          }
        }
      }
    }
    return best === null ? null : this.centre(best);
  }

  /** Is the straight segment a->b traversable by the hull (sampled on the inflated grid)? */
  straightWalkable(a: Vec, b: Vec): boolean {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(d / 6));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (!this.isWalkable({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })) return false;
    }
    return true;
  }

  /** Coarse (map tile) exposure mask for a set of threat positions. Cached per rounded position. */
  exposure(threats: Vec[]): Uint8Array {
    const key = threats.map((t) => `${Math.round(t.x / 32)},${Math.round(t.y / 32)}`).join('|');
    const hit = this.exposureCache.get(key);
    if (hit) return hit;
    const m = this.map;
    const mask = new Uint8Array(m.cols * m.rows);
    const R = TUNING.vision.radius + 40;
    for (const t of threats) {
      const c0 = Math.max(0, Math.floor((t.x - R) / m.tile));
      const c1 = Math.min(m.cols - 1, Math.floor((t.x + R) / m.tile));
      const r0 = Math.max(0, Math.floor((t.y - R) / m.tile));
      const r1 = Math.min(m.rows - 1, Math.floor((t.y + R) / m.tile));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const p = { x: c * m.tile + 16, y: r * m.tile + 16 };
          if ((p.x - t.x) ** 2 + (p.y - t.y) ** 2 > R * R) continue;
          if (lineOfSightClear(m, t, p)) mask[r * m.cols + c] = 1;
        }
      }
    }
    if (this.exposureCache.size > 64) this.exposureCache.clear();
    this.exposureCache.set(key, mask);
    return mask;
  }

  findCellPath(from: Vec, to: Vec, opts: PathOptions = {}): number[] | null {
    const s = this.nearestWalkable(from);
    const e = this.nearestWalkable(to);
    if (!s || !e) return null;
    const start = this.cellIndex(s);
    const goal = this.cellIndex(e);
    const cols = this.cols;
    const [gx, gy] = this.xy(goal);
    const gen = ++this.gen;
    const exposure = opts.threats && opts.threats.length ? this.exposure(opts.threats) : null;
    const expW = opts.exposureWeight ?? 4;
    const brushBias = opts.brushBias ?? 0;
    const maxExp = opts.maxExpansions ?? 40000;
    const m = this.map;
    const heap = this.heap;
    heap.clear();
    this.g[start] = 0;
    this.stamp[start] = gen;
    this.parent[start] = -1;
    heap.push(start, 0);
    let expansions = 0;
    while (heap.size) {
      const cur = heap.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      if (cur === goal) break;
      if (++expansions > maxExp) return null;
      const cx = cur % cols;
      const cy = (cur - cx) / cols;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (!this.walkableCell(nx, ny)) continue;
          if (dx && dy && (!this.walkableCell(cx + dx, cy) || !this.walkableCell(cx, cy + dy))) continue;
          const ni = ny * cols + nx;
          if (this.closed[ni] === gen) continue;
          let c = this.baseCost[ni]!;
          if (exposure || brushBias) {
            const px = nx * this.cell + 8;
            const py = ny * this.cell + 8;
            const ti = Math.floor(py / m.tile) * m.cols + Math.floor(px / m.tile);
            if (exposure && exposure[ti]) c += expW;
            if (brushBias && m.tiles[ti] === Terrain.Brush) c += brushBias;
          }
          const ng = this.g[cur]! + c * (dx && dy ? SQRT2 : 1);
          if (this.stamp[ni] === gen && ng >= this.g[ni]!) continue;
          this.stamp[ni] = gen;
          this.g[ni] = ng;
          this.parent[ni] = cur;
          const hx = Math.abs(nx - gx);
          const hy = Math.abs(ny - gy);
          const h = (Math.max(hx, hy) + (SQRT2 - 1) * Math.min(hx, hy)) * 0.9 * 1.15;
          heap.push(ni, ng + h);
        }
      }
    }
    if (this.closed[goal] !== gen) return null;
    const out: number[] = [];
    for (let i = goal; i !== -1; i = this.parent[i]!) out.push(i);
    out.reverse();
    return out;
  }

  /** Smoothed world-space waypoints (excluding the start position), ending at the goal. */
  findPath(from: Vec, to: Vec, opts: PathOptions = {}): Vec[] | null {
    const cells = this.findCellPath(from, to, opts);
    if (!cells) return null;
    const pts = cells.map((i) => this.centre(i));
    const goal = this.isWalkable(to) ? { x: to.x, y: to.y } : pts[pts.length - 1]!;
    pts[pts.length - 1] = goal;
    // String pulling (only where it doesn't add exposure: keep it simple and conservative)
    const out: Vec[] = [];
    let anchor = this.isWalkable(from) ? from : pts[0]!;
    let i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !(this.straightWalkable(anchor, pts[j]!) && (!opts.threats?.length || j - i < 6))) j--;
      out.push(pts[j]!);
      anchor = pts[j]!;
      i = j + 1;
    }
    return out;
  }
}
