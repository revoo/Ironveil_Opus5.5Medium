// Procedural "AAA-style" surface detail, injected into Three's standard PBR shader.
//
// Instead of painting textures, each pixel evaluates *solid noise* at its world position
// (a 3D noise field, so there are no UV seams and no visible tiling) and layers on:
//   - edge wear: bevelled edges have normals that aren't axis-aligned in object space, so
//     1 - max(|n.x|, |n.y|, |n.z|) is ~0 on flat faces and > 0 on edges -> chipped paint / fresh concrete
//   - grime: dirt that accumulates near the ground (world height), broken up by noise
//   - rain streaks: vertical noise stretched along Y on vertical faces
//   - dust: lighter tone on upward-facing surfaces
//   - micro bump: the noise gradient tilts the normal, so light rakes across pitted concrete
import * as THREE from 'three';

/**
 * The lattice for every value-noise lookup in the surface, ground and mist shaders: 256x256 random
 * bytes, tiling, bilinear. One filtered fetch at a smoothstepped coordinate *is* 2D value noise;
 * for 3D noise the green channel holds the red one shifted by (37, 17), so the same fetch returns
 * two neighbouring z-slices to blend (Quilez). The arithmetic it replaces hashed 4 (2D) or 8 (3D)
 * lattice corners per octave: about 100 hashes per pixel on concrete, 90 on the ground.
 * Blue is a second, independent field.
 */
export const NOISE_SIZE = 256;
function buildNoiseTexture(): THREE.DataTexture {
  const n = NOISE_SIZE;
  let seed = 20261;
  const r = () => ((seed = (seed * 16807) % 2147483647) >>> 8) & 255;
  const red = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) red[i] = r();
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4;
      data[i] = red[y * n + x]!;
      data[i + 1] = red[((y + 17) % n) * n + ((x + 37) % n)]!;
      data[i + 2] = r();
      data[i + 3] = 255;
    }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Four octaves of value noise, summed and baked into one tiling texture, for the fields that vary
 * slowly across the screen (puddles, worn ground, the mist): one fetch instead of four, and smooth
 * on any GPU, since a texel is only a few pixels wide however far the player zooms in. (The lattice
 * texture above would be magnified hundreds of pixels per cell there, where the filter's 8-bit
 * weights start to show as steps.) Spans `FBM_CELLS` base cells per side, 16 texels per cell.
 */
export const FBM_CELLS = 32;
function buildFbmTexture(): THREE.DataTexture {
  const n = FBM_CELLS * 16;
  let seed = 7919;
  const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const sum = new Float32Array(n * n);
  for (let o = 0, amp = 0.5; o < 4; o++, amp *= 0.5) {
    const cells = FBM_CELLS << o; // lattice period = the texture, so it tiles
    const lat = new Float32Array(cells * cells);
    for (let i = 0; i < lat.length; i++) lat[i] = r();
    const k = cells / n;
    for (let y = 0; y < n; y++) {
      const fy = (y + 0.5) * k, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
      const r0 = (y0 % cells) * cells, r1 = ((y0 + 1) % cells) * cells;
      for (let x = 0; x < n; x++) {
        const fx = (x + 0.5) * k, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx);
        const c0 = x0 % cells, c1 = (x0 + 1) % cells;
        const a = lat[r0 + c0]! + (lat[r0 + c1]! - lat[r0 + c0]!) * sx;
        const b = lat[r1 + c0]! + (lat[r1 + c1]! - lat[r1 + c0]!) * sx;
        sum[y * n + x]! += amp * (a + (b - a) * sy);
      }
    }
  }
  const data = new Uint8Array(n * n);
  for (let i = 0; i < data.length; i++) data[i] = Math.round(sum[i]! * 255);
  const tex = new THREE.DataTexture(data, n, n, THREE.RedFormat);
  tex.unpackAlignment = 1;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export const procUniforms = {
  uProcOn: { value: 1 },
  uTime: { value: 0 },
  uNoise: { value: buildNoiseTexture() },
  uFbm: { value: buildFbmTexture() },
};

/** GLSL: baked 4-octave noise at `p` in base cells (declare `uniform sampler2D uFbm` first). */
export const FBM_GLSL = /* glsl */ `
float fbmSlow(vec2 p) { return texture2D(uFbm, p / ${FBM_CELLS}.0).r; }
`;

