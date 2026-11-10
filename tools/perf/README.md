# Performance harness for the 3D mission view

Headless scripts that drive the game frame by frame, so two builds can be compared exactly. They
render on the CPU (SwiftShader): **frame times here say nothing about a real GPU**. What is exact
and the same on any machine: draw calls, triangles, vertex-shader runs, and the picture itself.

The plan that uses them: [docs/PERF-PLAN.md](../../docs/PERF-PLAN.md). How the measurements were
made exact: "Reproducing the measurements" in [docs/PERF-AUDIT.md](../../docs/PERF-AUDIT.md).

## Setup

Start a dev server, detached (it dies with the shell otherwise):

```bash
setsid nohup npx vite --port 5199 --strictPort > /tmp/vite.log 2>&1 < /dev/null &
```

Another port: `PORT=5198 node tools/perf/counts.mjs`. To compare with an older commit, make a
`git worktree` of it, symlink `node_modules` into it, serve it on a second port, copy this folder
into it and run the same script there.

**Do not edit files under `src/` while a script runs**: hot reload breaks the run. Each script
takes 3–10 minutes; give it a long timeout or run it in the background.

## Scripts

| Script | What it tells you |
|---|---|
| `node tools/perf/counts.mjs` | Draw calls, triangles and vertex-shader runs per driving frame at nine places, then what a kill adds over 8 seconds (sprites and smoke billboards counted separately). |
| `node tools/perf/checks.mjs` | PASS/FAIL: no errors through presets, a resolution step, two restarts and a fight; and cached shadows equal a from-scratch redraw after driving, a kill and the debris fading. Exit code 1 on any FAIL. |
| `node tools/perf/shots.mjs <label>` | Six deterministic screenshots (five places and a fight) into `tools/perf/out/<label>/`. Add `--low` for the Low preset. |
| `node tools/perf/diff.mjs <a> <b>` | Per shot: mean difference (0–255), share of pixels off by more than 8, largest difference. The same build twice gives exactly 0. |
| `node tools/perf/crop.mjs <shot> <x> <y> <w> <h> <zoom> <a> <b>` | The same region from several sets, side by side, to judge by eye. |
| `node tools/perf/cpu.mjs` | JS time per frame by part. `render` is inflated here (the software renderer back-pressures the main thread); the other parts are real. |

`lib.mjs` has `open()` (start a mission with the frame loop under your control) and the in-page
helpers `__step`, `__goto`, `__settle`, `__kill`, `__sync`, `__vs`.

## Baseline

Commit `e0a24ca` (`perf/audit-pass`), *The Long Night*, High.

Driving (mean of nine places): **161 draws, 299k triangles, 436k vertex-shader runs.**

```
start      draws  120  tris  265k  vertex runs   418k
oldtown    draws  119  tris  203k  vertex runs   270k
plaza      draws  196  tris  347k  vertex runs   443k
boulevard  draws  150  tris  304k  vertex runs   410k
factory    draws  192  tris  342k  vertex runs   502k
river      draws  196  tris  338k  vertex runs   507k
railyard   draws  167  tris  324k  vertex runs   533k
border     draws  182  tris  306k  vertex runs   479k
approach   draws  131  tris  264k  vertex runs   363k
```

A kill at the plaza:

```
calm         draws  201  tris  321k  sprites  27  smoke billboards   0  scene objects 1846
0.2 s after  draws  278  tris  322k  sprites  71  smoke billboards  30  scene objects 1846
1 s          draws  327  tris  323k  sprites 117  smoke billboards  30  scene objects 1846
2 s          draws  406  tris  304k  sprites 196  smoke billboards  60  scene objects 1846
4 s          draws  379  tris  306k  sprites 170  smoke billboards  60  scene objects 1846
8 s          draws  302  tris  303k  sprites 100  smoke billboards  60  scene objects 1846
```

`checks.mjs`: ALL PASS.
