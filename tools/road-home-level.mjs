// Generates src/content/levels/road-home.json (the "Road Home" demo map). Edit the rectangles here, then:
//   node tools/road-home-level.mjs src/content/levels/road-home.json
// Tile coords (col,row), inclusive rectangles; markers sit at tile centres. Prints the ASCII map.
// The beat chart this map serves is docs/missions/road-home.md: read it before moving anything.
//
// Three east-west bands joined by hairpin turns, six stretches, the Wall down the east side (col 112):
//   band 1 (east):  S1 orchard lane (nobody) · S2 Lipovka village (one sentry)
//   band 2 (west):  S3 church and school (post + patrol) · S4 the raked strip (patrol pair)
//   band 3 (east):  S5 outer works (three, awake) · S6 the gate yard (the fight), the gate at rows 63-66
import { writeFileSync } from 'node:fs';
const W = 120, H = 78, T = 32;
const g = Array.from({ length: H }, () => Array(W).fill('.'));
const R = (c0, r0, c1, r1, ch) => { for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (r >= 0 && c >= 0 && r < H && c < W) g[r][c] = ch; };
const px = (c) => c * T + 16;

// ---- frame, the Wall, and the two sector fences between the bands (single slab lines)
R(0, 0, W - 1, 0, '#'); R(0, H - 1, W - 1, H - 1, '#'); R(0, 0, 0, H - 1, '#'); R(W - 1, 0, W - 1, H - 1, '#');
R(112, 1, 112, 76, '#');     // the Wall; the gate is cut at the end of the file
R(1, 25, 99, 25, '#');       // fence 1, open at the east (cols 100-111)
R(16, 51, 111, 51, '#');     // fence 2, open at the west (cols 1-15)

// ================================================================ band 1 (rows 1-24), heading east
// S1 orchard lane: a rutted track that winds between walled plots, so the opening has room to breathe
R(1, 4, 21, 5, '~'); R(20, 4, 21, 19, '~'); R(20, 18, 40, 19, '~'); R(39, 12, 40, 19, '~'); R(39, 12, 45, 13, '~');
R(1, 8, 17, 8, '#');                          // plot wall south of the first leg
R(23, 1, 23, 15, '#'); R(23, 15, 36, 15, '#'); // the Gromov orchard: walled west and south...
R(36, 1, 36, 6, '#'); R(36, 9, 36, 15, '#');   // ...and east, with a gateway at rows 7-8
R(2, 10, 17, 11, '"'); R(2, 14, 17, 15, '"'); R(2, 18, 17, 19, '"'); R(2, 22, 17, 23, '"'); // tree rows gone to hedge
R(25, 2, 34, 3, '"'); R(25, 6, 33, 6, '"'); R(25, 10, 34, 11, '"');
R(24, 21, 30, 23, '"'); R(34, 21, 38, 22, '"'); R(42, 16, 44, 20, '"'); R(41, 2, 45, 5, '"');
R(2, 1, 6, 2, '"');
// S2 Lipovka: one street, houses with a yard in front and a lane behind
R(46, 12, 109, 13, '=');
for (const [c0, c1] of [[49, 52], [56, 60], [64, 67], [71, 75], [79, 82], [86, 90], [94, 97]]) R(c0, 6, c1, 9, '#');
for (const [c0, c1] of [[48, 52], [56, 59], [63, 67], [71, 74], [78, 82], [86, 89], [93, 97]]) R(c0, 16, c1, 19, '#');
R(48, 2, 61, 3, '"'); R(65, 2, 76, 3, '"'); R(80, 1, 98, 3, '"');          // north lane
R(48, 21, 60, 23, '"'); R(64, 22, 75, 23, '"'); R(79, 21, 99, 23, '"');    // south lane
R(53, 10, 54, 10, '"'); R(61, 15, 62, 15, '"'); R(76, 10, 77, 10, '"'); R(83, 15, 84, 15, '"'); // front gardens
R(108, 12, 109, 39, '=');                     // the road turns south along the Wall
R(102, 2, 106, 7, '#'); R(101, 17, 104, 21, '#'); R(102, 9, 104, 10, '"');

