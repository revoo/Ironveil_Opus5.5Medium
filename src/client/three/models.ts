// Procedural 3D models for the mission renderer (ported from the Render Lab PoC): tanks, lamps,
// wall slabs, buildings and set dressing. Everything is bevelled so edges catch light, and every
// material goes through the procedural detail layer in materials.ts.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Surface, proc } from './materials';

export function rand(seed: number): () => number {
  seed = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

export function shadowed<T extends THREE.Object3D>(o: T, cast = true, receive = true): T {
  o.traverse((c) => {
    c.castShadow = cast;
    c.receiveShadow = receive;
  });
  return o;
}

export function canvasTexture(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export const radialTexture = canvasTexture(
  128,
  128,
  (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  },
  false,
);

// ---------------------------------------------------------------- shared materials
function graffitiTexture(seed: number): THREE.CanvasTexture {
  return canvasTexture(256, 256, (ctx) => {
    const r = rand(seed);
    ctx.fillStyle = '#d9d6cb';
    ctx.fillRect(0, 0, 256, 256);
    const tags = ['rgba(196,72,58,0.85)', 'rgba(226,190,82,0.8)', 'rgba(96,160,186,0.8)', 'rgba(40,40,40,0.75)', 'rgba(122,170,96,0.75)'];
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const n = 1 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      ctx.strokeStyle = tags[Math.floor(r() * tags.length)]!;
      ctx.lineWidth = 5 + r() * 10;
      ctx.beginPath();
      let x = 20 + r() * 60;
      ctx.moveTo(x, 120 + r() * 80);
      for (let k = 0; k < 6; k++) {
        const nx = x + 15 + r() * 40, ny = 90 + r() * 120;
        ctx.quadraticCurveTo((x + nx) / 2, ny - 60 + r() * 120, nx, ny);
        x = nx;
      }
      ctx.stroke();
    }
  });
}

export function makeMaterials() {
  return {
    wallVariants: [1, 2, 3, 4].map((s) => proc(new THREE.MeshStandardMaterial({ map: graffitiTexture(s * 97), roughness: 0.92 }), Surface.Concrete, { scale: 0.07, bump: 0.8 })),
    wallPlain: proc(new THREE.MeshStandardMaterial({ color: 0xbfbcb1, roughness: 0.92 }), Surface.Concrete, { scale: 0.07, bump: 0.8 }),
    cap: proc(new THREE.MeshStandardMaterial({ color: 0xc9c7bc, roughness: 0.8 }), Surface.Concrete, { scale: 0.1, bump: 0.4 }),
    building: proc(new THREE.MeshStandardMaterial({ color: 0x5d6461, roughness: 0.9 }), Surface.Concrete, { scale: 0.05 }),
    building2: proc(new THREE.MeshStandardMaterial({ color: 0x6e6457, roughness: 0.9 }), Surface.Concrete, { scale: 0.05 }),
    roof: proc(new THREE.MeshStandardMaterial({ color: 0x2f3433, roughness: 0.95 }), Surface.Tar, { scale: 0.06 }),
    metal: proc(new THREE.MeshStandardMaterial({ color: 0x6d726f, roughness: 0.5, metalness: 0.6 }), Surface.Rust, { scale: 0.12 }),
    pole: proc(new THREE.MeshStandardMaterial({ color: 0x3a403d, roughness: 0.55, metalness: 0.7 }), Surface.Paint, { scale: 0.2 }),
    barrel: proc(new THREE.MeshStandardMaterial({ color: 0x3f5a6a, roughness: 0.5, metalness: 0.55 }), Surface.Rust, { scale: 0.12 }),
    barrel2: proc(new THREE.MeshStandardMaterial({ color: 0x8a3a26, roughness: 0.5, metalness: 0.55 }), Surface.Rust, { scale: 0.12 }),
    crate: proc(new THREE.MeshStandardMaterial({ color: 0x55603f, roughness: 0.55, metalness: 0.5 }), Surface.Rust, { scale: 0.09 }),
    stripe: proc(new THREE.MeshStandardMaterial({ color: 0xc8c2b4, roughness: 0.6 }), Surface.Paint, { scale: 0.2 }),
    stripeRed: proc(new THREE.MeshStandardMaterial({ color: 0x9a2e22, roughness: 0.6 }), Surface.Paint, { scale: 0.2 }),
    bush: proc(new THREE.MeshStandardMaterial({ color: 0x3e5a36, roughness: 0.95, flatShading: true }), Surface.Tar, { scale: 0.15, bump: 0.6, wear: 0 }),
    bush2: proc(new THREE.MeshStandardMaterial({ color: 0x2f4a2c, roughness: 0.95, flatShading: true }), Surface.Tar, { scale: 0.15, bump: 0.6, wear: 0 }),
    window: new THREE.MeshBasicMaterial({ color: 0xffffff }),
  };
}
export type Materials = ReturnType<typeof makeMaterials>;

// ---------------------------------------------------------------- walls & buildings
/** A straight run of Berlin-wall slabs (L foot, pipe cap) centred at (cx, cz). */
export function wallRun(parent: THREE.Object3D, m: Materials, cx: number, cz: number, len: number, thick: number, horiz: boolean, height: number, seed: number): void {
  const r = rand(seed);
  const n = Math.max(1, Math.round(len / 40));
  const slabLen = len / n;
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const off = -len / 2 + (i + 0.5) * slabLen;
    const h = height - 10;
    const mat = r() < 0.55 ? m.wallVariants[Math.floor(r() * m.wallVariants.length)]! : m.wallPlain;
    const slab = new THREE.Mesh(new RoundedBoxGeometry(slabLen - 1.5, h, thick * 0.55, 2, 1.6), mat);
    slab.position.set(off, h / 2, -thick * 0.2);
    slab.rotation.z = (r() - 0.5) * 0.008;
    const foot = new THREE.Mesh(new RoundedBoxGeometry(slabLen - 1.5, 7, thick, 2, 1.5), m.wallPlain);
    foot.position.set(off, 3.5, 0);
    g.add(slab, foot);
  }
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, len, 16), m.cap);
  cap.rotation.z = Math.PI / 2;
  cap.position.set(0, height - 6, -thick * 0.2);
  g.add(cap);
  g.position.set(cx, 0, cz);
  if (!horiz) g.rotation.y = Math.PI / 2;
  parent.add(g);
}

