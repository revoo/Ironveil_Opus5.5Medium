# Performance plan 2: what to do after the audit pass

Written 2026-11-10 from the owner's second playtest. This is a work order for an agent to execute
task by task. Nothing in it is implemented yet. Read "Rules for the executor" before starting.

## Where we are (measured)

The owner played the `perf/audit-pass` build (perf-log session `2026-11-10T14-23-57-798Z-xh1y`,
M1 Pro, 120 Hz display, High preset, 1314×704 window, 207 seconds of *The Long Night*).

| | Before the audit pass | After (this playtest) |
|---|---|---|
| Frame rate | 55–65 fps, 14% of frames under 50 fps | **120 fps, locked to the display** |
| Render scale (dynamic resolution) | 60–90% | 100% the whole session |
| Worst frame | 257 ms, four stutters over 100 ms | 33 ms, no stutters |
| Draw calls per frame | 308–984 (mean 641) | 97–447 (mean 226) |
| Triangles per frame | 478k–982k (mean 758k) | 181k–425k (mean 272k) |
| JS time per frame | 2.5–5.1 ms (mean 3.8) | 2.1–4.7 ms (mean 3.2) |

**The game now runs at the display's limit on this machine and window.** Nothing further can make
it look faster there. What is left to gain:

1. **Headroom.** A fullscreen window on the same laptop is 2.1 times the pixels; other machines
   are slower. The perf log cannot tell us how much headroom there is, because every frame is cut
   off at 8.3 ms by the display. Task 0 builds the tool that can.
2. **Fights.** JS time follows draw calls: `cpu ≈ 1.76 ms + 0.0063 ms × draws` (fit over the
   session, r² = 0.87). A kill takes a frame from ~200 draws to ~400 for half a minute, and JS time
   from ~2.7 ms to 4–4.7 ms: more than half the 8.3 ms budget of a 120 Hz frame, before the GPU
   process does its own work per draw. 22% of the session's samples were at 300 draws or more.
3. **Hitches.** The session's one frame over 17 ms (33 ms) was the moment the first enemy came
   into view; later first sightings cost one dropped frame each.
4. **Geometry that is redrawn for nothing**: a lamp's whole shadow map when a tank moves under
   it, and bevels too small to see.

### What a frame is made of now

Exact counts from `tools/perf/counts.mjs` on commit `e0a24ca` (these are the same on any machine):

- Driving, mean of nine places: **161 draws, 299k triangles, 436k vertex-shader runs.**
- One driving frame near a lamp, by pass (`plaza`): moon shadow 10 draws / 11k triangles; one
  lamp shadow map **28 draws / 80k triangles**; the picture 124 draws / 218k triangles; post 20 draws.
- A kill at the plaza, camera fixed:

  | | draws | fire/smoke sprites | smoke billboards |
  |---|---|---|---|
  | calm | 201 | 27 | 0 |
  | 0.2 s after | 278 | 71 | 30 |
  | 1 s | 327 | 117 | 30 |
  | 2 s | **406** | 196 | 60 |
  | 4 s | 379 | 170 | 60 |
  | 8 s | 302 | 100 | 60 |

  Every sprite and billboard is its own draw call with its own material. They are half the frame.

### Hints about pixel cost (software renderer, *not* the M1)

Timed under SwiftShader at two resolutions. It shows where shader arithmetic goes; a real GPU will
weigh things differently (Task 0 measures the real thing). Per megapixel: the scene pass is ~80%,
SMAA ~7%, ambient occlusion ~7%, bloom ~4%, composite and grade ~2%. Inside the scene pass, with
features switched off one at a time: the 15 pooled lights ~50%, image-based lighting ~18%,
shadow lookups ~10%, the moon ~5%. Overdraw, mist and rain: nothing measurable.

## The plan, ranked by estimated impact

