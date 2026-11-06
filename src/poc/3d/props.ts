// Procedurally modelled props for the 3D PoC: walls, buildings, lamps, set dressing and tanks.
// Everything is bevelled (RoundedBoxGeometry / ExtrudeGeometry with bevel) so edges catch light,
// and every material goes through the procedural detail layer in materials.ts.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LAMPS, LAMP_HEIGHT, RECTS, YARD } from '../shared';
import { Surface, proc } from './materials';

export function rand(seed: number): () => number {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

function shadowed<T extends THREE.Object3D>(o: T, cast = true, receive = true): T {
  o.traverse((c) => {
    c.castShadow = cast;
    c.receiveShadow = receive;
  });
  return o;
}

function canvasTexture(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export const radialTexture = canvasTexture(128, 128, (ctx) => {
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
}, false);

// ---------- walls: Berlin "Grenzmauer"-style slabs with an L foot and a pipe cap ----------
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
      ctx.strokeStyle = tags[Math.floor(r() * tags.length)];
      ctx.lineWidth = 5 + r() * 10;
      ctx.beginPath();
      let x = 20 + r() * 60, y = 120 + r() * 80;
      ctx.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        const nx = x + 15 + r() * 40, ny = 90 + r() * 120;
        ctx.quadraticCurveTo((x + nx) / 2, ny - 60 + r() * 120, nx, ny);
        x = nx;
        y = ny;
      }
      ctx.stroke();
    }
  });
}

export function buildWalls(scene: THREE.Object3D): void {
  const variants = [1, 2, 3, 4].map((s) => proc(new THREE.MeshStandardMaterial({ map: graffitiTexture(s * 97), roughness: 0.92 }), Surface.Concrete, { scale: 0.07, bump: 0.8 }));
  const plain = proc(new THREE.MeshStandardMaterial({ color: 0xbfbcb1, roughness: 0.92 }), Surface.Concrete, { scale: 0.07, bump: 0.8 });
  const capMat = proc(new THREE.MeshStandardMaterial({ color: 0xc9c7bc, roughness: 0.8 }), Surface.Concrete, { scale: 0.1, bump: 0.4 });
  const r = rand(5);
  for (const w of RECTS.filter((x) => x.kind === 'wall')) {
    const horiz = w.w > w.h;
    const len = horiz ? w.w : w.h;
    const thick = horiz ? w.h : w.w;
    const n = Math.round(len / 40);
    const slabLen = len / n;
    const group = new THREE.Group();
    for (let i = 0; i < n; i++) {
      const off = -len / 2 + (i + 0.5) * slabLen;
      const h = w.height - 10;
      const mat = r() < 0.55 ? variants[Math.floor(r() * variants.length)] : plain;
      const slab = new THREE.Mesh(new RoundedBoxGeometry(slabLen - 1.5, h, thick * 0.55, 2, 1.6), mat);
      slab.position.set(off, h / 2, -thick * 0.2);
      // L-shaped foot that stops the slab tipping over (as on the real wall)
      const foot = new THREE.Mesh(new RoundedBoxGeometry(slabLen - 1.5, 7, thick, 2, 1.5), plain);
      foot.position.set(off, 3.5, 0);
      slab.rotation.z = (r() - 0.5) * 0.008;
      group.add(slab, foot);
    }
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, len, 16), capMat);
    cap.rotation.z = Math.PI / 2;
    cap.position.set(0, w.height - 6, -thick * 0.2);
    group.add(cap);
    group.position.set(w.x + w.w / 2, 0, w.y + w.h / 2);
    if (!horiz) group.rotation.y = Math.PI / 2;
    scene.add(shadowed(group));
  }
}

