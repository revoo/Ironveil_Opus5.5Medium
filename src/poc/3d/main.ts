// 3D rendering proof of concept, "AAA pass": Three.js with an isometric camera.
//
// Frame structure:
//   shadow maps (moon + 6 lamps) -> main PBR render with procedural materials + image-based lighting
//   -> GTAO ambient occlusion -> bloom -> tone map (ACES) -> SMAA anti-aliasing -> grade (CA, vignette, grain)
//
// See materials.ts (procedural surfaces), props.ts (modelling), fx.ts (atmosphere and particles).
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { CONTROLS_HINT, HUD_CSS, Hud, Input, Sandbox, YARD, gpuName, type MoveBasis, type Tank } from '../shared';
import { Surface, buildEnvironment, proc, procUniforms } from './materials';
import { buildBuildings, buildDressing, buildLamps, buildTank, buildWalls, mergeStatic, rand, type TankView } from './props';
import { Decals, Flashes, Mist, Rain, SmokeFx, Sparks, coneMaterial } from './fx';
import { DebugViews, VIEWS } from './debug';

const style = document.createElement('style');
style.textContent = HUD_CSS;
document.head.appendChild(style);

// ---------- renderer & scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.info.autoReset = false; // the composer renders several passes per frame
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05080a);
const fog = new THREE.FogExp2(0x0a1012, 0.00045);
scene.fog = fog;
const envMap = buildEnvironment(renderer);
scene.environment = envMap;
scene.environmentIntensity = 0.55;

