# Ironveil

Top-down stealth tank combat in the browser. You and your AI squad (Ironveil) fight a tactical AI
squad (Rustguard) in **team deathmatch** on *Relay Yard*. Momentum-heavy, drifting tanks; a chargeable
cannon; brush, smoke, sound and mud tracks that make information the real weapon.

> **Status:** single-player complete and ready for the owner's playtest. Multiplayer is
> intentionally deferred (see [docs/DECISIONS.md](docs/DECISIONS.md)).

## Quick start

Requires Node.js 22+ (developed on 24).

```bash
npm install
npm run dev          # http://localhost:5173
```

Production build, served locally:

```bash
npm run build
npm run preview      # http://localhost:4173
```

Then pick a difficulty and team size and press **Deploy**. Press **Training** first for a two-minute
guided checklist against harmless targets.

## Controls (all remappable in Settings)

| Input | Action |
|---|---|
| **W A S D** / arrows | Drive in that world direction, immediately. Momentum carries through turns: tap the opposite direction to brake hard, steer early to drift. |
| **Mouse** | Aim. The turret traverses toward the cursor; the gold ring shows where the barrel actually points. |
| **Space** (hold → release), or LMB | Charge, then fire on release. A tap is a fast, light shot. Full charge (1.5 s) is heavy and fast but slows and reveals you; at full charge you get 1.5 s before the cannon vents and the shot is lost. |
| **Right mouse** / E | Cancel the current charge |
| **Q** | Smoke (18 s cooldown, 5 s cloud, blocks all sight but not shells) |
| **Shift** (hold) | Silent running: slow and quiet. Not invisible, and mud still takes tracks. |
| **Tab** (hold) | Scoreboard |
| **Esc** / P | Pause menu (the game also auto-pauses when the window loses focus) |
| **F3** | Performance overlay |

## What's in the build

- **Team deathmatch**, 1v1 to 4v4 (default 3v3: you plus two bots against three). First to 15 kills
  or most kills at 8:00, then sudden death. 5 s respawns with spawn protection.
- **Movement:** world-space, immediately responsive, slippery. Acceleration, coasting, hard
  countersteer braking, and drifts that bleed off sideways momentum. The hull visibly swings toward
  where you're steering while the tank slides.
- **Combat:** a charge/tap cannon with a reload, cancel and vent state machine, and swept projectile
  collision (no tunnelling, moving targets included). Same-tick trades resolve independently of
  processing order.
- **Stealth layer:** 440 px vision, hard cover, smoke, brush concealment with a firing reveal, shared
  team vision, coarse 8-sector sound cues (shown on screen as coloured arcs), 3 s stale last-known
  markers, and ownerless mud tracks you can discover later.
- **Tactical AI:** utility goals, GOAP plans, and a squad coordinator (pressure, support, flank),
  with exposure-aware routes, cover peeking during reloads, tap/charge/hold-fire choices, smoke
  escapes, investigation of sounds and tracks, searching after losing contact, lead targeting, shell
  dodging, six persistent personalities, and squad radio callouts. Bots see only what their team
  legitimately sees. Details: [docs/AI.md](docs/AI.md).
- **Presentation:** fixed 30 Hz simulation rendered at display rate with interpolation. A dusk light
  map with dynamic lights (muzzle flashes, explosions, burning wrecks, shells, headlights) plus bloom.
  Soft fog of war that respects walls and smoke. Billowing smoke clouds, sparks, debris, scorch marks,
  dust and drift spray, turret-popping explosions, burning wrecks. Charge-scaled inertial recoil
  (barrel slide, hull kick and camera kick on springs). Synthesised audio. **Reduced motion** and
  **low effects** settings.
- **Accessibility:** remappable controls, text scaling, visual sound cues, a muted-play-friendly HUD,
  and team identity by shape as well as colour.

## Project layout

| Path | Contents |
|---|---|
| `src/sim` | Headless deterministic simulation: map, movement, weapon, projectiles, vision, sound, tracks, match rules, and the per-team `Observation` filter |
| `src/ai` | Bot perception memory, navigation, tactics, GOAP planner, bots, squad controller |
| `src/game` | `LocalSession` (fixed-step solo host) and Training |
| `src/content` | Relay Yard map |
| `src/client` | Phaser presentation: rendering, FX, lighting and fog, HUD, audio, input, menus |
| `tests` | Vitest suites (simulation, AI behaviour, session, presentation helpers) |
| `tools` | `soak.ts` (headless bot matches with metrics), `map-preview.ts` |

## Testing

```bash
npm test             # 143 tests: sim rules, perception fairness, AI behaviour, session, feel
npm run typecheck
npm run soak -- 20 3 normal     # headless bot-vs-bot matches with behaviour metrics
npm run map:preview             # ASCII map + validation
```

CI (`.github/workflows/ci.yml`) runs only on `v*` tags or a manual dispatch, as the owner asked:
typecheck, tests, build, a 10-match soak, and the build artifact.

See [docs/VALIDATION.md](docs/VALIDATION.md) for measured results and [docs/PLAYTEST.md](docs/PLAYTEST.md)
for what to look for in the playtest.
