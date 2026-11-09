// Dynamic resolution: trade a little sharpness for a steady frame rate.
//
// Judged on *slow frames*, not the average: a 120 Hz display averaging 17 ms (58 fps) looks fine on
// average but drops a frame every few. Each second the controller counts frames over SLOW_MS: too
// many and it steps the scale down. The browser caps frames at the display refresh, so a fast frame
// says nothing about headroom; after a calm spell it *probes* one step up, and a probe that brings
// slow frames back is undone, with the next probe waiting twice as long.
export class DynamicResolution {
  static readonly STEP = 0.1;
  /** A frame longer than this (ms) missed 50 fps: on a 60 Hz display, a missed vsync. */
  static readonly SLOW_MS = 20;
  /** More than this share of slow frames in a second: step down. */
  static readonly TOO_SLOW = 0.1;
  /** Under this share counts as a calm second. */
  static readonly CALM = 0.03;

  scale = 1;
  private n = 0;
  private slow = 0;
  private span = 0;
  private calm = 0;
  private since = 0;
  private wait = 3;
  private probing = false;

  constructor(readonly min = 0.6) {}

  /** Feed one frame's duration; returns true when the scale changed. */
  update(frameMs: number): boolean {
    if (frameMs > 250) return false; // tab switch or a one-off stall, not load
    this.n++;
    if (frameMs > DynamicResolution.SLOW_MS) this.slow++;
    this.span += frameMs / 1000;
    if (this.span < 1) return false;
    const share = this.slow / this.n;
    this.since += this.span;
    this.n = this.slow = this.span = 0;
    if (share > DynamicResolution.TOO_SLOW) {
      this.calm = 0;
      if (this.scale <= this.min) return false;
      // a failed probe: back off and wait twice as long before the next one
      if (this.probing) this.wait = Math.min(this.wait * 2, 60);
      this.probing = false;
      return this.set(this.scale - DynamicResolution.STEP);
    }
    if (share < DynamicResolution.CALM) {
      this.calm += 1;
      if (this.probing && this.since > 4) this.probing = false; // the probe held
      if (this.calm >= this.wait && this.scale < 1) {
        this.calm = 0;
        this.probing = true;
        return this.set(this.scale + DynamicResolution.STEP);
      }
    } else this.calm = 0;
    return false;
  }

  private set(s: number): boolean {
    const next = Math.round(Math.min(1, Math.max(this.min, s)) * 100) / 100;
    if (next === this.scale) return false;
    this.scale = next;
    this.since = 0;
    return true;
  }
}