// ---------- buildings, inside and around the yard ----------
const OUTER: { x: number; y: number; w: number; h: number; height: number }[] = [
  { x: -320, y: 40, w: 230, h: 340, height: 230 },
  { x: -300, y: 470, w: 210, h: 420, height: 170 },
  { x: 120, y: -330, w: 420, h: 220, height: 260 },
  { x: 700, y: -300, w: 330, h: 200, height: 190 },
  { x: 1660, y: 120, w: 260, h: 380, height: 210 },
  { x: 1680, y: 600, w: 240, h: 300, height: 150 },
  { x: 300, y: 990, w: 380, h: 220, height: 180 },
  { x: 900, y: 1000, w: 420, h: 220, height: 240 },
];

export function buildBuildings(scene: THREE.Object3D): void {
  const wallMat = proc(new THREE.MeshStandardMaterial({ color: 0x5d6461, roughness: 0.9 }), Surface.Concrete, { scale: 0.05 });
  const wallMat2 = proc(new THREE.MeshStandardMaterial({ color: 0x6e6457, roughness: 0.9 }), Surface.Concrete, { scale: 0.05 });
  const roofMat = proc(new THREE.MeshStandardMaterial({ color: 0x2f3433, roughness: 0.95 }), Surface.Tar, { scale: 0.06 });
  const metalMat = proc(new THREE.MeshStandardMaterial({ color: 0x6d726f, roughness: 0.5, metalness: 0.6 }), Surface.Rust, { scale: 0.12 });
  const winGeo = new THREE.PlaneGeometry(12, 16);
  const wins: { m: THREE.Matrix4; c: THREE.Color }[] = [];
  const r = rand(21);
  const all = [...RECTS.filter((b) => b.kind === 'building').map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, height: b.height })), ...OUTER];
  all.forEach((b, bi) => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new RoundedBoxGeometry(b.w, b.height, b.h, 2, 2), bi % 2 ? wallMat2 : wallMat);
    body.position.y = b.height / 2;
    const roof = new THREE.Mesh(new RoundedBoxGeometry(b.w - 10, 3, b.h - 10, 2, 1), roofMat);
    roof.position.y = b.height + 0.5;
    g.add(body, roof);
    // parapet
    for (const [px, pz, pw, pd] of [
      [0, b.h / 2 - 2, b.w, 4],
      [0, -b.h / 2 + 2, b.w, 4],
      [b.w / 2 - 2, 0, 4, b.h],
      [-b.w / 2 + 2, 0, 4, b.h],
    ]) {
      const p = new THREE.Mesh(new RoundedBoxGeometry(pw, 8, pd, 1, 1), bi % 2 ? wallMat2 : wallMat);
      p.position.set(px, b.height + 4, pz);
      g.add(p);
    }
    // rooftop clutter: AC units, vents
    const n = 2 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const s = 14 + r() * 18;
      const ac = new THREE.Mesh(new RoundedBoxGeometry(s, 8 + r() * 8, s * 0.8, 2, 1.5), metalMat);
      ac.position.set((r() - 0.5) * (b.w - 50), b.height + 6, (r() - 0.5) * (b.h - 50));
      g.add(ac);
    }
    g.position.set(b.x + b.w / 2, 0, b.y + b.h / 2);
    scene.add(shadowed(g));
    // windows on all four faces
    const floors = Math.floor((b.height - 20) / 34);
    const faces: [number, number, number, number][] = [
      [0, b.h / 2 + 0.3, 0, b.w],
      [0, -b.h / 2 - 0.3, Math.PI, b.w],
      [b.w / 2 + 0.3, 0, Math.PI / 2, b.h],
      [-b.w / 2 - 0.3, 0, -Math.PI / 2, b.h],
    ];
    for (const [fx, fz, rot, span] of faces) {
      const cols = Math.floor((span - 20) / 30);
      for (let f = 0; f < floors; f++)
        for (let c = 0; c < cols; c++) {
          const along = -span / 2 + 25 + c * ((span - 50) / Math.max(1, cols - 1));
          const pos = new THREE.Vector3(fx, 22 + f * 34, fz);
          if (rot === 0 || rot === Math.PI) pos.x += along;
          else pos.z += along;
          pos.add(g.position);
          const m = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(1, 1, 1));
          const lit = r() < 0.28;
          const c2 = lit ? new THREE.Color(2.4, 1.35, 0.55).multiplyScalar(0.6 + r() * 0.8) : new THREE.Color(0.02, 0.025, 0.03);
          wins.push({ m, c: c2 });
        }
    }
  });
  const winMesh = new THREE.InstancedMesh(winGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), wins.length);
  wins.forEach((w, i) => {
    winMesh.setMatrixAt(i, w.m);
    winMesh.setColorAt(i, w.c);
  });
  scene.add(winMesh);
}

