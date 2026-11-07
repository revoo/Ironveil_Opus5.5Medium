# Asset and licence inventory

| Asset | Source | Licence |
|---|---|---|
| Tank hulls, turrets, barrels, wrecks | Procedurally drawn at runtime (`src/client/textures.ts`) | Project licence |
| Terrain, walls, brush canopy, minimap | Procedurally baked at runtime from map data | Project licence |
| Particles (smoke puffs, sparks, debris, glow, flash, ring, scorch, tracks) | Procedurally drawn at runtime | Project licence |
| All sound effects, ambience, radio treatment and the adaptive score | Synthesised with WebAudio at runtime (`src/client/audio.ts`, `src/client/sound/`): generated reverb impulse response, no samples | Project licence |
| Rajdhani and Stardos Stencil fonts | Google Fonts (loaded by `index.html`; fall back to system fonts offline) | SIL Open Font License 1.1 |
| Colour palette | Ground/UI/team tones adapted from the project owner's Sol 6.1 build; Berlin-wall concrete, graffiti and lamp tones added (`src/client/palette.ts`) | Project licence |
| Phaser 3.90.0 | npm | MIT |
