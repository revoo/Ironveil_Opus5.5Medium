// The 3D mission view: renders a MissionSession with the Render Lab look (isometric Three.js).
//
// Like the 2D client, it only ever reads the player team's Observation, so hidden enemies are
// simply never drawn. The simulation runs at a fixed 30 Hz; this view interpolates between the
// last two ticks every frame.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import type { MissionSession } from '../../game/mission/session';
import type { Observation, ObsEvent, TankView } from '../../sim/observation';
import type { Vec } from '../../sim/math';
import { angleDiff } from '../../sim/math';
import { TUNING } from '../../sim/tuning';
import { Terrain, tileAt } from '../../sim/map';
import type { InputManager } from '../input';
import type { AudioEngine } from '../audio';
import type { Settings } from '../settings';
import { buildEnvironment, procUniforms } from './materials';
import { buildTank, radialTexture, type TankModel } from './models';
import { buildWorld, type BuiltWorld } from './world';
import { CueArcs, Decals, Flashes, Mist, Rain, SmokeFx, Sparks, coneMaterial } from './fx';
import { Hud3D } from './hud';

export interface MissionViewDeps {
  session: MissionSession;
  input: InputManager;
  audio: AudioEngine;
  settings: Settings;
  /** Called a moment after the mission ends. */
  onEnd: (s: MissionSession) => void;
}

interface TankVis {
  model: TankModel;
  team: 0 | 1;
  recoil: number;
  wheel: number;
  last: Vec | null;
  dead: boolean;
}