export interface WindowInstance {
  m: THREE.Matrix4;
  c: THREE.Color;
}

/** A block with parapet, rooftop clutter and windows on all sides (windows are returned for instancing). */
export function building(parent: THREE.Object3D, m: Materials, x: number, z: number, w: number, d: number, height: number, seed: number, wins: WindowInstance[]): void {
  const r = rand(seed);
  const g = new THREE.Group();
  const wallMat = seed % 2 ? m.building2 : m.building;
  const body = new THREE.Mesh(new RoundedBoxGeometry(w, height, d, 2, 2), wallMat);
  body.position.y = height / 2;
  const roof = new THREE.Mesh(new RoundedBoxGeometry(Math.max(4, w - 10), 3, Math.max(4, d - 10), 2, 1), m.roof);
  roof.position.y = height + 0.5;
  g.add(body, roof);
  for (const [px, pz, pw, pd] of [
    [0, d / 2 - 2, w, 4],
    [0, -d / 2 + 2, w, 4],
    [w / 2 - 2, 0, 4, d],
    [-w / 2 + 2, 0, 4, d],
  ] as const) {
    const p = new THREE.Mesh(new RoundedBoxGeometry(pw, 8, pd, 1, 1), wallMat);
    p.position.set(px, height + 4, pz);
    g.add(p);
  }
  const n = Math.min(5, Math.floor((w * d) / 9000) + 1);
  for (let i = 0; i < n; i++) {
    const s = 12 + r() * 16;
    if (w < s + 30 || d < s + 30) break;
    const ac = new THREE.Mesh(new RoundedBoxGeometry(s, 8 + r() * 8, s * 0.8, 2, 1.5), m.metal);
    ac.position.set((r() - 0.5) * (w - s - 24), height + 6, (r() - 0.5) * (d - s - 24));
    g.add(ac);
  }
  g.position.set(x, 0, z);
  parent.add(g);
  const floors = Math.floor((height - 20) / 34);
  const faces: [number, number, number, number][] = [
    [0, d / 2 + 0.3, 0, w],
    [0, -d / 2 - 0.3, Math.PI, w],
    [w / 2 + 0.3, 0, Math.PI / 2, d],
    [-w / 2 - 0.3, 0, -Math.PI / 2, d],
  ];
  for (const [fx, fz, rot, span] of faces) {
    const cols = Math.floor((span - 20) / 30);
    if (cols < 1) continue;
    for (let f = 0; f < floors; f++)
      for (let c = 0; c < cols; c++) {
        const along = cols === 1 ? 0 : -span / 2 + 25 + c * ((span - 50) / (cols - 1));
        const pos = new THREE.Vector3(fx, 22 + f * 34, fz);
        if (rot === 0 || rot === Math.PI) pos.x += along;
        else pos.z += along;
        pos.add(g.position);
        const mm = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(1, 1, 1));
        const lit = r() < 0.28;
        wins.push({ m: mm, c: lit ? new THREE.Color(2.4, 1.35, 0.55).multiplyScalar(0.6 + r() * 0.8) : new THREE.Color(0.02, 0.025, 0.03) });
      }
  }
}

