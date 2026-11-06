// 3D rendering proof of concept with Three.js: real geometry under a tilted top-down camera.
// Same yard, same tank sandbox as the 2D demo. Techniques:
//   - physically based materials (albedo + normal + roughness maps, generated procedurally)
//   - shadow maps (moonlight + a few streetlamp spotlights)
//   - fake volumetric light cones (additive meshes) + exponential distance fog
//   - lit billboard smoke, muzzle/impact point lights
//   - post-processing: bloom at reduced resolution, ACES tone mapping, grade/vignette/grain
//   - render scale (pixel ratio), the main performance lever on integrated GPUs
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { CONTROLS_HINT, HUD_CSS, Hud, Input, LAMPS, LAMP_HEIGHT, RECTS, Sandbox, YARD, gpuName, smokeAlpha, smokeRadius, type Tank } from '../shared';

const style = document.createElement('style');
style.textContent = HUD_CSS;
document.head.appendChild(style);

// World mapping: sandbox (x, y) -> three (x, z); y is up. 1 unit = 1 sandbox pixel.
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.info.autoReset = false; // the composer renders several passes per frame
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070b09);
const fog = new THREE.FogExp2(0x0b1210, 0.00038);
scene.fog = fog;
const camera = new THREE.PerspectiveCamera(32, 1, 10, 4000);

// ---------- procedural textures ----------
function canvasTex(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void, srgb: boolean, repeat: [number, number]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Turn a grayscale height canvas into a tangent-space normal map (Sobel-ish slope). */
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
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      img.data[i] = (-dx / l) * 127 + 128;
      img.data[i + 1] = (dy / l) * 127 + 128;
      img.data[i + 2] = (1 / l) * 127 + 128;
      img.data[i + 3] = 255;
    }
  octx.putImageData(img, 0, 0);
  return out;
}

function rand(seed: number): () => number {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

// Cobblestones: albedo, height -> normal, and a roughness map with glossy puddles.
const COB = 512;
const cobHeight = document.createElement('canvas');
cobHeight.width = cobHeight.height = COB;
const cobAlbedo = document.createElement('canvas');
cobAlbedo.width = cobAlbedo.height = COB;
const cobRough = document.createElement('canvas');
cobRough.width = cobRough.height = COB;
{
  const hc = cobHeight.getContext('2d')!, ac = cobAlbedo.getContext('2d')!, rc = cobRough.getContext('2d')!;
  const r = rand(7);
  hc.fillStyle = '#000';
  hc.fillRect(0, 0, COB, COB);
  ac.fillStyle = '#26352b';
  ac.fillRect(0, 0, COB, COB);
  rc.fillStyle = '#e6e6e6';
  rc.fillRect(0, 0, COB, COB);
  const cw = 32, ch = 24;
  for (let row = 0; row < COB / ch; row++)
    for (let col = -1; col < COB / cw + 1; col++) {
      const x = col * cw + (row % 2) * cw * 0.5, y = row * ch;
      const v = r();
      for (let k = 6; k >= 0; k--) {
        const g = Math.round(255 * (0.4 + v * 0.6) * (1 - k / 7));
        hc.fillStyle = `rgb(${g},${g},${g})`;
        hc.beginPath();
        hc.roundRect(x + 3 + k * 0.6, y + 3 + k * 0.6, cw - 6 - k * 1.2, ch - 6 - k * 1.2, 6);
        hc.fill();
      }
      const t = 95 + v * 45;
      ac.fillStyle = `rgb(${t},${t * 0.96},${t * 0.85})`;
      ac.beginPath();
      ac.roundRect(x + 3, y + 3, cw - 6, ch - 6, 6);
      ac.fill();
      const rg = Math.round(170 + v * 60);
      rc.fillStyle = `rgb(${rg},${rg},${rg})`;
      rc.beginPath();
      rc.roundRect(x + 3, y + 3, cw - 6, ch - 6, 6);
      rc.fill();
    }
}
const groundMat = new THREE.MeshStandardMaterial({
  map: new THREE.CanvasTexture(cobAlbedo),
  normalMap: new THREE.CanvasTexture(normalFromHeight(cobHeight, 4)),
  roughnessMap: new THREE.CanvasTexture(cobRough),
  normalScale: new THREE.Vector2(1, 1),
});
for (const t of [groundMat.map!, groundMat.normalMap!, groundMat.roughnessMap!]) {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(YARD.w / 256, YARD.h / 256);
  t.anisotropy = 4;
}
groundMat.map!.colorSpace = THREE.SRGBColorSpace;

// Puddles as a separate, nearly mirror-smooth decal layer: low roughness picks up lamp highlights.
const puddleMat = new THREE.MeshStandardMaterial({ color: 0x0b0d0d, roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
const puddleTex = canvasTex(256, 256, (ctx) => {
  const g = ctx.createRadialGradient(128, 128, 20, 128, 128, 126);
  g.addColorStop(0, '#fff');
  g.addColorStop(0.7, '#fff');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(128, 128, 126, 90, 0.4, 0, Math.PI * 2);
  ctx.fill();
}, false, [1, 1]);
puddleMat.alphaMap = puddleTex;

const concreteAlbedo = canvasTex(256, 256, (ctx) => {
  const r = rand(3);
  ctx.fillStyle = '#a8a69c';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    const v = 120 + r() * 70;
    ctx.fillStyle = `rgba(${v},${v},${v * 0.94},0.25)`;
    ctx.fillRect(r() * 256, r() * 256, 1 + r() * 4, 1 + r() * 4);
  }
  ctx.fillStyle = 'rgba(40,40,36,0.5)';
  ctx.fillRect(0, 0, 3, 256); // slab seam
  ctx.fillStyle = 'rgba(120,70,40,0.25)';
  ctx.fillRect(0, 200, 256, 56); // rust/dirt at the base
  const tags = ['rgba(196,72,58,0.7)', 'rgba(226,190,82,0.6)', 'rgba(96,160,186,0.6)'];
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    ctx.strokeStyle = tags[i];
    ctx.beginPath();
    ctx.moveTo(30 + r() * 180, 90 + r() * 90);
    for (let k = 0; k < 4; k++) ctx.quadraticCurveTo(r() * 256, 80 + r() * 110, r() * 256, 80 + r() * 110);
    ctx.stroke();
  }
}, true, [1, 1]);

// ---------- static scene ----------
const ground = new THREE.Mesh(new THREE.PlaneGeometry(YARD.w + 800, YARD.h + 800), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.set(YARD.w / 2, 0, YARD.h / 2);
ground.receiveShadow = true;
scene.add(ground);
{
  const r = rand(11);
  for (let i = 0; i < 14; i++) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(60 + r() * 120, 40 + r() * 80), puddleMat);
    p.rotation.x = -Math.PI / 2;
    p.rotation.z = r() * 3;
    p.position.set(r() * YARD.w, 0.3, r() * YARD.h);
    p.receiveShadow = true;
    scene.add(p);
  }
}

