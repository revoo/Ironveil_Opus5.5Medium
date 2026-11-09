// Build the static 3D world from a Level: ground, walls/buildings from wall tiles, brush, lamps,
// props and an outer ring of city blocks. Gameplay geometry stays the simulation's tile grid;
// this only dresses it.
import * as THREE from 'three';
import { Terrain, tileAt } from '../../sim/map';
import type { Level } from '../../level/load';
import { procUniforms } from './materials';
import { dressBooth, dressBuilding } from './signs';
import { barrel, barrier, building, bushGeometries, lamp, makeMaterials, mergeStatic, rand, railcar, wallRun, windowsMesh, type LampView, type WindowInstance } from './models';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export interface BuiltWorld {
  lamps: LampView[];
  ground: THREE.Mesh;
  width: number;
  height: number;
}

const MARGIN = 900;

/** Terrain weights per tile as a texture: R road, G mud, B brush, A wall (grass = the rest). */
function terrainTexture(level: Level): THREE.DataTexture {
  const { map } = level;
  const data = new Uint8Array(map.cols * map.rows * 4);
  for (let r = 0; r < map.rows; r++)
    for (let c = 0; c < map.cols; c++) {
      const t = tileAt(map, c, r);
      const i = ((map.rows - 1 - r) * map.cols + c) * 4; // flipY: row 0 at the top of the texture
      data[i] = t === Terrain.Road ? 255 : 0;
      data[i + 1] = t === Terrain.Mud ? 255 : 0;
      data[i + 2] = t === Terrain.Brush ? 255 : 0;
      data[i + 3] = t === Terrain.Wall ? 255 : 0;
    }
  const tex = new THREE.DataTexture(data, map.cols, map.rows, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const GROUND_GLSL = /* glsl */ `
uniform sampler2D uTerrain;
uniform vec2 uMapSize;
uniform float uProcOn;
varying vec3 vGW;
float gh(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float gn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gh(i), gh(i + vec2(1, 0)), u.x), mix(gh(i + vec2(0, 1)), gh(i + vec2(1, 1)), u.x), u.y); }
float gfbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * gn(p); p = p * 2.03 + 1.7; a *= 0.5; } return s; }
// Offset-row cobblestones: x = stone height (0 in the gaps), y = per-stone random.
vec2 cobble(vec2 p) {
  vec2 cs = vec2(9.0, 7.0);
  float row = floor(p.y / cs.y);
  vec2 q = vec2(p.x + mod(row, 2.0) * cs.x * 0.5, p.y);
  vec2 cell = floor(q / cs);
  vec2 f = q - (cell + 0.5) * cs;
  vec2 d2 = abs(f) - (cs * 0.5 - 1.5);
  float d = length(max(d2, 0.0)) + min(max(d2.x, d2.y), 0.0) - 1.0;
  return vec2(smoothstep(0.8, -1.4, d) * (0.7 + 0.3 * gh(cell)), gh(cell + 7.0));
}
vec4 weights(vec2 p) {
  vec2 uv = vec2(p.x / uMapSize.x, 1.0 - p.y / uMapSize.y);
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec4(0.0, 0.0, 0.0, 0.25);
  // jitter the lookup a little so tile borders wobble instead of running dead straight
  vec2 j = (vec2(gn(p * 0.09), gn(p * 0.09 + 5.0)) - 0.5) * 9.0 / uMapSize;
  return texture2D(uTerrain, uv + j);
}
float groundHeight(vec2 p, vec4 w) {
  float grass = gfbm(p * 0.25) * 0.6;
  float road = cobble(p).x;
  float mud = gfbm(p * 0.08) * 0.4;
  return mix(grass, road * 1.4, w.r) * (1.0 - w.g) + mud * w.g;
}
`;

function groundMaterial(level: Level): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  const tex = terrainTexture(level);
  const size = new THREE.Vector2(level.map.width, level.map.height);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTerrain = { value: tex };
    sh.uniforms.uMapSize = { value: size };
    sh.uniforms.uProcOn = procUniforms.uProcOn;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GROUND_GLSL)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        vec2 P = vGW.xz;
        vec4 W = weights(P);
        vec2 cb = cobble(P);
        float n1 = gfbm(P * 0.02), n2 = gfbm(P * 0.11 + 3.0);
        vec3 grass = mix(vec3(0.085, 0.13, 0.095), vec3(0.15, 0.19, 0.12), n1) * (0.85 + 0.3 * n2);
        grass = mix(grass, vec3(0.16, 0.14, 0.10), smoothstep(0.55, 0.75, gfbm(P * 0.013 + 9.0)) * 0.6); // worn dirt
        vec3 stone = mix(vec3(0.30, 0.29, 0.26), vec3(0.42, 0.40, 0.35), cb.y);
        vec3 road = mix(vec3(0.07, 0.08, 0.06), stone, smoothstep(0.05, 0.4, cb.x));
        road *= 0.85 + 0.25 * n1;
        vec3 mud = mix(vec3(0.12, 0.09, 0.06), vec3(0.2, 0.15, 0.1), n2);
        vec3 brushG = grass * 0.7;
        vec3 conc = vec3(0.3, 0.3, 0.28) * (0.8 + 0.3 * n2);
        vec3 c = grass;
        c = mix(c, road, W.r);
        c = mix(c, mud, W.g);
        c = mix(c, brushG, W.b);
        c = mix(c, conc, W.a);
        float puddle = smoothstep(0.55, 0.62, gfbm(P * 0.0065 + 3.1)) * (W.r + W.g * 1.4);
        float wet = clamp(puddle + W.g * 0.35, 0.0, 1.0);
        c = mix(c, c * 0.45, puddle);
        diffuseColor.rgb = c;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.95, 0.75 + 0.2 * (1.0 - cb.x), W.r);
        roughnessFactor = mix(roughnessFactor, 0.4, W.g);
        roughnessFactor = mix(roughnessFactor, 0.06, puddle);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        if (uProcOn > 0.5) {
          float e = 0.6;
          float h0 = groundHeight(P, W);
          vec3 g = vec3(groundHeight(P + vec2(e, 0.0), W) - h0, 0.0, groundHeight(P + vec2(0.0, e), W) - h0) / e;
          vec3 gv = mat3(viewMatrix) * g;
          gv -= dot(gv, normal) * normal;
          normal = normalize(normal - gv * 1.3 * (1.0 - puddle));
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'ironveil-ground';
  return mat;
}