export function windowsMesh(wins: WindowInstance[], mat: THREE.Material): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(12, 16), mat, Math.max(1, wins.length));
  wins.forEach((w, i) => {
    mesh.setMatrixAt(i, w.m);
    mesh.setColorAt(i, w.c);
  });
  mesh.count = wins.length;
  return mesh;
}

// ---------------------------------------------------------------- lamps
export const LAMP_HEIGHT = 120;
export interface LampView {
  light: THREE.SpotLight;
  glow: THREE.Sprite;
  bulb: THREE.MeshBasicMaterial;
  x: number;
  z: number;
}

export function lamp(parent: THREE.Object3D, scene: THREE.Scene, m: Materials, x: number, z: number, castShadow: boolean, armDir = 0): LampView {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(2, 3.2, LAMP_HEIGHT + 6, 10), m.pole);
  pole.position.set(-18, (LAMP_HEIGHT + 6) / 2, 0);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(5, 6, 8, 10), m.pole);
  base.position.set(-18, 4, 0);
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-18, LAMP_HEIGHT + 4, 0), new THREE.Vector3(-17, LAMP_HEIGHT + 14, 0), new THREE.Vector3(0, LAMP_HEIGHT + 4, 0));
  const arm = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 1.6, 6), m.pole);
  const head = new THREE.Mesh(new RoundedBoxGeometry(16, 5, 9, 2, 2), m.pole);
  head.position.set(0, LAMP_HEIGHT + 2, 0);
  const bulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 4.4, 1.6) });
  const bulb = new THREE.Mesh(new THREE.BoxGeometry(11, 1, 5), bulbMat);
  bulb.position.set(0, LAMP_HEIGHT - 0.6, 0);
  g.add(pole, base, arm, head);
  shadowed(g);
  g.add(bulb);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture, color: new THREE.Color(1.6, 0.85, 0.35), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  glow.scale.setScalar(70);
  glow.position.set(0, LAMP_HEIGHT - 4, 0);
  g.add(glow);
  g.position.set(x, 0, z);
  g.rotation.y = armDir;
  parent.add(g);
  const s = new THREE.SpotLight(0xffa64d, 320000, 700, 1.1, 0.8, 2);
  s.position.set(x, LAMP_HEIGHT - 3, z);
  s.target.position.set(x, 0, z);
  s.castShadow = castShadow;
  s.shadow.mapSize.set(1024, 1024);
  s.shadow.bias = -0.0006;
  s.shadow.normalBias = 0.6;
  s.shadow.camera.near = 8;
  scene.add(s, s.target);
  return { light: s, glow, bulb: bulbMat, x, z };
}