const mats = {
  wall: new THREE.MeshStandardMaterial({ map: concreteAlbedo, roughness: 0.9 }),
  cap: new THREE.MeshStandardMaterial({ color: 0xc9c7bc, roughness: 0.8 }),
  building: new THREE.MeshStandardMaterial({ color: 0x4f5654, roughness: 0.85 }),
  roof: new THREE.MeshStandardMaterial({ color: 0x2f3433, roughness: 0.95 }),
  window: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffb35a, emissiveIntensity: 1.6 }),
  crate: new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 0.55, metalness: 0.5 }),
  pole: new THREE.MeshStandardMaterial({ color: 0x2a2e2c, roughness: 0.6, metalness: 0.6 }),
  lampHead: new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffb35a, emissiveIntensity: 6 }),
};

function addBox(w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

for (const r of RECTS) {
  const cx = r.x + r.w / 2, cz = r.y + r.h / 2;
  if (r.kind === 'wall') {
    // Berlin-wall style: individual slabs with a round pipe cap on top
    const horiz = r.w > r.h;
    const len = horiz ? r.w : r.h;
    const n = Math.round(len / 60);
    for (let i = 0; i < n; i++) {
      const off = -len / 2 + (i + 0.5) * (len / n);
      const slab = addBox(horiz ? len / n - 2 : r.w, r.height - 8, horiz ? r.h : len / n - 2, cx + (horiz ? off : 0), (r.height - 8) / 2, cz + (horiz ? 0 : off), mats.wall);
      slab.material = mats.wall;
    }
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, len, 12), mats.cap);
    cap.rotation.set(horiz ? 0 : Math.PI / 2, 0, horiz ? Math.PI / 2 : 0);
    cap.position.set(cx, r.height - 6, cz);
    cap.castShadow = cap.receiveShadow = true;
    scene.add(cap);
  } else if (r.kind === 'building') {
    addBox(r.w, r.height, r.h, cx, r.height / 2, cz, mats.building);
    addBox(r.w + 6, 6, r.h + 6, cx, r.height + 3, cz, mats.roof);
    for (let i = 0; i < 4; i++) addBox(14, 18, 2, r.x + 30 + i * (r.w - 60) / 3, r.height * 0.6, r.y + r.h + 1, mats.window).castShadow = false;
  } else {
    addBox(r.w, r.height, r.h, cx, r.height / 2, cz, mats.crate);
  }
}

