// Indistinct radio voices. A line of text is turned into a deterministic "utterance": a timeline of
// letter-shaped segments (vowels with formant targets, nasals and liquids, hiss for fricatives, a
// closure and a burst for plosives, pauses for spaces and punctuation) with a sentence pitch
// contour (declination, stressed syllables, a rise on questions, a lift on exclamations).
//
// Accents: the English subtitle is not what is "said". Each word is respoken as a pseudo-word of
// the speaker's language, stable per word (the same English word always sounds the same), with
// that language's sound and melody. Our crew speak a Slavic tongue: palatal glides, rolled r, hard
// clusters, the ы vowel, strong stress, and Russian-style intonation (a sharp fall on the key word
// in statements, a rise-fall on it in questions). The Directorate's troops speak a Germanic one:
// glottal onsets, uvular r, sch/ch hiss, umlauts, declining statements and rising questions.
// The subtitle reveal still follows the English text, word by word.
//
// The same plan drives both sides: `renderVoice` synthesises it (one glottal source through three
// gliding formant filters, plus a hiss channel), and the comms panel reads it to reveal the
// subtitle in step with the voice and to move the speaker's mouth. Planning is pure and has no
// DOM or WebAudio dependency, so it is unit-tested.

export interface VoiceProfile {
  /** Speaking pitch in Hz. */
  pitch: number;
  /** Formant scale: below 1 is a longer vocal tract (bigger, darker voice). */
  formant: number;
  /** Characters per second. */
  rate: number;
  /** Vocal fry / gravel 0..1. */
  rasp: number;
  /** Breathiness 0..1. */
  breath: number;
  /** Pitch range of the intonation, as a fraction of the pitch. */
  range: number;
  /** The language the voice speaks (see the header). */
  accent?: Accent;
}

export type Accent = 'slavic' | 'germanic';

