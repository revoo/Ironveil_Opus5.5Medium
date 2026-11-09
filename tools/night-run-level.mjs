// Generates src/content/levels/night-run.json (the demo map). Edit the rectangles here, then:
//   node tools/night-run-level.mjs src/content/levels/night-run.json
// Tile coords (col,row); markers sit at tile centres. The ASCII map is printed for a quick look.
import { writeFileSync } from 'node:fs';
const W = 120, H = 78, T = 32;
const g = Array.from({ length: H }, () => Array(W).fill('.'));
const R = (c0, r0, c1, r1, ch) => { for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (r >= 0 && c >= 0 && r < H && c < W) g[r][c] = ch; };
const px = (c) => c * T + 16;

// ---- frame and the two dividers (staggered building rows) with the turns at alternate ends
R(0, 0, W - 1, 0, '#'); R(0, H - 1, W - 1, H - 1, '#'); R(0, 0, 0, H - 1, '#'); R(W - 1, 0, W - 1, H - 1, '#');
const divider = (c0, c1, r0, r1) => { for (let c = c0, k = 0; c <= c1; c += 9, k++) R(c, r0 + (k % 2), Math.min(c + 8, c1), r1, '#'); };
divider(0, 103, 24, 27);   // rows ~24-28, open at the east (cols 104-118)
divider(16, W - 1, 50, 53); // rows ~50-54, open at the west (cols 1-15)

// ---- main road: east along band 1, down the east turn, west along band 2, down the west turn, east along band 3
R(1, 12, 111, 13, '='); R(110, 12, 111, 40, '='); R(7, 39, 111, 40, '='); R(7, 39, 8, 66, '='); R(7, 65, 118, 66, '=');

// ===== Band 1: outskirts (A) and rail yard (B)
R(2, 4, 5, 7, '"'); R(3, 18, 7, 21, '"');                    // start cover
R(16, 3, 21, 8, '#'); R(16, 17, 21, 22, '#'); R(27, 16, 32, 20, '#'); R(35, 3, 40, 7, '#'); R(44, 16, 49, 21, '#'); // outskirts houses
R(23, 2, 33, 3, '"'); R(33, 21, 43, 23, '"'); R(41, 2, 50, 4, '"'); R(22, 9, 24, 10, '"');  // hedges: north and south sneaking lanes
R(51, 4, 54, 9, '#'); R(51, 16, 54, 21, '#');                // houses framing checkpoint 1
R(60, 2, 67, 8, '#'); R(60, 17, 67, 22, '#'); R(73, 16, 79, 20, '#'); R(88, 3, 95, 8, '#'); R(88, 17, 95, 22, '#'); R(98, 2, 102, 7, '#'); // warehouses
R(70, 2, 79, 6, '~');                                         // churned yard, north
R(68, 22, 101, 23, '"'); R(80, 20, 87, 21, '"');               // brush along the south fence
R(83, 1, 83, 9, '#'); R(83, 15, 83, 19, '#');                  // yard fence: road gate rows 10-14, gap rows 20-24
R(103, 14, 106, 19, '#');                                      // shed by the turn

// ===== Band 2: market (C) heading west, then the canal (D)
R(112, 29, 117, 34, '"'); R(113, 44, 117, 48, '"');            // turn cover
R(66, 31, 77, 34, '#'); R(81, 31, 89, 34, '#'); R(93, 31, 104, 34, '#'); // north frontage, gaps at cols 78-80, 90-92
R(70, 28, 74, 29, '"'); R(95, 28, 100, 29, '"'); R(84, 28, 87, 28, '"'); // back alley brush
R(66, 44, 75, 49, '#'); R(79, 45, 86, 49, '#'); R(90, 44, 98, 49, '#'); R(101, 43, 107, 49, '#'); // south frontage
R(82, 36, 84, 37, '"'); R(94, 42, 96, 43, '"');                // market stalls (brush)
R(60, 30, 62, 35, '#'); R(57, 44, 62, 48, '#');                // checkpoint 3 houses
R(34, 28, 39, 50, '~'); R(34, 38, 39, 41, '=');                // canal; bridge on the road (rows 38-41)
R(33, 28, 33, 37, '#'); R(33, 42, 33, 45, '#'); R(40, 28, 40, 37, '#'); R(40, 42, 40, 45, '#'); // embankments; ford rows 46-50
R(42, 44, 50, 49, '"'); R(26, 44, 32, 49, '"');                // reeds either side of the ford
R(44, 29, 50, 34, '#'); R(19, 29, 26, 34, '#'); R(18, 44, 23, 49, '#'); // canal-side buildings
R(2, 29, 5, 33, '"');

// ===== Band 3: road checkpoint (E) and the depot (F)
R(2, 70, 5, 75, '"'); R(11, 56, 14, 60, '#'); R(11, 70, 15, 75, '#');
R(18, 58, 25, 62, '#'); R(20, 70, 28, 75, '#');
R(40, 55, 40, 57, '"'); R(40, 58, 40, 62, '#'); R(40, 69, 40, 76, '#'); R(40, 53, 40, 54, '#'); // wall with a road gate (63-68) and a broken, overgrown gap (55-57)
R(28, 54, 52, 57, '"'); R(42, 58, 46, 59, '"');                // overgrowth along the north wall
R(48, 69, 55, 75, '#'); R(30, 69, 36, 74, '~');
R(58, 56, 61, 60, '#'); R(58, 70, 62, 74, '#');                // checkpoint 5 houses
R(80, 54, 80, 62, '#'); R(80, 69, 80, 71, '#');                // depot fence: gate rows 63-68, drainage gap rows 72-76
R(66, 72, 90, 76, '~'); R(70, 70, 78, 71, '"'); R(79, 74, 112, 76, '"');
R(88, 55, 96, 60, '#'); R(100, 55, 108, 59, '#'); R(97, 69, 105, 72, '#');
R(110, 55, 112, 58, '#');

