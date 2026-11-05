# Validation results

Measured on the development machine (Windows 11, Node 24.22, Chromium-based in-app browser). These
numbers describe this build and are not capacity promises. Human-judged gates are tracked separately
in [PLAYTEST.md](PLAYTEST.md), and all of them are **awaiting playtest**.

## Automated tests: 133 passing (`npm test`)

| Suite | Tests | What it establishes |
|---|---:|---|
| architecture | 4 | `sim`/`ai`/`game` import no Phaser/DOM/client code; the AI never imports the authoritative world |
| map | 14 | Terrain parsing, DDA wall raycasts (no tunnelling, no diagonal-corner leaks), circle push-out, map validation (spawn clearance, reachability) |
| content | 5 | Relay Yard validates, is point-symmetric, has spawns for 4 per team, returns isolated copies |
| movement | 14 | Instant response without hull alignment, ~0.4 s to top speed, diagonal normalisation, drift through 90° turns, coasting, countersteer braking, visual hull turn rate, turret traverse limit, terrain factors, silent-running cap and "not instantly quiet", charge slowdown, wall sliding, no wall penetration at extreme speed, determinism |
| weapon | 10 | Tick-rounded durations (charge 45, hold 45, reload 20, cancel 8, vent 24 ticks), same-tick tap, full charge, linear charge/speed factor, 5-tap / 2-full kill counts, no banking during reload, cancel, vent, smoke interruption |
| combat | 12 | Muzzle spawn and speed, range expiry, thin-wall tunnelling, obstructed muzzle, swept hits on crossing targets, earliest-target only, allied pass-through, order-independent same-tick trades, death while charging, duplicate input, kill scoring and respawn, spawn protection |
| vision | 7 | 440 px range, wall and smoke occlusion (including rays starting inside smoke), brush 110 px rule and 1.2 s firing reveal, team-vision union, ground-point visibility |
| observation | 11 | Hidden enemies absent from data, stale 3 s markers that never update, a marker cleared when the enemy is seen dying, visible shells without shooter identity, sector/band-only sound cues, no hidden cue for visible sources, hidden impacts filtered, ownerless bounded tracks, tracks discovered later and expiring, storage cap |
| match | 7 | Countdown freeze, kill target, time limit, sudden death win/draw, safe respawn choice with protection |
| nav | 7 | Hull-safe paths, no corner cutting, unreachable → null, exposure-aware route choice, smoothing, cross-map path time, unwalkable snap |
| planner + aim | 7 | GOAP chaining, context-costed choice (tap close / charge far), smoke vs. plain retreat, impossible goals; intercept maths |
| ai | 12 | Reaction delay; **identical decisions whatever a hidden enemy's real position**; engages; leads a strafing target; investigates an unseen shot; searches the last-known position instead of tracking the hidden enemy; smokes or breaks contact when crippled; dodges a visible shell; keeps moving in duels; squad assigns pressure + flank; 150 s 3v3 with kills and nobody stuck ≥ 20 s; determinism |
| session | 8 | Same result at 60 fps vs uneven 144/20 fps frame mixes; interpolation alpha; one input sample per tick; catch-up cap; pause freezes timers and resume needs fresh fire input; restart; distinct rosters/personas |
| feel | 6 | Spring overshoot and settle, frame-rate independence, charge-scaled recoil (full ≥ 2.5× tap), reduced motion removes hull/camera kick; interpolation snaps on reveal; exact shell back-projection |
| input | 6 | Space = fire, Q = smoke; tap between ticks never lost; hold edges; dual bindings act as one button; focus loss cancels instead of firing; remapping respected |
| training | 3 | Checklist progression, ignores other tanks' shots and stationary-target hits; harmless, moving targets |

**Test-first note:** most suites were written before their implementation and run red first (module
missing or assertion failing), including movement, weapon, combat, vision, observation, match, nav,
planner, ai, session, feel and training. The `input` suite and the `content` checks were added after
their code, as characterisation tests. During development, several tests were corrected when they
encoded an impossible or unfair scenario (for example, a dodge test where the bot was driving into a
point-blank shell, and turret pre-aim in observation tests). Those changes are visible in the git history.

## Headless bot-vs-bot soak (`npm run soak`)

100 complete 3v3 matches on Relay Yard, Veteran difficulty, randomised rosters (`npm run soak -- 100 3 normal`):

| Metric | Result |
|---|---|
| Matches finished | 100 / 100 (0 draws), every one to 15 kills |
| Match length | avg 267 s, min 204 s, max 374 s |
| Kills per match | 27.0 |
| Hit rate | 38.4% (tap 84% / charged 16% of 32,254 shots) |
| Smoke deployments | ~8 per match across 6 tanks |
| Longest any living bot stayed within 24 px | 10.8 s (ambush/hold behaviour; nothing stuck) |
| Sim + perception + 6 bots | 0.078 ms per tick (30 Hz) |
| Side wins | west 42 / east 58. Not significant at 5% (two-sided p ≈ 0.13), and an earlier 100-match run before the persona-roster change split 49/51. The map is point-symmetric; worth watching in playtests. |

Bot time by goal: investigate 37%, engage 34%, retreat 12%, flank 8.5%, reposition 4.6%,
hunt 2.6%, ambush 1.3%, search 0.3%.

Persona kills/deaths per appearance: Brawler 5.72/5.44, Scrapper 5.35/4.74, Flanker 4.40/4.58,
Stalker 4.38/3.95, Marksman 3.83/4.42, Anchor 3.73/4.26. The personas play measurably differently,
and none dominates.

By difficulty (10 matches each): Recruit had a 35.5% hit rate and used no smoke (Recruits almost
never smoke, by design). Ironclad originally smoked about 43 times per match, which repeated the
smoke spam the owner disliked, so its `smokeUse` was lowered from 1.0 to 0.82. After the change:
about 13 smokes per match, 35% hit rate (better dodging lowers everyone's accuracy), 25 kills per match.

An earlier soak at 6 bots revealed a soak-tool bug: rosters weren't really shuffled, which produced a
misleading 66/34 split. It was fixed with a seeded Fisher–Yates shuffle.

## Client performance

Production build (`npm run build && npm run preview`), 3v3 Veteran, 30 s of live play stepped at
60 Hz, measuring CPU time per frame (simulation + AI + rendering submission):

| median | p95 | p99 | max |
|---:|---:|---:|---:|
| 1.0 ms | 1.5 ms | 2.0 ms | 6.8 ms |

Particles are pooled and capped (1100 on high, 260 on low), as are lights (64 / 24), scorch decals
(40) and wrecks (fade after 16 s). No console errors were observed in dev or production builds.

**Not measured:** GPU frame time and on-screen FPS. The in-app browser pane was hidden during
automated runs, so the browser throttled requestAnimationFrame. The F3 overlay shows FPS and worst
frame time during a real playtest.

## Not done / known limitations

- Multiplayer, server, matchmaking and deployment are deferred by owner directive.
- No offline service worker (D7). No Web Worker host (D6).
- No Playwright browser smoke test. Browser verification was done manually in the in-app browser
  (menus, match start, combat, smoke, death/wreck, training, production build).
- Map authoring is code, not Tiled (D8).
- Human playtest gates are pending.
