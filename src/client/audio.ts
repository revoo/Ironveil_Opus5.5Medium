// Fully synthesised WebAudio sound design (no sample assets). Hidden-source cues are
// panned by their coarse sector only; visible sources use their authorised positions.
import type { Settings } from './settings';
import { Music, type MusicMood } from './sound/music';
import { Radio } from './sound/radio';
import { Ambience, type AmbienceScene } from './sound/ambience';

type Ctx = AudioContext;

export class AudioEngine {
  ctx: Ctx | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private noiseBuf!: AudioBuffer;
  private engine: { osc: OscillatorNode; osc2: OscillatorNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private chargeHum: { osc: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private lastPlay = new Map<string, number>();
  private finalOut: AudioNode | null = null;
  /** Send into the shared "night street" acoustics: convolution reverb + a wall slap-back. */
  private space!: GainNode;
  private drive!: WaveShaperNode;
  private clatter: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  score: Music | null = null;
  radio: Radio | null = null;
  ambience: Ambience | null = null;
  private pendingScene: AmbienceScene = 'menu';
  private pendingMood: MusicMood = 'menu';

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
    // Final brick-wall limiter so stacked explosions never clip.
    const limit = c.createDynamicsCompressor();
    limit.threshold.value = -4;
    limit.knee.value = 0;
    limit.ratio.value = 20;
    limit.attack.value = 0.002;
    limit.release.value = 0.12;
    const trim = c.createGain();
    trim.gain.value = 0.85;
    this.master.connect(comp).connect(limit).connect(trim).connect(c.destination);
    this.finalOut = trim;
    this.noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // Acoustics: a generated stereo impulse response (2.8 s, darkened) and a 160 ms slap-back.
    const conv = c.createConvolver();
    conv.buffer = this.impulse(2.8, 2.6);
    const verbOut = c.createGain();
    verbOut.gain.value = 0.42;
    const verbTone = c.createBiquadFilter();
    verbTone.type = 'lowpass';
    verbTone.frequency.value = 4200;
    this.space = c.createGain();
    this.space.connect(conv).connect(verbTone).connect(verbOut).connect(this.master);
    const slap = c.createDelay(1);
    slap.delayTime.value = 0.16;
    const slapTone = c.createBiquadFilter();
    slapTone.type = 'lowpass';
    slapTone.frequency.value = 2200;
    const slapFb = c.createGain();
    slapFb.gain.value = 0.28;
    const slapOut = c.createGain();
    slapOut.gain.value = 0.35;
    this.space.connect(slap).connect(slapTone).connect(slapFb).connect(slap);
    slapTone.connect(slapOut).connect(this.master);
    this.drive = c.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / (curve.length - 1)) * 2 - 1) * 3);
    this.drive.curve = curve;
    this.score = new Music(c, this.music, this.space, this.noiseBuf);
    this.radio = new Radio(c, this.sfx, this.noiseBuf);
    this.ambience = new Ambience(c, this.sfx, this.space, this.noiseBuf);
    this.applyVolumes();
    this.score.start();
    this.score.setMood(this.pendingMood);
    this.ambience.setScene(this.pendingScene);
  }

  private impulse(seconds: number, decay: number): AudioBuffer {
    const c = this.ctx!;
    const len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // early reflections cluster, then a smooth tail
        const early = i < c.sampleRate * 0.08 && Math.random() < 0.02 ? 1.5 : 0;
        d[i] = ((Math.random() * 2 - 1) + early) * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }

  /** Debug/capture: a MediaStream of the final mix (used to record audio previews). */
  tap(): MediaStream | null {
    if (!this.ctx || !this.finalOut) return null;
    const d = this.ctx.createMediaStreamDestination();
    this.finalOut.connect(d);
    return d.stream;
  }

  // ---------------------------------------------------------------- scene & score
  setScene(scene: AmbienceScene): void {
    this.pendingScene = scene;
    this.ambience?.setScene(scene);
  }

  setMood(mood: MusicMood, tension = 0): void {
    this.pendingMood = mood;
    if (this.score && (this.score.currentMood !== mood || mood === 'tension')) this.score.setMood(mood, tension);
  }

  stinger(kind: 'spotted' | 'checkpoint' | 'objective' | 'success' | 'failure'): void {
    this.score?.stinger(kind);
    if (kind === 'spotted') this.score?.duck(0.3, 1.2);
  }

  radioLine(from: string, text: string, enemy: boolean): void {
    if (!this.radio || !this.score) return;
    const d = this.radio.line(from, text, enemy);
    if (!enemy) this.score.duck(0.35, d);
  }

  choiceOpen(): void {
    if (!this.ctx) return;
    const o = this.out(0, 0.22, 0.3);
    this.tone('sine', 660, 660, 0.12, o, 0.5);
    setTimeout(() => this.ctx && this.tone('sine', 990, 990, 0.18, this.out(0, 0.22, 0.3), 0.5), 110);
  }

  choiceSelect(): void {
    if (!this.ctx) return;
    const o = this.out(0, 0.25, 0.2);
    this.tone('square', 1400, 1100, 0.05, o, 0.3);
    this.tone('sine', 880, 1320, 0.16, o, 0.5);
  }

  /** A soft rising swell when a guard starts to notice you. */
  suspicion(level: number): void {
    if (!this.ctx || !this.throttle('susp', 900)) return;
    const o = this.out(0, 0.1 + level * 0.12, 0.5);
    this.tone('sine', 220 + level * 200, 330 + level * 300, 0.6, o, 0.5, 0.25);
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    this.master.gain.value = this.settings.master;
    this.sfx.gain.value = this.settings.sfx;
    this.music.gain.value = this.settings.music * 0.9;
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

  private out(pan: number, gain: number, send = 0.22): GainNode {
    const c = this.ctx!;
    const g = c.createGain();
    g.gain.value = gain;
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p).connect(this.sfx);
    if (send > 0 && this.space) {
      const sg = c.createGain();
      sg.gain.value = send;
      p.connect(sg).connect(this.space);
    }
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
    const o = this.out(pan, vol, 0.55);
    this.noise(0.035, o, 'highpass', 3500, 0.7, 2000, 0.0005, 1.1); // the crack
    this.noise(0.12 + charge * 0.25, o, 'bandpass', 2400 - charge * 1200, 0.8, 300, 0.001, 0.9);
    const body = this.ctx.createGain();
    body.gain.value = 0.55;
    body.connect(this.drive);
    this.drive.connect(o);
    this.tone('sine', 150 - charge * 70, 38, 0.25 + charge * 0.45, body, 1.1);
    this.tone('square', 90 - charge * 30, 30, 0.08 + charge * 0.1, o, 0.25);
    if (charge > 0.5) this.noise(0.9 * charge, o, 'lowpass', 900, 0.5, 120, 0.02, 0.35);
    if (vol > 0.6) this.score?.duck(0.2 + charge * 0.2, 0.5);
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
    const o = this.out(pan, vol, 0.7);
    this.noise(1.8, o, 'lowpass', 1800, 0.5, 80, 0.005, 1.2);
    const boom = this.ctx.createGain();
    boom.gain.value = 0.7;
    boom.connect(this.drive);
    this.tone('sine', 70, 25, 1.2, boom, 1.4, 0.01);
    this.noise(0.25, o, 'highpass', 3000, 0.7, 1200, 0.001, 0.4);
    // debris raining down
    const c = this.ctx;
    for (let i = 0; i < 14; i++) {
      const t = 0.15 + Math.random() * 1.4;
      setTimeout(() => this.ctx && this.noise(0.04 + Math.random() * 0.05, this.out(pan + (Math.random() - 0.5) * 0.4, vol * 0.35, 0.3), 'bandpass', 1500 + Math.random() * 3500, 2, undefined, 0.001, 0.6), t * 1000);
    }
    void c;
    this.score?.duck(0.55, 1.6);
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
    if (!this.clatter) {
      // a one-second loop of track-link clicks; playback rate follows speed
      const buf = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let k = 0; k < 14; k++) {
        const at = Math.floor(((k + Math.random() * 0.25) / 14) * d.length);
        for (let i = 0; i < 260 && at + i < d.length; i++) d[at + i] += (Math.random() * 2 - 1) * Math.exp(-i / 50) * (0.6 + Math.random() * 0.4);
      }
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1100;
      bp.Q.value = 0.9;
      const gain = c.createGain();
      gain.gain.value = 0;
      src.connect(bp).connect(gain).connect(this.sfx);
      src.start();
      this.clatter = { src, gain };
    }
    const t = c.currentTime;
    const s = Math.min(1, speed / 200);
    this.clatter.src.playbackRate.setTargetAtTime(0.25 + s * 1.5, t, 0.1);
    this.clatter.gain.gain.setTargetAtTime(active && s > 0.03 ? (quiet ? 0.015 : 0.05) * Math.min(1, s * 2) : 0, t, 0.12);
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
}
