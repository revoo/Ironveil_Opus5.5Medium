// Generates src/content/levels/long-night.json (the long playtest map). Edit the rectangles here, then:
//   node tools/long-night-level.mjs src/content/levels/long-night.json
// Tile coords (col,row), inclusive rectangles; markers sit at tile centres. Prints the ASCII map.
//
// A quiet opening stretch along the Wall, then four east-west strips joined by hairpin turns:
//   strip 0 (west):  S0 the death strip inside the Wall. Nobody here: it is as long as the intro
//                    dialogue (about 27 s flat out), and the first enemy only arrives at its end.
//   strip 1 (east):  S1 garage · S2 allotments · S3 old town maze · S4 boulevard (convoy)
//   strip 2 (west):  S5 factory (signal truck) · S6 river (two bridges + ford) · S7 park (quiet)
//   strip 3 (east):  S8 rail yard · S9 border checkpoint
//   strip 4 (west):  S10 approach (crew decision) · S11 fortress, extraction at the far west
import { writeFileSync } from 'node:fs';
const W = 160, H = 133, T = 32;
/** Rows of the opening strip. Everything after it is written in its old row numbers and shifted down. */
const OY = 13;
let oy = 0;
const g = Array.from({ length: H }, () => Array(W).fill('.'));
const R = (c0, r0, c1, r1, ch) => { for (let r = r0 + oy; r <= r1 + oy; r++) for (let c = c0; c <= c1; c++) if (r >= 0 && c >= 0 && r < H && c < W) g[r][c] = ch; };
const px = (c) => c * T + 16;

// ---- frame, staggered building rows between the strips, open at alternating ends
R(0, 0, W - 1, 0, '#'); R(0, H - 1, W - 1, H - 1, '#'); R(0, 0, 0, H - 1, '#'); R(W - 1, 0, W - 1, H - 1, '#');
const divider = (c0, c1, r0, r1) => { for (let c = c0, k = 0; c <= c1; c += 9, k++) R(c, r0 + (k % 2), Math.min(c + 8, c1), r1, '#'); };

// ================================================================ strip 0 (rows 1-10), heading west
// The Wall is the map's north edge, doubled; we came through the breach at its east end.
R(1, 1, 144, 1, '#');
R(145, 1, 158, 9, '~');                      // rubble and churned mud at the breach
R(5, 4, 147, 5, '=');                        // the patrol road along the Wall
for (let c = 20; c <= 140; c += 24) R(c, 8, c + 1, 9, '#');   // watchtower footings
for (const c of [12, 31, 57, 80, 103, 127]) R(c, 7, c + 4, 10, '"');
for (const c of [40, 68, 92, 116]) R(c, 2, c + 3, 2, '"');
R(134, 7, 138, 9, '#');                      // a border-troop hut, dark
for (let c = 7, k = 0; c <= W - 2; c += 9, k++) R(c, 11 + (k % 2), Math.min(c + 8, W - 2), 13, '#'); // back of the allotments and the old town; open west (cols 1-6)

oy = OY;
divider(0, 143, 27, 29);  // open east (cols 144-158)
divider(16, W - 1, 58, 60); // open west (cols 1-15)
divider(0, 143, 89, 91);  // open east
// ================================================================ strip 1 (rows 1-26), heading east
// S1 garage
R(1, 13, 50, 14, '=');
R(3, 4 - OY, 4, 13, '=');                   // down from the Wall road
R(8, 2, 11, 8, '#'); R(8, 19, 11, 25, '#'); R(2, 3, 5, 7, '"'); R(2, 19, 6, 23, '"');
// S2 allotments: hedgerows and sheds
R(15, 5, 43, 6, '"'); R(15, 20, 43, 21, '"');
R(22, 1, 23, 4, '"'); R(32, 1, 33, 4, '"'); R(22, 22, 23, 25, '"'); R(32, 22, 33, 25, '"');
R(16, 8, 17, 9, '#'); R(28, 17, 29, 18, '#'); R(38, 8, 39, 9, '#'); R(36, 23, 37, 24, '#');
R(26, 9, 29, 10, '"'); R(40, 16, 42, 18, '"');
R(45, 2, 49, 9, '#'); R(45, 18, 49, 25, '#'); // framing CP1
// S3 old town: lanes (cobbles) and blocks
R(51, 1, 100, 26, '=');
for (const [c0, c1] of [[54, 61], [65, 73], [77, 85], [89, 97]]) for (const [r0, r1] of [[5, 11], [15, 21]]) R(c0, r0, c1, r1, '#');
R(65, 12, 73, 14, '#');   // the square's church closes the central lane
R(89, 1, 97, 4, '#');     // north lane closed in the east
R(77, 15, 85, 21, '=');   // plaza instead of a block
R(80, 17, 82, 19, '"');   // plaza garden
R(51, 1, 53, 1, '#'); R(98, 25, 100, 26, '#');
R(54, 25, 61, 26, '#'); R(65, 25, 73, 26, '#'); R(77, 25, 85, 26, '#'); R(89, 25, 97, 26, '#'); // back walls
R(54, 1, 61, 1, '#'); R(65, 1, 73, 1, '#'); R(77, 1, 85, 1, '#');
// S4 boulevard: carriageways around a long median, verges with brush
R(101, 13, 115, 14, '=');
R(116, 8, 140, 9, '='); R(116, 19, 140, 20, '='); R(116, 8, 117, 20, '='); R(139, 8, 140, 20, '=');
R(120, 11, 136, 16, '#');                   // median: arcade building
R(104, 1, 143, 2, '"'); R(104, 23, 143, 25, '"');
R(104, 4, 107, 6, '#'); R(121, 4, 125, 5, '#'); R(130, 4, 134, 5, '#'); // kiosks
R(121, 22, 125, 22, '#'); R(130, 22, 134, 22, '#'); R(108, 9, 111, 11, '"'); R(108, 17, 111, 19, '"');
R(141, 13, 151, 14, '='); R(150, 13, 151, 44, '=');
R(144, 1, 158, 6, '#'); R(154, 8, 158, 18, '#'); R(153, 22, 157, 26, '"');

