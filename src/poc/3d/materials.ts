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
//   - wet patches (ground): darker, mirror-smooth, and flattened so they reflect the environment
import * as THREE from 'three';

export const procUniforms = {
  uProcOn: { value: 1 },
  uTime: { value: 0 },
};

export enum Surface {
  Concrete = 0,
  Paint = 1,
  Rust = 2,
  Tar = 3,
  Ground = 4,
  Track = 5,
}

const NOISE = /* glsl */ `
uniform float uProcOn;
uniform float uTime;
varying vec3 vWPos;
varying vec3 vONrm;
float h31(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
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
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uProcOn = procUniforms.uProcOn;
    sh.uniforms.uTime = procUniforms.uTime;
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
        float n1 = fbm(P);
        float n2 = fbm(P * 4.3 + 11.0);
        float wear = 0.0, grime = 0.0, wet = 0.0, rust = 0.0;
        if (uProcOn > 0.5) {
          grime = (1.0 - smoothstep(0.0, 26.0, vWPos.y)) * smoothstep(0.3, 0.7, n1);
          wear = edge * smoothstep(0.35, 0.6, n2) * ${wearK};
          vec3 c = diffuseColor.rgb;
          #if ${surface} == 0
            c *= 0.8 + 0.35 * n1;
            c *= 1.0 - 0.25 * step(0.78, fbm(P * 9.0));                        // pores
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
          #elif ${surface} == 4
            wet = smoothstep(0.5, 0.58, fbm(vec3(vWPos.x, 0.0, vWPos.z) * 0.0065 + 3.1));
            c *= 0.85 + 0.3 * fbm(P * 0.3);
            c = mix(c, c * vec3(0.75, 0.72, 0.65), smoothstep(0.45, 0.7, fbm(P * 0.07)));  // dirt patches
            c = mix(c, c * 0.5, wet);
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
          // Micro bump from the noise gradient (finite differences in world space), moved to view space.
          float e = 0.15 / (${scale} * 4.3);
          vec3 g = vec3(fbm((vWPos + vec3(e,0,0)) * ${scale} * 4.3 + 11.0) - n2,
                        fbm((vWPos + vec3(0,e,0)) * ${scale} * 4.3 + 11.0) - n2,
                        fbm((vWPos + vec3(0,0,e)) * ${scale} * 4.3 + 11.0) - n2);
          vec3 gv = mat3(viewMatrix) * g;
          gv -= dot(gv, normal) * normal;
          normal = normalize(normal - gv * ${bump} * 6.0 * (1.0 - wet));
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
