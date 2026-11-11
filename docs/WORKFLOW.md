# How the owner and agents divide design work

Read this before any content or design task (missions, levels, writing, pacing, features with a
"feel"). It records how the owner works and what they expect an agent to bring. Agreed with the
owner on 2026-11-10; the first mission made this way is *The Road Home*
([missions/road-home.md](missions/road-home.md)).

## The owner's profile, in their own terms

The owner produces music and describes themselves with that vocabulary: excellent at the 8-bar
loop, the intro, the drop; weak at **arrangement**. In design terms:

| Scale | What it is here | Owner |
|---|---|---|
| Micro | one encounter, one stretch, one line, one effect | makes it and judges it |
| **Meso** | **sequencing, pacing, progression: what comes after what, and why** | **judges it reliably, does not generate it** |
| Macro | what the game should *feel* like; tone; taste | owns it |

- They are a director and editor: a reliable, specific critic of anything concrete, at any scale.
  They cannot say what should come next from a blank page, but they can say whether what came next
  works and how to fix it.
- They fall for local maxima ("loopitis"): one stretch can absorb all their energy. Hand-made
  levels (LDtk) show it most: one great room, then nothing left for the rest.
- They hold a vision of how the thing should feel, not of what it should look like.

## The division of labour

**The owner supplies:** the feel and the grand vision (often two or three sentences), taste, and
piece-by-piece critique with suggested fixes.

**The agent supplies the middle, with its own creative liberty:** the structure that gets from a
vision to a playable whole. Concretely the agent is expected to *decide*, not ask:

- the premise and fiction of a mission, inside docs/SETTING.md
- the arrangement: how many stretches, what each one is for, the intensity curve, where the rests are
- the map, the units and their numbers, the routes, the triggers
- the crew's lines and who says them

A short brief is the whole brief. Do not answer it with a questionnaire, a menu of options or a
plan to approve. Produce the thing, playable end to end, and let the owner react. Their critique is
the specification. (This is the agent's reading of "they supply the generative work for me to
judge"; it still stops at the invariants in CLAUDE.md and at anything hard to undo.)

## Rules for the agent

1. **Arrangement first, written down.** Before the map, write a beat chart: one row per stretch
   with its purpose, intensity, the new thing it introduces, and the story beat. Keep it in
   `docs/missions/<id>.md` and keep it true when the mission changes. The owner critiques against it.
2. **Whole before polish.** The mission is playable start to finish before any stretch gets extra
   love. This is the guard against loopitis, the agent's as much as the owner's.
3. **Be specific, not safe.** An agent's arrangement drifts toward the competent average. Commit to
   a particular place, a particular person, a particular night. A bold choice the owner rejects
   costs one round; a bland one teaches nothing.
4. **Prove what can be proved without a human.** Routes, sightlines, checkpoints out of sight,
   intensity counts and trigger logic are checkable headlessly: check them and put the important
   ones in a test. Say plainly what was *not* judged, which is always whether it is fun, tense or
   moving. The agent cannot feel the game.
5. **Hand over critique handles.** With every piece, list the specific things the agent is unsure
   of, phrased so a playtest answers them ("does the opening have room to breathe before the
   village?"), not "any feedback?".
6. **Read critique as two kinds of data.** "This drags" or "this line is wrong" is a local fix:
   make it and leave the rest alone. "I wasn't ready for this" or "I wanted X here" is arrangement
   data even though it arrives as a local remark: check whether the beat chart needs to change.
7. **The owner's taste wins.** Argue for an arrangement choice once, with the reason, then build
   what they ask for.
8. **Start from the owner's set piece when there is one.** If they bring a hand-made stretch or a
   moment they love, it is the drop: arrange backwards from it (what must the player have learned
   and felt before arriving?) and build the connecting stretches around it.

## The loop

1. Owner: a few sentences of vision.
2. Agent: beat chart, then the whole mission in rough form, tests, a preview build, the list of
   open questions.
3. Owner: plays it. Slices for local quality; a full cold run for the journey, since pacing faults
   only show in sequence and a first play happens once.
4. Agent: local fixes as asked; arrangement changes where the notes point to them; beat chart updated.
5. Owner: the final pass of taste (tone, lines, light, sound).

## Tooling that would serve this loop (not built yet)

- Start a mission at any checkpoint from a debug menu, so a slice can be replayed without the run-up.
- Import a hand-made LDtk stretch into a generated map (today the importer converts whole levels).
- A pacing log per stretch (time, alarms, shots, damage) to compare the played intensity curve with
  the planned one; the playtest perf log is the model for it.
