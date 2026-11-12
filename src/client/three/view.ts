// The 3D mission view: renders a MissionSession with the Render Lab look (isometric Three.js).
//
// Like the 2D client, it only ever reads the player team's Observation, so hidden enemies are
// simply never drawn. The simulation runs at a fixed 30 Hz; this view interpolates between the
// last two ticks every frame.
import * as THREE from 'three';
import type { MissionSession } from '../../game/mission/session';
import type { Observation, ObsEvent, TankView } from '../../sim/observation';
import type { Vec } from '../../sim/math';
import { angleDiff } from '../../sim/math';
import { TUNING } from '../../sim/tuning';
import type { InputManager } from '../input';
import type { AudioEngine } from '../audio';
import type { Settings } from '../settings';
import { buildEnvironment, procUniforms } from './materials';
import { buildTank, radialTexture, SHADOW_DYNAMIC_LAYER, SHADOW_LAYER, type TankModel } from './models';
import { buildWorld, type BuiltWorld } from './world';
import { CueArcs, Decals, Flashes, GlowLights, Headlights, Mist, Rain, SmokeFx, Sparks, coneMaterial } from './fx';
import { Blasts } from './blast';
import { Comms } from './comms';
import { Hud3D } from './hud';
import { Telemetry } from './telemetry';
import { LampLights } from './lamps';
import { DynamicResolution } from './dynres';
import { PerfLog } from './perflog';
import { PostChain } from './post';
import { MoonShadow } from './moonshadow';
import { codeLabel } from '../settings';

export interface MissionViewDeps {
  session: MissionSession;
  input: InputManager;
  audio: AudioEngine;
  settings: Settings;
  /** Called a moment after the mission ends. */
  onEnd: (s: MissionSession) => void;
}

/** Intensity of the red lamp a silent tank runs on (the headlight is 220000). */
const SILENT_LAMP = 26000;

interface TankVis {
  model: TankModel;
  team: 0 | 1;
  recoil: number;
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
  /** Pose and visibility its shadow was last drawn with (see `trackCasters`). */
  shadowKey: number[];
  shadowSeen: boolean;
  /** 0..1, eased: how far the lights have gone over to silent running (headlights out, red lamp). */
  silent: number;
}

