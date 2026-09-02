# Colosseum — Asset Licenses

The Colosseum rebuild is original. This file records the provenance and
licensing of every non-code asset and of the audio layer. Nothing here is
copied from the reference game (see `docs/implementation/COLOSSEUM-SPEC.md`).

## Art / Visuals

### Shipped: original vector sprites + arena backdrop

- **Source:** `frontend/src/pages/Projects/Colosseum/game/assets/art.ts`
  (inline SVG, generated as code; registered as Phaser textures by
  `game/assets/textures.ts`).
- **What it contains:** five stylized, flat-shaded gladiator figures (one per
  weapon style: spear+shield, shield+blade, trident+net, dual blades,
  two-handed) drawn from a shared original body template, plus an original
  flat arena backdrop (sand floor, stone arch band, audience silhouette).
- **Provenance:** 100% original vector art, authored from scratch in code. No
  reference art was traced or copied. No third-party license applies.
- **License:** original work, released under the same license as the project's
  own code (no separate attribution required).

### Asset budget (mobile)

- No external image files are downloaded: every sprite is an inline SVG string
  (a few hundred bytes of source each) rasterized in memory at its display
  size by Phaser's `addBase64`.
- Display sizes: style figures 120x180 px at the 1280x720 design resolution;
  arena backdrop 1280x720.
- Estimated added GPU/texture cost: well under 1 MB of texture memory for all
  five sprites + backdrop combined, loaded lazily with the game itself (the
  game only mounts after the player taps "Play").
- If richer animated spritesheets are added later, each atlas must be recorded
  here with its file, author, source, license, and per-frame dimensions.

## Audio

### Shipped: original synthesized SFX

- **Source:** `frontend/src/pages/Projects/Colosseum/game/audio/sfx.ts`
  (WebAudio oscillators, generated at runtime).
- **Provenance:** all sounds are synthesized in code. They contain no sampled,
  purchased, or copied audio, so they are original works with no third-party
  license requirements.
- **License:** original work (no attribution required).

### Stock audio intake manifest (for a future swap-in)

The plan is to optionally layer licensed royalty-free stock on top of the
synthesized SFX. Before any stock file is committed, its row below MUST be
filled in — file path, author, source URL, license, and attribution text — per
the project's IP policy. Approved, verifiable sources (CC0 / free commercial):

| Slot | File | Source | License | Attribution |
| :-- | :-- | :-- | :-- | :-- |
| hit | *(pending)* | Pixabay / OpenGameArt (CC0) | | |
| crit | *(pending)* | Pixabay / OpenGameArt (CC0) | | |
| block | *(pending)* | Freesound (CC0) | | |
| victory | *(pending)* | Pixabay / OpenGameArt (CC0) | | |
| defeat | *(pending)* | Freesound (CC0) | | |
| music loop | *(pending)* | OpenGameArt (CC0) | | |

Rules: only CC0 or clearly "free for commercial use, no attribution required"
files are acceptable without explicit written permission; anything with an
attribution clause must carry that attribution verbatim in the table above.

## Code

- All game code, names, and text are original. No expression is copied from the
  reference game. The five style names use factual historical gladiator
  categories (generic type terms), not game-invented lore.
