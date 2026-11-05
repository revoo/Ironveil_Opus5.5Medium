# Decision log

The owner directives (solo first, team deathmatch, Space fires, slippery movement, smooth
presentation, tactical AI, inertial recoil, FX pass, test-first) override the original V1 spec where
they conflict. Everything else follows the spec unless listed here.

| # | Decision | Why |
|---|---|---|
| D1 | **Multiplayer deferred.** No Colyseus, server, rooms, VPS or reconnect code. | Owner directive 1. The simulation stays headless and transport-free (`src/sim`, `src/ai`, `src/game` import no DOM/Phaser; enforced by `tests/architecture.test.ts`), so an authoritative server can wrap it later. |
| D2 | **Team deathmatch replaces Relay Control.** First to 15 kills or most kills at 8:00; a tie goes to 60 s of sudden death (next kill wins, else draw). 5 s respawn, 2 s spawn protection that ends when you fire. | Owner directive 2. The kill target and timer keep matches around 4–5 minutes (measured, see VALIDATION.md). |
| D3 | **Controls:** Space (or LMB) charges and fires on release; Q smokes; RMB (or E) cancels; Shift is silent running; Tab shows the scoreboard; Esc/P pauses. All remappable. | Owner directive 3. LMB is kept as a secondary fire binding because it costs nothing and some players expect it. |
| D4 | **Slippery world-space movement** (see `src/sim/movement.ts`). The velocity component along the requested direction accelerates (580 px/s²) or brakes hard when opposed (1150 px/s²). The sideways component decays slowly (`lateralGrip` 280 px/s²), which produces drifts. Releasing input coasts (180 px/s²). The hull only *visually* rotates toward the request, at 300°/s. | Owner directive 4, replacing the spec's heading-constrained driving. A tank drifting at top speed takes about 0.7 s to shed its sideways slide, which is long enough to feel, short enough to stay controllable in a fight. |
| D5 | **Soft tank–tank separation** (35% of overlap per tick). | Under the spec, tanks pass through each other. With slippery movement, overlapping hulls looked broken, and bots stacked up. Separation is cosmetic-grade and symmetric, and never blocks shells. |
| D6 | **Solo authority runs on the main thread** behind `LocalSession` (fixed 30 Hz accumulator, presentation interpolates between the last two ticks). There is no Web Worker. | Worker messaging adds jitter and up to a tick of extra input latency for the player's own tank. With the sim and AI measured at about 0.08 ms per tick for six bots, there's no performance reason for a worker. The session interface (advance, observe, events, pause, restart) is the seam a worker or server host would use. |
| D7 | **No offline service worker yet.** | Deferred with the rest of the delivery/ops work. The build is static and runs from any local server. |
| D8 | **Map authored as point-symmetric builder code** (`src/content/relayYard.ts`) rather than Tiled. It's validated at test time: spawn clearance, reachability, symmetry, stable id/version. | Keeps one source of truth with no Tiled toolchain. Symmetry guarantees fairness, and the validation still catches authoring mistakes. |
| D9 | **Lighting and fog use small CPU canvases** (light map 320×180 multiplied over the world, bloom 240×135 additive, fog 240×135), uploaded as textures each frame. | Phaser RenderTexture compositing was harder to reason about. Canvas layers are deterministic, cheap (the whole frame costs ~1.1 ms of CPU, median), and their low resolution gives soft fog and light edges for free. |
| D10 | **The fog is cosmetic; the observation is authoritative.** The renderer only ever receives the player-team `Observation`. All FX, lights, sounds and decals are spawned from it. | Decorative effects can't reveal hidden enemies because hidden enemies never reach the client. |
| D11 | **Smoke clouds are shown to a team when within sight range + radius of a teammate** (smoke billows above walls). | The spec doesn't say when a distant cloud is visible. This shows nearby clouds without broadcasting far-away ones. |
| D12 | **AI architecture: utility goal selection + GOAP planning + action executors + squad coordinator.** See [AI.md](AI.md). | Owner directive 6 (F.E.A.R.-inspired). It replaces the spec's "small state machine with utility scores". |
| D13 | **Bots press keys like a person.** Bot movement is quantised to the same 8 directions as WASD, and bots go through the same turret traverse limit and weapon state machine. | Fairness. Difficulty comes from behaviour, not control precision. |
| D14 | **Training is a checklist sandbox** with three harmless scripted targets, not a linear scripted tutorial. | It teaches the same skills (drive, drift, tap, charge, cancel, lead a mover, smoke, silent, brush) in about two minutes, without a separate scripting system. |
| D15 | **Team identity is not colour-only.** Ironveil (blue) has an angular chevron hull and a round turret. Rustguard (orange) has a boxy skirted hull, bar markings and a hexagonal turret. On the minimap, friends are circles and enemies are squares. | Accessibility requirement. |
| D16 | Assets are **100% procedural** (canvas-drawn sprites, synthesised WebAudio). The only external resource is the Rajdhani web font (SIL OFL), with system fallback. | No licensing exposure. See ASSETS.md. |

## Tuning changes from the spec

| Value | Spec | Now | Reason |
|---|---|---|---|
| Turret traverse | 150°/s | 170°/s | Barrel lag still reads, but tracking a drifting target feels less sluggish. |
| Grass top speed | 180 px/s | 190 px/s | Slippery movement spends more time below top speed. |
| Stop time | ~0.15 s | 1.05 s coasting; ~0.17 s with opposite input | Owner asked for momentum and coasting. Braking stays snappy through countersteer. |
| Track spacing/lifetime, cannon values, vision, smoke | — | unchanged | — |