| Rank | Task | What it saves | Est. impact | Effort | Risk |
|---|---|---|---|---|---|
| — | **0. Benchmark mode** | Nothing itself: it measures headroom and per-feature cost on the real GPU | Enables every later decision | ~1.5 h | Low |
| 1 | **Instance the particles** | ~190 draws at the peak of a fight, ~100 for the half minute after; 490 fewer scene objects | Fight frames: JS 4–4.7 ms → ~3 ms (about −1.2 ms); largest measured cost left | ~2 h | Medium |
| 2 | **Lighter bevels on scenery** | A third of all triangles in every pass, every frame; geometry memory; load time | Driving triangles 299k → 200k (**measured** in a scratch copy); picture differs by 0.1/255 | ~30 min | Low |
| 3 | **Cache lamp shadow scenery** | ~20 draws and 70k–95k triangles per lamp per frame whenever a tank moves under a lamp | A quarter of a driving frame's triangles near lamps; −0.15 ms JS per lamp | ~1.5 h | Medium |
| 4 | **One matrix update per frame** | A walk over the whole scene graph for every extra `render` call in a driving frame | The moon shadow update's JS time 0.57 → 0.09 ms on the test VM (**measured** by toggling the flag); about −0.15 ms per driving frame on the M1 | ~15 min | Low |
| 5 | **Pool tank models** | The 33 ms frame at the first enemy sighting, one dropped frame at later ones | The only frame-time spikes left in the log | ~30 min | Low |
| 6 | **Pair up scenery materials** | ~15–35 draws per frame, always | ~0.1–0.2 ms JS | ~1 h | Low |
| 7 | **Load Phaser only for Skirmish** | ~1 MB of script the main mode never runs | Start-up time only | ~45 min | Low |
| — | **Stage 3 (needs owner's OK)** | Pixel cost: AO quality, image-based lighting, light pools, frame-rate target | Unknown until Task 0's numbers | — | Changes the picture |

Estimates of JS time use the measured 0.0063 ms per draw call. Estimates of GPU time are not given:
there is no measurement to base them on until Task 0 has run on the owner's machine.

Execute in this order: **0, then 5, 4, 2, 1, 3, 6, 7** (the quick, safe ones first, so that the
bigger changes are measured on a clean base). The task sections below are in that order. Stage 3
only on the owner's word.

---

## Rules for the executor

Read `CLAUDE.md` and `docs/HANDOFF.md` first. Then:

1. **Branch.** If `main` contains commit `60f4f39`, branch from `main`; otherwise from
   `perf/audit-pass`. Name it `perf/plan-2`. One commit per task. Push the branch
   (`git push -u origin perf/plan-2`). Do not merge, do not open a pull request.
2. **Only touch** `src/client/three/`, `src/client/main.ts` (Task 7), `tests/`, `tools/perf/`,
   `docs/` and `CLAUDE.md`. Never `src/sim`, `src/ai`, `src/game`, `src/level`.
3. **Verify every task** before committing. All of these must hold:
   ```bash
   npm run typecheck
   ```
   ```bash
   npm test
   ```
   ```bash
   node tools/perf/checks.mjs
   ```
   ```bash
   node tools/perf/counts.mjs
   ```
   `checks.mjs` must end with `ALL PASS`. `counts.mjs` must print `no page errors`, and its numbers
   must meet the task's "Done when". Tasks that say so also need a screenshot comparison
   (`shots.mjs` before and after, then `diff.mjs`). See `tools/perf/README.md`.
4. **The harness needs a dev server**, started detached, and takes minutes per script:
   ```bash
   setsid nohup npx vite --port 5199 --strictPort > /tmp/vite.log 2>&1 < /dev/null &
   ```
   Give the scripts a 10-minute timeout or run them in the background. **Do not edit files under
   `src/` while a script is running** (hot reload breaks the run).
5. **If a task will not meet its "Done when"** after two honest attempts: undo it
   (`git checkout -- . && git clean -fd src tests`), write down what happened for the hand-back
   note, and go on to the next task. Never loosen a check, a threshold or a test to get a pass.
6. **Do not improvise other optimisations.** "Not worth doing" at the end lists the tempting ones
   and why they are out.
7. **The picture must not change** except where a task says how. The frame's look belongs to the owner.
8. **Invariants that bite here** (all in `CLAUDE.md`): renderers read the `Observation`, never the
   `World`; the number of lights never changes at runtime (Task 0's benchmark is the one, explicit
   exception); no new `PointLight`; no model names in code or commits; see-through effects keep
   `depthWrite: false`; a new moving shadow caster needs the dynamic shadow layer, a pose check in
   `trackCasters` and a place in `view.casters`.
9. **Commits**: imperative subject, a short body saying what changed and the measured numbers,
   then the attribution lines the harness gives you.
10. **When all tasks are done**: add one row per task to `docs/DECISIONS.md` (continue from D38),
    update the status in `docs/HANDOFF.md` and `CLAUDE.md` (map of files, gotchas that changed),
    rebuild and republish the preview as `CLAUDE.md` describes, and end with a hand-back note: per
    task, done or skipped, with the before and after numbers from `counts.mjs`.

---

## Task 0. Benchmark mode

**Goal.** A key that measures, on whatever machine the game is running, (a) how frame time grows
with pixels and (b) what each feature costs, by rendering at more than screen resolution so the
display's refresh no longer hides the answer. Results go to the overlay, the console and the perf log.

**Why.** At 120 fps locked, a frame's real cost is invisible. Every pixel-side decision in Stage 3
needs these numbers.

**Files.** New `src/client/three/bench.ts`. Edit `view.ts`, `post.ts`, `telemetry.ts`, `perflog.ts`.

**Steps.**

1. `post.ts`: add benchmark switches that need no shader recompile.
   - `readonly debug = { ao: true, bloom: true, smaa: true };`
   - Two 1×1 `THREE.DataTexture`s, white `(255,255,255,255)` and black `(0,0,0,255)`, `needsUpdate = true`.
   - In `render()` on the High path: if `!debug.ao`, skip `gtao.render` and bind the white texture
     as `tAO` (high pass and composite); if `!debug.bloom`, skip `renderMips` and bind the black
     texture as `tBloom`; if `!debug.smaa`, skip `smaa.render` and let the grade pass read
     `this.ldrA.texture` instead of `ldrB`. Leave the Low path alone. Dispose both textures in `dispose()`.
2. `view.ts`:
   - Keep the mist: `private mist: Mist;` assigned where `new Mist(...)` is today (line ~187).
   - `benchDpr: number | null = null;` and in `resize()` use `const dpr = this.benchDpr ?? Math.max(...)`.
   - `private bench: Benchmark | null = null;` In `frame()`, replace the `dynRes.update` line with:
     if a benchmark is running call `this.bench.frame(frameMs)` and do not call `dynRes.update`;
     otherwise as now.
   - A `keydown` listener (add its remover to `this.listeners`): on `KeyB`, when
     `this.telemetry.visible` and no benchmark is running, start one. When it finishes it calls back
     with the result; set `this.bench = null`.
3. `bench.ts`: `export class Benchmark`, driven one frame at a time by `frame(frameMs)`. It holds a
   list of phases; each phase has `enter()`, optional `each()` (called every frame), `exit()`, a
   settle time (frames discarded) and a measure time. For each phase record the mean and the 95th
   percentile of `frameMs` over the measure time.
   - **Start:** remember `session.paused`; call `session.pause()` if it was running (a frozen world
     makes phases comparable; the view keeps drawing while paused). **End:** restore everything,
     `benchDpr = null`, `resize()`, `session.resume()` if it was running.
   - **Phase "refresh"** (settle 0.5 s, measure 1.5 s at the normal scale):
     `refreshMs` = the 10th percentile of the frame times (the display's interval when capped).
   - **Sweep** (settle 0.7 s, measure 2 s each): for each target of 4, 6 and 8 megapixels, set
     `benchDpr = Math.sqrt(target * 1e6 / (viewW * viewH))`. Skip a target if that is under 1.1 times
     the normal pixel ratio, or if `Math.max(viewW, viewH) * benchDpr > 8192`. Record
     `{ mpx, ms, p95 }` with `mpx` computed from the real drawing-buffer size.
   - **Fit:** take the sweep points (plus the refresh phase's point) whose mean is above
     `1.15 * refreshMs`. With two or more, least-squares `ms = fixedMs + msPerMpx * mpx`. With fewer,
     both are `null` (the machine is faster than its display at everything tested).
   - **Ablations** at one scale: the first sweep point whose mean was above `1.3 * refreshMs`, else
     the largest tested. Measure a reference (settle 0.7 s, 2 s). Then for each row below: `enter`,
     settle, measure 2 s, `exit`. Finally measure the reference again; `driftMs` = the absolute
     difference between the two references (the noise floor). `cost = referenceMs - phaseMs`.

     | Name | enter / exit | Settle |
     |---|---|---|
     | `ao` | `post.debug.ao = false` / `true` | 0.7 s |
     | `smaa` | `post.debug.smaa = false` / `true` | 0.7 s |
     | `bloom` | `post.debug.bloom = false` / `true` | 0.7 s |
     | `mist` | `mist.mesh.visible = false` / `true` | 0.7 s |
     | `rain` | `rain.lines.visible = false` / `true` | 0.7 s |
     | `surfaceDetail` | `procUniforms.uProcOn.value = 0` / the value it had | 0.7 s |
     | `environment` | `scene.environment = null`, then set `material.needsUpdate = true` on every material in the scene / put it back, same again | 2.5 s |
     | `shadows` | `renderer.shadowMap.enabled = false` and `needsUpdate` on every material / back | 2.5 s |
     | `pooledLights` | `visible = false` on every `SpotLight` and `PointLight` in the scene / back | 2.5 s |
     | `shadowRedraw` | `each()`: mark the moon's scenery stale (`moonShadow` needs a small public `invalidate()` that sets `key[0] = NaN`) and set `shadow.needsUpdate = true` on every shadowed spot light / nothing | 0.7 s |
     | `fight` (last) | `blasts.destroy(x, z)` and `smoke.wreck(x, z)` 60 units from the camera target / nothing | 0.3 s |

     `shadowRedraw` and `fight` come out negative: report them as extra cost
     (`phaseMs - referenceMs`). The three recompiling rows stall for a second or two: that is
     expected in a benchmark and is why they settle longer. Add a comment that this is the one place
     allowed to change the light count at runtime.
   - **Result** (plain object): `{ at, build, low, window: [w, h], baseDpr, refreshHz, sweep,
     fixedMs, msPerMpx, ablateMpx, referenceMs, driftMs, costs: { name: ms } }`, numbers rounded to
     2 decimals. `console.log('[bench]', JSON.stringify(result))`.
4. `telemetry.ts`: a `benchText: string` field appended to the panel's rows when not empty. While
   running show `BENCH <phase name> <n>/<total>`; afterwards three compact lines: the fit
   (`fixed 3.1 ms + 2.4 ms/Mpx` or `faster than the display`), the three largest costs, and the
   drift. Add `B benchmark` next to the header so the key is discoverable.
5. `perflog.ts`: `async note(key: string, value: unknown): Promise<void>` that does
   `this.db.doc('perf/' + this.sid).update({ [key]: value })` inside a try/catch, doing nothing when
   `this.db` is null. Call `perfLog.note('bench', result)` when the benchmark ends.

**Pitfalls.**
- `resize()` sets a canvas size: nothing else may call it mid-phase. Skip `dynRes.update` as said.
- Restore **everything** on finish and also in the view's `dispose()` if a benchmark is still running.
- Frame times over 250 ms (the recompiles) must be dropped from a phase's samples.
- The software renderer in the harness is far too slow to run the whole benchmark. Test the state
  machine there with short times (a constructor option, e.g. `{ settle: 0.05, measure: 0.1 }`).

**Done when.**
- Rules 3 hold; counts unchanged from the baseline (161 / 299k / 436k driving mean).
- A harness script `tools/perf/bench-smoke.mjs` (write it; ~30 lines using `open()` from `lib.mjs`)
  starts a benchmark with short times, steps frames until it finishes, and prints the result
  object. It then checks that everything was put back, comparing with values read before the
  start: `renderer.getPixelRatio()`, `view.benchDpr === null`, the three `post.debug` flags true,
  `scene.environment` not null, `renderer.shadowMap.enabled`, every light `visible`, the mist and
  rain visible, `procUniforms.uProcOn.value`, `session.paused`; and that there were no page
  errors. Add the same as a PASS/FAIL line in `checks.mjs`.
- The overlay says, while running, that the benchmark includes a test explosion (the `fight`
  phase leaves a harmless fire burning near the player for half a minute).
- Docs: a "Benchmark" section in `docs/HANDOFF.md`: press `V`, then `B`, wait about a minute,
  keep the window as you normally play; where the result goes; how to read it.

**Then publish the preview and tell the owner** the benchmark exists. They can run it now (a
"before" for the tasks below) or later. Do not wait for them: continue with Task 5.

---

## Task 5. Pool tank models

**Goal.** No tank is built during play.

**Why.** `tankVis()` in `view.ts` builds a tank's meshes, materials and buffers the first time that
tank comes into view. The session's worst frame (33 ms at t = 12 s) is the first enemy sighting.
`prewarmShaders()` already builds one tank per team to warm the shaders, then never uses them.

**Files.** `src/client/three/view.ts` only.

**Steps.**
1. Move the body of `tankVis()` that creates a `TankVis` (beam material, glow sprite, charge ring,
   `buildTank`, the object literal) into `private makeTankVis(team: 0 | 1): TankVis`. It must leave
   `model.root.visible = false`.
2. Add `private spare: TankVis[] = [];`. In the constructor, **before** `this.prewarmShaders()`,
   fill it: one of team 0 and four of team 1.
3. `tankVis(t)`: if the tank has no entry, take the first spare whose `team === t.team`
   (remove it from `spare`); if none, call `makeTankVis(t.team)` as today.
4. Delete the loop at the top of `prewarmShaders()` that builds two throw-away tanks: the spares
   are hidden objects in the scene, so the warm-up frame already shows and draws them.

**Pitfalls.** Do not size the pool from the mission's enemy list or the `World` (that would leak
hidden state into the renderer). A wreck keeps its `TankVis`; never return one to the pool.

**Done when.** Rules 3 hold; counts unchanged. Add this check to `checks.mjs`: read
`view.renderer.info.memory.geometries` right after `open()`, again after
`__settle(144, 432, 4); __settle(600, 432, 4)` (driving, no enemy in view), and again after
`__settle(2544, 500, 6)` (three enemies in view). All three numbers must be equal. Today they are
1047, 1073 and 1099: 13 geometries arrive with each tank that is built during play, the player's
own included.

---

## Task 4. One matrix update per frame

**Goal.** The scene graph's world matrices are computed once per frame, not once per `render` call.

**Why.** `moonshadow.ts` calls `renderer.render(scene, …)` up to twice before the picture is
drawn, and every such call first walks all ~1,850 objects to update matrices. Measured on the test
VM by switching the flag by hand: `moonShadow.update` takes 0.57 ms with the walk and 0.09 ms
without. `tools/perf/cpu.mjs` prints it as `moonShadow` (0.70–0.76 ms per driving frame today).

**Files.** `src/client/three/view.ts` only.

**Steps.** In `frame()`, immediately before `this.moonShadow.update(...)`:
```ts
this.scene.updateMatrixWorld();
this.scene.matrixWorldAutoUpdate = false;
```
and immediately after `this.post.render(...)`: `this.scene.matrixWorldAutoUpdate = true;`.
Do the same around the two `moonShadow.update` calls and the `post.render` in `prewarmShaders()`.

**Pitfalls.** Nothing may move an object between the manual update and the last render of the
frame. Today nothing does (the HUD and audio run after `post.render`). Task 3 adds lamp shadow
drawing: it must sit inside this bracket.

**Done when.** Rules 3 hold; counts unchanged; `node tools/perf/shots.mjs before` (taken before
the change) and `after` differ by `mean 0` on all six shots; `node tools/perf/cpu.mjs` shows
`moonShadow` **at or under 0.25** at both places (was 0.70 and 0.76; run it twice, before and
after, on the same machine).

---

## Task 2. Lighter bevels on scenery

**Goal.** Scenery boxes use one bevel segment instead of two: 108 triangles instead of 300.

**Why.** Bevels on buildings and wall slabs are 1.5–2 world units wide: three to six pixels at the
closest zoom. Two segments of rounding cannot be told from one at that size, and these boxes are
most of the city's ~1M triangles, drawn in the picture and in every shadow layer. This change was
tried in a scratch copy while writing this plan: driving mean 299k → 200k triangles and
436k → 374k vertex runs, and the six shots differed from the originals by a mean of 0.09–0.12 out
of 255 (0.02–0.06% of pixels off by more than 8). A side-by-side of a lit wall showed no visible difference.

**Files.** `src/client/three/models.ts`, `src/client/three/world.ts`.

**Steps.** `roundedBox(w, h, d, segments, radius)`: change the fourth argument from `2` to `1` at
exactly these calls and no others:
- `models.ts`: the wall `slab` and `foot` in `wallRun`; the `body`, `roof` and rooftop `ac` units in
  `building`; the lamp `head` in `lamp`; the `body` in `railcar`.
- `world.ts`: the default prop box (`m.crate`).

Leave every `roundedBox` inside `buildTank` alone (tanks are seen close and lit by their own
headlights), and leave the calls that already pass `1`.

**Done when.**
- Rules 3 hold. `counts.mjs` driving mean **≤ 205k triangles** (was 299k), draws unchanged.
- `shots.mjs` before/after: all six `mean ≤ 0.3`.
- Make two side-by-side crops for the owner and name their paths in the hand-back note:
  ```bash
  node tools/perf/crop.mjs border 560 160 400 340 2 before after
  ```
  ```bash
  node tools/perf/crop.mjs plaza 380 240 520 340 2 before after
  ```
  Commit this task on its own so it can be reverted alone.

---

## Task 1. Instance the particles

**Goal.** Fire, smoke and smoke-screen billboards are three draw calls in total, not one per particle.

**Why.** See the kill table above: 196 sprites and 60 billboards at the peak, each a `THREE.Sprite`
or `THREE.Mesh` with its own material, and 490 pooled objects walked by three.js every frame even
when nothing burns.

**Files.** New `src/client/three/billboards.ts`. Edit `blast.ts` (fire and smoke sprites),
`fx.ts` (`SmokeFx` puffs), `view.ts` (pass the camera to `blasts.update`).

**Design.** One class draws any number of camera-facing quads with a single `THREE.InstancedMesh`:

```ts
export class Billboards {
  readonly mesh: THREE.InstancedMesh;
  /** `sorted`: draw far to near (needed for normal blending; additive blending does not care). */
  constructor(scene: THREE.Scene, o: { max: number; material: THREE.MeshBasicMaterial | THREE.MeshLambertMaterial; renderOrder: number; sorted: boolean });
  begin(camera: THREE.Camera): void;   // start a frame's list
  add(x: number, y: number, z: number, size: number, rotation: number, r: number, g: number, b: number, alpha: number): void;
  end(): void;                         // write the instance buffers; hide the mesh if the list is empty
}
```

- Geometry: `new THREE.PlaneGeometry(1, 1)` with one extra `THREE.InstancedBufferAttribute`
  named `aAlpha` (`Float32Array(max)`, item size 1, `setUsage(THREE.DynamicDrawUsage)`).
- Mesh: `new THREE.InstancedMesh(geometry, material, max)`; `frustumCulled = false`;
  `instanceMatrix.setUsage(THREE.DynamicDrawUsage)`; call `mesh.setColorAt(0, new THREE.Color())`
  **in the constructor** so the per-instance colour attribute exists before the shader is first
  compiled (`blast.ts` does the same for the debris); `count = 0`; `visible = false`.
- Per-instance alpha: three.js has per-instance colour but not opacity. Patch the material once:
  ```ts
  material.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aAlpha;\nvarying float vAlpha;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = aAlpha;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAlpha;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vAlpha;');
  };
  material.customProgramCacheKey = () => 'billboards';
  ```
- `begin(camera)`: reset the count; copy `camera.quaternion`; store the camera's world direction
  (`camera.getWorldDirection(v)`).
- `add(...)`: append the nine numbers to a scratch `Float32Array(max * 9)`; ignore calls past `max`.
- `end()`: if `sorted`, sort an index array by depth `x*dx + y*dy + z*dz`, largest first (far to
  near). For each particle in order: quaternion = camera quaternion × a rotation of `rotation`
  about Z (`q.copy(camQ).multiply(qz.setFromAxisAngle(Z, rotation))`), matrix =
  `compose(position, q, (size, size, 1))`, `setMatrixAt(i, m)`, `setColorAt(i, colour.setRGB(r, g, b))`,
  `aAlpha[i] = alpha`. Then `count = n`, `visible = n > 0`, and `needsUpdate = true` on
  `instanceMatrix`, `instanceColor` and the `aAlpha` attribute, **only when `n > 0` or the previous
  frame's count was above 0**.

**Steps.**
1. Write `billboards.ts` as above.
2. `blast.ts`:
   - Replace the `fireSprites` and `smokeSprites` arrays and their construction loops with two
     `Billboards`. Fire: `new THREE.MeshBasicMaterial({ map: fireTex, color: 0xffffff, blending:
     THREE.AdditiveBlending, depthWrite: false, transparent: true })`, `renderOrder: 5`,
     `sorted: false`, `max: maxFire`. Smoke: `new THREE.MeshBasicMaterial({ map: smokeTex,
     color: 0xffffff, depthWrite: false, transparent: true })`, `renderOrder: 4`, `sorted: true`,
     `max: maxSmoke`. These are the sprite materials' settings; keep them exactly.
   - `update(dt)` becomes `update(dt, camera)`. `drawParticles(list, sprites, dt)` becomes
     `drawParticles(list, billboards, dt)`: call `billboards.begin(camera)` before the loop and
     `end()` after it. Where it set a sprite's position, scale, `material.rotation`, colour and
     opacity, call `add(p.x, p.y, p.z, size, p.rot, r, g, b, alpha)` with the same values. Smoke's
     colour was the material's fixed `0x2b2a28`: compute `new THREE.Color(0x2b2a28)` once and pass
     its `r, g, b`. Fire's colour is the HDR triple the code already computes.
   - Keep every number in the particle maths as it is. Keep the order of `Math.random()` calls.
3. `fx.ts`, `SmokeFx`: replace the 240 `puffs` meshes with one `Billboards`:
   `new THREE.MeshLambertMaterial({ color: 0xffffff, alphaMap: puffTex, transparent: true,
   depthWrite: false })`, `renderOrder: 3`, `sorted: true`, `max: max * SmokeFx.PER`. In
   `update()`, `begin(cam)` first, `end()` last; inside `draw`, where it positioned a puff mesh,
   call `add(...)` with the same position, `size` = the value it passed to `scale.setScalar`,
   `rotation` = the angle it passed to `rotateZ`, colour = `new THREE.Color(0x3a3a38)` when
   `c.dark` else `new THREE.Color(0xa3a8a4)` (make both once), `alpha` = the opacity it set.
   Delete the `used` bookkeeping. Keep the order of `rnd()` calls exactly (the puff layout depends on it).
4. `view.ts`: `this.blasts.update(dt, this.camera)`.

**Pitfalls.**
- The lit smoke (`MeshLambertMaterial`) must stay lit: that is why the class takes a material
  rather than building its own shader.
- Do not give these meshes `castShadow` or put them on a shadow layer.
- `prewarmShaders()` already sets `count = 1` on empty instanced meshes for its warm-up frame and
  shows hidden objects: no change needed, but check that the first kill in `checks.mjs` raises no error.
- The harness's kill table counts visible `Sprite`s and Lambert meshes: afterwards the sprite
  column stays near its calm value and the billboard column reads 0 or 1.

**Done when.**
- Rules 3 hold. Driving mean unchanged (161 draws, within ±3).
- Kill table: draws at "2 s" **≤ 240** (was 406) and at "8 s" **≤ 235** (was 302); scene objects
  **≤ 1,450** (was 1,846).
- `shots.mjs` before/after: the five place shots `mean ≤ 0.05`; `fight.png` `mean ≤ 1.5` (sorting
  within a cloud may differ slightly). Open both `fight.png` files and compare them by eye: the
  fireball, smoke and sparks must be the same size, colour and place.

---

## Task 3. Cache lamp shadow scenery

**Goal.** When a tank moves under a lamp, that lamp's shadow map is refreshed with one full-map
copy and the tank's three stand-in draws, not by redrawing the scenery (28 draws / 80k triangles today).

**Why.** It is the second-largest block of a driving frame near a lamp (see the pass breakdown),
and fights happen under lamps.

**How.** Exactly what `src/client/three/moonshadow.ts` does for the moon, without its scissor
patch and without its stepped frustum. **Read that file first; it is the worked example.** Per
shadowed lamp slot: a depth target holding the scenery layer for the lamp the slot is on, redrawn
only when the slot moves to another lamp or the map changes size.

**Files.** New `src/client/three/lampshadow.ts`; edit `lamps.ts`, `view.ts`, `moonshadow.ts`
(exports only).

**Steps.**
1. `moonshadow.ts`: export, without changing behaviour, (a) a function that builds the
   depth-copy quad for a given depth texture (the `FullScreenQuad` with the `gl_FragDepth` shader)
   and (b) the depth-only back-side material settings. Use them from `MoonShadow` itself.
2. `lampshadow.ts`: `export class LampShadow` for one `THREE.SpotLight`:
   - fields: `scenery: WebGLRenderTarget` (colour format `THREE.RedFormat` to keep it small, a
     `THREE.DepthTexture` with nearest filtering), the copy quad, `stale = true`,
     `map: WebGLRenderTarget | null = null`.
   - `invalidate()`: `stale = true`.
   - `draw(renderer, scene, depthOnly, moved: boolean)`:
     1. `const map = light.shadow.map`; if null: `light.shadow.needsUpdate = true; this.map = null;
        return;` (three.js draws it whole this frame and creates it).
     2. if `map !== this.map` or its size changed: `stale = true; this.map = map`.
     3. if `!stale && !moved` return.
     4. `light.updateMatrixWorld(); light.target.updateMatrixWorld(); light.shadow.updateMatrices(light);`
     5. Save and afterwards restore: `camera.layers.mask`, `renderer.autoClear`,
        `renderer.getRenderTarget()`, `scene.background`, `scene.overrideMaterial`.
        Set `scene.overrideMaterial = depthOnly; scene.background = null;`.
     6. if `stale`: resize `scenery` to the map size if needed; `camera.layers.set(SHADOW_LAYER)`;
        `autoClear = true`; render the scene into `scenery`; `stale = false`.
     7. `autoClear = false`; `setRenderTarget(map)`; render the copy quad;
        `camera.layers.set(SHADOW_DYNAMIC_LAYER)`; render the scene.
3. `lamps.ts`:
   - Each shadowed slot gets a `LampShadow`. In `assign()`, where a slot moves to another lamp,
     call `slot.shadow.invalidate()` **instead of** `s.light.shadow.needsUpdate = true`.
   - In `update()`, stop setting `l.shadow.needsUpdate` for busy lamps; store `slot.busyNow =
     busy || s.wasBusy` instead (keep the `wasBusy` logic as it is).
   - New `drawShadows(renderer, scene, depthOnly)`: for each shadowed slot with a lamp,
     `slot.shadow.draw(renderer, scene, depthOnly, slot.busyNow)`.
   - New `invalidate()`: invalidate every slot (the harness calls it if it exists).
   - `setLow()` keeps disposing the map and nulling it; step 2.1 then handles the rest.
4. `view.ts`: call `this.lampLights.drawShadows(...)` right after `this.moonShadow.update(...)`
   in `frame()` (inside Task 4's matrix bracket), and once after the first `post.render` in
   `prewarmShaders()`.

**Pitfalls (each of these cost time when the moon's version was written).**
- A colour `scene.background` clears the target on every `render`, even with `autoClear` off:
  that wipes the copied depth. Set it to `null` for these passes.
- The shadow map must hold **back faces**: the depth-only material is `side: THREE.BackSide`.
- After the first frame these lights' `shadow.needsUpdate` must stay `false`, or three.js redraws
  the whole map itself and the work is done twice.
- Restore the camera's layer mask: three.js still uses that camera when it creates the map.
- `updateMatrices` needs the light's and its target's world matrices to be current (step 4).

**Done when.**
- Rules 3 hold. `checks.mjs`'s three "shadows … equal a full redraw" lines PASS: they compare
  your cached result against three.js redrawing every lamp map from scratch.
- `counts.mjs` driving, compared with the run just before this task: `plaza`, `river` and
  `border` each **at least 15 draws and 35k triangles lower**; no place higher.
- `shots.mjs` before/after: all six `mean ≤ 0.05`.

---

## Task 6. Pair up scenery materials

**Goal.** Materials that differ only in colour share one material and take the colour from the
vertices: `building`/`building2`, `barrel`/`barrel2`, `stripe`/`stripeRed`, `bush`/`bush2`.

**Why.** Static scenery is one draw per material per map tile. Four fewer materials is 15–35 fewer
draws in every frame.

**Files.** `src/client/three/models.ts`, `src/client/three/world.ts`.

**Steps.**
1. A helper `tint(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry` that adds a `color`
   attribute (3 floats per vertex, `new THREE.Color(hex)`'s `r, g, b`, which are already linear).
2. In `makeMaterials()`: each pair becomes one material with `color: 0xffffff` and
   `vertexColors: true` (keep every other parameter and the `proc(...)` call of the first of the
   pair; the two of each pair already have identical parameters apart from colour: check, and stop
   if they do not). Keep the old colours as exported constants.
3. Every geometry given one of these materials must be tinted with the colour it used to have.
   That includes every use of `building`, `barrel`, `stripe` and `bush` themselves.
4. `mergeStatic` deletes every attribute except `position`, `normal`, `uv`: add `'color'` to that
   list **only for meshes whose material has `vertexColors`**; `mergeGeometries` needs all pieces
   merged together to have the same attributes. `ShadowProxies` copies positions only: no change.

**Done when.** Rules 3 hold; `shots.mjs` before/after all six `mean ≤ 0.05`; `counts.mjs` driving
mean draws at least 12 lower than in the run just before this task.

---

## Task 7. Load Phaser only for Skirmish

**Goal.** The first page load does not download, parse or start Phaser; opening Skirmish does.

**Why.** The bundle is one 2.3 MB chunk with two engines; the main mode never runs Phaser.

**Files.** `src/client/main.ts` and whatever it imports for the 2D mode.

**Steps.** Read `main.ts` fully first. Move everything that needs Phaser (the `Phaser.Game`
instance, `GameScene`, the 2D HUD scene) behind one `async function loadSkirmish()` that uses
`await import(...)` and caches its result. `startMatch()` awaits it. Every other use of `game`
(`game.scene.stop(...)` in `startMission`, the `__ironveil.game` debug hook, pause handling)
must cope with it not being loaded yet (`game?.`). Show the existing menu while it loads.

**Done when.** Rules 3 hold; `npm run build` prints two JS chunks, the entry one under 1.4 MB;
a harness script starts a mission without the Phaser chunk being requested (listen to
`page.on('request')`), and a second one opens Skirmish (`#deploy` inside the `details.skirmish`
block) and sees a canvas inside `#game` with no page error. Update "Preview builds" in `CLAUDE.md`:
the artifact now needs **both** JS files in `files`.

---

## Stage 3: only on the owner's word

These change the picture or how the game paces itself, so they need the owner's decision and, for
the first three, Task 0's numbers from the owner's machine. Bring the benchmark result back
(perf log field `bench`, or the `[bench]` console line) and decide together.

| Candidate | Do it if the benchmark shows | What changes for the eye |
|---|---|---|
| Ambient occlusion at 8 samples (from 12), denoise at 6 (from 8) | `costs.ao` above 12% of `referenceMs` | Slightly noisier occlusion in corners |
| Image-based lighting only on the ground, tanks and metal (walls, roofs and concrete lit by the hemisphere light alone, retuned to match) | `costs.environment` above 10% | Ambient tone on walls shifts a little; needs a side-by-side |
| Smaller light pools on Low (4 lamps, 2 headlights, 2 effect lights), fixed at mission start | `costs.pooledLights` above 20% | On Low, fewer lamps light the ground at once |
| A frame-rate target setting: "Display" (lower the resolution to hold the display's refresh) or "60" | `fixedMs + msPerMpx × fullscreen megapixels` above `1000 / refreshHz` | Today dynamic resolution only reacts below 50 fps, so a 120 Hz display that cannot hold 120 runs unevenly between 60 and 120 |
| A Medium preset (High's lighting, FXAA instead of SMAA, the lighter AO) | The owner wants one | A step between Low and High |

## Not worth doing (measured or reasoned; do not start these)

- **A depth pre-pass.** Drawing the scene over its own finished depth buffer cost the same as
  drawing it fresh: there is no overdraw worth removing (and Apple GPUs remove it themselves).
- **Mist and rain.** After the audit pass both are below what can be measured.
- **Baking wall and tank surface detail into textures.** The noise is 13–16 texture fetches now;
  the remaining gain does not pay for the work or the look risk.
- **Replacing SMAA or bloom outright.** ~7% and ~4% of pixel cost in the software proxy; a
  decision for Stage 3 with real numbers, not a default.
- **A WebGPU port.** Days of work, every custom shader rewritten, and nothing measured asks for it.
- **Per-pass GPU timer queries.** Task 0 answers the same questions without depending on a
  browser extension that is often switched off.
