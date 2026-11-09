import { describe, it, expect } from 'vitest';
import { planUtterance, revealAt, mouthAt, levelAt, voiceFor, babble, CREW_VOICES } from '../src/client/sound/voice';
import { portraitSvg, speaker } from '../src/client/three/portraits';

const line = 'Contact front! Two tanks at the bridge, moving east.';

describe('radio voice planning', () => {
  it('is deterministic for the same speaker and text', () => {
    const a = planUtterance(line, voiceFor('Gunner'));
    const b = planUtterance(line, voiceFor('Gunner'));
    expect(a).toEqual(b);
  });

  it('reveals the subtitle monotonically and completely by the end', () => {
    const u = planUtterance(line, voiceFor('Commander'));
    let prev = 0;
    for (let t = 0; t <= u.dur; t += 0.02) {
      const n = revealAt(u, t);
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
    expect(revealAt(u, u.dur)).toBe(line.length);
    expect(revealAt(u, u.dur * 0.5)).toBeLessThan(line.length);
    expect(revealAt(u, u.dur * 0.5)).toBeGreaterThan(line.length * 0.2);
  });

  it('speaks at roughly the speaker rate, faster on a busy channel', () => {
    const v = voiceFor('Driver');
    const u = planUtterance(line, v);
    const cps = line.length / u.dur;
    expect(cps).toBeGreaterThan(v.rate * 0.6);
    expect(cps).toBeLessThan(v.rate * 1.5);
    expect(planUtterance(line, v, 1.4).dur).toBeLessThan(u.dur * 0.85);
  });

  it('gives each crew member a distinct voice and strangers a stable one', () => {
    const pitches = Object.keys(CREW_VOICES).map((k) => voiceFor(k).pitch);
    expect(new Set(pitches).size).toBe(pitches.length);
    expect(voiceFor('Hauptmann Weiss (enemy)')).toEqual(voiceFor('Hauptmann Weiss'));
  });

  it('raises the pitch at the end of a question', () => {
    const v = voiceFor('Loader');
    const q = planUtterance('Are we clear to move', v);
    const qq = planUtterance('Are we clear to move?', v);
    const lastVoiced = (u: typeof q) => [...u.segs].reverse().find((s) => s.v > 0.5)!.p;
    expect(lastVoiced(qq)).toBeGreaterThan(lastVoiced(q) * 1.1);
  });

  it('keeps mouth and level in 0..1 and silent after the line', () => {
    const u = planUtterance(line, voiceFor('Gunner'));
    for (let t = 0; t < u.dur; t += 0.03) {
      expect(mouthAt(u, t)).toBeGreaterThanOrEqual(0);
      expect(mouthAt(u, t)).toBeLessThanOrEqual(1);
      expect(levelAt(u, t)).toBeLessThanOrEqual(1);
    }
    expect(mouthAt(u, u.dur + 0.1)).toBe(0);
    expect(levelAt(u, u.dur + 0.1)).toBe(0);
  });

  it('babble is speech-shaped filler', () => {
    let seed = 1;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const b = babble(r);
    expect(b.split(' ').length).toBeGreaterThanOrEqual(2);
    expect(planUtterance(b, voiceFor('net3')).dur).toBeGreaterThan(0.4);
  });
});

describe('comms portraits', () => {
  it('has a face with mouth shapes, eyes and brows for every crew member and intercepts', () => {
    for (const who of ['Commander', 'Driver', 'Gunner', 'Loader']) {
      const s = portraitSvg(who, false);
      for (const part of ['class="m0"', 'class="m1"', 'class="m2"', 'class="eyes"', 'class="brows"', 'class="head"']) expect(s).toContain(part);
      expect(speaker(who, false).tag.length).toBeGreaterThan(1);
    }
    expect(portraitSvg('Hauptmann', true)).toContain('class="head"');
    expect(speaker('Hauptmann', true).tag).toBe('FEIND');
  });
});
