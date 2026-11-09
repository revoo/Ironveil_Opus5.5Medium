// Fully synthesised WebAudio sound design (no sample assets). Hidden-source cues are
// panned by their coarse sector only; visible sources use their authorised positions.
import type { Settings } from './settings';
import { Music, type MusicMood } from './sound/music';
import { Radio, type BarkFlavour } from './sound/radio';
import type { Utterance, VoiceProfile } from './sound/voice';
import type { BarkKind } from '../ai/simple';
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

  /** A dialogue line the comms panel has just put on air (the panel owns timing and queue). */
  transmit(u: Utterance, voice: VoiceProfile, enemy: boolean): void {
    if (!this.radio || !this.score || this.ctx?.state !== 'running') return;
    const d = this.radio.transmit(u, voice, enemy);
    this.score.duck(enemy ? 0.6 : 0.35, d);
  }

  /** Faint traffic between other units. Returns its length in seconds (0 if silent). */
  netChatter(): number {
    if (!this.radio || this.ctx?.state !== 'running') return 0;
    return this.radio.netChatter();
  }

  /** A garrison bark from a visible enemy: radio burst at its position, plus any world foley. */
  bark(from: string, text: string, kind: BarkKind, pan: number, vol: number): void {
    if (!this.radio) return;
    const flavour: BarkFlavour =
      kind === 'nothing' || kind === 'giveUp' ? 'calm'
      : kind === 'hit' || kind === 'heavyHit' || kind === 'critical' ? 'hit'
      : kind === 'allyDown' ? 'priority'
      : kind === 'spotted' || kind === 'reloading' ? 'contact'
      : 'alert';
    this.radio.bark({ from, text, flavour, pan, vol });
    if (kind === 'reloading') this.breech(pan, vol);
  }

  /** Breech block: a heavy clack, the shell rolling in, the block slamming shut. */
  private breech(pan: number, vol: number): void {
    if (!this.ctx || vol <= 0.01) return;
    const o = this.out(pan, 0.55 * Math.max(0.3, vol), 0.3);
    this.noise(0.06, o, 'bandpass', 2400, 2.5, 1400, 0.001, 0.7);
    this.tone('triangle', 340, 170, 0.09, o, 0.5);
    setTimeout(() => {
      if (!this.ctx) return;
      const o2 = this.out(pan, 0.5 * Math.max(0.3, vol), 0.3);
      this.noise(0.22, o2, 'bandpass', 700, 1.2, 380, 0.02, 0.25);
      setTimeout(() => {
        if (!this.ctx) return;
        const o3 = this.out(pan, 0.6 * Math.max(0.3, vol), 0.35);
        this.noise(0.08, o3, 'bandpass', 3000, 3, 1800, 0.001, 0.8);
        this.tone('square', 220, 110, 0.07, o3, 0.35);
        this.tone('triangle', 1900, 1300, 0.05, o3, 0.2);
      }, 230);
    }, 160);
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
    const body = this.driven(o, 0.55);
    this.tone('sine', 150 - charge * 70, 38, 0.25 + charge * 0.45, body, 1.1);
    this.tone('square', 90 - charge * 30, 30, 0.08 + charge * 0.1, o, 0.25);
    if (charge > 0.5) this.noise(0.9 * charge, o, 'lowpass', 900, 0.5, 120, 0.02, 0.35);
    if (charge > 0.7) {
      // a full charge: a concussive slam and a long rolling tail
      this.tone('sine', 55, 24, 1.1 * charge, this.driven(o, 0.7), 1.2, 0.004);
      this.noise(1.6 * charge, o, 'lowpass', 600, 0.5, 60, 0.03, 0.5);
    }
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

  /**
   * A gain feeding a per-sound copy of the drive curve into `dest`. The shared WaveShaper used to be
   * connected to every sound's output and never disconnected, so each new body played through all
   * earlier outputs and grew louder over a mission.
   */
  private driven(dest: AudioNode, gain: number): GainNode {
    const c = this.ctx!;
    const ws = c.createWaveShaper();
    ws.curve = this.drive.curve;
    const g = c.createGain();
    g.gain.value = gain;
    g.connect(ws).connect(dest);
    return g;
  }

  /** A tank destroyed: crack, fireball roar, sub-bass thump, then debris raining down. */
  explosion(pan: number, vol: number): void {
    if (!this.ctx || vol <= 0.01) return;
    const o = this.out(pan, vol, 0.75);
    this.noise(0.05, o, 'highpass', 2500, 0.7, 900, 0.0005, 1.3); // the crack
    this.noise(2.4, o, 'lowpass', 2200, 0.5, 70, 0.006, 1.3); // the roar
    this.noise(0.6, o, 'bandpass', 500, 0.8, 140, 0.01, 0.9); // the body
    this.tone('sine', 62, 22, 1.6, this.driven(o, 0.8), 1.5, 0.008); // the thump
    this.tone('sine', 41, 20, 2.2, o, 0.9, 0.02);
    // debris raining down: metal ticks and thuds over a couple of seconds
    for (let i = 0; i < 22; i++) {
      const t = 0.2 + Math.random() * 2;
      const big = Math.random() < 0.3;
      setTimeout(() => {
        if (!this.ctx) return;
        const d = this.out(pan + (Math.random() - 0.5) * 0.5, vol * (big ? 0.4 : 0.3), 0.3);
        if (big) this.tone('sine', 140 + Math.random() * 80, 60, 0.12, d, 0.7);
        this.noise(0.03 + Math.random() * 0.06, d, 'bandpass', 1200 + Math.random() * 4000, 2.2, undefined, 0.001, 0.7);
      }, t * 1000);
    }
    this.score?.duck(0.65, 2);
  }

  /** Ammunition cooking off in a wreck: sharp, smaller blasts. `size` ~0.45..1.05. */
  cookOff(size: number, pan: number, vol: number): void {
    if (!this.ctx || vol <= 0.01) return;
    const o = this.out(pan + (Math.random() - 0.5) * 0.2, vol * (0.55 + size * 0.45), 0.7);
    this.noise(0.03, o, 'highpass', 3000, 0.7, 1200, 0.0005, 1.1);
    this.noise(0.5 + size * 0.9, o, 'lowpass', 1600 + size * 800, 0.6, 90, 0.004, 1.1);
    this.tone('sine', 95 - size * 30, 28, 0.4 + size * 0.7, this.driven(o, 0.6), 1.2, 0.006);
    for (let i = 0; i < 5; i++) setTimeout(() => this.ctx && this.noise(0.02, this.out(pan, vol * 0.25, 0.2), 'bandpass', 2000 + Math.random() * 3000, 3, undefined, 0.001, 0.8), (0.05 + Math.random() * 0.4) * 1000);
    this.score?.duck(0.3 + size * 0.2, 0.8);
  }

  /** A shell striking armour: an inharmonic metal clang, a thump, a rattle of spall. */
  armorHit(charge: number, pan: number, vol: number, onUs: boolean): void {
    if (!this.ctx || vol <= 0.01 || !this.throttle(onUs ? 'armorUs' : 'armor', 40)) return;
    const o = this.out(pan, vol * (onUs ? 1 : 0.85), 0.35);
    const base = onUs ? 330 : 470 + Math.random() * 60;
    for (const [ratio, g, d] of [[1, 0.5, 0.5], [2.76, 0.35, 0.35], [5.4, 0.22, 0.22], [8.93, 0.12, 0.14]] as const) this.tone('sine', base * ratio, base * ratio * 0.97, d * (0.8 + charge * 0.5), o, g);
    this.noise(0.08, o, 'bandpass', 3200, 1.5, 1500, 0.0005, 0.9);
    this.tone('sine', 120 + charge * 40, 45, 0.25 + charge * 0.2, this.driven(o, 0.5), 1, 0.002);
    for (let i = 0; i < 3 + Math.round(charge * 4); i++) setTimeout(() => this.ctx && this.noise(0.025, this.out(pan + (Math.random() - 0.5) * 0.3, vol * 0.2, 0.15), 'bandpass', 2500 + Math.random() * 3500, 3, undefined, 0.001, 0.7), (0.06 + Math.random() * 0.5) * 1000);
  }

  /** A burning wreck crackles and pops. */
  crackle(pan: number, vol: number): void {
    if (!this.ctx || vol <= 0.02) return;
    const o = this.out(pan, vol * 0.45, 0.2);
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) setTimeout(() => this.ctx && this.noise(0.015 + Math.random() * 0.03, o, 'bandpass', 1500 + Math.random() * 3000, 1.5, undefined, 0.001, 0.8), i * (30 + Math.random() * 90));
    if (Math.random() < 0.25) this.noise(0.4, o, 'lowpass', 400, 0.5, 150, 0.05, 0.4); // a whoomph of flame
  }

  /** The cannon reaches full charge: a rising two-note lock tone, so you know without looking. */
  chargeFull(): void {
    if (!this.ctx) return;
    const o = this.out(0, 0.22, 0.1);
    this.tone('triangle', 880, 880, 0.07, o, 0.6);
    setTimeout(() => this.ctx && this.tone('triangle', 1320, 1320, 0.12, this.out(0, 0.22, 0.1), 0.6), 70);
  }

  /** Heavy metal landing (a turret thrown off a wreck). */
  clank(pan: number, vol: number): void {
    if (!this.ctx || vol <= 0.01) return;
    const o = this.out(pan, vol * 0.8, 0.4);
    this.tone('sine', 190, 120, 0.4, o, 0.7);
    this.tone('triangle', 410, 380, 0.3, o, 0.25);
    this.noise(0.12, o, 'bandpass', 900, 1.2, 400, 0.001, 0.8);
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
