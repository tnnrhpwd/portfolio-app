# Colosseum — Asset Licenses

The Colosseum rebuild is original. This file records the provenance and
licensing of every non-code asset and of the audio layer.

## Audio

- **Current state (Phases 1–6):** all sound effects are **synthesized in code**
  (`frontend/src/pages/Projects/Colosseum/game/audio/sfx.ts`, WebAudio
  oscillators). They contain **no sampled, purchased, or copied audio** and are
  therefore original works with no third-party license requirements.
- **Planned:** swap in royalty-free stock SFX/music (e.g. OpenGameArt, Pixabay,
  Freesound). Each file's license and attribution MUST be recorded here before
  it is committed, per the project's IP policy.

## Art / Visuals

- **Current state:** the in-game UI is placeholder text/shapes drawn in Phaser
  (no external image assets). The React shell reuses the site's existing
  branding only (header/footer/SEO), which is already licensed to the project.
- **Planned:** original 2D spritesheets/atlases for the five gladiator styles,
  original UI chrome, and backgrounds. These must be original work (or
  correctly licensed) and recorded here when added.

## Code

- All game code, names, and text are original. No expression is copied from the
  reference game (see `docs/implementation/COLOSSEUM-SPEC.md`).
