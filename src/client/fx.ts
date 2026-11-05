// Bounded, pooled particle + light effects. Purely cosmetic: everything here is spawned from
// authorised observation events / visible entities, so it can never reveal hidden enemies.
import Phaser from 'phaser';

export const DEPTH = {
  ground: 0,
  tracks: 1,
  decals: 1.2,
  shadows: 2,
  wrecks: 3,
  debrisGround: 3.5,
  tanks: 5,
  canopy: 6,
  smoke: 7,
  particles: 7.5,
  light: 8,
  emissive: 9,
  bloom: 9.5,
  fog: 10,
  overlay: 11,
  reticle: 12,
};

export interface Light {
  x: number;
  y: number;
  radius: number;
  color: number;
  intensity: number;
  life: number;
  maxLife: number;
  flicker: number;
}

interface P {
  img: Phaser.GameObjects.Image;
  key: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  s0: number;
  s1: number;
  a0: number;
  a1: number;
  rot: number;
  vrot: number;
  drag: number;
  rise: number;
  alive: boolean;
  /** Orient to velocity (sparks). */
  stretch: boolean;
}

export interface SpawnCfg {
  vx?: number;
  vy?: number;
  life: number;
  s0: number;
  s1?: number;
  a0?: number;
  a1?: number;
  rot?: number;
  vrot?: number;
  drag?: number;
  rise?: number;
  tint?: number;
  add?: boolean;
  depth?: number;
  stretch?: boolean;
}

