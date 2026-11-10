// Street lamp lighting on a budget.
//
// Every real light costs every lit pixel on screen, and every shadowed light re-draws the scene into
// its shadow map. With one spotlight per lamp (14 on The Long Night, 6 of them shadowed and re-drawn
// every frame) the lamps were most of the frame. Now:
//   - a fixed pool of spotlights (6 shadowed + 2 plain) is handed to the lamps nearest the view each
//     frame; lamps further out keep their bulb, glow, cone and mist, just no light on the ground.
//     The pool never changes size, so no shader recompiles.
//   - shadow maps are drawn once and then only when something that moves (a tank, a wreck, flying
//     debris) is under that lamp, or the light was just moved to another lamp. Scenery never moves.
import * as THREE from 'three';
import { LAMP_HEIGHT, SHADOW_DYNAMIC_LAYER, SHADOW_LAYER, type LampView } from './models';

export const LAMP_INTENSITY = 320000;
const SHADOWED = 6;
const PLAIN = 2;
/** How far from a lamp a moving object can still put a shadow into its light. */
const REACH = 340;
/** Lit radius on the ground (cone half-angle 1.1 rad from LAMP_HEIGHT), used to rank lamps by view. */
const GLOW = LAMP_HEIGHT * Math.tan(1.1);

interface Slot {
  light: THREE.SpotLight;
  lamp: number;
  /** 0..1, ramps up after the slot moves so a light never snaps on. */
  fade: number;
  /** Something moved under it last frame: draw once more so its shadow is cleared. */
  wasBusy: boolean;
}

export class LampLights {
  private slots: Slot[] = [];
  private score: number[];
  private blasts: { x: number; z: number; t: number }[] = [];

  constructor(scene: THREE.Scene, private lamps: LampView[], low: boolean) {
    this.score = lamps.map(() => 0);
    for (let i = 0; i < SHADOWED + PLAIN; i++) {
      const s = new THREE.SpotLight(0xffa64d, 0, 700, 1.1, 0.8, 2);
      s.castShadow = i < SHADOWED;
      s.shadow.mapSize.setScalar(low ? 512 : 1024);
      s.shadow.bias = -0.0006;
      s.shadow.normalBias = 0.6;
      s.shadow.camera.near = 8;
      s.shadow.camera.layers.enable(SHADOW_LAYER);
      s.shadow.camera.layers.enable(SHADOW_DYNAMIC_LAYER);
      s.shadow.autoUpdate = false;
      s.shadow.needsUpdate = true;
      scene.add(s, s.target);
      this.slots.push({ light: s, lamp: -1, fade: 0, wasBusy: false });
    }
  }

  /** An explosion: debris will be flying here for a few seconds. */
  blast(x: number, z: number): void {
    this.blasts.push({ x, z, t: 5 });
  }

  /** Lower the shadow resolution on the Low preset (takes effect without a shader recompile). */
  setLow(low: boolean): void {
    for (const s of this.slots) {
      const size = low ? 512 : 1024;
      if (!s.light.castShadow || s.light.shadow.mapSize.x === size) continue;
      s.light.shadow.mapSize.setScalar(size);
      s.light.shadow.map?.dispose();
      s.light.shadow.map = null;
      s.light.shadow.needsUpdate = true;
    }
  }

  /**
   * @param view centre of the view on the ground, and its half extents across / along the view
   * @param k    per-lamp brightness (flicker), same order as the lamps
   * @param movers positions of things that move and cast shadows this frame
   */
  update(view: { x: number; z: number; halfW: number; halfD: number }, k: number[], movers: { x: number; z: number }[], dt: number): void {
    this.blasts = this.blasts.filter((b) => (b.t -= dt) > 0);
    // Rank lamps by how far inside the (isometric) view footprint their pool of light is.
    // Camera yaw is 45°: "across" is (1,-1)/√2 on the ground, "along" is (1,1)/√2.
    const owned = new Set(this.slots.map((s) => s.lamp));
    const order = this.lamps.map((l, i) => {
      const dx = l.x - view.x, dz = l.z - view.z;
      const across = Math.abs(dx - dz) * Math.SQRT1_2, along = Math.abs(dx + dz) * Math.SQRT1_2;
      let s = Math.max(across / (view.halfW + GLOW), along / (view.halfD + GLOW));
      if (owned.has(i)) s *= 0.9; // hysteresis: a lamp at the edge doesn't flip back and forth
      this.score[i] = s;
      return i;
    });
    order.sort((a, b) => this.score[a]! - this.score[b]!);
    this.assign(order.slice(0, SHADOWED), this.slots.slice(0, SHADOWED));
    this.assign(order.slice(SHADOWED, SHADOWED + PLAIN), this.slots.slice(SHADOWED));

    for (const s of this.slots) {
      const l = s.light;
      if (s.lamp < 0) {
        l.intensity = 0;
        continue;
      }
      s.fade = Math.min(1, s.fade + dt * 3);
      l.intensity = LAMP_INTENSITY * (k[s.lamp] ?? 1) * s.fade;
      if (!l.castShadow) continue;
      const lamp = this.lamps[s.lamp]!;
      const near = (p: { x: number; z: number }, r: number) => Math.abs(p.x - lamp.x) < r && Math.abs(p.z - lamp.z) < r;
      const busy = movers.some((p) => near(p, REACH)) || this.blasts.some((b) => near(b, REACH + 200));
      if (busy || s.wasBusy) l.shadow.needsUpdate = true;
      s.wasBusy = busy;
    }
  }

  /** Give each wanted lamp a slot of this tier, keeping lamps that already have one where they are. */
  private assign(want: number[], slots: Slot[]): void {
    const keep = new Set(want);
    const free = slots.filter((s) => !keep.has(s.lamp));
    const have = new Set(slots.map((s) => s.lamp));
    for (const i of want) {
      if (have.has(i)) continue;
      const s = free.shift();
      if (!s) break;
      const lamp = this.lamps[i]!;
      s.lamp = i;
      s.fade = 0;
      s.light.position.set(lamp.x, LAMP_HEIGHT - 3, lamp.z);
      s.light.target.position.set(lamp.x, 0, lamp.z);
      s.light.target.updateMatrixWorld();
      s.light.shadow.needsUpdate = true;
    }
    for (const s of free) if (!keep.has(s.lamp)) s.lamp = -1;
  }
}
