# Setting

Owner direction: not another Nazi game, and not a literal Soviet one either. Both nations are
fictional. Names live in `src/content/lore.ts` (plus a sentence in each mission briefing), so
renaming is cheap.

## Us: the People's Republic of Vostrava (Вострава)

- A Slavic people's republic with Soviet leanings: red star, cog, constructivist poster art,
  Cyrillic on equipment and the comms panel, padded tank-crew helmets, an R-123-style tank radio.
- The crew speak a Slavic language. On the radio they are synthesised (see `sound/voice.ts`):
  rolled r, palatal glides, hard clusters, the ы vowel, strong stress, Russian-style intonation.
  Subtitles are English; panel labels are Russian words, which stand in for Vostravan.
- Colours: signal red, black, paper.

### The crew of tank 412

| Position | Name | Called | Voice |
|---|---|---|---|
| Commander | Lt. Oleg Rusakov (Русаков) | Comrade Lieutenant | low, gravelly, measured |
| Driver | Sgt. Pavel Gromov (Громов) | Pasha | quick, young |
| Gunner | Cpl. Vera Lisitsyna (Лисицына) | Vera | crisp, dry |
| Loader | Pvt. Bogdan Kuzmich (Кузьмич) | Bogdan | deep, slow, rough; the dark jokes |

Mission data keeps the role ids (`"from": "Driver"`); `lore.ts` maps them to names on screen.
Writing notes: the crew say "comrade" sparingly, call each other by nickname, and mock the
Directorate's paperwork ("Let them file a complaint"). Some of them have family on this side of the Wall.

## Them: the Directorate of Graustein

- A Germanic-speaking, bureaucratic, walled state: border troops, gates, papers, concrete. Think a
  paper-pushing border regime, not the Third Reich.
- **Never**: eagles, black-white-red, blackletter, swastika-adjacent shapes, SS-style ranks or
  WWII-era terms and clichés. Ordinary ranks (Hauptmann, Oberst) are fine.
- Colours: slate grey and ochre. Emblem: a gate tower. Peaked caps, not WWII helmets.
- Their voices are Germanic pseudo-speech: glottal onsets, uvular r, sch/ch hiss, umlauts.
- The wall slabs, border gates and grey blocks of the levels are theirs. Their buildings carry
  posters ("ORDNUNG IST SICHERHEIT", "PAPIERE BEREITHALTEN"), "DAS DIREKTORAT WACHT" banners,
  GRENZZONE signs on guard booths, notices and street plates (`three/signs.ts`). Avoid the word
  "Arbeit" and anything else that echoes Nazi slogans.
- The resistance answers in red Cyrillic: ВОСТРАВА ЖИВЁТ ("Vostrava lives"), ДОМОЙ ("home"),
  СВОБОДА, НЕ ЗАБУДЕМ, stars sprayed over their posters, half painted over in grey.
- Their barks lean bureaucratic: "Halt! Who goes there?", "Nothing. No report necessary.",
  "Tank lost! Notify the Directorate!".

## Music

D minor. A low male choir (oktavist root, baritones, tenors) on dark vowels carries the score,
with a church bell tolling across the city in quiet moments; the success stinger resolves to
D major with the choir and the bell.

## Language on screen

| Thing | Language |
|---|---|
| Subtitles, objectives, menus | English |
| Comms panel labels, decision tag, radio set | Russian (as Vostravan) |
| Enemy names and ranks | German-style, Latin script |
