# Tactical AI

Bots should feel purposeful, tactical, fallible and varied, and win through behaviour rather than
secret knowledge. The design borrows F.E.A.R.'s split between deciding *what* to want (goals) and
working out *how* (planning), with squad-level coordination on top.

```
 team Observation ──► BotMemory ──► Situation ──► utility goal scores (+commitment)
 (only legal info)    (per bot)                        │
                                                       ▼
                     SquadBoard roles/focus ──►  GOAP plan (context-costed actions)
                                                       │
                                                       ▼
                                                 action executors ──► Motor ──► TankInput
                                                                       (8-dir keys, aim, trigger)
```

## 1. Perception (`src/ai/memory.ts`): fair by construction

Bots receive the same per-team `Observation` the player's renderer gets. That means shared team vision,
stale last-known markers, coarse sound cues for *that* bot (8 sectors × near/far), observed mud tracks,
and their own damage events. The AI never imports the world (`tests/architecture.test.ts`).
`tests/ai.test.ts` proves it: a bot's inputs are bit-identical whichever of two hidden positions a
silent enemy occupies.

- **Reaction delay.** A newly seen or re-acquired enemy is only "acknowledged" after a sampled delay
  (easy 450–700 ms, normal 250–450, hard 150–300). Being under fire shortens it by 30%.
- **Motion is inferred, not read.** Bots ignore the observation's velocity field. They estimate an
  enemy's velocity from successive sightings, smoothed per tick, so after a sudden reversal they
  still believe the old direction for a moment, and jukes work. On first sighting, or after any gap
  in visibility, the estimate starts at zero, so a tank that has just broken out of brush or smoke
  is hard to lead. A persistent, difficulty-scaled bias is applied on top.
