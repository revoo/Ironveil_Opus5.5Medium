// Debug views for the 3D PoC: look inside the frame instead of only at the final image.
//
//   final            the normal frame
//   wireframe        the triangles the GPU actually draws (note the merged static batches)
//   normals          view-space surface direction per pixel (from the GTAO pre-pass)
//   depth            distance from the camera per pixel (from the GTAO pre-pass)
//   ambient occl.    only the GTAO term
//   clay (lighting)  every surface plain white: lighting and shadows without materials
//   shadow texels    the moon's shadow map projected onto the world as a checkerboard:
//                    one square = one shadow-map pixel. Red = this point is in moon shadow.
//
// In the shadow-texel view an inset shows the "light's-eye view": the depth image the moon
// actually stores, with a dot where the camera is looking.
import * as THREE from 'three';

export const VIEWS = ['final', 'wireframe', 'normals', 'depth', 'ambient occlusion', 'clay (lighting only)', 'shadow-map texels'] as const;
export type View = (typeof VIEWS)[number];

export class DebugViews {
  index = 0;
  readonly wire = new THREE.MeshBasicMaterial({ color: 0x9ad3e8, wireframe: true });
  readonly clay = new THREE.MeshStandardMaterial({ color: 0xd8d8d2, roughness: 0.85, metalness: 0 });
  readonly texel: THREE.ShaderMaterial;
  private lightRT: THREE.WebGLRenderTarget;
  private depthMat = new THREE.MeshBasicMaterial({ colorWrite: false });
  private insetScene = new THREE.Scene();
  private insetCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private insetMat: THREE.ShaderMaterial;

  constructor(private renderer: THREE.WebGLRenderer, size: number) {
    this.lightRT = this.makeRT(size);
    this.texel = new THREE.ShaderMaterial({
      uniforms: {
        uLightVP: { value: new THREE.Matrix4() },
        uDepth: { value: this.lightRT.depthTexture },
        uSize: { value: size },
        uLightDir: { value: new THREE.Vector3(0, 1, 0) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vW; varying vec3 vN;
        void main() {
          vec4 p = vec4(position, 1.0);
          vec3 n = normal;
          #ifdef USE_INSTANCING
            p = instanceMatrix * p;
            n = mat3(instanceMatrix) * n;
          #endif
          vec4 w = modelMatrix * p;
          vW = w.xyz;
          vN = normalize(mat3(modelMatrix) * n);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform mat4 uLightVP; uniform sampler2D uDepth; uniform float uSize; uniform vec3 uLightDir;
        varying vec3 vW; varying vec3 vN;
        void main() {
          vec4 lp = uLightVP * vec4(vW, 1.0);
          vec3 ndc = lp.xyz / lp.w;
          vec2 uv = ndc.xy * 0.5 + 0.5;
          if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) { gl_FragColor = vec4(0.15, 0.15, 0.18, 1.0); return; }
          float z = ndc.z * 0.5 + 0.5;
          vec2 texel = floor(uv * uSize);
          float checker = mod(texel.x + texel.y, 2.0);
          float stored = texture2D(uDepth, uv).r;     // what the light "saw" at this shadow-map pixel
          float ndl = max(dot(normalize(vN), uLightDir), 0.0);
          bool shadowed = z - 0.0004 > stored;          // something nearer to the light covers this point
          vec3 base = mix(vec3(0.42, 0.45, 0.48), vec3(0.62, 0.65, 0.68), checker);
          vec3 c = shadowed ? base * vec3(0.95, 0.25, 0.2) : base * (0.45 + 0.55 * ndl);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.insetMat = new THREE.ShaderMaterial({
      uniforms: { uDepth: { value: this.lightRT.depthTexture }, uDot: { value: new THREE.Vector2(0.5, 0.5) } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uDepth; uniform vec2 uDot; varying vec2 vUv;
        void main() {
          float d = texture2D(uDepth, vUv).r;
          vec3 c = vec3(pow(1.0 - d, 1.6));                       // near the light = bright
          float r = length((vUv - uDot) * vec2(1.0, 1.0));
          c = mix(c, vec3(1.0, 0.75, 0.3), smoothstep(0.012, 0.008, r));
          c = mix(c, vec3(1.0, 0.75, 0.3), step(0.995, max(abs(vUv.x - 0.5), abs(vUv.y - 0.5)) * 2.0));
          gl_FragColor = vec4(c, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.insetScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.insetMat));
  }

  get view(): View {
    return VIEWS[this.index];
  }

  private makeRT(size: number): THREE.WebGLRenderTarget {
    const dt = new THREE.DepthTexture(size, size, THREE.FloatType);
    dt.minFilter = dt.magFilter = THREE.NearestFilter;
    return new THREE.WebGLRenderTarget(size, size, { depthTexture: dt, depthBuffer: true });
  }

  resizeShadow(size: number): void {
    this.lightRT.dispose();
    this.lightRT.depthTexture?.dispose();
    this.lightRT = this.makeRT(size);
    this.texel.uniforms.uDepth.value = this.lightRT.depthTexture;
    this.texel.uniforms.uSize.value = size;
    this.insetMat.uniforms.uDepth.value = this.lightRT.depthTexture;
  }

  /** Render the scene's depth from the moon's shadow camera, exactly like the real shadow pass does. */
  renderLightDepth(scene: THREE.Scene, light: THREE.DirectionalLight, lookAt: THREE.Vector3): void {
    light.shadow.updateMatrices(light);
    const cam = light.shadow.camera;
    const prevOverride = scene.overrideMaterial, prevTarget = this.renderer.getRenderTarget();
    scene.overrideMaterial = this.depthMat;
    this.renderer.setRenderTarget(this.lightRT);
    this.renderer.clear();
    this.renderer.render(scene, cam);
    this.renderer.setRenderTarget(prevTarget);
    scene.overrideMaterial = prevOverride;
    const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.texel.uniforms.uLightVP.value.copy(vp);
    this.texel.uniforms.uLightDir.value.copy(light.position).sub(light.target.position).normalize();
    const p = lookAt.clone().applyMatrix4(vp);
    this.insetMat.uniforms.uDot.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
  }

  /** Draw the light's-eye depth image into a square in the bottom-right corner (CSS pixels). */
  drawInset(px: number): void {
    const r = this.renderer;
    const w = r.domElement.clientWidth, h = r.domElement.clientHeight;
    const prevAuto = r.autoClear;
    r.autoClear = false;
    r.setScissorTest(true);
    r.setViewport(w - px - 12, 12, px, px);
    r.setScissor(w - px - 12, 12, px, px);
    r.render(this.insetScene, this.insetCam);
    r.setScissorTest(false);
    r.setViewport(0, 0, w, h);
    r.autoClear = prevAuto;
  }
}
