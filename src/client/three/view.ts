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
import { CueArcs, Decals, Flashes, Headlights, Mist, Rain, SmokeFx, Sparks, coneMaterial } from './fx';
import { Blasts } from './blast';
import { Comms } from './comms';
import { Hud3D } from './hud';
import { Telemetry } from './telemetry';
import { LampLights } from './lamps';
import { DynamicResolution } from './dynres';
import { PerfLog } from './perflog';
import { codeLabel } from '../settings';

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
  /** Hit glow on the hull, 1 at impact, fading. */
  flash: number;
  /** Seconds since death (wreck animation), -1 while alive. */
  deadT: number;
  /** Charge glow at the muzzle and a ring on the ground, scaled by the visible charge. */
  glow: THREE.Sprite;
  ring: THREE.Mesh;
  /** The turret blown off the wreck, flying until it lands. */
  toss: { vx: number; vy: number; vz: number; sx: number; sz: number; landed: boolean } | null;
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
  private chargeRingGeo = new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2);
  /** Lights the player's hull while the cannon charges. Always present, so the light count never changes. */
  private chargeLight = new THREE.PointLight(0xffb060, 0, 180, 2);
  private lampLights!: LampLights;
  private lampK: number[] = [];
  private dynRes = new DynamicResolution();
  private perfLog: PerfLog;
  private bufSize = new THREE.Vector2();
  private wasFull = false;
  private frameDt = 0;
  private ghosts: THREE.Mesh[] = [];
  private mist: Mist;
  private rain: Rain;
  private decals: Decals;
  private sparks: Sparks;
  private smoke: SmokeFx;
  private flashes: Flashes;
  private blasts: Blasts;
  private headlights: Headlights;
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
  private comms: Comms;
  /** When the next bit of distant net traffic may play (performance.now ms). */
  private nextNet = performance.now() + 9000;
  private telemetry: Telemetry;
  private minimap: HTMLCanvasElement;
  private miniBase: HTMLCanvasElement;
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private listeners: (() => void)[] = [];
  // audio direction state
  private heardRadio = new Set<string>();
  private heardBarks = new Set<string>();
  private noticeCount = 0;
  private hadChoice = false;
  private lastDet = 0;
  private lastCombat = -1e9;
  private moodSent = '';
  private tensionSent = -1;
  private outcomeSounded = false;

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
    this.moon.shadow.mapSize.setScalar(low ? 1024 : 2048);
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
    this.lampLights = new LampLights(scene, this.world.lamps, low);
    procUniforms.uProcOn.value = low ? 0 : 1;
    this.mist = new Mist(scene, this.world.lamps.map((l) => ({ x: l.x, y: l.z })), this.world.width, this.world.height);
    this.rain = new Rain(scene);
    this.decals = new Decals(scene);
    this.sparks = new Sparks(scene);
    this.smoke = new SmokeFx(scene);
    this.flashes = new Flashes(scene);
    scene.add(this.chargeLight);
    this.blasts = new Blasts(scene, {
      flash: (x, z, scale) => this.flashes.add(x, z, 'explosion', scale),
      sparks: (x, y, z, n, speed) => this.sparks.burst(x, y, z, 0, 0, n, speed),
      boom: (x, z, size, main) => {
        this.lampLights.blast(x, z);
        const vol = Math.max(0.2, this.vol(x, z, 1500));
        if (main) this.d.audio.explosion(this.pan(x), vol);
        else this.d.audio.cookOff(size, this.pan(x), vol);
      },
      shake: (x, z, amount) => {
        if (!this.d.settings.reducedMotion) this.shake = Math.max(this.shake, amount * Math.max(0.15, this.vol(x, z, 1000)));
      },
      crackle: (x, z) => this.d.audio.crackle(this.pan(x), this.vol(x, z, 700)),
    });
    this.headlights = new Headlights(scene);
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
    this.comms = new Comms(this.hud.root, (l, u, v) => this.d.audio.transmit(u, v, l.enemy));
    this.comms.setVisible(d.settings.showRadio);
    this.telemetry = new Telemetry(this.hud.root, this.renderer);
    this.perfLog = new PerfLog({ mission: this.session.def.id, low: this.d.settings.lowEffects }, this.renderer.getContext() as WebGL2RenderingContext);
    this.telemetry.setKeyLabel(codeLabel(d.settings.bindings.telemetry[0] ?? 'KeyV'));
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
    d.audio.setScene('mission');
    d.audio.setMood('calm');
    // lines already on the radio at construction (e.g. after a checkpoint) are not replayed
    for (const r of this.session.radio) this.heardRadio.add(`${r.tick}|${r.from}|${r.text}`);
    for (const b of this.session.barks) this.heardBarks.add(`${b.unit}|${b.tick}|${b.text}`);
    this.noticeCount = this.session.notices.length;
    this.prewarmShaders();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  // ------------------------------------------------------------------ setup
  /**
   * Compile every shader the mission can need before the first frame, so nothing compiles mid-play
   * (a first-time compile stalls the main thread). `renderer.compile` skips invisible objects, so
   * pooled FX and one tank per team are shown for the call, then hidden again. The warm-up tanks
   * stay hidden rather than disposed: disposing their materials would release the cached programs.
   */
  private prewarmShaders(): void {
    for (const team of [0, 1] as const) {
      const beam = coneMaterial(0xfff0cf, 0.06);
      this.beamMats.push(beam);
      buildTank(this.scene, team, beam).root.visible = false;
    }
    const hidden: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    // Compile the variant the composer actually renders (into its offscreen target: no tone
    // mapping, linear output), not the on-screen one.
    this.renderer.setRenderTarget(this.composer.renderTarget1);
    this.renderer.compile(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    for (const o of hidden) o.visible = false;
  }

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
    // Retina screens report 2: at full DPR every effect pass runs on 4x the pixels for a sharpness
    // that the film grain and bloom mostly hide. High stops at 1.5, Low renders at CSS pixels.
    // Dynamic resolution scales that down when frames run long (never below 0.75 of a CSS pixel).
    const base = Math.min(devicePixelRatio, this.d.settings.lowEffects ? 1 : 1.5);
    const dpr = Math.max(Math.min(base, 0.75), base * this.dynRes.scale);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    // ambient occlusion is soft by nature: compute it at half resolution (a quarter of the pixels)
    this.gtao.setSize(Math.round((w * dpr) / 2), Math.round((h * dpr) / 2));
    this.bloom.resolution.set((w * dpr) / 2, (h * dpr) / 2);
    (this.grade.uniforms.uRes as { value: THREE.Vector2 }).value.set(w * dpr, h * dpr);
    this.minimap.width = 196;
    this.minimap.height = this.miniFollows() ? 147 : Math.round((196 * this.world.height) / this.world.width);
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
    // Checkpoints are level data, not intel: small amber diamonds help find the way on big maps.
    ctx.fillStyle = 'rgba(241,208,156,0.85)';
    for (const m of this.session.level.markersTagged('checkpoint')) {
      const x = (m.x / map.tile) * 4, y = (m.y / map.tile) * 4, r = this.miniFollows() ? 5 : 4;
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.fill();
    }
    return c;
  }

  /** Big maps get a minimap window that follows the player instead of the whole map squeezed in. */
  private miniFollows(): boolean {
    return this.world.width > 4200 || this.world.height > 3000;
  }

  /** The world rectangle the minimap shows. */
  private miniWindow(selfPos: Vec | null): { x0: number; y0: number; w: number; h: number } {
    if (!this.miniFollows()) return { x0: 0, y0: 0, w: this.world.width, h: this.world.height };
    const w = Math.min(this.world.width, 2600), h = Math.min(this.world.height, (w * 147) / 196);
    const c = selfPos ?? { x: w / 2, y: h / 2 };
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    return { x0: clamp(c.x - w / 2, 0, this.world.width - w), y0: clamp(c.y - h / 2, 0, this.world.height - h), w, h };
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

  /** The view's footprint on the ground: centre and half extents across / along the view direction. */
  private viewFootprint(): { x: number; z: number; halfW: number; halfD: number } {
    const halfH = (this.camera.top - this.camera.bottom) / 2;
    // the ground is seen at the camera pitch, so screen height stretches by 1/sin(pitch) = √3
    return { x: this.camTarget.x, z: this.camTarget.z, halfW: (this.camera.right - this.camera.left) / 2, halfD: halfH * Math.sqrt(3) };
  }

  /** Things that move and cast shadows into the lamp lights this frame: visible tanks and settling wrecks. */
  private movers(): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    for (const v of this.tanks.values()) {
      const r = v.model.root;
      if (r.visible && (!v.dead || v.deadT < 6)) out.push({ x: r.position.x, z: r.position.z });
    }
    return out;
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

  toggleTelemetry(): void {
    this.telemetry.toggle();
  }

  applySettings(): void {
    const low = this.d.settings.lowEffects;
    this.gtao.enabled = !low;
    this.smaa.enabled = !low;
    this.perfLog.setLow(low);
    procUniforms.uProcOn.value = low ? 0 : 1;
    this.lampLights.setLow(low);
    const moonSize = low ? 1024 : 2048;
    if (this.moon.shadow.mapSize.x !== moonSize) {
      this.moon.shadow.mapSize.setScalar(moonSize);
      this.moon.shadow.map?.dispose();
      this.moon.shadow.map = null;
    }
    this.resize();
  }

  dispose(): void {
    this.disposed = true;
    void this.perfLog.flush();
    cancelAnimationFrame(this.raf);
    this.listeners.forEach((f) => f());
    this.d.audio.setEngine(0, false, false);
    this.d.audio.setChargeHum(0);
    this.d.audio.setMood('menu');
    this.d.audio.setScene('menu');
    // Free GPU memory and the WebGL context itself; otherwise every retry leaks a context
    // (browsers cap them at ~16) along with shadow maps and post-processing buffers.
    this.composer.dispose();
    this.gtao.dispose();
    this.bloom.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = (Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) as THREE.Material[];
      for (const mat of mats) {
        for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
        mat.dispose();
      }
      if ((o as THREE.Light).isLight) (o as THREE.DirectionalLight).shadow?.dispose();
    });
    this.scene.environment?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.telemetry.dispose();
    this.comms.dispose();
    this.hud.dispose();
    this.minimap.remove();
  }

  // ------------------------------------------------------------------ frame
  private frame(now: number): void {
    if (this.disposed) return;
    this.raf = requestAnimationFrame((t) => this.frame(t));
    const t0 = performance.now();
    this.telemetry.frameStart(now);
    const frameMs = now - this.last;
    if (this.dynRes.update(frameMs)) this.resize();
    this.telemetry.resScale = this.dynRes.scale;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.frameDt = dt;
    this.last = now;
    const s = this.session;

    // aim: mouse ray onto the ground plane
    this.ray.setFromCamera(new THREE.Vector2(this.mouse.x, this.mouse.y), this.camera);
    const hit = new THREE.Vector3();
    if (this.ray.ray.intersectPlane(this.plane, hit)) this.aim = { x: hit.x, y: hit.z };
    const tSim = performance.now();
    const ticks = s.advance(dt, () => {
      const inp = this.d.input.sample(this.aim);
      const m = this.screenRelative(inp.moveX, inp.moveY);
      return { ...inp, moveX: m.x, moveY: m.y };
    });
    const simMs = performance.now() - tSim;
    for (const { event } of s.drainEvents()) this.onEvent(event);
    for (const { cue } of s.drainCues()) {
      this.d.audio.cue(cue.kind, cue.sector, cue.band === 'near');
      this.arcs.cue(cue.kind, cue.sector, cue.band === 'near');
    }

    const cur = s.obs, prev = s.prevObs, a = s.alpha;
    this.headlights.begin();
    const selfPos = this.renderTanks(prev, cur, a, dt);
    this.headlights.end(selfPos);
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
      this.lampK[i] = k;
      l.glow.material.opacity = k;
      l.bulb.color.setRGB(8 * k, 4.4 * k, 1.6 * k);
      (this.lampCones[i]!.material as THREE.ShaderMaterial).uniforms.uStrength!.value = 0.16 * k;
      (this.lampCones[i]!.material as THREE.ShaderMaterial).uniforms.uTime!.value = t;
    });
    this.lampLights.update(this.viewFootprint(), this.lampK, this.movers(), dt);
    for (const m of this.beamMats) m.uniforms.uTime!.value = t;
    procUniforms.uTime.value = t;
    this.mist.update(t);
    this.decals.syncTracks(cur);
    this.sparks.update(dt);
    this.smoke.update(cur, dt, this.camera);
    this.rain.update(dt, this.camTarget.x, this.camTarget.z);
    this.flashes.update(dt);
    this.blasts.update(dt, { x: this.camTarget.x, z: this.camTarget.z });
    this.animateWrecks(dt);
    this.arcs.update(dt, selfPos);
    this.renderReticle(cur, selfPos);
    (this.grade.uniforms.uTime as { value: number }).value = t;
    (this.grade.uniforms.uHurt as { value: number }).value = this.hurt;
    const tRender = performance.now();
    this.telemetry.gpuBegin();
    this.composer.render();
    this.telemetry.gpuEnd();
    const tHud = performance.now();

    const me = cur.tanks.find((x) => x.id === s.playerId);
    this.d.audio.setEngine(me ? Math.hypot(me.vx, me.vy) : 0, !!me?.alive && !s.paused, !!me?.quiet);
    this.d.audio.setChargeHum(me && me.phase === 'charging' && !s.paused ? me.charge : 0);
    const full = !!me && me.phase === 'charging' && me.hold !== null;
    if (full && !this.wasFull) this.d.audio.chargeFull();
    this.wasFull = full;
    this.hud.update(cur, me, this.mousePx, this.aim, (x, y, h) => this.project(x, y, h), dt);
    this.comms.update(dt, s.paused);
    this.directAudio(now);
    this.renderMinimap(cur, selfPos);
    const tEnd = performance.now();
    this.telemetry.frameEnd(tEnd, { ticks, simMs, renderMs: tHud - tRender, hudMs: tEnd - tHud, cpuMs: tEnd - t0 });
    if (!s.paused) {
      const buf = this.renderer.getDrawingBufferSize(this.bufSize);
      const ri = this.renderer.info.render;
      this.perfLog.frame({
        frameMs,
        cpuMs: tEnd - t0,
        draws: ri.calls,
        tris: ri.triangles,
        bufW: buf.x,
        bufH: buf.y,
        dyn: this.dynRes.scale,
        combat: now - this.lastCombat < 8000,
        foes: cur.tanks.filter((x) => x.alive && x.team !== me?.team).length,
      });
    }
    this.telemetry.recording = this.perfLog.recording;

    if (s.outcome && !this.ended) {
      this.ended = true;
      void this.perfLog.flush();
      setTimeout(() => !this.disposed && this.d.onEnd(s), 2600);
    }
  }

  // ------------------------------------------------------------------ audio direction
  /** The score, stingers, radio and UI sounds follow the mission state. */
  private directAudio(now: number): void {
    const s = this.session;
    const a = this.d.audio;
    if (s.paused) return;
    // radio: every new line goes to the comms panel, which voices it when its turn comes
    for (const r of s.radio) {
      const key = `${r.tick}|${r.from}|${r.text}`;
      if (this.heardRadio.has(key)) continue;
      this.heardRadio.add(key);
      const enemy = r.from.endsWith('(enemy)');
      this.comms.push({ from: enemy ? r.from.replace(/\s*\(enemy\)$/, '') : r.from, text: r.text, enemy });
    }
    // other units on the net, faint, between our own lines
    if (!s.outcome && this.comms.idle && now > this.nextNet) {
      const d = a.netChatter();
      if (d > 0) this.comms.netTraffic(d);
      this.nextNet = now + 14000 + Math.random() * 26000;
    }
    // barks: heard only from enemies you can see (the same rule as their callouts)
    const obs = s.obs;
    const barkKeys = new Set<string>();
    for (const b of s.barks) {
      const key = `${b.unit}|${b.tick}|${b.text}`;
      barkKeys.add(key);
      if (this.heardBarks.has(key) || obs.tick - b.tick > 15) continue;
      const t = obs.tanks.find((v) => v.id === b.unit && v.alive && v.team !== obs.team);
      if (t) a.bark(b.from, b.text, b.kind, this.pan(t.x), Math.max(0.25, this.vol(t.x, t.y, 1100)));
    }
    this.heardBarks = barkKeys;
    // notices: checkpoint and objective stingers
    while (this.noticeCount < s.notices.length) {
      const n = s.notices[this.noticeCount++]!.text;
      if (n === 'Checkpoint') a.stinger('checkpoint');
      else if (/^(New objective|Objective complete)/.test(n)) a.stinger('objective');
    }
    if (s.notices.length < this.noticeCount) this.noticeCount = s.notices.length;
    // decisions
    if (!!s.choice !== this.hadChoice) {
      if (s.choice) a.choiceOpen();
      else a.choiceSelect();
      this.hadChoice = !!s.choice;
    }
    // outcome
    if (s.outcome) {
      if (!this.outcomeSounded) {
        this.outcomeSounded = true;
        a.stinger(s.outcome.result === 'success' ? 'success' : 'failure');
        a.setMood('silent');
      }
      return;
    }
    // detection -> mood
    const det = s.detection();
    if (det >= 1) {
      if (now - this.lastCombat > 10000 && this.lastDet < 1) a.stinger('spotted');
      this.lastCombat = now;
    } else if (det > 0.25 && this.lastDet <= 0.25) a.suspicion(det);
    this.lastDet = det;
    const mood = now - this.lastCombat < 8000 ? 'combat' : det > 0.05 || s.simple.alarmRaised ? 'tension' : 'calm';
    const tension = mood === 'tension' ? Math.max(det, s.simple.alarmRaised ? 0.5 : 0) : det;
    if (mood !== this.moodSent || Math.abs(tension - this.tensionSent) > 0.08) {
      this.moodSent = mood;
      this.tensionSent = tension;
      a.setMood(mood, tension);
    }
  }

  // ------------------------------------------------------------------ tanks & shells
  private tankVis(t: TankView): TankVis {
    let v = this.tanks.get(t.id);
    if (!v) {
      const beam = coneMaterial(0xfff0cf, 0.06);
      this.beamMats.push(beam);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      glow.visible = false;
      this.scene.add(glow);
      const ring = new THREE.Mesh(this.chargeRingGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.1, 0.35), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      ring.visible = false;
      this.scene.add(ring);
      v = { model: buildTank(this.scene, t.team, beam), team: t.team, recoil: 0, wheel: 0, last: null, dead: false, flash: 0, deadT: -1, toss: null, glow, ring };
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
      this.headlights.request({ x, z: y, y: m.root.position.y, hull, intensity: t.quiet ? 60000 : 220000 });
      // Hit glow: the armour flares orange-white for a moment.
      if (v.flash > 0.002) {
        v.flash *= Math.exp(-dt * 9);
        for (const mat of m.materials) mat.emissive.setRGB(2.4 * v.flash, 1.1 * v.flash, 0.35 * v.flash);
      }
      // Damaged tanks trail smoke, and burn when nearly dead.
      const health = t.hp / t.maxHp;
      if (health < 0.7) this.blasts.smolder(x, y, hull, Math.min(1, (0.7 - health) / 0.55), dt);
      this.renderCharge(t, v, x, y, tur, dt);
      m.beam.visible = !t.quiet;
      if (t.id === this.session.playerId) self = { x, y };
    }
    for (const [id, v] of this.tanks)
      if (!seen.has(id) && !v.dead) {
        v.model.root.visible = false;
        v.glow.visible = v.ring.visible = false;
      }
    return self;
  }

  /**
   * A charging cannon you can see: motes pulled into a glowing muzzle, a ring on the ground, a
   * shuddering barrel once fully charged, and (for the player) a light on the hull. Enemies show it
   * too, which is a warning: that tank is about to hit hard.
   */
  private renderCharge(t: TankView, v: TankVis, x: number, y: number, tur: number, dt: number): void {
    const c = t.phase === 'charging' ? t.charge : 0;
    const mine = t.id === this.session.playerId;
    const full = t.hold !== null || c >= 1;
    v.glow.visible = v.ring.visible = c > 0.02;
    v.model.barrel.position.z = 0;
    if (mine) this.chargeLight.intensity = 0;
    if (c <= 0.02) return;
    const now = performance.now() / 1000;
    const pulse = full ? 0.75 + 0.25 * Math.sin(now * 18) : 1;
    const mx = x + Math.cos(tur) * 34, mz = y + Math.sin(tur) * 34;
    v.glow.position.set(mx, 21, mz);
    v.glow.scale.setScalar((10 + 46 * c * c) * pulse);
    v.glow.material.color.setRGB(1.2 + 3.2 * c, 0.5 + 1.8 * c * c, 0.15 + 1.4 * c * c * c);
    v.glow.material.opacity = 0.35 + 0.65 * c;
    v.ring.position.set(x, 1.2, y);
    v.ring.scale.setScalar(30 + 22 * c + (full ? 6 * Math.sin(now * 9) : 0));
    (v.ring.material as THREE.MeshBasicMaterial).opacity = (0.15 + 0.5 * c) * pulse;
    if (full) v.model.barrel.position.z = (Math.random() - 0.5) * 0.9;
    this.blasts.chargeMotes(mx, 21, mz, c, dt);
    if (mine) {
      // held above the barrel so it washes the hull, not a wall the tank is parked against
      this.chargeLight.position.set(x + Math.cos(tur) * 20, 46, y + Math.sin(tur) * 20);
      this.chargeLight.intensity = 30000 * c * c * pulse;
    }
  }

  private wreck(id: number, x: number, y: number): void {
    const vv = this.tanks.get(id);
    if (vv) vv.glow.visible = vv.ring.visible = false;
    const v = this.tanks.get(id);
    if (!v) return;
    v.dead = true;
    v.deadT = 0;
    v.model.root.visible = true;
    v.model.root.position.set(x, 0, y);
    v.model.beam.visible = false;
    for (const mat of v.model.materials) {
      mat.color.multiplyScalar(0.22);
      mat.roughness = 1;
      mat.metalness = 0.1;
    }
    // The turret is blown off: detach it into the world and throw it.
    const tur = v.model.turret;
    this.scene.attach(tur);
    const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 70;
    v.toss = { vx: Math.cos(a) * sp, vy: 260 + Math.random() * 90, vz: Math.sin(a) * sp, sx: (Math.random() - 0.5) * 9, sz: (Math.random() - 0.5) * 9, landed: false };
    this.blasts.destroy(x, y);
    this.smoke.wreck(x, y);
  }

  /** Wreck animation: hull jolts up and settles at a tilt, metal cools, the turret lands. */
  private animateWrecks(dt: number): void {
    for (const v of this.tanks.values()) {
      if (!v.dead || v.deadT < 0 || v.deadT > 40) continue;
      v.deadT += dt;
      const t = v.deadT, m = v.model;
      const hop = t < 0.6 ? Math.sin((t / 0.6) * Math.PI) * 9 * (1 - t / 0.6) : 0;
      m.root.position.y = hop - Math.min(1, t * 3) * 1.5;
      m.root.rotation.z = Math.min(1, t * 4) * 0.06;
      m.root.rotation.x = Math.min(1, t * 4) * -0.04;
      const heat = Math.max(0, 1 - t / 9);
      for (const mat of m.materials) mat.emissive.setRGB(1.4 * heat * heat, 0.32 * heat * heat * heat, 0.04 * heat * heat * heat);
      const k = v.toss;
      if (k && !k.landed) {
        k.vy -= 620 * dt;
        m.turret.position.x += k.vx * dt;
        m.turret.position.y += k.vy * dt;
        m.turret.position.z += k.vz * dt;
        m.turret.rotation.x += k.sx * dt;
        m.turret.rotation.z += k.sz * dt;
        if (m.turret.position.y < 4 && k.vy < 0) {
          m.turret.position.y = 4;
          if (k.vy < -160) {
            k.vy *= -0.25;
            k.vx *= 0.4;
            k.vz *= 0.4;
            k.sx *= 0.3;
            k.sz *= 0.3;
            this.sparks.burst(m.turret.position.x, 4, m.turret.position.z, 0, 0, 25, 150);
            this.d.audio.clank(this.pan(m.turret.position.x), this.vol(m.turret.position.x, m.turret.position.z, 900));
          } else {
            k.landed = true;
            m.turret.rotation.x = Math.round(m.turret.rotation.x / Math.PI) * Math.PI + (Math.random() - 0.5) * 0.3;
            m.turret.rotation.z = (Math.random() - 0.5) * 0.3;
          }
        }
      }
    }
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
      // charged rounds are bigger, hotter and shed embers
      g.scale.set(1 + p.charge * 0.8, 1 + p.charge * 1.4, 1 + p.charge * 1.4);
      (g.children[1] as THREE.Sprite).scale.setScalar(26 + 40 * p.charge);
      if (p.charge > 0.3) this.blasts.trail(x, 20, y, p.charge, this.frameDt);
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
        if (v) v.recoil = 1 + e.charge;
        this.flashes.add(e.x, e.y, 'muzzle', 1 + 1.6 * e.charge);
        if (e.charge > 0.45) {
          const from = this.session.obs.tanks.find((t) => t.id === e.tank);
          this.blasts.muzzleBlast(from ? from.x : e.x, from ? from.y : e.y, e.angle, e.charge);
        }
        this.sparks.burst(e.x, 22, e.y, -Math.cos(e.angle), -Math.sin(e.angle), 10, 160);
        if (e.tank === pid && !reduced) this.shake = Math.max(this.shake, 4 + e.charge * 8);
        this.d.audio.shot(e.charge, this.pan(e.x), e.tank === pid ? 0.9 : 0.75 * this.vol(e.x, e.y, 1100));
        break;
      }
      case 'impact':
        if (e.kind === 'tank') this.blasts.hit(e.x, e.y, e.angle, e.charge);
        // A charged round bursts: a blast sized to its splash, with its own boom.
        if (e.charge >= TUNING.cannon.splashFrom && e.kind !== 'expire') {
          const k = (e.charge - TUNING.cannon.splashFrom) / (1 - TUNING.cannon.splashFrom);
          this.blasts.explode(e.x, e.y, 0.35 + 0.7 * k);
          this.decals.addScorch(e.x, e.y, 0.9 + 0.8 * k);
        }
        this.flashes.add(e.x, e.y, 'impact');
        this.sparks.burst(e.x, 10, e.y, Math.cos(e.angle), Math.sin(e.angle), 30 + Math.round(e.charge * 30), 260);
        if (e.kind !== 'tank') this.decals.addScorch(e.x, e.y, 0.5 + e.charge * 0.5);
        this.d.audio.impact(e.kind, e.charge, this.pan(e.x), this.vol(e.x, e.y));
        break;
      case 'damage': {
        const v = this.tanks.get(e.target);
        if (v) v.flash = 1;
        const t = this.session.obs.tanks.find((x) => x.id === e.target);
        if (e.target === pid) {
          this.hurt = Math.min(1, this.hurt + 0.6 + e.charge * 0.4);
          if (!reduced) this.shake = Math.max(this.shake, 6 + e.charge * 10);
          this.d.audio.armorHit(e.charge, 0, 0.9, true);
        } else {
          if (t) this.d.audio.armorHit(e.charge, this.pan(t.x), Math.max(0.3, this.vol(t.x, t.y, 1100)), false);
          if (e.byUs) {
            this.d.audio.hitConfirm();
            this.hud.hitMark(false);
            if (!reduced) this.shake = Math.max(this.shake, 2 + e.charge * 3);
          }
          this.hud.noteHit(e.target);
        }
        break;
      }
      case 'kill':
        if (e.byUs) this.hud.hitMark(true);
        break;
      case 'death':
        this.decals.addScorch(e.x, e.y, 2.2);
        this.wreck(e.tank, e.x, e.y);
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
    const win = this.miniWindow(selfPos);
    const sx = W / win.w, sy = H / win.h;
    const k = 4 / this.session.map.tile; // miniBase pixels per world px
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = 0.9;
    ctx.drawImage(this.miniBase, win.x0 * k, win.y0 * k, win.w * k, win.h * k, 0, 0, W, H);
    ctx.globalAlpha = 1;
    ctx.translate(-win.x0 * sx, -win.y0 * sy);
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
