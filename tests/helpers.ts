import { parseAsciiMap } from '../src/sim/map';
import type { GameMap } from '../src/sim/map';

/** Open field (all grass) bounded by walls. */
export function openMap(cols = 40, rows = 30): GameMap {
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    let s = '';
    for (let c = 0; c < cols; c++) s += r === 0 || c === 0 || r === rows - 1 || c === cols - 1 ? '#' : '.';
    lines.push(s);
  }
  return parseAsciiMap(lines);
}

export function mapWith(lines: string[]): GameMap {
  return parseAsciiMap(lines);
}