// ================================================================ band 2 (rows 26-50), heading west
R(8, 38, 109, 39, '=');
R(104, 28, 106, 33, '"'); R(103, 44, 107, 48, '"');                       // turn cover
// S3 church and school
R(96, 29, 103, 33, '#');                      // the priest's house
R(95, 43, 102, 47, '#');
R(80, 29, 88, 34, '#');                       // the church; a three-tile passage behind it (rows 26-28)
R(89, 26, 95, 27, '"');                       // cover between the priest's house and the church
R(63, 27, 63, 29, '#'); R(63, 32, 63, 36, '#');                           // churchyard wall, west gate rows 30-31
R(63, 36, 69, 36, '#'); R(72, 36, 79, 36, '#');                           // south wall, gate cols 70-71
R(65, 28, 68, 29, '"'); R(72, 27, 76, 29, '"'); R(66, 33, 69, 34, '"'); R(73, 32, 77, 34, '"'); // among the graves
R(78, 43, 89, 47, '#');                       // the school; the patrol walks round it
R(74, 49, 94, 50, '"');
R(57, 27, 60, 32, '#'); R(57, 43, 61, 48, '#');                           // houses framing the checkpoint
// S4 the strip: raked earth either side of a lit patrol road, a hedgerow north, what is left of houses south
R(14, 27, 55, 36, '~'); R(14, 41, 55, 49, '~');
R(14, 27, 25, 28, '"'); R(29, 27, 39, 28, '"'); R(43, 27, 55, 28, '"');   // hedgerow, gaps at cols 26-28 and 40-42
R(45, 43, 51, 43, '#'); R(45, 43, 45, 46, '#');                           // house walls facing the road: firing
R(34, 43, 40, 43, '#'); R(40, 43, 40, 46, '#');                           // positions for whoever would rather hunt
R(24, 43, 30, 43, '#'); R(24, 43, 24, 45, '#');
R(16, 45, 20, 45, '#');
R(48, 31, 51, 31, '#'); R(33, 32, 33, 34, '#');
R(41, 46, 44, 47, '"'); R(22, 48, 28, 49, '"');
R(7, 38, 8, 65, '=');                         // the west turn
R(2, 27, 5, 32, '"'); R(10, 43, 13, 48, '#'); R(2, 44, 4, 49, '"');

// ================================================================ band 3 (rows 52-76), heading east
R(7, 64, 118, 65, '=');
R(2, 70, 5, 75, '"'); R(11, 54, 15, 59, '#'); R(12, 70, 16, 75, '#');
// S5 outer works: a fenced supply yard, a ditch under the fence on the south side
R(28, 52, 28, 61, '#'); R(28, 68, 28, 71, '#');                           // fence: road gate rows 62-67, ditch rows 72-76 run under it
R(20, 72, 46, 74, '~'); R(20, 75, 46, 76, '"'); R(22, 70, 27, 71, '"');   // the ditch, reeds along its far bank
R(34, 54, 41, 58, '#'); R(46, 55, 53, 59, '#'); R(48, 69, 54, 73, '#');
R(18, 58, 24, 60, '"'); R(42, 53, 45, 54, '"');
R(58, 54, 61, 59, '#'); R(58, 70, 62, 74, '#');                           // sheds framing the last checkpoint
// S6 the gate yard: barracks north and south, concrete blocks for cover, gatehouses either side of the gate
R(76, 54, 88, 57, '#'); R(74, 72, 86, 76, '#');
R(70, 60, 71, 61, '#'); R(72, 68, 73, 69, '#'); R(84, 60, 85, 61, '#'); R(92, 68, 93, 69, '#');
R(67, 55, 67, 58, '#'); R(66, 70, 66, 73, '#'); R(98, 58, 98, 60, '#'); R(98, 69, 98, 71, '#');
R(106, 56, 110, 61, '#'); R(106, 68, 110, 73, '#');
R(92, 53, 96, 54, '"'); R(90, 74, 95, 75, '"'); R(100, 53, 104, 54, '"');
R(112, 63, 112, 66, '.'); R(112, 64, 112, 65, '=');                       // the gate
R(114, 54, 117, 60, '"'); R(114, 69, 117, 75, '"');                       // our side of the Wall

const terrain = g.map((r) => r.join(''));