// ---------- ground: cobbles (albedo + height-derived normal map + roughness) ----------
function normalFromHeight(src: HTMLCanvasElement, strength: number): HTMLCanvasElement {
  const w = src.width, h = src.height;
  const s = src.getContext('2d')!.getImageData(0, 0, w, h).data;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d')!;
  const img = octx.createImageData(w, h);
  const H = (x: number, y: number) => s[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
      img.data[i] = (-dx / l) * 127 + 128;
      img.data[i + 1] = (dy / l) * 127 + 128;
      img.data[i + 2] = (1 / l) * 127 + 128;
      img.data[i + 3] = 255;
    }
  octx.putImageData(img, 0, 0);
  return out;
}
function makeCanvas(n: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  return [c, c.getContext('2d')!];
}
const COB = 512;
const [cobH, hc] = makeCanvas(COB), [cobA, ac] = makeCanvas(COB), [cobR, rc] = makeCanvas(COB);
{
  const r = rand(7);
  hc.fillStyle = '#000';
  hc.fillRect(0, 0, COB, COB);
  ac.fillStyle = '#2a3329';
  ac.fillRect(0, 0, COB, COB);
  rc.fillStyle = '#f0f0f0';
  rc.fillRect(0, 0, COB, COB);
  const cw = 32, ch = 24;
  for (let row = 0; row < COB / ch; row++)
    for (let col = -1; col < COB / cw + 1; col++) {
      const x = col * cw + (row % 2) * cw * 0.5 + (r() - 0.5) * 2, y = row * ch + (r() - 0.5) * 2;
      const v = r();
      for (let k = 7; k >= 0; k--) {
        const g = Math.round(255 * (0.45 + v * 0.55) * (1 - k / 8));
        hc.fillStyle = `rgb(${g},${g},${g})`;
        hc.beginPath();
        hc.roundRect(x + 3 + k * 0.7, y + 3 + k * 0.7, cw - 6 - k * 1.4, ch - 6 - k * 1.4, 7);
        hc.fill();
      }
      const t = 92 + v * 50;
      ac.fillStyle = `rgb(${t},${Math.round(t * 0.95)},${Math.round(t * 0.86)})`;
      ac.beginPath();
      ac.roundRect(x + 3, y + 3, cw - 6, ch - 6, 7);
      ac.fill();
      const rg = Math.round(150 + v * 70);
      rc.fillStyle = `rgb(${rg},${rg},${rg})`;
      rc.beginPath();
      rc.roundRect(x + 3, y + 3, cw - 6, ch - 6, 7);
      rc.fill();
    }
}
const groundMat = proc(
  new THREE.MeshStandardMaterial({
    map: new THREE.CanvasTexture(cobA),
    normalMap: new THREE.CanvasTexture(normalFromHeight(cobH, 5)),
    roughnessMap: new THREE.CanvasTexture(cobR),
  }),
  Surface.Ground,
  { scale: 0.05, bump: 0.25, wear: 0 },
);
for (const t of [groundMat.map!, groundMat.normalMap!, groundMat.roughnessMap!]) {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set((YARD.w + 1400) / 110, (YARD.h + 1400) / 110);
  t.anisotropy = 8;
}
groundMat.map!.colorSpace = THREE.SRGBColorSpace;
const ground = new THREE.Mesh(new THREE.PlaneGeometry(YARD.w + 1400, YARD.h + 1400), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.set(YARD.w / 2, 0, YARD.h / 2);
ground.receiveShadow = true;
scene.add(ground);

const staticRoot = new THREE.Group();
buildWalls(staticRoot);
buildBuildings(staticRoot);
buildDressing(staticRoot);
const lamps = buildLamps(staticRoot);
mergeStatic(staticRoot, scene);
const lampCones: THREE.Mesh[] = lamps.map((l) => {
  const c = new THREE.Mesh(new THREE.CylinderGeometry(5, 120, 112, 32, 1, true), coneMaterial(0xffa04a, 0.16));
  c.position.set(l.x, 58, l.z);
  scene.add(c);
  return c;
});

// ---------- lights ----------
const hemi = new THREE.HemisphereLight(0x6c8088, 0x1a201c, 0.35);
scene.add(hemi);
const moon = new THREE.DirectionalLight(0xa9c0d4, 1.25);
moon.position.set(YARD.w / 2 - 520, 950, YARD.h / 2 - 650);
moon.target.position.set(YARD.w / 2, 0, YARD.h / 2);
moon.castShadow = true;
moon.shadow.mapSize.set(4096, 4096);
Object.assign(moon.shadow.camera, { left: -1300, right: 1300, top: 1000, bottom: -1000, near: 100, far: 2800 });
moon.shadow.bias = -0.0003;
moon.shadow.normalBias = 1.2;
moon.shadow.radius = 3;
scene.add(moon, moon.target);

// ---------- tanks & dynamic fx ----------
const sb = new Sandbox();
const beamMats = sb.tanks.map(() => coneMaterial(0xfff0cf, 0.06));
const tankViews = sb.tanks.map((t, i) => buildTank(scene, t.team, beamMats[i]));
const wheelSpin = sb.tanks.map(() => 0);
const prevPos = sb.tanks.map((t) => ({ x: t.x, y: t.y }));

function syncTank(t: Tank, v: TankView, i: number): void {
  v.root.position.set(t.x, 0, t.y);
  v.root.rotation.y = -t.hull;
  v.turret.rotation.y = -(t.turret - t.hull);
  v.barrel.position.x = 14 - t.recoil * 5;
  const moved = Math.hypot(t.x - prevPos[i].x, t.y - prevPos[i].y);
  const fwd = (t.x - prevPos[i].x) * Math.cos(t.hull) + (t.y - prevPos[i].y) * Math.sin(t.hull);
  wheelSpin[i] -= (Math.sign(fwd) * moved) / 4.2;
  v.wheels.forEach((w) => (w.rotation.y = wheelSpin[i]));
  prevPos[i] = { x: t.x, y: t.y };
}

const flashLights: THREE.PointLight[] = [];
for (let i = 0; i < 3; i++) {
  const p = new THREE.PointLight(0xffa04a, 0, 360, 2);
  scene.add(p);
  flashLights.push(p);
}
const shellMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 4, 1.4) });
const shellPool: THREE.Group[] = [];
for (let i = 0; i < 8; i++) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(1.2, 22, 2, 6), shellMat);
  m.rotation.z = Math.PI / 2;
  g.add(m);
  g.visible = false;
  scene.add(g);
  shellPool.push(g);
}
const mist = new Mist(scene);
const decals = new Decals(scene);
const sparks = new Sparks(scene);
const smoke = new SmokeFx(scene);
const rain = new Rain(scene);
const flashes = new Flashes(scene);

