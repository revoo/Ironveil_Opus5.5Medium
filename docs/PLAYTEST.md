# Playtest guide

> **Scope:** written for the original Skirmish (team deathmatch) build. Mission mode is not covered yet.

Tests establish correctness; only people can judge fun. All human gates are **awaiting playtest**.
Nothing here has been marked as validated.

| Gate | Question | Status |
|---|---|---|
| Feel | Does slippery, momentum-driven movement feel playful and in control, not floaty? | awaiting playtest |
| Combat (spec Gate A) | Can you aim, charge and cancel, and explain your misses? Do tap and charge each have a use? | awaiting playtest |
| Core loop (spec Gate B, adapted for TDM) | Do fights produce pursuits, flanks, escapes and ambushes, rather than a single meat-grinder lane? | awaiting playtest |
| AI | Do bots feel purposeful, tactical and fallible, and distinct from one another? Do they ever look omniscient or stuck? | awaiting playtest |
| Readability (spec Gate C) | With effects on high, can you still read tanks, incoming shells and cues? Is muted play still workable? | awaiting playtest |

## Suggested session (about 20 minutes)

1. **Training** (2 min). Complete the checklist. Note anything unclear.
2. **2v2 Veteran.** One match. Pay attention to drifting through corners and to braking by tapping
   the opposite key.
3. **3v3 Veteran.** One or two matches. Try at least one flank via the Broken Bridge or Quarry Cut,
   one escape with smoke, and one silent approach through brush.
4. **1v1 Ironclad.** A duel against a hard bot.
5. Optional: **Settings → Reduced motion** and **Low effects**, one round each.

## Things worth noting down

- Moments where a quick or a charged shot was clearly the right call, and why.
- Losing a bot and having it reappear from an unexpected direction. Did that feel fair?
- Bots investigating a sound or track you made. Did they come to the right area but not the exact spot?
- Bots falling back to reload, flanking, or popping smoke. Did they read as intentional?
- Anything that felt like cheating (impossible reactions, tracking through walls).
- Anything sluggish: turret traverse, momentum, hull turn, charge slowdown.
- Visual noise: did smoke, fire or explosions ever hide a shell you needed to see?
- Match length and pacing. First to 15 currently takes about 4–5 minutes with 3v3 bots.

## Quick tuning knobs (`src/sim/tuning.ts`)

| Feel | Knob |
|---|---|
| More/less drift | `movement.lateralGrip` (lower = longer slides) |
| Coasting distance | `movement.coastDecel` |
| Snappier starts | `movement.accel` |
| Braking | `movement.brakeAccel` |
| Barrel lag | `movement.turretTurnRate` |
| Match length | `match.killTarget`, `match.timeLimit` |

Bot difficulty profiles live in `src/ai/personality.ts`.