const terrain = g.map((r) => r.join(''));

const M = (id, c, r, facing, tags) => ({ id, x: px(c), y: px(r), ...(facing !== undefined ? { facing } : {}), ...(tags ? { tags } : {}) });
const markers = [
  M('start', 4, 12, 0, ['player-start']),
  M('cp_yard', 56, 12, 0, ['checkpoint']),
  M('cp_turn', 112, 27, 90, ['checkpoint']),
  M('cp_market', 59, 39, 180, ['checkpoint']),
  M('cp_bend', 9, 56, 90, ['checkpoint']),
  M('cp_depot', 63, 65, 0, ['checkpoint']),
  M('a_patrol_start', 22, 11),
  M('b_gate', 86, 12, 180, ['enemy-spawn']),
  M('b_patrol_start', 89, 11),
  M('c_post', 87, 40, 0, ['enemy-spawn']),
  M('c_patrol_start', 100, 37),
  M('d_bridge', 30, 40, 0, ['enemy-spawn']),
  M('d_patrol_start', 25, 36),
  M('e_gate', 44, 64, 180, ['enemy-spawn']),
  M('f_gate_n', 84, 62, 180, ['enemy-spawn']),
  M('f_gate_s', 84, 68, 180, ['enemy-spawn']),
  M('f_patrol_start', 98, 63),
  M('f_qrf', 115, 72, 180),
  M('depot', 115, 65, undefined, ['landmark']),
];
const Z = (id, c0, r0, c1, r1, tags) => ({ id, x: c0 * T, y: r0 * T, w: (c1 - c0 + 1) * T, h: (r1 - r0 + 1) * T, ...(tags ? { tags } : {}) });
const zones = [
  Z('outskirts', 15, 1, 30, 24),
  Z('z_yard', 55, 1, 57, 24),
  Z('yard_inside', 84, 1, 102, 24),
  Z('z_turn', 104, 24, 118, 28),
  Z('market', 66, 29, 104, 50),
  Z('z_market', 58, 36, 60, 43),
  Z('canal', 33, 28, 40, 50),
  Z('z_bend', 1, 51, 15, 56),
  Z('z_depot', 63, 54, 65, 76),
  Z('depot_inside', 81, 54, 118, 76),
  Z('extraction', 113, 60, 118, 70, ['extraction']),
];
const P = (id, pts, loop) => ({ id, points: pts.map(([c, r]) => ({ x: px(c), y: px(r) })), ...(loop ? { loop: true } : {}) });
const paths = [
  P('a_road', [[22, 11], [40, 11], [40, 14], [22, 14]], true),
  P('b_yard', [[89, 11], [99, 11], [99, 14], [89, 14]], true),
  P('c_market', [[100, 37], [100, 41], [78, 41], [78, 37]], true),
  P('d_bank', [[25, 36], [25, 43]]),
  P('f_depot', [[98, 63], [108, 63], [108, 68], [86, 68], [86, 63]], true),
];
const L = (c, r, rot, kind = 'lamp') => ({ kind, x: px(c), y: px(r), w: 8, h: 8, height: 120, rotation: rot });
const props = [
  // Six shadowed lamps first (the renderer gives the first six shadows): the encounter spots.
  L(84, 11, 0), L(87, 38, 0), L(31, 42, 0), L(44, 62, 0), L(82, 62, 0), L(110, 64, 0),
  L(56, 14, 90), L(112, 30, 0), L(8, 52, 0), L(62, 64, 0), L(24, 14, 90),
  { kind: 'railcar', x: px(68) , y: px(10), w: 128, h: 48, height: 40, rotation: 0 },
  { kind: 'railcar', x: px(76), y: px(10), w: 128, h: 48, height: 40, rotation: 0 },
  { kind: 'railcar', x: px(96), y: px(16), w: 128, h: 48, height: 40, rotation: 0 },
  { kind: 'barrier', x: px(83), y: px(12), w: 12, h: 96, height: 20 },
  { kind: 'barrier', x: px(80), y: px(65), w: 12, h: 128, height: 20 },
  { kind: 'barrel', x: px(85), y: px(9), w: 14, h: 14, height: 22 },
  { kind: 'barrel', x: px(86), y: px(9), w: 14, h: 14, height: 22 },
  { kind: 'barrel', x: px(45), y: px(61), w: 14, h: 14, height: 22 },
  { kind: 'barrel', x: px(88), y: px(42), w: 14, h: 14, height: 22 },
  { kind: 'barrel', x: px(104), y: px(62), w: 14, h: 14, height: 22 },
  { kind: 'railcar', x: px(114), y: px(57), w: 128, h: 48, height: 40, rotation: 0 },
  { kind: 'railcar', x: px(114), y: px(73), w: 128, h: 48, height: 40, rotation: 0 },
];
const level = { format: 'ironveil-level', formatVersion: 1, id: 'night-run', version: 1, name: 'Demo: Night Run', tile: T, terrain, markers, zones, paths, props };
writeFileSync(process.argv[2], JSON.stringify(level, null, 1));
console.log(terrain.join('\n'));
