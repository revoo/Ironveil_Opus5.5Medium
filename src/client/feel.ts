// Pure "game feel" helpers (no Phaser): springs and charge-scaled recoil impulses.
// Everything here is cosmetic — it never feeds back into the simulation.

/** Damped spring integrated in fixed sub-steps so results don't depend on frame rate. */
export class Spring {
  x = 0;
  v = 0;
  constructor(
    private k: number,
    private c: number,
  ) {}
  kick(v: number): void {
    this.v += v;
  }
  private acc = 0;
  step(dt: number): void {
    const H = 1 / 240;
    this.acc += Math.min(dt, 0.25);
    while (this.acc >= H - 1e-9) {
      const a = -this.k * this.x - this.c * this.v;
      this.v += a * H;
      this.x += this.v * H;
      this.acc -= H;
    }
  }
}

export interface RecoilImpulse {
  /** Barrel slide-back velocity (px/s, applied along the barrel). */
  barrel: number;
  /** Hull kick velocity opposite the shot (px/s, visual offset only). */
  hull: number;
  /** Camera kick velocity for the shooter's own camera. */
  camera: number;
  /** Camera shake magnitude in px (0 = none). */
  shake: number;
}

/** Heavier (more charged) shots feel heavier. Reduced motion keeps only a gentle barrel slide. */
export function recoilImpulse(charge: number, reducedMotion: boolean): RecoilImpulse {
  const c = Math.max(0, Math.min(1, charge));
  const heavy = c * c * 0.5 + c * 0.5; // ease-in: tap stays crisp, full charge thumps
  const barrel = 140 + 420 * heavy;
  if (reducedMotion) return { barrel: barrel * 0.5, hull: 0, camera: 0, shake: 0 };
  return {
    barrel,
    hull: 35 + 190 * heavy,
    camera: 25 + 190 * heavy,
    shake: c > 0.5 ? 1.8 * heavy : 0,
  };
}