interface Rect {
  c: number;
  r: number;
  w: number;
  h: number;
}

/** Greedy decomposition of wall tiles into rectangles (long runs first). */
function wallRects(level: Level): Rect[] {
  const { map } = level;
  const used = new Uint8Array(map.cols * map.rows);
  const isWall = (c: number, r: number) => c >= 0 && r >= 0 && c < map.cols && r < map.rows && tileAt(map, c, r) === Terrain.Wall && !used[r * map.cols + c];
  const out: Rect[] = [];
  for (let r = 0; r < map.rows; r++)
    for (let c = 0; c < map.cols; c++) {
      if (!isWall(c, r)) continue;
      // Prefer whichever direction gives the longer run, so wall lines stay single pieces.
      let w = 1;
      while (isWall(c + w, r)) w++;
      let hRun = 1;
      while (isWall(c, r + hRun)) hRun++;
      let rect: Rect;
      if (hRun > w) {
        let w2 = 1;
        outer: for (; ; w2++) for (let y = r; y < r + hRun; y++) if (!isWall(c + w2, y)) break outer;
        rect = { c, r, w: w2, h: hRun };
      } else {
        let h2 = 1;
        outer2: for (; ; h2++) for (let x = c; x < c + w; x++) if (!isWall(x, r + h2)) break outer2;
        rect = { c, r, w, h: h2 };
      }
      for (let y = rect.r; y < rect.r + rect.h; y++) for (let x = rect.c; x < rect.c + rect.w; x++) used[y * map.cols + x] = 1;
      out.push(rect);
    }
  return out;
}

