// Adaptive score, synthesised in WebAudio. One piece in D minor at 84 bpm with four layers whose
// levels follow the game state, scheduled ahead of time on the audio clock (the standard
// "lookahead scheduler" pattern) so timing never depends on frame rate.
//
//   drone     always: low D with slow movement (the city at night)
//   choir     always: a low male choir on the chords (an oktavist on the root an octave down, then
//             baritones and tenors), sung on dark vowels; the Vostravan voice of the score
//   pad       always: detuned saw chords, i – VI – iv – V (Dm, Bb, Gm, A), filter opens with tension
//   shimmer   calm only: sparse high bell notes from D minor pentatonic, and now and then a low
//             church bell tolling somewhere in the city
//   pulse     tension: syncopated eighth-note bass on the chord root
//   drums     combat: low hits, metallic backbeat, end-of-bar fills
//
// Stingers punctuate events: spotted, checkpoint, objective, success, failure.

const BPM = 84;
const EIGHTH = 60 / BPM / 2;
// Two bars (16 eighths) per chord.
const CHORDS: number[][] = [
  [146.83, 174.61, 220.0], // Dm
  [116.54, 146.83, 174.61], // Bb
  [98.0, 116.54, 146.83], // Gm
  [110.0, 138.59, 164.81], // A
];
const ROOTS = [73.42, 58.27, 49.0, 55.0];
const PENTA = [587.33, 698.46, 783.99, 880.0, 1046.5, 1174.66];
const PULSE_ACCENT = [1, 0, 0.55, 0, 0.9, 0.55, 0, 0.6];

export type MusicMood = 'menu' | 'calm' | 'tension' | 'combat' | 'silent';

export class Music {
  private bus: GainNode;
  private layers: Record<'drone' | 'choir' | 'pad' | 'shimmer' | 'pulse' | 'drums', GainNode>;
  private padFilter: BiquadFilterNode;
  private step = 0;
  private next = 0;
  private timer: number | null = null;
  private tension = 0;
  private combat = 0;
  private mood: MusicMood = 'menu';

