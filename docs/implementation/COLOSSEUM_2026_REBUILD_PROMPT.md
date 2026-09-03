# Build "Colosseum" — a 2026 rebuild of a gladiator-management game

## Your role
You are a senior game engineer and game designer shipping a production-quality,
cross-platform HTML5 game. You write clean, tested, maintainable TypeScript. You
deliver in reviewable phases and never gold-plate.

## Objective
Rebuild the game that lives at https://sthopwood.com/colosseum from scratch as a
modern web game. It is a gladiator-management game: run a school (ludus) of
gladiators, recruit and train them, buy equipment, and fight turn-based arena
battles to earn gold and fame while climbing the rank ladder.

FIDELITY IS THE TOP PRIORITY: reproduce the reference as closely as the law
allows. Replicate its mechanics, rules, formulas, stat relationships and caps,
economy and progression curves, screen flow, and pacing exactly — these are
functional and not copyrightable. Only creative expression (art, text, names,
lore, music, and the specific look of UI chrome) must be original. When the law
permits a closer match, match it; original expression is only the fallback where
the law requires it.

The current implementation at this route is disliked and should be discarded,
except that its visual assets may be salvaged/reused where useful. This is a
clean-slate rewrite of the game itself.

## Hard constraints (non-negotiable)
1. COPYRIGHT / IP SAFETY. This is an original game inspired by the gladiator-
   management genre. It must contain ZERO copied expression from any commercial
   game. Concretely, you MUST NOT, under any circumstances:
   - copy assets/code from the reference SWF;
   - copy any art, sprites, UI look-and-feel/trade dress, text strings, names,
     lore, dialogue, music, or sound from the reference;
   - reproduce distinctive characters, logos, or trade dress from the reference.
2. The reference game is a FUNCTIONAL SPEC ONLY. You may run/play it to observe
   how it behaves, then reimplement that behavior with original code, original
   names, original text, and original assets. Underlying mechanics, rules,
   formulas, stat relationships, and progression curves are NOT copyrightable
   and may be replicated; creative expression (text, names, lore, dialogue, art,
   music, and the specific look-and-feel of the UI) is protected and must be
   entirely original. You MAY match the FUNCTIONAL structure of each screen
   (what controls exist and where they sit functionally), but you must draw that
   UI in an original visual style. The provided gameplay notes quote verbatim
   in-game text — treat those strings as off-limits and rewrite them in your own
   words.
3. All code, text, names, and assets in the deliverable must be original or
   correctly licensed.
4. The game title stays "Colosseum" (a generic historical word).

## Reference material
- Functional reference: `sandsofthecoliseum.swf` (legacy Flash; its online
  services are dead and its startup errors are harmless — play the core loop
  offline, e.g. via Ruffle, to study behavior). Local copy:
  `C:\Users\tanne\Downloads\sands-of-the-coliseum\sandsofthecoliseum.swf`.
- Primary gameplay spec: `docs/implementation/sands-of-the-coliseum-gameplay.md`
  — a detailed manual of the game's systems, screens, attributes, formulas,
  skill trees, facilities, economy, and progression. Read it end-to-end; it is
  your starting specification. (It quotes verbatim in-game text — never copy
  those strings; rewrite everything in your own words.)
