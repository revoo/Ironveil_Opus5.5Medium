// Night-time city ambience: rain (bed + droplets), a low urban rumble, and occasional distant
// events (artillery, a siren, a passing train) heard through the reverb so they feel far away.

export type AmbienceScene = 'menu' | 'mission' | 'skirmish' | 'off';

export class Ambience {
  private bus: GainNode;
  private rain: GainNode;
  private city: GainNode;
  private timer: number | null = null;
  private nextEvent = 0;
  private scene: AmbienceScene = 'off';

  constructor(
    private ctx: AudioContext,
    dest: AudioNode,
    private reverb: AudioNode,
    private noise: AudioBuffer,
  ) {
    this.bus = ctx.createGain();
    this.bus.connect(dest);
    this.rain = ctx.createGain();
    this.rain.gain.value = 0;
    this.city = ctx.createGain();
    this.city.gain.value = 0;
    this.rain.connect(this.bus);
    this.city.connect(this.bus);
    const loop = (type: BiquadFilterType, freq: number, q: number, gain: number, dest: AudioNode, lfoHz = 0, lfoDepth = 0) => {
      const s = ctx.createBufferSource();
      s.buffer = noise;
      s.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = gain;
      if (lfoHz) {
        const l = ctx.createOscillator();
        l.frequency.value = lfoHz;
        const lg = ctx.createGain();
        lg.gain.value = lfoDepth;
        l.connect(lg).connect(f.frequency);
        l.start();
      }
      s.connect(f).connect(g).connect(dest);
      s.start(0, Math.random() * 1.5);
    };
    loop('bandpass', 2600, 0.5, 0.05, this.rain);
    loop('highpass', 7000, 0.5, 0.025, this.rain);
    loop('lowpass', 900, 0.4, 0.03, this.rain, 0.09, 200);
    loop('lowpass', 260, 0.8, 0.09, this.city, 0.05, 90);
    loop('bandpass', 120, 2, 0.03, this.city);
  }

  setScene(scene: AmbienceScene): void {
    this.scene = scene;
    const t = this.ctx.currentTime;
    const on = scene === 'mission' || scene === 'skirmish';
    this.rain.gain.setTargetAtTime(scene === 'mission' ? 1 : scene === 'menu' ? 0.35 : 0, t, 1.2);
    this.city.gain.setTargetAtTime(on || scene === 'menu' ? 1 : 0, t, 1.2);
    if (this.timer === null) {
      this.nextEvent = t + 6;
      this.timer = window.setInterval(() => this.tick(), 50);
    }
  }

  private tick(): void {
    const c = this.ctx;
    const t = c.currentTime;
    if (this.scene === 'mission') {
      // droplets on metal and puddles
      for (let i = 0; i < 2; i++) if (Math.random() < 0.35) this.drop(t + Math.random() * 0.05);
      if (t > this.nextEvent) {
        this.nextEvent = t + 22 + Math.random() * 40;
        const r = Math.random();
        if (r < 0.45) this.artillery(t);
        else if (r < 0.8) this.siren(t);
        else this.train(t);
      }
    }
  }

  private drop(t: number): void {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2500 + Math.random() * 5000;
    f.Q.value = 8;
    const g = c.createGain();
    const v = 0.01 + Math.random() * 0.03;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    const p = c.createStereoPanner();
    p.pan.value = Math.random() * 2 - 1;
    s.connect(f).connect(g).connect(p).connect(this.rain);
    s.start(t, Math.random());
    s.stop(t + 0.05);
  }

  private far(): { out: GainNode } {
    const c = this.ctx;
    const out = c.createGain();
    const p = c.createStereoPanner();
    p.pan.value = Math.random() * 1.6 - 0.8;
    out.connect(p);
    p.connect(this.bus);
    p.connect(this.reverb);
    return { out };
  }

  private artillery(t: number): void {
    const c = this.ctx;
    const { out } = this.far();
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const st = t + i * (0.5 + Math.random() * 1.4);
      const s = c.createBufferSource();
      s.buffer = this.noise;
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(320, st);
      f.frequency.exponentialRampToValueAtTime(60, st + 2);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.35, st + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 2.4);
      s.connect(f).connect(g).connect(out);
      s.start(st, Math.random());
      s.stop(st + 2.5);
    }
  }

  private siren(t: number): void {
    const c = this.ctx;
    const { out } = this.far();
    const dur = 7;
    for (const base of [600, 607]) {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(base, t);
      for (let k = 0; k < 5; k++) {
        o.frequency.linearRampToValueAtTime(base * 1.45, t + k * 1.4 + 0.7);
        o.frequency.linearRampToValueAtTime(base, t + k * 1.4 + 1.4);
      }
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 800;
      bp.Q.value = 1.2;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.018, t + 2);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      o.connect(bp).connect(g).connect(out);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
  }

  private train(t: number): void {
    const c = this.ctx;
    const { out } = this.far();
    const dur = 9;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.12, t + 3);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(out);
    s.start(t);
    s.stop(t + dur);
    // rail joints: clack-clack
    for (let k = 0; k < 20; k++) {
      const st = t + 1 + k * 0.38 + (k % 2) * 0.12;
      const o = c.createBufferSource();
      o.buffer = this.noise;
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1400;
      bp.Q.value = 3;
      const gg = c.createGain();
      const env = Math.sin((k / 20) * Math.PI) * 0.06;
      gg.gain.setValueAtTime(0.0001, st);
      gg.gain.exponentialRampToValueAtTime(Math.max(0.001, env), st + 0.004);
      gg.gain.exponentialRampToValueAtTime(0.0001, st + 0.06);
      o.connect(bp).connect(gg).connect(out);
      o.start(st, Math.random());
      o.stop(st + 0.08);
    }
  }
}
