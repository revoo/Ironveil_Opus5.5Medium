// Fully synthesised WebAudio sound design (no sample assets). Hidden-source cues are
// panned by their coarse sector only; visible sources use their authorised positions.
import type { Settings } from './settings';

type Ctx = AudioContext;

export class AudioEngine {
  ctx: Ctx | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private noiseBuf!: AudioBuffer;
  private engine: { osc: OscillatorNode; osc2: OscillatorNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private chargeHum: { osc: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private ambience: AudioNode[] = [];
  private lastPlay = new Map<string, number>();

  constructor(private settings: Settings) {}

  /** Must be called from a user gesture. */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
    } catch {
      return;
    }
    const c = this.ctx;
    this.master = c.createGain();
    this.sfx = c.createGain();
    this.music = c.createGain();
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.sfx.connect(this.master);
    this.music.connect(this.master);
    this.master.connect(comp).connect(c.destination);
    this.noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    this.startAmbience();
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    this.master.gain.value = this.settings.master;
    this.sfx.gain.value = this.settings.sfx;
    this.music.gain.value = this.settings.music * 0.6;
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }

  private throttle(key: string, ms: number): boolean {
    const now = performance.now();
    if (now - (this.lastPlay.get(key) ?? 0) < ms) return false;
    this.lastPlay.set(key, now);
    return true;
  }