// ================================================================ strip 2 (rows 30-57), heading west
R(8, 43, 151, 44, '=');
R(152, 31, 157, 36, '"');
// S5 factory: halls, yard, signal truck; alleys north (rows 30-32) and south (55-57)
R(104, 33, 118, 38, '#'); R(122, 33, 138, 37, '#'); R(104, 49, 116, 54, '#'); R(122, 49, 134, 54, '#'); R(140, 48, 146, 54, '#');
R(142, 33, 146, 38, '#');
R(106, 30, 114, 31, '"'); R(124, 30, 132, 31, '"'); R(106, 56, 130, 57, '"');
R(124, 40, 126, 41, '#');                   // generator housing next to the truck
R(118, 46, 120, 48, '"');
// S6 river: mud channel with embankments; north bridge, south bridge, ford in the middle
R(62, 30, 70, 57, '~');
R(61, 30, 61, 34, '#'); R(61, 38, 61, 41, '#'); R(61, 47, 61, 51, '#'); R(61, 55, 61, 57, '#');
R(71, 30, 71, 34, '#'); R(71, 38, 71, 41, '#'); R(71, 47, 71, 51, '#'); R(71, 55, 71, 57, '#');
R(58, 35, 77, 37, '='); R(58, 52, 77, 54, '=');   // bridges (rows 35-37, 52-54)
R(76, 37, 77, 52, '='); R(54, 37, 55, 52, '=');   // bank roads
R(62, 43, 70, 44, '~');                           // the main road stops at the water: ford rows 42-46
R(72, 39, 75, 49, '"'); R(57, 40, 60, 46, '"');   // reeds
R(80, 31, 92, 36, '#'); R(80, 49, 92, 55, '#'); R(40, 31, 48, 37, '#'); R(40, 49, 49, 55, '#');
// S7 park: brush clumps around a pond; quiet
R(12, 33, 20, 38, '~');
R(3, 31, 8, 35, '"'); R(22, 32, 27, 36, '"'); R(4, 48, 10, 53, '"'); R(16, 49, 24, 54, '"'); R(26, 47, 30, 51, '"'); R(13, 40, 17, 41, '"');
R(7, 43, 8, 75, '=');

// ================================================================ strip 3 (rows 61-88), heading east
R(7, 74, 151, 75, '=');
R(2, 63, 5, 67, '"'); R(10, 80, 14, 85, '#'); R(2, 82, 5, 87, '"');
// S8 rail yard: container stacks (2 x 6), a signal tower
for (const [c, r] of [[20, 64], [30, 63], [44, 64], [58, 63], [72, 64], [84, 63], [24, 69], [38, 70], [66, 69], [80, 70], [22, 79], [36, 78], [50, 79], [64, 78], [78, 79], [28, 84], [46, 85], [62, 84], [76, 85]]) R(c, r, c + 5, r + 1, '#');
R(54, 68, 55, 69, '#');                     // tower
R(18, 61, 92, 61, '"'); R(18, 87, 92, 88, '"');
R(52, 82, 56, 83, '"'); R(34, 65, 37, 66, '"');
// S9 border checkpoint: wall with a road gate, a rubble breach to the south
R(112, 61, 112, 71, '#'); R(112, 78, 112, 83, '#');
R(112, 84, 112, 88, '"'); R(100, 84, 111, 88, '"'); R(113, 85, 125, 88, '"');
R(114, 69, 115, 70, '#');                   // gate booth
R(98, 62, 106, 68, '#'); R(98, 79, 106, 82, '#');
R(118, 62, 128, 68, '#'); R(132, 62, 140, 69, '#'); R(120, 79, 130, 81, '#'); R(136, 79, 142, 84, '#');
R(150, 74, 151, 105, '=');
R(146, 62, 158, 70, '#'); R(153, 80, 157, 86, '"');

