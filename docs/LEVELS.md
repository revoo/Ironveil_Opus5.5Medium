# Levels

Levels are data, not code. Each one is an Ironveil level JSON file (`src/level/format.ts`), authored
in [LDtk](https://ldtk.io) and converted with `npm run level:import`. You can also write the JSON by
hand. The grey-box level `src/content/levels/greybox.json` was written that way.

```
LDtk project (.ldtk) ──npm run level:import──► level JSON ──loadLevel()──► GameMap + markers/zones/paths
                                                  │
                                                  └── validated: shape, ids, walls, bounds, reachability
```

## What a level contains

| Part | Used by | Notes |
|---|---|---|
| **Terrain** | simulation | One tile grid: grass, road, mud, brush, wall. Walls block movement, sight and shells. Brush hides tanks. Mud slows them down and keeps tracks. Road is fast. |
| **Markers** | missions | Named points: unit spawns, checkpoints, landmarks. Optional `facing` in degrees (0 = east, 90 = south). |
| **Zones** | missions | Named rectangles: "player entered the gate", extraction, no-go areas. |
| **Paths** | AI | Named point lists for patrols and convoys. `loop` = circuit, otherwise back and forth. |
| **Props** | 3D renderer | Set dressing with a `kind` and a `height`. They have **no gameplay effect**. Anything that should block must be wall terrain. |

Recognised marker tags: `player-start` (required), `enemy-spawn`, `landmark` (hint points for the
tactical AI), `checkpoint`.

## Setting up the LDtk project (once)

1. **New project**, default grid size **32**.
2. **Layers**, exact names matter:
   - an **IntGrid** layer named **`Terrain`** with values:
     | Value | Name | Suggested colour |
     |---|---|---|
     | 1 | Grass | dark green |
     | 2 | Road | khaki |
     | 3 | Mud | brown |
     | 4 | Brush | bright green |
     | 5 | Wall | light grey |
     Empty cells count as grass.
   - an **Entities** layer named **`Entities`**.
3. **Entities**, exact names and field identifiers:
   | Entity | Shape | Fields |
   |---|---|---|
   | `Marker` | point (fixed 16×16, pivot centre) | `id` String, `tags` String (comma separated) or Array<String>, `facing` Int (optional) |
   | `Zone` | resizable rectangle | `id` String, `tags` String (optional) |
   | `Path` | point | `id` String, `points` Array of Points, `loop` Bool. The entity's own position is the first point. |
   | `Prop` | resizable rectangle | `kind` String or Enum, `height` Int, `rotation` Int (optional) |
4. Paint terrain, place entities, save.

## Importing

```bash
npm run level:import -- path/to/project.ldtk --level Level_0 --id checkpoint-gate --name "Checkpoint Gate" --out src/content/levels/checkpoint-gate.json
```

The tool writes the JSON and then prints every problem it finds, for example:

```
  - marker "guard_2" is too close to a wall for a tank
  - path "east_patrol" point 3 cannot be reached
  - zone "safehouse" cannot be entered from the player start
```

It exits non-zero if the level is invalid, so a broken level never sneaks in. The test suite
validates every level that ships.

## Practical advice

- **Tanks are big.** Their radius is 20 px and a tile is 32 px, so gaps and corridors need to be at
  least **2 tiles wide**, ideally 3.
- **Build stealth lines with brush and walls.** Vision is 440 px (about 14 tiles). Brush hides a
  tank unless an enemy is within about 110 px or the tank fires.
- **Keep ids meaningful** (`gate_guard_west`, `market_patrol`). Missions refer to them by name.
- **Block out first, dress later.** Get the layout fun with terrain, markers and paths only, and add
  props when the mission works.
