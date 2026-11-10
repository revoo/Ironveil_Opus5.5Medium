// The moon's shadow map, drawn in two layers so that driving doesn't redraw the city.
//
// The moon lights the whole view, so its shadow map holds every building, wall and bush around the
// camera: about a third of all the triangles in a frame. It was cached while nothing moved, but
// the player's own tank casts a shadow, so the whole map was redrawn on every frame of driving.
// Now the scenery is drawn once into a depth target of its own, with a frustum that only moves in
// steps (`SNAP` texels at a time, padded so the view always fits). Each frame that something
// moved, that depth is copied into the real shadow map and only the things that move (tanks,
// turrets in the air, debris) are drawn on top: a copy and a handful of draws. The copy is cut
// (scissored) to the patch of the map the moving things are in now or were in last time.
//
// three.js draws the map itself once, when it has none (first frame, or after the map size
// changed), which also creates it; from then on this class fills it.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { SHADOW_DYNAMIC_LAYER, SHADOW_LAYER } from './models';

/** The frustum is re-centred in steps of this many texels at 2048 (the same distance at any size). */
const SNAP = 128;
/** World units around a caster's origin that its shadow-map footprint can reach (hull, gun, antenna). */
const REACH = 120;

/** A patch of the shadow map in pixels; empty when x1 <= x0. */
interface Patch {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class MoonShadow {
  private scenery: THREE.WebGLRenderTarget;
  private copy: FullScreenQuad;
  /** Shadow maps hold back faces (as three.js draws front-sided materials into them). */
  private depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.BackSide, fog: false });
  /** What the scenery layer was last drawn with: light position, frustum half-size, map. */
  private key = [NaN, NaN, NaN, NaN];
  private map: THREE.WebGLRenderTarget | null = null;
  private rot = new THREE.Matrix4();
  private inv = new THREE.Matrix4();
  private c = new THREE.Vector3();
  /** Where the moving casters were drawn last time (to be restored from the scenery layer). */
  private last: Patch = { x0: 0, y0: 0, x1: 0, y1: 0 };
  /** Loose casters were drawn last time: the map needs one more pass after they are gone. */
  private loose = false;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private moon: THREE.DirectionalLight,
    private offset: THREE.Vector3,
  ) {
    this.rot.lookAt(offset, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
    this.inv.copy(this.rot).transpose();
    const depth = new THREE.DepthTexture(1, 1);
    depth.minFilter = depth.magFilter = THREE.NearestFilter;
    this.scenery = new THREE.WebGLRenderTarget(1, 1, { depthTexture: depth });
    this.copy = new FullScreenQuad(
      new THREE.ShaderMaterial({
        uniforms: { tDepth: { value: depth } },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform sampler2D tDepth; varying vec2 vUv; void main() { gl_FragDepth = texture2D(tDepth, vUv).r; gl_FragColor = vec4(0.0); }`,
        colorWrite: false,
        depthFunc: THREE.AlwaysDepth,
      }),
    );
  }

  /**
   * Fit the shadow frustum around the view: a square of half-size `r` (world units) centred on
   * `target`, moved only in whole steps of `SNAP` texels in light space, so the scenery layer
   * stays valid for a while and shadow edges never shimmer.
   */
  place(target: THREE.Vector3, r: number): void {
    const size = this.moon.shadow.mapSize.x;
    const snap = (SNAP * size) / 2048;
    const R = r / (1 - snap / size); // padded by half a step each side
    const cam = this.moon.shadow.camera;
    if (Math.abs(cam.right - R) > 1e-3) {
      cam.left = cam.bottom = -R;
      cam.right = cam.top = R;
      cam.updateProjectionMatrix();
    }
    const step = (2 * R * snap) / size;
    const c = this.c.copy(target).applyMatrix4(this.inv);
    c.x = Math.round(c.x / step) * step;
    c.y = Math.round(c.y / step) * step;
    c.z = Math.round(c.z / step) * step; // along the light: no effect on the shadows, but it must not drift either
    c.applyMatrix4(this.rot);
    this.moon.target.position.copy(c);
    this.moon.position.copy(c).add(this.offset);
    this.moon.target.updateMatrixWorld();
    this.moon.updateMatrixWorld();
  }

  /**
   * Call once per frame before the scene is drawn.
   * @param moved    a shadow caster other than scenery changed (moved, appeared, vanished)
   * @param casters  where every such caster is now (world space), whether it moved or not
   * @param anywhere casters are loose all over the place (debris): redo the whole map
   */
  update(moved: boolean, casters: readonly THREE.Vector3[], anywhere: boolean): void {
    const sh = this.moon.shadow, r = this.renderer, cam = sh.camera;
    const map = sh.map as THREE.WebGLRenderTarget | null;
    if (!map) {
      // no map yet (or its size changed): three.js draws everything this frame and creates it
      sh.needsUpdate = true;
      this.map = null;
      return;
    }
    const size = sh.mapSize.x, k = this.key, p = this.moon.position;
    const stale = this.map !== map || Math.abs(p.x - k[0]!) > 0.01 || Math.abs(p.z - k[1]!) > 0.01 || Math.abs(cam.right - k[2]!) > 1e-3 || size !== k[3];
    if (!stale && !moved && !anywhere && !this.loose) return;
    this.loose = anywhere;
    sh.updateMatrices(this.moon);
    const layers = cam.layers.mask, autoClear = r.autoClear, target = r.getRenderTarget(), background = this.scene.background;
    this.scene.overrideMaterial = this.depthOnly;
    this.scene.background = null; // a colour background clears the target even with autoClear off
    if (stale) {
      this.map = map;
      k[0] = p.x; k[1] = p.z; k[2] = cam.right; k[3] = size;
      if (this.scenery.width !== size) this.scenery.setSize(size, size);
      cam.layers.set(SHADOW_LAYER);
      r.autoClear = true;
      r.setRenderTarget(this.scenery);
      r.render(this.scene, cam);
    }
    // the patch of the map the casters cover now; restore that and the one they covered before
    const now: Patch = { x0: size, y0: size, x1: 0, y1: 0 };
    const pad = (REACH * size) / (2 * cam.right);
    for (const w of casters) {
      const uv = this.c.copy(w).applyMatrix4(sh.matrix);
      now.x0 = Math.min(now.x0, uv.x * size - pad);
      now.y0 = Math.min(now.y0, uv.y * size - pad);
      now.x1 = Math.max(now.x1, uv.x * size + pad);
      now.y1 = Math.max(now.y1, uv.y * size + pad);
    }
    const was = this.last;
    const whole = stale || anywhere;
    const x0 = whole ? 0 : Math.max(0, Math.floor(Math.min(now.x0, was.x1 > was.x0 ? was.x0 : now.x0)));
    const y0 = whole ? 0 : Math.max(0, Math.floor(Math.min(now.y0, was.x1 > was.x0 ? was.y0 : now.y0)));
    const x1 = whole ? size : Math.min(size, Math.ceil(Math.max(now.x1, was.x1 > was.x0 ? was.x1 : now.x1)));
    const y1 = whole ? size : Math.min(size, Math.ceil(Math.max(now.y1, was.x1 > was.x0 ? was.y1 : now.y1)));
    this.last = whole && anywhere ? { x0: 0, y0: 0, x1: size, y1: size } : now;
    if (x1 > x0 && y1 > y0) {
      map.scissor.set(x0, y0, x1 - x0, y1 - y0);
      map.scissorTest = true;
      r.autoClear = false;
      r.setRenderTarget(map);
      this.copy.render(r);
      cam.layers.set(SHADOW_DYNAMIC_LAYER);
      r.render(this.scene, cam);
      map.scissorTest = false;
    }
    this.scene.overrideMaterial = null;
    this.scene.background = background;
    cam.layers.mask = layers;
    r.autoClear = autoClear;
    r.setRenderTarget(target);
  }

  dispose(): void {
    this.scenery.dispose();
    this.copy.material.dispose();
    this.copy.dispose();
    this.depthOnly.dispose();
  }
}