// ================================================================ strip 4 (rows 92-118), heading west
R(20, 104, 151, 105, '=');
// S10 approach: broken boulevard, quiet; the crew decides how to go in
R(152, 93, 157, 98, '"');
R(130, 94, 140, 99, '#'); R(116, 95, 124, 100, '#'); R(130, 110, 141, 116, '#'); R(112, 110, 120, 117, '#');
R(100, 93, 108, 98, '#'); R(98, 110, 106, 116, '#');
R(124, 108, 128, 112, '"'); R(108, 100, 112, 102, '"');
// S11 fortress: outer wall with a road gate (rows 102-107) and a culvert (rows 113-118)
R(80, 92, 80, 101, '#'); R(80, 108, 80, 112, '#');
R(72, 113, 92, 118, '~'); R(84, 110, 92, 112, '"'); R(70, 115, 79, 118, '"');
R(83, 99, 84, 100, '#'); R(83, 109, 84, 110, '#'); // gate pillboxes
R(30, 96, 50, 101, '#'); R(30, 108, 50, 113, '#'); // keep and barracks
R(58, 93, 66, 97, '#'); R(58, 110, 66, 113, '#'); R(14, 93, 22, 97, '#'); R(14, 112, 22, 117, '#');
R(2, 104, 19, 105, '=');
R(24, 115, 28, 118, '"'); R(52, 114, 56, 118, '"'); R(68, 93, 74, 95, '"');

const terrain = g.map((r) => r.join(''));

