// Radio treatment for dialogue. The words are never intelligible: `voice.ts` synthesises a speech-
// shaped voice per speaker that the comms panel follows letter by letter.
//
// Crew lines (`transmit`): the press-to-talk clunk, squelch, the engine bleeding into the mic, the
// voice through a honky radio band, the squelch tail. Intercepted enemy traffic is quieter, fades in
// and out, breaks up, and carries a heterodyne whistle. `netChatter` is distant traffic between
// other units, heard faintly between lines.
//
// Garrison barks (speech-bubble callouts in the 3D view) use `bark`: the same radio voice, panned to
// the speaker, with a crackle bed and a per-situation flavour (priority beeps for contact, a static
// burst and dropouts when hit, a soft keyed-up murmur when calm). Barks may overlap each other but
// never more than a couple at once.

import { babble, planUtterance, renderVoice, voiceFor, type Utterance, type VoiceProfile } from './voice';

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
  /** Voices enter here: a presence peak (the small-speaker honk) ahead of the band. */
  private voiceIn: AudioNode;
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
    const honk = ctx.createBiquadFilter();
    honk.type = 'peaking';
    honk.frequency.value = 1700;
    honk.Q.value = 1.1;
    honk.gain.value = 6;
    honk.connect(hp);
    this.voiceIn = honk;
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
    const base = voiceFor(b.from);
    const calm = b.flavour === 'calm';
    const voice: VoiceProfile = { ...base, pitch: base.pitch * (calm ? 0.95 : b.flavour === 'alert' ? 1.04 : 1.16), range: base.range * (calm ? 0.8 : 1.3) };
    const u = planUtterance(b.text, voice, calm ? 1.05 : b.flavour === 'alert' ? 1.2 : 1.35);
    const dur = u.dur;
    this.crackleBed(t - 0.04, dur + 0.12, b.flavour === 'hit' ? 1.6 : calm ? 0.6 : 1, pan);
    this.staticBed(t, dur, calm ? 0.9 : 1.4, pan);
    renderVoice(this.ctx, u, voice, t + 0.02, pan, this.noise, { level: 0.22, dropouts: b.flavour === 'hit' ? 2.5 : calm ? 0.3 : 0.8 });
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

  /**
   * A dialogue line, starting now. The comms panel owns the queue and the timing; this only makes
   * the sound. Returns the seconds the channel is busy.
   */
  transmit(u: Utterance, voice: VoiceProfile, enemy: boolean): number {
    const c = this.ctx;
    const t0 = c.currentTime + 0.03;
    const end = t0 + 0.12 + u.dur;
    if (enemy) {
      // an intercepted transmission: weak, fading, broken up, with a heterodyne whistle
      const fade = c.createGain();
      fade.gain.value = 0.5;
      const lfo = c.createOscillator();
      lfo.frequency.value = 0.35 + Math.random() * 0.3;
      const lfoG = c.createGain();
      lfoG.gain.value = 0.17;
      lfo.connect(lfoG).connect(fade.gain);
      fade.connect(this.voiceIn);
      this.squelch(t0, 0.45, true);
      this.staticBed(t0 + 0.04, u.dur + 0.1, 1.9);
      this.crackleBed(t0, u.dur + 0.15, 1.3, this.band);
      this.whistle(t0 + 0.05, u.dur + 0.05, 0.016);
      renderVoice(c, u, voice, t0 + 0.12, fade, this.noise, { level: 0.5, dropouts: 1.6 });
      this.squelch(end + 0.04, 0.45, false);
      lfo.start(t0);
      lfo.stop(end + 0.3);
      setTimeout(() => fade.disconnect(), (end - c.currentTime + 0.6) * 1000);
    } else {
      this.ptt(t0);
      this.squelch(t0 + 0.03, 0.7, true);
      this.staticBed(t0 + 0.06, u.dur + 0.06, 0.8);
      this.engineBleed(t0 + 0.05, u.dur + 0.12);
      renderVoice(c, u, voice, t0 + 0.12, this.voiceIn, this.noise, { level: 0.4, dropouts: 0.12 });
      this.squelch(end + 0.04, 0.85, false);
      this.tail(end + 0.05);
    }
    return end + 0.3 - c.currentTime;
  }

  /** Distant traffic between other units on the net: faint, broken, never understood. */
  netChatter(): number {
    const c = this.ctx;
    const voice = voiceFor('net' + Math.floor(Math.random() * 9));
    const u = planUtterance(babble(), voice, 1.15);
    const t0 = c.currentTime + 0.03;
    const pan = c.createStereoPanner();
    pan.pan.value = (Math.random() - 0.5) * 0.7;
    const far = c.createBiquadFilter();
    far.type = 'lowpass';
    far.frequency.value = 1900;
    const g = c.createGain();
    g.gain.value = 0.26;
    pan.connect(far).connect(g).connect(this.voiceIn);
    this.squelch(t0, 0.25, true, pan);
    this.staticBed(t0 + 0.03, u.dur + 0.1, 1.6, pan);
    if (Math.random() < 0.5) this.whistle(t0, u.dur, 0.008, pan);
    renderVoice(c, u, voice, t0 + 0.08, pan, this.noise, { level: 0.5, dropouts: 2 });
    this.squelch(t0 + u.dur + 0.12, 0.25, false, pan);
    setTimeout(() => pan.disconnect(), (u.dur + 1) * 1000);
    return u.dur + 0.2;
  }

  /** The press-to-talk switch: a dull mechanical clunk through the mic. */
  private ptt(t: number): void {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(420, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.03);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    o.connect(g).connect(this.band);
    o.start(t);
    o.stop(t + 0.06);
  }

  /** The tank: hull rumble and track clatter leaking into an open mic. */
  private engineBleed(t: number, dur: number): void {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.playbackRate.value = 0.5;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 430;
    f.Q.value = 0.9;
    const am = c.createGain();
    am.gain.value = 0.5;
    const lfo = c.createOscillator();
    lfo.frequency.value = 11 + Math.random() * 3; // the diesel's firing pulse
    const lfoG = c.createGain();
    lfoG.gain.value = 0.35;
    lfo.connect(lfoG).connect(am.gain);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.11, t + 0.06);
    g.gain.setValueAtTime(0.11, t + dur - 0.06);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(am).connect(g).connect(this.band);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
  }

  /** The squelch tail after the key is released: a short rush of open-channel noise. */
  private tail(t: number): void {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2000;
    f.Q.value = 0.5;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    s.connect(f).connect(g).connect(this.band);
    s.start(t, Math.random());
    s.stop(t + 0.2);
  }

  /** Heterodyne whistle of a badly tuned channel, drifting. */
  private whistle(t: number, dur: number, level: number, dest: AudioNode = this.band): void {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    const f0 = 900 + Math.random() * 900;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f0 * (0.9 + Math.random() * 0.25), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level, t + 0.2);
    g.gain.setValueAtTime(level, t + Math.max(0.2, dur - 0.1));
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
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
}
