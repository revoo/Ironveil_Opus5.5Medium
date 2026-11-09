// Explosions for the 3D mission view: fireballs, smoke, shockwave rings, flying debris, ammunition
// cook-offs after a kill, burning wrecks, and smoke/flames from damaged tanks.
//
// Pure presentation. Nothing here feeds back into the simulation, so it can use Math.random freely.
// Everything is pooled and allocated up front (the shader warm-up compiles it once), so a busy
// fight never creates materials or changes the light count mid-game.
import * as THREE from 'three';
import type { GlowRequest } from './fx';
import { canvasTexture, radialTexture, rand } from './models';

/** What a boom asks of the rest of the view: light, sparks, sound and camera shake. */
export interface BlastHooks {
  flash(x: number, z: number, scale: number): void;
  sparks(x: number, y: number, z: number, n: number, speed: number): void;
  /** `size` ~0.4 (small cook-off) .. 1.5 (the main blast). */
  boom(x: number, z: number, size: number, main: boolean): void;
  shake(x: number, z: number, amount: number): void;
  crackle(x: number, z: number): void;
  /** Ask the shared effect-light pool for light this frame. */
  glow(r: GlowRequest): void;
}

type PKind = 'fire' | 'smoke' | 'flame';
interface Particle {
  kind: PKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  t: number;
  life: number;
  s0: number;
  s1: number;
  spin: number;
  rot: number;
  alpha: number;
}
interface Ring {
  mesh: THREE.Mesh;
  t: number;
  life: number;
  size: number;
}
interface Chunk {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  sx: number;
  sy: number;
  sz: number;
  spin: number;
  t: number;
  life: number;
  hot: number;
  bounced: number;
}
interface Fire {
  x: number;
  z: number;
  t: number;
  life: number;
  acc: number;
  crackleIn: number;
}
interface Pending {
  at: number;
  x: number;
  z: number;
  size: number;
}