  constructor(
    private ctx: AudioContext,
    dest: AudioNode,
    private reverb: AudioNode,
    private noise: AudioBuffer,
  ) {
    this.bus = ctx.createGain();
    this.bus.connect(dest);
    const mk = () => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.bus);
      return g;
    };
    this.layers = { drone: mk(), choir: mk(), pad: mk(), shimmer: mk(), pulse: mk(), drums: mk() };
    // the choir sings into the hall as well
    const send = ctx.createGain();
    send.gain.value = 0.55;
    this.layers.choir.connect(send).connect(reverb);
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 500;
    this.padFilter.Q.value = 0.6;
    this.padFilter.connect(this.layers.pad);
    this.startDrone();
  }

  start(): void {
    if (this.timer !== null) return;
    this.next = this.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 40);
  }

  /** Duck the whole score briefly (radio lines, explosions). */
  duck(amount: number, seconds: number): void {
    const t = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(t);
    this.bus.gain.setTargetAtTime(1 - amount, t, 0.05);
    this.bus.gain.setTargetAtTime(1, t + seconds, 0.6);
  }

  setMood(mood: MusicMood, tension = 0): void {
    this.mood = mood;
    this.tension = mood === 'combat' ? 1 : mood === 'tension' ? Math.max(0.35, tension) : mood === 'calm' ? tension * 0.5 : 0;
    this.combat = mood === 'combat' ? 1 : 0;
    const t = this.ctx.currentTime;
    const silent = mood === 'silent';
    const L = this.layers;
    const set = (g: GainNode, v: number, tc: number) => g.gain.setTargetAtTime(silent ? 0 : v, t, tc);
    set(L.drone, mood === 'menu' ? 0.5 : 0.7, 1.5);
    set(L.choir, mood === 'menu' ? 0.95 : mood === 'combat' ? 0.45 : mood === 'tension' ? 0.75 : 0.7, 2);
    set(L.pad, mood === 'menu' ? 0.32 : 0.26 + this.tension * 0.35, 1.2);
    set(L.shimmer, mood === 'combat' ? 0 : (1 - this.tension) * 0.9, 2);
    set(L.pulse, this.combat ? 0.9 : this.tension > 0.3 ? this.tension * 0.8 : 0, this.combat ? 0.3 : 1.2);
    set(L.drums, this.combat, this.combat ? 0.25 : 2.5);
    this.padFilter.frequency.setTargetAtTime(450 + this.tension * 1300, t, 1.5);
  }

  get currentMood(): MusicMood {
    return this.mood;
  }

  // ---------------------------------------------------------------- scheduling
  private schedule(): void {
    const ahead = this.ctx.currentTime + 0.25;
    while (this.next < ahead) {
      this.play(this.step, this.next);
      this.next += EIGHTH;
      this.step = (this.step + 1) % 64;
    }
  }

  private play(step: number, t: number): void {
    const chord = Math.floor(step / 16) % 4;
    const inBar = step % 8;
    if (step % 16 === 0) this.padChord(CHORDS[chord]!, t, EIGHTH * 16);
    if (step % 16 === 0) this.choirChord(CHORDS[chord]!, ROOTS[chord]!, t, EIGHTH * 16, chord);
    if (step % 16 === 4 && Math.random() < 0.7) this.bell(PENTA[Math.floor(Math.random() * PENTA.length)]!, t);
    if (step === 8 && Math.random() < 0.45) this.knell(Math.random() < 0.5 ? 73.42 : 98.0, t);
    const acc = PULSE_ACCENT[inBar]!;
    if (acc > 0) this.pluck(ROOTS[chord]! * (inBar === 4 ? 2 : 1), t, acc);
    // drums
    if (inBar === 0 || inBar === 5) this.kick(t, inBar === 0 ? 1 : 0.7);
    if (inBar === 4) this.metal(t);
    if (step % 16 >= 13) this.tom(t, 110 - (step % 16 - 13) * 18);
  }

  // ---------------------------------------------------------------- voices
  private startDrone(): void {
    const c = this.ctx;
    for (const [f, g] of [
      [36.71, 0.32],
      [73.42, 0.16],
      [110.0, 0.05],
    ] as const) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const gg = c.createGain();
      gg.gain.value = g;
      const lfo = c.createOscillator();
      lfo.frequency.value = 0.04 + Math.random() * 0.05;
      const lg = c.createGain();
      lg.gain.value = g * 0.6;
      lfo.connect(lg).connect(gg.gain);
      o.connect(gg).connect(this.layers.drone);
      o.start();
      lfo.start();
    }
    // a breath of filtered noise under the drone
    const n = c.createBufferSource();
    n.buffer = this.noise;
    n.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 180;
    f.Q.value = 0.8;
    const ng = c.createGain();
    ng.gain.value = 0.05;
    n.connect(f).connect(ng).connect(this.layers.drone);
    n.start();
  }

  private padChord(notes: number[], t: number, dur: number): void {
    const c = this.ctx;
    for (const f of notes) {
      for (const det of [-7, 6]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = det;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.022, t + 2.2);
        g.gain.setValueAtTime(0.022, t + dur - 1.2);
        g.gain.linearRampToValueAtTime(0.0001, t + dur + 1.6);
        o.connect(g).connect(this.padFilter);
        o.start(t);
        o.stop(t + dur + 1.7);
      }
    }
  }

  /**
   * A male choir chord: four voices (oktavist on the root an octave down, a fifth above it, then
   * the chord's root and third), each three slightly detuned saws with its own slow vibrato and a
   * small scoop up into the note, all through one shared vowel (three formant band-passes) that
   * drifts between "o", "a" and a dark "u" from chord to chord.
   */
  private choirChord(chord: number[], root: number, t: number, dur: number, index: number, dest: AudioNode = this.layers.choir, level = 1): void {
    const c = this.ctx;
    const VOW: [number, number, number][] = [
      [520, 860, 2450], // o
      [650, 1080, 2450], // a
      [430, 780, 2350], // u (dark)
      [560, 900, 2400],
    ];
    const v = VOW[index % VOW.length]!;
    const sum = c.createGain();
    sum.gain.value = 1;
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.25 * level, t + 2);
    env.gain.setValueAtTime(0.25 * level, t + dur - 1);
    env.gain.linearRampToValueAtTime(0.0001, t + dur + 1.8);
    for (const [i, [q, g]] of ([
      [5, 1],
      [8, 0.5],
      [11, 0.16],
    ] as const).entries()) {
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = v[i]!;
      f.Q.value = q;
      const fg = c.createGain();
      fg.gain.value = g * 4;
      sum.connect(f).connect(fg).connect(env);
    }
    env.connect(dest);
    const end = t + dur + 1.9;
    const voices = [root, root * 1.5, chord[0]!, chord[1]!];
    voices.forEach((f0, vi) => {
      const vib = c.createOscillator();
      vib.frequency.value = 4.6 + Math.random() * 0.9;
      const vg = c.createGain();
      // vibrato blooms after the attack
      vg.gain.setValueAtTime(0, t);
      vg.gain.linearRampToValueAtTime(f0 * 0.009, t + 1.6);
      vib.connect(vg);
      const vGain = vi === 0 ? 1.25 : vi === 1 ? 0.7 : 0.85;
      for (const det of [-9, 1, 8]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.detune.value = det + (Math.random() - 0.5) * 4;
        o.frequency.setValueAtTime(f0 * 0.97, t);
        o.frequency.linearRampToValueAtTime(f0, t + 0.3 + Math.random() * 0.2);
        vg.connect(o.frequency);
        const og = c.createGain();
        og.gain.value = vGain / 3;
        o.connect(og).connect(sum);
        o.start(t);
        o.stop(end);
      }
      vib.start(t);
      vib.stop(end);
    });
  }

  /** A low church bell somewhere across the city: inharmonic partials, a minor-third hum, a long tail. */
  private knell(f: number, t: number, dest: AudioNode = this.layers.shimmer): void {
    const c = this.ctx;
    for (const [ratio, gain, len] of [
      [0.5, 0.05, 7],
      [1, 0.06, 5],
      [1.19, 0.035, 4], // the minor third that makes a bell sound like a bell
      [1.5, 0.02, 3],
      [2, 0.025, 3],
      [2.67, 0.012, 2],
    ] as const) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * ratio;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      const far = c.createBiquadFilter();
      far.type = 'lowpass';
      far.frequency.value = 1400;
      o.connect(far).connect(g);
      g.connect(dest);
      g.connect(this.reverb);
      o.start(t);
      o.stop(t + len + 0.1);
    }
  }

  private bell(f: number, t: number, dest: AudioNode = this.layers.shimmer): void {
    const c = this.ctx;
    for (const [ratio, gain] of [
      [1, 0.05],
      [2.76, 0.015],
      [5.4, 0.006],
    ] as const) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * ratio;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 3.5 / ratio);
      o.connect(g);
      g.connect(dest);
      g.connect(this.reverb);
      o.start(t);
      o.stop(t + 3.6);
    }
  }

  private pluck(f: number, t: number, accent: number): void {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const flt = c.createBiquadFilter();
    flt.type = 'lowpass';
    flt.Q.value = 6;
    flt.frequency.setValueAtTime(200 + 900 * accent, t);
    flt.frequency.exponentialRampToValueAtTime(90, t + 0.22);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16 * accent, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    o.connect(flt).connect(g).connect(this.layers.pulse);
    o.start(t);
    o.stop(t + 0.3);
  }

  private kick(t: number, v: number): void {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(34, t + 0.35);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.55 * v, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g).connect(this.layers.drums);
    o.start(t);
    o.stop(t + 0.65);
    this.noiseHit(t, 'lowpass', 900, 0.12, 0.1 * v, this.layers.drums);
  }

  private metal(t: number): void {
    this.noiseHit(t, 'bandpass', 3200, 0.25, 0.12, this.layers.drums, 3);
    const c = this.ctx;
    for (const f of [523, 1187]) {
      const o = c.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.02, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g);
      g.connect(this.layers.drums);
      g.connect(this.reverb);
      o.start(t);
      o.stop(t + 0.4);
    }
  }

  private tom(t: number, f: number): void {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.12);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(this.layers.drums);
    o.start(t);
    o.stop(t + 0.32);
  }

  private noiseHit(t: number, type: BiquadFilterType, freq: number, dur: number, gain: number, dest: AudioNode, q = 0.7): void {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  // ---------------------------------------------------------------- stingers
  stinger(kind: 'spotted' | 'checkpoint' | 'objective' | 'success' | 'failure'): void {
    const c = this.ctx;
    const t = c.currentTime + 0.02;
    const chord = (notes: number[], type: OscillatorType, dur: number, gain: number, attack = 0.01) => {
      for (const f of notes) {
        const o = c.createOscillator();
        o.type = type;
        o.frequency.value = f;
        const flt = c.createBiquadFilter();
        flt.type = 'lowpass';
        flt.frequency.setValueAtTime(3200, t);
        flt.frequency.exponentialRampToValueAtTime(400, t + dur);
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain, t + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(flt).connect(g);
        g.connect(this.bus);
        g.connect(this.reverb);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
    };
    switch (kind) {
      case 'spotted':
        // dissonant brass-like stab: D + Eb clash over a low hit
        chord([73.42, 146.83, 155.56, 220], 'sawtooth', 1.6, 0.06, 0.005);
        this.kick(t, 1.3);
        this.noiseHit(t, 'highpass', 2500, 0.5, 0.08, this.bus);
        break;
      case 'checkpoint':
        this.bell(880, t, this.bus);
        this.bell(1174.66, t + 0.18, this.bus);
        break;
      case 'objective':
        this.bell(698.46, t, this.bus);
        this.bell(1046.5, t + 0.12, this.bus);
        break;
      case 'success':
        chord([146.83, 220, 293.66, 369.99], 'triangle', 4.5, 0.05, 0.6); // D major: the score finally resolves
        this.choirChord([146.83, 185.0], 73.42, t, 4, 1, this.bus, 1.2); // and the choir with it
        this.bell(1174.66, t + 0.4, this.bus);
        this.knell(73.42, t + 0.2, this.bus);
        break;
      case 'failure':
        chord([73.42, 77.78, 110], 'sawtooth', 4, 0.05, 0.3);
        this.choirChord([146.83, 174.61], 73.42, t, 3.5, 2, this.bus, 1);
        break;
    }
  }
}