- Visual reference screenshots:
  `C:\Users\tanne\Downloads\sands-of-the-coliseum\export\md\` (e.g. `file35.jpe`).
  Use these ONLY to understand screen layout, pacing, and function — do not
  trace or copy the art; recreate it in the new stylized direction below.
- Existing repo context (portfolio-app, branch `master`):
  - Route + wiring already exist: `frontend/src/App.js` (`/colosseum` and
    `/Colosseum`), catalog card in `frontend/src/pages/Projects/Projects/Projects.jsx`,
    sitemap entry in `frontend/scripts/generate-sitemap.js`. Keep these; replace
    the page content.
  - Old implementation to reference/salvage: `frontend/src/pages/Projects/Colosseum/`
    (a pure deterministic engine `colosseumEngine.js` with 17 Jest tests,
    `ArenaCanvas.jsx`, SVG icons in `ColosseumArt.jsx`, synthesized SFX in
    `sfx.js`). You may keep the pure-engine ideas and tests, but you are
    rebuilding presentation from scratch.
  - Reusable art: `frontend/src/assets/art/` (banner, icon, background texture,
    per-class portraits).
- Deployment: static frontend on Netlify (`netlify.toml`) + the repo's Node
  backend with DynamoDB (see `backend/`, its "Simple" public-data convention used
  by other projects).

## Phase 0 (first thing you do, before writing game code)
Read `docs/implementation/sands-of-the-coliseum-gameplay.md` end-to-end, then
cross-check it against the reference SWF
(`C:\Users\tanne\Downloads\sands-of-the-coliseum\sandsofthecoliseum.swf`, playable
offline via Ruffle) and the reference screenshots
(`C:\Users\tanne\Downloads\sands-of-the-coliseum\export\md\`). Then produce
`COLOSSEUM-SPEC.md` — a plain-English, implementation-ready functional
specification in your own words that catalogs:
- the core loop and every screen/state the player moves through;
- each system: character creation, roster/team management, attribute + skill
  allocation, blacksmith crafting, shop, recruit, infirmary, campaign map,
  and combat;
- combat rules at the behavioral level (turn order, body-part targeting,
  per-zone armor/health, attack precision tiers, blocking, MP/Morale skills,
  status effects, victory conditions);
- every stat, how it is derived, and the numeric relationships/caps that define
  balance — replicate the rules, never any verbatim text;
- the reward/risk curve (gold, XP, loot, the post-battle mercy/execute choice)
  and the rank gates that unlock cities.
Describe mechanics in your own words. Rewrite every name, text string, and lore
description originally — never transcribe the manual's quoted in-game text.
Stop and present this spec for approval before building.

## Target experience (the "feel" that must survive)
Reproduce these qualities of the reference as faithfully as legally possible,
with all-new expression only where the law requires it:
- Arena combat pacing and drama — weighty hits, crits, impact feedback, tension,
  and the high-stakes feel of choosing which body part to strike.
- The tactical layer: reading an opponent's armor and limbs, then picking the
  right target and attack strength each turn.
- The management loop: recruit → gear → train → fight → heal → climb ranks.
- The Morale/MP tug-of-war in combat — skills gated by a finite, controllable
  resource, where draining the enemy's resource is a valid strategy.
- A satisfying risk/reward economy (spend gold, risk a fight, chase rewards).
- A clear rank ladder and a campaign of escalating cities and opponents.
- Roman/gladiator era atmosphere (setting and mood, not copied lore).

## Tech stack (locked — do not re-litigate)
- Language: TypeScript, strict mode.
- Engine: Phaser 3 (WebGL), because it is the modern equivalent of the Flash
  runtime for 2D games: scenes, sprites, tweens, input, audio, and asset loading
  out of the box.
- Build: Vite (already in use by `frontend/`).
- Host: keep the existing React route as a thin shell that mounts the Phaser game
  (SEO/header/footer/account UI stay in React; the game itself is Phaser).
  Every in-game button, menu, dialog, and HUD element is rendered INSIDE the
  Phaser game frame — never as fixed DOM/React buttons layered above the canvas.
- Game logic: a pure, framework-free TypeScript core (no Phaser/React imports),
  deterministic, with RNG injected via an optional `rand` parameter, so every
  rule is unit-testable. Phaser is a thin presentation layer over this core.
- Testing: match the repo's Jest setup (or Vitest if you justify it); keep the
  existing engine tests' spirit — numeric/rule behavior is pinned.

## Resolution & responsiveness (must NOT be a fixed 700×550 window)
- Fully responsive, dynamic sizing. The game must scale cleanly across phones,
  tablets, laptops, and desktops, in portrait and landscape.
- Use Phaser's scale manager with letterboxing/zooming that preserves a design
  resolution while reflowing UI. Design for a 16:9 safe area and provide a
  portrait layout for phones.
- All text and UI must remain legible at any viewport; tap targets ≥ 44×44 px.
- All game UI lives inside the game frame. The game is a self-contained "app
  window" like the original Flash movie: menus, action buttons (attack/
  technique/block/row), the turn-order queue, the health/MP tray, dialogs, and
  pop-ups are all drawn inside the Phaser canvas and scale with it — nothing is
  a fixed element floating over the top of the game.

## Platforms
- Desktop web (mouse + keyboard).
- Mobile web (touch: tap, swipe, long-press as appropriate).
- PWA: installable, works offline, loads fast on repeat visits (service worker,
  cached assets). Account features degrade gracefully offline.

## Art direction (locked)
- Stylized, animated 2D (hand-drawn or vector cartoon) — NOT photorealistic.
  Rationale: realistic gore is impractical and off-brand, and animated styling
  reads better at small mobile sizes and during fast combat.
- Combat violence is conveyed through impact effects (hit sparks, screen shake,
  damage floaters, knockback), not blood/gore.
- Original character designs for each gladiator class; original UI chrome,
  icons, and backgrounds. Cohesive color palette and lighting across scenes.
- Deliver sprites as texture atlases/spritesheets with a documented asset budget
  that keeps initial load reasonable on mobile.

## Audio (locked)
- Use royalty-free stock audio from reputable sources (e.g. OpenGameArt, Pixabay,
  Freesound) with clear per-file license + attribution recorded in an
  `ASSET-LICENSES.md`. No copyrighted music or sound from the reference or from
  commercial tracks.
- Original or stock SFX for hits, blocks, skills, victory, defeat; ambient arena
  crowd; and a loopable menu/battle music track. Keep a global mute toggle and
  respect `prefers-reduced-motion` for screen shake.

## Core mechanics (match the reference's functionality)
Implement the reference's systems at feature parity, replicating the underlying
rules, formulas, stat caps, and numeric relationships as closely as possible
(they are functional and not copyrightable). Names, text, and presentation must
be original. At minimum:

**Character & attributes**
- Character creation: a gender/background choice that grants a starting stat
  bonus, appearance customization, and naming for the team and the gladiator.
- Six core attributes — Strength (damage), Dexterity (accuracy/crit), Speed
  (turn order), Defense (mitigation/evasion), Vitality (HP), and Charisma
  (Morale abilities) — each driving derived stats (HP, MP, damage range, armor).

**Anatomical combat model**
- Turn-based, speed-ordered combat with a visible turn-order queue.
- Each fighter's body is split into six targetable zones — head, torso, left
  arm, right arm, left leg, right leg — each with its own health pool.
- Per-zone armor layer: damage depletes that zone's armor first, then its
  flesh. Destroying a zone has consequences (head/torso = fatal; arm = drop
  weapon or shield; legs = melee disabled).
- Three attack precision tiers (weak/medium/strong) trading damage for hit
  chance.
- Active defense via shield blocking (block chance + block value).
- A Morale/MP resource that gates skills, plus a way to spend it and a way to
  restore it (showmanship) as an in-combat tactical lever.
- A post-battle "crowd's verdict" choice (mercy vs execution) with different
  rewards (XP/MP growth vs extra loot).

**Weapon-defined play styles & skill trees**
- Five play styles defined by weapon loadout, each with its own skill tree:
  spear-and-shield support, shield-and-one-hander protector/tank,
  net-and-trident controller/thrower, dual-wield burst attacker, and
  two-handed heavy hitter. Use ORIGINAL class and skill names — do not reuse
  the reference's names.
- Skills include strikes, multi-hit combos, ranged throws, guards/shields,
  buffs, debuffs, and heals, unlocked by spending a point pool earned on
  level-up.

**Out-of-combat facilities**
- Roster/school screen to manage gladiators, gear, and loadouts (limited slots).
- Attribute + skill allocation screen (spend and reset points).
- Blacksmith: craft/upgrade gear with quality multipliers and random bonuses,
  consuming gold and metal materials.
- Shop: rotating, tiered equipment stock that scales per city.
- Recruit: hire new gladiators of varying starting stats and level.
- Infirmary/rest: heal injuries and restore HP between fights.

**Campaign & progression**
- A world map of cities unlocked in sequence by rank; each city has a coliseum
  with a ladder of opponent teams plus shops and a recruit facility that scale up.
- Gold, XP, and loot rewards; a fame/rank ladder; meta unlockables.

You may add new systems or smooth rough edges, but the reference's loop
(recruit → gear → train → fight → heal → climb) and the body-part combat model
must be fully present and feel like it. When in doubt, the reference's
behavior wins; its text never does.

## Playability improvements (all required)
- Battle speed controls and an auto-battle / skip option.
- Guided tutorial / onboarding for first-time players.
- Tooltips and previews everywhere a decision is made (stats, skills, upgrades,
  equipment, training effects).
- Smarter enemy AI and a tuned difficulty/balance curve.
- Undo and confirmation on consequential actions (purchases, dismissals).
- Meta progression: unlockables and/or achievements that reward long-term play.

## Persistence (accounts + cloud saves, done efficiently)
- Users can create/log into an account and keep their progress (gladiators,
  gear, gold, fame, unlocks) across devices.
- Be cost-efficient: store each user's save as a single compact JSON document
  (follow the repo's existing DynamoDB "Simple" public-data convention where it
  fits). Autosave on meaningful changes, debounced; avoid write amplification.
- Offline-first: persist locally (IndexedDB or localStorage) and sync/merge when
  online; never destroy local progress due to a network failure.
- Guests can play immediately with local saves and optionally link to an account.

## Accessibility (required)
- Full keyboard play for core loops; visible focus states.
- Screen-reader-friendly menus and status via ARIA/live regions where feasible.
- `prefers-reduced-motion` honored (disable/reduce screen shake and flashes).
- Colorblind-safe palette (do not rely on color alone to convey state).
- Configurable text size and a high-contrast option.

## Performance & quality bar
- 60 FPS target on a mid-range mobile device; no long main-thread stalls.
- Efficient asset loading (atlases, lazy scene loading); measured initial-load
  and time-to-interactive budgets that you report.
- No console errors, no memory leaks (destroy Phaser objects on scene teardown).
- Unit tests for the pure game core; integration smoke tests for the main loop.
- TypeScript compiles with no errors; lint passes.

## Phased delivery plan (with gates — do NOT build everything in one pass)
Deliver in phases. At the end of each phase, stop for review/approval before the
next. Each phase must leave the game playable (no giant "big bang" that only
works at the end).

- Phase 0 — Spec: play the reference, write `COLOSSEUM-SPEC.md` (functional
  spec in your own words) and a short tech/asset plan. Gate: spec approved.
- Phase 1 — Foundations: project scaffold (TypeScript + Phaser + Vite + strict
  config), pure game core with data model (gladiators, classes, stats,
  equipment, economy), RNG-injected deterministic engine, Jest/Vitest harness,
  and the thin React mount replacing the old page. Gate: core unit-tested and
  the route renders an empty playable shell at /colosseum.
- Phase 2 — Vertical slice: one weapon style / class, recruit → gear → train →
  fight → rewards loop, end-to-end, with placeholder art and stock SFX. Gate:
  the loop is fun and runs on desktop + mobile.
- Phase 3 — Content & balance: all five weapon-style skill trees, per-zone armor
  and equipment slots, blacksmith/shop/recruit/infirmary facilities, the
  multi-city campaign map with rank-gated coliseums, smarter enemy AI, and a
  balance pass. Gate: full management loop at feature parity with the reference.
- Phase 4 — Meta & onboarding: tutorial, tooltips/previews, auto-battle and
  speed controls, undo/confirmations, achievements/unlocks. Gate: first-time
  player experience is smooth.
- Phase 5 — Platform & accessibility: responsive/portrait layout hardening,
  touch tuning, PWA/offline, keyboard + screen-reader + reduced-motion +
  colorblind support. Gate: accessibility checklist passes.
- Phase 6 — Persistence & ship: accounts + cloud saves (offline-first sync),
  final art/audio pass, performance pass, QA, deploy to sthopwood.com/colosseum
  via the existing Netlify setup. Gate: production-ready.

## Deliverables per phase
For each phase, produce: working code, tests, a short written summary of what
changed, any new dependencies (with justification), updated
`ASSET-LICENSES.md` if audio/assets were added, and a list of known issues or
follow-ups. Keep commits small and descriptive.

## Definition of done (final)
- The game is live at sthopwood.com/colosseum and runs on desktop, tablet, and
  mobile.
- The full reference-matching management loop is present, original, and polished.
- All playability and accessibility improvements are implemented.
- Accounts + cloud saves work and survive across devices; offline play works.
- Tests pass, TypeScript compiles cleanly, and there are no console errors.
- Every asset's license is recorded; nothing in the project is copied from the
  reference game.

## Current status (2026-09-01)

Phases 1–6 are implemented and verified in `master`:

- Pure, framework-free TS core with a deterministic, RNG-injected engine — 61
  Jest tests pinning the numeric rules (stat caps, HP split, hit resolution,
  blocking, skills, economy, battle loop).
- Phaser presentation layer (thin React shell mounts the canvas) with the full
  management loop: hub → world map → city facilities (coliseum/shop/slave
  market/blacksmith/infirmary) → recruit → gear → train → fight → rewards.
- Five weapon-defined skill trees, a 10-city fame-gated campaign, persistent
  wounds + infirmary, smarter enemy AI, and the post-battle verdict.
- Onboarding (tutorial), achievements, tooltips/previews, auto-battle + speed
  controls, undo/confirmations.
- Accessibility: keyboard nav + focus ring, ARIA live region, reduced-motion,
  high-contrast and text-size options, colorblind-safe cues, PWA service worker.
- Offline-first cloud saves (single JSON per user via the DynamoDB "Simple"
  convention), debounced autosave, local-always-wins merge.

Assumed complete (outside the game's code): the Projects catalog refactor that
unblocked the production build, and the Netlify deploy to sthopwood.com/colosseum.

## Next steps (remaining to reach the full definition of done)

Progress as of 2026-09-02:

1. **Final art/audio pass** — PARTIAL. Original vector sprite art is in place:
   `game/assets/art.ts` + `game/assets/textures.ts` render five original,
   flat-shaded gladiator figures (one per weapon style) and an original arena
   backdrop, preloaded in `BootScene` so scenes never flash `__MISSING`
   placeholders. `ASSET-LICENSES.md` records provenance and the asset budget.
   Audio remains the original synthesized WebAudio SFX (license-free); a stock
   audio intake manifest in `ASSET-LICENSES.md` defines how to layer licensed
   royalty-free files later. Remaining: actually source + record stock SFX/music,
   and richer animated atlases + original menu UI chrome if desired.
2. **Performance pass** — DONE. The game + Phaser are lazy-loaded behind a
   "Play" gate (`Colosseum.jsx` dynamic-imports `./game` on tap), and Phaser is
   split into its own `phaser-*.js` vendor chunk via `vite.config.js`
   `manualChunks`. Measured: Colosseum route chunk 1.81 kB (was ~1.43 MB);
   Phaser chunk 1,387 kB / 371.5 kB gzip, fetched only on demand. Still open:
   a real-device 60 FPS measurement.
3. **QA / ship gate** — PARTIAL. `npm run typecheck`, 61 Jest tests, and
   `npm run build` (Vite + sitemap) all pass; a browser smoke test confirmed the
   gate → boot → tutorial → battle flow with zero console errors. Remaining:
   real phone/tablet verification (portrait + touch) and a formal memory-leak
   profile (scene teardown is already reviewed: window keydown listener removed
   in `BaseScene.shutdown`, cloud timer debounced/cleared).
4. **Cloud-save end-to-end** — CODE VERIFIED, LIVE TEST OPEN. `cloudLoad`/
   `cloudSave` follow the DynamoDB "Simple" convention (marker + delete-then-POST,
   one record per user) and save round-trips are unit-tested. Live two-device
   verification (sign-in → save on A → load on B + offline fallback) needs real
   credentials and is a manual follow-up.
5. **Balance & content polish (optional)** — NOT STARTED. Multi-fighter teams
   (3v3, Protect + team skills, roster selection) and a difficulty/stat-curve
   tuning pass remain future work.