/** GLSL: 2D value noise from the shared lattice texture (declare `uniform sampler2D uNoise` first). */
export const NOISE2D_GLSL = /* glsl */ `
float vnoise2(vec2 p) { vec2 i = floor(p), f = fract(p); return textureLod(uNoise, (i + f * f * (3.0 - 2.0 * f) + 0.5) / ${NOISE_SIZE}.0, 0.0).r; }
`;

// three.js runs the whole surface BRDF for every light on every pixel, in or out of its reach, and
// most of our lights are pooled: 12 spots and 3 point lights of which a pixel sees one or two.
// Lights that don't reach a pixel (outside the cone or range, or parked at intensity 0) already
// report `visible = false`; skipping them there changes nothing in the picture.
const RE_DIRECT = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
export const LIGHT_SKIP = `if ( directLight.visible ) { ${RE_DIRECT} }`;
if (!THREE.ShaderChunk.lights_fragment_begin.includes(LIGHT_SKIP))
  THREE.ShaderChunk.lights_fragment_begin = THREE.ShaderChunk.lights_fragment_begin.split(RE_DIRECT).join(LIGHT_SKIP);

export enum Surface {
  Concrete = 0,
  Paint = 1,
  Rust = 2,
  Tar = 3,
  // 4 was the PoC's cobble ground; the mission ground is its own shader in world.ts
  Track = 5,
}

const NOISE = /* glsl */ `
uniform float uProcOn;
uniform float uTime;
uniform sampler2D uNoise;
varying vec3 vWPos;
varying vec3 vONrm;
// 3D value noise in one fetch: red and green are two z-slices of the lattice (see buildNoiseTexture)
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  vec2 rg = textureLod(uNoise, (i.xy + vec2(37.0, 17.0) * i.z + f.xy + 0.5) / ${NOISE_SIZE}.0, 0.0).rg;
  return mix(rg.x, rg.y, f.z);
}
// Bump mapping from screen-space derivatives (Mikkelsen 2010), as three's bumpmap does.
vec3 procBump(vec3 n, float h, float faceDir) {
  vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * n - grad);
}
float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.07 + 7.3; a *= 0.5; } return s; }
`;

/**
 * Patch a MeshStandardMaterial with procedural detail for a given surface type.
 * `scale` sets the noise frequency (world units), `bump` the micro-normal strength.
 */