const M = (id, c, r, facing, tags) => ({ id, x: px(c), y: px(r), ...(facing !== undefined ? { facing } : {}), ...(tags ? { tags } : {}) });
const markers = [
  M('start', 3, 4, 0, ['player-start']),
  M('cp_village', 45, 12, 0, ['checkpoint']),
  M('cp_turn', 108, 25, 90, ['checkpoint']),
  M('cp_strip', 59, 38, 180, ['checkpoint']),
  M('cp_bend', 8, 52, 90, ['checkpoint']),
  M('cp_gate', 61, 64, 0, ['checkpoint']),
  M('v_sentry', 84, 12, 0, ['enemy-spawn']),
  M('ch_post', 86, 37, 90, ['enemy-spawn']),
  M('ch_walk_start', 76, 41),
  M('st_lead', 42, 38, 180),
  M('st_tail', 36, 38, 180),
  M('ow_gate', 31, 62, 180, ['enemy-spawn']),
  M('ow_watch', 44, 61, 180, ['enemy-spawn']),
  M('ow_walk_start', 33, 63),
  M('g_post_n', 102, 62, 180, ['enemy-spawn']),
  M('g_post_s', 102, 67, 180, ['enemy-spawn']),
  M('g_walk_start', 78, 63),
  M('res_n', 92, 55, 180),
  M('res_s', 90, 70, 180),
  M('yard_n', 88, 60, 180),
  M('yard_s', 86, 69, 180),
  M('hpt_spawn', 116, 64, 180),
  M('gate_mouth', 108, 64, 180, ['landmark']),
  M('home', 116, 65, undefined, ['landmark']),
];
const Z = (id, c0, r0, c1, r1, tags) => ({ id, x: c0 * T, y: r0 * T, w: (c1 - c0 + 1) * T, h: (r1 - r0 + 1) * T, ...(tags ? { tags } : {}) });
const zones = [
  Z('lane_bend', 19, 8, 22, 14),
  Z('gromov_orchard', 25, 1, 35, 14),
  Z('z_village', 44, 1, 46, 24),
  Z('pasha_house', 68, 1, 70, 24),
  Z('z_turn', 100, 24, 111, 27),
  Z('church_east', 92, 26, 99, 50),
  Z('churchyard', 64, 27, 78, 35),
  Z('z_strip', 58, 26, 60, 50),
  Z('strip_mid', 31, 26, 34, 50),
  Z('z_bend', 1, 50, 15, 53),
  Z('works_inside', 31, 52, 56, 76),
  Z('z_gate', 60, 52, 62, 76),
  Z('gate_yard', 66, 52, 111, 76),
  Z('extraction', 114, 58, 118, 71, ['extraction']),
];
const P = (id, pts, loop) => ({ id, points: pts.map(([c, r]) => ({ x: px(c), y: px(r) })), ...(loop ? { loop: true } : {}) });
const paths = [
  P('ch_walk', [[76, 41], [91, 41], [91, 49], [76, 49]], true),
  P('st_run', [[42, 38], [24, 38]]),
  P('ow_walk', [[33, 63], [45, 63], [45, 66], [33, 66]], true),
  P('g_walk', [[78, 63], [96, 63], [96, 66], [78, 66]], true),
];
const L = (c, r, rot = 0) => ({ kind: 'lamp', x: px(c), y: px(r), w: 8, h: 8, height: 120, rotation: rot });
const B = (c, r) => ({ kind: 'barrel', x: px(c), y: px(r), w: 14, h: 14, height: 22 });
const C = (c, r, w = 40, h = 40) => ({ kind: 'crate', x: px(c), y: px(r), w, h, height: 26 });
const props = [
  L(84, 11), L(86, 36), L(34, 37), L(31, 61), L(110, 62), L(110, 67),
  L(55, 11), L(108, 24, 90), L(20, 40), L(48, 40), L(8, 50), L(60, 62), L(90, 59), L(78, 68), L(44, 67),
  B(55, 14), B(56, 14),                                   // the village pump
  { kind: 'barrier', x: px(28), y: px(64), w: 12, h: 128, height: 20 },
  { kind: 'barrier', x: px(100), y: px(64), w: 12, h: 96, height: 20 },
  B(33, 60), B(34, 60), B(43, 68), B(44, 69), B(55, 61), B(89, 59), B(104, 62), B(104, 67),
  C(38, 60), C(40, 61, 56, 36), C(50, 62), C(43, 70, 56, 36), C(80, 59), C(82, 70, 56, 36),
];
const level = { format: 'ironveil-level', formatVersion: 1, id: 'road-home', version: 1, name: 'Demo: The Road Home', tile: T, terrain, markers, zones, paths, props };
writeFileSync(process.argv[2], JSON.stringify(level, null, 1));
console.log(terrain.join('\n'));
