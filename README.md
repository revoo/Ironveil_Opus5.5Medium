# Ironveil

A top-down stealth tank game in the browser: a tank crew, a divided city, a long night. The main
mode is a **mission campaign** rendered in 3D (isometric Three.js): sneak or fight through
checkpoint districts while your crew talks you through it, and make real-time decisions they will
remember. The original **team deathmatch** against a tactical AI squad remains as a 2D
**Skirmish** mode.

> **Status:** campaign foundation. Three missions: *The Long Night*, the 5-10 minute playtest level
> (eleven stretches across a whole city), *Night Run*, a shorter demo with the same pacing (a few
> guards per stretch, checkpoints with field repairs between them), and the grey box *The Crossing*, which exercises every system once: levels, missions, garrison AI,
> checkpoints, real-time choices, the 3D renderer and the adaptive audio. Story, crew system and real levels are next. Multiplayer is deferred
> ([docs/DECISIONS.md](docs/DECISIONS.md)).

## Quick start

Requires Node.js 22+.

```bash
npm install
npm run dev          # http://localhost:5173  → Play mission
```

```bash
npm run build && npm run preview     # production build on http://localhost:4173
```

## Controls (remappable in Settings)

| Input | Action |
|---|---|
| **W A S D** | Drive. In missions, movement is screen-relative (W = up the screen). Momentum carries: tap the opposite direction to brake, steer early to drift. |
| **Mouse** | Aim. The ring on the cursor shows the cannon: filling = reloading or charging. |
| **Space** (hold → release) or LMB | Charge, then fire. A tap is quick and light; full charge is heavy, slows you and is audible, and vents after 1.5 s. |
| **Right mouse** / E | Cancel a charge |
| **Q** | Smoke |
| **Shift** (hold) | Silent running: slow and quiet |
| **1 2 3** | Answer a crew decision (missions) |
| **Wheel** | Zoom (missions) |
| **Esc** / P | Pause |
| **V** | Performance telemetry: FPS, frame times, CPU/GPU split, draw calls (missions) |

## What's in the build

- **Missions** ([docs/MISSIONS.md](docs/MISSIONS.md)): JSON triggers and objectives, crew radio,
  real-time choices, checkpoints. Levels are data authored in LDtk ([docs/LEVELS.md](docs/LEVELS.md)).
- **Two AI tiers**: a readable garrison AI with a stealth suspicion meter and spoken barks ("Going to
  check it out", "Enemy spotted!", "Reloading!") shown as callouts over visible enemies, and the
  full tactical squad AI (utility goals, GOAP plans, flanking, searching) for bosses and Skirmish
  ([docs/AI.md](docs/AI.md)).
- **Simulation**: a fixed 30 Hz deterministic sim with momentum driving, a charge/tap cannon with
  swept collision, vision, brush, smoke, sound cues and mud tracks. Clients only ever see their
  team's filtered `Observation`, so hidden enemies are never rendered.
- **3D mission renderer**: procedural PBR materials, Berlin-wall slabs and buildings generated from
  the level's wall tiles, shadowed streetlamps, rain, mist, ambient occlusion, bloom and a film grade.
- **Combat feedback**: armour hits glow and throw spall, damaged tanks smoke and then burn, enemy
  health bars and a cursor hit marker. A kill is a fireball with a shockwave and debris, the turret
  blown off, two to five ammunition cook-offs, and a wreck that burns for half a minute.
- **Audio**, all synthesised: an adaptive score that follows detection, radio treatment for crew
  lines, night-city ambience, urban reverb.

## Project layout

| Path | Contents |
|---|---|
| `src/sim` | Headless deterministic simulation and the per-team `Observation` filter |
| `src/ai` | Tactical AI (`bot.ts`, `controller.ts`, …) and garrison AI (`simple.ts`) |
| `src/level` | Level format, loader/validator, LDtk importer |
| `src/game` | `LocalSession` (Skirmish), `mission/` (MissionSession, trigger runner, validator) |
| `src/content` | Relay Yard (Skirmish map), `levels/*.json`, `missions/*.json` + registry |
| `src/client` | App shell (`main.ts`), Phaser 2D Skirmish client, `three/` 3D mission view, `sound/` audio |
| `tests` | Vitest suites |
| `tools` | `import-ldtk.ts`, `soak.ts`, `map-preview.ts` |
| `docs` | Design and reference docs (see below) |

## Commands

```bash
npm test                 # all suites (sim, AI, levels, missions, grey-box playthrough)
npm run typecheck
npm run level:import -- project.ldtk --level Level_0 --id my-level --out src/content/levels/my-level.json
npm run soak -- 20 3 normal     # headless Skirmish bot matches with metrics
```

## Docs

[MISSIONS](docs/MISSIONS.md) · [LEVELS](docs/LEVELS.md) · [AI](docs/AI.md) ·
[DECISIONS](docs/DECISIONS.md) · [CREW-PROPOSAL](docs/CREW-PROPOSAL.md) (awaiting decisions) ·
[ASSETS](docs/ASSETS.md) · [VALIDATION](docs/VALIDATION.md) and [PLAYTEST](docs/PLAYTEST.md) (Skirmish era)
