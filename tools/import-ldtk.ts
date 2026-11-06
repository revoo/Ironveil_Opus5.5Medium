// Convert an LDtk project level into an Ironveil level JSON and validate it.
//   npm run level:import -- path/to/project.ldtk --level Level_0 --id checkpoint-gate --name "Checkpoint Gate" --out src/content/levels/checkpoint-gate.json
import { readFileSync, writeFileSync } from 'node:fs';
import { ldtkToLevel, type LdtkProject } from '../src/level/ldtk';
import { validateLevel } from '../src/level/load';

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith('--'));
const opt = (k: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!input) {
  console.error('usage: npm run level:import -- <project.ldtk> [--level Level_0] [--id my-level] [--name "My Level"] [--version 1] [--out file.json]');
  process.exit(2);
}
const project = JSON.parse(readFileSync(input, 'utf8')) as LdtkProject;
const o: Parameters<typeof ldtkToLevel>[1] = {};
const lv = opt('level'), id = opt('id'), name = opt('name'), ver = opt('version');
if (lv) o.levelId = lv;
if (id) o.id = id;
if (name) o.name = name;
if (ver) o.version = Number(ver);
const level = ldtkToLevel(project, o);
const problems = validateLevel(level);
const out = opt('out') ?? `${level.id}.json`;
writeFileSync(out, JSON.stringify(level, null, 2) + '\n');
console.log(`wrote ${out}: ${level.terrain[0]!.length}x${level.terrain.length} tiles, ${level.markers.length} markers, ${level.zones.length} zones, ${level.paths.length} paths, ${level.props.length} props`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
console.log('valid');