export class Spring {
  x = 0;
  v = 0;
  constructor(
    private k: number,
    private c: number,
  ) {}
  kick(v: number): void {
    this.v += v;
  }
  step(dt: number): void {
    let t = dt;
    while (t > 0) {
      const h = Math.min(t, 1 / 240);
      const a = -this.k * this.x - this.c * this.v;
      this.v += a * h;
      this.x += this.v * h;
      t -= h;
    }
  }
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class FxSystem {
  lights: Light[] = [];
  private ps: P[] = [];
  private pool: P[] = [];
  private cap: number;
  private lightCap: number;
  private shakeT = 0;
  private shakeMag = 0;

  constructor(
    private scene: Phaser.Scene,
    public low: boolean,
    public reduced: boolean,
  ) {
    this.cap = low ? 260 : 1100;
    this.lightCap = low ? 24 : 64;
  }

  setQuality(low: boolean, reduced: boolean): void {
    this.low = low;
    this.reduced = reduced;
    this.cap = low ? 260 : 1100;
    this.lightCap = low ? 24 : 64;
  }

  get count(): number {
    return this.ps.length;
  }

  spawn(key: string, x: number, y: number, c: SpawnCfg): void {
    if (this.ps.length >= this.cap) {
      // Evict the oldest decorative particle rather than growing unbounded.
      const old = this.ps.shift()!;
      old.img.setVisible(false);
      old.alive = false;
      this.pool.push(old);
    }
    let p = this.pool.pop();
    if (!p) {
      const img = this.scene.add.image(0, 0, key);
      p = { img, key, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, s0: 1, s1: 1, a0: 1, a1: 0, rot: 0, vrot: 0, drag: 0, rise: 0, alive: true, stretch: false };
    }
    if (p.key !== key) {
      p.img.setTexture(key);
      p.key = key;
    }
    p.x = x;
    p.y = y;
    p.vx = c.vx ?? 0;
    p.vy = c.vy ?? 0;
    p.life = 0;
    p.max = c.life;
    p.s0 = c.s0;
    p.s1 = c.s1 ?? c.s0;
    p.a0 = c.a0 ?? 1;
    p.a1 = c.a1 ?? 0;
    p.rot = c.rot ?? Math.random() * Math.PI * 2;
    p.vrot = c.vrot ?? 0;
    p.drag = c.drag ?? 0;
    p.rise = c.rise ?? 0;
    p.stretch = !!c.stretch;
    p.alive = true;
    p.img.setVisible(true).setTint(c.tint ?? 0xffffff).setBlendMode(c.add ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL).setDepth(c.depth ?? DEPTH.particles);
    this.ps.push(p);
  }

  light(x: number, y: number, radius: number, color: number, intensity: number, life: number, flicker = 0): void {
    if (this.lights.length >= this.lightCap) this.lights.shift();
    this.lights.push({ x, y, radius, color, intensity, life: 0, maxLife: life, flicker });
  }

  shake(mag: number, dur: number): void {
    if (this.reduced) return;
    this.shakeMag = Math.max(this.shakeMag, mag);
    this.shakeT = Math.max(this.shakeT, dur);
  }

  shakeOffset(): { x: number; y: number } {
    if (this.shakeT <= 0) return { x: 0, y: 0 };
    const m = this.shakeMag * Math.min(1, this.shakeT * 4);
    return { x: rnd(-m, m), y: rnd(-m, m) };
  }

  update(dt: number): void {
    this.shakeT = Math.max(0, this.shakeT - dt);
    if (this.shakeT === 0) this.shakeMag = 0;
    const keep: P[] = [];
    for (const p of this.ps) {
      p.life += dt;
      if (p.life >= p.max) {
        p.img.setVisible(false);
        p.alive = false;
        this.pool.push(p);
        continue;
      }
      const t = p.life / p.max;
      const dr = Math.max(0, 1 - p.drag * dt);
      p.vx *= dr;
      p.vy *= dr;
      p.vy -= p.rise * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;
      const s = p.s0 + (p.s1 - p.s0) * t;
      p.img.setPosition(p.x, p.y);
      if (p.stretch) {
        const sp = Math.hypot(p.vx, p.vy);
        p.img.setRotation(Math.atan2(p.vy, p.vx));
        p.img.setScale(s * Math.max(0.4, Math.min(1.6, sp / 300)), s * 0.6);
      } else {
        p.img.setRotation(p.rot);
        p.img.setScale(s);
      }
      p.img.setAlpha(p.a0 + (p.a1 - p.a0) * t);
      keep.push(p);
    }
    this.ps = keep;
    this.lights = this.lights.filter((l) => (l.life += dt) < l.maxLife);
  }

  // ------------------------------------------------------------ composite effects
  muzzle(x: number, y: number, angle: number, charge: number, team: 0 | 1): void {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const big = 0.6 + charge * 0.9;
    this.spawn('flash', x + c * 6, y + s * 6, { life: 0.07 + charge * 0.05, s0: 0.7 * big, s1: 1.1 * big, a0: 1, a1: 0, rot: angle, add: true, depth: DEPTH.emissive, tint: 0xfff0d0 });
    this.spawn('glow', x, y, { life: 0.12 + charge * 0.1, s0: 0.35 * big, s1: 0.6 * big, a0: 0.9, a1: 0, add: true, depth: DEPTH.emissive, tint: 0xffc070 });
    if (charge > 0.85) this.spawn('ring', x, y, { life: 0.28, s0: 0.15, s1: 0.9, a0: 0.6, a1: 0, add: true, depth: DEPTH.emissive, tint: team === 0 ? 0xbfefff : 0xffd0a0 });
    this.light(x, y, 90 + charge * 120, 0xffc47a, 1, 0.1 + charge * 0.12);
    const n = this.low ? 3 : 5 + Math.round(charge * 6);
    for (let i = 0; i < n; i++) {
      const a = angle + rnd(-0.35, 0.35);
      const sp = rnd(30, 110) * (0.6 + charge);
      this.spawn(`puff${i % 4}`, x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.6, 1.3) + charge * 0.6, s0: 0.12, s1: 0.38 + charge * 0.25, a0: 0.55, a1: 0, drag: 2.2, vrot: rnd(-1, 1), tint: 0xb8b4ae });
    }
    for (let i = 0; i < (this.low ? 2 : 4 + Math.round(charge * 6)); i++) {
      const a = angle + rnd(-0.5, 0.5);
      const sp = rnd(180, 420);
      this.spawn('spark', x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.08, 0.2), s0: 0.5, s1: 0.2, a0: 1, a1: 0, drag: 4, add: true, depth: DEPTH.emissive, stretch: true, tint: 0xffd890 });
    }
  }

  impact(x: number, y: number, angle: number, kind: 'wall' | 'tank' | 'expire', charge: number): void {
    const back = angle + Math.PI;
    const metal = kind === 'tank';
    const n = this.low ? 6 : 10 + Math.round(charge * 14);
    for (let i = 0; i < n; i++) {
      const a = back + rnd(-1.3, 1.3);
      const sp = rnd(120, 380) * (0.7 + charge * 0.6);
      this.spawn('spark', x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.12, 0.4), s0: 0.6, s1: 0.15, a0: 1, a1: 0, drag: 3, add: true, depth: DEPTH.emissive, stretch: true, tint: metal ? 0xfff2c0 : 0xffb060 });
    }
    const dn = this.low ? 2 : 4 + Math.round(charge * 6);
    for (let i = 0; i < dn; i++) {
      const a = back + rnd(-1.2, 1.2);
      const sp = rnd(60, 220);
      this.spawn(`debris${i % 3}`, x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.5, 1.1), s0: rnd(0.6, 1.1), s1: 0.5, a0: 1, a1: 0.2, drag: 3.5, vrot: rnd(-12, 12), tint: metal ? 0x9aa0a8 : 0xa89a88 });
    }
    for (let i = 0; i < (this.low ? 2 : 4); i++) {
      this.spawn(`puff${i % 4}`, x, y, { vx: rnd(-30, 30) + Math.cos(back) * 30, vy: rnd(-30, 30) + Math.sin(back) * 30, life: rnd(0.8, 1.6), s0: 0.15, s1: 0.5 + charge * 0.3, a0: 0.5, a1: 0, drag: 1.5, vrot: rnd(-1, 1), tint: metal ? 0x6a6a6a : 0xb0a490 });
    }
    this.spawn('glow', x, y, { life: 0.15, s0: 0.3 + charge * 0.3, s1: 0.6 + charge * 0.4, a0: 1, a1: 0, add: true, depth: DEPTH.emissive, tint: metal ? 0xfff0c0 : 0xffa050 });
    this.light(x, y, 80 + charge * 100, metal ? 0xffe0a0 : 0xff9a50, 0.9, 0.18);
    if (metal) this.shakeLocal(2 + charge * 3);
  }

  private shakeLocal(m: number): void {
    void m;
  }

  explosion(x: number, y: number): void {
    this.light(x, y, 320, 0xff8a3a, 1.2, 0.7);
    this.spawn('glow', x, y, { life: 0.35, s0: 0.8, s1: 2.2, a0: 1, a1: 0, add: true, depth: DEPTH.emissive, tint: 0xffd080 });
    this.spawn('ring', x, y, { life: 0.45, s0: 0.2, s1: 2.4, a0: 0.7, a1: 0, add: true, depth: DEPTH.emissive, tint: 0xffc080 });
    const fire = this.low ? 6 : 16;
    for (let i = 0; i < fire; i++) {
      const a = rnd(0, Math.PI * 2);
      const sp = rnd(20, 140);
      this.spawn('soft', x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.35, 0.8), s0: rnd(0.6, 1.1), s1: rnd(1.5, 2.6), a0: 0.95, a1: 0, drag: 2.5, rise: 20, add: true, depth: DEPTH.emissive, tint: i % 3 === 0 ? 0xfff0b0 : 0xff7a2a });
    }
    const smoke = this.low ? 6 : 18;
    for (let i = 0; i < smoke; i++) {
      const a = rnd(0, Math.PI * 2);
      const sp = rnd(15, 90);
      this.spawn(`puff${i % 4}`, x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(1.8, 3.6), s0: 0.3, s1: rnd(0.9, 1.5), a0: 0.85, a1: 0, drag: 0.9, rise: 12, vrot: rnd(-0.6, 0.6), tint: 0x2c2826 });
    }
    for (let i = 0; i < (this.low ? 8 : 22); i++) {
      const a = rnd(0, Math.PI * 2);
      const sp = rnd(200, 560);
      this.spawn('spark', x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.25, 0.7), s0: 0.8, s1: 0.2, a0: 1, a1: 0, drag: 2.2, add: true, depth: DEPTH.emissive, stretch: true, tint: 0xffc070 });
    }
    for (let i = 0; i < (this.low ? 4 : 12); i++) {
      const a = rnd(0, Math.PI * 2);
      const sp = rnd(90, 300);
      this.spawn(`debris${i % 3}`, x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.9, 2), s0: rnd(0.9, 1.6), s1: 0.9, a0: 1, a1: 0.1, drag: 2.6, vrot: rnd(-14, 14), tint: 0x5a524a, depth: DEPTH.debrisGround });
    }
  }

  /** Continuous emitters called by the scene each frame. */
  fireTick(x: number, y: number, strength: number, dt: number): void {
    const rate = (this.low ? 10 : 28) * strength;
    let n = rate * dt;
    while (n > 0) {
      if (Math.random() < n) {
        this.spawn('soft', x + rnd(-10, 10), y + rnd(-8, 8), { vx: rnd(-8, 8), vy: rnd(-30, -10), life: rnd(0.3, 0.7), s0: rnd(0.25, 0.45) * strength, s1: 0.1, a0: 0.9, a1: 0, rise: 30, add: true, depth: DEPTH.emissive, tint: Math.random() < 0.3 ? 0xffe08a : 0xff6a20 });
        if (Math.random() < 0.35) this.spawn(`puff${Math.floor(Math.random() * 4)}`, x + rnd(-6, 6), y + rnd(-6, 6), { vx: rnd(-10, 10) + 8, vy: rnd(-25, -10), life: rnd(1.5, 3), s0: 0.2, s1: 0.9, a0: 0.55 * strength, a1: 0, rise: 14, drag: 0.4, vrot: rnd(-0.5, 0.5), tint: 0x252220 });
        if (!this.low && Math.random() < 0.15) this.spawn('px', x, y, { vx: rnd(-30, 30), vy: rnd(-90, -40), life: rnd(0.6, 1.4), s0: 0.35, s1: 0.1, a0: 1, a1: 0, add: true, depth: DEPTH.emissive, tint: 0xffa040 });
      }
      n -= 1;
    }
  }

  dust(x: number, y: number, vx: number, vy: number, tint: number, size: number, alpha: number): void {
    this.spawn(`puff${Math.floor(Math.random() * 4)}`, x + rnd(-3, 3), y + rnd(-3, 3), { vx: vx * 0.15 + rnd(-12, 12), vy: vy * 0.15 + rnd(-12, 12), life: rnd(0.5, 1.1), s0: 0.08 * size, s1: 0.28 * size, a0: alpha, a1: 0, drag: 1.4, vrot: rnd(-1, 1), tint, depth: DEPTH.shadows + 0.1 });
  }

  vent(x: number, y: number, angle: number): void {
    for (const side of [-1, 1]) {
      const a = angle + side * Math.PI / 2;
      for (let i = 0; i < (this.low ? 3 : 7); i++) {
        const sp = rnd(60, 160);
        this.spawn(`puff${i % 4}`, x, y, { vx: Math.cos(a + rnd(-0.4, 0.4)) * sp, vy: Math.sin(a + rnd(-0.4, 0.4)) * sp, life: rnd(0.5, 1.1), s0: 0.08, s1: 0.4, a0: 0.75, a1: 0, drag: 2.4, tint: 0xe6eef2 });
      }
    }
    this.light(x, y, 70, 0x9fdcff, 0.6, 0.25);
  }

  smokeBurst(x: number, y: number, radius: number): void {
    const n = this.low ? 8 : 20;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const sp = radius * rnd(1.6, 2.6);
      this.spawn(`puff${i % 4}`, x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.5, 0.9), s0: 0.3, s1: 0.9, a0: 0.8, a1: 0, drag: 4, vrot: rnd(-1, 1), tint: 0xc8ccd2, depth: DEPTH.smoke + 0.1 });
    }
    this.light(x, y, 60, 0xffffff, 0.4, 0.2);
  }

  chargeMote(x: number, y: number, tint: number): void {
    if (this.low) return;
    const a = rnd(0, Math.PI * 2);
    const d = rnd(18, 30);
    this.spawn('px', x + Math.cos(a) * d, y + Math.sin(a) * d, { vx: -Math.cos(a) * d * 4, vy: -Math.sin(a) * d * 4, life: 0.22, s0: 0.45, s1: 0.1, a0: 0.9, a1: 0, add: true, depth: DEPTH.emissive, tint });
  }
}