// ---------- streetlamps ----------
export interface LampView { light: THREE.SpotLight; glow: THREE.Sprite; bulb: THREE.Mesh; x: number; z: number }
export function buildLamps(scene: THREE.Object3D): LampView[] {
  const poleMat = proc(new THREE.MeshStandardMaterial({ color: 0x3a403d, roughness: 0.55, metalness: 0.7 }), Surface.Paint, { scale: 0.2 });
  const out: LampView[] = [];
  for (const l of LAMPS) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(2, 3.2, LAMP_HEIGHT + 6, 10), poleMat);
    pole.position.set(-18, (LAMP_HEIGHT + 6) / 2, 0);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(5, 6, 8, 10), poleMat);
    base.position.set(-18, 4, 0);
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-18, LAMP_HEIGHT + 4, 0), new THREE.Vector3(-17, LAMP_HEIGHT + 14, 0), new THREE.Vector3(0, LAMP_HEIGHT + 4, 0));
    const arm = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 1.6, 6), poleMat);
    const head = new THREE.Mesh(new RoundedBoxGeometry(16, 5, 9, 2, 2), poleMat);
    head.position.set(0, LAMP_HEIGHT + 2, 0);
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(11, 1, 5), new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 4.4, 1.6) }));
    bulb.position.set(0, LAMP_HEIGHT - 0.6, 0);
    g.add(pole, base, arm, head);
    shadowed(g);
    g.add(bulb);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture, color: new THREE.Color(1.6, 0.85, 0.35), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    glow.scale.setScalar(70);
    glow.position.set(0, LAMP_HEIGHT - 4, 0);
    g.add(glow);
    g.position.set(l.x, 0, l.y);
    scene.add(g);
    const s = new THREE.SpotLight(0xffa64d, 320000, 700, 1.1, 0.8, 2);
    s.position.set(l.x, LAMP_HEIGHT - 3, l.y);
    s.target.position.set(l.x, 0, l.y);
    s.shadow.mapSize.set(1024, 1024);
    s.shadow.bias = -0.0006;
    s.shadow.normalBias = 0.6;
    s.shadow.camera.near = 8;
    s.castShadow = true;
    scene.add(s, s.target);
    out.push({ light: s, glow, bulb, x: l.x, z: l.y });
  }
  return out;
}

