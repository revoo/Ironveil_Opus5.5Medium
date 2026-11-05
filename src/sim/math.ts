// Pure vector / angle helpers. Angles are radians, 0 = +x (east), y grows downward.
export interface Vec {
  x: number;
  y: number;
}

export const TAU = Math.PI * 2;

export const vec = (x = 0, y = 0): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec): number => Math.hypot(a.x, a.y);
export const len2 = (a: Vec): number => a.x * a.x + a.y * a.y;
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
export const dist2 = (a: Vec, b: Vec): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};
export const norm = (a: Vec): Vec => {
  const l = Math.hypot(a.x, a.y);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
};
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const lerpVec = (a: Vec, b: Vec, t: number): Vec => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const angleOf = (a: Vec): number => Math.atan2(a.y, a.x);
export const fromAngle = (a: number, l = 1): Vec => ({ x: Math.cos(a) * l, y: Math.sin(a) * l });
export const copy = (a: Vec): Vec => ({ x: a.x, y: a.y });

/** Wrap to (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = a % TAU;
  if (a <= -Math.PI) a += TAU;
  else if (a > Math.PI) a -= TAU;
  return a;
}

/** Signed shortest difference from a to b. */
export const angleDiff = (a: number, b: number): number => wrapAngle(b - a);

export function rotateToward(cur: number, target: number, maxStep: number): number {
  const d = angleDiff(cur, target);
  if (Math.abs(d) <= maxStep) return wrapAngle(target);
  return wrapAngle(cur + Math.sign(d) * maxStep);
}

export function lerpAngle(a: number, b: number, t: number): number {
  return wrapAngle(a + angleDiff(a, b) * t);
}

/** Earliest t in [0,1] at which segment p0->p1 is within radius r of point c (or 0 if starting inside). */
export function segmentCircleT(p0: Vec, p1: Vec, c: Vec, r: number): number {
  const fx = p0.x - c.x;
  const fy = p0.y - c.y;
  const c0 = fx * fx + fy * fy - r * r;
  if (c0 <= 0) return 0;
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const a = dx * dx + dy * dy;
  if (a < 1e-12) return Infinity;
  const b = 2 * (fx * dx + fy * dy);
  const disc = b * b - 4 * a * c0;
  if (disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : Infinity;
}

/** Point-to-segment distance. */
export function pointSegmentDistance(p: Vec, a: Vec, b: Vec): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  let t = l2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

/** Round a duration in seconds up to whole simulation ticks. */
export const secondsToTicks = (s: number, hz: number): number => Math.ceil(s * hz - 1e-9);
