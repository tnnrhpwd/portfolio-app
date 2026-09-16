# Frontend UI — Design records — dated UI passes

Part of the [frontend UI standard](./FRONTEND_UI_STANDARD.md), which indexes the whole set.
The section numbers are the standard's own and were not renumbered when the file was
split, so this file carries **§11.x**. §1–§4 and §10 stay in the hub; §5 is in `UI_LAYOUT.md`; §6–§9 in `UI_COMPONENTS.md`.

---


> Moved out of the platform plan doc on 2026-09-16, when it became a pointer file for
> agents ([`agent.md`](../implementation/agent.md)). Section names are the reference
> here — no chapter numbers.

### 11.1 Twelfth audit pass — responsive & colour modes (2026-09-12)

Found by measuring the Dream board across 280→1920px in light + dark and under
`prefers-reduced-motion` / `prefers-contrast`. Every one of these is a *page-wide*
defect that had nothing to do with the board.

- ✅ **`prefers-contrast: high` was dead code — everywhere on the site.**
  `prefers-contrast` accepts `no-preference | less | more | custom`; **`high` is not
  a valid value** (it was a draft value that shipped). So all five blocks that were
  meant to provide high-contrast support — `index.css`'s token overrides and its
  `--focus-outline: 4px solid`, plus `App.css`, `ErrorBoundary.css`, `Pay.css`,
  `Support.css` — had never applied for anyone. Verified in Chrome:
  `matchMedia('(prefers-contrast: high)').matches === false` while `more` matches.
  All six blocks (incl. DreamBoard's) now use `more`, and the effect is confirmed:
  `--text-color-accent` darkens (`#4a4a4d` → `#2d2d2e`), the focus outline becomes
  `4px solid`, `--bg-1` snaps to `--white0`.
- ✅ **`.plans-shell` overflowed** every viewport under ~364px. It used
  `repeat(auto-fit, minmax(320px, 1fr))`, and a bare px inside `minmax()` is a hard
  track **minimum** — so on a 320px phone the shell's track (320px) was wider than
  the 276px it had, and the whole page spilled ~44px sideways. Now
  `minmax(min(320px, 100%), 1fr)`. Note the failure mode: it *clipped* rather than
  scrolled, so `document.scrollWidth === clientWidth` and a normal overflow check
  reported "fine". The probe that catches it compares every descendant's
  `rect.right` against its container's.
- ✅ **The three-tab view switcher didn't fit a phone** — `.plans-switch` is an
  inline-flex stadium pill whose three tabs need ~300px, so adding the 🌟 Board tab
  pushed the page sideways below ~344px. Below 400px it now drops the enclosing pill
  and the tabs become separate pills in a wrapping row, the same shape `.plans-tabs`
  already used.
- ℹ️ **Verified, not changed:** text contrast is AA-or-better in all four
  combinations for every text-on-plane pair on the board (light 16.1 / dark 11.4 for
  the title; the accent-tinted vision line is the tightest at 4.98 in dark, and
  high-contrast lifts it to 12.8). The footer's primary button is the house
  `--text-color-inv`-on-gradient pattern and reads correctly, but a contrast checker
  cannot measure it — the background is a gradient, so it must be judged by eye.


### 11.2 Thirteenth audit pass — the Goals tab (2026-09-12)

Same treatment applied to the Goals list (and the Library list, which shares its
shell). Measured 240→1920px, both themes, all four `prefers-*` combinations.

- ✅ **`.plans-controls { grid-column: span 2 }` created an implicit grid column.**
  `.plans-shell` is a single-column grid, so `span 2` made the browser invent a
  second track; the shell's *content* ended up 655px wide inside a 386px box — 269px
  of spill on the Goals and Library views at 430px. It **clipped**, so
  `document.scrollWidth > clientWidth` was `false` and a normal overflow check said
  "fine". Base rule is now `grid-column: 1 / -1`, with
  `@media (min-width: 769px) { .plans-switch { grid-column: 1 } .plans-controls { grid-column: 2 / -1 } }`.
- ✅ **Same `minmax()` px-floor bug as the shell, second and third instances.**
  `.plans-goal-grid` used `minmax(300px, 1fr)` (+24px spill at 320px). Both grids now
  use `minmax(min(<n>px, 100%), 1fr)`. **Rule: never put a bare px inside `minmax()`
  in a grid template that has to fit a phone.**
- ✅ **Tap targets were 22×22px** — `.plans-goal-check` and `.plans-icon-btn`, below
  WCAG 2.5.8's 24×24 minimum, and at that size genuinely awkward with a thumb. New
  `--plans-ctl-size: calc(var(--nav-size) * 0.66)` (≈32px) declared on `.plans-page`.
- ✅ **Goal titles were crushed to 12–24px wide (1325px tall) at 280px.** The title
  is a flex item with `overflow-wrap: anywhere`, so its min-content is ~0 and it
  shrinks past the point of legibility while the `flex-shrink: 0` chip and buttons
  hold their size. Fixed with `flex-wrap: wrap` on `.plans-goal-head` plus
  `min-width: min(100%, 14ch)` on the title; `.plans-lib-head` / `.plans-lib-title`
  got the same treatment.
- ✅ **On a phone the header is reordered into a deliberate two-row layout** (✓ ·
  status · ✎/× on row 1, full-width title on row 2) instead of a squeeze. Two traps
  here: (1) relying on the generic wrap alone left the two icon buttons dangling
  alone on their own row, which reads as a bug; (2) `order` won the cascade from
  where the media query sat, but **`flex-basis`/`min-width` did not** — they are
  same-specificity declarations, so the block had to be moved *below*
  `.plans-goal-title`'s base rule. Before the move, ≤420px got the two-row layout and
  430–480px got a third layout with the title squeezed to ~161px.
- ✅ **The reduced-motion block stopped animations but not transitions.** It set
  `animation: none` on the animated selectors, so hover/focus/state transitions still
  ran at full speed for motion-sensitive users. Added `transition: none` for 16
  selectors.
- ✅ **Dark-mode muted text on hue-washed panels was 3.89:1** (AA needs 4.5) — it sat
  on `--text-color-accent`, which is tuned for a *plain* page background, and the
  goal/library cards are tinted. New `--plans-muted` token on `.plans-page`
  (defaults to `var(--text-color-accent)`) overridden by
  `.dark-theme .plans-page { --plans-muted: color-mix(in srgb, var(--text-color-accent) 70%, var(--text-color)); }`.
  13 rules switched to it. 3.89 → **5.12**. **Rule: a token tuned for the page
  background needs a lift before it lands on a tinted panel.**
- ✅ **Light-mode group headings were 2.08:1 (mint) and 3.13:1 (pink)** — the raw
  `--fg-mint`/`--fg-pink` are display colours, not text colours. Now mixed toward
  `--text-color`: `color-mix(in srgb, var(--fg-mint) 35%, var(--text-color))` →
  7.95, and `... var(--fg-pink) 40% ...` → 9.38.
- ℹ️ **Measurement gotcha, worth keeping:** Chrome returns `color(srgb r g b)` with
  0–1 floats for `color-mix()` results but `rgb()` with 0–255 for plain values, so
  the probe must handle both — and translucent layers must be **composited with
  alpha** before the ratio is computed, or it reports false failures
  (`.plans-info-note` measured 2.29 this way, actually 6.26).
- ⚠️ **Found and reported, deliberately not fixed: goal descriptions never render on
  `/plans`.** `workspaceController.toListEntry` omits `content` (only `toFullEntry`
  has it) while `workspaceGoalToItem` maps `description: entry.content`, so the field
  is permanently `''`. Confirmed by round-trip: a PUT with `content` returns
  `contentLen: 0` from the list endpoint. Including it would change the list payload
  contract (size + shape), so it needs a decision rather than a drive-by edit. Cheap
  fix if approved: include `content` truncated to ~200 chars in `toListEntry`.
- ⚠️ **Cover orphans (known, not fixed):** replacing a goal's cover leaves the
  previous S3 object behind, and deleting a goal never touches its cover. The upload
  path returns a `recordId` so a future cleanup job (or delete hook) can release the
  counted bytes.
- ⚠️ **Presigned upload is still broken:** the bucket has no CORS rule allowing the
  app origin, so the preflight fails and the browser `PUT` never happens — which is
  why cover upload uses `POST /api/data/upload-cover` instead. Restoring the presigned
  path needs a bucket CORS rule.

---


### 11.3 Fourteenth audit pass — the admin console (2026-09-12)

Surfaced while rebuilding `/admin/*` to the service-page standard (§5.7).

- ✅ **`position: sticky` never worked anywhere on the site.** Every service-page toolbar
  (`.sd-bar`, `.plans-bar`, and the new `.admin-head`) is declared `position: sticky`, but
  `App.css` clamped the app root with `overflow-x: hidden` — and `hidden` on one axis
  resolves the other to `auto`, so `.App` became a **scroll container that never scrolls**
  (it has `min-height`, so it grows with its content). A sticky descendant then offsets
  itself against that box instead of the viewport and never engages. Measured on `/simple`
  before the fix: `.sd-bar` moved 55px → **-392px** while the window scrolled 447px.
  `Fit.css` and `Plans.css` had each *noticed* this (Fit's comment refuses to be sticky
  over it; Plans' comment avoids the same clamp on `.plans-page`) — but the root cause was
  never fixed, so `/plans`' toolbar was sticky in name only. Fixed with
  `overflow-x: clip` (after the `hidden` fallback, which old browsers still get); `clip`
  does not create a scroll container. Both `.sd-bar` and `.admin-head` now hold at
  `--nav-size` exactly, and an A/B of `scrollHeight` / landmark offsets across 10 pages is
  byte-identical, so no page layout moved.
- ✅ **The admin console is a service page now** (`pages/Admin/`): one flat surface, a
  sticky head carrying the route's view name + a live readout + the view tabs, then dense
  panels as planes of color. `Admin.css` was rewritten (2919 lines → ~1000, with the dead
  `.admin-hero`/`.admin-orb`/`.admin-page` legacy and the hand-rolled visitor-map styles
  gone). New `components/Admin/AdminPanel.jsx` (a panel) and `Admin/adminBarContext.js`
  (`useAdminReadout`, so a view publishes its headline numbers into the toolbar).
  `CollapsibleSection` now renders as a bare disclosure (a label + caret, no card) rather
  than a bordered wrapper around already-colored panels, and is a real `<button>` with
  `aria-expanded`/`aria-controls` instead of a `role="button"` div.
- ✅ **Two `.admin-table` definitions were racing.** `pages/Admin/Admin.css` and
  `components/Admin/ScrollableTable.css` (used by `/deepstorage`) both styled
  `.admin-table`, `.admin-search` and `.table-scroll-container` globally, so whichever
  stylesheet loaded last won. The admin console's copies are now scoped to
  `.admin-surface`, which settles it without touching Deep Storage.
- ✅ **Six transactional emails shared one hand-copied layout.** `services/emailTemplates.js`
  repeated a `<style>` block, header and footer per template (810 lines). It is now one
  `renderEmail()` builder (table-based shell, inline structural styles, solid-color
  fallbacks under every gradient, `prefers-color-scheme` class overrides, a preheader) with
  the six templates as content — 810 → ~560 lines. Two real defects fell out of the
  rewrite: the password-reset request details (IP, device, browser) and the bug-report
  title/resolution were interpolated **unescaped**, so an `&` or `<` in a user-agent string
  corrupted the HTML — everything dynamic is now escaped. The footer also links
  `/settings#notifications` (where the preferences actually live) and `/support`.
- ⚠️ **Not verified against a real inbox.** The templates were rendered in Chrome (light and
  dark) and inspected, not sent through Gmail/Outlook/Apple Mail. Table layout + inline
  styles + solid fallbacks are the mitigations, but one real send per template is still the
  only proof.
- ⚠️ **The admin console's data states were not eyeballed.** The only browser session
  available is the shared guest account, which is deliberately not an admin, so every admin
  fetch 403s. Structure, the shell, all nine routes, the 320→1366px overflow sweep, light +
  dark and the stickiness were verified; the populated tables, charts and forms were not.


### 11.4 The four Special views on every screen size (2026-09-12)

`/admin`, `/admin/map`, `/admin/reviews` and `/admin/rankings` are the views a helper
actually opens, on whatever they have to hand. Measured at 320/360/390/414/480/640/768/
1024/1440/1920/2560 in both themes: no page-level horizontal overflow anywhere, and the
sticky head — the one thing that costs height on *every* scroll — went from **192px to
115px** at 320px wide.

- ✅ **The head was a quarter of a phone screen.** At 320px it was 192px of a 720px
  viewport, permanently, because: the readout chips wrapped onto 2–3 rows, the
  "↗ View site" button took a full row of its own (the ≤768px rule makes
  `.admin-bar-actions` 100% wide), and "Signed in as …" ran the full width. Now the chips
  are a single horizontally-scrolling row, the link returns to its natural width and drops
  the label below 420px (the logo above it already goes home, and `aria-label` carries the
  name once `display: none` takes the text out of the accessible tree), and
  "Signed in as" is the first thing to go on the narrowest screens. Chips also moved from
  `--text-color-accent` to `--plane-muted` (the contrast work in `AUTOMATION_SECURITY.md` → *Making the Special tier actually reachable*).
- ✅ **The KPI readout was one card per row on a phone.** `minmax(min(170px, 100%), 1fr)`
  against ~255px of content width gives one column, so six numbers cost ~700px of scroll.
  A phone floor of 120px gives two, and the portrait-kpi rule had to be scoped to
  `(min-width: 641px)` — it sits *later* in the file, so unscoped it silently outranked the
  phone block and put the single column back.
- ✅ **The two wide tables stop being tables below 640px.** Six and seven columns don't fit,
  and the failure was worse than cramped: the reviews Content column was 74px, so 120
  characters wrapped into a ~20-line block and **one row was taller than the screen**.
  Each row is now a labelled block — `thead` hidden, `td` a `9ch | 1fr` grid, the field name
  from `::before`. The labels live in `Admin.css` in column order and must be kept in step
  with `Reviews.jsx` / `VisitorMapPage.jsx`, which is why both carry a pointer comment.
  Zebra stripes moved to the *even* rows: on a block this tall, an odd-row tint reads as a
  divider between reviews. `admin-table--stacked` is opt-in so the admin-only tables
  (`/admin/users`, `/admin/bugs`, `/admin/data`) keep scrolling sideways until someone
  gives them the same treatment.
- ✅ **The map's date inputs were unreachable at 320px.** `.date-filter` was a wrapping flex
  row; the second `input[type=date]` is wider than the panel, and `.admin-panel`'s own
  `overflow: hidden` *clipped* it — the field could not be tapped. It is a
  `label | control` grid below 640px now, with `min-width: 0` on the controls.
- ✅ **`/admin/rankings` lost its visit counts at 320px.** `.stat-row` is
  `space-between` with a `nowrap` count; a long path pushed the count past the panel edge
  and the panel clipped it. `.stat-row > span { min-width: 0; overflow-wrap: anywhere }`.
  Same class of bug as the date input: anything that can't shrink will be clipped rather
  than reported when its container hides overflow.
- ✅ **`11.390175819396973 MB stored`.** `formatBytes` divided straight through in both
  copies (`backend/constants/pricing.js`, `frontend/src/constants/pricing.js`). Now one
  decimal and no trailing `.0` — `11.4 MB`. It was noise in a KPI card at any width and
  overflowed a phone's card outright. ⚠️ The dashboard's figure comes from the **server**, so
  this needs a backend restart to appear. `frontend-test-suite` 1341 ✅, backend 664 ✅.
- ⚠️ **Not verified visually at the end of this pass.** The shared browser surface collapsed
  to 1×19px mid-session, so the final checks are geometric (panel-relative overflow scans,
  `::before` label order, cell widths, row heights, head heights, column counts) plus the
  contrast measurements from `AUTOMATION_SECURITY.md` → *Making the Special tier actually reachable* — not eyeballed screenshots. Worth a look on a real
  phone.

---


### 11.5 The addon follows the colour scheme, and is a service workspace now (2026-09-13)

The website gained a site-wide colour scheme (`e594343`); the addon had none — three
hardcoded dark palettes (`#0d1117` GitHub-dark in the dashboard, Catppuccin Mocha in the
calibration window, a fixed cyan marker in the eye overlay). Both halves of that gap are
closed in one pass: the addon now follows the scheme, and its dashboard is rebuilt as the
**service workspace** the UI standard (§5.7) asks for rather than a sidebar + hero card
layout.

**The scheme, in one stored value.** `settings.json` → `webapp` gains `colorScheme`
(`ocean` … `custom`), `colorMode` (`system` | `light` | `dark`) and `customColors`
(`{accent, primary}` — the CSS token names, deliberately not the visitor's
Primary/Secondary words). That is the same block the site's chat panel already reads and
writes its own settings through, so the two surfaces have **one** value to agree on
instead of two:

- `renderer/appearance/appearance.js` — the scheme list (a **mirror** of
  `frontend/src/utils/scheme.js`, and `appearance.test.js` asserts the two still agree on
  ids, labels, hues *and order*, so drift fails the addon's test run), plus the resolve /
  apply / query-string helpers. Pure and headless-requirable.
- `renderer/appearance/appearance.css` — the derivation, ported from `index.css`:
  two identity hues → `--scheme-*`, accents re-pinned per mode (0.52 light / 0.76 dark),
  backdrops with pinned lightness, `neutral` chroma off in **both** mode blocks, custom
  capped rather than replaced. The addon's own surface tokens (`--bg`, `--panel`,
  `--text`…) now live here too, per mode.
- `main.js` reads the appearance when it opens a window and puts it on the window's
  **URL**, so every window paints correctly on its FIRST frame instead of flashing the
  wrong mode while a fetch to the local server is in flight; the window's
  `backgroundColor` follows the mode as well.
- The dashboard's **Settings → Appearance** panel is the picker (built from the shared
  list, so it cannot offer a scheme the stylesheet has no rule for), applied on change and
  written back read-modify-write — `PUT /api/settings` **replaces** the whole `webapp`
  block, so posting a delta would wipe the user's chat settings, models and agents.
- `frontend/src/utils/schemeSync.js` is the site's half: on an explicit pick it hands the
  scheme to the addon. Not on load — pushing from `initScheme()` would probe the addon on
  every page view for everyone who has not installed it, and would overwrite an addon-side
  choice. The **mode** is deliberately not pushed (the site's light/dark is how *this*
  device is being looked at; the addon has its own "follow Windows"), and failure is
  silent because the addon is optional. The custom pair crosses a vocabulary boundary here
  and nowhere else: the site's `primary` (dominant) is the addon's `accent`.
- The **eye overlay is deliberately outside the mode axis**: it floats over the *desktop*,
  not over the addon's surfaces, so a HUD that went light with the mode would vanish
  against a white page. It keeps a fixed dark shell and only its gaze marker follows the
  scheme.

**The dashboard is a service workspace.** Glass over a room, ported token-for-token from
the site's `.service-room` (two layers at two speeds, `--room-mix` as a *mix* rather than
an alpha so the neutral page never shows through as grey, and radial gradients instead of
`filter: blur()` — a gradient falling to transparent *is* a blur). The sidebar is gone:
the view tabs are a scrolling row of pills inside **one floating glass head** that carries
the surface's name, its live state, a four-chip readout and the one action
(`Open Web App ↗`, on the scheme's ramp). The head is deliberately **not sticky** (§5.7's
console trade: sticky would claim ~150px of every screen and force an opaque base). The
Status view's four same-shaped panels are a dense `auto-fit` grid (1 col ≤420px, 2 at
768, 3 at 1024, 4 at 1600); data-heavy views stay single-column, because a 320px column of
console output is worse than a taller screen. Rows are separated by a **tone**
(`--glass-edge`), controls stay **solid** (never glass), `button.primary`/`.danger` keep
their semantic green/red — an alarm that follows the decor is not an alarm — and the
scheme owns the chrome: head action, tabs, focus, input edges, the room. Added
`prefers-reduced-motion` (room + pulses + transitions) and `prefers-contrast: more` blocks;
the gaze heatmap canvas resolves `--accent` to sRGB through a 1×1 probe at draw time,
because a canvas cannot read a custom property and `oklch()` cannot go into `rgba()`.

