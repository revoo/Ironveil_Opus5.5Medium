// The post-processing chain of the 3D mission view, in as few full-screen passes as it takes.
//
// The stock EffectComposer chain was nine full-resolution passes on High (scene, AO copy, AO blend,
// bloom blend, tone map, three for SMAA, grade), all in half-float buffers, plus a second render of
// the whole scene at half resolution so the ambient occlusion had depth and normals to read.
// Here:
//   - the scene is drawn once, into a half-float target with a depth *texture*;
//   - ambient occlusion reads that depth texture (normals are rebuilt from depth), so the scene is
//     not drawn again;
//   - AO, bloom, tone mapping and the sRGB transfer are one composite pass into an 8-bit buffer;
//   - SMAA runs on that, and the grade (aberration, split tone, vignette, grain) goes to the screen.
// High: scene + composite + 3 SMAA + grade. Low (no AO, no SMAA): scene + one final pass.
//
// The picture matches the old chain: the bloom still sees the scene with AO applied, and the
// order of tone map, anti-aliasing and grade is unchanged.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';

const VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/** Bright-pass for the bloom, reading the scene with ambient occlusion applied. */
const HIGH_PASS = /* glsl */ `
  uniform sampler2D tScene; uniform float uThreshold; varying vec2 vUv;
  #ifdef USE_AO
    uniform sampler2D tAO;
  #endif
  void main() {
    vec4 texel = texture2D(tScene, vUv);
    #ifdef USE_AO
      texel.rgb *= texture2D(tAO, vUv).rgb;
    #endif
    gl_FragColor = mix(vec4(0.0), texel, smoothstep(uThreshold, uThreshold + 0.01, luminance(texel.rgb)));
  }`;

/** Scene x AO + bloom, tone mapped and encoded for display. */
const SHADE = /* glsl */ `
  uniform sampler2D tScene; uniform sampler2D tBloom;
  #ifdef USE_AO
    uniform sampler2D tAO;
  #endif
  #include <tonemapping_pars_fragment>
  vec3 shade(vec2 uv) {
    vec3 c = texture2D(tScene, uv).rgb;
    #ifdef USE_AO
      c *= texture2D(tAO, uv).rgb;
    #endif
    c += texture2D(tBloom, uv).rgb;
    return sRGBTransferOETF(vec4(ACESFilmicToneMapping(c), 1.0)).rgb;
  }`;

/** The look: chromatic aberration, split tone, vignette, damage vignette, film grain. Needs `src(uv)`. */
const GRADE = /* glsl */ `
  uniform float uTime; uniform vec2 uRes; uniform float uHurt;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  vec3 grade(vec2 uv) {
    vec2 d = uv - 0.5;
    float r2 = dot(d, d);
    vec2 off = d * r2 * (0.012 + uHurt * 0.04);
    vec3 c = vec3(src(uv + off).r, src(uv).g, src(uv - off).b);
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(c, c * vec3(0.86, 1.0, 1.1), 1.0 - smoothstep(0.0, 0.42, l));
    c = mix(c, c * vec3(1.07, 1.0, 0.88), smoothstep(0.4, 1.0, l));
    c = mix(vec3(l), c, 0.9);
    c = c * 0.97 + 0.012;
    c *= 1.0 - r2 * 1.1;
    c = mix(c, c * vec3(1.4, 0.35, 0.3), uHurt * smoothstep(0.05, 0.35, r2));   // damage vignette
    c += (hash(uv * uRes + fract(uTime) * 100.0) - 0.5) * 0.04;
    return c;
  }`;

const BLOOM = { strength: 0.6, radius: 0.55, threshold: 0.9 };

/** UnrealBloomPass, minus its last step (the additive blend over the scene, which the composite does). */
class BloomMips extends UnrealBloomPass {
  renderMips(renderer: THREE.WebGLRenderer, quad: FullScreenQuad, highPass: THREE.ShaderMaterial): THREE.Texture {
    const self = this as unknown as { renderTargetsHorizontal: THREE.WebGLRenderTarget[]; renderTargetsVertical: THREE.WebGLRenderTarget[] };
    const dirs = UnrealBloomPass as unknown as { BlurDirectionX: THREE.Vector2; BlurDirectionY: THREE.Vector2 };
    quad.material = highPass;
    renderer.setRenderTarget(this.renderTargetBright);
    quad.render(renderer);
    let input = this.renderTargetBright;
    for (let i = 0; i < this.nMips; i++) {
      const m = this.separableBlurMaterials[i]!;
      quad.material = m;
      m.uniforms.colorTexture!.value = input.texture;
      m.uniforms.direction!.value = dirs.BlurDirectionX;
      renderer.setRenderTarget(self.renderTargetsHorizontal[i]!);
      quad.render(renderer);
      m.uniforms.colorTexture!.value = self.renderTargetsHorizontal[i]!.texture;
      m.uniforms.direction!.value = dirs.BlurDirectionY;
      renderer.setRenderTarget(self.renderTargetsVertical[i]!);
      quad.render(renderer);
      input = self.renderTargetsVertical[i]!;
    }
    const c = this.compositeMaterial;
    quad.material = c;
    c.uniforms.bloomStrength!.value = this.strength;
    c.uniforms.bloomRadius!.value = this.radius;
    c.uniforms.bloomTintColors!.value = this.bloomTintColors;
    renderer.setRenderTarget(self.renderTargetsHorizontal[0]!);
    quad.render(renderer);
    return self.renderTargetsHorizontal[0]!.texture;
  }
}

