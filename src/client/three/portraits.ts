// Crew portraits for the comms panel: flat linocut / constructivist poster style in three inks
// (black, paper, signal red) with halftone shading, drawn as SVG so they stay sharp and cost nothing.
// Every face exposes the same animatable parts: `.head` (bobs while speaking), `.brows` (furrow on
// urgent lines), `.eyes` (blink), and three mouth shapes `.m0` closed, `.m1` half open, `.m2` open.
// The comms panel picks the mouth from the voice plan, so lips move with the synthesised speech.

const INK = '#151513';
const PAPER = '#e4d9c1';
const RED = '#c3261b';
const GEAR = '#1b1b19';
const RIB = '#3e3e39';

export interface Speaker {
  /** Short stencil tag in the panel header (German army abbreviations). */
  tag: string;
  /** Name shown in the header. */
  name: string;
  /** Crew position, shown under the name. */
  role: string;
}

const SPEAKERS: Record<string, Speaker> = {
  Commander: { tag: 'KDT', name: 'Commander', role: 'Kommandant' },
  Driver: { tag: 'FHR', name: 'Driver', role: 'Fahrer' },
  Gunner: { tag: 'RS', name: 'Gunner', role: 'Richtschütze' },
  Loader: { tag: 'LS', name: 'Loader', role: 'Ladeschütze' },
};

export function speaker(from: string, enemy: boolean): Speaker {
  if (enemy) return { tag: 'FEIND', name: from.replace(/\s*\(enemy\)$/, ''), role: 'Feindfunk' };
  return SPEAKERS[from] ?? { tag: from.slice(0, 3).toUpperCase(), name: from, role: 'Funknetz' };
}

const defs = (id: string) =>
  `<defs><pattern id="ht-${id}" width="3.4" height="3.4" patternUnits="userSpaceOnUse" patternTransform="rotate(38)"><circle cx="1.7" cy="1.7" r="1.05" fill="${INK}"/></pattern>` +
  `<pattern id="hl-${id}" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)"><path d="M0 1.5h3" stroke="${INK}" stroke-width=".9"/></pattern></defs>`;

const shoulders = (fill = GEAR) =>
  `<path d="M4 140 C8 116 30 105 60 103 C90 105 112 116 116 140Z" fill="${fill}"/>` +
  `<path d="M42 104 L60 122 L78 104 L71 100 L60 112 L49 100Z" fill="#2c2c28"/>` +
  `<path d="M30 114 l13 -4 l3 9 l-13 4z" fill="${RED}"/><path d="M90 114 l-13 -4 l-3 9 l13 4z" fill="${RED}"/>`;

const neck = (id: string, w = 11) =>
  `<path d="M${60 - w} 82 L${60 + w} 82 L${62 + w} 104 L60 111 L${58 - w} 104Z" fill="${PAPER}" stroke="${INK}" stroke-width="1.2"/>` +
  `<path d="M60 84 L${60 + w} 82 L${62 + w} 104 L60 111Z" fill="url(#ht-${id})"/>`;

/** Mouth shapes centred on (60, y). */
const mouths = (y: number, w = 6) =>
  `<g class="mouth"><path class="m0" d="M${60 - w} ${y} Q60 ${y + 0.8} ${60 + w} ${y}" stroke="${INK}" stroke-width="2.3" fill="none" stroke-linecap="round"/>` +
  `<path class="m1" d="M${60 - w} ${y - 0.5} Q60 ${y - 2} ${60 + w} ${y - 0.5} Q60 ${y + 3.6} ${60 - w} ${y - 0.5}Z" fill="${INK}"/>` +
  `<path class="m2" d="M${60 - w + 1} ${y - 1} Q60 ${y - 2.6} ${60 + w - 1} ${y - 1} Q${60 + w - 1.5} ${y + 8} 60 ${y + 9} Q${60 - w + 1.5} ${y + 8} ${60 - w + 1} ${y - 1}Z" fill="${INK}"/>` +
  `<path class="m2" d="M${60 - 3} ${y + 6.5} Q60 ${y + 4.5} ${60 + 3} ${y + 6.5}" stroke="${RED}" stroke-width="1.6" fill="none"/></g>`;

const eyes = (y: number, extra = '') =>
  `<g class="eyes"><path d="M46 ${y} Q50.5 ${y - 3.6} 55 ${y} Q50.5 ${y + 2} 46 ${y}Z" fill="${INK}"/><path d="M65 ${y} Q69.5 ${y - 3.6} 74 ${y} Q69.5 ${y + 2} 65 ${y}Z" fill="${INK}"/>${extra}</g>`;

