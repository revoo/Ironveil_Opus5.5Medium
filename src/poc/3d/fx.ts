// Atmosphere and transient effects for the 3D PoC.
import * as THREE from 'three';
import { LAMPS, SMOKE_LIFE, YARD, smokeAlpha, smokeRadius, type Sandbox } from '../shared';
import { rand, radialTexture } from './props';

function canvasTex(size: number, paint: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  paint(c.getContext('2d')!);
  return new THREE.CanvasTexture(c);
}

// ---------- fake volumetric light: cones + lit ground mist ----------

/** Additive cone shader: fades toward the open end and toward silhouette edges (fresnel-ish). */
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
        float dust = 0.75 + 0.5 * n(vW.xz * 0.05 + vec2(uTime * 0.3, vW.y * 0.04));   // drifting dust in the beam
        float a = uStrength * rim * pow(vH, 1.4) * dust;
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
  });
}

export class Mist {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  constructor(scene: THREE.Scene) {
    const lamps = LAMPS.map((l) => new THREE.Vector2(l.x, l.y));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 }, uLamps: { value: lamps } },
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec2 uLamps[${LAMPS.length}]; varying vec3 vW;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
        float fbm(vec2 p){ float a=.5,s=0.; for(int i=0;i<4;i++){ s+=a*n(p); p=p*2.03+1.7; a*=.5; } return s; }
        void main(){
          vec2 p = vW.xz * 0.004;
          float d = fbm(p + vec2(uTime * 0.02, uTime * 0.012)) * fbm(p * 2.3 - vec2(uTime * 0.03, 0.0));
          float a = smoothstep(0.15, 0.55, d) * 0.32;
          // Mist is lit by the streetlamps: amber where a lamp is near, cool moonlit grey elsewhere.
          vec3 c = vec3(0.07, 0.09, 0.10);
          for (int i = 0; i < ${LAMPS.length}; i++) {
            float r = length(vW.xz - uLamps[i]);
            c += vec3(1.0, 0.55, 0.22) * 0.9 * exp(-r * r / 9000.0);
          }
          gl_FragColor = vec4(c, a);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(YARD.w + 1400, YARD.h + 1400), this.mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(YARD.w / 2, 7, YARD.h / 2);
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }
  update(t: number): void {
    this.mat.uniforms.uTime.value = t;
  }
}