export class PostChain {
  /** The scene is drawn into this (linear, no tone mapping): compile materials against it. */
  readonly sceneTarget: THREE.WebGLRenderTarget;
  private ldrA: THREE.WebGLRenderTarget;
  private ldrB: THREE.WebGLRenderTarget;
  private gtao: GTAOPass;
  private bloom: BloomMips;
  private smaa: SMAAPass;
  private quad = new FullScreenQuad();
  private highPass: Record<'ao' | 'plain', THREE.ShaderMaterial>;
  /** High: scene x AO + bloom, tone mapped, into the 8-bit buffer SMAA reads. */
  private composite: THREE.ShaderMaterial;
  /** High: the grade over the anti-aliased image, to the screen. */
  private gradePass: THREE.ShaderMaterial;
  /** Low: composite and grade in one pass, straight to the screen. */
  private finalPass: THREE.ShaderMaterial;
  private look = { uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uHurt: { value: 0 } };

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    private low: boolean,
  ) {
    const depth = new THREE.DepthTexture(1, 1);
    this.sceneTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture: depth });
    this.ldrA = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
    this.ldrB = this.ldrA.clone();

    // Ambient occlusion from the scene's own depth; the pass only computes it (output off).
    this.gtao = new GTAOPass(scene, camera, 1, 1, { depthTexture: depth });
    this.gtao.output = GTAOPass.OUTPUT.Off;
    this.gtao.updateGtaoMaterial({ radius: 14, distanceExponent: 1.4, thickness: 4, scale: 1.2, samples: 12, distanceFallOff: 1 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 8 });
    this.bloom = new BloomMips(new THREE.Vector2(256, 256), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
    this.smaa = new SMAAPass();

    const tex = () => ({ value: null as THREE.Texture | null });
    const exposure = { value: renderer.toneMappingExposure };
    const mat = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>, ao: boolean) =>
      new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms, defines: ao ? { USE_AO: 1 } : {}, depthTest: false, depthWrite: false, toneMapped: false });
    const hp = (ao: boolean) => mat(HIGH_PASS, { tScene: tex(), tAO: tex(), uThreshold: { value: BLOOM.threshold } }, ao);
    this.highPass = { ao: hp(true), plain: hp(false) };
    this.composite = mat(
      `${SHADE} varying vec2 vUv; void main() { gl_FragColor = vec4(shade(vUv), 1.0); }`,
      { tScene: tex(), tAO: tex(), tBloom: tex(), toneMappingExposure: exposure },
      true,
    );
    this.gradePass = mat(
      `uniform sampler2D tDiffuse; varying vec2 vUv; vec3 src(vec2 uv) { return texture2D(tDiffuse, uv).rgb; } ${GRADE} void main() { gl_FragColor = vec4(grade(vUv), 1.0); }`,
      { tDiffuse: tex(), ...this.look },
      false,
    );
    this.finalPass = mat(
      `${SHADE} varying vec2 vUv; vec3 src(vec2 uv) { return shade(uv); } ${GRADE} void main() { gl_FragColor = vec4(grade(vUv), 1.0); }`,
      { tScene: tex(), tBloom: tex(), toneMappingExposure: exposure, ...this.look },
      false,
    );
  }

  setLow(low: boolean): void {
    this.low = low;
  }

  /** `w`, `h` in CSS pixels; also sizes the renderer's own canvas. */
  setSize(w: number, h: number, dpr: number): void {
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h);
    const pw = Math.floor(w * dpr), ph = Math.floor(h * dpr);
    this.sceneTarget.setSize(pw, ph);
    this.ldrA.setSize(pw, ph);
    this.ldrB.setSize(pw, ph);
    // ambient occlusion is soft by nature: compute it at half resolution (a quarter of the pixels)
    this.gtao.setSize(Math.round(pw / 2), Math.round(ph / 2));
    this.bloom.setSize(pw, ph);
    this.smaa.setSize(pw, ph);
    this.look.uRes.value.set(pw, ph);
  }

  render(time: number, hurt: number): void {
    const r = this.renderer, q = this.quad;
    this.look.uTime.value = time;
    this.look.uHurt.value = hurt;
    r.setRenderTarget(this.sceneTarget);
    r.render(this.scene, this.camera);
    const scene = this.sceneTarget.texture;
    if (this.low) {
      const hp = this.highPass.plain;
      hp.uniforms.tScene!.value = scene;
      const f = this.finalPass;
      f.uniforms.tScene!.value = scene;
      f.uniforms.tBloom!.value = this.bloom.renderMips(r, q, hp);
      q.material = f;
      r.setRenderTarget(null);
      q.render(r);
      return;
    }
    this.gtao.render(r, this.ldrA, this.sceneTarget, 0, false);
    const ao = this.gtao.pdRenderTarget.texture;
    const hp = this.highPass.ao;
    hp.uniforms.tScene!.value = scene;
    hp.uniforms.tAO!.value = ao;
    const c = this.composite;
    c.uniforms.tScene!.value = scene;
    c.uniforms.tAO!.value = ao;
    c.uniforms.tBloom!.value = this.bloom.renderMips(r, q, hp);
    q.material = c;
    r.setRenderTarget(this.ldrA);
    q.render(r);
    this.smaa.render(r, this.ldrB, this.ldrA, 0, false);
    this.gradePass.uniforms.tDiffuse!.value = this.ldrB.texture;
    q.material = this.gradePass;
    r.setRenderTarget(null);
    q.render(r);
  }

  dispose(): void {
    this.sceneTarget.dispose();
    this.ldrA.dispose();
    this.ldrB.dispose();
    this.gtao.dispose();
    this.bloom.dispose();
    this.smaa.dispose();
    this.quad.dispose();
    for (const m of [this.highPass.ao, this.highPass.plain, this.composite, this.gradePass, this.finalPass]) m.dispose();
  }
}
