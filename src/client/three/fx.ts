// Atmosphere and transient effects for the 3D mission view, fed by the player's Observation.
import * as THREE from 'three';
import type { Observation } from '../../sim/observation';
import type { Vec } from '../../sim/math';
import { TUNING } from '../../sim/tuning';
import { canvasTexture, radialTexture, rand } from './models';

/** Additive cone shader: fades toward the open end and toward silhouette edges, with drifting dust. */
export function coneMaterial(color: THREE.ColorRepresentation, strength: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: strength }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying float vH; varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main() {
        vH = uv.y;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        vV = isOrthographic ? normalize((inverse(viewMatrix) * vec4(0.0, 0.0, 1.0, 0.0)).xyz) : normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uStrength; uniform float uTime;
      varying float vH; varying vec3 vN; varying vec3 vV; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
      void main() {
        float rim = pow(abs(dot(normalize(vN), normalize(vV))), 1.8);
        float dust = 0.75 + 0.5 * n(vW.xz * 0.05 + vec2(uTime * 0.3, vW.y * 0.04));
        gl_FragColor = vec4(uColor * uStrength * rim * pow(vH, 1.4) * dust, 1.0);
      }`,
  });
}

/** A flat sheet of drifting ground mist, lit amber near lamps. */
export class Mist {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  constructor(scene: THREE.Scene, lamps: Vec[], w: number, h: number) {
    const n = Math.max(1, lamps.length);
    const pts = lamps.length ? lamps.map((l) => new THREE.Vector2(l.x, l.y)) : [new THREE.Vector2(-9999, -9999)];
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 }, uLamps: { value: pts } },
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec2 uLamps[${n}]; varying vec3 vW;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float nz(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
        float fbm(vec2 p){ float a=.5,s=0.; for(int i=0;i<4;i++){ s+=a*nz(p); p=p*2.03+1.7; a*=.5; } return s; }
        void main(){
          vec2 p = vW.xz * 0.004;
          float d = fbm(p + vec2(uTime * 0.02, uTime * 0.012)) * fbm(p * 2.3 - vec2(uTime * 0.03, 0.0));
          float a = smoothstep(0.15, 0.55, d) * 0.32;
          vec3 c = vec3(0.07, 0.09, 0.10);
          for (int i = 0; i < ${n}; i++) { float r = length(vW.xz - uLamps[i]); c += vec3(1.0, 0.55, 0.22) * 0.9 * exp(-r * r / 9000.0); }
          gl_FragColor = vec4(c, a);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w + 1800, h + 1800), this.mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(w / 2, 7, h / 2);
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }
  update(t: number): void {
    this.mat.uniforms.uTime!.value = t;
  }
}

// ---------------------------------------------------------------- decals
export class Decals {
  private treads: THREE.InstancedMesh;
  private scorch: THREE.InstancedMesh;
  private scorchI = 0;
  private dummy = new THREE.Object3D();
  constructor(scene: THREE.Scene) {
    const treadTex = canvasTexture(
      32,
      32,
      (ctx) => {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, 32, 32);
        ctx.fillStyle = '#fff';
        for (let y = 2; y < 32; y += 8) ctx.fillRect(2, y, 28, 4);
      },
      false,
    );
    // One stamp = both treads of a tank at one spot.
    const g = new THREE.BufferGeometry();
    const a = new THREE.PlaneGeometry(9, 10);
    const left = a.clone().translate(0, 0, 0);
    left.translate(-15.5, 0, 0);
    const right = a.clone();
    right.translate(15.5, 0, 0);
    g.copy(mergePlanes([left, right]));
    this.treads = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: 0x0d0c0a, roughness: 1, transparent: true, opacity: 0.6, alphaMap: treadTex, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }), 1200);
    this.treads.count = 0;
    this.treads.receiveShadow = true;
    this.treads.renderOrder = 1;
    scene.add(this.treads);
    const scorchTex = canvasTexture(
      128,
      128,
      (ctx) => {
        const r = rand(9);
        for (let i = 0; i < 40; i++) {
          const ang = r() * Math.PI * 2, d = r() * 40;
          const gg = ctx.createRadialGradient(64 + Math.cos(ang) * d, 64 + Math.sin(ang) * d, 0, 64 + Math.cos(ang) * d, 64 + Math.sin(ang) * d, 10 + r() * 24);
          gg.addColorStop(0, 'rgba(255,255,255,0.35)');
          gg.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = gg;
          ctx.fillRect(0, 0, 128, 128);
        }
      },
      false,
    );
    this.scorch = new THREE.InstancedMesh(new THREE.PlaneGeometry(50, 50), new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1, transparent: true, alphaMap: scorchTex, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), 48);
    this.scorch.count = 0;
    this.scorch.renderOrder = 1;
    scene.add(this.scorch);
  }
  /** Track stamps come straight from the Observation (only ones the player's team has seen). */
  syncTracks(obs: Observation): void {
    const list = obs.tracks;
    const n = Math.min(list.length, 1200);
    for (let i = 0; i < n; i++) {
      const t = list[i]!;
      this.dummy.position.set(t.x, 0.2, t.y);
      this.dummy.rotation.set(-Math.PI / 2, 0, -t.axis + Math.PI / 2);
      this.dummy.scale.setScalar(0.75 + 0.25 * Math.min(1, t.stage / 3));
      this.dummy.updateMatrix();
      this.treads.setMatrixAt(i, this.dummy.matrix);
    }
    this.treads.count = n;
    this.treads.instanceMatrix.needsUpdate = true;
  }
  addScorch(x: number, z: number, scale: number): void {
    this.dummy.position.set(x, 0.3, z);
    this.dummy.rotation.set(-Math.PI / 2, 0, Math.random() * 6);
    this.dummy.scale.setScalar(scale);
    this.dummy.updateMatrix();
    this.scorch.setMatrixAt(this.scorchI, this.dummy.matrix);
    this.scorchI = (this.scorchI + 1) % 48;
    this.scorch.count = Math.max(this.scorch.count, this.scorchI === 0 ? 48 : this.scorchI);
    this.scorch.instanceMatrix.needsUpdate = true;
  }
}

function mergePlanes(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], nor: number[] = [], idx: number[] = [];
  let off = 0;
  for (const g of gs) {
    const p = g.attributes.position!, u = g.attributes.uv!, nn = g.attributes.normal!;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      uv.push(u.getX(i), u.getY(i));
      nor.push(nn.getX(i), nn.getY(i), nn.getZ(i));
    }
    for (const i of g.index!.array) idx.push(i + off);
    off += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}

// ---------------------------------------------------------------- sparks
export class Sparks {
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private geo = new THREE.BufferGeometry();
  private next = 0;
  constructor(scene: THREE.Scene, readonly max = 1600) {
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const pts = new THREE.Points(this.geo, new THREE.PointsMaterial({ size: 2.6, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, map: radialTexture }));
    pts.frustumCulled = false;
    scene.add(pts);
  }
  burst(x: number, y: number, z: number, dx: number, dz: number, n: number, speed: number): void {
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      const a = Math.random() * Math.PI * 2, up = Math.random();
      const sp = speed * (0.3 + Math.random());
      this.pos.set([x, y, z], i * 3);
      this.vel.set([Math.cos(a) * sp * 0.6 - dx * sp * 0.6, up * sp * 0.9, Math.sin(a) * sp * 0.6 - dz * sp * 0.6], i * 3);
      this.life[i] = 0.3 + Math.random() * 0.5;
    }
  }
  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      const l = this.life[i]!;
      if (l <= 0) {
        this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0;
        continue;
      }
      this.life[i] = l - dt;
      this.vel[i * 3 + 1]! -= 420 * dt;
      for (let k = 0; k < 3; k++) this.pos[i * 3 + k]! += this.vel[i * 3 + k]! * dt;
      if (this.pos[i * 3 + 1]! < 0.5) {
        this.pos[i * 3 + 1] = 0.5;
        this.vel[i * 3 + 1]! *= -0.35;
        this.vel[i * 3]! *= 0.6;
        this.vel[i * 3 + 2]! *= 0.6;
      }
      const k = Math.min(1, l * 2.5);
      this.col.set([6 * k, 2.6 * k * k, 0.6 * k * k * k], i * 3);
    }
    this.geo.attributes.position!.needsUpdate = true;
    this.geo.attributes.color!.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- smoke
const puffTex = canvasTexture(
  128,
  128,
  (ctx) => {
    const r = rand(3);
    for (let i = 0; i < 26; i++) {
      const x = 64 + (r() - 0.5) * 50, y = 64 + (r() - 0.5) * 50, rad = 14 + r() * 26;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, 'rgba(255,255,255,0.22)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    }
  },
  false,
);

interface Plume {
  x: number;
  z: number;
  /** Seconds alive. */
  t: number;
  life: number;
  radius: number;
  seed: number;
  dark: boolean;
  active: boolean;
}

/**
 * Smoke screens (from the Observation) and burning-wreck plumes, drawn as lit, rotating billboards.
 * Smoke clouds are visual only; the simulation decides what they block.
 */
export class SmokeFx {
  private puffs: THREE.Mesh[] = [];
  private clouds = new Map<number, Plume>();
  private plumes: Plume[] = [];
  static readonly PER = 30;
  constructor(scene: THREE.Scene, max = 8) {
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < max * SmokeFx.PER; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xa3a8a4, alphaMap: puffTex, transparent: true, depthWrite: false }));
      m.visible = false;
      m.renderOrder = 3;
      scene.add(m);
      this.puffs.push(m);
    }
  }
  wreck(x: number, z: number): void {
    this.plumes.push({ x, z, t: 0, life: 40, radius: 30, seed: Math.random() * 1000, dark: true, active: true });
    if (this.plumes.length > 3) this.plumes.shift();
  }
  update(obs: Observation, dt: number, cam: THREE.Camera): void {
    const seen = new Set<number>();
    for (const s of obs.smokes) {
      seen.add(s.id);
      let c = this.clouds.get(s.id);
      if (!c) this.clouds.set(s.id, (c = { x: s.x, z: s.y, t: 0, life: TUNING.smoke.lifetime, radius: s.radius, seed: s.id * 977, dark: false, active: true }));
      c.radius = s.radius;
      c.active = true;
    }
    for (const [id, c] of this.clouds) {
      c.t += dt;
      if (!seen.has(id)) {
        c.active = false;
        if (c.t > c.life + 2) this.clouds.delete(id);
      }
    }
    for (const p of this.plumes) p.t += dt;
    this.plumes = this.plumes.filter((p) => p.t < p.life);
    let pi = 0;
    const draw = (c: Plume, column: boolean) => {
      const fadeIn = Math.min(1, c.t / 0.5);
      const fadeOut = c.active ? 1 : Math.max(0, 1 - (c.t - c.life) / 2);
      const alpha = fadeIn * fadeOut * (column ? 0.55 * Math.max(0, 1 - c.t / c.life) : 0.85);
      if (alpha <= 0.01) return;
      const rnd = rand(Math.floor(c.seed) + 1);
      for (let k = 0; k < SmokeFx.PER && pi < this.puffs.length; k++, pi++) {
        const m = this.puffs[pi]!;
        const ang = rnd() * Math.PI * 2, dist = Math.sqrt(rnd()) * c.radius * (column ? 0.35 : 0.8), hgt = rnd();
        const rise = column ? ((c.t * (8 + rnd() * 10) + hgt * 120) % 140) : 6 + hgt * 50 + c.t * 2.5;
        const drift = column ? rise * 0.25 : c.t * (2 + rnd() * 4);
        m.visible = true;
        m.position.set(c.x + Math.cos(ang) * (dist + drift), rise, c.z + Math.sin(ang) * (dist + drift * 0.3));
        m.quaternion.copy(cam.quaternion);
        m.rotateZ(rnd() * 6 + c.t * (rnd() - 0.5) * 0.4);
        const grow = column ? 0.4 + rise / 140 : (0.6 + 0.4 * Math.min(1, c.t)) * (0.7 + rnd() * 0.6);
        m.scale.setScalar((column ? 46 : c.radius) * grow);
        const mat = m.material as THREE.MeshLambertMaterial;
        mat.opacity = alpha * (column ? 1 - rise / 160 : 1);
        mat.color.setHex(c.dark ? 0x3a3a38 : 0xa3a8a4);
      }
    };
    for (const c of this.clouds.values()) draw(c, false);
    for (const p of this.plumes) draw(p, true);
    for (; pi < this.puffs.length; pi++) this.puffs[pi]!.visible = false;
  }
}

// ---------------------------------------------------------------- rain
export class Rain {
  readonly lines: THREE.LineSegments;
  private pos: Float32Array;
  private drops: { x: number; y: number; z: number; v: number }[] = [];
  constructor(scene: THREE.Scene, readonly n = 1600) {
    this.pos = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) this.drops.push({ x: Math.random() * 1400 - 700, y: Math.random() * 400, z: Math.random() * 1400 - 700, v: 520 + Math.random() * 160 });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x9fb0b8, transparent: true, opacity: 0.22, depthWrite: false }));
    this.lines.frustumCulled = false;
    scene.add(this.lines);
  }
  update(dt: number, cx: number, cz: number): void {
    const wind = 40;
    this.drops.forEach((d, i) => {
      d.y -= d.v * dt;
      d.x += wind * dt;
      if (d.y < 0) {
        d.y += 400;
        d.x = Math.random() * 1400 - 700;
        d.z = Math.random() * 1400 - 700;
      }
      const x = cx + d.x, z = cz + d.z;
      this.pos.set([x, d.y, z, x - wind * 0.02, d.y + 14, z], i * 6);
    });
    this.lines.geometry.attributes.position!.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- flashes (sprite + light)
interface Flash {
  x: number;
  z: number;
  y: number;
  t: number;
  dur: number;
  size: number;
  light: number;
}
export class Flashes {
  private sprites: THREE.Sprite[] = [];
  private list: Flash[] = [];
  constructor(
    scene: THREE.Scene,
    private glow: GlowLights,
  ) {
    for (let i = 0; i < 12; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture, color: new THREE.Color(4, 2.2, 0.8), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.visible = false;
      scene.add(s);
      this.sprites.push(s);
    }
  }
  add(x: number, z: number, kind: 'muzzle' | 'impact' | 'explosion', scale = 1): void {
    const f: Flash =
      kind === 'muzzle'
        ? { x, z, y: 22, t: 0, dur: 0.1 + 0.08 * scale, size: 46 * scale, light: 300000 * scale }
        : kind === 'impact'
          ? { x, z, y: 14, t: 0, dur: 0.35, size: 90, light: 520000 }
          : { x, z, y: 24, t: 0, dur: 0.35 + 0.3 * scale, size: 150 * scale, light: 450000 * scale };
    this.list.push(f);
    if (this.list.length > 12) this.list.shift();
  }
  update(dt: number): void {
    for (const f of this.list) f.t += dt;
    this.list = this.list.filter((f) => f.t < f.dur);
    this.sprites.forEach((s, i) => {
      const f = this.list[this.list.length - 1 - i];
      s.visible = !!f;
      if (!f) return;
      const k = 1 - f.t / f.dur;
      s.position.set(f.x, f.y, f.z);
      s.scale.setScalar(f.size * (0.6 + 0.4 * k));
      s.material.opacity = k;
    });
    for (const f of this.list) {
      const k = 1 - f.t / f.dur;
      this.glow.request({ x: f.x, y: f.y + 6, z: f.z, intensity: f.light * k * k, distance: 380, color: 0xffa04a });
    }
  }
}

// ---------------------------------------------------------------- effect lights
export interface GlowRequest {
  x: number;
  y: number;
  z: number;
  intensity: number;
  distance: number;
  color: number;
}

/**
 * One small pool of point lights shared by every short-lived effect (muzzle and explosion flashes,
 * burning wrecks, the charging cannon). Each light is paid for by every lit pixel even at intensity
 * 0, so instead of each effect owning its own (six in all), effects request light each frame and the
 * brightest requests near the view get the pool. Colour and range are per request (uniforms only:
 * no shader recompile).
 */
export class GlowLights {
  static readonly COUNT = 3;
  private lights: THREE.PointLight[] = [];
  private reqs: GlowRequest[] = [];
  constructor(scene: THREE.Scene) {
    for (let i = 0; i < GlowLights.COUNT; i++) {
      const l = new THREE.PointLight(0xffa04a, 0, 300, 2);
      scene.add(l);
      this.lights.push(l);
    }
  }
  begin(): void {
    this.reqs.length = 0;
  }
  request(r: GlowRequest): void {
    if (r.intensity > 0) this.reqs.push(r);
  }
  /** Assign the pool to the strongest requests, discounted by distance from the view centre. */
  end(focus: { x: number; z: number }): void {
    const score = (r: GlowRequest) => r.intensity / (1 + ((r.x - focus.x) ** 2 + (r.z - focus.z) ** 2) / 640000);
    if (this.reqs.length > GlowLights.COUNT) this.reqs.sort((a, b) => score(b) - score(a));
    this.lights.forEach((l, i) => {
      const r = this.reqs[i];
      if (!r) {
        l.intensity = 0;
        return;
      }
      l.position.set(r.x, r.y, r.z);
      l.intensity = r.intensity;
      l.distance = r.distance;
      l.color.setHex(r.color);
    });
  }
}

// ---------------------------------------------------------------- tank headlights
/** One tank's headlight request for this frame, in world units (x, z ground plane). */
export interface HeadlightReq {
  x: number;
  z: number;
  y: number;
  hull: number;
  intensity: number;
}

/**
 * A fixed pool of headlight spotlights that never leaves the scene. three.js bakes the number of
 * visible lights into every lit shader, so a light per tank (hidden with its tank when the tank
 * leaves vision) recompiled every material each time an enemy appeared or vanished: multi-second
 * freezes. Here the light count is constant; unused lights just sit at intensity 0.
 */
export class Headlights {
  static readonly COUNT = 4;
  private lights: THREE.SpotLight[] = [];
  private reqs: HeadlightReq[] = [];
  constructor(scene: THREE.Scene) {
    for (let i = 0; i < Headlights.COUNT; i++) {
      const l = new THREE.SpotLight(0xfff0cf, 0, 520, 0.5, 0.6, 2);
      l.castShadow = false;
      scene.add(l, l.target);
      this.lights.push(l);
    }
  }
  /** Call once per frame before `request`. */
  begin(): void {
    this.reqs.length = 0;
  }
  request(r: HeadlightReq): void {
    this.reqs.push(r);
  }
  /** Assign the pool to the requests nearest `focus` (the player); switch the rest off. */
  end(focus: Vec | null): void {
    if (focus && this.reqs.length > Headlights.COUNT) {
      const d = (r: HeadlightReq) => (r.x - focus.x) ** 2 + (r.z - focus.y) ** 2;
      this.reqs.sort((a, b) => d(a) - d(b));
    }
    this.lights.forEach((l, i) => {
      const r = this.reqs[i];
      if (!r) {
        l.intensity = 0;
        return;
      }
      const c = Math.cos(r.hull);
      const s = Math.sin(r.hull);
      l.intensity = r.intensity;
      l.position.set(r.x + c * 24, r.y + 13, r.z + s * 24);
      l.target.position.set(r.x + c * 160, r.y, r.z + s * 160);
    });
  }
}

/** Expanding ground arcs around the player showing the direction of unseen sounds. */
export class CueArcs {
  private arcs: { mesh: THREE.Mesh; t: number }[] = [];
  private pool: THREE.Mesh[] = [];
  constructor(private scene: THREE.Scene) {
    const geo = new THREE.RingGeometry(58, 64, 24, 1, -Math.PI / 8, Math.PI / 4);
    geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      m.visible = false;
      m.renderOrder = 4;
      this.scene.add(m);
      this.pool.push(m);
    }
  }
  cue(kind: string, sector: number, near: boolean): void {
    const m = this.pool.find((p) => !p.visible);
    if (!m) return;
    m.visible = true;
    m.rotation.y = -(sector * Math.PI) / 4;
    const col = { shot: 0xff5a3a, charge: 0xffd23a, engine: 0xe8eef5, smoke: 0xa8b0bc, explosion: 0xff9a3a }[kind] ?? 0xffffff;
    (m.material as THREE.MeshBasicMaterial).color.setHex(col);
    m.userData.near = near;
    this.arcs.push({ mesh: m, t: 0 });
  }
  update(dt: number, at: Vec | null): void {
    for (const a of this.arcs) {
      a.t += dt;
      const k = a.t / 1.4;
      a.mesh.visible = k < 1 && !!at;
      if (!at) continue;
      a.mesh.position.set(at.x, 3, at.y);
      a.mesh.scale.setScalar((a.mesh.userData.near ? 1.0 : 1.6) * (1 + k * 0.5));
      (a.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.9;
    }
    this.arcs = this.arcs.filter((a) => a.t < 1.4);
  }
}