// ---------- lights ----------
const hemi = new THREE.HemisphereLight(0x8a9ea8, 0x2a322c, 1.4);
scene.add(hemi);
const moon = new THREE.DirectionalLight(0x9fb6c8, 1.6);
moon.position.set(YARD.w / 2 - 500, 900, YARD.h / 2 - 600);
moon.target.position.set(YARD.w / 2, 0, YARD.h / 2);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
Object.assign(moon.shadow.camera, { left: -1100, right: 1100, top: 800, bottom: -800, near: 100, far: 2500 });
moon.shadow.bias = -0.0005;
moon.shadow.normalBias = 1.5;
scene.add(moon, moon.target);

// Light-cone mesh: an open cone with a shader that fades along its length and toward the rim
// (a fresnel-ish term), drawn additively without depth writes: the classic fake volumetric.
const coneMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  uniforms: { uColor: { value: new THREE.Color(0xffa64d) }, uStrength: { value: 0.22 } },
  vertexShader: /* glsl */ `
    varying float vH; varying vec3 vN; varying vec3 vV;
    void main() {
      vH = uv.y;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vN = normalize(mat3(modelMatrix) * normal);
      vV = normalize(cameraPosition - wp.xyz);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor; uniform float uStrength;
    varying float vH; varying vec3 vN; varying vec3 vV;
    void main() {
      float rim = pow(abs(dot(normalize(vN), normalize(vV))), 1.5);
      float a = uStrength * rim * pow(vH, 1.6);
      gl_FragColor = vec4(uColor * a, 1.0);
    }`,
});

const lampLights: THREE.SpotLight[] = [];
const cones: THREE.Mesh[] = [];
for (const l of LAMPS) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 3.5, LAMP_HEIGHT, 8), mats.pole);
  pole.position.set(l.x - 14, LAMP_HEIGHT / 2, l.y);
  pole.castShadow = true;
  scene.add(pole);
  const arm = addBox(18, 3, 3, l.x - 6, LAMP_HEIGHT, l.y, mats.pole);
  arm.castShadow = true;
  const head = new THREE.Mesh(new THREE.BoxGeometry(14, 4, 9), mats.lampHead);
  head.position.set(l.x, LAMP_HEIGHT - 2, l.y);
  scene.add(head);
  const s = new THREE.SpotLight(0xffa64d, 260000, 700, 1.15, 0.75, 2);
  s.position.set(l.x, LAMP_HEIGHT - 4, l.y);
  s.target.position.set(l.x, 0, l.y);
  s.shadow.mapSize.set(512, 512);
  s.shadow.bias = -0.0008;
  s.shadow.camera.near = 10;
  scene.add(s, s.target);
  lampLights.push(s);
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(4, LAMP_HEIGHT * Math.tan(1.15) * 0.6, LAMP_HEIGHT - 6, 24, 1, true), coneMat);
  cone.position.set(l.x, (LAMP_HEIGHT - 6) / 2, l.y);
  scene.add(cone);
  cones.push(cone);
}