// ---------- cameras: isometric (default), tilted perspective, straight top-down ----------
// 'chase' is deliberately unpolished: everything else was built for a camera far above, and this exposes it.
const CAMS = ['isometric', 'tilted perspective', 'top-down', 'chase (third person)'] as const;
let chaseYaw = 0;
let camMode = 0;
let zoom = 1;
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 6000);
const persp = new THREE.PerspectiveCamera(32, 1, 10, 6000);
const camTarget = new THREE.Vector3(sb.player.x, 0, sb.player.y);
let shake = 0;
function activeCamera(): THREE.Camera {
  return camMode === 1 || camMode === 3 ? persp : ortho;
}
function placeCamera(): void {
  const aspect = innerWidth / innerHeight;
  const halfH = 380 / zoom;
  Object.assign(ortho, { left: -halfH * aspect, right: halfH * aspect, top: halfH, bottom: -halfH });
  ortho.updateProjectionMatrix();
  persp.aspect = aspect;
  persp.fov = camMode === 3 ? 58 : 32;
  persp.updateProjectionMatrix();
  const sx = (Math.random() - 0.5) * shake, sz = (Math.random() - 0.5) * shake;
  const t = camTarget.clone().add(new THREE.Vector3(sx, 0, sz));
  if (camMode === 0) {
    // classic isometric: 45 degrees around, ~35 degrees down
    const yaw = Math.PI / 4, pitch = Math.atan(1 / Math.SQRT2);
    const d = 2000;
    ortho.up.set(0, 1, 0);
    ortho.position.set(t.x + Math.sin(yaw) * Math.cos(pitch) * d, Math.sin(pitch) * d, t.z + Math.cos(yaw) * Math.cos(pitch) * d);
    ortho.lookAt(t);
  } else if (camMode === 1) {
    persp.position.set(t.x, 1150 / zoom, t.z + 680 / zoom);
    persp.lookAt(t.x, 0, t.z + 30);
  } else if (camMode === 3) {
    // ride behind and above the hull, looking a little ahead of the tank
    const p = sb.player, dx = Math.cos(chaseYaw), dz = Math.sin(chaseYaw);
    const dist = 130 / zoom, height = 46 / zoom;
    persp.position.set(p.x - dx * dist + sx * 0.3, height, p.y - dz * dist + sz * 0.3);
    persp.lookAt(p.x + dx * 90, 14, p.y + dz * 90);
  } else {
    ortho.up.set(0, 0, -1);
    ortho.position.set(t.x, 2000, t.z);
    ortho.lookAt(t);
  }
}
/** Screen-relative WASD: project the camera's forward and right vectors onto the ground. */
function moveBasis(cam: THREE.Camera): MoveBasis {
  const f = new THREE.Vector3();
  cam.getWorldDirection(f);
  if (Math.abs(f.y) > 0.999) f.copy(cam.up).applyQuaternion(cam.quaternion); // straight down: use "up" on screen
  f.y = 0;
  f.normalize();
  return { fx: f.x, fy: f.z, rx: -f.z, ry: f.x };
}
addEventListener('wheel', (e) => {
  zoom = Math.min(2.2, Math.max(0.55, zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
});

/** Hide see-through effects (mist, cones, smoke, sprites, rain, particles) and return what was hidden. */
function hideFx(): THREE.Object3D[] {
  const hidden: THREE.Object3D[] = [];
  scene.traverseVisible((o) => {
    const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
    if ((o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints || (o as THREE.Line).isLine || (mat && !Array.isArray(mat) && mat.transparent)) hidden.push(o);
  });
  hidden.forEach((o) => (o.visible = false));
  return hidden;
}

// ---------- moon shadow controls (for learning) ----------
const SHADOW_SIZES = [256, 512, 1024, 2048, 4096, 8192].filter((n) => n <= renderer.capabilities.maxTextureSize);
let shadowIdx = SHADOW_SIZES.indexOf(4096);
let shadowFit = false;
let shadowSoft = true;
const MOON_OFFSET = moon.position.clone().sub(moon.target.position);
const MOON_FULL = { left: -1300, right: 1300, top: 1000, bottom: -1000 };
const debug = new DebugViews(renderer, SHADOW_SIZES[shadowIdx]);
function applyShadowSize(): void {
  const n = SHADOW_SIZES[shadowIdx];
  moon.shadow.mapSize.set(n, n);
  moon.shadow.map?.dispose();
  (moon.shadow as { map: THREE.WebGLRenderTarget | null }).map = null;
  debug.resizeShadow(n);
}
/** Either cover the whole yard (default) or only what the camera can see, snapped to whole texels. */
function updateMoonShadow(): void {
  const cam = moon.shadow.camera;
  moon.shadow.radius = shadowSoft ? 3 : 0;
  if (!shadowFit) {
    Object.assign(cam, MOON_FULL);
    moon.target.position.set(YARD.w / 2, 0, YARD.h / 2);
  } else {
    const halfH = (camMode === 1 ? 700 : camMode === 3 ? 650 : 380) / zoom;
    const R = Math.max(halfH * (innerWidth / innerHeight), halfH * 1.8) + 120;
    Object.assign(cam, { left: -R, right: R, top: R, bottom: -R });
    const texel = (2 * R) / SHADOW_SIZES[shadowIdx];
    moon.target.position.set(Math.round(camTarget.x / texel) * texel, 0, Math.round(camTarget.z / texel) * texel);
  }
  moon.position.copy(moon.target.position).add(MOON_OFFSET);
  moon.target.updateMatrixWorld();
  cam.updateProjectionMatrix();
}

// ---------- post-processing ----------
const GRADE = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      // lens chromatic aberration, growing toward the frame edge
      vec2 off = d * r2 * 0.012;
      vec3 c = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(c, c * vec3(0.86, 1.0, 1.1), 1.0 - smoothstep(0.0, 0.42, l));   // teal shadows
      c = mix(c, c * vec3(1.07, 1.0, 0.88), smoothstep(0.4, 1.0, l));         // sodium highlights
      c = mix(vec3(l), c, 0.9);                                                // slightly desaturated, Cold War film stock
      c = c * 0.97 + 0.012;                                                    // lifted blacks
      c *= 1.0 - r2 * 1.1;                                                     // vignette
      c += (hash(vUv * uRes + fract(uTime) * 100.0) - 0.5) * 0.04;             // grain
      gl_FragColor = vec4(c, 1.0);
    }`,
};

let composer: EffectComposer;
let gtao: GTAOPass;
let bloom: UnrealBloomPass;
let smaa: SMAAPass;
let grade: ShaderPass;
let output: OutputPass;
function buildComposer(): void {
  composer?.dispose();
  const cam = activeCamera();
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, cam));
  gtao = new GTAOPass(scene, cam, innerWidth, innerHeight);
  gtao.updateGtaoMaterial({ radius: 14, distanceExponent: 1.4, thickness: 4, scale: 1.2, samples: 12, distanceFallOff: 1 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 8 });
  gtao.blendIntensity = 1;
  // GTAO re-renders the scene for depth + normals. Transparent effects (mist, cones, smoke, sprites)
  // must not be in that buffer, or the AO wraps around invisible geometry. Hide them for that render.
  const gtaoRender = gtao.render.bind(gtao);
  gtao.render = (...args: Parameters<GTAOPass['render']>) => {
    const hidden = hideFx();
    gtaoRender(...args);
    hidden.forEach((o) => (o.visible = true));
  };
  composer.addPass(gtao);
  bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.55, 0.9);
  composer.addPass(bloom);
  output = new OutputPass();
  composer.addPass(output);
  smaa = new SMAAPass();
  composer.addPass(smaa);
  grade = new ShaderPass(GRADE);
  composer.addPass(grade);
  applyToggles();
  resize();
}

// ---------- HUD / toggles ----------
const input = new Input(renderer.domElement);
const hud = new Hud(
  'Ironveil · 3D (Three.js)',
  [
    { key: '1', label: 'procedural materials', on: true, help: 'Solid noise, edge wear, grime, rain streaks, wet patches, micro bump' },
    { key: '2', label: 'shadow maps', on: true, help: 'Moon + 6 lamp shadow maps' },
    { key: '3', label: 'volumetrics (fake)', on: true, help: 'Light cones, headlight beams, lit ground mist' },
    { key: '4', label: 'ambient occlusion (GTAO)', on: true, help: 'Screen-space ground-truth AO' },
    { key: '5', label: 'bloom', on: true, help: 'Mip-chain bloom' },
    { key: '6', label: 'grade · CA · grain', on: true, help: 'Colour grade, chromatic aberration, vignette, grain' },
    { key: '7', label: 'anti-aliasing (SMAA)', on: true, help: 'Morphological anti-aliasing' },
    { key: '8', label: 'environment reflections', on: true, help: 'Image-based lighting from a pre-filtered environment' },
    { key: '9', label: 'rain', on: true, help: 'Line-segment rain' },
  ],
  gpuName(renderer.getContext()),
  `${CONTROLS_HINT} · C camera · wheel zoom<br>V debug view · −/= moon shadow resolution · F fit shadow to view · G soft shadow edges`,
);

function applyToggles(): void {
  procUniforms.uProcOn.value = hud.get('1') ? 1 : 0;
  const sh = hud.get('2');
  if (renderer.shadowMap.enabled !== sh) {
    renderer.shadowMap.enabled = sh;
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (m) (Array.isArray(m) ? m : [m]).forEach((x) => (x.needsUpdate = true));
    });
  }
  const vol = hud.get('3');
  lampCones.forEach((c) => (c.visible = vol));
  tankViews.forEach((v) => (v.beam.visible = vol));
  mist.mesh.visible = vol;
  scene.fog = vol ? fog : null;
  if (gtao) gtao.enabled = hud.get('4');
  if (bloom) bloom.enabled = hud.get('5');
  if (grade) grade.enabled = hud.get('6');
  if (smaa) smaa.enabled = hud.get('7');
  scene.environment = hud.get('8') ? envMap : null;
  hemi.intensity = hud.get('8') ? 0.35 : 0.9;
  rain.lines.visible = hud.get('9');
  // Debug views override some passes.
  const v = debug.view;
  if (!gtao || v === 'final') {
    if (gtao) gtao.output = GTAOPass.OUTPUT.Default;
    if (output) output.enabled = true;
    return;
  }
  bloom.enabled = false;
  grade.enabled = false;
  const buffer = v === 'normals' || v === 'depth' || v === 'ambient occlusion';
  gtao.enabled = buffer || (v === 'clay (lighting only)' && hud.get('4'));
  gtao.output = v === 'normals' ? GTAOPass.OUTPUT.Normal : v === 'depth' ? GTAOPass.OUTPUT.Depth : v === 'ambient occlusion' ? GTAOPass.OUTPUT.Denoise : GTAOPass.OUTPUT.Default;
  output.enabled = !buffer;
}

function resize(): void {
  const dpr = Math.min(devicePixelRatio, 2) * hud.renderScale;
  renderer.setPixelRatio(dpr);
  renderer.setSize(innerWidth, innerHeight);
  composer.setPixelRatio(dpr);
  composer.setSize(innerWidth, innerHeight);
  bloom.resolution.set((innerWidth * dpr) / 2, (innerHeight * dpr) / 2);
  (grade.uniforms.uRes as { value: THREE.Vector2 }).value.set(innerWidth * dpr, innerHeight * dpr);
  placeCamera();
}
addEventListener('resize', () => resize());
buildComposer();

// ---------- main loop ----------
const ray = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const aim = new THREE.Vector3();
let last = performance.now();
let lampFlick = 1;

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (hud.handle(input)) {
    applyToggles();
    resize();
  }
  if (input.take('KeyV')) {
    debug.index = (debug.index + 1) % VIEWS.length;
    applyToggles();
  }
  if (input.take('Minus')) {
    shadowIdx = Math.max(0, shadowIdx - 1);
    applyShadowSize();
  }
  if (input.take('Equal')) {
    shadowIdx = Math.min(SHADOW_SIZES.length - 1, shadowIdx + 1);
    applyShadowSize();
  }
  if (input.take('KeyF')) shadowFit = !shadowFit;
  if (input.take('KeyG')) shadowSoft = !shadowSoft;
  if (input.take('KeyC')) {
    camMode = (camMode + 1) % CAMS.length;
    chaseYaw = sb.player.hull;
    buildComposer();
  }

  const cam = activeCamera();
  const p = sb.player;
  camTarget.lerp(new THREE.Vector3(p.x, 0, p.y), 1 - Math.exp(-dt * 4));
  shake *= Math.exp(-dt * 14);
  placeCamera();
  cam.updateMatrixWorld();
  ray.setFromCamera(new THREE.Vector2((input.mouseX / innerWidth) * 2 - 1, -(input.mouseY / innerHeight) * 2 + 1), cam);
  const hit = ray.ray.intersectPlane(groundPlane, aim);
  if (!hit || (camMode === 3 && Math.hypot(aim.x - p.x, aim.z - p.y) > 1500)) aim.set(p.x + Math.cos(p.hull) * 400, 0, p.y + Math.sin(p.hull) * 400);
  if (camMode === 3) {
    let d = p.hull - chaseYaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    chaseYaw += d * Math.min(1, dt * 3);
  }

  sb.update(dt, input, aim.x, aim.z, moveBasis(cam), camMode === 3);
  input.endFrame();
  sb.tanks.forEach((t, i) => syncTank(t, tankViews[i], i));

  for (const e of sb.events) {
    if (e.type === 'fire') {
      shake = 7;
      sparks.burst(e.x, 22, e.y, -e.dx, -e.dy, 10, 160);
    } else sparks.burst(e.x, 10, e.y, e.dx, e.dy, 40, 260);
  }

  shellPool.forEach((g, i) => {
    const s = sb.shells[i];
    g.visible = !!s;
    if (s) {
      g.position.set(s.x, 22, s.y);
      g.rotation.y = -Math.atan2(s.vy, s.vx);
    }
  });
  flashLights.forEach((l, i) => {
    const f = sb.flashes[sb.flashes.length - 1 - i];
    if (!f) {
      l.intensity = 0;
      return;
    }
    const k = 1 - f.t / f.dur;
    l.position.set(f.x, 26, f.y);
    l.intensity = (f.big ? 520000 : 300000) * k * k;
  });

  // streetlamps: gentle flicker, and one failing sodium lamp that stutters
  const t = now / 1000;
  if (Math.random() < 0.04) lampFlick = Math.random() < 0.5 ? 0.15 : 1;
  lampFlick += (1 - lampFlick) * dt * 3;
  lamps.forEach((l, i) => {
    const k = (0.96 + Math.sin(t * 1.1 + i) * 0.03) * (i === 3 ? lampFlick : 1);
    l.light.intensity = 320000 * k;
    l.glow.material.opacity = k;
    (l.bulb.material as THREE.MeshBasicMaterial).color.setRGB(8 * k, 4.4 * k, 1.6 * k);
    (lampCones[i].material as THREE.ShaderMaterial).uniforms.uStrength.value = 0.16 * k;
  });

  procUniforms.uTime.value = t;
  [...lampCones.map((c) => c.material as THREE.ShaderMaterial), ...beamMats].forEach((m) => (m.uniforms.uTime.value = t));
  mist.update(t);
  decals.update(sb);
  sparks.update(dt);
  smoke.update(sb, cam);
  rain.update(dt, camTarget.x, camTarget.z);
  flashes.update(sb);
  (grade.uniforms.uTime as { value: number }).value = t;

  updateMoonShadow();
  renderer.info.reset();
  const view = debug.view;
  const override = view === 'wireframe' ? debug.wire : view === 'clay (lighting only)' ? debug.clay : view === 'shadow-map texels' ? debug.texel : null;
  if (override) {
    const hidden = hideFx();
    if (view === 'shadow-map texels') debug.renderLightDepth(scene, moon, camTarget);
    scene.overrideMaterial = override;
    composer.render();
    scene.overrideMaterial = null;
    hidden.forEach((o) => (o.visible = true));
    if (view === 'shadow-map texels') debug.drawInset(Math.min(260, innerHeight * 0.4));
  } else composer.render();
  const info = renderer.info.render;
  const sc = moon.shadow.camera, sz = SHADOW_SIZES[shadowIdx];
  hud.extra = `view: <b>${view}</b> · camera: <b>${CAMS[camMode]}</b><br>${renderer.domElement.width}×${renderer.domElement.height} · ${info.calls} draw calls · ${(info.triangles / 1000).toFixed(0)}k tris<br>moon shadow: <b>${sz}²</b> over ${(sc.right - sc.left).toFixed(0)}×${(sc.top - sc.bottom).toFixed(0)} units = <b>${((sc.right - sc.left) / sz).toFixed(2)}</b> units/texel<br>fit to view: <b>${shadowFit ? 'on' : 'off'}</b> · soft edges: <b>${shadowSoft ? 'on' : 'off'}</b>`;
  hud.frame(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