// ---------------------------------------------------------------- set dressing
export function barrel(parent: THREE.Object3D, m: Materials, x: number, z: number, seed: number, tipped = false): void {
  const r = rand(seed);
  const mat = r() < 0.5 ? m.barrel : m.barrel2;
  const b = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 22, 16), mat);
  if (tipped) {
    b.rotation.z = Math.PI / 2;
    b.rotation.y = r() * 3;
    b.position.set(x, 7, z);
  } else b.position.set(x, 11, z);
  for (const y of [-6, 6]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(7.1, 0.7, 6, 18), mat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    b.add(ring);
  }
  parent.add(b);
}

/** Red and white striped checkpoint barrier along x (w) at height h. */
export function barrier(parent: THREE.Object3D, m: Materials, x: number, z: number, w: number, d: number, rotY: number): void {
  const g = new THREE.Group();
  const len = Math.max(w, d);
  const n = Math.max(3, Math.round(len / 14));
  for (let i = 0; i < n; i++) {
    const seg = new THREE.Mesh(new RoundedBoxGeometry(len / n - 0.5, 4, 4, 1, 1), i % 2 ? m.stripeRed : m.stripe);
    seg.position.set(-len / 2 + (i + 0.5) * (len / n), 22, 0);
    g.add(seg);
  }
  for (const px of [-len / 2, len / 2]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.2, 24, 8), m.pole);
    post.position.set(px, 12, 0);
    g.add(post);
  }
  g.position.set(x, 0, z);
  g.rotation.y = rotY + (d > w ? Math.PI / 2 : 0);
  parent.add(g);
}

export function railcar(parent: THREE.Object3D, m: Materials, x: number, z: number, w: number, d: number): void {
  const g = new THREE.Group();
  const long = Math.max(w, d), short = Math.min(w, d);
  const body = new THREE.Mesh(new RoundedBoxGeometry(long - 8, 34, short - 6, 2, 2), m.crate);
  body.position.y = 26;
  g.add(body);
  for (let i = 1; i < Math.floor(long / 10); i++) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(1.2, 30, short - 4), m.crate);
    rib.position.set(-long / 2 + i * 10, 26, 0);
    g.add(rib);
  }
  for (const px of [-long / 2 + 16, long / 2 - 16])
    for (const pz of [-short / 2 + 6, short / 2 - 6]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 3, 12), m.pole);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(px, 5, pz);
      g.add(wheel);
    }
  g.position.set(x, 0, z);
  if (d > w) g.rotation.y = Math.PI / 2;
  parent.add(g);
}

/** A cluster of low-poly bush blobs filling a tile. */
export function bushGeometries(x: number, z: number, size: number, seed: number): THREE.BufferGeometry[] {
  const r = rand(seed);
  const out: THREE.BufferGeometry[] = [];
  const n = 2 + Math.floor(r() * 2);
  for (let i = 0; i < n; i++) {
    const rad = size * (0.28 + r() * 0.18);
    const geo = new THREE.IcosahedronGeometry(rad, 1);
    geo.scale(1, 0.75 + r() * 0.35, 1);
    const pos = geo.attributes.position;
    for (let k = 0; k < pos.count; k++) pos.setXYZ(k, pos.getX(k) * (0.85 + r() * 0.3), pos.getY(k) * (0.85 + r() * 0.3), pos.getZ(k) * (0.85 + r() * 0.3));
    geo.computeVertexNormals();
    geo.translate(x + (r() - 0.5) * size * 0.5, rad * 0.55, z + (r() - 0.5) * size * 0.5);
    out.push(geo);
  }
  return out;
}