/** The crew's voices. Anyone else gets a stable voice derived from their name. */
export const CREW_VOICES: Record<string, VoiceProfile> = {
  Commander: { pitch: 96, formant: 0.95, rate: 14, rasp: 0.4, breath: 0.1, range: 0.22, accent: 'slavic' },
  Driver: { pitch: 132, formant: 1.02, rate: 16.5, rasp: 0.12, breath: 0.12, range: 0.32, accent: 'slavic' },
  Gunner: { pitch: 196, formant: 1.15, rate: 15, rasp: 0.06, breath: 0.22, range: 0.28, accent: 'slavic' },
  Loader: { pitch: 84, formant: 0.9, rate: 12.5, rasp: 0.6, breath: 0.14, range: 0.2, accent: 'slavic' },
};

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rng(seed: number): () => number {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A speaker's voice. The crew have fixed voices; anyone else is stable per name, speaking `accent`. */
export function voiceFor(from: string, accent: Accent = 'germanic'): VoiceProfile {
  const key = from.replace(/\s*\(enemy\)$/, '');
  const crew = CREW_VOICES[key];
  if (crew) return crew;
  const h = hashStr(key);
  return {
    pitch: 86 + (h % 64),
    formant: 0.9 + ((h >>> 7) % 14) / 100,
    rate: 14 + ((h >>> 11) % 4),
    rasp: 0.2 + ((h >>> 15) % 5) / 10,
    breath: 0.1 + ((h >>> 19) % 3) / 20,
    range: 0.2 + ((h >>> 21) % 3) / 20,
    accent,
  };
}

// ---------------------------------------------------------------- pseudo-languages

const LEXICON: Record<Accent, Record<string, string>> = {
  slavic: {
    yes: 'tak', no: 'net', contact: 'kontakt', fire: 'agon', enemy: 'prativnik', tank: 'tank', tanks: 'tanki',
    commander: 'kamandir', loaded: 'zarjazheno', go: 'pashli', move: 'fperjod', stop: 'stoj', left: 'nalevo',
    right: 'naprava', bridge: 'most', quiet: 'tikha', copy: 'prinjal', understood: 'panjal', sir: 'tavarishch',
    wait: 'zhdi', now: 'sejchas', careful: 'astarozhna', here: 'zdes', there: 'tam', one: 'adin', two: 'dva',
    three: 'tri', four: 'chetyre', we: 'my', they: 'ani', behind: 'szadi', ahead: 'fperedi', gate: 'varota',
    the: '', a: '', an: '', is: '', are: '', and: 'i', to: 'k', in: 'v', on: 'na', of: '', it: 'ano', good: 'kharasho',
  },
  germanic: {
    yes: 'ja', no: 'nein', contact: 'kontakt', fire: 'fojer', enemy: 'faind', there: 'dort', movement: 'bevegung',
    nothing: 'nichts', reloading: 'nachladen', hit: 'trefer', down: 'ausgefalen', here: 'hir', where: 'vo',
    go: 'los', stop: 'shtop', what: 'vas', quiet: 'ruhe', listen: 'horch', engine: 'motor', check: 'prüfen',
    the: 'der', a: 'ain', and: 'und', is: 'ist', to: 'tsu', in: 'im', we: 'vir', all: 'ale', units: 'ainhaiten',
    sector: 'sektor', four: 'fir', two: 'tsvai', bridges: 'brüken', close: 'shlisen', i: 'ich', you: 'du',
  },
};

const SYL: Record<Accent, { on: string[]; v: string[]; co: string[]; short: string[]; end: string[] }> = {
  slavic: {
    on: ['', '', 'k', 'p', 't', 'd', 'b', 'v', 'z', 's', 'm', 'n', 'l', 'r', 'g', 'zh', 'sh', 'ch', 'shch', 'pr', 'tr', 'kr', 'vr', 'str', 'zv', 'sv', 'sk', 'dv', 'gr', 'br', 'pl', 'vl', 'sl', 'ts', 'kh', 'zdr', 'vz', 'mn'],
    v: ['a', 'a', 'o', 'e', 'i', 'u', 'ы', 'ja', 'jo', 'ju', 'je', 'a', 'i'],
    co: ['', '', '', 'k', 't', 'v', 'sh', 'm', 'n', 'l', 'r', 'st', 'zh', 'j', 'sk', 'ch'],
    short: ['i', 'a', 'v', 's', 'k', 'na', 'po', 'ne', 'da', 'vo', 'za', 'ot', 'u', 'ja', 'my', 'on', 'ty', 'zhe'],
    end: ['ov', 'aja', 'ыj', 'ost', 'enije', 'ka', 'nik', 'ets', 'ski'],
  },
  germanic: {
    on: ['', '', 'k', 't', 'd', 'b', 'g', 'f', 'v', 'ts', 'sch', 'schl', 'schv', 'st', 'sp', 'pf', 'kr', 'tr', 'gr', 'br', 'fr', 'h', 'm', 'n', 'l', 'r'],
    v: ['a', 'e', 'i', 'o', 'u', 'ä', 'ö', 'ü', 'ai', 'au', 'ie', 'a', 'e'],
    co: ['', '', 'n', 'r', 't', 'ch', 'ng', 'k', 'st', 's', 'l', 'm', 'nd', 'cht', 'ts'],
    short: ['und', 'der', 'die', 'das', 'ja', 'ist', 'tsu', 'im', 'an', 'es', 'so', 'vir', 'hier'],
    end: ['en', 'er', 'ung', 'lich', 'kait', 'ten', 'heit'],
  },
};

/** A pseudo-word standing in for `word`: same word, same sound; length roughly follows. */
function pseudoWord(word: string, accent: Accent): string {
  const w = word.toLowerCase();
  const lex = LEXICON[accent][w];
  if (lex !== undefined) return lex;
  const L = SYL[accent];
  const r = rng(hashStr(accent + w));
  const pick = (a: string[]) => a[Math.floor(r() * a.length)]!;
  if (w.length <= 2) return pick(L.short);
  const syl = Math.max(1, Math.round(w.length / (accent === 'slavic' ? 2.6 : 3)));
  let out = '';
  for (let k = 0; k < syl; k++) {
    out += pick(L.on) + pick(L.v);
    if (r() < 0.35 || k === syl - 1) out += pick(L.co);
  }
  if (syl >= 2 && r() < 0.45) out += pick(L.end);
  return out;
}

/**
 * What is actually said for `text`, and for each spoken character how much of the subtitle it
 * reveals. Without an accent this is the text itself.
 */
export function speakAs(text: string, accent: Accent | undefined): { s: string; map: number[] } {
  if (!accent) {
    const s = text.toLowerCase();
    return { s, map: [...s].map((_, i) => i + 1) };
  }
  let s = '';
  const map: number[] = [];
  const re = /[\p{L}']+|[0-9]+|[\s\S]/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const tok = m[0];
    const at = m.index;
    if (/^[\p{L}0-9']+$/u.test(tok) && /[\p{L}0-9]/u.test(tok)) {
      let p = pseudoWord(tok.replace(/'/g, ''), accent);
      if (!p) {
        // a dropped word (Slavic has no articles): it is revealed with the next spoken sound
        continue;
      }
      if (p.length && s.length && !/\s$/.test(s) && /[\p{L}]/u.test(s[s.length - 1]!)) p = ' ' + p;
      for (let k = 0; k < p.length; k++) {
        s += p[k];
        map.push(at + Math.max(1, Math.round(((k + 1) / p.length) * tok.length)));
      }
    } else {
      s += tok.toLowerCase();
      map.push(at + tok.length);
    }
  }
  return { s, map };
}

type F3 = [number, number, number];

const VOWEL: Record<string, F3> = {
  a: [730, 1090, 2440],
  e: [530, 1840, 2480],
  i: [300, 2200, 2950],
  o: [570, 840, 2410],
  u: [320, 870, 2240],
  y: [380, 1950, 2550],
  ä: [660, 1700, 2400],
  ö: [460, 1480, 2380],
  ü: [300, 1700, 2200],
  ы: [440, 1450, 2400],
};
const VOICED: Record<string, F3> = {
  m: [280, 1250, 2250],
  n: [280, 1700, 2500],
  l: [380, 1200, 2600],
  r: [430, 1350, 1700],
  w: [320, 760, 2300],
  j: [290, 2150, 2900],
};
/** Hiss: centre frequency, level, and how much voicing goes with it. */
const FRIC: Record<string, [number, number, number]> = {
  s: [4200, 0.5, 0],
  z: [4000, 0.32, 0.3],
  c: [4200, 0.42, 0],
  f: [2600, 0.24, 0],
  v: [2400, 0.14, 0.32],
  h: [1500, 0.22, 0],
};
/** Plosives: burst frequency and whether the closure is voiced. */
const PLOS: Record<string, [number, boolean]> = {
  p: [800, false],
  b: [700, true],
  t: [3200, false],
  d: [2800, true],
  k: [1800, false],
  g: [1700, true],
  q: [1800, false],
  x: [1800, false],
};

export interface Seg {
  /** Start (s) and length (s). */
  t: number;
  d: number;
  /** Characters of the text revealed once this segment starts. */
  ci: number;
  /** Voicing level 0..1. */
  v: number;
  /** Hiss level 0..1 and its centre frequency. */
  n: number;
  nf: number;
  /** Formant targets (Hz, before the speaker's scale). */
  f: F3;
  /** Pitch (Hz). */
  p: number;
  /** A rolled r: the voicing flutters. */
  trill?: boolean;
}

export interface Utterance {
  text: string;
  dur: number;
  segs: Seg[];
}

interface Raw {
  d: number;
  ci: number;
  v: number;
  n: number;
  nf: number;
  f: F3 | null;
  vowel: boolean;
  stress: boolean;
  sentence: number;
  trill?: boolean;
}

const NEUTRAL: F3 = [500, 1500, 2500];

/** Plan how `text` is spoken by `voice`. `speed` > 1 speaks faster (a busy channel). */
export function planUtterance(text: string, voice: VoiceProfile, speed = 1): Utterance {
  const r = rng(hashStr(text) ^ Math.round(voice.pitch * 977));
  const u = 1 / (voice.rate * speed);
  const raw: Raw[] = [];
  const accent = voice.accent;
  const slav = accent === 'slavic';
  const germ = accent === 'germanic';
  const spoken = speakAs(text, accent);
  const s = spoken.s;
  const at = (i: number) => spoken.map[Math.min(i, spoken.map.length - 1)] ?? text.length;
  let sentence = 0;
  let wordStressed = false;
  let prevVowel = false;
  const sentences: { exclaim: boolean; question: boolean }[] = [{ exclaim: false, question: false }];
  const push = (x: Omit<Raw, 'sentence'>) => raw.push({ ...x, sentence });
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    const ci = at(i);
    const wordInitial = i === 0 || /[\s,.;:!?—–-]/.test(s[i - 1]!);
    const next = s[i + 1] ?? '';
    const double = i > 0 && s[i - 1] === ch;
    const k = double ? 0.4 : 1;
    if (ch === ' ' || ch === '\n') {
      push({ d: u * (0.25 + r() * 0.15), ci, v: 0, n: 0, nf: 1000, f: null, vowel: false, stress: false });
      wordStressed = false;
      prevVowel = false;
      continue;
    }
    if (/[.!?…]/.test(ch)) {
      if (ch === '!') sentences[sentence]!.exclaim = true;
      if (ch === '?') sentences[sentence]!.question = true;
      // a run of terminators ("?!", "...") is one pause
      const run = /[.!?…]/.test(next);
      push({ d: run ? 0.02 : 0.3 + r() * 0.08, ci, v: 0, n: 0, nf: 1000, f: null, vowel: false, stress: false });
      if (!run) {
        sentence++;
        sentences.push({ exclaim: false, question: false });
      }
      prevVowel = false;
      continue;
    }
    if (/[,;:—–]/.test(ch) || (ch === '-' && s[i - 1] === ' ')) {
      push({ d: ch === ',' ? 0.15 : 0.21, ci, v: 0, n: 0, nf: 1000, f: null, vowel: false, stress: false });
      prevVowel = false;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      // a digit is a short spoken word
      push({ d: u * 1.4, ci, v: 1, n: 0, nf: 1000, f: VOWEL.e!, vowel: true, stress: false });
      push({ d: u * 1.1, ci, v: 0.9, n: 0, nf: 1000, f: VOWEL.i!, vowel: true, stress: false });
      prevVowel = true;
      continue;
    }
    // "y" before a vowel is a glide
    const vf = ch === 'y' && /[aeiou]/.test(next) ? null : VOWEL[ch];
    if (vf) {
      // the first vowel of most words carries the stress; Slavic stress is strong and can fall anywhere
      const isStress = !wordStressed && r() < (slav ? 0.55 : 0.75);
      if (isStress || !slav) wordStressed = true;
      // German: a glottal catch before a word-initial vowel
      if (germ && wordInitial) push({ d: 0.035, ci, v: 0, n: 0.12, nf: 900, f: null, vowel: false, stress: false });
      const len = prevVowel ? 0.7 : isStress ? (slav ? 1.75 : 1.5) : slav ? 0.85 : 1.15;
      push({ d: u * len * k * (0.9 + r() * 0.2), ci, v: isStress ? 1.05 : slav ? 0.78 : 0.88, n: 0, nf: 1000, f: vf, vowel: true, stress: isStress });
      prevVowel = true;
      continue;
    }
    prevVowel = false;
    if (ch === 'r' && slav) {
      // rolled r
      push({ d: u * 1.05 * k, ci, v: 0.62, n: 0, nf: 1000, f: VOICED.r!, vowel: false, stress: false, trill: true });
      continue;
    }
    if (ch === 'r' && germ) {
      // uvular r: a voiced rasp
      push({ d: u * 0.8 * k, ci, v: 0.32, n: 0.22, nf: 1200, f: [460, 1250, 2300], vowel: false, stress: false });
      continue;
    }
    const vo = ch === 'y' ? VOICED.j : germ && ch === 'w' ? undefined : VOICED[ch];
    if (vo) {
      push({ d: u * 0.85 * k, ci, v: 0.5, n: 0, nf: 1000, f: vo, vowel: false, stress: false });
      continue;
    }
    // digraphs and clusters: sch / shch / sh / ch / th / kh / zh become one hiss
    if (ch === 's' && next === 'c' && s[i + 2] === 'h') {
      push({ d: u * 1.2, ci: at(i + 2), v: 0, n: 0.6, nf: 2500, f: null, vowel: false, stress: false });
      i += 2;
      continue;
    }
    if ((ch === 's' || ch === 'c' || ch === 't' || ch === 'k' || ch === 'z') && next === 'h') {
      const nf = ch === 't' ? 3000 : ch === 'k' || (ch === 'c' && germ) ? 1600 : ch === 'z' ? 2300 : 2500;
      const voiced = ch === 'z' ? 0.32 : 0;
      push({ d: u * 1.1, ci: at(i + 1), v: voiced, n: ch === 't' ? 0.2 : ch === 'z' ? 0.42 : 0.55, nf, f: voiced ? [300, 1700, 2500] : null, vowel: false, stress: false });
      i++;
      continue;
    }
    const fr = FRIC[germ && ch === 'w' ? 'v' : ch];
    if (fr && !(ch === 'c' && /[aouklr]/.test(next))) {
      push({ d: u * 0.95 * k, ci, v: fr[2], n: fr[1], nf: fr[0], f: fr[2] > 0 ? [300, 1600, 2500] : null, vowel: false, stress: false });
      continue;
    }
    const pl = PLOS[ch === 'c' ? 'k' : ch];
    if (pl) {
      push({ d: u * 0.42 * k, ci, v: pl[1] ? 0.14 : 0, n: 0, nf: pl[0], f: pl[1] ? [250, 1000, 2400] : null, vowel: false, stress: false });
      push({ d: u * 0.3, ci, v: 0, n: 0.6, nf: pl[0], f: null, vowel: false, stress: false });
      if (ch === 'x') push({ d: u * 0.8, ci, v: 0, n: 0.5, nf: 4200, f: null, vowel: false, stress: false });
      continue;
    }
    // anything else (quotes, apostrophes, symbols) is silent and reveals with the next segment
  }

  // intonation per sentence
  const bySentence = new Map<number, number[]>();
  raw.forEach((x, idx) => {
    const a = bySentence.get(x.sentence) ?? [];
    a.push(idx);
    bySentence.set(x.sentence, a);
  });
  const pitches: number[] = new Array(raw.length).fill(voice.pitch);
  for (const [si, idxs] of bySentence) {
    const info = sentences[si] ?? { exclaim: false, question: false };
    if (slav) {
      slavicContour(raw, idxs, info, voice, r, pitches);
      continue;
    }
    const n = idxs.length;
    let lastVowel = -1;
    idxs.forEach((idx, j) => {
      const x = n > 1 ? j / (n - 1) : 0;
      let p = voice.pitch * (1 + voice.range * (0.35 - 0.6 * x));
      if (info.exclaim) p *= 1.14;
      if (raw[idx]!.stress) p *= 1 + voice.range * (info.exclaim ? 0.75 : 0.5);
      if (info.question && x > 0.7) p *= 1 + voice.range * 1.3 * ((x - 0.7) / 0.3);
      p *= 1 + (r() - 0.5) * 0.05;
      pitches[idx] = p;
      if (raw[idx]!.vowel) lastVowel = idx;
    });
    if (!info.question && lastVowel >= 0) pitches[lastVowel]! *= 0.9;
    if (info.exclaim) for (const idx of idxs) raw[idx]!.v = Math.min(1.15, raw[idx]!.v * 1.12);
  }

  const segs: Seg[] = [];
  let t = 0.04;
  let lastF: F3 = NEUTRAL;
  raw.forEach((x, idx) => {
    const f = x.f ?? lastF;
    if (x.f) lastF = x.f;
    segs.push({ t, d: x.d, ci: x.ci, v: x.v, n: x.n, nf: x.nf, f, p: pitches[idx]!, ...(x.trill ? { trill: true } : {}) });
    t += x.d;
  });
  // trailing silence for the voice to decay
  segs.push({ t, d: 0.12, ci: text.length, v: 0, n: 0, nf: 1000, f: lastF, p: voice.pitch * 0.85 });
  t += 0.12;
  return { text, dur: t, segs };
}

/**
 * Russian-style intonation. The melody hangs level, then everything happens on the key word (the
 * last stressed syllable; the first one in an exclamation): statements fall sharply there and stay
 * low, questions jump up on it and fall straight after, exclamations peak early and then fall.
 */
function slavicContour(raw: Raw[], idxs: number[], info: { exclaim: boolean; question: boolean }, voice: VoiceProfile, r: () => number, pitches: number[]): void {
  const stressed = idxs.filter((i) => raw[i]!.stress);
  const vowels = idxs.filter((i) => raw[i]!.vowel);
  const centre = info.exclaim ? (stressed[0] ?? vowels[0]) : (stressed[stressed.length - 1] ?? vowels[vowels.length - 1]);
  const P = voice.pitch;
  const R = voice.range;
  let after = false;
  idxs.forEach((idx, j) => {
    const x = idxs.length > 1 ? j / (idxs.length - 1) : 0;
    let p: number;
    if (idx === centre) {
      p = info.question ? P * (1 + R * 1.7) : info.exclaim ? P * (1 + R * 1.25) : P * (1 - R * 0.2);
      after = true;
    } else if (after) {
      p = info.question ? P * (1 - R * 0.25) : info.exclaim ? P * (1 + R * (0.4 - 0.8 * x)) : P * (1 - R * 0.55);
    } else {
      p = P * (1 + R * (0.12 - 0.12 * x)) * (raw[idx]!.stress ? 1 + R * 0.25 : 1);
    }
    if (info.exclaim) p *= 1.1;
    pitches[idx] = p * (1 + (r() - 0.5) * 0.04);
  });
  if (info.exclaim) for (const idx of idxs) raw[idx]!.v = Math.min(1.15, raw[idx]!.v * 1.12);
}

/** The segment being spoken at `t` seconds into the utterance. */
export function segAt(u: Utterance, t: number): Seg | null {
  if (t < 0 || u.segs.length === 0) return null;
  let lo = 0;
  let hi = u.segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (u.segs[mid]!.t <= t) lo = mid;
    else hi = mid - 1;
  }
  return u.segs[lo]!;
}

/** How many characters of the subtitle have been said by `t`. */
export function revealAt(u: Utterance, t: number): number {
  if (t >= u.dur) return u.text.length;
  return segAt(u, t)?.ci ?? 0;
}

/** Mouth opening 0..1 at `t`: open on open vowels, nearly shut on consonants. */
export function mouthAt(u: Utterance, t: number): number {
  const s = segAt(u, t);
  if (!s || t >= u.dur || s.v < 0.3) return s && s.n > 0.3 ? 0.12 : 0;
  return Math.max(0.15, Math.min(1, s.v * ((s.f[0] - 220) / 480)));
}

/** Loudness 0..1 at `t` (for the panel's level meter). */
export function levelAt(u: Utterance, t: number): number {
  const s = segAt(u, t);
  if (!s || t >= u.dur) return 0;
  return Math.min(1, s.v * 0.85 + s.n * 0.6);
}

const BABBLE = ['ka', 'ro', 'tes', 'vin', 'da', 'nul', 'ber', 'lin', 'kor', 'fel', 'mo', 'stan', 'dre', 'ven', 'ost', 'gru', 'ha', 'kel', 'tor', 'pri', 'zhe', 'vos'];

/** Words for distant traffic on the net: speech-shaped, never meant to be understood. */
export function babble(rand: () => number = Math.random): string {
  const words = 2 + Math.floor(rand() * 4);
  const out: string[] = [];
  for (let w = 0; w < words; w++) {
    const syl = 1 + Math.floor(rand() * 3);
    let word = '';
    for (let k = 0; k < syl; k++) word += BABBLE[Math.floor(rand() * BABBLE.length)]!;
    out.push(word);
  }
  return out.join(' ') + (rand() < 0.3 ? ', ' + BABBLE[Math.floor(rand() * BABBLE.length)] + '.' : '.');
}

export interface VoiceRenderOptions {
  /** Output level. */
  level?: number;
  /** Signal dropouts per second (broken-up reception). */
  dropouts?: number;
}

/**
 * Synthesise an utterance: a sawtooth glottal source with vibrato, a subharmonic for gravel and a
 * breath-noise component, through three formant band-passes that glide between targets; plus a hiss
 * channel for fricatives and plosive bursts. About a dozen nodes per line. Returns the end time.
 */
export function renderVoice(c: BaseAudioContext, u: Utterance, prof: VoiceProfile, t0: number, dest: AudioNode, noise: AudioBuffer, o: VoiceRenderOptions = {}): number {
  const level = o.level ?? 1;
  const end = t0 + u.dur + 0.08;
  const out = c.createGain();
  out.gain.value = level;
  out.connect(dest);

  const osc = c.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = u.segs[0]?.p ?? prof.pitch;
  const fry = c.createOscillator();
  fry.type = 'square';
  fry.frequency.value = (u.segs[0]?.p ?? prof.pitch) / 2;
  const fryG = c.createGain();
  fryG.gain.value = prof.rasp * 0.28;
  const vib = c.createOscillator();
  vib.frequency.value = 5 + (prof.pitch % 7) / 10;
  const vibG = c.createGain();
  vibG.gain.value = prof.pitch * 0.014;
  vib.connect(vibG);
  vibG.connect(osc.frequency);
  vibG.connect(fry.frequency);
  const breath = c.createBufferSource();
  breath.buffer = noise;
  breath.loop = true;
  const breathG = c.createGain();
  breathG.gain.value = prof.breath * 0.5;

  const voicing = c.createGain();
  voicing.gain.value = 0;
  osc.connect(voicing);
  fry.connect(fryG).connect(voicing);
  breath.connect(breathG).connect(voicing);

  const bank = ([
    [1, 5],
    [0.55, 8],
    [0.25, 11],
  ] as const).map(([g, q], k) => {
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = q;
    f.frequency.value = NEUTRAL[k]! * prof.formant;
    const fg = c.createGain();
    fg.gain.value = g * 2.2;
    voicing.connect(f).connect(fg).connect(out);
    return f;
  });

  const hiss = c.createBufferSource();
  hiss.buffer = noise;
  hiss.loop = true;
  const hissF = c.createBiquadFilter();
  hissF.type = 'bandpass';
  hissF.Q.value = 1.6;
  const hissG = c.createGain();
  hissG.gain.value = 0;
  hiss.connect(hissF).connect(hissG).connect(out);

  for (const s of u.segs) {
    const t = t0 + s.t;
    voicing.gain.setTargetAtTime(s.v * 0.5, t, s.v > 0 ? 0.014 : 0.009);
    osc.frequency.setTargetAtTime(s.p, t, 0.03);
    fry.frequency.setTargetAtTime(s.p / 2, t, 0.03);
    bank.forEach((f, k) => f.frequency.setTargetAtTime(s.f[k]! * prof.formant, t, 0.018));
    hissG.gain.setTargetAtTime(s.n * 0.35, t, 0.006);
    if (s.n > 0) hissF.frequency.setValueAtTime(s.nf, t);
    if (s.trill) {
      // tongue taps, ~28 per second
      for (let k = 0.008; k < s.d - 0.012; k += 0.036) {
        voicing.gain.setValueAtTime(s.v * 0.5, t + k);
        voicing.gain.setValueAtTime(s.v * 0.1, t + k + 0.016);
      }
    }
  }
  voicing.gain.setTargetAtTime(0, t0 + u.dur, 0.02);
  hissG.gain.setTargetAtTime(0, t0 + u.dur, 0.01);

  // reception breaking up: short holes in the signal
  const holes = Math.round((o.dropouts ?? 0) * u.dur);
  for (let i = 0; i < holes; i++) {
    const at = t0 + 0.1 + Math.random() * Math.max(0.1, u.dur - 0.2);
    const len = 0.04 + Math.random() * 0.12;
    out.gain.setValueAtTime(level, at);
    out.gain.linearRampToValueAtTime(0.0001, at + 0.01);
    out.gain.setValueAtTime(0.0001, at + len);
    out.gain.linearRampToValueAtTime(level, at + len + 0.015);
  }

  for (const n of [osc, fry, vib, breath, hiss]) {
    n.start(t0);
    n.stop(end);
  }
  setTimeout(() => out.disconnect(), (end - c.currentTime + 0.5) * 1000);
  return end;
}
