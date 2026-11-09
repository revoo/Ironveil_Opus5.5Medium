// Dynamic resolution: trade a little sharpness for a steady frame rate.
//
// The browser caps frames at the display refresh, so a frame time that's on budget says nothing
// about headroom. The controller therefore steps the render scale down quickly when frames run
// long, and *probes* upwards after a calm spell; a probe that drops frames is undone and the next
// one waits twice as long, so a machine that can't hold the higher scale stops trying.
export class DynamicResolution {
  static readonly STEP = 0.1;
  /** Frames longer than this (ms) are under ~52 fps: step down. */
  static readonly SLOW_MS = 19;
  /** Frames at or under this are holding 60 fps (or better). */
  static readonly STEADY_MS = 17.6;

  scale = 1;
  private ema = 16.7;
  private calm = 0;
  private since = 0;
  private wait = 3;
  private probing = false;

  constructor(readonly min = 0.6) {}

  /** Feed one frame's duration; returns true when the scale changed. */
  update(frameMs: number): boolean {
    if (frameMs > 250) return false; // tab switch or a one-off stall, not load
    const dt = frameMs / 1000;
    this.ema += (frameMs - this.ema) * 0.1;
    this.since += dt;
    if (this.ema > DynamicResolution.SLOW_MS) {
      this.calm = 0;
      if (this.since < 0.6 || this.scale <= this.min) return false;
      // a failed probe: back off and wait twice as long before the next one
      if (this.probing) this.wait = Math.min(this.wait * 2, 60);
      this.probing = false;
      return this.set(this.scale - DynamicResolution.STEP);
    }
    if (this.ema <= DynamicResolution.STEADY_MS) {
      this.calm += dt;
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
    this.ema = 16.7; // judge the new scale on its own frames
    return true;
  }
}
