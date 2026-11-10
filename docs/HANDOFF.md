# Handoff

For the next agent session picking up Ironveil. Read `CLAUDE.md` first (commands, map of the code,
invariants, gotchas), then this page. Last updated: 2026-11-10.

## Where things stand

`main` holds everything, including the performance audit and second optimisation pass (D34–D37,
[PERF-AUDIT.md](PERF-AUDIT.md)), merged by fast-forward after the owner's playtest (120 fps locked on
the M1 Pro, see below). Branch `perf/audit-pass` is kept as a souvenir. The preview artifact runs it.

**Next work is written up as a work order: [PERF-PLAN.md](PERF-PLAN.md).** It is meant to be
executed task by task, with the harness in `tools/perf/` proving each step.

The most recent work on `main`, all merged by fast-forward:

| Branch (kept as a souvenir) | What it added | Decisions |
|---|---|---|
| `feat/comms-panel` | Crew radio as a central comms panel with linocut portraits; synthesised "voices" (gibberish speech whose subtitle reveal, mouth and level meter follow one plan) | D28 |
| `feat/vostrava-theme` | Fictional setting: us Vostrava (Slavic, Soviet-leaning), them the Directorate of Graustein (Germanic, bureaucratic). Slavic/Germanic voice accents | D29, `docs/SETTING.md` |
| `feat/setting-depth` | Directorate posters/signs and Vostravan graffiti, a low male choir in the score, Slavic crew names, mission lines rewritten for the setting | — |
| `perf/render-budget` | The performance pass below, plus the playtest perf log | D30–D33 |

Tests: 227 passing on `perf/audit-pass` (220 on `main`). `npm run build` is clean.

## Performance: what was done and what's left

The owner plays on an **M1 Pro, 120 Hz display, in the Claude desktop app**, High preset.
Before the pass: 15–25 fps even on Low.

Done:

- **Scenery is merged per material and per 768-unit tile** so it can be culled. Before this, each of 7 shadow passes redrew the whole 1M-triangle city every frame: 56M vertices/frame on High, now about 2.8M.
- **Lamp lights** are a pool of 8 spotlights (6 shadowed), and their shadow maps are cached (`lamps.ts`).
- **Moon shadow is cached** (`cacheMoonShadow` in `view.ts`).
- **Effect lights** are a shared pool of 3 (`GlowLights` in `fx.ts`).
- **Procedural bump mapping** uses screen-space derivatives, one noise sample instead of four.
- **GTAO** (ambient occlusion) runs at half resolution.
- **Presets:** High caps the pixel ratio at 1.5. Low renders at 1×, turns off surface detail and halves shadow maps.
- **Dynamic resolution** (`dynres.ts`) steps on the share of frames over 20 ms per second.
- **Loading draws one real warm-up frame** so Metal pipelines and textures are created before play (`prewarmShaders` in `view.ts`).

Measured on the owner's machine (first perf-log session, before the dynamic resolution and warm-up fixes):

- **Frame time:** about 8 ms fixed plus 5.4 ms per million pixels.
- **By render scale:**

  | Scale | fps | Frames over 20 ms |
  |---|---|---|
  | 0.9 | 58 | 19% |
  | 0.8 | 64 | 11% |
  | 0.7 | 75 | 4.5% |

- **CPU** is only 2.5–5 ms per frame; the game is GPU-bound.
- **Stutters:** 117–125 ms around the first fight, and 257 ms at load.

Not yet verified by the owner: the slow-frame dynamic resolution, and whether the warm-up frame removed the first-fight stutters.

### The audit pass (`perf/audit-pass`, D34–D37)

[PERF-AUDIT.md](PERF-AUDIT.md) has the findings, the before/after counts and the ranked list of
what was *not* done. In short, per driving frame on The Long Night: draw calls ~650 → ~160,
triangles ~780k → ~300k, vertex-shader runs ~2.3M → ~0.44M, one scene render instead of two,
6 full-resolution passes instead of 9, and much cheaper lighting and noise per pixel.

**Measured on the M1 in the second perf-log session** (`2026-11-10T14-23-57-798Z-xh1y`, High,
1314×704 window, 207 s): 120 fps locked to the display at 100% render scale, no frame over 33 ms,
no stutters; draws 97–447 (mean 226), triangles 181k–425k, JS 2.1–4.7 ms a frame. Before: 55–65 fps
at 60–90% scale. JS time follows draw calls (`cpu ≈ 1.76 + 0.0063 × draws` ms), and a kill doubles
the draws for half a minute: that, and the lack of any way to see headroom past the display's
refresh, are where [PERF-PLAN.md](PERF-PLAN.md) starts.