// ---------- set dressing ----------
export function buildDressing(scene: THREE.Object3D): void {
  const crateMat = proc(new THREE.MeshStandardMaterial({ color: 0x55603f, roughness: 0.55, metalness: 0.5 }), Surface.Rust, { scale: 0.09 });
  const barrelMat = proc(new THREE.MeshStandardMaterial({ color: 0x3f5a6a, roughness: 0.5, metalness: 0.55 }), Surface.Rust, { scale: 0.12 });
  const barrelMat2 = proc(new THREE.MeshStandardMaterial({ color: 0x8a3a26, roughness: 0.5, metalness: 0.55 }), Surface.Rust, { scale: 0.12 });
  const sandMat = proc(new THREE.MeshStandardMaterial({ color: 0x7d7158, roughness: 0.98 }), Surface.Concrete, { scale: 0.25, bump: 1.2, wear: 0 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x151617, roughness: 0.85 });
  const kerbMat = proc(new THREE.MeshStandardMaterial({ color: 0x8c8a80, roughness: 0.9 }), Surface.Concrete, { scale: 0.1 });

  // shipping-container style crates with corrugation ribs
  for (const b of RECTS.filter((x) => x.kind === 'crate')) {
    const g = new THREE.Group();
    const box = new THREE.Mesh(new RoundedBoxGeometry(b.w, b.height, b.h, 2, 2), crateMat);
    box.position.y = b.height / 2;
    g.add(box);
    const long = b.w >= b.h;
    const len = long ? b.w : b.h;
    for (let i = 1; i < Math.floor(len / 8); i++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(long ? 1.2 : b.w + 1.2, b.height - 6, long ? b.h + 1.2 : 1.2), crateMat);
      rib.position.set(long ? -len / 2 + i * 8 : 0, b.height / 2, long ? 0 : -len / 2 + i * 8);
      g.add(rib);
    }
    g.position.set(b.x + b.w / 2, 0, b.y + b.h / 2);
    scene.add(shadowed(g));
  }

  const r = rand(77);
  const barrel = (x: number, z: number, tipped = false) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 22, 16), r() < 0.5 ? barrelMat : barrelMat2);
    if (tipped) {
      m.rotation.z = Math.PI / 2;
      m.rotation.y = r() * 3;
      m.position.set(x, 7, z);
    } else m.position.set(x, 11, z);
    for (const y of [-6, 6]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(7.1, 0.7, 6, 18), m.material);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      m.add(ring);
    }
    scene.add(shadowed(m));
  };
  for (const [x, z] of [[1232, 112], [1236, 131], [1219, 124], [1240, 152], [340, 604], [338, 622], [700, 590], [1078, 790]]) barrel(x, z);
  barrel(352, 640, true);
  barrel(1205, 150, true);

  const tires = (x: number, z: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(8, 3.4, 8, 18), tireMat);
      t.rotation.x = Math.PI / 2;
      t.position.set(x + (r() - 0.5) * 2, 3.4 + i * 6.4, z + (r() - 0.5) * 2);
      scene.add(shadowed(t));
    }
  };
  tires(590, 640, 3);
  tires(1010, 450, 2);

  // sandbag walls
  const bags = (x: number, z: number, len: number, rot: number) => {
    const g = new THREE.Group();
    for (let row = 0; row < 3; row++)
      for (let i = 0; i < len; i++) {
        const b = new THREE.Mesh(new RoundedBoxGeometry(13, 6, 8, 2, 2.6), sandMat);
        b.position.set(i * 12.5 - (len * 12.5) / 2 + (row % 2) * 6, 3 + row * 5.6, 0);
        b.rotation.y = (r() - 0.5) * 0.2;
        g.add(b);
      }
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    scene.add(shadowed(g));
  };
  bags(500, 410, 5, 0.2);
  bags(1230, 330, 4, Math.PI / 2);

  // kerb around the yard
  for (const [x, z, w, d] of [
    [YARD.w / 2, -6, YARD.w + 24, 12],
    [YARD.w / 2, YARD.h + 6, YARD.w + 24, 12],
    [-6, YARD.h / 2, 12, YARD.h],
    [YARD.w + 6, YARD.h / 2, 12, YARD.h],
  ]) {
    const k = new THREE.Mesh(new RoundedBoxGeometry(w, 6, d, 2, 2), kerbMat);
    k.position.set(x, 3, z);
    scene.add(shadowed(k));
  }
}

// ---------- tanks ----------
export interface TankView {
  root: THREE.Group;
  turret: THREE.Group;
  barrel: THREE.Group;
  head: THREE.SpotLight;
  beam: THREE.Mesh;
  wheels: THREE.Mesh[];
}

/** Side profile extruded with a bevel: a sloped glacis, a sloped rear plate, rounded edges. */
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