**Measured, not eyeballed** — 12 schemes × 2 modes × 12 text pairs, compositing the alpha
stack before computing each ratio:

- ✅ **0 failures (worst 4.6:1)** after three real fixes. (1) An ink printed on a wash of
  *its own hue* loses ~1.5 stops — the accent chips measured 2.8–3.7:1 — so the accent
  badges/tab label now use the site's `--plane-ink-*` recipe (`--accent-in-text`). (2) The
  status chip washes dropped 15% → 10% (green was 4.15:1). (3) The light-mode
  green/yellow/red inks darkened (4.43 / 4.28 / 4.54 → 5.82 / 5.85 / 4.65). Body text
  15.2:1, muted-on-sunken 5.23:1.
- ✅ **No page-level overflow and no silent `#content` scroll** at 320/360/420/640/768/
  1024/1280/1600 in both modes; head 163px at ≤420 (three rows: title+state, chips, tabs)
  and 91px from 768 up.
- 🐛 **A wide button group overhung a narrow grid track** (`.actions` is `flex-shrink: 0`
  by definition) and `#content` *scrolled* it sideways rather than reporting overflow —
  the same "clips rather than complains" family as §11.2. Fixed with `flex-wrap: wrap` on
  `.row`, verified by comparing every descendant's right edge against its pane.
