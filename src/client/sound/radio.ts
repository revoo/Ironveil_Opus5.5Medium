// Radio treatment for subtitle-only dialogue: squelch open, a static bed for as long as the line
// takes to read, a radio-band "murmur" (formant-filtered voice-like bursts, one pitch per speaker),
// then squelch close. Intercepted enemy traffic is quieter, harsher and more broken up.
//
// Garrison barks (speech-bubble callouts in the 3D view) use `bark`: the same radio voice, panned to
// the speaker, with a crackle bed and a per-situation flavour (priority beeps for contact, a static
// burst and dropouts when hit, a soft keyed-up murmur when calm). Barks may overlap each other but
// never more than a couple at once.

const VOWELS: [number, number][] = [
  [730, 1090], // a
  [530, 1840], // e
  [390, 1990], // i
  [570, 840], // o
  [440, 1020], // u
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export type BarkFlavour = 'calm' | 'alert' | 'contact' | 'hit' | 'priority';

export interface BarkSound {
  from: string;
  text: string;
  flavour: BarkFlavour;
  /** Stereo position -1..1 and distance gain 0..1. */
  pan: number;
  vol: number;
}

export class Radio {
  private bus: GainNode;
  private band: AudioNode;
  private busyUntil = 0;
  private crackle: AudioBuffer;
  /** End times of barks still on air. */
  private barkLive: number[] = [];

  constructor(
    private ctx: AudioContext,
    dest: AudioNode,
    private noise: AudioBuffer,
  ) {
    this.bus = ctx.createGain();
    this.bus.gain.value = 0.9;
    // Radio band: 350 Hz – 3 kHz, then a little drive.
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 350;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3000;
    const drive = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 2.6);
    }
    drive.curve = curve;
    hp.connect(lp).connect(drive).connect(this.bus);
    this.bus.connect(dest);
    this.band = hp;
    // Crackle: sparse clicks and pops of random size, for the bark carrier.
    this.crackle = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const cd = this.crackle.getChannelData(0);
    for (let i = 0; i < cd.length; i++) {
      if (Math.random() < 0.0016) {
        const amp = (Math.random() < 0.15 ? 1 : 0.35) * (Math.random() < 0.5 ? -1 : 1);
        const len = 8 + Math.floor(Math.random() * 60);
        for (let k = 0; k < len && i + k < cd.length; k++) cd[i + k]! += amp * Math.exp(-k / (len / 4)) * (Math.random() * 0.6 + 0.4);
      }
    }
  }

  /** A garrison bark: short radio burst panned to the speaker. Returns false if skipped. */
  bark(b: BarkSound): boolean {
    const c = this.ctx;
    const now = c.currentTime;
    this.barkLive = this.barkLive.filter((t) => t > now);
    const urgent = b.flavour === 'contact' || b.flavour === 'hit' || b.flavour === 'priority';
    if (this.barkLive.length >= (urgent ? 3 : 2) || b.vol <= 0.01) return false;
    const pan = c.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, b.pan * 0.8));
    const g = c.createGain();
    const flavourLevel = { calm: 0.5, alert: 0.68, contact: 0.85, hit: 0.85, priority: 0.9 }[b.flavour];
    g.gain.value = flavourLevel * (0.35 + 0.65 * b.vol);
    pan.connect(g).connect(this.band);

    let t = now + 0.02;
    this.squelch(t, b.flavour === 'calm' ? 0.6 : 1, true, pan);
    t += 0.05;
    if (b.flavour === 'contact' || b.flavour === 'priority') {
      // priority-traffic tone before the voice
      this.beep(t, 1420, 0.055, pan);
      this.beep(t + 0.08, b.flavour === 'priority' ? 940 : 1420, 0.055, pan);
      t += 0.17;
    } else if (b.flavour === 'hit') {
      this.burst(t, 0.16, 1.4, pan); // the hit rattles the set
      t += 0.1;
    }
    const fast = b.flavour === 'calm' ? 0.06 : b.flavour === 'alert' ? 0.052 : 0.045;
    const dur = Math.min(2.4, Math.max(0.55, b.text.length * fast));
    const drop = b.flavour === 'hit' ? 0.4 : b.flavour === 'calm' ? 0.12 : 0.22;
    const pitch = b.flavour === 'calm' ? 0.94 : b.flavour === 'alert' ? 1 : 1.14;
    this.crackleBed(t - 0.04, dur + 0.12, b.flavour === 'hit' ? 1.6 : b.flavour === 'calm' ? 0.6 : 1, pan);
    this.staticBed(t, dur, b.flavour === 'calm' ? 0.9 : 1.4, pan);
    this.murmur(b.from, b.text, t + 0.04, dur - 0.04, 0.9, drop, pitch, pan);
    if (b.flavour === 'hit') this.burst(t + dur * (0.3 + Math.random() * 0.4), 0.09, 1, pan);
    this.squelch(t + dur + 0.06, b.flavour === 'calm' ? 0.6 : 1, false, pan);
    const end = t + dur + 0.25;
    this.barkLive.push(end);
    setTimeout(() => pan.disconnect(), (end - now + 0.3) * 1000);
    return true;
  }

  private beep(t: number, f: number, d: number, dest: AudioNode): void {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.value = f;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.004);
    g.gain.setValueAtTime(0.06, t + d - 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + d + 0.02);
  }

  /** A loud, harsh noise hit: signal breaking up. */
  private burst(t: number, d: number, level: number, dest: AudioNode): void {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1100 + Math.random() * 900;
    f.Q.value = 0.8;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16 * level, t + 0.003);
    g.gain.setValueAtTime(0.12 * level, t + d * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random());
    s.stop(t + d + 0.02);
  }

  private crackleBed(t: number, dur: number, level: number, dest: AudioNode): void {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.crackle;
    s.loop = true;
    s.playbackRate.value = 0.8 + Math.random() * 0.5;
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 900;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.09 * level, t + 0.03);
    g.gain.setValueAtTime(0.09 * level, t + dur - 0.04);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.05);
  }

  /** Seconds the line occupies the channel (used to duck the music). */
  line(from: string, text: string, enemy: boolean): number {
    const c = this.ctx;
    const t0 = Math.max(c.currentTime + 0.02, this.busyUntil);
    const dur = Math.min(4.5, Math.max(0.9, text.length * 0.052));
    const level = enemy ? 0.45 : 1;
    this.squelch(t0, level, true);
    this.staticBed(t0 + 0.05, dur, level * (enemy ? 1.6 : 1));
    this.murmur(from, text, t0 + 0.12, dur - 0.1, level, enemy ? 0.25 : 0);
    this.squelch(t0 + dur + 0.1, level, false);
    this.busyUntil = t0 + dur + 0.35;
    return dur + 0.4;
  }

  private squelch(t: number, level: number, open: boolean, dest: AudioNode = this.band): void {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = open ? 2200 : 1600;
    f.Q.value = 1.4;
    const g = c.createGain();
    const d = open ? 0.07 : 0.12;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18 * level, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random());
    s.stop(t + d + 0.02);
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.value = open ? 1250 : 900;
    const og = c.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.05 * level, t + 0.002);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    o.connect(og).connect(dest);
    o.start(t);
    o.stop(t + 0.04);
  }

  private staticBed(t: number, dur: number, level: number, dest: AudioNode = this.band): void {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1700;
    f.Q.value = 0.6;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.022 * level, t + 0.05);
    g.gain.setValueAtTime(0.022 * level, t + dur - 0.05);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  /** Voice-like syllables: a buzzy source through two vowel formants, one pitch per speaker. */
  private murmur(from: string, text: string, t: number, dur: number, level: number, drop: number, pitchMul = 1, dest: AudioNode = this.band): void {
    const c = this.ctx;
    const h = hash(from);
    const base = 90 + (h % 90); // 90..180 Hz
    const words = text.split(/\s+/).filter(Boolean);
    const syllables = Math.max(2, Math.min(24, Math.round(text.length / 4.5)));
    const per = dur / syllables;
    let k = 0;
    for (let i = 0; i < syllables; i++) {
      const st = t + i * per + (Math.random() - 0.5) * per * 0.2;
      // short pauses between words
      if (words.length > 1 && i > 0 && i % Math.max(2, Math.round(syllables / words.length)) === 0 && Math.random() < 0.5) continue;
      if (Math.random() < drop) continue; // broken-up signal
      const sd = per * (0.55 + Math.random() * 0.3);
      const [f1, f2] = VOWELS[(h + k++ * 7 + i) % VOWELS.length]!;
      const src = c.createOscillator();
      src.type = 'sawtooth';
      const pitch = pitchMul * base * (1 + (Math.random() - 0.5) * 0.18) * (i === syllables - 1 && text.endsWith('?') ? 1.25 : 1);
      src.frequency.setValueAtTime(pitch, st);
      src.frequency.linearRampToValueAtTime(pitch * (0.92 + Math.random() * 0.12), st + sd);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.07 * level, st + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, st + sd);
      for (const [f, q, gain] of [
        [f1, 6, 1],
        [f2, 9, 0.6],
      ] as const) {
        const bp = c.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = f;
        bp.Q.value = q;
        const fg = c.createGain();
        fg.gain.value = gain;
        src.connect(bp).connect(fg).connect(g);
      }
      g.connect(dest);
      src.start(st);
      src.stop(st + sd + 0.02);
    }
  }
}