- **Memory decays.** A lost contact is remembered for 4/7/10 s (easy/normal/hard).
- **Searching uses negative evidence.** When contact is lost, the bot works out where the enemy
  *could* be: hull-reachable ground (a flood fill that follows corners and never enters sealed areas)
  within 170 px/s × time since last sighting. It then removes every spot a living teammate can
  currently see is empty. Brush beyond 110 px is never ruled out, because a tank there would be
  invisible. It checks well-separated spots from what's left, preferring brush, the enemy's last
  heading, and spots squadmates haven't claimed. Spots that become visibly empty are skipped without
  driving onto them. It re-plans in up to four waves as the region grows, and gives up ("They're
  gone") only when nowhere is left after about 3 s. Idea credited to the Sol 6.1 attempt.
- **Disturbances are hypotheses.** A sound cue becomes a point along the cue's sector at a
  band-appropriate distance, jittered ±22°. Repeated cues merge and refine it. Tracks suggest the
  freshest stamp. A hit suggests a point back along the shell's path.

## 2. Goal selection (`Bot.scoreGoals`)

| Goal | When it scores | Desired state |
|---|---|---|
| engage | acknowledged, visible target | targetHurt |
| reposition | exposed while reloading/venting and cautious | inCover |
| retreat | hull ≤ 45% while exposed or under fire | safe |
| flank | squad role = flank, focus known, not already in a duel | atFlank |
| investigate | best unresolved disturbance (priority × freshness) | investigated |
| search | lost contact still in memory | searched |
| ambush | patient + stealthy personality, near sound cue | ambushSet |
| hunt | fallback | patrolled |

**Commitment:** the current goal gets +0.22 for its first 0.8 s and +0.12 after that, so bots don't
twitch between goals. A goal whose plan fails is put on cooldown (1.3–1.5 s), so a bot can't stay
stuck in an unproductive plan.

## 3. Planning (`src/ai/planner.ts`)

This is a small forward uniform-cost GOAP search over boolean symbols (`hasShot`, `weaponReady`,
`inCover`, `smokeReady`, `concealed`, `safe`, …). The interesting part is the **context-dependent costs**:

- **tap vs charge.** Close range, a target aiming at us, a target moving across our line, a finishing
  shot, or "keep them busy while the flanker moves" all make tap cheaper. Long range, a stationary or
  unaware target, the support role, and a high `chargeBias` trait make charge cheaper. In the soak,
  about 20% of shots are charged.
- **smoke vs plain retreat.** Smoke gets cheaper with low HP, a close or attacking enemy, being
  outnumbered, the bot's caution, and difficulty (`smokeUse`). It's valid only while exposed or under
  fire, which avoids the smoke spam the owner disliked in Relay Control (about 14 smokes per 6-tank match).
- **reload behaviour.** `[waitReload → shot]` strafes while reloading. Cautious bots instead pick
  `reposition` → `takeCover`, then peek again from a new spot.

## 4. Execution (`src/ai/bot.ts`, `src/ai/motor.ts`, `src/ai/tactics.ts`)

- **Tactical positions** come from sampled rings scored for line of sight to the target, preferred
  range (persona), exposure to *other* known threats, nearby cover to duck behind, brush, mud, and
  squadmates' claims. Flank spots must be at least 57° off the axis between the target and the
  pressure tank.
- **Exposure-aware routes.** A* (16 px grid, inflated by the hull radius, no corner cutting) adds
  cost to cells visible from known threats. Flankers weight exposure heavily and prefer brush.
- **Lead targeting** solves the intercept for the chosen charge's shell speed. Each shot also gets a
  persistent Gaussian aim error (6.5° / 3.6° / 2.0°).
- **Trigger discipline.** A bot starts charging while still traversing, releases only when the barrel
  is on its (imperfect) aim point, and when the hold window is about to vent it either forces the
  shot or cancels (holdDiscipline). Losing the shot cancels the charge ("hold fire").
- **Projectile reactions.** Visible enemy shells are watched. After a reaction delay, if the closest
  approach is under 34 px within 1.3 s, the bot rolls its dodge chance and veers sideways, away along
  the shell's travel. Shells the bot couldn't see can't be dodged.
- **Slippery-physics steering.** The motor steers on velocity error, not raw direction, so bots
  countersteer their own drift, brake into arrival points, and unstick themselves.
  `tests/ai.test.ts` checks that no bot stays stationary for 20 s in a 150 s 3v3.

## 5. Squad (`src/ai/controller.ts`)

Every 0.5 s the controller picks a **focus** (nearest known enemy to the squad) and assigns
**pressure** (closest bot, or the human if they're closer), **flank** (highest flank trait, kept
stable), and **support** (longer range, more charging). While the flanker moves, pressure taps more
to keep the target busy. When the flanker engages, the squad **pushes** its preferred range in by
100 px. Hunting bots spread over landmarks and the enemy side without sharing a destination. Bots
claim chosen positions, which spreads the squad out.

Allied bots post short **radio callouts** to the player ("Flanking — going wide of Radio Tower.",
"Fresh tracks by Broken Bridge, checking.", "Reloading — moving to cover."). They explain intent and
make teammates legible. Enemy callouts are never shown.

## 6. Personalities (`src/ai/personality.ts`)

Six archetypes: Brawler, Marksman, Stalker, Flanker, Anchor, Scrapper. Each has trait values
(aggression, caution, patience, flank, chargeBias, stealth, teamwork, reflex, preferredRange). A bot
derives its persona from its callsign, plus a small persistent jitter, so "Moth" always plays like
Moth. The scoreboard shows your teammates' temperaments, and the results screen reveals the enemies'.

## Difficulty

| | Recruit | Veteran | Ironclad |
|---|---|---|---|
| Reaction | 450–700 ms | 250–450 ms | 150–300 ms |
| Aim σ | 6.5° | 3.6° | 2.0° |
| Lead skill | 0.50 | 0.82 | 0.96 |
| Memory | 4 s | 7 s | 10 s |
| Dodge chance | 15% | 42% | 70% |
| Smoke use / flanking | almost never / sometimes | when exposed / always | more readily / always |
| Think rate | 6 Hz | 10 Hz | 15 Hz |

HP, damage, vision, turret speed and movement are identical for everyone.
