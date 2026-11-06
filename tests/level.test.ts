import { describe, it, expect } from 'vitest';
import { LEVEL_FORMAT, LEVEL_FORMAT_VERSION, type LevelData } from '../src/level/format';
import { inZone, LevelError, loadLevel, validateLevel } from '../src/level/load';
import { ldtkToLevel, LdtkImportError, type LdtkProject } from '../src/level/ldtk';
import { Terrain, tileAt } from '../src/sim/map';

function level(over: Partial<LevelData> = {}): LevelData {
  return {
    format: LEVEL_FORMAT,
    formatVersion: LEVEL_FORMAT_VERSION,
    id: 'test',
    version: 1,
    name: 'Test',
    tile: 32,
    terrain: [
      '############',
      '#..........#',
      '#..==..""..#',
      '#..==..""..#',
      '#....~~....#',
      '#..........#',
      '############',
    ],
    markers: [
      { id: 'start', x: 64, y: 64, tags: ['player-start'] },
      { id: 'guard', x: 320, y: 64, facing: 180, tags: ['enemy-spawn'] },
    ],
    zones: [{ id: 'exit', x: 288, y: 128, w: 64, h: 64, tags: ['extraction'] }],
    paths: [{ id: 'loop', points: [{ x: 96, y: 160 }, { x: 320, y: 160 }], loop: true }],
    props: [{ kind: 'barrel', x: 100, y: 100, w: 10, h: 10, height: 20 }],
    ...over,
  };
}

describe('level loading', () => {
  it('builds a GameMap with terrain, spawns and lookups', () => {
    const l = loadLevel(level());
    expect(l.map.cols).toBe(12);
    expect(l.map.rows).toBe(7);
    expect(tileAt(l.map, 0, 0)).toBe(Terrain.Wall);
    expect(tileAt(l.map, 3, 2)).toBe(Terrain.Road);
    expect(tileAt(l.map, 7, 2)).toBe(Terrain.Brush);
    expect(tileAt(l.map, 5, 4)).toBe(Terrain.Mud);
    expect(l.map.spawns[0]).toEqual([{ x: 64, y: 64 }]);
    expect(l.map.spawns[1]).toEqual([{ x: 320, y: 64 }]);
    expect(l.marker('guard').facing).toBe(180);
    expect(inZone(l.zone('exit'), { x: 300, y: 150 })).toBe(true);
    expect(l.zonesTagged('extraction').map((z) => z.id)).toEqual(['exit']);
    expect(() => l.path('missing')).toThrow(/no path "missing"/);
  });

  it('a valid level has no problems', () => {
    expect(validateLevel(level())).toEqual([]);
  });

  it('reports shape and glyph errors', () => {
    expect(validateLevel(level({ terrain: ['###', '#.#', '##'] }))).toContain('terrain row 2 has 2 tiles, expected 3');
    expect(validateLevel(level({ terrain: ['###', '#X#', '###'] }))[0]).toMatch(/unknown glyph "X"/);
  });

  it('reports duplicate ids, walls, bounds and a missing player start', () => {
    const p = validateLevel(
      level({
        markers: [
          { id: 'a', x: 10, y: 10 },
          { id: 'a', x: 64, y: 64 },
        ],
        zones: [{ id: 'z', x: 300, y: 100, w: 500, h: 10 }],
      }),
    );
    expect(p).toContain('duplicate id "a" (marker and marker)');
    expect(p).toContain('no marker tagged "player-start"');
    expect(p).toContain('marker "a" is too close to a wall for a tank');
    expect(p).toContain('zone "z" extends outside the map');
  });

  it('reports places a tank cannot reach', () => {
    const p = validateLevel(
      level({
        terrain: [
          '##########',
          '#...#....#',
          '#...#....#',
          '#...#....#',
          '##########',
        ],
        markers: [
          { id: 'start', x: 64, y: 80, tags: ['player-start'] },
          { id: 'island', x: 224, y: 80 },
        ],
        zones: [],
        paths: [],
      }),
    );
    expect(p).toContain('marker "island" cannot be reached from the player start');
  });

  it('loadLevel throws a LevelError listing every problem', () => {
    expect(() => loadLevel(level({ markers: [] }))).toThrow(LevelError);
  });
});

describe('LDtk import', () => {
  const project: LdtkProject = {
    levels: [
      {
        identifier: 'Level_0',
        pxWid: 128,
        pxHei: 96,
        layerInstances: [
          {
            __identifier: 'Entities',
            __type: 'Entities',
            __gridSize: 32,
            __cWid: 4,
            __cHei: 3,
            entityInstances: [
              { __identifier: 'Marker', px: [48, 48], __pivot: [0.5, 0.5], width: 16, height: 16, fieldInstances: [{ __identifier: 'id', __type: 'String', __value: 'start' }, { __identifier: 'tags', __type: 'String', __value: 'player-start, checkpoint' }, { __identifier: 'facing', __type: 'Int', __value: 90 }] },
              { __identifier: 'Zone', px: [64, 32], __pivot: [0, 0], width: 32, height: 32, fieldInstances: [{ __identifier: 'id', __type: 'String', __value: 'exit' }, { __identifier: 'tags', __type: 'Array<String>', __value: ['extraction'] }] },
              { __identifier: 'Path', px: [48, 48], __pivot: [0.5, 0.5], width: 16, height: 16, fieldInstances: [{ __identifier: 'id', __type: 'String', __value: 'p' }, { __identifier: 'points', __type: 'Array<Point>', __value: [{ cx: 2, cy: 1 }] }, { __identifier: 'loop', __type: 'Bool', __value: true }] },
              { __identifier: 'Prop', px: [0, 0], __pivot: [0, 0], width: 32, height: 16, fieldInstances: [{ __identifier: 'kind', __type: 'LocalEnum.PropKind', __value: 'Barrel' }, { __identifier: 'height', __type: 'Int', __value: 22 }] },
            ],
          },
          { __identifier: 'Terrain', __type: 'IntGrid', __gridSize: 32, __cWid: 4, __cHei: 3, intGridCsv: [5, 5, 5, 5, 0, 1, 2, 3, 5, 4, 5, 5] },
        ],
      },
    ],
  };

  it('converts terrain, markers, zones, paths and props', () => {
    const l = ldtkToLevel(project, { id: 'gate', name: 'Gate', version: 3 });
    expect(l.id).toBe('gate');
    expect(l.version).toBe(3);
    expect(l.tile).toBe(32);
    expect(l.terrain).toEqual(['####', '..=~', '#"##']);
    expect(l.markers).toEqual([{ id: 'start', x: 48, y: 48, facing: 90, tags: ['player-start', 'checkpoint'] }]);
    expect(l.zones).toEqual([{ id: 'exit', x: 64, y: 32, w: 32, h: 32, tags: ['extraction'] }]);
    expect(l.paths).toEqual([{ id: 'p', points: [{ x: 48, y: 48 }, { x: 80, y: 48 }], loop: true }]);
    expect(l.props).toEqual([{ kind: 'Barrel', x: 0, y: 0, w: 32, h: 16, height: 22 }]);
  });

  it('explains missing layers and unknown entities', () => {
    expect(() => ldtkToLevel({ levels: [{ identifier: 'L', pxWid: 1, pxHei: 1, layerInstances: [] }] })).toThrow(/IntGrid layer named "Terrain"/);
    const bad = structuredClone(project);
    bad.levels[0]!.layerInstances![0]!.entityInstances!.push({ __identifier: 'Tree', px: [0, 0], width: 1, height: 1, fieldInstances: [] });
    expect(() => ldtkToLevel(bad)).toThrow(LdtkImportError);
  });
});
