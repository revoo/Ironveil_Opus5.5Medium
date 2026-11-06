# Crew system: design proposal

Status: **proposal for the owner to decide on.** Nothing here is implemented yet. The mission
system's flags (`setFlag` / `addFlag`) are where it will plug in.

## Why the crew matters, and the rule that follows

The crew is the main way the story is delivered. The game has no cutscenes and no on-screen people;
the four people in the hull carry the drama. So this system exists to **serve the writing**, not to
simulate people. Every number it tracks has to be one of these:

1. something a writer can branch on,
2. something the player can feel in play, or
3. something that pays off later.

If a value does none of these, cut it.

**Pillars**

- **Legible.** The player always understands *why* someone feels the way they do. Changes are shown
  ("Mara will remember that."), not hidden in a spreadsheet.
- **Authored first, systemic second.** Writers control the big beats. The system carries
  consequences forward and fills in the small reactions.
- **Bounded.** Coarse bands, not fine numbers, so the writing burden stays linear, not combinatorial.
- **Small.** Four people. Depth per person, not breadth.

## The model

### Who's in the tank

The player is the **commander**: the player drives, aims and chooses, and the crew react to the
commander. (Open question 1 below.) The crew are three or four named people in fixed roles:

| Role | In play | In story |
|---|---|---|
| Driver | moves the tank | usually the pragmatist |
| Gunner | aims the cannon | usually closest to the violence |
| Loader | reloads | usually the youngest, or the most fragile |
| (Radio operator / hull gunner) | hears and spots | optional fourth voice |

Each crew member is authored data: id, name, role, short voice notes for writers, and **two
values** from a small shared list.

### 1. Health: four discrete states, not hit points

`Fit → Wounded → Critical → Dead`

- **How wounds happen in play:** the tank's damage is the crew's danger. When the hull drops below
  50%, one crew member is wounded; below 20%, another. Who gets wounded is decided by a seeded,
  reproducible rule (for example the side the shell hit from), not a dice roll on each retry.
  Story events can also wound people directly.
- **What wounds do in play** (small, role-specific, never a death spiral):

  | Wounded | Effect |
  |---|---|
  | Driver | top speed −10%, slower to change direction |
  | Gunner | turret traverse −15%, slight aim sway |
  | Loader | reload +25% |
  | Radio op | sound cues reach shorter, the detection meter is less precise |

  Critical doubles the penalty. Each maps onto a tuning value the simulation already has, through a
  per-tank modifier block, so it's cheap to build.
- **Death:** by default, death comes only from **authored story beats** (a choice, an event), or from
  a Critical wound left untreated between missions (see "Between missions"). Death is never a random
  consequence of one bad firefight. With checkpoints, random death would just mean "reload", which
  kills the drama. (Open question 2.)
- **When changes become permanent:** crew changes from a mission are committed **only when the
  mission ends**. Retrying from a checkpoint restores the crew too, so it can't be save-scummed
  mid-mission and can't be lost to a bug.

### 2. Morale: one value per person, three bands

`Steady · Shaken · Breaking`, internally a number from 0 to 100.

- **Goes down:** near-death moments, a comrade wounded, actions that violate their values, long
  missions with no rest.
- **Goes up:** rest and supplies between missions, choices that honour their values, small
  authored moments (a shared cigarette scene).
- **Writers only branch on the band.** Three bands × four people is something you can actually write for.
- **Breaking** has teeth, scripted rather than random: the Loader freezes for a beat under fire (slower
  reload for one engagement), the Driver argues over the radio, and between missions someone may ask
  to leave. Who leaves, and how, is a written scene.

### 3. Trust in the commander: one value per person

How much each crew member believes in *you*. It's the main relationship axis, with the same three
bands (`Doubts you · Neutral · Trusts you`).