export function proc<T extends THREE.MeshStandardMaterial>(mat: T, surface: Surface, opts: { scale?: number; bump?: number; wear?: number } = {}): T {
  const scale = (opts.scale ?? 0.08).toFixed(4);
  const bump = (opts.bump ?? 0.6).toFixed(3);
  const wearK = (opts.wear ?? 1).toFixed(3);
  // height of the micro bump in world units, matching the old finite-difference strength
  const bumpK = (((opts.bump ?? 0.6) * 6 * 0.15) / ((opts.scale ?? 0.08) * 4.3)).toFixed(4);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uProcOn = procUniforms.uProcOn;
    sh.uniforms.uTime = procUniforms.uTime;
    sh.uniforms.uNoise = procUniforms.uNoise;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vONrm;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec4 ip = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            ip = instanceMatrix * ip;
          #endif
          vWPos = (modelMatrix * ip).xyz;
          vONrm = normal;
        }`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + NOISE)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        vec3 P = vWPos * ${scale};
        vec3 an = abs(normalize(vONrm));
        float edge = smoothstep(0.04, 0.22, 1.0 - max(an.x, max(an.y, an.z)));
        float n1 = 0.5, n2 = 0.5;
        float wear = 0.0, grime = 0.0, wet = 0.0, rust = 0.0;
        if (uProcOn > 0.5) {
          n1 = fbm(P);
          n2 = fbm(P * 4.3 + 11.0);
          grime = (1.0 - smoothstep(0.0, 26.0, vWPos.y)) * smoothstep(0.3, 0.7, n1);
          wear = edge * smoothstep(0.35, 0.6, n2) * ${wearK};
          vec3 c = diffuseColor.rgb;
          #if ${surface} == 0
            c *= 0.8 + 0.35 * n1;
            c *= 1.0 - 0.25 * step(0.86, vnoise(P * 9.0));                     // pores
            float streak = (1.0 - an.y) * smoothstep(0.55, 0.8, fbm(vec3(vWPos.x * 0.25, vWPos.y * 0.012, vWPos.z * 0.25)));
            c *= 1.0 - 0.35 * streak;                                             // rain streaks
            c = mix(c, c * 1.25 + 0.04, wear);                                    // chipped edges show fresh concrete
            c = mix(c, vec3(0.13, 0.13, 0.10), grime * 0.7);
          #elif ${surface} == 1
            c *= 0.9 + 0.2 * n1;
            c = mix(c, vec3(0.55, 0.55, 0.53), wear);                             // bare steel at worn edges
            c = mix(c, vec3(0.20, 0.16, 0.11), grime * 0.85);                     // mud on the lower hull
            c = mix(c, c * 1.15 + 0.03, smoothstep(0.7, 1.0, normalize(vONrm).y) * smoothstep(0.4, 0.8, n2) * 0.5); // dust on top
          #elif ${surface} == 2
            rust = smoothstep(0.42, 0.62, n1 + n2 * 0.3);
            c = mix(c, vec3(0.32, 0.15, 0.07) * (0.7 + 0.6 * n2), rust);
            c = mix(c, vec3(0.6, 0.58, 0.55), wear * (1.0 - rust));
            c = mix(c, vec3(0.13, 0.11, 0.08), grime * 0.6);
          #elif ${surface} == 3
            c *= 0.75 + 0.5 * n1;
            c = mix(c, vec3(0.12, 0.14, 0.12), smoothstep(0.6, 0.75, n2) * 0.6);   // moss on the roof
          #elif ${surface} == 5
            c *= 0.7 + 0.5 * step(0.5, fract(vWPos.x * 0.25 + vWPos.z * 0.25));
            c = mix(c, vec3(0.6, 0.6, 0.6), edge * 0.4);
            c = mix(c, vec3(0.2, 0.16, 0.11), grime);
          #endif
          diffuseColor.rgb = c;
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        if (uProcOn > 0.5) {
          roughnessFactor = clamp(roughnessFactor + (n2 - 0.5) * 0.25, 0.04, 1.0);
          roughnessFactor = mix(roughnessFactor, 0.35, wear);
          roughnessFactor = mix(roughnessFactor, 1.0, grime * 0.6 + rust * 0.5);
          roughnessFactor = mix(roughnessFactor, 0.09, wet);
        }`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        if (uProcOn > 0.5) {
          #if ${surface} == 1 || ${surface} == 2
            metalnessFactor = mix(metalnessFactor, 0.9, wear);
            metalnessFactor = mix(metalnessFactor, 0.0, grime + rust);
          #endif
        }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        if (uProcOn > 0.5) {
          // Micro bump: n2 read as a height field, its slope taken from screen-space derivatives
          // (one noise evaluation instead of three more for finite differences).
          normal = procBump(normal, n2 * ${bumpK} * (1.0 - wet), faceDirection);
          normal = normalize(mix(normal, nonPerturbedNormal, wet));   // standing water is flat
        }`,
      );
  };
  mat.customProgramCacheKey = () => `proc-${surface}-${scale}-${bump}-${wearK}`;
  return mat;
}

/**
 * A tiny environment for image-based lighting: a dark overcast sky gradient with a few warm
 * "streetlamp" patches. PMREM pre-blurs it so rough surfaces get soft ambient and smooth ones
 * (puddles, worn steel) get recognisable reflections.
 */
export function buildEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const env = new THREE.Scene();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(100, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vP; void main(){
        float y = normalize(vP).y;
        vec3 c = mix(vec3(0.02,0.025,0.025), vec3(0.09,0.11,0.12), smoothstep(-0.2, 0.6, y));
        c += vec3(0.18,0.1,0.04) * exp(-abs(y) * 9.0);   // sodium glow on the horizon
        gl_FragColor = vec4(c, 1.0);
      }`,
    }),
  );
  env.add(sky);
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 3.2, 1.2) });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const q = new THREE.Mesh(new THREE.SphereGeometry(4, 8, 8), lampMat);
    q.position.set(Math.cos(a) * 60, 25 + (i % 2) * 15, Math.sin(a) * 60);
    env.add(q);
  }
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(env, 0.02).texture;
  pm.dispose();
  return tex;
}
