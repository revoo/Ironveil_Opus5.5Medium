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