- 🐛 **Choosing Custom jumped the whole app to the default's hues.** Seeding must come from
  the scheme being *replaced* (the site seeds it the same way), so `seedCustomFrom` exists
  and is unit-tested; without it, picking Custom on Sakura flashed cyan.
- ⚠️ **`settings.json` is a trap for external tooling.** Round-tripping it through
  PowerShell (`ConvertFrom-Json | ConvertTo-Json | Set-Content -Encoding UTF8`) writes a
  **BOM**; the addon server's `JSON.parse` then throws, falls back to `{}`, and the next
  write it makes (`persistAuthToken`, which writes only `{cloudAuth}`) **wipes every other
  key**. That happened here and cost a restore from a byte-exact backup. Use `node -e` +
  `JSON.stringify` (no BOM), and back up first.
- ⚠️ **Not opened as a real Electron app in this pass.** The dashboard was driven in
  Chromium with the preload bridge stubbed (`window.simpleDashboard`), which exercises the
  shell, the head, the tabs, the grid, all 12 views and the picker's write path (verified
  against the running addon server on `127.0.0.1:3001` — the appearance really persisted to
  `settings.json`, and the read-modify-write left `theme`/`agents`/`deviceId` intact). The
  Electron-specific pieces — window `backgroundColor`, the overlay's transparency, calibrat-
  ion's fullscreen geometry — are unverified by eye. Screenshots were also unavailable at
  the end (the shared browser surface collapsed to 6px wide, §11.4's hazard), so the final
  checks are geometric plus computed styles. Worth one real run of the addon.

- ✅ **Released as v1.0.48** (build #48, tag `addon-v1.0.48` → `ec04268`), then **v1.0.49**
  (build #49, `addon-v1.0.49`) for the follow-up that removed the dashboard's ☰ hamburger
  menu. The hamburger and its dropdown were a fallback for the old left sidebar; once the
  view tabs moved into the head they duplicated it exactly, so both went — along with their
  CSS and the click-outside handler. **Because the tab row is now the only navigation, its
  overflow had to stop being hidden**: it carries a thin themed scrollbar, which is what lets
  a mouse user on a narrow window reach a tab that scrolled out of view. The row's id was
  renamed `#sidebar` → `#view-tabs`, which is what it has actually been since the overhaul.
  (The v1.0.48 attempt was blocked first, and the reason is worth keeping: `release.js`
  runs its own preflight and **refuses unless `git status --porcelain` is empty** — at the
  time, this shared working tree held **25 uncommitted files from other in-flight
  sessions** (`pages/Simple/**` — Market, Net, Plans, DreamBoard, GoalDetail, SimplePage —
  `components/SimpleAddon/*.css`, `frontend/src/index.css`, `Projects/Halfway/Halfway.js`,
  `FRONTEND_UI_STANDARD.md`, `netlify.toml`) with nothing under `simple-addon/`. Committing
  or stashing another session's work to get a build out was not this pass's call, so the
  code was published first (`42c6345`) and the release waited; once that work landed, the
  tree was clean and `node release.js` ran normally. **If it is ever blocked again, the
  answer is to let the other work land — not to `git add -A`**, because the preflight exists
  so a tagged build cannot be cut from a state nobody has committed.)
- ⬜ **Still to confirm by eye: the packaged addon.** CI builds and publishes the release;
  the running install picks it up on its next update check. Nobody has opened the built
  v1.0.48 window in this pass (see the note above about the stubbed bridge).

---


### 11.6 A renderer dev preview, and the bug it caught on its first run (2026-09-13)

Seeing a dashboard change used to mean launching Electron (`npm run dev`, which kills the
installed copy) or building and publishing. `npm run addon` (from the repo root; `npm run
preview` inside the package) now serves `renderer/` over loopback and opens a browser, with
**live reload** on any edit under `renderer/`.

- **Why a tool is needed rather than just opening the file.** Each page calls into the
  preload bridge at module scope, so in a plain browser the *first* `window.simpleDashboard.…`
  throws and every line after it in the page's script never runs — the page looks broken
  rather than unstubbed. `scripts/dev-preview.js` injects a shim **ahead of the page's own
  scripts** (that ordering is the whole point) and watches the tree with
  `fs.watch({recursive:true})` + SSE for the reload. No dependency, no polling, no build.
- **It is honest about what it is not.** Bridges are Proxies: `on*` returns an unsubscribe,
  collection-returning calls resolve to `[]` (so lists render their empty state instead of
  crashing on `.map`), everything else to `{}`. So IPC-backed panels are empty — device
  lists, camera previews, gaze streams, Python status — while anything that goes over the
  local HTTP server is **real**, because the addon's CORS allowlist accepts any loopback
  origin. The tab title is prefixed `[dev]` and the console says which half is stubbed.
  Nothing under `renderer/` references the shim; the packaged app still loads those files
  straight from disk.
- 🐛 **It found a real bug within minutes.** Against a `settings.json` with no appearance
  keys — i.e. **a fresh install** — `loadAppearance()` assigned the stored value raw, so
  `select.value = undefined` left both Appearance pickers **blank**: it read as "broken"
  rather than "not set yet", and offered a change from an empty state. The stored value now
  goes through the resolver (which supplies the defaults) and `wireAppearance()` paints the
  state in force up front, so the pickers are populated even if the settings round-trip
  never lands. Worth noting the shape of the miss: every test of that picker so far had run
  against a `settings.json` that already *had* values, because the values were put there by
  the same feature — the empty case only appeared when previewing against a clean store.
- ⚠️ Not covered: the preview cannot exercise anything Electron-specific (window
  `backgroundColor`, real transparency, fullscreen geometry), and its shim is not the real
  bridge — a panel that looks right here can still fail on a preload method the real app
  lacks. It shortens the loop for markup/CSS/DOM work; it does not replace one real run.

---


### 11.7 The head's dropper — the webapp's `HeaderDropper`, ported (2026-09-13)

A ☰ at the right of the head opens a drawer containing **every view**, the app-level
actions, and the mode toggle at its foot — the shape of the site's drawer (groups of
links, theme last, pinned with `margin-top: auto`). This is what the user asked for
directly, and it deliberately **reverses** §11.5's "no ☰ nav dropdown" decision: that
removal was about the *page list* being duplicated, so the tab row stays AND the drawer
now carries the same list. Both are legitimate: the tab row moves between views at a
glance, the drawer is the only place that also reaches the actions.

- 🔧 **The trap worth keeping: `#topbar` is a stacking context.** It carries
  `z-index: 10`, so a descendant's `z-index` orders it only against its *siblings inside
  the head* — a `position: fixed` drawer left outside the header would have painted over
  the ☰ and hidden the ✕ that closes it, no matter what `z-index` the trigger was given.
  The trigger, the scrim and the drawer are therefore **all descendants of `<header>`**
  (which is what the webapp does too), ordered 70 / 50 / 60 inside that one context.
  Verified by hit-testing the trigger's centre with the drawer fully open — it resolves to
  the trigger, not the drawer.
- 🔧 **The view list is generated from the tab row**, not written out again: page names,
  order and the set of them live in one place, so a view added to the tabs appears in the
  drawer for free. Each badge is a **mirror** kept in step by one `MutationObserver` per
  badge (classes included, so `on`/`warn`/`err` arrive), rather than a snapshot that would
  freeze at load time. `activateTab()` marks the current view in both lists.
- **Material:** a pane is 84% (`--glass-a`) because it floats over the flat room, which has
  nothing legible to show through it. The drawer floats over the *workspace*, so it keeps
  more of itself (92%) and a scrim dims what is behind: content contributes ~4% of the
  drawer's final colour. Measured with the compositing done explicitly against a
  deliberately hostile backdrop — a bright pane behind the open drawer — the effective
  surface is `#191c22` in dark and `#e9eaec` in light, matching the arithmetic.
- **Verified in the dev preview (§11.6), not by reasoning:** 192 contrast measurements
  (12 schemes × 2 modes × 8 pairs, `oklch`/`oklab` converted by hand because Chromium
  returns the tokens in their authored spaces) — **0 failures, worst 4.50:1**, and that
  worst case is the pre-existing `.tab-btn .badge` pair (`--muted` on `--glass-sunken`)
  mirrored rather than "fixed", since changing it here would make the drawer's badges
  disagree with the tabs'. Plus: open/close by trigger, scrim and Escape (focus returning
  to the ☰ only if it was inside the drawer); `aria-expanded` driving the ☰→✕ morph from
  one attribute; no horizontal overflow 320→1600px; the 17-row drawer scrolling at 560px
  window height with the foot still reachable and the trigger still visible.
- **Details that are easy to undo by accident:** the closed drawer is `inert` (declared in
  the markup, not only toggled from script) — that is what keeps its buttons out of the tab
  order without a hand-rolled focus trap. Each action **delegates** to the control that
  already owns it (`#status-restart-server` et al.) rather than calling the IPC a second
  time, so the disabled state and toast stay in one place, and an action whose result lives
  on a tab takes you to that tab. The `::after` arrow uses `content: '→' / ''`: generated
  content is otherwise announced, so every row would have been read as "Agent, right
  arrow". Two `:focus-visible` rules were **removed** — `appearance.css` already defines the
  addon's single focus ring, and restating it gave these controls a different offset.
- **Mode toggle semantics match the site:** clicking it makes an *explicit* light/dark
  choice and leaves `system` behind, which is why the label is read from `data-mode` (the
  mode actually painted) rather than from `appearanceState.mode`, a value that may be
  `system` and so is not something to invert. Verified both ways: the Settings `<select>`
  follows, and the neighbouring `theme` key survives the read-modify-write.
- ⚠️ Two caveats. The badge pair sits *exactly* at 4.50:1 (AA passes with no margin) —
  inherited, not introduced. And all of this was verified in Chromium with the preload
  stubbed: the drawer is pure DOM/CSS so it should transfer, but the built Electron window
  has not been eyeballed.

---


### 11.8 Service-first pass: the tab row is gone, and the dashboard follows the UI standard (2026-09-13)

The addon asked for two things at once — stop listing the views in the header (the drawer has
them), and bring the dashboard onto [`FRONTEND_UI_STANDARD.md`](./FRONTEND_UI_STANDARD.md)
with §5.7's **service page** rules, which is the section that applies: this is a tool someone
already opened, not a page being sold.

**The head is the toolbar now, and one row of it.** The `<h1>` is the **open view's name**
("Settings", "Recorder & Skills"), not the app's — the console's shape in §5.7, and the tab row
was the thing that used to say where you were. The app's own name moved into the drawer's head,
which also put a stop to the 60px of empty padding that had existed only to clear the ☰/✕.

| | before | after |
| --- | --- | --- |
| Head, desktop | 93–103px (2 rows) | **58px** (1 row) |
| Head, 320px | 175px | **130px** |
| View switchers | tab row + drawer | **drawer only** |

- 🔧 **`VIEWS` is now the single source** for the view list, because the list used to be
  *generated from the tab row* — delete the row without replacing that and the drawer silently
  loses its contents. It also feeds the head's `<h1>` and `setViewBadge()`, so the three can't
  disagree.
- **`setViewBadge(id, text, tone)` replaced** both the `MutationObserver` mirror and the six
  direct `badge.textContent` / `badge.className` writes in the update code. With the tab row gone
  there is no second copy to mirror, so the helper is simply the one place that writes one —
  a wash, some state and less code. (An empty badge is hidden explicitly: a pill with padding and
  no content is a 2px sliver, which is not a thing to rely on.)
- **A trap this pass produced and then disproved:** for a few seconds the console showed
  `Cannot set properties of null (setting 'textContent')` from the two badge writers, at three
  *different* line numbers. Those were artefacts of the live-reload server reloading the page
  **mid-edit** — the file was between my CSS edit and my JS edit, so the old writers ran against
  markup that no longer had `#tab-badge-*`. Re-running both functions against the final file gave
  zero errors. Don't chase a phantom that moves line numbers between reloads.
- **Rows are tonal blocks, not hairlines.** Every `.row` carries `--glass-row` and the
  `border-bottom` is gone (the token the standard names for exactly this). Uniform, **not**
  alternating stripes, and the reason is in the CSS: a `.panel` here holds one to five *setting*
  rows, and alternation would leave the first row unstyled and depend on whether the pane happens
  to open with a heading or a hint.
- **Neutral-grey outlines removed from every container** — list items, the skill summary, the NL
  result, the console, the progress track, both dialogs, the toast and the `pre` blocks. They are
  fills on a pane now. **Coloured** edges were left alone: the standard's own `.foo-error` recipe
  draws one, so an alarm keeps its signal-coloured edge, and controls (buttons, inputs, badges)
  keep their borders because they are objects.
- **Copy:** the Appearance panel's two-line lead paragraph became one hint line
  ("Shared with the web app — one value, both surfaces.") — §5.7 bans a paragraph above a control.
- **Measured, 96 cells** (12 schemes × 2 modes × 4 pairs) on the pane over the room and the row
  over that: **0 failures, worst 4.56:1** (`--text` on a row, cyberpunk/dark). The tonal row costs
  a little headroom against the pane (4.72 vs 14.71 in ocean/dark) because a 4% text wash lifts
  the background toward the text — it passes everywhere, with the thinnest margin in the scheme
  whose room is brightest.
- ⚠️ **Two ways I got that sweep wrong first, both worth avoiding.** (1) I bounded the room by
  compositing `--scheme-accent` at **full strength** and reported a bogus 3.8:1 failure; the halo
  is `color-mix(… var(--room-halo))`, i.e. the accent at **10–12% alpha**, so the bound was ~8×
  too bright. Read the mix percentage out of the token (`--room-mix`, `--room-halo`, `--glass-a`)
  and composite with it. (2) I hoisted `--glass` and `--glass-row` **out** of the scheme×mode
  loop and "found" light mode failing at 1.22:1 — they are mode-dependent, so they have to be
  re-read per mode. Both errors were in the measuring code, not the page, and both would have
  sent me chasing a real-looking regression that did not exist.
- **Verified:** all 12 views driven through the drawer (panel shown, `<h1>` matched its label,
  drawer closed, exactly one row marked current, exactly one panel visible); no horizontal
  overflow 320→1600px; Esc / scrim / trigger still close, focus still returns only if it was
  inside. The `#view-tabs` thin scrollbar that §11.5 added for narrow windows is gone with the
  row — the ☰ is always visible, so no view is ever unreachable now.
- ⚠️ **A deliberate, stated deviation:** §3's `calc(var(--nav-size) * N)` unit is part of the
  *website shell* (it tracks the site's header and font scale). The addon is an Electron window
  with its own palette and scale, so it is not adopted here; what is adopted is the principle —
  one scale, tokens for every colour, and the contrast/tap-target/focus bar. The addon's own
  tokens (`--bg`, `--glass-*`, `--scheme-*`, `--room-*`) are the equivalent, and the scheme
  tokens are already mirrored from the site by `appearance.js` with a test asserting they agree.
- **No test run for this change:** it touches `renderer/dashboard.html` only, and no test file in
  the repo reads it (checked). Running the 38-script `test:unit` chain for a markup/CSS pass would
  be exactly the sweep the repo's instructions forbid.


### 11.9 The sign-in pages follow the colour scheme (2026-09-14)

`/login`, `/register` and `/forgot-password` were still painting the theme's **fixed brand palette**
(`--bg-orange/--bg-pink/--bg-blue/--bg-mint` corners, `--fg-blue`/`--fg-mint` accents) while the rest of
the site aliased those onto `--scheme-*`, so the picker's most-visited pages — usually a visitor's first,
cold load — were the one place the scheme did not show.

- ✅ **Three pages, one change each.** `/forgot-password` is included because it is one link from the
  login card and shares its template: leaving it out would have made stepping into it look like leaving
  the site. All three were already written against those six names, so re-pointing them
  (`--fg-blue`/`--fg-mint` → `--scheme-accent`/`--scheme-primary`; the four corners →
  `--scheme-backdrop-a`/`-b`) converts the page whole. `--fg-orange` is deliberately left alone: orange is
  the alert hue. Same shape as `Pricing.css` / `Projects.css` / `/support` / `/about`.
- ✅ **Backdrops, not tints.** A full-bleed field takes `--scheme-backdrop-*` — the pair that PINS its
  lightness per mode — because `--scheme-*-bg` is calibrated as a tint and a pale identity hue mixed to
  a page-relative lightness goes pale on a *dark* page (see the note in `index.css`).
- ⚠️ **The fallback in `var(--scheme-backdrop-a, var(--scheme-accent-bg))` is load-bearing.** `index.html`
  now paints the stored scheme before the first frame (§11.12), but a visitor with **nothing stored** has
  no id to paint, so the default scheme still only lands when `Header`'s `useEffect` calls `initScheme()` —
  and the same is true of a browser where `localStorage` throws. Without the fallback the whole
  `background` declaration is invalid on that frame and the page flashes with no backdrop at all. With it,
  that frame is the pre-change brand corner.
- ✅ **The primary is the scheme's ramp at a pinned lightness** (`--login-btn-l-a/-b`, 0.46/0.36 light and
  0.80/0.70 dark), because a scheme's identity hues are chosen for contrast *on a page*: white on
  Cyberpunk's yellow at its page lightness does not read. `SimpleCtaBand` borrowed those same numbers for
  its band for a while; the band now wears the page-relative pair (`--scheme-*-bg`, what `/profile`
  wears) instead, so its fill and its ink move together — see the UI standard's band section.
- 🐛 **Tinting the card with its own accent cost the page its worst contrast.** The card had been
  `color-mix(in srgb, var(--fg-blue) 7%, var(--bg-1))`; the links on that card *are* the accent, and an
  ink on a wash of its own hue loses about a stop. Plain `--bg-1` (what `Pricing`'s cards use) fixed it:
  **4.38:1 → 4.84:1** at the worst scheme.
- 🐛 **Both forms greeted every visitor with red-ringed boxes.** `index.css` has
  `input:invalid { border-color: var(--red0) }`, and a `required` field is invalid while it is *empty* —
  so a first-time visitor landed on a form that already looked broken. All three pages now opt out
  (`:invalid` keeps the neutral edge, focus still shows blue) and the red is reserved for a real failure.
- ✅ **The card is a solid plane, not a 55%-transparent film.** Over a *moving* gradient a film takes on
  whatever hue the animation is showing, so the form surface changed colour as you sat on it.
- **Measured, 26 cells** (13 schemes × 2 modes, oklch → sRGB converted in the probe because Chromium
  keeps `oklch()` in computed styles): **0 failures, worst 4.84:1** (aurora/light, accent link on the
  card). Tightest others: muted-on-backdrop 5.27, submit ink on the pinned ramp 6.14 (sunset/dark),
  SHOW/HIDE on the input 4.91. Eyeballed in ocean/light, ocean/dark, cyberpunk/light (the pale-hue stress
  case) and neutral/dark.
- ✅ **The rest of the fixed-palette pages were swept in the same pass** (19 stylesheets): `Chess`,
  `legal` (privacy + terms), `MicTest`, `Music`, `Muse`, `NotFound`, `Pets`, `Polls`, `ResetPassword`,
  `Sit`, `Strip`, `UIMapper`, and `Projects/{Annuities, Ethanol, Fluid, Halfway, PassGen, SleepAssist,
  Sonic}`. Each takes the same six aliases on its page root — they were already written against those
  names, so nothing below them moved. Verified live in both modes on `/music`, `/mic-test`, `/strip`,
  `/sit`, `/privacy`, `/pets`, `/chess`, `/ethanol`, `/fluid`, `/halfway`, `/sleepassist`, `/sonic`,
  `/uimapper`, `/annuities`, `/passgen` and a 404: the backdrop stops resolve to `oklch(...)` at the
  scheme's hue and `--fg-blue`/`--fg-mint` resolve to `oklch(from …)`. `/muse` (gated) and
  `/reset-password` (needs a token) would not render for this session, so those two rest on the
  identical block plus a clean parse of all 19 files.
- ⬜ **Two residues, both deliberate.** (1) `--fg-pink` and `--fg-orange` stay the fixed palette on these
  pages: orange is the alert hue, and mapping BOTH `--fg-mint` and `--fg-pink` onto `--scheme-primary`
  flattens every three-stop ramp — `Chess`, `Fluid` and `Muse` pair all three in one gradient. The
  reference converted pages (`Pricing`, `Projects`, `/support`, `/about`) leave pink alone for the same
  reason. (2) The swept pages' *buttons* keep the shared, un-pinned ramp exactly as those reference
  pages do; only the three sign-in pages pin theirs to a lightness that clears AA.
- ⬜ **Still on the fixed palette:** the shared chrome — `App.css`,
  `components/ErrorBoundary/ErrorBoundary.css`, `components/SimpleAddon/AIWorkflowSettings.css`. The
  chrome (header, footer, switcher, `index.css`) was already being converted next door, so this pass
  deliberately did not touch it.
- **No test run:** the change is 22 stylesheets plus these docs; no test file reads any of them
  (checked). Verified in the running app instead, which is the only thing that can see a gradient.


### 11.10 `/passgen`'s calculator was invisible with reduced motion on (2026-09-14)

Reported as "passgen styling broke" right after the colour-scheme sweep, so the sweep was the first
suspect — and it was innocent. Two things settled that: the diff against HEAD for `PassGen.css` is the
seven alias lines and nothing else, and dropping just that rule at runtime changed **only colours**
(the `.primary-btn` ramp and one input border). The stylesheet was also intact — brace and comment
balance checked across all 22 stylesheets the sweep touched.

- 🐛 **The real bug is a `prefers-reduced-motion` trap.** `.animate-in` has a **base state of
  `opacity: 0` + `translateY(20px)`** and arrives only through `animation: slideInUp 0.8s ease forwards`.
  The reduced-motion block set `animation: none` on it, which reverts the element to its base state — so
  for anyone with reduced motion on, the *entire calculator* (slider, four checkboxes, both buttons and
  the output field) rendered at `opacity: 0`. Reduced motion means no **movement**, not no **content**:
  the block now puts those elements at their resting state (`opacity: 1; transform: none`). Verified by
  A/B: reduced → `1 · none · none`, normal → `1 · slideInUp` (the animation still runs for everyone else),
  and a hidden-element scan over the page goes from 7 to 0.
- ✅ **Audited, not assumed.** Every route was loaded with reduced motion emulated and scanned for
  laid-out-but-invisible elements (`opacity < 0.1`, real box, text or a widget inside): 37 routes signed
  in, plus a static pass over all 33 `animation: … forwards|both` declarations in the codebase — that
  fill only bites when the rule's *base* state is hidden.
- ℹ️ **`/home` was a false positive** — its typed subtitle arrives on a timer (~2.5s), so a 1.1s scan
  caught it mid-flight; it is `opacity: 1` by 4s. **`/muse` is the reference implementation**, its
  reduced-motion block already restoring `opacity: 1; transform: none` for its hero copy and reveals.
  `Profile`, `Pets`, `Annuities`, `Wordle`, `WordleSolver`, `About`, `Plans`, `Hype` and the shared
  components are safe (base state visible, so killing the animation leaves them shown). Muse, and the
  pages the scan could not reach because the dev session dropped mid-sweep (the backend was down —
  `/profile`, `/settings`, `/admin`, `/deepstorage`, `/pay` all redirect to `/login` signed out), were
  covered statically instead.
- ⚠️ **Not touched: `/passgen`'s page root is still unstyled.** Its `.container` rule — background, layout,
  font — is commented out *in the committed file*, and its keyframes with it, which is why the page has no
  gradient behind it while every sibling does. That is a separate, bigger call than a bug fix: restoring
  it means re-deriving that rule from the scheme backdrop (and re-checking the layout it used to impose),
  not un-commenting a rule that references a keyframe that no longer exists.


### 11.11 The global element chrome follows the colour scheme (2026-09-14)

The scheme sweep had covered page stylesheets; the *global* rules in `index.css` were still painting the
theme's fixed brand palette, so every page that did not override a bare `<button>` got a blue → mint fill
whatever the visitor had picked — and one that had picked Crimson saw the site's cyan anyway.

- ✅ **The default fill is now the site's ACTION ramp.** `button` (and `input[type=submit|button]`) is
  `--action`, and `button:hover:not(:disabled)` is the new `--action-hover` — the same ramp with its stops
  swapped, which is what the old rule did when it reversed `--fg-blue` → `--fg-mint`. `--action` is one
  scheme hue at a lightness pinned per mode (`--action-hi`/`-lo`), so the `--text-color-inv` LABEL clears
  AA on every scheme; the raw blue → mint gradient it replaces is bright in *both* themes, where white
  passes at the blue end and fails at the mint end. Each line keeps a plain `--scheme-*` ramp as its
  fallback, because `--action` is built from relative colour syntax (the house pattern for those tokens).
- ✅ **`a:hover` is the scheme's partner hue** (`--scheme-primary`), the same substitution every converted
  page makes. It stays a bare `a:hover` at `(0,1,1)`, so §6's trap — a component `:hover` must NAME its
  colour or the global rule wins — is unchanged, and is now recorded in the table there as well.
- ✅ **Three literal colours are gone.** `a:focus`'s `rgba(33, 150, 243, 0.15)` wash, `input:focus`'s
  `0 0 0 3px rgba(33, 150, 243, 0.1)` shadow and its `--fg-blue` edge, and `input:invalid:focus`'s
  `rgba(220, 0, 0, 0.1)`: all four are `color-mix()` of a token now. The MUI blue had been shipping in
  the global stylesheet through both halves of the scheme migration.
- ⬜ **Still fixed-palette, deliberately: `--focus-outline`.** It is `3px solid var(--link-color-accessible)`
  on `:root`, and moving it to the scheme is not a find-and-replace — `:root` has never seen
  `--scheme-accent` (it lives on `<body>`), so the declaration would collapse to the guaranteed-invalid
  value and take the focus ring off *every* page. It has to be redeclared in the
  `.light-theme, .dark-theme` block, and it is accessibility-critical enough to want its own eyeball.
- ⬜ **Still fixed-palette, page-level:** the same hardcoded blue survives in `App.css`'s `.info-message`,
  `Hype.css` / `Support.css` focus washes (0.2), `Polls.css` (0.35 ×2), and `Polls.css` / `Sit.css`'s
  `rgba(220, 0, 0, 0.12)` error washes. Same fix, one line each, when someone is in those files.
- **No test run:** `index.css` is not read by any test file (checked); the change is 4 rules plus one token.


### 11.12 The scheme is painted before the first frame (2026-09-14)

Refreshing `/net` showed the **default** palette for a moment and then jumped to the visitor's scheme.
Nothing was wrong with the scheme itself: `index.html` loaded `/src/index.jsx` as a deferred module and
*everything* — the mode class and the `data-scheme` attribute — was applied in the shared header's mount
effect (`initTheme()`, `initScheme()`), i.e. after the first paint. Worse on `/net` than elsewhere: the
route is `lazy()`-loaded, so the browser paints that first frame while the chunk is still in flight.

- ✅ **Both now paint pre-paint.** A small inline script at the top of `<body>` reads `theme` and `scheme`
  from `localStorage` and writes the class + `data-scheme` (+ the inline `--scheme-hue-*` pair for
  `custom`) before `index.jsx` runs. It is deliberately dumb and deliberately not the authority:
  `initTheme()` / `initScheme()` still run on mount, resolve `system` against the OS, validate, and own
  the repaint. Inline scripts are permitted — `netlify.toml`'s CSP keeps `script-src 'unsafe-inline'`.
- ⚠️ **The script writes the scheme id UNVALIDATED, and that needed a CSS change to be safe.**
  `isScheme()` exists in `scheme.js` because an unknown id leaves `data-scheme` pointing at a selector no
  scheme matches — and `body[data-scheme]` is an attribute-PRESENCE selector, so the derivation block
  still applies, takes its hue from an undefined token, and collapses to the guaranteed-invalid value:
  every accent on the page quietly disappears, with no error. The id list lives in `scheme.js` and must
  not be copied into HTML, so the robustness went to the CSS instead: `body[data-scheme]` now **seeds**
  `--scheme-hue-accent`/`-primary` with the theme's own default pair, which every named scheme overrides
  (equal specificity, later in the file — the same ordering rule the schemes already depend on).
  An unrecognised id now degrades to exactly what no attribute at all gives.
- ⚠️ **A first visit still gets one frame of the default palette** — with nothing stored the script has no
  id to paint, so the default scheme only lands when `initScheme()` runs on mount. Left alone rather than
  duplicating the default's id into the HTML; it is what makes the `-bg` backdrop fallbacks on `/login`,
  `/register`, `/about` and the quizzes load-bearing (corrected that comment in all four places, plus the
  note in `FRONTEND_UI_STANDARD.md` §2, which claimed a mount effect was the first paint).
- **Verified:** the script's syntax and its two storage reads (and the theme resolver's `system` branch)
  by inspection against `utils/theme.js` / `utils/scheme.js`; **not** eyeballed in a browser — the
  Playwright window was in use by another session, and a one-frame flash is not something a screenshot
  shows anyway. Worth a hard refresh on `/net` with a non-default scheme (e.g. crimson) to confirm.
- **No test run:** no test file reads `index.html` (checked), and the CSS change is two declarations.


### 11.13 The `/net` chat wears the site's scheme instead of a palette of its own (2026-09-14)

The chat's *accents* already read `--scheme-accent` / `--scheme-primary`, but its **surfaces** did not: a
fixed indigo/navy set (`#0f0f1a`, `#1a1a2e`, `#2d2d5e`) that no scheme and no mode contains. Measured on a
dark site with `sunset` selected: the chat's `--bg-primary` was `#0f0f1a` while the page around it was
`#151516`, and the panel stayed navy whichever colour the visitor had chosen. Ten more blocks,
`[data-simple-theme="<scheme>"]`, restated a whole surface *under the same names as the site's schemes* —
so `/net` and `/profile` offered the same ten words for two different settings, and both screens could
honestly claim to be on "Sunset".

- ✅ **The surfaces come from the site's primitives.** `SimpleTheme.css` now builds them from the
  mode-INDEPENDENT values in `:root` (`--grey5`, `--grey4`, `--input-bg-dark-accessible`, `--white0`,
  `--dark-blue0`, `--grey3-accessible`, `--grey0`), with fallbacks. They have to be the mode-independent
  ones, because the chat's light/dark is its own setting: each of the two blocks must name every value
  rather than read a mode-aware token. Where the two modes agree, the chat resolves to exactly the colours
  the page is using. The ten named palettes are deleted.
- ⚠️ **The light block's selector needs `:not([data-simple-theme="dark"])`, and it is not tidiness.** It
  and the (now removed) `[data-simple-theme="dark"]` block share specificity, so a light site would
  repaint an explicitly-dark chat light purely because the light rule sits later in the file. Excluding
  the dark case is what lets the base `.simple-root` block be the one unconditional dark default.
- ⚠️ **`--text-color-accent-dark-strong` is NOT mode-independent — it only looks it.** `.light-theme`
  re-points it to the *light* ink (`index.css` L432), so referencing it from the chat's dark block gave a
  dark surface the light ink (`#4a4a4d` on `#151516`, measured). It is mirrored as a literal in the dark
  block with the reason written next to it — the same "CSS cannot read across those two blocks at once"
  problem `utils/scheme.js` has with the scheme hues. The light block uses `--grey3-accessible`, which is
  a genuine `:root` constant.
- ✅ **The picker writes the site's setting, not a copy of it.** The Theme select is now mode-only
  (Follow the site / Light / Dark) and a **Color scheme** select beside it lists `SCHEMES` and calls the
  same `setScheme()` + `syncSchemeToAddon()` `/profile` calls — so the chat has no palette to disagree
  with. `SimpleChat`'s resolver maps a stored scheme name (from the old list) to `system` rather than to a
  palette that no longer exists.
- ✅ **The remaining fixed brand hues went with it:** the `linear-gradient(135deg, var(--accent), #3b82f6)`
  second stop (message avatar, typing avatar, agent avatar) → `--user-bubble`, i.e. the same
  accent→primary ramp `SimpleNav`'s active pill uses; `#60a5fa`/`#93bbfc`, `#5b52ff`, two `#2563eb` links
  and `GoalManager`'s `#2563eb`/`#1d4ed8` → `--accent` / `--accent-hover`.
- ⚠️ **White ink on an accent fill was a bug waiting for a light-hued scheme.** The accent is re-pinned
  per *chat* mode, so a dark chat's accent is `0.78` lightness, where white measured **~2:1** (1.5:1 on
  Cyberpunk's yellow). Every accent-filled control (send button, download/action buttons, modal buttons,
  avatars, goal buttons) now takes `--accent-text` — the ink that fill was tuned against — and the two
  hover rules that set only a `background` restate the ink, because `index.css`'s
  `button:hover:not(:disabled)` forces `--text-color-inv`: an ink that follows the **site's** mode while
  the fill follows the **chat's**, so the two disagree whenever the modes do.
