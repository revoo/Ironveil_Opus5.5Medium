# Ironveil: notes for agents

Browser stealth-tank game (TypeScript, Vite). **Main mode: missions in a 3D isometric Three.js view.**
Secondary: 2D Phaser "Skirmish" team deathmatch (the original game). Read README.md for the player view.
The owner prefers conservative scope, polish over breadth, and honest effort estimates.

## Commands

```bash
npm test            # vitest, all suites must stay green
npm run typecheck   # tsc --noEmit (strict, noUnusedLocals)
npm run build       # typecheck + vite build
npm run dev         # http://localhost:5173
```

## Map: what lives where

| Task | Files |
|---|---|
| Simulation rules (movement, cannon, vision, sound, match/mission rules) | `src/sim/` (`world.ts` is the tick; `observation.ts` filters per team) |
| Garrison AI (patrol/guard, suspicion meter, alarms) | `src/ai/simple.ts` (+ `SIMPLE_TUNING`) |
| Tactical AI (bosses, Skirmish bots) | `src/ai/bot.ts`, `controller.ts`, `memory.ts`, `tactics.ts`, `planner.ts`, `nav.ts`, `motor.ts` (see docs/AI.md) |
| Level format, validation, LDtk import | `src/level/` · docs/LEVELS.md |
| Missions: data types, trigger runner, validator, session (checkpoints, choices) | `src/game/mission/` · docs/MISSIONS.md |
| Content | `src/content/levels/*.json`, `src/content/missions/*.json` + `missions/index.ts` registry |
| App shell: menus, pause, results, start/stop of both modes | `src/client/main.ts` |
| 3D mission view | `src/client/three/`: `view.ts` (loop, camera, input, events), `world.ts` (level → scene), `models.ts`, `materials.ts` (procedural PBR), `fx.ts`, `hud.ts` (DOM HUD) |
| 2D Skirmish client | `src/client/GameScene.ts`, `hud.ts`, `fx.ts`, `textures.ts` (Phaser) |
| Audio (all synthesised) | `src/client/audio.ts` (engine, SFX, buses), `src/client/sound/` (music, radio, ambience) |
| Styles | `src/client/style.css` (menus, then the `.h3` 3D HUD block) |

## Invariants (do not break)

- `src/sim`, `src/ai`, `src/game`, `src/level` are headless: no Phaser, DOM or client imports
  (enforced by `tests/architecture.test.ts`). AI never imports `sim/world`.
- Renderers draw from the player team's `Observation` only, never from `World` directly, so hidden
  enemies never reach the screen. The one exception is deliberate: the 3D HUD reads the garrison
  AI's alert state for enemies that are *already visible*, to draw ?/! markers.
- The sim is deterministic at 30 Hz; presentation interpolates `prevObs → obs` by `session.alpha`.
- Levels and missions are validated on load and in tests (`tests/greybox.test.ts` validates every
  registered mission). Add new content to the registry and the tests cover it.
- Commit attribution lines are supplied by the harness; never put model names in code or commits.

## Gotchas

- Mission/level JSON imports are cast to their types in `src/content/missions/index.ts` (JSON
  widens string literals); runtime validation is the real check.
- `Surface` enum values in `three/materials.ts` are baked into GLSL `#if` branches; don't renumber.
- The GTAO pass re-renders depth+normals: transparent/sprite/point/line objects are hidden for
  that pass (see `buildComposer` in `view.ts`), or AO wraps around mist and light cones.
- Static scenery is merged per material (`mergeStatic`) for draw calls; anything that must move or
  change per frame (lamp bulbs via shared material colour, tanks) stays separate.
- Audio only starts after a user gesture (`audio.unlock()` on first pointer/key). `audio.tap()`
  exposes the final mix for recording previews.
- Debug hook in the browser: `window.__ironveil` → `{ game, hud, settings, audio, mission() }`.
  Headless screenshots: Playwright + SwiftShader; the sim runs in slow motion there, so tests
  teleport the player via `__ironveil.mission().world.tank(0).pos`.

## Status and next steps

- `main` holds everything. The Render Lab rendering experiment is preserved as the tag
  `archive/poc-render-tech` (not a branch); its code now lives in `src/client/three/`.
- Awaiting owner decisions: docs/CREW-PROPOSAL.md (crew health/morale/trust, value-tagged choices).
- Planned: crew system phase 1, Ink dialogue, first real LDtk mission, recorded CC0 weapon/engine
  samples to replace the weakest synthesised SFX.
- docs/VALIDATION.md and docs/PLAYTEST.md describe the Skirmish-era build only.