  private out(pan: number, gain: number): GainNode {
    const c = this.ctx!;
    const g = c.createGain();
    g.gain.value = gain;
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p).connect(this.sfx);
    return g;
  }

  private noise(dur: number, dest: AudioNode, type: BiquadFilterType, freq: number, q = 0.7, endFreq?: number, attack = 0.002, gain = 1): void {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const t = c.currentTime;
    if (endFreq) f.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, dest: AudioNode, gain = 1, attack = 0.003): void {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = type;
    const t = c.currentTime;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Cannon report. Charge deepens the report and lengthens the tail. */
  shot(charge: number, pan: number, vol: number): void {
    if (!this.ctx || vol <= 0.01) return;
    const o = this.out(pan, vol);
    this.noise(0.12 + charge * 0.25, o, 'bandpass', 2400 - charge * 1200, 0.8, 300, 0.001, 0.9);
    this.tone('sine', 150 - charge * 70, 38, 0.25 + charge * 0.45, o, 1.1);
    this.tone('square', 90 - charge * 30, 30, 0.08 + charge * 0.1, o, 0.25);
    if (charge > 0.5) this.noise(0.9 * charge, o, 'lowpass', 900, 0.5, 120, 0.02, 0.35);
  }

  impact(kind: 'wall' | 'tank' | 'expire', charge: number, pan: number, vol: number): void {
    if (!this.ctx || vol <= 0.01 || !this.throttle('impact', 30)) return;
    const o = this.out(pan, vol);
    if (kind === 'tank') {
      this.tone('triangle', 900, 240, 0.18, o, 0.6);
      this.tone('square', 1800, 600, 0.05, o, 0.2);
      this.noise(0.2 + charge * 0.2, o, 'bandpass', 1600, 1.2, 500, 0.001, 0.8);
    } else {
      this.noise(0.18 + charge * 0.25, o, 'lowpass', 2600, 0.6, 300, 0.001, 0.8);
      this.tone('sine', 110, 40, 0.2, o, 0.5);
    }
  }

  explosion(pan: number, vol: number): void {
    if (!this.ctx || vol <= 0.01) return;
    const o = this.out(pan, vol);
    this.noise(1.8, o, 'lowpass', 1800, 0.5, 80, 0.005, 1.2);
    this.tone('sine', 70, 25, 1.2, o, 1.4, 0.01);
    this.noise(0.25, o, 'highpass', 3000, 0.7, 1200, 0.001, 0.4);
  }

  smoke(pan: number, vol: number): void {
    if (!this.ctx || vol <= 0.01) return;
    const o = this.out(pan, vol);
    this.noise(1.3, o, 'bandpass', 900, 0.6, 3500, 0.15, 0.6);
    this.tone('sine', 220, 80, 0.15, o, 0.4);
  }

  vent(pan: number, vol: number): void {
    if (!this.ctx || vol <= 0.01) return;
    const o = this.out(pan, vol);
    this.noise(0.7, o, 'highpass', 4000, 0.5, 1800, 0.01, 0.6);
  }

  click(): void {
    if (!this.ctx) return;
    this.tone('square', 1200, 900, 0.04, this.out(0, 0.15), 0.4);
  }

  holdWarning(): void {
    if (!this.ctx || !this.throttle('holdwarn', 180)) return;
    this.tone('square', 1500, 1500, 0.05, this.out(0, 0.12), 0.5);
  }

  hitConfirm(): void {
    if (!this.ctx || !this.throttle('hitc', 60)) return;
    this.tone('triangle', 1900, 1200, 0.09, this.out(0, 0.3), 0.6);
  }

  /** Hidden-source cue: only the coarse sector (pan) and band (volume) are used. */
  cue(kind: string, sector: number, near: boolean): void {
    if (!this.ctx || !this.throttle(`cue${kind}${sector}`, 250)) return;
    const pan = Math.cos((sector * Math.PI) / 4) * 0.85;
    const vol = near ? 0.5 : 0.22;
    const o = this.out(pan, vol);
    switch (kind) {
      case 'shot':
        this.noise(0.5, o, 'lowpass', 700, 0.6, 120, 0.004, 1);
        this.tone('sine', 80, 32, 0.6, o, 0.9);
        break;
      case 'charge':
        this.tone('sawtooth', 160, 320, 0.35, o, 0.12, 0.08);
        break;
      case 'engine':
        this.noise(0.35, o, 'lowpass', 220, 1.5, 160, 0.06, 0.6);
        break;
      case 'smoke':
        this.noise(0.6, o, 'bandpass', 1200, 0.6, 2500, 0.1, 0.4);
        break;
      case 'explosion':
        this.noise(1.2, o, 'lowpass', 600, 0.5, 60, 0.01, 1);
        break;
    }
  }

  /** Own engine: continuous, pitch from speed. */
  setEngine(speed: number, active: boolean, quiet: boolean): void {
    if (!this.ctx) return;
    const c = this.ctx;
    if (!this.engine) {
      const osc = c.createOscillator();
      const osc2 = c.createOscillator();
      osc.type = 'sawtooth';
      osc2.type = 'square';
      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 300;
      const gain = c.createGain();
      gain.gain.value = 0;
      osc.connect(filter);
      osc2.connect(filter);
      filter.connect(gain).connect(this.sfx);
      osc.start();
      osc2.start();
      this.engine = { osc, osc2, filter, gain };
    }
    const t = c.currentTime;
    const s = Math.min(1, speed / 200);
    this.engine.osc.frequency.setTargetAtTime(38 + s * 46, t, 0.08);
    this.engine.osc2.frequency.setTargetAtTime(19 + s * 23, t, 0.08);
    this.engine.filter.frequency.setTargetAtTime(quiet ? 160 : 240 + s * 500, t, 0.1);
    this.engine.gain.gain.setTargetAtTime(active ? (quiet ? 0.025 : 0.05 + s * 0.06) : 0, t, 0.15);
  }

  setChargeHum(level: number): void {
    if (!this.ctx) return;
    const c = this.ctx;
    if (!this.chargeHum) {
      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      const filter = c.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 4;
      const gain = c.createGain();
      gain.gain.value = 0;
      osc.connect(filter).connect(gain).connect(this.sfx);
      osc.start();
      this.chargeHum = { osc, gain, filter };
    }
    const t = c.currentTime;
    this.chargeHum.osc.frequency.setTargetAtTime(110 + level * 330, t, 0.03);
    this.chargeHum.filter.frequency.setTargetAtTime(400 + level * 1800, t, 0.03);
    this.chargeHum.gain.gain.setTargetAtTime(level > 0 ? 0.03 + level * 0.07 : 0, t, 0.04);
  }

  /** Low ambient bed: wind + slow minor drone ("music" bus). */
  private startAmbience(): void {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 380;
    const g = c.createGain();
    g.gain.value = 0.12;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 160;
    lfo.connect(lfoGain).connect(f.frequency);
    src.connect(f).connect(g).connect(this.music);
    src.start();
    lfo.start();
    const notes = [55, 82.4, 110, 130.8];
    for (const n of notes) {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = n;
      o.detune.value = (Math.random() - 0.5) * 12;
      const og = c.createGain();
      og.gain.value = 0.018;
      const trem = c.createOscillator();
      trem.frequency.value = 0.03 + Math.random() * 0.05;
      const tg = c.createGain();
      tg.gain.value = 0.014;
      trem.connect(tg).connect(og.gain);
      o.connect(og).connect(this.music);
      o.start();
      trem.start();
      this.ambience.push(o, trem);
    }
    this.ambience.push(src, lfo);
  }
}
