// "Cold War Berlin" palette. The base ground, UI and team tones come from the Sol 6.1 build
// (muted moss-green ground, khaki-grey roads, near-black green UI, cream text, steel blue vs
// brick). Added here: pale poured-concrete walls with pipe caps, faded graffiti, cold overcast
// ambient light and sodium-amber streetlamps.

export type RGB = [number, number, number];

export const GROUND = {
  grass: { base: [36, 56, 45] as RGB, vary: [16, 20, 13] as RGB },
  road: { base: [100, 97, 84] as RGB, vary: [24, 22, 18] as RGB },
  mud: { base: [86, 70, 52] as RGB, vary: [26, 16, 10] as RGB },
  brush: { base: [50, 74, 49] as RGB, vary: [12, 16, 10] as RGB },
};

export const WALL = {
  concreteTop: '#a8a69c',
  concreteSide: '#6e6c63',
  pipeCap: '#c9c7bc',
  seam: 'rgba(40,40,36,0.35)',
  roofTop: '#4f5654',
  roofSide: '#2f3433',
  rust: 'rgba(120,70,40,0.35)',
  stoneTop: '#8c8676',
  stoneSide: '#57513f',
  borderTop: '#5f665c',
  borderSide: '#363c34',
  graffiti: ['rgba(196,72,58,0.62)', 'rgba(226,190,82,0.58)', 'rgba(96,160,186,0.58)', 'rgba(236,234,220,0.55)', 'rgba(122,170,96,0.55)'],
};

export const CANOPY = { light: [70, 104, 66] as RGB, dark: [36, 62, 40] as RGB };

export const MINIMAP: Record<'grass' | 'road' | 'mud' | 'brush' | 'wall', string> = {
  grass: '#263a30',
  road: '#807560',
  mud: '#70533c',
  brush: '#385b3a',
  wall: '#bdbbb0',
};

export const TEAM = [
  { body: '#70a9bd', dark: '#3b6170', light: '#acd5e2', accent: '#eef6ef', hex: 0x70a9bd, ui: '#87c9e8', uiHex: 0x87c9e8, name: 'Ironveil' },
  { body: '#bb7657', dark: '#6a3a26', light: '#deab8a', accent: '#f8e2c8', hex: 0xbb7657, ui: '#ff9177', uiHex: 0xff9177, name: 'Rustguard' },
] as const;

export const LIGHT = {
  /** Overcast, slightly green-grey dusk; multiplied over the world. */
  ambient: '#9ea8a6',
  fog: 'rgba(7,12,10,0.54)',
  streetlamp: 0xffb35a,
  headlight: 0xfff0cf,
  selfGlow: 0xc4d6cc,
  clear: 0x0c1310,
};

export const UI = {
  panel: 0x101b17,
  panelAlpha: 0.78,
  text: '#edf4df',
  muted: '#a4b6a4',
  amber: '#f1d09c',
  good: '#a5d8a0',
  warn: '#ff9177',
  bar: 0x1d3024,
};