/** Top-view outline of an angular turret, extruded upward with a heavy bevel. */
function turretGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(15, 0);
  s.lineTo(9, 10);
  s.lineTo(-8, 11.5);
  s.lineTo(-14, 7);
  s.lineTo(-14, -7);
  s.lineTo(-8, -11.5);
  s.lineTo(9, -10);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 6, bevelEnabled: true, bevelThickness: 2.4, bevelSize: 2.2, bevelSegments: 3 });
  g.rotateX(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

export function buildTank(scene: THREE.Object3D, team: 0 | 1, beamMat: THREE.ShaderMaterial): TankView {
  const paint = proc(new THREE.MeshStandardMaterial({ color: team === 0 ? 0x5f95a8 : 0xa8664a, roughness: 0.55, metalness: 0.25 }), Surface.Paint, { scale: 0.14, bump: 0.35 });
  const steel = proc(new THREE.MeshStandardMaterial({ color: 0x2a2d2e, roughness: 0.6, metalness: 0.7 }), Surface.Paint, { scale: 0.2, bump: 0.3 });
  const trackMat = proc(new THREE.MeshStandardMaterial({ color: 0x1d1f20, roughness: 0.85, metalness: 0.4 }), Surface.Track, { scale: 0.3, bump: 0.6 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x141515, roughness: 0.9 });
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 4.6, 3.6) });

  const root = new THREE.Group();
  const hull = new THREE.Mesh(hullGeometry(), paint);
  root.add(hull);
  // tracks, road wheels, fenders
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
  }
  // engine deck grille + exhausts
  const grille = new THREE.Mesh(new RoundedBoxGeometry(12, 1.2, 16, 1, 0.5), steel);
  grille.position.set(-17, 18.4, 0);
  root.add(grille);
  for (const z of [-6, 6]) {
    const ex = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 4, 8), steel);
    ex.rotation.z = Math.PI / 2;
    ex.position.set(-27, 13, z);
    root.add(ex);
  }
  // headlights on the glacis
  for (const z of [-9, 9]) {
    const hl = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 1.2, 10), lampMat);
    hl.rotation.z = Math.PI / 2 - 0.6;
    hl.position.set(23.4, 13.5, z);
    root.add(hl);
  }

  const turret = new THREE.Group();
  turret.position.set(-3, 18, 0);
  root.add(turret);
  const tbody = new THREE.Mesh(turretGeometry(), paint);
  turret.add(tbody);
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
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.9, 34, 12), steel);
  tube.rotation.z = -Math.PI / 2;
  tube.position.set(19, 0, 0);
  barrel.add(tube);
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 10, 12), steel);
  sleeve.rotation.z = -Math.PI / 2;
  sleeve.position.set(14, 0, 0);
  barrel.add(sleeve);
  const brake = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 4, 10), steel);
  brake.rotation.z = -Math.PI / 2;
  brake.position.set(36, 0, 0);
  barrel.add(brake);

  shadowed(root);

  const head = new THREE.SpotLight(0xfff0cf, 220000, 520, 0.5, 0.6, 2);
  head.position.set(24, 13, 0);
  head.target.position.set(160, 0, 0);
  head.castShadow = false;
  root.add(head, head.target);
  const beam = new THREE.Mesh(new THREE.ConeGeometry(64, 200, 24, 1, true), beamMat);
  beam.rotation.z = Math.PI / 2;
  beam.position.set(122, 12, 0);
  root.add(beam);
  scene.add(root);
  return { root, turret, barrel, head, beam, wheels };
}

/**
 * Static batching: bake every opaque mesh under `root` into world space and merge the ones that share
 * a material into a single draw. Lights, sprites, instanced meshes and helper objects are moved to the
 * scene unchanged. Cuts thousands of draw calls (x every shadow map) down to a few dozen.
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
      g.morphAttributes = {};
      const list = byMat.get(m.material) ?? [];
      list.push(g);
      byMat.set(m.material, list);
    } else if (o.type !== 'Group' && !(o.parent && o.parent !== root && keep.includes(o.parent))) {
      keep.push(o);
    }
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