export function buildWorld(scene: THREE.Scene, level: Level): BuiltWorld {
  const { map } = level;
  const T = map.tile;
  const m = makeMaterials();
  const staticRoot = new THREE.Group();

  // ---- ground
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(map.width + MARGIN * 2, map.height + MARGIN * 2), groundMaterial(level));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(map.width / 2, 0, map.height / 2);
  ground.receiveShadow = true;
  scene.add(ground);

  // ---- walls and buildings from the tile grid
  const wins: WindowInstance[] = [];
  let seed = 11;
  for (const rc of wallRects(level)) {
    const x = (rc.c + rc.w / 2) * T, z = (rc.r + rc.h / 2) * T;
    const w = rc.w * T, d = rc.h * T;
    seed += 7;
    if (rc.w === 1 || rc.h === 1) {
      const horiz = rc.w >= rc.h;
      wallRun(staticRoot, m, x, z, horiz ? w : d, T * 0.8, horiz, 70, seed);
    } else if (rc.w * rc.h <= 4) {
      building(staticRoot, m, x, z, w - 4, d - 4, 38, seed, wins); // guard booth / bunker
      dressBooth(staticRoot, x, z, w - 4, d - 4, seed);
    } else {
      const h = 80 + Math.floor(rand(seed)() * 7) * 16;
      building(staticRoot, m, x, z, w - 2, d - 2, h, seed, wins);
      dressBuilding(staticRoot, x, z, w - 2, d - 2, h, seed);
    }
  }

  // ---- city blocks outside the playable area (atmosphere only)
  const r = rand(4242);
  const ring = (x0: number, z0: number, x1: number, z1: number) => {
    let along = 0;
    const horiz = x1 - x0 > z1 - z0;
    const len = horiz ? x1 - x0 : z1 - z0;
    while (along < len - 60) {
      const bw = 140 + r() * 220;
      const bd = 160 + r() * 200;
      const h = 120 + r() * 160;
      const gap = 30 + r() * 70;
      const cx = horiz ? x0 + along + bw / 2 : x0 + (r() - 0.5) * 60;
      const cz = horiz ? z0 + (r() - 0.5) * 60 : z0 + along + bw / 2;
      building(staticRoot, m, cx, cz, horiz ? bw : bd, horiz ? bd : bw, h, Math.floor(r() * 9999), wins);
      along += bw + gap;
    }
  };
  ring(-MARGIN * 0.6, -220, map.width + MARGIN * 0.6, -220);
  ring(-MARGIN * 0.6, map.height + 220, map.width + MARGIN * 0.6, map.height + 220);
  ring(-240, -100, -240, map.height + 100);
  ring(map.width + 240, -100, map.width + 240, map.height + 100);

  // ---- brush: low-poly bushes merged into two draws
  const bushA: THREE.BufferGeometry[] = [];
  const bushB: THREE.BufferGeometry[] = [];
  for (let rr = 0; rr < map.rows; rr++)
    for (let c = 0; c < map.cols; c++)
      if (tileAt(map, c, rr) === Terrain.Brush) bushGeometries((c + 0.5) * T, (rr + 0.5) * T, T, rr * 1000 + c).forEach((g, i) => ((i + c + rr) % 2 ? bushA : bushB).push(g));
  for (const [list, mat] of [
    [bushA, m.bush],
    [bushB, m.bush2],
  ] as const) {
    if (!list.length) continue;
    const mesh = new THREE.Mesh(mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)), false)!, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // ---- props from the level
  const lamps: LampView[] = [];
  let lampN = 0;
  level.data.props.forEach((p, i) => {
    const cx = p.x + p.w / 2, cz = p.y + p.h / 2;
    const rot = ((p.rotation ?? 0) * Math.PI) / 180;
    switch (p.kind.toLowerCase()) {
      case 'lamp':
        lamps.push(lamp(staticRoot, scene, m, cx, cz, lampN++ < 6, rot));
        break;
      case 'barrel':
        barrel(staticRoot, m, cx, cz, i * 31);
        break;
      case 'barrier':
        barrier(staticRoot, m, cx, cz, p.w, p.h, -rot);
        break;
      case 'railcar':
        railcar(staticRoot, m, cx, cz, p.w, p.h);
        break;
      default: {
        const box = new THREE.Mesh(new RoundedBoxGeometry(p.w, p.height ?? 20, p.h, 2, 1.5), m.crate);
        box.position.set(cx, (p.height ?? 20) / 2, cz);
        box.rotation.y = -rot;
        staticRoot.add(box);
      }
    }
  });

  staticRoot.add(windowsMesh(wins, m.window));
  mergeStatic(staticRoot, scene);
  return { lamps, ground, width: map.width, height: map.height };
}