const brows = (y: number, thick = 3.4) =>
  `<g class="brows"><path class="bl" d="M44 ${y + 1.5} L56 ${y} L56 ${y + thick} L44 ${y + 1.5 + thick}Z" fill="${INK}"/><path class="br" d="M64 ${y} L76 ${y + 1.5} L76 ${y + 1.5 + thick} L64 ${y + thick}Z" fill="${INK}"/></g>`;

/** The padded tank-crew helmet with its ribbed rolls and ear cups. */
const tankHelmet = (chin = true) =>
  `<path d="M35 63 L34 42 Q36 17 60 16 Q84 17 86 42 L85 63 L78 64 L78 44 Q76 30 60 29 Q44 30 42 44 L42 64Z" fill="${GEAR}"/>` +
  `<g stroke="${RIB}" stroke-width="3.2" stroke-linecap="round" fill="none"><path d="M47 20 Q44 28 43 38"/><path d="M60 17.5 L60 28"/><path d="M73 20 Q76 28 77 38"/></g>` +
  `<path d="M42 44 Q44 31 60 30 Q76 31 78 44" stroke="${RIB}" stroke-width="2.4" fill="none"/>` +
  `<ellipse cx="38" cy="58" rx="6.5" ry="9.5" fill="#24241f" stroke="#4a4a43" stroke-width="1.4"/><ellipse cx="82" cy="58" rx="6.5" ry="9.5" fill="#24241f" stroke="#4a4a43" stroke-width="1.4"/>` +
  (chin ? `<path d="M39 67 L50 82 M81 67 L70 82" stroke="${GEAR}" stroke-width="2.4" fill="none"/>` : '');

const throatMic = `<path d="M47 94 H73" stroke="${GEAR}" stroke-width="1.6"/><rect x="50" y="91" width="6.5" height="5.5" rx="1" fill="#26261f"/><rect x="63.5" y="91" width="6.5" height="5.5" rx="1" fill="#26261f"/>`;

const svg = (id: string, body: string) =>
  `<svg viewBox="0 0 120 140" xmlns="http://www.w3.org/2000/svg" class="pt pt-${id}">${defs(id)}${body}</svg>`;

function commander(): string {
  const id = 'kdt';
  const face = 'M41 48 L43 36 L52 28 L68 28 L77 36 L79 48 L78 66 L72 80 L60 87 L48 80 L42 66Z';
  return svg(
    id,
    `<rect width="120" height="140" fill="${PAPER}"/><circle cx="82" cy="48" r="44" fill="${RED}"/>` +
      `<path d="M0 100 L120 36 L120 54 L0 118Z" fill="${INK}"/>` +
      shoulders() +
      neck(id) +
      throatMic +
      `<g class="head"><path d="${face}" fill="${PAPER}" stroke="${INK}" stroke-width="1.5"/>` +
      `<path d="M64 28 L68 28 L77 36 L79 48 L78 66 L72 80 L60 87 L66 74 L69 58 L68 42Z" fill="url(#ht-${id})"/>` +
      brows(46) +
      eyes(55) +
      `<g stroke="${INK}" stroke-width="1" fill="none"><path d="M43 54 l-2.5 -1.5 M43 57 l-2.5 1.2 M77 54 l2.5 -1.5 M77 57 l2.5 1.2"/><path d="M53 68 L50.5 76 M67 68 L69.5 76"/><path d="M50 40 h20 M52 43 h16" opacity=".55"/></g>` +
      `<path d="M60 54 L57 67 L61.5 68" stroke="${INK}" stroke-width="2" fill="none" stroke-linejoin="round"/>` +
      mouths(78) +
      `<path d="M50 72.5 Q55 69.5 60 71.5 Q65 69.5 70 72.5 L69 75.5 Q64 73.5 60 75 Q56 73.5 51 75.5Z" fill="${INK}"/>` +
      tankHelmet() +
      `</g>`,
  );
}