- **Deliberately left alone:** the state triads (the addon test badge's green/red/in-progress blue),
  `--success` / `--warning` / `--error`, and the per-category event-icon hues in `AgentLivePanel`. Those
  are signals and legends, not the page's identity — the same rule that keeps `--fg-orange` out of a
  scheme.
- **Verified in the browser** (signed in as the guest account): probed the computed tokens on a dark site
  with `sunset` and `cyberpunk` and on a light site; changed the scheme from *inside the chat* and
  confirmed `data-scheme`, the stored id, the body class and the chat all moved together; forced the
  mode-mismatch case (light site, chat explicitly dark) to exercise the `:not()` guard; contrast measured
  compositing the alpha — worst visible pair **5.09:1**, avatar ink **8.66–9.23:1** against the two
  gradient stops (was ~2:1 with white).
- **Test:** `frontend/src/components/SimpleAddon/MessageBubble.test.jsx` — 7/7. `SimpleChat` and
  `AdvancedSettings` have no test file.


### 11.14 `/net` becomes an app shell: no footer, and a height that survives phone chrome (2026-09-14)

`/net` was a page with a chat in it. It is now a **fixed-height shell** — exactly one viewport, with the
conversation scrolling *inside* — which is what a chat has to be before it stops reading as a website.

- ✅ **The `Footer` is gone from `/net`** (and its import), the one page without one. Under a composer it
  was a strip of marketing chrome on the only screen the user has, and its bottom edge was the last thing
  between the page and the viewport. Measured after: `documentElement.scrollHeight === innerHeight`, the
  document does not scroll at all, and the composer's bottom is flush with the viewport. The links live in
  the header's dropper, so nothing became unreachable.
- ⚠️ **Trade-off, deliberately taken:** the About/Privacy/Terms links are now absent from the signed-out
  gate too, since the gate renders inside the same shell. If that has to change for legal reasons, it is a
  conditional inside `Net.jsx` rather than a return of the footer.
- ⚠️ **No single viewport unit is correct on a phone, which is the whole reason for the ladder.**
  `vh`/`lvh` is the height with the browser's bars *retracted*, so the composer sits under them; `svh`
  never covers but is a fixed value, so the shell is short once they retract; `dvh` tracks the bars but
  **not the soft keyboard** — a keyboard is not a "dynamic toolbar" to the viewport units, so `dvh` still
  hides the composer behind it. So `height` is `100vh` → `100svh` → (guarded) `dvh` → `--net-app-height`,
  written from `visualViewport.height` in `Net.jsx`: the only measure that excludes all three.
- ⚠️ **`var(--net-app-height, 100dvh)` cannot be listed with the other three declarations.** A `var()`
  whose fallback is an unsupported unit is invalid at *computed*-value time, and that discards **every**
  `height` declaration for the element — not just its own — collapsing the shell to `auto`. It lives in
  `@supports (height: 1dvh)` instead. `dvh` and `svh` shipped together (Chrome 108 / Safari 15.4), so the
  browsers the guard excludes are exactly the ones the `100svh` line exists for.
- ⚠️ **The responsive block used to beat it.** `@media (max-width: 768px)` restated
  `.planit-nnet { height: 100svh }` — equal specificity, later in the file, so the *phone* rule (the one
  that matters) silently overrode the shell's own height, and a desktop check would never show it. That
  block no longer touches `height`, and `.net-hero-section`'s `calc(100svh - var(--nav-size))` went with
  it: the element is `flex: 1` in a column flex container, so it tracks whatever height the shell has.
  Pinning it to a viewport unit is what would push the composer off-screen as soon as the two disagreed.
- ✅ **Touch behaviour, scoped to the shell:** `touch-action: manipulation` (drops the double-tap-zoom
  delay, keeps pan and pinch), `-webkit-tap-highlight-color: transparent`, and `overscroll-behavior: none`
  — nothing scrolls there by design, so it only stops the *browser's* rubber-band and pull-to-refresh,
  both of which slide the browser's bars and move the layout under the thumb.
- ✅ **`padding-bottom: env(safe-area-inset-bottom, 0px)`** for the home indicator / gesture bar; the other
  three insets are deliberately not applied, because `--nav-size` sizes the *fixed* header and insetting
  only the shell would put the two out of step in landscape on a notched phone. It resolves to 0 today —
  the viewport meta has no `viewport-fit=cover` — and is there to be already correct if that changes.
- **Verified in the browser:** the shell fills exactly and the composer is flush at 320×568, 390×844 and
  844×390 (drawer closed; it opens as an overlay, `translateX(-280px)`, and does not default open), no
  document scroll and no horizontal spill at any of them. The keyboard case was exercised by shadowing
  `visualViewport.height` and dispatching `resize`: at 420px and at 300px the shell follows the var and the
  composer stays fully on screen (91px tall, bottom == the simulated height), then returns to 1134px. The
  desktop check is unchanged (`--net-app-height` = `innerHeight`, composer flush).
- **Not done, on purpose:** `interactive-widget=resizes-content` in the viewport meta would make the
  keyboard resize the *layout* viewport on Chrome/Android too, but it is a site-wide behaviour change and
  the `visualViewport` binding already covers the chat without it.
- **No test run:** no test file covers `Net.jsx` (`front.test.js` mocks it) and none asserted a footer on
  `/net`; the change is one element plus CSS. `docs/guides/UI_LAYOUT.md` §5.7 gains "The app
  shell" as the reference for the next surface of this shape.


### 11.15 The surface switcher's pills are text only (2026-09-14)

- ✅ **The emoji went from the four `SimpleNav` pills** (`Chat`, `Control`, `Goals`, `Market`), which
  is the header on `/net`, `/simple`, `/plans` and `/market` (plus `/plans/goal/:id`). In a 48px band
  four glyphs sitting beside four words read as decoration arguing with the type — the labels were
  already doing all the work.
- ⚠️ **Only the renderer changed, and that is the point.** `SIMPLE_SURFACES` / `SIMPLE_NAV_SURFACES`
  still carry their `icon` fields, because the closing CTA band (`SimpleCtaBand`, on `/home` and
  `/projects`) renders them on cards, where there IS room for one. Deleting the field would have
  stripped the band too — checked on `/home` after the change that its 💬 / 🎛️ / 🎯 are intact. The
  `icon` notes in `simpleSurfaces.js` and `SimpleNav.jsx` now say which surface owns it, so the next
  person does not "tidy up" the unused field.
- **The words still have to match.** `SimpleCtaBand.test.jsx` asserts the switcher's labels equal the
  band's cards word for word — that parity is what keeps the switcher a landmark — and it reads
  `.snav-link-label`, which this change kept, so the assertion still holds.
- **CSS:** `.snav-link-icon` and its `.snav--compact` override deleted, and `gap` removed from
  `.snav-link` — the label is the pill's only child now.
- **Verified:** all four routes render `Chat | Control | Goals | Market` with no emoji text node and no
  `.snav-link-icon`; pills measure 47 / 61 / 51 / 59px and the nav's right edge is 792px of a 1276px
  viewport (no overflow, no wrap). Test: `SimpleCtaBand.test.jsx` — 5/5.
- `BUSINESS.md` → *The three Simple surfaces are one journey* is the current-state description of this switcher and was updated with it; the sections
  that still show 💬/🎛️/🎯 are either the CTA band (unchanged) or other UI (the 🌟 Board tab, the
  conversation rail's 🎯 badge).


### 11.16 The surface switcher becomes a segmented control (2026-09-14)

Follow-up to §11.15: with the emoji gone the pill was plain, and looking at it closely it was two
things wrong at once — a control dressed as a row of links, and a fragment of dead height nobody had
noticed.

- 🐛 **The `<li>` was setting the pill's height, not the segments.** An `inline-flex` link inside a
  block-level `<li>` sits on a line box, so the `<li>` was ~5px taller than the link it contains (the
  descender space under the baseline). The pill was therefore padded-out around small labels.
  `.snav-links > li { display: flex }` removes the line box, and the height then falls from 41px to
  40px *while the labels grow* — `--font-size-xs` (10.5px, the smallest label anywhere in the chrome)
  → `--font-size-small` (15.4px, which the base rule already used; only the compact override shrank
  it). Same trap as any inline-level box in a block parent.
- ✅ **The current room stopped wearing the action ramp.** `.snav-link.is-active` was
  `linear-gradient(135deg, var(--scheme-accent), var(--scheme-primary))` — the fill reserved for
  "press this" — so the page you were already on read as the button to press. `/plans` had already
  settled this for `.plans-switch-btn.is-active` ("a tab marks a PLACE, not an action"), so the header
  now uses that recipe: a tint of `--scheme-primary` over `--bg-1`, inked with `--text-color`. The
  scheme still drives it; only the fill's *kind* changed.
- ✅ **Muted ink for the rooms you are not in** (`--text-color-accent`), so full ink is a second cue.
  It is needed: the fill step alone is 1.79:1 in light mode, where a near-white track and a light tint
  are close in luminance.
- ✅ **The track is a surface (`--bg-1`), not a film of the ink.** The first attempt used a 9% ink
  wash, which reads well on a dark header — but the header is transparent and `/net`'s room paints a
  scheme-tinted backdrop underneath, so the pill took that tint whole: in light mode it went from a
  grey control to a saturated cyan bar whose *track* out-shouted its own selected segment. Controls
  keep `--bg-1` (§5.7). The `--border-nav` hairline and the `--shadow-sm` went instead — a groove is a
  tone, not an outline, and it does not float (§5).
- **Measured, 6 schemes × 2 modes** (real reloads — see the gotcha below): worst active ink **4.68:1**
  (`neutral`/dark), worst idle ink **5.93:1**, fill step 1.79–2.9:1. All clear AA. The 40% tint is
  higher than `/plans`' 20% because a translucent track on a tinted room leaves less to sit on; at 20%
  the step was ~1.2:1 in light mode, i.e. a hue difference nobody would notice.
- ⚠️ **`getComputedStyle` on a `color-mix()` whose input is a relative-colour custom property returns
  a STALE value when you mutate `data-scheme` and read it in the same task** — a first sweep reported
  every scheme as identical, and a second (with `void el.offsetHeight` between) reported impossible
  mixes, because the mix had resolved against the *previous* scheme's `--scheme-primary`. Setting the
  attribute, awaiting two frames and reading gave the right answer, but the numbers that went into the
  table above came from **real reloads** with `localStorage` set. A colour probe that mutates and reads
  in one go does not prove anything here.
- **Verified:** pill height 40px in the 48px header band (4px clear above and below), nav 394px wide so
  it fits the 58% center slot at the 820px hide breakpoint, no wrap or overflow, and the four segments
  are 65/85/71/82px. Test: `SimpleCtaBand.test.jsx` — 5/5 (it selects `.snav-link-label`, which is
  unchanged).
- **Not touched:** the `@media (max-width: 640px)` block in `SimpleNav.css` is effectively dead — the
  compact switcher lives in the header's center slot, which is `display: none` below 820px, so those
  rules only ever apply to the non-compact standalone bar that nothing renders today.

---