const GRADE = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uHurt: { value: 0 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; uniform float uHurt; varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      vec2 off = d * r2 * (0.012 + uHurt * 0.04);
      vec3 c = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(c, c * vec3(0.86, 1.0, 1.1), 1.0 - smoothstep(0.0, 0.42, l));
      c = mix(c, c * vec3(1.07, 1.0, 0.88), smoothstep(0.4, 1.0, l));
      c = mix(vec3(l), c, 0.9);
      c = c * 0.97 + 0.012;
      c *= 1.0 - r2 * 1.1;
      c = mix(c, c * vec3(1.4, 0.35, 0.3), uHurt * smoothstep(0.05, 0.35, r2));   // damage vignette
      c += (hash(vUv * uRes + fract(uTime) * 100.0) - 0.5) * 0.04;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export class MissionView3D {
  readonly session: MissionSession;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 8000);
  private composer!: EffectComposer;
  private gtao!: GTAOPass;
  private bloom!: UnrealBloomPass;
  private smaa!: SMAAPass;
  private grade!: ShaderPass;
  private world: BuiltWorld;
  private moon: THREE.DirectionalLight;
  private moonOffset: THREE.Vector3;
  private lampCones: THREE.Mesh[] = [];
  private beamMats: THREE.ShaderMaterial[] = [];
  private tanks = new Map<number, TankVis>();
  private shellPool: THREE.Group[] = [];
  private ghosts: THREE.Mesh[] = [];
  private mist: Mist;
  private rain: Rain;
  private decals: Decals;
  private sparks: Sparks;
  private smoke: SmokeFx;
  private flashes: Flashes;
  private arcs: CueArcs;
  private barrelMark: THREE.Mesh;
  private camTarget = new THREE.Vector3();
  private zoom = 1;
  private shake = 0;
  private hurt = 0;
  private mouse = { x: 0, y: 0 };
  private mousePx = { x: -100, y: -100 };
  private aim: Vec = { x: 0, y: 0 };
  private raf = 0;
  private last = performance.now();
  private ended = false;
  private disposed = false;
  private lampFlick = 1;
  private hud: Hud3D;
  private minimap: HTMLCanvasElement;
  private miniBase: HTMLCanvasElement;
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private listeners: (() => void)[] = [];

  constructor(
    private container: HTMLElement,
    private d: MissionViewDeps,
  ) {
    this.session = d.session;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = 'view3d';
    container.appendChild(this.renderer.domElement);

    const scene = this.scene;
    scene.background = new THREE.Color(0x05080a);
    scene.fog = new THREE.FogExp2(0x0a1012, 0.00032);
    scene.environment = buildEnvironment(this.renderer);
    scene.environmentIntensity = 0.55;
    scene.add(new THREE.HemisphereLight(0x6c8088, 0x1a201c, 0.35));
    this.moon = new THREE.DirectionalLight(0xa9c0d4, 1.2);
    this.moonOffset = new THREE.Vector3(-520, 950, -650);
    this.moon.castShadow = true;
    const low = d.settings.lowEffects;
    this.moon.shadow.mapSize.set(low ? 2048 : 4096, low ? 2048 : 4096);
    this.moon.shadow.bias = -0.0003;
    this.moon.shadow.normalBias = 1.2;
    this.moon.shadow.radius = 3;
    Object.assign(this.moon.shadow.camera, { near: 100, far: 3000 });
    scene.add(this.moon, this.moon.target);

    this.world = buildWorld(scene, this.session.level);
    for (const l of this.world.lamps) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(5, 120, 112, 32, 1, true), coneMaterial(0xffa04a, 0.16));
      c.position.set(l.x, 58, l.z);
      scene.add(c);
      this.lampCones.push(c);
    }
    this.mist = new Mist(scene, this.world.lamps.map((l) => ({ x: l.x, y: l.z })), this.world.width, this.world.height);
    this.rain = new Rain(scene);
    this.decals = new Decals(scene);
    this.sparks = new Sparks(scene);
    this.smoke = new SmokeFx(scene);
    this.flashes = new Flashes(scene);
    this.arcs = new CueArcs(scene);
    for (let i = 0; i < 12; i++) {
      const g = new THREE.Group();
      const core = new THREE.Mesh(new THREE.CapsuleGeometry(1.2, 22, 2, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 4, 1.4) }));
      core.rotation.z = Math.PI / 2;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture, color: new THREE.Color(3, 1.4, 0.5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      glow.scale.setScalar(26);
      g.add(core, glow);
      g.visible = false;
      scene.add(g);
      this.shellPool.push(g);
    }
    for (let i = 0; i < 6; i++) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(24, 27, 32), new THREE.MeshBasicMaterial({ color: 0xff6a4a, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      scene.add(ring);
      this.ghosts.push(ring);
    }
    this.barrelMark = new THREE.Mesh(new THREE.RingGeometry(4, 6, 24), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9, depthTest: false }));
    this.barrelMark.rotation.x = -Math.PI / 2;
    this.barrelMark.renderOrder = 10;
    scene.add(this.barrelMark);

    const me = this.session.world.tank(this.session.playerId);
    this.camTarget.set(me.pos.x, 0, me.pos.y);

    // ---- DOM: vehicle panel, radio, minimap, enemy alert markers
    this.hud = new Hud3D(container, this.session);
    this.minimap = document.createElement('canvas');
    this.minimap.className = 'minimap3d';
    container.appendChild(this.minimap);
    this.miniBase = this.drawMiniBase();

    const onMove = (e: MouseEvent) => {
      const r = this.renderer.domElement.getBoundingClientRect();
      this.mouse = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
      this.mousePx = { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onWheel = (e: WheelEvent) => {
      this.zoom = Math.min(2.2, Math.max(0.6, this.zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
    };
    const onResize = () => this.resize();
    window.addEventListener('mousemove', onMove);
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('resize', onResize);
    this.listeners.push(
      () => window.removeEventListener('mousemove', onMove),
      () => window.removeEventListener('wheel', onWheel),
      () => window.removeEventListener('resize', onResize),
    );

    this.buildComposer();
    this.resize();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  // ------------------------------------------------------------------ setup
  private buildComposer(): void {
    const low = this.d.settings.lowEffects;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.gtao = new GTAOPass(this.scene, this.camera, innerWidth, innerHeight);
    this.gtao.updateGtaoMaterial({ radius: 14, distanceExponent: 1.4, thickness: 4, scale: 1.2, samples: 12, distanceFallOff: 1 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 8 });
    // GTAO re-renders depth+normals; see-through effects must not be in that buffer.
    const gtaoRender = this.gtao.render.bind(this.gtao);
    this.gtao.render = (...args: Parameters<GTAOPass['render']>) => {
      const hidden: THREE.Object3D[] = [];
      this.scene.traverseVisible((o) => {
        const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
        if ((o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints || (o as THREE.Line).isLine || (mat && !Array.isArray(mat) && mat.transparent)) hidden.push(o);
      });
      hidden.forEach((o) => (o.visible = false));
      gtaoRender(...args);
      hidden.forEach((o) => (o.visible = true));
    };
    this.gtao.enabled = !low;
    this.composer.addPass(this.gtao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.55, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.smaa = new SMAAPass();
    this.smaa.enabled = !low;
    this.composer.addPass(this.smaa);
    this.grade = new ShaderPass(GRADE);
    this.composer.addPass(this.grade);
  }

  private resize(): void {
    const w = this.container.clientWidth || innerWidth, h = this.container.clientHeight || innerHeight;
    const dpr = Math.min(devicePixelRatio, this.d.settings.lowEffects ? 1 : 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.bloom.resolution.set((w * dpr) / 2, (h * dpr) / 2);
    (this.grade.uniforms.uRes as { value: THREE.Vector2 }).value.set(w * dpr, h * dpr);
    this.minimap.width = 196;
    this.minimap.height = Math.round((196 * this.world.height) / this.world.width);
  }

  private drawMiniBase(): HTMLCanvasElement {
    const map = this.session.map;
    const c = document.createElement('canvas');
    c.width = map.cols * 4;
    c.height = map.rows * 4;
    const ctx = c.getContext('2d')!;
    const col: Record<number, string> = { [Terrain.Grass]: '#1f2f26', [Terrain.Road]: '#6d6450', [Terrain.Mud]: '#5a4330', [Terrain.Brush]: '#2f4d31', [Terrain.Wall]: '#b8b6ab' };
    for (let r = 0; r < map.rows; r++)
      for (let cc = 0; cc < map.cols; cc++) {
        ctx.fillStyle = col[tileAt(map, cc, r)] ?? '#1f2f26';
        ctx.fillRect(cc * 4, r * 4, 4, 4);
      }
    ctx.strokeStyle = '#87c9e8';
    ctx.lineWidth = 2;
    for (const z of this.session.level.zonesTagged('extraction')) ctx.strokeRect((z.x / map.tile) * 4, (z.y / map.tile) * 4, (z.w / map.tile) * 4, (z.h / map.tile) * 4);
    return c;
  }

  // ------------------------------------------------------------------ camera
  private placeCamera(): void {
    const w = this.container.clientWidth || innerWidth, h = this.container.clientHeight || innerHeight;
    const halfH = 360 / this.zoom;
    Object.assign(this.camera, { left: (-halfH * w) / h, right: (halfH * w) / h, top: halfH, bottom: -halfH });
    this.camera.updateProjectionMatrix();
    const yaw = Math.PI / 4, pitch = Math.atan(1 / Math.SQRT2), dist = 2400;
    const t = this.camTarget.clone().add(new THREE.Vector3((Math.random() - 0.5) * this.shake, 0, (Math.random() - 0.5) * this.shake));
    this.camera.position.set(t.x + Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, t.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    this.camera.lookAt(t);
    this.camera.updateMatrixWorld();
  }

  /** Fit the moon's shadow map to the view and snap it to whole texels in light space (no shimmering). */
  private placeMoon(): void {
    const R = Math.max(this.camera.right - this.camera.left, (this.camera.top - this.camera.bottom) * 1.8) * 0.5 + 160;
    const cam = this.moon.shadow.camera;
    Object.assign(cam, { left: -R, right: R, top: R, bottom: -R });
    cam.updateProjectionMatrix();
    const texel = (2 * R) / this.moon.shadow.mapSize.x;
    const rot = new THREE.Matrix4().lookAt(this.moonOffset, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
    const inv = rot.clone().transpose();
    const c = this.camTarget.clone().applyMatrix4(inv);
    c.x = Math.round(c.x / texel) * texel;
    c.y = Math.round(c.y / texel) * texel;
    c.applyMatrix4(rot);
    this.moon.target.position.copy(c);
    this.moon.position.copy(c).add(this.moonOffset);
    this.moon.target.updateMatrixWorld();
  }

  /** Screen-relative WASD: W moves up the screen whatever the camera angle. */
  private screenRelative(mx: number, my: number): Vec {
    const f = new THREE.Vector3();
    this.camera.getWorldDirection(f);
    f.y = 0;
    f.normalize();
    const rx = -f.z, ry = f.x;
    return { x: rx * mx - f.x * my, y: ry * mx - f.z * my };
  }

  private project(x: number, y: number, h = 0): { x: number; y: number; on: boolean } {
    const v = new THREE.Vector3(x, h, y).project(this.camera);
    const w = this.container.clientWidth || innerWidth, hh = this.container.clientHeight || innerHeight;
    return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * hh, on: Math.abs(v.x) <= 1.05 && Math.abs(v.y) <= 1.05 };
  }

  private pan(x: number): number {
    return Math.max(-1, Math.min(1, (x - this.camTarget.x) / 700));
  }
  private vol(x: number, y: number, range = 900): number {
    return Math.max(0, 1 - Math.hypot(x - this.camTarget.x, y - this.camTarget.z) / range);
  }

  // ------------------------------------------------------------------ public control
  setPaused(p: boolean): void {
    if (p) this.session.pause();
    else this.session.resume();
    if (p) {
      this.d.audio.setEngine(0, false, false);
      this.d.audio.setChargeHum(0);
    }
  }

  applySettings(): void {
    const low = this.d.settings.lowEffects;
    this.gtao.enabled = !low;
    this.smaa.enabled = !low;
    this.resize();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.listeners.forEach((f) => f());
    this.d.audio.setEngine(0, false, false);
    this.d.audio.setChargeHum(0);
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.hud.dispose();
    this.minimap.remove();
  }

  // ------------------------------------------------------------------ frame
  private frame(now: number): void {
    if (this.disposed) return;
    this.raf = requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const s = this.session;

    // aim: mouse ray onto the ground plane
    this.ray.setFromCamera(new THREE.Vector2(this.mouse.x, this.mouse.y), this.camera);
    const hit = new THREE.Vector3();
    if (this.ray.ray.intersectPlane(this.plane, hit)) this.aim = { x: hit.x, y: hit.z };
    s.advance(dt, () => {
      const inp = this.d.input.sample(this.aim);
      const m = this.screenRelative(inp.moveX, inp.moveY);
      return { ...inp, moveX: m.x, moveY: m.y };
    });
    for (const { event } of s.drainEvents()) this.onEvent(event);
    for (const { cue } of s.drainCues()) {
      this.d.audio.cue(cue.kind, cue.sector, cue.band === 'near');
      this.arcs.cue(cue.kind, cue.sector, cue.band === 'near');
    }

    const cur = s.obs, prev = s.prevObs, a = s.alpha;
    const selfPos = this.renderTanks(prev, cur, a, dt);
    this.renderShells(prev, cur, a);
    this.renderGhosts(cur);

    if (selfPos) {
      const k = 1 - Math.exp(-dt * 6);
      this.camTarget.x += (selfPos.x - this.camTarget.x) * k;
      this.camTarget.z += (selfPos.y - this.camTarget.z) * k;
    }
    this.shake *= Math.exp(-dt * 12);
    this.hurt *= Math.exp(-dt * 2.5);
    this.placeCamera();
    this.placeMoon();

    // lamps: gentle flicker, one failing sodium lamp
    const t = now / 1000;
    if (Math.random() < 0.04) this.lampFlick = Math.random() < 0.5 ? 0.15 : 1;
    this.lampFlick += (1 - this.lampFlick) * dt * 3;
    this.world.lamps.forEach((l, i) => {
      const k = (0.96 + Math.sin(t * 1.1 + i) * 0.03) * (i === 2 ? this.lampFlick : 1);
      l.light.intensity = 320000 * k;
      l.glow.material.opacity = k;
      l.bulb.color.setRGB(8 * k, 4.4 * k, 1.6 * k);
      (this.lampCones[i]!.material as THREE.ShaderMaterial).uniforms.uStrength!.value = 0.16 * k;
      (this.lampCones[i]!.material as THREE.ShaderMaterial).uniforms.uTime!.value = t;
    });
    for (const m of this.beamMats) m.uniforms.uTime!.value = t;
    procUniforms.uTime.value = t;
    this.mist.update(t);
    this.decals.syncTracks(cur);
    this.sparks.update(dt);
    this.smoke.update(cur, dt, this.camera);
    this.rain.update(dt, this.camTarget.x, this.camTarget.z);
    this.flashes.update(dt);
    this.arcs.update(dt, selfPos);
    this.renderReticle(cur, selfPos);
    (this.grade.uniforms.uTime as { value: number }).value = t;
    (this.grade.uniforms.uHurt as { value: number }).value = this.hurt;
    this.composer.render();

    const me = cur.tanks.find((x) => x.id === s.playerId);
    this.d.audio.setEngine(me ? Math.hypot(me.vx, me.vy) : 0, !!me?.alive && !s.paused, !!me?.quiet);
    this.d.audio.setChargeHum(me && me.phase === 'charging' && !s.paused ? me.charge : 0);
    this.hud.update(cur, me, this.mousePx, (x, y, h) => this.project(x, y, h), dt);
    this.renderMinimap(cur, selfPos);

    if (s.outcome && !this.ended) {
      this.ended = true;
      setTimeout(() => !this.disposed && this.d.onEnd(s), 2600);
    }
  }

  // ------------------------------------------------------------------ tanks & shells
  private tankVis(t: TankView): TankVis {
    let v = this.tanks.get(t.id);
    if (!v) {
      const beam = coneMaterial(0xfff0cf, 0.06);
      this.beamMats.push(beam);
      v = { model: buildTank(this.scene, t.team, beam), team: t.team, recoil: 0, wheel: 0, last: null, dead: false };
      this.tanks.set(t.id, v);
    }
    return v;
  }

  private renderTanks(prev: Observation, cur: Observation, a: number, dt: number): Vec | null {
    const prevMap = new Map(prev.tanks.map((t) => [t.id, t]));
    const seen = new Set<number>();
    let self: Vec | null = null;
    for (const t of cur.tanks) {
      if (!t.alive) continue;
      const v = this.tankVis(t);
      if (v.dead) continue;
      seen.add(t.id);
      const p = prevMap.get(t.id);
      const x = p ? p.x + (t.x - p.x) * a : t.x;
      const y = p ? p.y + (t.y - p.y) * a : t.y;
      const hull = p ? p.hull + angleDiff(p.hull, t.hull) * a : t.hull;
      const tur = p ? p.turret + angleDiff(p.turret, t.turret) * a : t.turret;
      const m = v.model;
      m.root.visible = true;
      m.root.position.set(x, 0, y);
      m.root.rotation.y = -hull;
      m.turret.rotation.y = -(tur - hull);
      v.recoil *= Math.exp(-dt * 7);
      m.barrel.position.x = 14 - v.recoil * 5;
      if (v.last) {
        const fwd = (x - v.last.x) * Math.cos(hull) + (y - v.last.y) * Math.sin(hull);
        v.wheel -= fwd / 4.2;
        m.wheels.forEach((w) => (w.rotation.y = v.wheel));
      }
      v.last = { x, y };
      // In brush, a tank is drawn sunk a little and its lights dimmed (it is hidden from the enemy).
      m.root.position.y = t.inBrush ? -3 : 0;
      m.head.intensity = t.quiet ? 60000 : 220000;
      m.beam.visible = !t.quiet;
      if (t.id === this.session.playerId) self = { x, y };
    }
    for (const [id, v] of this.tanks) if (!seen.has(id) && !v.dead) v.model.root.visible = false;
    return self;
  }

  private wreck(id: number, x: number, y: number): void {
    const v = this.tanks.get(id);
    if (!v) return;
    v.dead = true;
    v.model.root.visible = true;
    v.model.root.position.set(x, 0, y);
    v.model.turret.rotation.y += (Math.random() - 0.5) * 1.2;
    v.model.turret.rotation.z = (Math.random() - 0.5) * 0.2;
    v.model.head.intensity = 0;
    v.model.beam.visible = false;
    for (const mat of v.model.materials) {
      mat.color.multiplyScalar(0.22);
      mat.roughness = 1;
      mat.metalness = 0.1;
    }
    this.smoke.wreck(x, y);
  }

  private renderShells(prev: Observation, cur: Observation, a: number): void {
    const prevMap = new Map(prev.projectiles.map((p) => [p.id, p]));
    this.shellPool.forEach((g) => (g.visible = false));
    cur.projectiles.slice(0, this.shellPool.length).forEach((p, i) => {
      const g = this.shellPool[i]!;
      const q = prevMap.get(p.id);
      const x = q ? q.x + (p.x - q.x) * a : p.x;
      const y = q ? q.y + (p.y - q.y) * a : p.y;
      g.visible = true;
      g.position.set(x, 20, y);
      g.rotation.y = -Math.atan2(p.vy, p.vx);
    });
  }

  private renderGhosts(cur: Observation): void {
    this.ghosts.forEach((g, i) => {
      const lk = cur.lastKnown[i];
      g.visible = !!lk;
      if (!lk) return;
      g.position.set(lk.x, 1.5, lk.y);
      (g.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.7 - lk.age / 90);
    });
  }

  private renderReticle(cur: Observation, selfPos: Vec | null): void {
    const me = cur.tanks.find((t) => t.id === this.session.playerId);
    this.barrelMark.visible = !!me && !!selfPos;
    if (me && selfPos) {
      const d = Math.min(Math.hypot(this.aim.x - selfPos.x, this.aim.y - selfPos.y), TUNING.vision.radius);
      this.barrelMark.position.set(selfPos.x + Math.cos(me.turret) * d, 2, selfPos.y + Math.sin(me.turret) * d);
    }
  }

  // ------------------------------------------------------------------ events
  private onEvent(e: ObsEvent): void {
    const pid = this.session.playerId;
    const reduced = this.d.settings.reducedMotion;
    switch (e.type) {
      case 'shot': {
        const v = this.tanks.get(e.tank);
        if (v) v.recoil = 1;
        this.flashes.add(e.x, e.y, 'muzzle');
        this.sparks.burst(e.x, 22, e.y, -Math.cos(e.angle), -Math.sin(e.angle), 10, 160);
        if (e.tank === pid && !reduced) this.shake = Math.max(this.shake, 4 + e.charge * 8);
        this.d.audio.shot(e.charge, this.pan(e.x), e.tank === pid ? 0.9 : 0.75 * this.vol(e.x, e.y, 1100));
        break;
      }
      case 'impact':
        this.flashes.add(e.x, e.y, 'impact');
        this.sparks.burst(e.x, 10, e.y, Math.cos(e.angle), Math.sin(e.angle), 30 + Math.round(e.charge * 30), 260);
        if (e.kind !== 'tank') this.decals.addScorch(e.x, e.y, 0.5 + e.charge * 0.5);
        this.d.audio.impact(e.kind, e.charge, this.pan(e.x), this.vol(e.x, e.y));
        break;
      case 'damage':
        if (e.target === pid) {
          this.hurt = Math.min(1, this.hurt + 0.6 + e.charge * 0.4);
          if (!reduced) this.shake = Math.max(this.shake, 6 + e.charge * 10);
        } else if (e.byUs) this.d.audio.hitConfirm();
        break;
      case 'death':
        this.flashes.add(e.x, e.y, 'explosion');
        this.sparks.burst(e.x, 16, e.y, 0, 0, 90, 340);
        this.decals.addScorch(e.x, e.y, 1.6);
        this.wreck(e.tank, e.x, e.y);
        if (!reduced) this.shake = Math.max(this.shake, 14 * this.vol(e.x, e.y, 900));
        this.d.audio.explosion(this.pan(e.x), Math.max(0.25, this.vol(e.x, e.y, 1400)));
        break;
      case 'smoke':
        this.d.audio.smoke(this.pan(e.x), this.vol(e.x, e.y));
        break;
      case 'vent': {
        const t = this.session.obs.tanks.find((x) => x.id === e.tank);
        this.d.audio.vent(t ? this.pan(t.x) : 0, t ? this.vol(t.x, t.y) : 0.5);
        break;
      }
      default:
        break;
    }
  }

  private renderMinimap(cur: Observation, selfPos: Vec | null): void {
    const ctx = this.minimap.getContext('2d')!;
    const W = this.minimap.width, H = this.minimap.height;
    const sx = W / this.world.width, sy = H / this.world.height;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(this.miniBase, 0, 0, W, H);
    ctx.globalAlpha = 1;
    for (const t of cur.tanks) {
      if (!t.alive) continue;
      const mine = t.id === this.session.playerId;
      ctx.fillStyle = mine ? '#87c9e8' : '#ff9177';
      if (mine && selfPos) {
        ctx.save();
        ctx.translate(selfPos.x * sx, selfPos.y * sy);
        ctx.rotate(t.hull);
        ctx.beginPath();
        ctx.moveTo(6, 0);
        ctx.lineTo(-4, 4);
        ctx.lineTo(-4, -4);
        ctx.fill();
        ctx.restore();
      } else ctx.fillRect(t.x * sx - 3, t.y * sy - 3, 6, 6);
    }
    for (const lk of cur.lastKnown) {
      ctx.strokeStyle = 'rgba(255,145,119,0.6)';
      ctx.strokeRect(lk.x * sx - 3, lk.y * sy - 3, 6, 6);
    }
    // view footprint
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([x, y]) => {
      const r = new THREE.Raycaster();
      r.setFromCamera(new THREE.Vector2(x, y), this.camera);
      const hit = new THREE.Vector3();
      r.ray.intersectPlane(this.plane, hit);
      return hit;
    });
    ctx.strokeStyle = 'rgba(237,244,223,0.35)';
    ctx.beginPath();
    corners.forEach((c, i) => (i ? ctx.lineTo(c.x * sx, c.z * sy) : ctx.moveTo(c.x * sx, c.z * sy)));
    ctx.closePath();
    ctx.stroke();
  }
}