function driver(): string {
  const id = 'fhr';
  const face = 'M42 48 L44 35 L53 28 L67 28 L76 35 L78 48 L77 65 L71 79 L60 85 L49 79 L43 65Z';
  return svg(
    id,
    `<rect width="120" height="140" fill="${PAPER}"/><path d="M0 76 L120 4 L120 44 L0 116Z" fill="${RED}"/>` +
      `<rect x="86" y="92" width="34" height="48" fill="${INK}"/><rect x="0" y="14" width="22" height="22" fill="${INK}"/>` +
      shoulders() +
      neck(id, 10) +
      `<g class="head"><path d="${face}" fill="${PAPER}" stroke="${INK}" stroke-width="1.5"/>` +
      `<path d="M63 28 L67 28 L76 35 L78 48 L77 65 L71 79 L60 85 L65 73 L68 57 L67 41Z" fill="url(#ht-${id})"/>` +
      brows(46.5, 2.8) +
      eyes(55.5) +
      `<g fill="${INK}"><circle cx="48" cy="63" r=".8"/><circle cx="51" cy="64.5" r=".7"/><circle cx="46.5" cy="66" r=".7"/><circle cx="71" cy="63" r=".8"/><circle cx="73.5" cy="65" r=".7"/></g>` +
      `<path d="M60 55 L57.5 66 L61.5 67" stroke="${INK}" stroke-width="1.9" fill="none" stroke-linejoin="round"/>` +
      mouths(75, 5.5) +
      `<path d="M52 82 Q60 86 68 82" stroke="${INK}" stroke-width="1" fill="none" opacity=".6"/>` +
      tankHelmet() +
      // goggles pushed up on the helmet
      `<path d="M35 38 Q60 30 85 38 L85 43.5 Q60 35.5 35 43.5Z" fill="${INK}"/>` +
      `<circle cx="50" cy="36.5" r="7.6" fill="#71827a" stroke="${INK}" stroke-width="2.6"/><circle cx="70" cy="36.5" r="7.6" fill="#71827a" stroke="${INK}" stroke-width="2.6"/>` +
      `<path d="M46 33.5 l4.5 -2.2 M66 33.5 l4.5 -2.2" stroke="${PAPER}" stroke-width="1.5" stroke-linecap="round" opacity=".85"/>` +
      `<path d="M57.6 36.5 h4.8" stroke="${INK}" stroke-width="2.4"/>` +
      `</g>`,
  );
}

function gunner(): string {
  const id = 'rs';
  const face = 'M43 50 L45 37 L53 30 L67 30 L75 37 L77 50 L76 66 L70 79 L60 85 L50 79 L44 66Z';
  return svg(
    id,
    `<rect width="120" height="140" fill="${PAPER}"/><path d="M68 4 L118 30 L96 80 L46 54Z" fill="${RED}"/>` +
      `<circle cx="22" cy="30" r="14" fill="${INK}"/><path d="M0 120 L40 92 L44 98 L4 126Z" fill="${INK}"/>` +
      shoulders() +
      `<path d="M38 104 L48 84 L54 100Z M82 104 L72 84 L66 100Z" fill="#2c2c28"/>` +
      neck(id, 9) +
      `<g class="head"><path d="${face}" fill="${PAPER}" stroke="${INK}" stroke-width="1.5"/>` +
      `<path d="M63 30 L67 30 L75 37 L77 50 L76 66 L70 79 L60 85 L65 73 L68 57 L67 42Z" fill="url(#ht-${id})"/>` +
      // cropped hair, swept fringe
      `<path d="M38 66 L37 44 Q38 19 60 18 Q83 19 84 40 L83 60 L78 57 L77 43 Q73 35 63 35 L49 45 L44 47 L43 66Z" fill="${INK}"/>` +
      `<path d="M44 47 L64 33.5 L58 43Z" fill="${INK}"/>` +
      brows(48.5, 2.4) +
      eyes(56.5, `<path d="M55.2 55.6 l2.6 -1.8 M74.2 55.6 l2.6 -1.8" stroke="${INK}" stroke-width="1.2"/>`) +
      // the scar, stitched
      `<path d="M48 44 L53.5 63" stroke="${RED}" stroke-width="1.8" fill="none"/><path d="M48.6 49 l3.4 -1.2 M50 54 l3.4 -1.2 M51.4 59 l3.4 -1.2" stroke="${RED}" stroke-width="1"/>` +
      `<path d="M60 56 L58 66 L61.5 66.8" stroke="${INK}" stroke-width="1.7" fill="none" stroke-linejoin="round"/>` +
      mouths(75.5, 5) +
      // intercom headset with a boom mic
      `<path d="M35 54 Q35 12 60 12 Q85 12 85 54" stroke="#2e2e2a" stroke-width="4.5" fill="none"/>` +
      `<rect x="30.5" y="49" width="10" height="17" rx="3" fill="#2a2a26" stroke="#4a4a43" stroke-width="1.3"/><rect x="79.5" y="49" width="10" height="17" rx="3" fill="#2a2a26" stroke="#4a4a43" stroke-width="1.3"/>` +
      `<path d="M36 65 Q38 81 51 80.5" stroke="#2e2e2a" stroke-width="2.6" fill="none"/><rect x="49.5" y="77.8" width="6.5" height="5.2" rx="2" fill="${INK}"/>` +
      `</g>`,
  );
}

