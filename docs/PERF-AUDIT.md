# Performance audit of the 3D mission view

November 2026, branch `perf/audit-pass`. An audit of how `src/client/three/` spends a frame, what
was changed as a result, and what is left as suggestions. Decisions are logged as D34–D37 in
[DECISIONS.md](DECISIONS.md).

**Result (added after the owner's playtest, 2026-11-10):** on the M1 Pro, High, 1314×704 window,
the game went from 55–65 fps at 60–90% render scale to **120 fps locked at 100%**, with no frame
over 33 ms in 207 seconds. The forecast below (60 fps at full scale) was too cautious. What to do
next is in [PERF-PLAN.md](PERF-PLAN.md).

**Read this first:** nothing here was measured on a real GPU. The cloud session renders on the CPU
(SwiftShader), which says little about an M1. So the audit counts things that are exact on any
machine (draw calls, triangles, vertices, passes, arithmetic per pixel) and checks the picture by
screenshot diff. The frame-rate effect on the owner's M1 Pro is an estimate until the next playtest
perf log is read (see "What to check in the next playtest").

## Where the frame went

Baseline is `main` at `3119d06`, *The Long Night*, High, 1314×704 window. The owner's perf log put a
frame at about 8 ms fixed plus 5.4 ms per million pixels: both halves matter.

### The fixed part: geometry and draw calls

Measured over six frames of driving at each of nine places along the mission:

| Per frame, driving | Before | After |
|---|---|---|
| Draw calls | 415–939 (mean 651) | 119–196 (mean 161) |
| Triangles | 653k–945k (mean 783k) | 203k–347k (mean 299k) |
| Vertex-shader runs | 1.9M–2.8M (mean 2.29M) | 0.27M–0.53M (mean 0.44M) |

What the baseline's vertices were spent on:

1. **The scene was drawn twice for the picture.** Ambient occlusion re-rendered every visible mesh
   into its own depth-and-normal buffer: as many vertices as the picture itself, every frame, even
   standing still.
2. **The moon's shadow map was redrawn on every frame of driving.** It was cached, but the
   player's own tank casts a shadow, so moving invalidated it: 540k–900k vertices a frame.
3. **A lamp's shadow map redrew 280k–480k vertices** for a pool of light 460 units wide, because
   scenery is merged in 768-unit tiles per material and a shadow pass had to take whole tiles.
   And it redrew every frame a tank was *near* the lamp, moving or not: a guard at its post kept
   its lamp's shadow map redrawing forever.
4. **Each tank was about 38 draw calls** (hull, 10 wheels, tracks, fittings, barrel sections), in
   the picture and again in every shadow map it stood in. Three tanks under a lamp were ~440 of the
   frame's ~850 draw calls.
5. **All merged scenery was a triangle soup.** three.js's `RoundedBoxGeometry`, which is nearly all
   of the city, has three vertices per triangle (900 for 300 triangles), and the static merge
   un-indexed everything else too. The vertex shader ran three times per triangle.

### The per-pixel part

6. **Every lit pixel ran the full surface shading for all 16 lights** (moon, 8 lamp spots, 4
   headlight spots, 3 effect lights), in reach or not. three.js computes whether a light reaches the
   pixel and then shades regardless.
7. **Procedural noise by arithmetic.** A concrete pixel hashed 104 lattice corners (13 value-noise
   evaluations of 8 corners each); a ground pixel about 108; the mist, which covers the whole
   screen, 32 more and then summed a Gaussian for each of the map's 14 lamps.
8. **Nine full-resolution passes on High**, all in half-float buffers: scene, AO copy, AO blend,
   bloom blend, tone map, three for SMAA, grade. Low ran four.

### The CPU side

9. **Reading `clientWidth` every frame** (camera and marker projection) forced a synchronous layout
   after the HUD's style writes: about 1 ms a frame on the cloud VM, the largest single JS cost
   outside three.js.
10. **Enemy markers were rebuilt as HTML every frame** an enemy was on screen (their position is in
    the markup, so the string always differed): ~0.8 ms, and it restarted their CSS animations every
    frame, so the low-health pulse on the bar never actually played.
11. Small steady costs: 1,600 short arrays allocated per frame by the rain, the spark pool walked
    and uploaded every frame with no sparks alive, up to 1,200 track-decal matrices rebuilt per
    frame (the simulation only changes them 30 times a second), the minimap redrawn per frame with
    four new raycasters, debris instance buffers uploaded while empty, and matrices recomposed for
    ~500 hidden pooled sprites.

## What was changed

All of it keeps the look. Geometry and pipeline changes were checked by screenshot diff against the
baseline at six places (a deterministic harness: baseline against itself differs by exactly 0).

| # | Change | Where | Picture |
|---|---|---|---|
| 1 | AO reads the scene's own depth texture; normals rebuilt from depth. No second scene render. | `post.ts` | Mean difference 0.5/255, thin lines at a few silhouettes |
| 2 | Post chain rebuilt: scene, one composite (AO × scene + bloom, tone map, sRGB) into an 8-bit buffer, SMAA, grade. High 9 → 6 full-resolution passes, Low 4 → 2. | `post.ts` | Same maths in the same order; included in the 0.5 above |
| 3 | Scenery's shadows come from stand-in meshes: positions only, one mesh per 256-unit tile whatever the material, on a layer only shadow cameras see. Visible scenery casts nothing itself. | `ShadowProxies` in `models.ts` | Identical |
| 4 | Moon shadow in two layers: scenery cached in its own depth target (frustum moves in 128-texel steps), copied into the shadow map for the patch around moving casters, tanks drawn on top. | `moonshadow.ts` | Shadow edges shift by under a texel (texels are 6.7% larger) |
| 5 | Lamp and moon shadows redraw only for casters that actually moved (or appeared, vanished, are settling wrecks). | `trackCasters` in `view.ts` | Identical |
| 6 | Each tank is three rigid parts merged per material (10 draws, was ~38) plus three shadow stand-ins. Wheels no longer rotate (they are uniform cylinders: it could not be seen). | `Parts`, `buildTank` | Identical |
| 7 | Rounded boxes welded back to shared vertices (216 instead of 900); static merge keeps indices. | `geometry.ts` | Identical (tested corner for corner) |
| 8 | Lights that don't reach a pixel skip the BRDF (a patch to one three.js shader chunk, guarded by a test). | `materials.ts` | Identical |
| 9 | Value noise from a 256² lattice texture: one filtered fetch per octave instead of 4 or 8 hashes. Slow-varying fields (puddles, worn ground, mist) read a pre-summed tiling fbm texture: one fetch for four octaves. | `materials.ts`, `world.ts`, `fx.ts` | **Same kind of noise, different random field:** puddles, grime and mist patches sit in different places |
| 10 | Mist: lamp glow baked into a small texture instead of a 14-lamp loop per pixel. | `fx.ts` | Same formula |
| 11 | HUD: element lookups cached, view size cached, enemy markers kept per enemy and updated in place, minimap redrawn per simulation tick. | `hud.ts`, `view.ts` | Markers' CSS animations now play as written |
| 12 | Effects: no per-frame allocations in rain and sparks, idle pools skip their work and uploads, track decals rebuilt per tick, pooled sprites only get matrices while alive. | `fx.ts`, `blast.ts` | Identical |

Per pixel, after: a concrete pixel makes 13 texture fetches where it hashed 104 corners; a ground
pixel 16 instead of ~108; a mist pixel 3 fetches instead of 32 hashes and 14 exponentials; and a
pixel shades the moon plus whichever of the 15 pooled lights reach it (usually none to three)
instead of all 16.

Other measurements:

- Geometry held by the scene: 96 MB → 72 MB, including the new shadow stand-ins.
- Building the world (JS only, cloud VM): 3.4 s → 2.2 s.
- JS per frame on the cloud VM at the busiest spot: HUD 0.95 → 0.11 ms, forced layout ~1 ms → 0,
  rain 0.22 → 0.05 ms. three.js's own submit time falls with the draw calls but could not be timed
  cleanly here (the software renderer back-pressures the main thread).
- Tests: 227 passing (7 new: the shader patch and the welded box). Build clean.

### Estimate for the M1 Pro

Unmeasured, so treat it as a forecast: the fixed ~8 ms should lose 2–4 ms (a quarter of the draw
calls, 40% of the triangles, a fifth of the vertex work, one scene render fewer), and the
5.4 ms per million pixels should fall by roughly a third (lighting and noise are the bulk of scene
shading; three trivial passes are a small part). If that holds, High stays at 100% render scale at
60 fps where it needed 70–80% before. 120 fps is not in reach on this renderer.

## What to check in the next playtest

1. Press `V`. Draws should read about 120–200 while driving in the city (it was 500–980), and
   `dyn` should sit at or near 100%.
2. Look for anything wrong in: shadows of buildings and of your own tank while driving and after a
   kill (flying turret, debris); the ground near puddles; mist around lamps; ambient occlusion in
   corners; the Low preset; switching presets in Settings mid-mission.
3. Play a few minutes so the perf log records a session. Next session: read it as described in
   [HANDOFF.md](HANDOFF.md) and compare the frame time against render scale with the first session
   (8 ms + 5.4 ms/Mpx).

Two places where the M1 could differ from what was verified here:

- **Filter precision.** Noise now leans on the GPU's bilinear filter. The slow fields were moved to
  a pre-summed texture precisely so no lattice cell is magnified far, but if puddle edges or mist
  ever look stepped on some GPU, that is the cause; the fix is a four-tap manual interpolation in
  `vnoise2`.
- **The moon shadow copy** writes depth from a shader (`gl_FragDepth`). Standard WebGL2, and
  verified here pixel for pixel against a full redraw after driving and after a kill, but it is the
  newest piece of GPU code in the build.

## Suggestions not done

Ranked by expected value for the effort. Estimates are agent time; the slow part is always the
owner's playtest round trip.

| # | Suggestion | Why | Effort |
|---|---|---|---|
| 1 | **Per-pass GPU timers in the `V` overlay** (shadows, scene, AO, bloom, SMAA, grade), written to the perf log. | Every per-pixel estimate in this document is arithmetic, not measurement. With timers, the next decision (AO quality? SMAA? resolution?) rests on the M1's own numbers. | ~45 min |
| 2 | **Instance the explosion and smoke particles.** 250 blast sprites and 240 smoke billboards are separate objects with a material each: a fight adds up to ~500 draw calls and sorts every one. One instanced draw per kind, with per-instance colour, size and rotation. | The first fight is where stutters were logged; this is the remaining draw-call spike. | ~1.5 h |
| 3 | **Fewer materials on scenery.** Six graffiti wall textures as one atlas; pairs that differ only in colour (two building tones, two barrels, two stripes, two bushes) as one material with vertex colours. | The picture's ~100–130 scenery draws would roughly halve. Modest: draw calls are no longer the main cost. | ~1–1.5 h |
| 4 | **Two-layer cache for lamp shadows too** (as the moon has). | A tank driving under a lamp still redraws ~25 draws / 70k triangles into that lamp's map. Costs 6 × 4 MB of depth. | ~45 min |
| 5 | **Lighter bevels on big buildings.** A building body is 300 triangles, most of them bevel strips under a pixel wide. One bevel segment instead of two is 108. | About half the scenery triangles in the picture and the moon's scenery layer. Needs an eye on the edge highlights. | ~30 min + a look |
| 6 | **A Medium preset**: High's lighting with FXAA instead of SMAA (three passes fewer) and AO at 8 samples. | For machines between the two presets; depends on what #1 shows. | ~45 min |
| 7 | **Load Phaser only for Skirmish.** The bundle is 2.3 MB with both engines in one chunk. | Faster first load of the main mode; nothing at runtime. | ~30 min |
| 8 | **Pre-render radio voices.** The speech synth builds oscillator, filter and gain nodes per syllable (~0.3 ms a frame while a line plays). | Small; only if speech lines up with logged stutters. | ~1 h |
| 9 | Bake wall and tank surface detail into textures; WebGPU port. | Listed in HANDOFF already. After #9 above the first is worth much less than it was; the second is days and not justified by anything measured. | hours / days |

Checked and left alone: the simulation (0.2–0.5 ms a frame), the lamp light pool, dynamic
resolution, bloom (already half resolution), the 2D Skirmish client.

## Reproducing the measurements

Playwright with SwiftShader, as HANDOFF describes. What made the comparisons exact:

- Stub `requestAnimationFrame`, then step `view.frame(t)` by hand with fixed timestamps.
- Seed `Math.random` and re-seed before every stepped frame; fix `Date.now` (the mission seed).
- three.js draws object UUIDs from `Math.random`, so two builds that create different numbers of
  objects deal the rain differently: re-deal `view.rain.drops` from a private generator.
- Count draws and triangles from `renderer.info` (the telemetry overlay turns off its auto-reset);
  count vertex-shader runs by wrapping `renderer.renderBufferDirect`.
- Serve the baseline from a `git worktree` on a second port and run the same script against both.