// ---------- decals: tread marks and scorch marks (ring buffers of instanced quads) ----------
class DecalRing {
  readonly mesh: THREE.InstancedMesh;
  private i = 0;
  private dummy = new THREE.Object3D();
  constructor(scene: THREE.Scene, geo: THREE.BufferGeometry, mat: THREE.Material, readonly count: number) {
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.receiveShadow = true;
    this.mesh.count = 0;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }
  add(x: number, z: number, rot: number, scale: number, y = 0.25): void {
    this.dummy.position.set(x, y, z);
    this.dummy.rotation.set(-Math.PI / 2, 0, rot);
    this.dummy.scale.setScalar(scale);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(this.i, this.dummy.matrix);
    this.i = (this.i + 1) % this.count;
    this.mesh.count = Math.max(this.mesh.count, this.i === 0 ? this.count : this.i);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Decals {
  private treads: DecalRing;
  private scorch: DecalRing;
  private last = new Map<number, { x: number; y: number }>();
  constructor(scene: THREE.Scene) {
    const treadTex = canvasTex(32, (ctx) => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 32, 32);
      ctx.fillStyle = '#fff';
      for (let y = 2; y < 32; y += 8) ctx.fillRect(2, y, 28, 4);
    });
    this.treads = new DecalRing(
      scene,
      new THREE.PlaneGeometry(7, 9),
      new THREE.MeshStandardMaterial({ color: 0x0d0c0a, roughness: 1, transparent: true, opacity: 0.55, alphaMap: treadTex, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }),
      900,
    );
    const scorchTex = canvasTex(128, (ctx) => {
      const r = rand(9);
      for (let i = 0; i < 40; i++) {
        const a = r() * Math.PI * 2, d = r() * 40;
        const g = ctx.createRadialGradient(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 0, 64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 10 + r() * 24);
        g.addColorStop(0, 'rgba(255,255,255,0.35)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 128, 128);
      }
    });
    this.scorch = new DecalRing(
      scene,
      new THREE.PlaneGeometry(50, 50),
      new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1, transparent: true, alphaMap: scorchTex, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      40,
    );
  }
  update(sb: Sandbox): void {
    sb.tanks.forEach((t, i) => {
      const prev = this.last.get(i);
      if (!prev) {
        this.last.set(i, { x: t.x, y: t.y });
        return;
      }
      if (Math.hypot(t.x - prev.x, t.y - prev.y) < 8) return;
      prev.x = t.x;
      prev.y = t.y;
      const c = Math.cos(t.hull), s = Math.sin(t.hull);
      for (const side of [-15.5, 15.5]) this.treads.add(t.x - s * side - c * 18, t.y + c * side - s * 18, -t.hull + Math.PI / 2, 1, 0.2);
    });
    for (const e of sb.events) if (e.type === 'impact') this.scorch.add(e.x, e.y, Math.random() * 6, 0.6 + Math.random() * 0.5, 0.3);
  }
}

// ---------- sparks (CPU particles in one Points draw) ----------
export class Sparks {
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private geo = new THREE.BufferGeometry();
  private next = 0;
  constructor(scene: THREE.Scene, readonly max = 400) {
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
      const l = this.life[i];
      if (l <= 0) {
        this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0;
        continue;
      }
      this.life[i] = l - dt;
      this.vel[i * 3 + 1] -= 420 * dt;
      for (let k = 0; k < 3; k++) this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt;
      if (this.pos[i * 3 + 1] < 0.5) {
        this.pos[i * 3 + 1] = 0.5;
        this.vel[i * 3 + 1] *= -0.35;
        this.vel[i * 3] *= 0.6;
        this.vel[i * 3 + 2] *= 0.6;
      }
      const k = Math.min(1, l * 2.5);
      this.col.set([6 * k, 2.6 * k * k, 0.6 * k * k * k], i * 3);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}

// ---------- smoke: lit, soft, rotating billboards ----------
export class SmokeFx {
  private puffs: THREE.Mesh[] = [];
  private seeds: number[] = [];
  static readonly PER = 34;
  constructor(scene: THREE.Scene) {
    const tex = canvasTex(128, (ctx) => {
      const r = rand(3);
      for (let i = 0; i < 26; i++) {
        const x = 64 + (r() - 0.5) * 50, y = 64 + (r() - 0.5) * 50, rad = 14 + r() * 26;
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, 'rgba(255,255,255,0.22)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 128, 128);
      }
    });
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 4 * SmokeFx.PER; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xa3a8a4, alphaMap: tex, transparent: true, depthWrite: false }));
      m.visible = false;
      m.renderOrder = 3;
      scene.add(m);
      this.puffs.push(m);
      this.seeds.push(Math.random());
    }
  }
  update(sb: Sandbox, cam: THREE.Camera): void {
    let pi = 0;
    for (const s of sb.smokes.slice(-4)) {
      const r = smokeRadius(s), a = smokeAlpha(s);
      const rnd = rand(Math.floor(s.seed * 1000) + 1);
      for (let k = 0; k < SmokeFx.PER; k++, pi++) {
        const m = this.puffs[pi];
        const ang = rnd() * Math.PI * 2, dist = Math.sqrt(rnd()) * r * 0.8, hgt = rnd();
        const drift = s.t * (2 + rnd() * 4);
        m.visible = true;
        m.position.set(s.x + Math.cos(ang) * (dist + drift), 6 + hgt * 55 + s.t * 2.5, s.y + Math.sin(ang) * (dist + drift));
        m.quaternion.copy(cam.quaternion);
        m.rotateZ(rnd() * 6 + s.t * (rnd() - 0.5) * 0.4);
        m.scale.setScalar(r * (0.7 + rnd() * 0.6) * (0.6 + 0.4 * Math.min(1, s.t)));
        (m.material as THREE.MeshLambertMaterial).opacity = a * (1 - (s.t / SMOKE_LIFE) * 0.4);
      }
    }
    for (; pi < this.puffs.length; pi++) this.puffs[pi].visible = false;
  }
}

// ---------- rain: line segments wrapped around the camera target ----------
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
    this.lines.geometry.attributes.position.needsUpdate = true;
  }
}

// ---------- muzzle flash sprites ----------
export class Flashes {
  private sprites: THREE.Sprite[] = [];
  constructor(scene: THREE.Scene) {
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture, color: new THREE.Color(4, 2.2, 0.8), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.visible = false;
      scene.add(s);
      this.sprites.push(s);
    }
  }
  update(sb: Sandbox): void {
    this.sprites.forEach((s, i) => {
      const f = sb.flashes[sb.flashes.length - 1 - i];
      s.visible = !!f;
      if (!f) return;
      const k = 1 - f.t / f.dur;
      s.position.set(f.x, f.big ? 14 : 22, f.y);
      s.scale.setScalar((f.big ? 90 : 46) * (0.6 + 0.4 * k));
      s.material.opacity = k;
    });
  }
}