export class MissionView3D {
  readonly session: MissionSession;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 8000);
  private post: PostChain;
  private world: BuiltWorld;
  private moon: THREE.DirectionalLight;
  private moonShadow: MoonShadow;
  private lampCones: THREE.Mesh[] = [];
  private beamMats: THREE.ShaderMaterial[] = [];
  private tanks = new Map<number, TankVis>();
  private shellPool: THREE.Group[] = [];
  private chargeRingGeo = new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2);
  /** Lights the player's hull while the cannon charges. Always present, so the light count never changes. */
  private glow: GlowLights;
  /** Shadow casters whose pose changed this frame (tanks, settling wrecks); refilled every frame. */
  private moved: { x: number; z: number }[] = [];
  /** Where every visible moving shadow caster is this frame: tanks, and turrets blown off wrecks. */
  private casters: THREE.Vector3[] = [];
  private lampLights!: LampLights;
  private lampK: number[] = [];
  private dynRes = new DynamicResolution();
  private perfLog: PerfLog;
  private bufSize = new THREE.Vector2();
  private wasFull = false;
  private frameDt = 0;
  private ghosts: THREE.Mesh[] = [];
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
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  /** The view's size in CSS pixels, read in `resize` only: asking the DOM every frame forces a layout. */
  private viewW = 1;
  private viewH = 1;
  // scratch objects for the per-frame maths
  private v2 = new THREE.Vector2();
  private v3 = new THREE.Vector3();
  private listeners: (() => void)[] = [];
  // audio direction state
  private heardRadio = new Set<string>();
  private heardBarks = new Set<string>();
  private heardCrew = new Set<string>();
  /** Where each tank was drawn this frame (interpolated). HUD marks follow these, not the 30 Hz
   *  simulation positions, or they shake against the tank they belong to. */
  private drawn = new Map<number, Vec>();
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
    this.moon.castShadow = true;
    this.moon.shadow.autoUpdate = false; // drawn by MoonShadow
    const low = d.settings.lowEffects;
    this.moon.shadow.mapSize.setScalar(low ? 1024 : 2048);
    this.moon.shadow.bias = -0.0003;
    this.moon.shadow.normalBias = 1.2;
    this.moon.shadow.radius = 3;
    Object.assign(this.moon.shadow.camera, { near: 100, far: 3000 });
    this.moon.shadow.camera.layers.enable(SHADOW_LAYER);
    this.moon.shadow.camera.layers.enable(SHADOW_DYNAMIC_LAYER);
    scene.add(this.moon, this.moon.target);
    this.moonShadow = new MoonShadow(this.renderer, scene, this.moon, new THREE.Vector3(-520, 950, -650));

    this.world = buildWorld(scene, this.session.level);
    for (const l of this.world.lamps) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(5, 120, 112, 32, 1, true), coneMaterial(0xffa04a, 0.16));
      c.position.set(l.x, 58, l.z);
      scene.add(c);
      this.lampCones.push(c);
    }
    this.lampLights = new LampLights(scene, this.world.lamps, low);
    procUniforms.uProcOn.value = low ? 0 : 1;
    new Mist(scene, this.world.lamps.map((l) => ({ x: l.x, y: l.z })), this.world.width, this.world.height);
    this.rain = new Rain(scene);
    this.decals = new Decals(scene);
    this.sparks = new Sparks(scene);
    this.smoke = new SmokeFx(scene);
    this.glow = new GlowLights(scene);
    this.flashes = new Flashes(scene, this.glow);
    this.blasts = new Blasts(scene, {
      flash: (x, z, scale) => this.flashes.add(x, z, 'explosion', scale),
      sparks: (x, y, z, n, speed) => this.sparks.burst(x, y, z, 0, 0, n, speed),
      glow: (r) => this.glow.request(r),
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

    // ---- DOM: vehicle panel, radio, enemy alert markers
    this.hud = new Hud3D(container, this.session);
    this.comms = new Comms(this.hud.root, (l, u, v) => this.d.audio.transmit(u, v, l.enemy));
    this.comms.setVisible(d.settings.showRadio);
    this.telemetry = new Telemetry(this.hud.root, this.renderer);
    this.perfLog = new PerfLog({ mission: this.session.def.id, low: this.d.settings.lowEffects }, this.renderer.getContext() as WebGL2RenderingContext);
    this.telemetry.setKeyLabel(codeLabel(d.settings.bindings.telemetry[0] ?? 'KeyV'));

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

    this.post = new PostChain(this.renderer, this.scene, this.camera, low);
    this.resize();
    d.audio.setScene('mission');
    d.audio.setMood('calm');
    // lines already on the radio at construction (e.g. after a checkpoint) are not replayed
    for (const r of this.session.radio) this.heardRadio.add(`${r.tick}|${r.from}|${r.text}`);
    for (const b of this.session.crewBarks) this.heardCrew.add(`${b.tick}|${b.from}|${b.text}`);
    this.hud.onCrewBark = (from, text) => this.d.audio.crewBark(from, text);
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
    this.renderer.setRenderTarget(this.post.sceneTarget);
    this.renderer.compile(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    // Compiling isn't everything: on a Mac the browser runs WebGL on Metal, which builds a pipeline
    // the first time each material *draws* into each kind of target (scene, shadow maps, AO normals),
    // and textures upload on first draw. Both stalled the first fight for ~120 ms. So draw one real
    // frame through the whole post chain with every pooled effect shown and nothing culled; it is
    // overwritten by the first real frame before the browser ever shows it.
    const culled: THREE.Object3D[] = [];
    const empty: THREE.InstancedMesh[] = [];
    this.scene.traverse((o) => {
      if (o.frustumCulled) {
        culled.push(o);
        o.frustumCulled = false;
      }
      const im = o as THREE.InstancedMesh;
      if (im.isInstancedMesh && im.count === 0) {
        empty.push(im);
        im.count = 1;
      }
    });
    this.placeCamera();
    this.placeMoon();
    this.moonShadow.update(true, [], true); // no map yet: three.js draws it whole in the frame below
    this.post.render(0, 0);
    this.moonShadow.update(true, [], true); // and now the two-layer path, so its shaders are warm too
    for (const o of culled) o.frustumCulled = true;
    for (const im of empty) im.count = 0;
    for (const o of hidden) o.visible = false;
  }

  private resize(): void {
    const w = (this.viewW = this.container.clientWidth || innerWidth), h = (this.viewH = this.container.clientHeight || innerHeight);
    // Retina screens report 2: at full DPR every effect pass runs on 4x the pixels for a sharpness
    // that the film grain and bloom mostly hide. High stops at 1.5, Low renders at CSS pixels.
    // Dynamic resolution scales that down when frames run long (never below 0.75 of a CSS pixel).
    const base = Math.min(devicePixelRatio, this.d.settings.lowEffects ? 1 : 1.5);
    const dpr = Math.max(Math.min(base, 0.75), base * this.dynRes.scale);
    this.post.setSize(w, h, dpr);
  }

  // ------------------------------------------------------------------ camera
  private placeCamera(): void {
    const w = this.viewW, h = this.viewH;
    const halfH = 360 / this.zoom;
    const cam = this.camera;
    cam.left = (-halfH * w) / h;
    cam.right = (halfH * w) / h;
    cam.top = halfH;
    cam.bottom = -halfH;
    cam.updateProjectionMatrix();
    const yaw = Math.PI / 4, pitch = Math.atan(1 / Math.SQRT2), dist = 2400;
    const t = this.v3.copy(this.camTarget);
    t.x += (Math.random() - 0.5) * this.shake;
    t.z += (Math.random() - 0.5) * this.shake;
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

  /**
   * Which shadow casters changed since their shadows were last drawn: a tank that drove, turned its
   * turret, recoiled, appeared or vanished, or a wreck still settling. A tank parked under a lamp
   * (a guard at its post, the player waiting in cover) is not one, so its lamp's shadow map and the
   * moon's stay cached.
   */
  private trackCasters(): void {
    this.moved.length = 0;
    this.casters.length = 0;
    for (const v of this.tanks.values()) {
      const m = v.model, r = m.root, k = v.shadowKey;
      let moved = r.visible !== v.shadowSeen;
      v.shadowSeen = r.visible;
      if (r.visible) {
        this.casters.push(r.position);
        if (v.toss) this.casters.push(m.turret.position); // detached into the scene: a world position
        if (v.dead && v.deadT < 8) moved = true; // wreck settling, turret in the air
        const p = r.position, b = m.barrel.position;
        if (Math.abs(p.x - k[0]!) > 0.02 || Math.abs(p.y - k[1]!) > 0.02 || Math.abs(p.z - k[2]!) > 0.02) moved = true;
        if (Math.abs(r.rotation.y - k[3]!) > 0.002 || Math.abs(m.turret.rotation.y - k[4]!) > 0.002) moved = true;
        if (Math.abs(b.x - k[5]!) > 0.05 || Math.abs(b.z - k[6]!) > 0.05) moved = true;
        if (moved) {
          k[0] = p.x; k[1] = p.y; k[2] = p.z;
          k[3] = r.rotation.y; k[4] = m.turret.rotation.y;
          k[5] = b.x; k[6] = b.z;
        }
      }
      if (moved) this.moved.push({ x: r.position.x, z: r.position.z });
    }
  }

  /** Fit the moon's shadow frustum around the view (padded for shadows cast in from outside it). */
  private placeMoon(): void {
    this.moonShadow.place(this.camTarget, Math.max(this.camera.right - this.camera.left, (this.camera.top - this.camera.bottom) * 1.8) * 0.5 + 160);
  }

  /** Screen-relative WASD: W moves up the screen whatever the camera angle. */
  private screenRelative(mx: number, my: number): Vec {
    const f = this.v3;
    this.camera.getWorldDirection(f);
    f.y = 0;
    f.normalize();
    const rx = -f.z, ry = f.x;
    return { x: rx * mx - f.x * my, y: ry * mx - f.z * my };
  }

  private project(x: number, y: number, h = 0): { x: number; y: number; on: boolean } {
    const v = this.v3.set(x, h, y).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.viewW, y: (-v.y * 0.5 + 0.5) * this.viewH, on: Math.abs(v.x) <= 1.05 && Math.abs(v.y) <= 1.05 };
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
    this.post.setLow(low);
    this.perfLog.setLow(low);
    procUniforms.uProcOn.value = low ? 0 : 1;
    this.lampLights.setLow(low);
    const moonSize = low ? 1024 : 2048;
    if (this.moon.shadow.mapSize.x !== moonSize) {
      this.moon.shadow.mapSize.setScalar(moonSize);
      this.moon.shadow.map?.dispose();
      this.moon.shadow.map = null;
      this.moon.shadow.needsUpdate = true;
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
    this.post.dispose();
    this.moonShadow.dispose();
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
    this.ray.setFromCamera(this.v2.set(this.mouse.x, this.mouse.y), this.camera);
    const hit = this.v3;
    if (this.ray.ray.intersectPlane(this.plane, hit)) {
      this.aim.x = hit.x;
      this.aim.y = hit.z;
    }
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
    this.glow.begin();
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
    this.trackCasters();
    this.lampLights.update(this.viewFootprint(), this.lampK, this.moved, dt);
    for (const m of this.beamMats) m.uniforms.uTime!.value = t;
    procUniforms.uTime.value = t;
    this.decals.syncTracks(cur);
    this.sparks.update(dt);
    this.smoke.update(cur, dt, this.camera);
    this.rain.update(dt, this.camTarget.x, this.camTarget.z);
    this.flashes.update(dt);
    this.blasts.update(dt);
    this.animateWrecks(dt);
    this.arcs.update(dt, selfPos);
    this.renderReticle(cur, selfPos);
    this.glow.end({ x: this.camTarget.x, z: this.camTarget.z });
    const tRender = performance.now();
    this.telemetry.gpuBegin();
    this.moonShadow.update(this.moved.length > 0, this.casters, this.blasts.debrisInFlight);
    this.post.render(t, this.hurt);
    this.telemetry.gpuEnd();
    const tHud = performance.now();

    const me = cur.tanks.find((x) => x.id === s.playerId);
    this.d.audio.setEngine(me ? Math.hypot(me.vx, me.vy) : 0, !!me?.alive && !s.paused, !!me?.quiet);
    this.d.audio.setChargeHum(me && me.phase === 'charging' && !s.paused ? me.charge : 0);
    const full = !!me && me.phase === 'charging' && me.hold !== null;
    if (full && !this.wasFull) this.d.audio.chargeFull();
    this.wasFull = full;
    this.hud.update(cur, me, this.mousePx, this.aim, (x, y, h) => this.project(x, y, h), dt, this.drawn);
    this.comms.update(dt, s.paused);
    this.directAudio(now);
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
    // crew barks: the HUD shows them one at a time over our tank and says when each one starts
    for (const b of s.crewBarks) {
      const key = `${b.tick}|${b.from}|${b.text}`;
      if (this.heardCrew.has(key)) continue;
      this.heardCrew.add(key);
      this.hud.crewSay(b.from, b.text);
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
      v = { model: buildTank(this.scene, t.team, beam), team: t.team, recoil: 0, dead: false, flash: 0, deadT: -1, toss: null, glow, ring, shadowKey: [NaN, NaN, NaN, NaN, NaN, NaN, NaN], shadowSeen: false, silent: 0 };
      this.tanks.set(t.id, v);
    }
    return v;
  }

  private renderTanks(prev: Observation, cur: Observation, a: number, dt: number): Vec | null {
    const prevMap = new Map(prev.tanks.map((t) => [t.id, t]));
    const seen = new Set<number>();
    let self: Vec | null = null;
    this.drawn.clear();
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
      // In brush, a tank is drawn sunk a little and its lights dimmed (it is hidden from the enemy).
      m.root.position.y = t.inBrush ? -3 : 0;
      // Silent running: the headlights go out and a very faint red lamp takes over, like the night
      // lighting in a patrol car. Eased so it does not pop when the tank coasts in and out of `quiet`.
      v.silent += ((t.quiet ? 1 : 0) - v.silent) * Math.min(1, dt * 6);
      this.headlights.request({ x, z: y, y: m.root.position.y, hull, intensity: 220000 + (SILENT_LAMP - 220000) * v.silent, red: v.silent });
      // Hit glow: the armour flares orange-white for a moment.
      if (v.flash > 0.002) {
        v.flash *= Math.exp(-dt * 9);
        for (const mat of m.materials) mat.emissive.setRGB(2.4 * v.flash, 1.1 * v.flash, 0.35 * v.flash);
      }
      // Damaged tanks trail smoke, and burn when nearly dead.
      const health = t.hp / t.maxHp;
      if (health < 0.7) this.blasts.smolder(x, y, hull, Math.min(1, (0.7 - health) / 0.55), dt);
      this.renderCharge(t, v, x, y, tur, dt);
      m.beam.visible = v.silent < 0.5;
      this.drawn.set(t.id, { x, y });
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
      this.glow.request({ x: x + Math.cos(tur) * 20, y: 46, z: y + Math.sin(tur) * 20, intensity: 30000 * c * c * pulse, distance: 180, color: 0xffb060 });
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
}