function loader(): string {
  const id = 'ls';
  const face = 'M36 46 L38 30 L49 20 L71 20 L82 30 L84 46 L85 66 L78 82 L60 90 L42 82 L35 66Z';
  return svg(
    id,
    `<rect width="120" height="140" fill="${PAPER}"/><rect x="0" y="22" width="120" height="30" fill="${RED}"/>` +
      `<rect x="0" y="58" width="120" height="5" fill="${INK}"/><rect x="0" y="68" width="120" height="2.5" fill="${INK}"/>` +
      shoulders() +
      neck(id, 15) +
      `<g class="head"><path d="${face}" fill="${PAPER}" stroke="${INK}" stroke-width="1.6"/>` +
      `<path d="M66 20 L71 20 L82 30 L84 46 L85 66 L78 82 L60 90 L68 76 L72 58 L71 38Z" fill="url(#ht-${id})"/>` +
      // shaved scalp and a heavy stubble
      `<path d="M38 32 L49 20 L71 20 L82 30 L83 40 Q60 30 37 40Z" fill="url(#ht-${id})" opacity=".45"/>` +
      `<path d="M36 66 L42 80 L60 89 L78 80 L84 66 L75 73 L60 79 L45 73Z" fill="url(#ht-${id})" opacity=".7"/>` +
      `<g class="brows"><path class="bl" d="M41 47 L57 44.5 L57.5 50 L42 51.5Z" fill="${INK}"/><path class="br" d="M63 44.5 L79 47 L78 51.5 L62.5 50Z" fill="${INK}"/></g>` +
      eyes(56) +
      `<path d="M60.5 53 L58.4 60 L61.4 63 L57 68.5 L62.5 69.5" stroke="${INK}" stroke-width="2.3" fill="none" stroke-linejoin="round"/>` +
      mouths(77, 7) +
      // a field dressing on the scalp
      `<path d="M63 25 l11 3.4 l-1.3 4.6 l-11 -3.4z" fill="${PAPER}" stroke="${INK}" stroke-width="1"/><path d="M66 27.4 l-1 3.4 M70 28.6 l-1 3.4" stroke="${INK}" stroke-width=".8"/>` +
      // intercom headband and cups
      `<path d="M33 52 Q34 13 60 13 Q86 13 87 52" stroke="#2e2e2a" stroke-width="4.5" fill="none"/>` +
      `<ellipse cx="34" cy="57" rx="6.5" ry="9.5" fill="#24241f" stroke="#4a4a43" stroke-width="1.4"/><ellipse cx="86" cy="57" rx="6.5" ry="9.5" fill="#24241f" stroke="#4a4a43" stroke-width="1.4"/>` +
      `</g>`,
  );
}

function intercept(): string {
  const id = 'feind';
  return svg(
    id,
    `<rect width="120" height="140" fill="${RED}"/><rect width="120" height="140" fill="url(#hl-${id})" opacity=".25"/>` +
      `<path d="M10 140 C14 114 34 104 60 102 C86 104 106 114 110 140Z" fill="${INK}"/>` +
      `<g class="head"><path d="M40 70 Q38 32 60 30 Q82 32 80 70 Q78 89 60 93 Q42 89 40 70Z" fill="${INK}"/>` +
      `<path d="M32 58 Q33 20 60 18 Q87 20 88 58 L81 55 Q79 31 60 30 Q41 31 39 55Z" fill="${INK}"/>` +
      `<path d="M47 55 h10 M63 55 h10" stroke="${RED}" stroke-width="2.2" opacity=".75"/></g>` +
      `<g stroke="${PAPER}" stroke-width="1.2" fill="none" opacity=".8"><circle cx="60" cy="60" r="27"/><path d="M60 26 v12 M60 82 v12 M26 60 h12 M82 60 h12"/></g>`,
  );
}

const CACHE = new Map<string, string>();

/** SVG markup of the portrait for a radio speaker. */
export function portraitSvg(from: string, enemy: boolean): string {
  const key = enemy ? '#enemy' : from;
  let s = CACHE.get(key);
  if (!s) {
    s = enemy ? intercept() : from === 'Commander' ? commander() : from === 'Driver' ? driver() : from === 'Gunner' ? gunner() : from === 'Loader' ? loader() : commander();
    CACHE.set(key, s);
  }
  return s;
}
