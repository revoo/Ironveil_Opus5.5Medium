// Radio treatment for subtitle-only dialogue: squelch open, a static bed for as long as the line
// takes to read, a radio-band "murmur" (formant-filtered voice-like bursts, one pitch per speaker),
// then squelch close. Intercepted enemy traffic is quieter, harsher and more broken up.

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

export class Radio {
  private bus: GainNode;
  private band: AudioNode;
  private busyUntil = 0;

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
  }

  /** Seconds the line occupies the channel (used to duck the music). */
  line(from: string, text: string, enemy: boolean): number {
    const c = this.ctx;
    const t0 = Math.max(c.currentTime + 0.02, this.busyUntil);
    const dur = Math.min(4.5, Math.max(0.9, text.length * 0.052));
    const level = enemy ? 0.45 : 1;
    this.squelch(t0, level, true);
    this.staticBed(t0 + 0.05, dur, level * (enemy ? 1.6 : 1));
    this.murmur(from, text, t0 + 0.12, dur - 0.1, level, enemy);
    this.squelch(t0 + dur + 0.1, level, false);
    this.busyUntil = t0 + dur + 0.35;
    return dur + 0.4;
  }

  private squelch(t: number, level: number, open: boolean): void {
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
    s.connect(f).connect(g).connect(this.band);
    s.start(t, Math.random());
    s.stop(t + d + 0.02);
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.value = open ? 1250 : 900;
    const og = c.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.05 * level, t + 0.002);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    o.connect(og).connect(this.band);
    o.start(t);
    o.stop(t + 0.04);
  }

  private staticBed(t: number, dur: number, level: number): void {
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
    s.connect(f).connect(g).connect(this.band);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  /** Voice-like syllables: a buzzy source through two vowel formants, one pitch per speaker. */
  private murmur(from: string, text: string, t: number, dur: number, level: number, enemy: boolean): void {
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
      if (enemy && Math.random() < 0.25) continue; // broken-up intercept
      const sd = per * (0.55 + Math.random() * 0.3);
      const [f1, f2] = VOWELS[(h + k++ * 7 + i) % VOWELS.length]!;
      const src = c.createOscillator();
      src.type = 'sawtooth';
      const pitch = base * (1 + (Math.random() - 0.5) * 0.18) * (i === syllables - 1 && text.endsWith('?') ? 1.25 : 1);
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
      g.connect(this.band);
      src.start(st);
      src.stop(st + sd + 0.02);
    }
  }
}