How the pieces fit now (details in CLAUDE.md gotchas):

- `post.ts` owns the frame's passes; there is no EffectComposer.
- Shadows come from stand-in meshes on two layers (`SHADOW_LAYER` scenery, `SHADOW_DYNAMIC_LAYER`
  things that move). `moonshadow.ts` fills the moon's map; three.js still draws the lamps' maps.
- `materials.ts` owns the two noise textures and the light-skip shader patch.

## The playtest perf log (reading it)

When the game runs as the owner's preview artifact, it writes to the artifact's private database. Use the `ArtifactData` tool with url `https://claude.ai/artifact/UveMJUFVhBM6xfCTivZXxg`:

1. `list` collection `perf`. You get one document per session: machine, settings, build and a summary.
2. `list` collection `perf/<session id>/chunks`, with `out_dir` set to save the files.
   - Each chunk has `samples`, rows in the order of `sampleKeys`, one row per 2 seconds.
   - It also has `stutters` (`{t, ms, cpu, combat}`).
3. Group the samples by `dyn` to see fps against render scale. A short Python script is enough.

Keep the artifact's capabilities when republishing. Omitting `capabilities` carries them forward.

## Working in a cloud session: practical notes

- **Preview builds:** follow "Preview builds" in `CLAUDE.md`.
  - The page file must inline the built CSS.
  - Swap the `assets/index-*.js` name in it, publish with the new JS in `files`, and `null` the old JS name.
  - Keep the previous page file somewhere in your scratchpad, or rebuild it from `index.html`.
- **Headless checks:**
  - Use Playwright with `--use-angle=swiftshader --enable-unsafe-swiftshader`.
  - SwiftShader renders on the CPU at about 1–3 s per frame. Screenshots need 180–400 s timeouts.
  - Frame times there are only a relative proxy. Draw and vertex counts (hook `drawElements` and `viewport`) are exact and comparable.
  - Dynamic resolution ignores frames over 250 ms, so it never acts headless.
  - To compare images, freeze it: `v.dynRes.update = () => false; v.dynRes.scale = 1; v.resize()`.
  - For *exact* comparisons between builds (baseline against itself = 0 difference), use the
    scripts in `tools/perf/` (see its README): counts, PASS/FAIL checks, deterministic screenshots
    and diffs. How they are made exact is in "Reproducing the measurements" in PERF-AUDIT.md.
  - A click that starts a mission blocks for the whole world build and warm-up frame (tens of
    seconds here): trigger it with `page.evaluate(() => el.click())`, not `page.click` with a timeout.
- **Dev server:** start it detached, or it dies between turns: `setsid nohup npx vite --port 5199 --strictPort > log 2>&1 < /dev/null &`.
- **Don't edit `src` while a headless run is going.** Vite's hot reload breaks the run.
- **Comparing against an older build:**
  - Make a `git worktree` of the old branch in the scratchpad.
  - Symlink `node_modules` into it.
  - Serve it on a second port.
- **Audio previews:** record with `audio.tap()` plus MediaRecorder in Playwright.
- **GitHub:**
  - The repo reports it moved to `revoo/Ironveil_Opus5.5Medium` (the case changed). Pushes still work through the old remote URL.
  - Pushing tags and deleting branches are refused in cloud sessions.

## Owner preferences (standing)

- Conservative scope, polish over breadth, honest estimates. Quote estimates in *agent* time, then say what is slow: headless renders and the owner's playtest round trip.
- Merge to `main` only when the owner says so, by fast-forward. **Never delete merged branches**; they are souvenirs.
- The enemy must never carry Nazi or WWII symbolism (see `docs/SETTING.md`).
- Commit attribution lines come from the harness. Never put model names in code or commits.
- The owner tests through the preview artifact. After a change they'd want to try, rebuild and republish it.

## Open owner decisions

- `docs/CREW-PROPOSAL.md` (crew health, morale, trust, value-tagged choices): still awaiting a decision.
- Unverified by a human:
  - How the synthesised voices and choir sound in the mix.
  - How the comms panel looks on narrow screens.
  - The combat numbers.
