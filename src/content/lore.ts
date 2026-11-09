// The setting's names, in one place so they are easy to change. See docs/SETTING.md.
//
// Both nations are fictional. Ours is a Slavic people's republic with Soviet leanings; the enemy is
// a Germanic-speaking, bureaucratic, walled state in the spirit of a paper-pushing border regime.
// It deliberately carries no Nazi or Third-Reich symbolism: no eagles, no black-white-red, no
// blackletter, no SS-style ranks. Its colours are slate grey and ochre, its emblem a gate tower.

export const LORE = {
  us: {
    /** Short name, used in English text. */
    name: 'Vostrava',
    adjective: 'Vostravan',
    long: "People's Republic of Vostrava",
    /** Native spelling (Cyrillic). */
    native: 'Вострава',
    army: "People's Armoured Guard",
    /** The crew's tank radio set, shown on the comms panel. */
    radioSet: 'Р-123',
  },
  them: {
    name: 'Graustein',
    adjective: 'Grausteiner',
    long: 'Directorate of Graustein',
    /** How our crew write it (Cyrillic). */
    native: 'Граустайн',
    army: 'Directorate Border Troops',
  },
} as const;

export interface CrewMember {
  /** Full name, rank abbreviation and surname (English text). */
  name: string;
  rank: string;
  surname: string;
  /** What the crew call them. */
  nick: string;
  /** Surname in Cyrillic. */
  native: string;
  /** Crew position in our language. */
  roleNative: string;
}

/** The crew of tank 412, keyed by the `from` id used in mission data. */
export const CREW: Record<string, CrewMember> = {
  Commander: { name: 'Oleg Rusakov', rank: 'Lt.', surname: 'Rusakov', nick: 'Rusakov', native: 'Русаков', roleNative: 'командир' },
  Driver: { name: 'Pavel Gromov', rank: 'Sgt.', surname: 'Gromov', nick: 'Pasha', native: 'Громов', roleNative: 'механик-водитель' },
  Gunner: { name: 'Vera Lisitsyna', rank: 'Cpl.', surname: 'Lisitsyna', nick: 'Vera', native: 'Лисицына', roleNative: 'наводчица' },
  Loader: { name: 'Bogdan Kuzmich', rank: 'Pvt.', surname: 'Kuzmich', nick: 'Bogdan', native: 'Кузьмич', roleNative: 'заряжающий' },
};

/** How a radio speaker is named on screen: "Lt. Rusakov" for the crew, the id otherwise. */
export function displayName(from: string): string {
  const c = CREW[from];
  return c ? `${c.rank} ${c.surname}` : from;
}