// ---------------------------------------------------------------- tanks
export interface TankModel {
  root: THREE.Group;
  turret: THREE.Group;
  barrel: THREE.Group;
  beam: THREE.Mesh;
  wheels: THREE.Mesh[];
  materials: THREE.MeshStandardMaterial[];
}

function hullGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-24, 5);
  s.lineTo(19, 5);
  s.lineTo(27, 10.5);
  s.lineTo(17, 17);
  s.lineTo(-22, 17);
  s.lineTo(-26, 11);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 24, bevelEnabled: true, bevelThickness: 1.6, bevelSize: 1.4, bevelSegments: 3, curveSegments: 4 });
  g.translate(0, 0, -12);
  g.computeVertexNormals();
  return g;
}

function turretGeometry(team: 0 | 1): THREE.BufferGeometry {
  const s = new THREE.Shape();
  if (team === 0) {
    s.moveTo(15, 0);
    s.lineTo(9, 10);
    s.lineTo(-8, 11.5);
    s.lineTo(-14, 7);
    s.lineTo(-14, -7);
    s.lineTo(-8, -11.5);
    s.lineTo(9, -10);
  } else {
    // Rustguard: boxier, hexagonal turret (team identity is never colour-only)
    s.moveTo(13, 6);
    s.lineTo(13, -6);
    s.lineTo(6, -12);
    s.lineTo(-13, -12);
    s.lineTo(-13, 12);
    s.lineTo(6, 12);
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 6, bevelEnabled: true, bevelThickness: 2.4, bevelSize: 2.2, bevelSegments: 3 });
  g.rotateX(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

export function buildTank(scene: THREE.Scene, team: 0 | 1, beamMat: THREE.Material): TankModel {
  const paint = proc(new THREE.MeshStandardMaterial({ color: team === 0 ? 0x5f95a8 : 0xa8664a, roughness: 0.55, metalness: 0.25 }), Surface.Paint, { scale: 0.14, bump: 0.35 });
  const steel = proc(new THREE.MeshStandardMaterial({ color: 0x2a2d2e, roughness: 0.6, metalness: 0.7 }), Surface.Paint, { scale: 0.2, bump: 0.3 });
  const trackMat = proc(new THREE.MeshStandardMaterial({ color: 0x1d1f20, roughness: 0.85, metalness: 0.4 }), Surface.Track, { scale: 0.3, bump: 0.6 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x141515, roughness: 0.9 });
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 4.6, 3.6) });

  const root = new THREE.Group();
  root.add(new THREE.Mesh(hullGeometry(), paint));
  const wheels: THREE.Mesh[] = [];
  for (const z of [-15.5, 15.5]) {
    const track = new THREE.Mesh(new RoundedBoxGeometry(54, 10, 8, 2, 3.5), trackMat);
    track.position.set(0, 5.5, z);
    root.add(track);
    for (let i = 0; i < 5; i++) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 2, 14), rubber);
      w.rotation.x = Math.PI / 2;
      w.position.set(-19 + i * 9.5, 5, z + Math.sign(z) * 4.3);
      root.add(w);
      wheels.push(w);
    }
    const fender = new THREE.Mesh(new RoundedBoxGeometry(56, 1.6, 10, 1, 0.7), paint);
    fender.position.set(0, 12, z);
    root.add(fender);
    const box = new THREE.Mesh(new RoundedBoxGeometry(14, 4, 7, 2, 1.2), steel);
    box.position.set(-12, 14.6, z * 0.9);
    root.add(box);
    if (team === 1) {
      // side skirts: Rustguard silhouette
      const skirt = new THREE.Mesh(new RoundedBoxGeometry(48, 7, 1.4, 1, 0.5), paint);
      skirt.position.set(2, 8, z + Math.sign(z) * 5.6);
      root.add(skirt);
    }
  }
  const grille = new THREE.Mesh(new RoundedBoxGeometry(12, 1.2, 16, 1, 0.5), steel);
  grille.position.set(-17, 18.4, 0);
  root.add(grille);
  for (const z of [-6, 6]) {
    const ex = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 4, 8), steel);
    ex.rotation.z = Math.PI / 2;
    ex.position.set(-27, 13, z);
    root.add(ex);
  }
  for (const z of [-9, 9]) {
    const hl = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 1.2, 10), lampMat);
    hl.rotation.z = Math.PI / 2 - 0.6;
    hl.position.set(23.4, 13.5, z);
    root.add(hl);
  }

  const turret = new THREE.Group();
  turret.position.set(-3, 18, 0);
  root.add(turret);
  turret.add(new THREE.Mesh(turretGeometry(team), paint));
  const hatch = new THREE.Mesh(new THREE.CylinderGeometry(4, 4.4, 2.2, 14), steel);
  hatch.position.set(-3, 9.6, 4);
  turret.add(hatch);
  const sight = new THREE.Mesh(new RoundedBoxGeometry(4, 3, 3, 1, 0.8), steel);
  sight.position.set(5, 9.5, -5);
  turret.add(sight);
  const bustle = new THREE.Mesh(new RoundedBoxGeometry(6, 5, 18, 2, 1.2), steel);
  bustle.position.set(-17, 4, 0);
  turret.add(bustle);
  for (const z of [-1, 1])
    for (let i = 0; i < 3; i++) {
      const sm = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 4, 8), steel);
      sm.rotation.x = Math.PI / 2 - z * 0.5;
      sm.rotation.z = -0.4;
      sm.position.set(4 + i * 2.3, 6, z * 12.5);
      turret.add(sm);
    }
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 34, 4), steel);
  antenna.position.set(-11, 22, -7);
  antenna.rotation.z = 0.15;
  turret.add(antenna);

  const barrel = new THREE.Group();
  barrel.position.set(14, 4.5, 0);
  turret.add(barrel);
  const mantlet = new THREE.Mesh(new RoundedBoxGeometry(6, 6, 9, 2, 1.8), paint);
  mantlet.position.set(1, 0, 0);
  barrel.add(mantlet);
  for (const [len, rad0, rad1, px] of [
    [34, 1.5, 1.9, 19],
    [10, 2.3, 2.3, 14],
    [4, 2.4, 2.4, 36],
  ] as const) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(rad0, rad1, len, 12), steel);
    t.rotation.z = -Math.PI / 2;
    t.position.set(px, 0, 0);
    barrel.add(t);
  }
  shadowed(root);

  // The headlight itself is not part of the model: see `Headlights` in fx.ts.
  const beam = new THREE.Mesh(new THREE.ConeGeometry(64, 200, 24, 1, true), beamMat);
  beam.rotation.z = Math.PI / 2;
  beam.position.set(122, 12, 0);
  root.add(beam);
  scene.add(root);
  return { root, turret, barrel, beam, wheels, materials: [paint, steel, trackMat] };
}

/**
 * Static batching: bake every opaque mesh under `root` into world space and merge the ones that
 * share a material into one draw. Lights, sprites and instanced meshes move to the scene unchanged.
 */
export function mergeStatic(root: THREE.Object3D, scene: THREE.Scene): void {
  root.updateMatrixWorld(true);
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const keep: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o === root) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && !(m as THREE.InstancedMesh).isInstancedMesh && !Array.isArray(m.material) && !m.material.transparent) {
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position!.count * 2), 2));
      g.morphAttributes = {};
      const list = byMat.get(m.material) ?? [];
      list.push(g);
      byMat.set(m.material, list);
    } else if (o.type !== 'Group' && !(o.parent && o.parent !== root && keep.includes(o.parent))) keep.push(o);
  });
  for (const o of keep) scene.attach(o);
  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    geos.forEach((g) => g.dispose());
  }
}