- It changes mainly through choices, via **value tags** (below), and through outcomes ("you got us
  out alive" raises everyone's trust a little).
- It gates key beats. Will the Gunner follow an order they hate? Does the Driver cover for you in
  front of command?

**Crew-to-crew relationships** are kept as a few **authored flags** ("Driver and Loader are close",
"Gunner blames Radio op for Kessel"), not a 4×4 matrix of numbers. A full matrix is the classic
trap: 12 numbers nobody can write for. Use flags; promote one to a number only if a story needs it.

### 4. Values: the mechanic that keeps writing scalable

Each crew member holds two values from a short list, for example:

`Survival · Duty · Mercy · The crew comes first · Revenge`

Choice options are **tagged** with the values they serve or betray:

```json
{ "text": "Straight through the gate",
  "tags": { "serves": ["Duty"], "betrays": ["Survival"] },
  "do": [ { "setFlag": "route", "value": "gate" } ] }
```

The system then applies morale and trust changes automatically: +trust and +morale for crew who hold
a served value, − for crew who hold a betrayed one, with on-screen feedback ("Ruth didn't like
that."). The writer tags a choice once instead of hand-writing four sets of deltas, and every choice
in the game automatically means something different to each person. This is the single most
important idea in the proposal.

### 5. Memory: a few remembered moments

A short list of named events per person (`left_the_wounded_soldier`, `spared_the_deserter`).
Written lines can reference them months later ("Like you did at the bridge?"). Set them with a
`remember` action; they're just flags scoped to a person.

## Between missions: where most of the story lives

Borrowing directly from *This War of Mine*: after each mission comes a short **interlude**, one
screen and no 3D, set in the night camp:

- **One scarce resource**, *supplies*, spent on treating a wounded crew member, repairing the
  tank, or extra rations (morale). There's never enough for everything. That's where the
  morally grey choices land, quietly.
- **One or two conversations**, picked by state (who's Breaking, who Doubts you, what someone
  remembers), as text with choices.
- Untreated Critical wounds get worse here. This is the systemic route to losing someone, and the
  player always sees it coming.

Interludes are cheap to build (text, choices, a few numbers) and they carry a lot of weight.

## How it plugs into what exists

| Piece | Where | Size |
|---|---|---|
| Crew data and `CampaignState` (crew, flags, results, versioned save) | `src/game/campaign/` | small |
| Mission actions: `crew` (morale/trust/wound/heal/remember), choice `tags` | `src/game/mission/` | small |
| Mission conditions: `{ "crew": "ruth", "health": "wounded" }`, `{ "crew": "ruth", "morale": "breaking" }`, `{ "crew": "ruth", "trust": "doubts" }`, `{ "crew": "ruth", "remembers": "bridge" }` | runner | small |
| Wound modifiers (speed, traverse, reload, hearing) | `src/sim`, a per-tank modifier block | small |
| Crew strip on the HUD (name, state icon, last reaction) | client | small |
| Interlude screen | client + campaign | medium |
| Ink integration: crew state readable from dialogue, functions to change it | `src/game/dialogue/` | medium (planned anyway) |

Everything stays headless and testable, like the mission system: a test can play a choice and
assert that the right people lost trust.

## Phasing

1. **With the first real mission:** crew data, health states and wound modifiers, morale and trust,
   value tags on choices, mission actions and conditions, HUD strip.
2. **With mission two:** `CampaignState`, saving between missions, the interlude screen with supplies.
3. **With the dialogue pass:** Ink integration and state-driven conversation selection.

## Deliberately out of scope

A full relationship matrix · random personal events · procedural dialogue · mood-driven barks for
every situation · portraits with many expressions (three per person at most: neutral, strained,
hurt) · crew replacement or recruitment · per-limb injuries.

## Risks, and how this design handles them

| Risk | Answer |
|---|---|
| Players don't notice invisible numbers | Visible reactions on every change, and bands not hidden decimals. Interludes show the state of each person. |
| Writing grows combinatorially | Branch on bands and flags, value tags instead of hand deltas, few memories. |
| Penalties snowball into an unwinnable state | Mild wound effects, no death from a single fight, interludes always allow recovery. |
| Checkpoints undermine consequence | Crew changes commit at mission end only, and death is authored or foreshadowed. |
| Feels like a spreadsheet | One resource, one screen, text first. If it ever needs a tutorial, it's too big. |

## Decisions needed from you

1. **Is the player the commander?** (Recommended.) Or are you an unseen presence and the commander
   is a crew member with their own arc?
2. **Can crew die permanently through play,** or only through story and untreated wounds? (Recommended: the latter.)
3. **How visible are the numbers?** Bands with reactions (recommended), exact values, or fully hidden?
4. **Four crew or three?** Three halves the writing per beat. Four allows a richer cast. The fourth
   seat (radio op) is the one to drop.
5. **Interludes with supplies:** yes or no? This is the biggest single design choice here, and the most *This War of Mine*.
6. **The value list:** these five are placeholders. The right list comes out of your setting and themes.