// ---------- tanks ----------
interface TankView { root: THREE.Group; turret: THREE.Group; barrel: THREE.Mesh; head: THREE.SpotLight; beam: THREE.Mesh }
function buildTank(team: 0 | 1): TankView {
  const body = new THREE.MeshStandardMaterial({ color: team === 0 ? 0x70a9bd : 0xbb7657, roughness: 0.55, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d1f, roughness: 0.9, metalness: 0.2 });
  const root = new THREE.Group();
  const part = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = root) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  for (const z of [-15, 15]) part(new THREE.BoxGeometry(52, 11, 10), dark, 0, 5.5, z);
  const hullGeo = new THREE.BoxGeometry(48, 9, 30);
  // slope the glacis by pulling the front-top vertices back
  const pos = hullGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) if (pos.getX(i) > 0 && pos.getY(i) > 0) pos.setX(i, pos.getX(i) - 8);
  hullGeo.computeVertexNormals();
  part(hullGeo, body, 0, 13, 0);
  const turret = new THREE.Group();
  turret.position.set(-3, 17.5, 0);
  root.add(turret);
  part(new THREE.CylinderGeometry(10, 13, 9, 16), body, 0, 4.5, 0, turret);
  part(new THREE.BoxGeometry(8, 4, 8), dark, -8, 9.5, 4, turret);
  const barrel = part(new THREE.CylinderGeometry(2, 2.4, 30, 10), dark, 24, 5, 0, turret);
  barrel.rotation.z = Math.PI / 2;
  const head = new THREE.SpotLight(0xfff0cf, 120000, 420, 0.45, 0.6, 2);
  head.position.set(20, 14, 0);
  head.target.position.set(140, 0, 0);
  root.add(head, head.target);
  const beam = new THREE.Mesh(new THREE.ConeGeometry(70, 200, 20, 1, true), coneMat.clone());
  (beam.material as THREE.ShaderMaterial).uniforms.uColor.value = new THREE.Color(0xfff0cf);
  (beam.material as THREE.ShaderMaterial).uniforms.uStrength.value = 0.09;
  beam.rotation.z = Math.PI / 2;
  beam.position.set(120, 10, 0);
  root.add(beam);
  scene.add(root);
  return { root, turret, barrel, head, beam };
}

const sb = new Sandbox();
const tankViews = sb.tanks.map((t) => buildTank(t.team));

function syncTank(t: Tank, v: TankView): void {
  v.root.position.set(t.x, 0, t.y);
  v.root.rotation.y = -t.hull;
  v.turret.rotation.y = -(t.turret - t.hull);
  v.barrel.position.x = 24 - t.recoil * 6;
}

// ---------- dynamic: shells, flashes, smoke ----------
const flashPool: THREE.PointLight[] = [];
for (let i = 0; i < 4; i++) {
  const p = new THREE.PointLight(0xffa04a, 0, 320, 2);
  scene.add(p);
  flashPool.push(p);
}
const shellMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 3, 1.2) });
const shellPool: THREE.Mesh[] = [];
for (let i = 0; i < 8; i++) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(1.6, 16, 2, 6), shellMat);
  m.rotation.z = Math.PI / 2;
  const g = new THREE.Group();
  g.add(m);
  g.visible = false;
  scene.add(g);
  shellPool.push(m);
}

const puffTex = canvasTex(64, 64, (ctx) => {
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
}, false, [1, 1]);
// Lambert (lit) quads that always face the camera: smoke picks up lamp and muzzle light.
const puffMat = new THREE.MeshLambertMaterial({ color: 0x9aa09c, alphaMap: puffTex, transparent: true, depthWrite: false });
const puffs: THREE.Mesh[] = [];
const puffGeo = new THREE.PlaneGeometry(1, 1);
for (let i = 0; i < 4 * 24; i++) {
  const m = new THREE.Mesh(puffGeo, puffMat.clone());
  m.visible = false;
  scene.add(m);
  puffs.push(m);
}