const M = (id, c, r, facing, tags) => ({ id, x: px(c), y: px(r + OY), ...(facing !== undefined ? { facing } : {}), ...(tags ? { tags } : {}) });
const markers = [
  M('start', 152, 4 - OY, 180, ['player-start']),
  M('cp_garage', 4, 12, 0, ['checkpoint']),
  M('allot_gate', 44, 13, 180),
  M('cp_oldtown', 47, 13, 0, ['checkpoint']),
  M('cp_boulevard', 102, 13, 0, ['checkpoint']),
  M('cp_factory', 151, 33, 90, ['checkpoint']),
  M('cp_river', 97, 44, 180, ['checkpoint']),
  M('cp_park', 34, 44, 180, ['checkpoint']),
  M('cp_railyard', 8, 64, 90, ['checkpoint']),
  M('cp_border', 96, 74, 0, ['checkpoint']),
  M('cp_approach', 151, 95, 90, ['checkpoint']),
  M('allot_start', 19, 11),
  M('ot_church', 75, 3, 90, ['enemy-spawn']),
  M('ot_plaza', 79, 16, 180, ['enemy-spawn']),
  M('ot_lane_start', 72, 23),
  M('conv_a', 116, 8), M('conv_b', 140, 20),
  M('fac_gate', 119, 44, 180, ['enemy-spawn']),
  M('fac_truck', 128, 41, 90, ['landmark']),
  M('fac_yard_start', 122, 39),
  M('riv_north', 56, 36, 0, ['enemy-spawn']),
  M('riv_south', 56, 53, 0, ['enemy-spawn']),
  M('riv_bank_start', 51, 38),
  M('ry_tower', 57, 72, 180, ['enemy-spawn']),
  M('ry_west_start', 30, 72), M('ry_east_start', 66, 73),
  M('bc_gate_n', 115, 73, 180, ['enemy-spawn']),
  M('bc_gate_s', 115, 77, 180, ['enemy-spawn']),
  M('bc_ruins_start', 118, 83),
  M('fo_gate_n', 83, 103, 180, ['enemy-spawn']),
  M('fo_gate_s', 83, 106, 180, ['enemy-spawn']),
  M('fo_culvert', 76, 112, 0, ['enemy-spawn']),
  M('fo_flare_gate', 90, 94, 90),
  M('fo_keep_start', 27, 94),
  M('fo_inner', 16, 101, 0, ['enemy-spawn']),
  M('fo_qrf', 5, 94, 90),
  M('extract', 5, 108, undefined, ['landmark']),
];
const Z = (id, c0, r0, c1, r1, tags) => ({ id, x: c0 * T, y: (r0 + OY) * T, w: (c1 - c0 + 1) * T, h: (r1 - r0 + 1) * T, ...(tags ? { tags } : {}) });
const zones = [
  Z('wall_end', 1, 1 - OY, 12, 10 - OY),
  Z('allotments', 14, 1, 30, 26),
  Z('z_oldtown', 46, 10, 48, 17),
  Z('oldtown', 51, 1, 64, 26),
  Z('z_boulevard', 101, 1, 103, 26),
  Z('boulevard_far', 141, 7, 158, 26),
  Z('z_factory', 144, 30, 158, 34),
  Z('factory_yard', 120, 38, 141, 48),
  Z('z_river', 95, 39, 99, 48),
  Z('river', 61, 30, 71, 57),
  Z('z_park', 32, 30, 36, 57),
  Z('z_railyard', 1, 61, 15, 66),
  Z('railyard', 18, 61, 92, 88),
  Z('z_border', 94, 69, 96, 80),
  Z('past_border', 113, 61, 143, 88),
  Z('z_approach', 144, 92, 158, 97),
  Z('approach_choice', 108, 92, 114, 118),
  Z('fortress', 2, 92, 79, 118),
  Z('extraction', 1, 100, 8, 111, ['extraction']),
];
const P = (id, pts, loop) => ({ id, points: pts.map(([c, r]) => ({ x: px(c), y: px(r + OY) })), ...(loop ? { loop: true } : {}) });
const paths = [
  P('allot_walk', [[19, 11], [31, 11], [31, 16], [19, 16]], true),
  P('ot_lane', [[72, 23], [90, 23]]),
  P('convoy_a', [[116, 8], [140, 8], [140, 20], [116, 20]], true),
  P('convoy_b', [[140, 20], [116, 20], [116, 8], [140, 8]], true),
  P('fac_yard', [[122, 39], [137, 39], [137, 46], [122, 46]], true),
  P('riv_bank', [[51, 38], [51, 47]]),
  P('ry_west', [[30, 72], [46, 72], [46, 77], [30, 77]], true),
  P('ry_east', [[66, 73], [80, 73], [80, 76], [66, 76]], true),
  P('bc_ruins', [[118, 83], [134, 83]]),
  P('fo_culvert_walk', [[76, 112], [66, 116]]),
  P('fo_flare_south', [[86, 116], [92, 116]]),
  P('fo_keep', [[27, 94], [53, 94], [53, 106], [27, 106]], true),
];
const L = (c, r, rot = 0) => ({ kind: 'lamp', x: px(c), y: px(r + OY), w: 8, h: 8, height: 120, rotation: rot });
const B = (kind, c, r, w, h, height, rotation = 0) => ({ kind, x: px(c), y: px(r + OY), w, h, height, rotation });
const props = [
  // The renderer gives the first six lamps shadows: put them at the encounters.
  L(79, 14), L(125, 43), L(57, 38), L(56, 71), L(113, 72), L(81, 102),
  L(4, 15, 90), L(102, 16, 90), L(125, 21, 90), L(28, 45, 90), L(94, 72, 90), L(150, 100), L(10, 103), L(150, 30),
  B('railcar', 26, 67, 128, 48, 40), B('railcar', 42, 67, 128, 48, 40), B('railcar', 70, 67, 128, 48, 40),
  B('railcar', 30, 82, 128, 48, 40), B('railcar', 58, 81, 128, 48, 40), B('railcar', 86, 82, 128, 48, 40),
  B('barrier', 112, 74, 12, 128, 20), B('barrier', 80, 104, 12, 128, 20),
  B('barrel', 127, 41, 14, 14, 22), B('barrel', 128, 42, 14, 14, 22), B('barrel', 116, 71, 14, 14, 22),
  B('barrel', 85, 101, 14, 14, 22), B('barrel', 86, 101, 14, 14, 22), B('barrel', 60, 96, 14, 14, 22),
  B('barrel', 78, 19, 14, 14, 22), B('barrel', 134, 47, 14, 14, 22),
  B('barrier', 152, 14, 64, 10, 24), B('railcar', 4, 96, 128, 48, 40),
  // the Wall road: sparse lamps (unshadowed), barrels by the hut
  L(128, 6 - OY, 90), L(96, 3 - OY, 90), L(64, 6 - OY, 90), L(32, 3 - OY, 90), L(6, 7 - OY),
  B('barrel', 133, 8 - OY, 14, 14, 22), B('barrier', 146, 2 - OY, 12, 64, 20),
];
const level = { format: 'ironveil-level', formatVersion: 1, id: 'long-night', version: 1, name: 'The Long Night', tile: T, terrain, markers, zones, paths, props };
writeFileSync(process.argv[2], JSON.stringify(level, null, 1));
console.log(terrain.join('\n'));