const fireTex = canvasTexture(
  128,
  128,
  (ctx) => {
    // A lumpy hot core: overlapping soft blobs read as rolling flame, not a perfect disc.
    const r = rand(17);
    for (let i = 0; i < 18; i++) {
      const x = 64 + (r() - 0.5) * 40, y = 64 + (r() - 0.5) * 40, rad = 18 + r() * 30;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, 'rgba(255,255,255,0.5)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.18)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    }
  },
  false,
);

const smokeTex = canvasTexture(
  128,
  128,
  (ctx) => {
    const r = rand(29);
    for (let i = 0; i < 30; i++) {
      const x = 64 + (r() - 0.5) * 56, y = 64 + (r() - 0.5) * 56, rad = 12 + r() * 28;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, 'rgba(255,255,255,0.28)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    }
  },
  false,
);

const R = () => Math.random();
const between = (a: number, b: number) => a + (b - a) * R();

export class Blasts {
  private fireSprites: THREE.Sprite[] = [];
  private smokeSprites: THREE.Sprite[] = [];
  private fire: (Particle | null)[];
  private smoke: (Particle | null)[];
  private nextFire = 0;
  private nextSmoke = 0;
  private rings: Ring[] = [];
  private nextRing = 0;
  private chunks: Chunk[] = [];
  private debris: THREE.InstancedMesh;
  /** Debris chunks are flying this frame (shadows that move). */
  get debrisInFlight(): boolean {
    return this.debris.count > 0;
  }
  private fires: Fire[] = [];
  private pending: Pending[] = [];
  private clock = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private col = new THREE.Color();

  constructor(
    scene: THREE.Scene,
    private hooks: BlastHooks,
    readonly maxFire = 140,
    readonly maxSmoke = 110,
    readonly maxChunks = 220,
  ) {
    this.fire = new Array(maxFire).fill(null);
    this.smoke = new Array(maxSmoke).fill(null);
    for (let i = 0; i < maxFire; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireTex, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.visible = false;
      s.renderOrder = 5;
      scene.add(s);
      this.fireSprites.push(s);
    }
    for (let i = 0; i < maxSmoke; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0x2b2a28, depthWrite: false, transparent: true }));
      s.visible = false;
      s.renderOrder = 4;
      scene.add(s);
      this.smokeSprites.push(s);
    }
    const ringGeo = new THREE.RingGeometry(0.82, 1, 56);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ map: radialTexture, color: new THREE.Color(3, 1.6, 0.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      mesh.visible = false;
      mesh.renderOrder = 4;
      scene.add(mesh);
      this.rings.push({ mesh, t: 1, life: 1, size: 1 });
    }
    // Debris: one instanced draw for every chunk in flight; per-instance colour carries the glow.
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.5 });
    this.debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, maxChunks);
    this.debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.debris.count = 0;
    this.debris.frustumCulled = false;
    this.debris.castShadow = true;
    this.debris.setColorAt(0, new THREE.Color());
    scene.add(this.debris);
  }

  // ------------------------------------------------------------------ emitters
  private spawn(kind: PKind, p: Omit<Particle, 'kind' | 't' | 'rot'>): void {
    if (kind === 'smoke') {
      this.smoke[this.nextSmoke] = { kind, t: 0, rot: R() * 6.28, ...p };
      this.nextSmoke = (this.nextSmoke + 1) % this.maxSmoke;
    } else {
      this.fire[this.nextFire] = { kind, t: 0, rot: R() * 6.28, ...p };
      this.nextFire = (this.nextFire + 1) % this.maxFire;
    }
  }

  private chunk(x: number, y: number, z: number, dirX: number, dirZ: number, speed: number, size: number, hot: number, spread = 1): void {
    if (this.chunks.length >= this.maxChunks) this.chunks.shift();
    const a = Math.atan2(dirZ, dirX) + (R() - 0.5) * Math.PI * 2 * spread;
    const sp = speed * between(0.35, 1);
    this.chunks.push({
      x, y, z,
      vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: between(0.5, 1.3) * speed * 0.9,
      rx: R() * 6, ry: R() * 6, rz: R() * 6,
      sx: size * between(0.5, 1.4), sy: size * between(0.3, 0.8), sz: size * between(0.5, 1.2),
      spin: between(4, 14), t: 0, life: between(5, 9), hot, bounced: 0,
    });
  }

  private ring(x: number, z: number, size: number): void {
    const r = this.rings[this.nextRing]!;
    this.nextRing = (this.nextRing + 1) % this.rings.length;
    r.t = 0;
    r.life = 0.45 + size * 0.15;
    r.size = size;
    r.mesh.position.set(x, 1.5, z);
    r.mesh.visible = true;
  }

  /** One explosion: fireball, smoke, ring, debris, sparks, light, sound and shake. */
  explode(x: number, z: number, size: number, main = false): void {
    const s = size;
    for (let i = 0; i < Math.round(8 + 8 * s); i++) {
      const a = R() * 6.28, out = between(30, 110) * s;
      this.spawn('fire', { x: x + Math.cos(a) * 6 * s, y: between(6, 22) * s, z: z + Math.sin(a) * 6 * s, vx: Math.cos(a) * out, vy: between(40, 140) * s, vz: Math.sin(a) * out, life: between(0.4, 0.8) * (0.7 + s * 0.3), s0: between(12, 22) * s, s1: between(36, 64) * s, spin: between(-1.5, 1.5), alpha: 0.8 });
    }
    for (let i = 0; i < Math.round(6 + 8 * s); i++) {
      const a = R() * 6.28, out = between(10, 50) * s;
      this.spawn('smoke', { x: x + Math.cos(a) * 10 * s, y: between(10, 30) * s, z: z + Math.sin(a) * 10 * s, vx: Math.cos(a) * out, vy: between(25, 70) * s, vz: Math.sin(a) * out, life: between(2.2, 4.5) * (0.6 + s * 0.4), s0: between(30, 50) * s, s1: between(120, 200) * s, spin: between(-0.4, 0.4), alpha: 0.75 });
    }
    this.ring(x, z, s);
    for (let i = 0; i < Math.round(6 + 14 * s); i++) this.chunk(x, between(10, 22), z, 0, 0, 260 * (0.6 + s * 0.4), between(2, 4.5) * (0.7 + s * 0.3), R() < 0.6 ? 1 : 0);
    this.hooks.sparks(x, 16, z, Math.round(60 * s), 300 + 120 * s);
    this.hooks.flash(x, z, 0.6 + s * 0.6);
    this.hooks.boom(x, z, s, main);
    this.hooks.shake(x, z, 6 + 10 * s);
  }

  /** A tank destroyed: the big blast, then the ammunition cooks off, then it burns. */
  destroy(x: number, z: number): void {
    this.explode(x, z, 1.5, true);
    const n = 3 + Math.floor(R() * 3);
    for (let i = 0; i < n; i++) this.pending.push({ at: this.clock + between(0.3, 2.8), x: x + between(-18, 18), z: z + between(-18, 18), size: between(0.45, 0.8) });
    // the ammunition rack: one late, larger detonation
    this.pending.push({ at: this.clock + between(1.0, 1.6), x, z, size: 1.05 });
    this.fires.push({ x, z, t: 0, life: 32, acc: 0, crackleIn: 0.4 });
    if (this.fires.length > 5) this.fires.shift();
  }

  /** Armour hit: spall fragments thrown back toward the shooter, a puff, a small flare. */
  hit(x: number, z: number, angle: number, charge: number): void {
    const bx = -Math.cos(angle), bz = -Math.sin(angle);
    for (let i = 0; i < Math.round(4 + charge * 8); i++) this.chunk(x, between(12, 20), z, bx, bz, 150 + charge * 120, between(1.2, 2.4), R() < 0.7 ? 1 : 0, 0.35);
    for (let i = 0; i < 3 + Math.round(charge * 3); i++)
      this.spawn('fire', { x, y: 16, z, vx: bx * between(20, 70), vy: between(10, 50), vz: bz * between(20, 70), life: between(0.15, 0.3), s0: 12, s1: 34 + charge * 20, spin: 0, alpha: 1 });
    for (let i = 0; i < 2 + Math.round(charge * 2); i++)
      this.spawn('smoke', { x, y: 18, z, vx: bx * between(10, 30), vy: between(15, 35), vz: bz * between(10, 30), life: between(1, 1.8), s0: 16, s1: 50 + charge * 30, spin: between(-0.5, 0.5), alpha: 0.55 });
  }

  /** Charging: hot motes drawn into the muzzle, faster and denser as the charge builds. */
  chargeMotes(x: number, y: number, z: number, level: number, dt: number): void {
    if (level <= 0) return;
    const n = dt * (10 + 50 * level);
    const count = Math.floor(n) + (R() < n % 1 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const a = R() * 6.28, b = (R() - 0.3) * 1.2, r = 26 + 18 * level;
      const ox = Math.cos(a) * Math.cos(b) * r, oy = Math.sin(b) * r * 0.6, oz = Math.sin(a) * Math.cos(b) * r;
      const life = 0.22 + R() * 0.08;
      this.spawn('flame', { x: x + ox, y: y + oy, z: z + oz, vx: -ox / life, vy: -oy / life, vz: -oz / life, life, s0: 2 + 3 * level, s1: 5 + 6 * level, spin: 0, alpha: 0.35 + 0.45 * level });
    }
  }

  /** A charged shell's tracer: embers shed along its path. */
  trail(x: number, y: number, z: number, charge: number, dt: number): void {
    if (R() < dt * 70 * charge) this.spawn('flame', { x, y, z, vx: between(-8, 8), vy: between(5, 20), vz: between(-8, 8), life: between(0.15, 0.3), s0: 6 + 10 * charge, s1: 2, spin: 0, alpha: 0.9 });
  }

  /** A heavy shot leaving the barrel: a ring of blast on the ground and a cone of smoke ahead. */
  muzzleBlast(x: number, z: number, angle: number, charge: number): void {
    this.ring(x, z, 0.25 + 0.45 * charge);
    const fx = Math.cos(angle), fz = Math.sin(angle);
    for (let i = 0; i < Math.round(4 + 8 * charge); i++)
      this.spawn('smoke', { x: x + fx * 30, y: 18, z: z + fz * 30, vx: fx * between(40, 140) + between(-30, 30), vy: between(5, 25), vz: fz * between(40, 140) + between(-30, 30), life: between(0.8, 1.6), s0: 14, s1: 50 + 30 * charge, spin: between(-0.5, 0.5), alpha: 0.4 });
    for (let i = 0; i < Math.round(3 + 6 * charge); i++)
      this.spawn('fire', { x: x + fx * 32, y: 20, z: z + fz * 32, vx: fx * between(80, 220), vy: between(-5, 15), vz: fz * between(80, 220), life: between(0.08, 0.16), s0: 14 + 12 * charge, s1: 30 + 30 * charge, spin: 0, alpha: 1 });
  }

  /** A damaged tank trails smoke, and flames once it is nearly dead. `level` 0..1 = how badly. */
  smolder(x: number, z: number, hull: number, level: number, dt: number): void {
    if (level <= 0) return;
    // engine deck sits at the back of the hull
    const ex = x - Math.cos(hull) * 16, ez = z - Math.sin(hull) * 16;
    if (R() < dt * (3 + level * 9))
      this.spawn('smoke', { x: ex + between(-4, 4), y: 22, z: ez + between(-4, 4), vx: between(-6, 6), vy: between(25, 45), vz: between(-6, 6), life: between(1.4, 2.6), s0: 10, s1: 34 + level * 30, spin: between(-0.5, 0.5), alpha: 0.35 + level * 0.3 });
    if (level > 0.55 && R() < dt * 16 * level)
      this.spawn('flame', { x: ex + between(-5, 5), y: 20, z: ez + between(-5, 5), vx: between(-8, 8), vy: between(40, 70), vz: between(-8, 8), life: between(0.25, 0.45), s0: 10, s1: 4, spin: 0, alpha: 1 });
  }

  // ------------------------------------------------------------------ update
  update(dt: number): void {
    this.clock += dt;
    // scheduled cook-offs
    if (this.pending.length) {
      const due = this.pending.filter((p) => p.at <= this.clock);
      this.pending = this.pending.filter((p) => p.at > this.clock);
      for (const p of due) this.explode(p.x, p.z, p.size);
    }
    // burning wrecks: steady flames, rising embers, a crackle now and then
    for (const f of this.fires) {
      f.t += dt;
      const k = Math.max(0, 1 - f.t / f.life);
      f.acc += dt * 26 * (0.25 + 0.75 * k);
      while (f.acc >= 1) {
        f.acc -= 1;
        const a = R() * 6.28, d = R() * 14;
        this.spawn('flame', { x: f.x + Math.cos(a) * d, y: between(14, 24), z: f.z + Math.sin(a) * d, vx: between(-6, 6), vy: between(50, 95), vz: between(-6, 6), life: between(0.35, 0.7), s0: between(14, 24) * (0.5 + k * 0.5), s1: 6, spin: 0, alpha: 1 });
        if (R() < 0.35) this.spawn('smoke', { x: f.x + between(-8, 8), y: 40, z: f.z + between(-8, 8), vx: between(-4, 4) + 6, vy: between(30, 50), vz: between(-4, 4), life: between(2.5, 4), s0: 26, s1: 90, spin: between(-0.3, 0.3), alpha: 0.5 * (0.4 + k * 0.6) });
      }
      if (R() < dt * 4 * k) this.hooks.sparks(f.x + between(-8, 8), 24, f.z + between(-8, 8), 3, 90);
      f.crackleIn -= dt;
      if (f.crackleIn <= 0 && k > 0.1) {
        f.crackleIn = between(0.25, 1.1) / (0.3 + k);
        this.hooks.crackle(f.x, f.z);
      }
    }
    this.fires = this.fires.filter((f) => f.t < f.life);
    // flickering light on burning wrecks (the shared pool keeps those nearest the view)
    this.fires.forEach((f, i) => {
      const k = Math.max(0, 1 - f.t / f.life);
      const intensity = 260000 * k * (0.75 + 0.25 * Math.sin(this.clock * 23 + i * 3) * Math.sin(this.clock * 7.3 + i));
      this.hooks.glow({ x: f.x, y: 30, z: f.z, intensity, distance: 300, color: 0xff7a2a });
    });

    this.drawParticles(this.fire, this.fireSprites, dt);
    this.drawParticles(this.smoke, this.smokeSprites, dt);

    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) {
        r.mesh.visible = false;
        continue;
      }
      const e = 1 - (1 - k) * (1 - k);
      r.mesh.scale.setScalar(10 + 150 * r.size * e);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.9;
    }

    // debris: ballistic, bouncing, glowing while hot, then resting until it fades out
    let n = 0;
    for (const c of this.chunks) {
      c.t += dt;
      if (c.y > 0.5 * c.sy || Math.abs(c.vy) > 1) {
        c.vy -= 620 * dt;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.z += c.vz * dt;
        c.rx += c.spin * dt;
        c.rz += c.spin * 0.7 * dt;
        if (c.y < 0.5 * c.sy) {
          c.y = 0.5 * c.sy;
          if (c.bounced < 2 && Math.abs(c.vy) > 60) {
            c.vy = -c.vy * 0.32;
            c.vx *= 0.5;
            c.vz *= 0.5;
            c.spin *= 0.5;
            c.bounced++;
          } else {
            c.vy = c.vx = c.vz = 0;
            c.spin = 0;
          }
        } else if (c.hot > 0.4 && R() < dt * 30) this.hooks.sparks(c.x, c.y, c.z, 1, 20);
      }
      c.hot = Math.max(0, c.hot - dt * 0.5);
      const fade = c.t > c.life - 1 ? Math.max(0, c.life - c.t) : 1;
      if (fade <= 0) continue;
      this.e.set(c.rx, c.ry, c.rz);
      this.q.setFromEuler(this.e);
      this.v.set(c.x, c.y, c.z);
      this.sc.set(c.sx * fade, c.sy * fade, c.sz * fade);
      this.m.compose(this.v, this.q, this.sc);
      this.debris.setMatrixAt(n, this.m);
      // scorched steel, glowing orange while hot (HDR colour so bloom picks it up)
      const h = c.hot;
      this.col.setRGB(0.09 + h * 4, 0.085 + h * 1.4, 0.08 + h * 0.25);
      this.debris.setColorAt(n, this.col);
      n++;
    }
    this.chunks = this.chunks.filter((c) => c.t < c.life);
    this.debris.count = n;
    this.debris.instanceMatrix.needsUpdate = true;
    if (this.debris.instanceColor) this.debris.instanceColor.needsUpdate = true;
  }

  private drawParticles(list: (Particle | null)[], sprites: THREE.Sprite[], dt: number): void {
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const s = sprites[i]!;
      if (!p) {
        s.visible = false;
        continue;
      }
      p.t += dt;
      const k = p.t / p.life;
      if (k >= 1) {
        list[i] = null;
        s.visible = false;
        continue;
      }
      const drag = p.kind === 'smoke' ? 1.6 : 3.2;
      p.vx *= Math.exp(-dt * drag);
      p.vz *= Math.exp(-dt * drag);
      p.vy *= Math.exp(-dt * (p.kind === 'smoke' ? 0.7 : 1.4));
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.rot += p.spin * dt;
      s.visible = true;
      s.position.set(p.x, p.y, p.z);
      const ease = 1 - (1 - k) * (1 - k);
      s.scale.setScalar(p.s0 + (p.s1 - p.s0) * ease);
      const mat = s.material;
      mat.rotation = p.rot;
      if (p.kind === 'smoke') {
        mat.opacity = p.alpha * Math.min(1, p.t / 0.25) * (1 - k);
      } else {
        // white-hot → yellow → orange → dull red, in HDR so bloom blooms it
        const heat = 1 - k;
        const hdr = p.kind === 'flame' ? 1.6 : 2.4;
        mat.color.setRGB(hdr * Math.min(1, 0.55 + heat), hdr * (0.12 + 0.7 * heat * heat), hdr * 0.35 * heat * heat * heat);
        mat.opacity = p.alpha * (1 - k * k);
      }
    }
  }
}
