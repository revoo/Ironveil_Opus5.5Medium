// Persistent behavioural tendencies and difficulty profiles.
// Difficulty changes perception/reaction/aim/tactics — never HP, damage, vision or turret speed.
import { hashString, Rng } from '../sim/rng';

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface DifficultyProfile {
  reactionMs: [number, number];
  /** Std-dev of per-shot aim error, degrees. */
  aimSigmaDeg: number;
  /** Fraction of target velocity used when leading (1 = perfect). */
  leadSkill: number;
  /** Relative noise on perceived target velocity. */
  velNoise: number;
  /** Seconds a lost contact is remembered. */
  memorySec: number;
  dodgeChance: number;
  smokeUse: number;
  flankUse: number;
  /** Decision cadence in ticks (motor still runs every tick). */
  thinkTicks: number;
  /** Probability of cancelling a poor charged shot rather than forcing it. */
  holdDiscipline: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultyProfile> = {
  easy: { reactionMs: [450, 700], aimSigmaDeg: 6.5, leadSkill: 0.5, velNoise: 0.35, memorySec: 4, dodgeChance: 0.15, smokeUse: 0.35, flankUse: 0.35, thinkTicks: 5, holdDiscipline: 0.3 },
  normal: { reactionMs: [250, 450], aimSigmaDeg: 3.6, leadSkill: 0.82, velNoise: 0.2, memorySec: 7, dodgeChance: 0.42, smokeUse: 0.8, flankUse: 0.75, thinkTicks: 3, holdDiscipline: 0.6 },
  hard: { reactionMs: [150, 300], aimSigmaDeg: 2.0, leadSkill: 0.96, velNoise: 0.1, memorySec: 10, dodgeChance: 0.7, smokeUse: 1, flankUse: 1, thinkTicks: 2, holdDiscipline: 0.85 },
};

export interface Traits {
  aggression: number;
  caution: number;
  patience: number;
  flank: number;
  chargeBias: number;
  stealth: number;
  teamwork: number;
  reflex: number;
  /** Preferred engagement distance, px. */
  preferredRange: number;
}

export interface Persona {
  id: string;
  title: string;
  traits: Traits;
}

export const PERSONAS: Persona[] = [
  { id: 'brawler', title: 'Brawler', traits: { aggression: 0.9, caution: 0.25, patience: 0.2, flank: 0.4, chargeBias: 0.15, stealth: 0.2, teamwork: 0.5, reflex: 0.6, preferredRange: 240 } },
  { id: 'marksman', title: 'Marksman', traits: { aggression: 0.35, caution: 0.6, patience: 0.75, flank: 0.2, chargeBias: 0.9, stealth: 0.5, teamwork: 0.6, reflex: 0.4, preferredRange: 440 } },
  { id: 'stalker', title: 'Stalker', traits: { aggression: 0.5, caution: 0.5, patience: 0.85, flank: 0.7, chargeBias: 0.6, stealth: 0.95, teamwork: 0.4, reflex: 0.5, preferredRange: 320 } },
  { id: 'flanker', title: 'Flanker', traits: { aggression: 0.65, caution: 0.4, patience: 0.4, flank: 0.95, chargeBias: 0.35, stealth: 0.6, teamwork: 0.8, reflex: 0.7, preferredRange: 280 } },
  { id: 'anchor', title: 'Anchor', traits: { aggression: 0.3, caution: 0.8, patience: 0.7, flank: 0.1, chargeBias: 0.55, stealth: 0.4, teamwork: 0.9, reflex: 0.5, preferredRange: 380 } },
  { id: 'scrapper', title: 'Scrapper', traits: { aggression: 0.75, caution: 0.45, patience: 0.35, flank: 0.55, chargeBias: 0.3, stealth: 0.3, teamwork: 0.6, reflex: 0.85, preferredRange: 300 } },
];

export const CALLSIGNS = ['Vance', 'Kestrel', 'Moth', 'Halloran', 'Rook', 'Sable', 'Juno', 'Brask', 'Tarn', 'Wren', 'Oskar', 'Petra', 'Grail', 'Ivo'];

/** Deterministic persona per callsign so a bot keeps its character across matches. */
export function personaFor(name: string): Persona {
  return PERSONAS[hashString(name) % PERSONAS.length]!;
}

/** Small persistent per-bot variation on top of the persona. */
export function individualTraits(name: string, base: Traits, override: Partial<Traits> = {}): Traits {
  const r = new Rng(hashString(name) ^ 0xa11ce);
  const j = (v: number) => Math.min(1, Math.max(0, v + (r.next() - 0.5) * 0.16));
  return {
    aggression: j(base.aggression),
    caution: j(base.caution),
    patience: j(base.patience),
    flank: j(base.flank),
    chargeBias: j(base.chargeBias),
    stealth: j(base.stealth),
    teamwork: j(base.teamwork),
    reflex: j(base.reflex),
    preferredRange: base.preferredRange + (r.next() - 0.5) * 60,
    ...override,
  };
}