// ---------- post-processing ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.6, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(c, c * vec3(0.88, 1.0, 1.08), 1.0 - smoothstep(0.0, 0.45, l));
      c = mix(c, c * vec3(1.06, 1.0, 0.9), smoothstep(0.45, 1.0, l));
      vec2 v = vUv - 0.5; c *= 1.0 - dot(v, v) * 0.9;
      c += (hash(vUv * 1000.0 + uTime) - 0.5) * 0.035;
      gl_FragColor = vec4(c, 1.0);
    }`,
});
composer.addPass(grade);

// ---------- HUD / toggles ----------
const input = new Input(renderer.domElement);
const hud = new Hud(
  'Ironveil · 3D (Three.js)',
  [
    { key: '1', label: 'normal maps', on: true, help: 'Cobble detail from a generated normal map' },
    { key: '2', label: 'shadow maps', on: true, help: 'Moon + streetlamp shadow maps' },
    { key: '3', label: 'volumetric cones (fake)', on: true, help: 'Additive light-cone meshes' },
    { key: '4', label: 'distance fog', on: true, help: 'Exponential fog' },
    { key: '5', label: 'bloom (half res)', on: true, help: 'UnrealBloomPass mip chain' },
    { key: '6', label: 'grade + vignette + grain', on: true, help: 'Final colour pass' },
    { key: '7', label: 'tilted camera', on: true, help: 'Off = straight top-down' },
  ],
  gpuName(renderer.getContext()),
  CONTROLS_HINT,
);

function applyToggles(): void {
  groundMat.normalScale.setScalar(hud.get('1') ? 1 : 0);
  const sh = hud.get('2');
  renderer.shadowMap.enabled = sh;
  moon.castShadow = sh;
  lampLights.forEach((l) => (l.castShadow = sh));
  scene.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | undefined;
    if (m) m.needsUpdate = true;
  });
  cones.forEach((c) => (c.visible = hud.get('3')));
  tankViews.forEach((v) => (v.beam.visible = hud.get('3')));
  scene.fog = hud.get('4') ? fog : null;
  bloom.enabled = hud.get('5');
  grade.enabled = hud.get('6');
}

function resize(): void {
  const dpr = Math.min(devicePixelRatio, 2) * hud.renderScale;
  renderer.setPixelRatio(dpr);
  renderer.setSize(innerWidth, innerHeight);
  composer.setPixelRatio(dpr);
  composer.setSize(innerWidth, innerHeight);
  bloom.resolution.set((innerWidth * dpr) / 2, (innerHeight * dpr) / 2);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const ray = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const aim = new THREE.Vector3();
const camPos = new THREE.Vector3(sb.player.x, 0, sb.player.y);

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (hud.handle(input)) {
    applyToggles();
    resize();
  }

  // Camera follows the player; aim by raycasting the mouse onto the ground plane.
  const p = sb.player;
  camPos.lerp(new THREE.Vector3(p.x, 0, p.y), 1 - Math.exp(-dt * 5));
  const tilt = hud.get('7');
  camera.position.set(camPos.x, 1250, camPos.z + (tilt ? 720 : 1));
  camera.lookAt(camPos.x, 0, camPos.z + (tilt ? 40 : 0));
  ray.setFromCamera(new THREE.Vector2((input.mouseX / innerWidth) * 2 - 1, -(input.mouseY / innerHeight) * 2 + 1), camera);
  if (!ray.ray.intersectPlane(groundPlane, aim)) aim.set(p.x + 1, 0, p.y);

  sb.update(dt, input, aim.x, aim.z);
  input.endFrame();
  sb.tanks.forEach((t, i) => syncTank(t, tankViews[i]));

  shellPool.forEach((m, i) => {
    const s = sb.shells[i];
    const g = m.parent!;
    g.visible = !!s;
    if (s) {
      g.position.set(s.x, 18, s.y);
      g.rotation.y = -Math.atan2(s.vy, s.vx);
    }
  });
  flashPool.forEach((l, i) => {
    const f = sb.flashes[sb.flashes.length - 1 - i];
    if (!f) {
      l.intensity = 0;
      return;
    }
    const k = 1 - f.t / f.dur;
    l.position.set(f.x, 24, f.y);
    l.intensity = (f.big ? 400000 : 250000) * k * k;
  });
  let pi = 0;
  const smokes = sb.smokes.slice(-4);
  for (let si = 0; si < smokes.length; si++) {
    const s = smokes[si];
    const r = smokeRadius(s), a = smokeAlpha(s);
    const rnd = rand(Math.floor(s.seed * 1000) + 1);
    for (let k = 0; k < 24; k++, pi++) {
      const m = puffs[pi];
      const ang = rnd() * Math.PI * 2, dist = Math.sqrt(rnd()) * r * 0.75;
      const drift = sb.time * (0.1 + rnd() * 0.2);
      m.visible = true;
      m.position.set(s.x + Math.cos(ang + drift * 0.3) * dist, 10 + rnd() * 50 + s.t * 3, s.y + Math.sin(ang + drift * 0.3) * dist);
      m.quaternion.copy(camera.quaternion);
      m.scale.setScalar(r * (0.6 + rnd() * 0.5));
      (m.material as THREE.MeshLambertMaterial).opacity = a * 0.35;
    }
  }
  for (; pi < puffs.length; pi++) puffs[pi].visible = false;

  const flick = 0.95 + Math.sin(now / 900) * 0.03;
  lampLights.forEach((l) => (l.intensity = 260000 * flick));
  (grade.uniforms.uTime as { value: number }).value = now / 1000;

  renderer.info.reset();
  composer.render();
  const info = renderer.info.render;
  hud.extra = `${renderer.domElement.width}×${renderer.domElement.height} · ${info.calls} draw calls · ${(info.triangles / 1000).toFixed(0)}k tris`;
  hud.frame(now);
  requestAnimationFrame(frame);
}
applyToggles();
requestAnimationFrame(frame);
