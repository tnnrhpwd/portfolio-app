# Frontend UI — layout & motion

Part of the [frontend UI standard](./FRONTEND_UI_STANDARD.md), which indexes the whole set.
The section numbers are the standard's own and were not renumbered when the file was
split: §1–§4 and §10 stay in the hub, **§6–§9 are in
[`UI_COMPONENTS.md`](./UI_COMPONENTS.md)**, and **§11.x is in
[`UI_DESIGN_RECORDS.md`](./UI_DESIGN_RECORDS.md)**. This file carries **§5**, including
§5.7 — the service-page layout rules.

---

## 5. Squarespace-inspired layout & motion

Our benchmark for "very very very good UI" is [Squarespace's website-design showcase](https://www.squarespace.com/website-design) —
**its structure and motion, not its monochrome palette.** The signature moves we borrow: full-bleed
color bands that meet edge-to-edge with *no card borders*, oversized media blocks (photos or artwork,
not emojis), uppercase letter-spaced buttons, paginated horizontal carousels, alternating media/text
rows, and scroll-triggered reveals. Keep our own vibrant gradient palette everywhere a color decision
is made.

### Full-bleed bands, not bordered cards

Squarespace separates content with flat color changes, not boxes. Two shapes are in use here, and
choosing between them is the first decision on a page:

- **Gradient bookends — preferred whenever the page holds real content.** The animated gradient covers
  the hero and (optionally) a closing band; everything between sits on flat, alternating bands, so
  forms, tables and prose get a calm ground to be read against. `Home` and `Annuities` are built this
  way, and it is the shape to copy.
- **Gradient everywhere.** The page root carries the gradient and the bands sit transparently on top of
  it. This is the older shape and it still looks right on short pages, but a long page of data fights a
  moving background, and band-to-band transitions stop reading as structure.

Either way the **band is the structural unit** — a full-bleed color change — and borders belong to
compact controls only:

```css
.foo {
  background: linear-gradient(-45deg, var(--bg-orange), var(--bg-pink), var(--bg-blue), var(--bg-mint));
  background-size: 400% 400%;
  animation: fooGradientShift 12s ease infinite;
}
/* The band is full-bleed; its content is not. Padding lives on the band so the
   color reaches the viewport edge, and the wrap keeps the copy readable. */
.foo-band {
  width: 100%;
  padding: calc(var(--nav-size) * 1.2) calc(var(--nav-size) * 0.3);
  display: flex;
  flex-direction: column;
  align-items: center;
}
.foo-wrap { width: 100%; max-width: 1080px; }

/* Alternate the tone down the page: surface → tint → surface → cta. Two flat
   washes are enough; more than that reads as decoration. */
.foo-band--surface { background: var(--bg-page); }
.foo-band--tint { background: color-mix(in srgb, var(--fg-mint) 12%, var(--bg-page)); }
.foo-band--wash { background: color-mix(in srgb, var(--fg-blue) 10%, var(--bg-page)); }

/* A closing CTA band wears the SCHEME's page-relative pair, inked with plain
   --text-color. The -bg tokens mix each identity hue into THIS mode's page
   colour, so the band is pale on a light page and deep on a dark one. The
   saturated --scheme-accent/--scheme-primary pair is for small fields: on a band
   it needs either a pinned lightness or --text-color-inv ink, and both make the
   band brighter as the page gets darker.
   `SimpleCtaBand` and /about's contact band are built this way — copy them. */
.foo-band--cta {
  background: linear-gradient(45deg, var(--scheme-accent-bg), var(--scheme-primary-bg));
  color: var(--text-color);
}

/* Controls inside it are painted in the band's own ink so they invert with the
   band: a solid ink pill, and an outline of the same ink. Never --white0/--grey5
   (a white slab on whichever theme's band it lands on). */
.foo-btn-inv { background: var(--text-color); color: var(--bg-page); }
.foo-btn-ghost {
  background: transparent;
  color: var(--text-color);
  border-color: color-mix(in srgb, var(--text-color) 55%, transparent);
}
.foo-btn-ghost:hover {
  background: color-mix(in srgb, var(--text-color) 10%, transparent);
  border-color: var(--text-color);
}

/* Cards on the band are a film of --bg-1, NOT a wash of the ink: an ink film
   lightens the card on a dark band and darkens it on a light one, i.e. it spends
   the copy's contrast in one of the two modes. */
.foo-band--cta .foo-card { background: color-mix(in srgb, var(--bg-1) 40%, transparent); }

/* Translucent surface for tiles that need contrast without a border. On the
   gradient-everywhere shape use the --bg-1 flavor instead, since --bg-page
   would hide it: color-mix(in srgb, var(--bg-1) 55%, transparent) */
.foo-tile { background: color-mix(in srgb, var(--text-color) 10%, transparent); }
.foo-tile:hover { background: color-mix(in srgb, var(--text-color) 18%, transparent); }
```

**Put one reveal on the band, not on each card inside it** — wrap the band in a tiny local component
that calls `useScrollReveal` and renders `{children}` into the wrap. `RevealBand.jsx` in
`frontend/src/pages/Projects/Annuities/` is the reference (tones: `surface | tint | wash | cta`).

### Color beside color, not borders

**We don't draw lines — we put colors next to each other.** A border is one way of saying "these two
things are different"; a change of tone says the same thing and looks like a designed page instead of
a spreadsheet. Squarespace's calm comes from planes of color meeting edge-to-edge, and that is the
house style here.

- **Containers get a fill, never an outline.** A panel, tile, table or readout is `--bg-1` or a wash
  of an accent — `color-mix(in srgb, var(--fg-blue) 7%, var(--bg-1))` — not a box with a 1px edge.
- **Give neighbouring blocks different tones.** Two adjacent panels in the same color read as one
  panel that failed to load; step the hue so the grid reads as blocks of color. Deriving a block's
  head and footer from *its own* hue keeps the block one family:
  ```css
  .foo-panel { --foo-hue: var(--fg-blue); background: color-mix(in srgb, var(--foo-hue) 7%, var(--bg-1)); }
  .foo-panel:nth-child(3n + 2) { --foo-hue: var(--fg-mint); }
  .foo-panel:nth-child(3n + 3) { --foo-hue: var(--fg-pink); }
  .foo-panel-head { background: color-mix(in srgb, var(--foo-hue) 13%, transparent); }
  ```
- **Hover deepens the tone** — don't answer a hover with a ring *and* a shadow *and* a border. Pick
  one, or use none: color and motion are already doing the work.
- **Separate rows with alternating tints**, not a hairline under every row:
  `.foo-row:nth-child(odd) { background: color-mix(in srgb, var(--foo-hue) 6%, transparent); }`
- **Where a boundary is genuinely functional, make it a color too.** An input sitting on a tinted
  panel gets a solid `--bg-1` fill and at most an edge mixed from its own accent
  (`1px solid color-mix(in srgb, var(--fg-blue) 30%, transparent)`) — not `--border-nav` grey. A
  disabled control gets a muted fill, not a dashed outline.
- **Focus rings are not borders.** They are accessibility and they stay (§10 rule 4).
- **Don't mix idioms.** A page either composes planes of color or draws boxes; half and half reads
  as an accident.

**Borders are the fallback, not the default.** `--border-nav` exists for the rare edge that has to be
neutral (a browser-default-looking divider, a table rule on a page of dense data) — reach for a tone
first, and for one of the color-mix edges above second. Service pages are no exception: their panels
are color planes too (§5.7).

### Opening a band: eyebrow → heading → lead

Every band opens the same way, so the eye learns the rhythm and can skim the page:

```jsx
<div className="home-section-head">
  <p className="home-eyebrow">The playground</p>
  <h2 className="home-heading">Start with a tool you'll love</h2>
  <p className="home-lead">Pick a project, open it, and start playing — no downloads, no accounts.</p>
</div>
```

- The **eyebrow** (`--font-size-xs`, `letter-spacing: 0.14em`, uppercase, `--text-color-accent`) names
  the section in two or three words. It is a label, **not** a heading — the `<h2>` carries the outline.
- Cap the head at `max-width: 760px` and center it. A lead paragraph running the full width of a 1080px
  band, at a font scale that follows `--nav-size`, is genuinely hard to read.
- One `<h1>` per page (the hero) and one `<h2>` per band. Never pick a heading level for its size —
  pick the level the outline needs and style it.

### Opening a band: eyebrow → heading → lead

Every band opens the same way, so the eye learns the rhythm and can skim the page:

```jsx
<div className="home-section-head">
  <p className="home-eyebrow">The playground</p>
  <h2 className="home-heading">Start with a tool you'll love</h2>
  <p className="home-lead">Pick a project, open it, and start playing — no downloads, no accounts.</p>
</div>
```

- The **eyebrow** (`--font-size-xs`, `letter-spacing: 0.14em`, uppercase, `--text-color-accent`) names
  the section in two or three words. It is a label, **not** a heading — the `<h2>` carries the outline.
- Cap the head at `max-width: 760px` and center it. A lead paragraph running the full width of a
  1080px band, at a font scale that follows `--nav-size`, is genuinely hard to read.
- One `<h1>` per page (the hero) and one `<h2>` per band. Never pick a heading level for its size —
  pick the level the outline needs and style it.

### Imagery over emoji

Every card/feature should carry a real **media block** — an `<img>` of AI-generated artwork or a
photo — not an emoji or icon tile. Artwork lives in `frontend/src/assets/art/` (`project-*.jpg`,
`feature-*.jpg`, `hero.jpg`), imported at the top of the page component and passed through the data
arrays, so imagery can be swapped without touching markup. Image rules:

- `aspect-ratio: 4 / 3` with `object-fit: cover` so every block crops consistently.
- `border-radius: var(--border-radius-2xl)` on the media itself (rounded image, not a bordered card).
- `loading="lazy"` and `alt=""` when decorative. Note that lazy loading only helps a grid taller
  than the browser's ~1250px look-ahead window — a 4-column desktop grid is ~1100px, so on
  `/projects` it defers almost nothing. Fewer bytes beats a smarter schedule.
- **Cap the long edge at 1200px** (`hero.jpg` may use 1920px). A card renders ~270px wide, so a
  2400×1792 source is roughly 20× the pixels the layout can show. Oversized art is by far the
  biggest first-visit cost on `/projects`: shipping 2400px files put ~11 MB into the first two rows
  alone (~59s at 1.5 Mbps). `node scripts/optimize-art.js` reports the damage and `--apply` fixes it.
  This is not a caching problem — `/assets/*` is already `immutable` on Netlify and `sw.js` caches
  it cache-first, so repeat visits were always fast. Only the first visit pays.

**A full-bleed hero image needs a scrim.** Low opacity alone is not enough: a bright photo still
competes with the headline, and legibility flips between themes. Layer a radial pool of the page color
between the artwork and the copy — theme-aware, because `--bg-page` is dark in dark mode — and lift the
content above it:

```css
.foo-hero-media { position: absolute; inset: 0; z-index: 0; object-fit: cover; opacity: 0.18; }
.foo-hero::after {
  content: ''; position: absolute; inset: 0; z-index: 1; pointer-events: none;
  background: radial-gradient(
    ellipse 62% 78% at 50% 44%,
    color-mix(in srgb, var(--bg-page) 78%, transparent) 0%,
    color-mix(in srgb, var(--bg-page) 45%, transparent) 46%,
    transparent 78%
  );
}
.foo-hero-wrap { position: relative; z-index: 3; } /* circles sit at 2 */
```

A short hero crops a 3:2 image hard (`cover` zooms into the middle), so either give the hero generous
height or accept that the artwork reads as texture rather than as a subject.

**Agents: you can generate new artwork.** This repo has a working AWS Bedrock
text-to-image pipeline, so "I need a better image here" is a thing you can just do —
you are not limited to the artwork already in `assets/art/`. The full recipe (API,
auth, both asset paths, the region gotcha) is in
[`ASSETS.md`](./ASSETS.md);
the short version for repo assets:

```bash
# No server, no JWT needed — reads credentials from backend/.env directly.
node backend/scripts/generate-project-art.js          # all project cards
node backend/scripts/generate-project-art.js pets     # or just these slugs
```

Rules that keep generated art consistent with the existing set:

- The generator returns a **full-resolution PNG**. Do not check that in directly. Run
  `node scripts/optimize-art.js --apply --prune --only <slug>` — it resizes to a 1200px long edge,
  encodes mozjpeg q82, converts the PNG to `.jpg`, and removes the PNG. Repoint the import if the
  extension changed. **The resize is the load-bearing part:** converting a 2400px PNG at quality 90
  still yields a 2–4 MB file, which is exactly how the oversized set reached production.
- Prompt for a **glossy 3D render / product mockup**, shallow depth of field, blurred
  bokeh in the site palette (**mint/cyan, hot pink, orange, blue**).
- End every prompt with **`no text`** — Stability garbles words, and the existing art is
  text-free (or a single clean glyph).
- Generate at **3:2** (closest supported landscape ratio) so a 4:3 card crop loses little.
- Artwork is imported at the top of the page component and passed through the data arrays,
  so imagery can be swapped without touching markup — keep that indirection.

### Horizontal carousel with pagination dots

Featured collections scroll horizontally, one dot per card, with the active dot stretched into a pill.
The reference implementation is `scrollToCard` / `stepCarousel` / `handleTemplatesScroll` in
`frontend/src/pages/Home/Home.jsx`. It is pixel-measured rather than index-based, and three details
there are load-bearing:

```js
// One "step" is a card plus the row's real gap — read the gap, never assume it.
const step = card.getBoundingClientRect().width + parseFloat(getComputedStyle(row).columnGap || '0');
const maxScroll = row.scrollWidth - row.clientWidth;   // clamp every target to [0, maxScroll]
const index = Math.round(row.scrollLeft / step);       // active dot from the scroll position
```

- **Arrows step by pixels, not by index.** `row.scrollLeft + step` still moves when parked at the far
  right, where the last card has no distinct leading-edge position and an index-based target would
  compute the same offset twice — so "previous" would appear dead.
- **Snap the indicator to the last dot at the far right** (`if (scrollLeft >= maxScroll - 1)`). The last
  card can't align to the left edge, so `Math.round` always lands short of it and the final dot would
  never light up.
- **Re-measure on `resize`, never cache the step.** Listen on the row's `scroll` (passive) and on
  `window` `resize`; both the card width and the gap change with the viewport.

There are no CSS scroll-snap points on the reference — the smooth `scrollTo` and the clamped targets do
the positioning. Hide the native scrollbar (`scrollbar-width: none` plus its `::-webkit-scrollbar`
twin).

**Accessibility:** the row is `role="list"` with an `aria-label`; each control is a real `<button>` with
an `aria-label` (`Previous project`, `Next project`, `Go to <name>`); the dots form a `role="tablist"`
with `role="tab"` + `aria-selected` on each. Arrows and dots both need `min-height: 0; padding: 0` to
undo the global button styles (§6) — otherwise the dots are 44px tall. The active dot animates `width`
from a dot to a pill inside `border-radius: 999px`.

### Alternating media rows

For feature lists, pair a full-width media block with its copy and flip every other row, the way
Squarespace pairs photography with editorial text:

```css
.foo-feature-row { display: grid; grid-template-columns: 1fr 1fr; gap: calc(var(--nav-size) * 0.8); align-items: center; }
.foo-feature-row.is-flipped .foo-feature-media { order: 2; }
/* collapse to a single column under 768px */
```

### Buttons & type

Primary actions are uppercase, letter-spaced pills (`letter-spacing: 0.1em; text-transform: uppercase`)
with a vibrant gradient fill and a trailing arrow glyph. Secondary actions are plain text links whose
arrow slides right on hover — not a second bordered button.

### Scroll reveal

Sections fade + rise the first time they enter the viewport (once per mount — Squarespace doesn't
re-animate on scroll-up). Use the shared `useScrollReveal` hook
(`frontend/src/hooks/useScrollReveal.js`):

```jsx
import useScrollReveal from '../../hooks/useScrollReveal';
const [ref, visible] = useScrollReveal();
<section ref={ref} className={`foo-band foo-reveal ${visible ? 'is-visible' : ''}`}>
```

```css
.foo-reveal { opacity: 0; transform: translateY(28px); transition: opacity 0.7s ease, transform 0.7s ease; }
.foo-reveal.is-visible { opacity: 1; transform: translateY(0); }
```

`prefers-reduced-motion: reduce` must reset these to their resting state (see the reduced-motion block
in section 4's CSS skeleton).

### Stagger the children of a revealed band

One reveal per band is right, but a row of six identical tiles arriving in lockstep looks mechanical.
Give the children their own transition and step the delay with `nth-child` — no per-item inline styles,
no JS:

```css
.foo-stagger > * {
  opacity: 0;
  transform: translateY(16px);
  transition: opacity 0.5s ease, transform 0.5s ease;
}
.foo-reveal.is-visible .foo-stagger > * { opacity: 1; transform: translateY(0); }

.foo-stagger > *:nth-child(1) { transition-delay: 0.04s; }
.foo-stagger > *:nth-child(2) { transition-delay: 0.10s; }
.foo-stagger > *:nth-child(3) { transition-delay: 0.16s; }
/* a flat ~0.06s step reads well up to about ten children */
```

Reset `.foo-stagger > *` in the `prefers-reduced-motion` block next to `.foo-reveal`, or the children
stay invisible for anyone who has animations off.

### Content that animates itself (typing, counting)

Two flourishes recur on this site, and both have a trap.

**Animated hero copy cannot use `useScrollReveal`.** It is already in the viewport when the page loads,
so the observer fires immediately and there is no entrance. Drive it with a timed phase instead: the
animation (or a `setTimeout`) flips a class, and CSS owns the timing and the stagger.

```jsx
<h1 className="sr-only">Steven Tanner Hopwood — STHopwood Portfolio</h1>
<div className="home-title">
  <span>{displayedText}</span>
  <span className="home-cursor" aria-hidden="true">|</span>
</div>
<p className={`home-subtitle ${phase >= 1 ? 'is-visible' : ''}`}>Let's build a brighter tomorrow!</p>
```

- **Never make the animated element the heading.** A typewriter is half-written at any moment and
  meaningless to a screen reader, so the real `<h1>` goes in `.sr-only` (shared utility in
  `index.css`): still crawlable, still announced, document outline intact. The cursor is `aria-hidden`.
- **Reserve the height.** `.home-title { min-height: calc(var(--nav-size) * 1.05) }` stops the page
  reflowing one character at a time.
- **Restart the effect when the data changes.** Home re-runs it on `titleText`, otherwise a title that
  arrives after the fallback already finished typing never appears.

**Counting a number up** (`useCountUp` in `Home.jsx`): observe once at `threshold: 0.5`, then animate
with `requestAnimationFrame` over ~1.4s on an ease-out cubic.

```js
const eased = 1 - Math.pow(1 - p, 3);
setValue(Math.round(target * eased));
```

- **Reduced motion jumps straight to the target** — check
  `window.matchMedia('(prefers-reduced-motion: reduce)').matches` *before* observing and
  `setValue(target)`.
- **The last frame must land exactly on the target**, not one short of it, or the page states a number
  that is simply wrong.
- **Don't `aria-hidden` a real figure.** Unlike the typewriter, the count is content — leave it in the
  accessibility tree. A value that is a string ("Leadership") skips the count and renders as-is.

---

## 5.7 Service pages — a workspace, not a story

A **service page** (`/simple`, `/plans`, `/net`, `/profile`, `/u/<username>`) is a tool someone already opened
on purpose. It shares the palette, the tokens and the typography — but **not the band
stack**. Bands exist to sell an idea; a workspace has no idea to sell, it has tasks to
finish. A Discovery page earns its scroll; a service page costs the user time, and every
extra screen is a control they have to hunt for.

**The goal is utility: fewer screens, fewer words, the work visible immediately — and it
still has to look good.** Think a well-made instrument, not a poster.

### No bands

- **One flat page surface.** `--bg-page` for the whole page; the panels do the grouping.
  A full-bleed color change would carve one workspace into "sections" that aren't there.
- **No animated gradient background behind data** — it fights the numbers — and **no
  floating circles** (§5's decoration belongs to a marketing hero).
- **Keep one small piece of brand**: an accent-gradient hairline on the row, or a single
  gradient-filled primary action. That is enough to place the page in the family.
- The page root only clears the fixed header: `padding-top: calc(var(--nav-size) * 1.15)`.

### The hero collapses into a row — and nothing pins

Everything §4's hero would carry becomes one **row** at the top of the page: the room's name,
its live state and the primary action. It sits in the flow and **scrolls away with the page**.
The site header is the only thing that stays at the top.

```jsx
<header className="foo-bar">
  <h1 className="foo-bar-title">Control</h1>
  <span className="foo-bar-status">● Addon online · v1.2.3</span>
  <ul className="foo-bar-readout">
    <li>Loop <strong>idle</strong></li>
    <li>Stage <strong>—</strong></li>
    <li>Step <strong>0</strong></li>
  </ul>
  <div className="foo-bar-actions">
    <button type="button">↻ Refresh</button>
    <button type="button" className="foo-btn">▶ Start loop</button>
  </div>
</header>
```

```css
.foo-bar {
  /* NOT sticky. The site header is the only thing that stays at the top: a second
     pinned bar costs the tool a strip of the viewport on the surface whose whole
     job is density, makes the panels scroll under an opaque band, and competes
     with the header that already says where you are. `relative` is here only to
     anchor the accent rule below. */
  position: relative;
  display: flex; align-items: center; gap: calc(var(--nav-size) * 0.25);
  flex-wrap: wrap;
  /* Horizontal padding IS the panel padding, so the room's name shares a left edge
     with every panel title and control below it. `0` jams it into the corner. */
  padding: calc(var(--nav-size) * 0.2) calc(var(--nav-size) * 0.28);
  /* A PANE, like every panel below it — the row only had to be opaque while it was
     pinned (see /admin's reversal). */
  background: var(--glass);
  /* A PANE's radius, so the row reads as the topmost surface of the room rather
     than a square slab laid over it. */
  border-radius: var(--glass-radius);
}
/* The one piece of brand on the page: an accent rule inside the row's lower edge.
   Inset by the row's own radius, so it ends where the corner curve begins — it
   never pokes past a rounded corner, needs no clipping, and keeps its own rounded
   cap. `.admin-head::after` is the same move. */
.foo-bar::after {
  content: ''; position: absolute;
  left: calc(var(--glass-radius) * 0.7); right: calc(var(--glass-radius) * 0.7);
  bottom: 2px; height: 2px; border-radius: 999px;
  background: linear-gradient(90deg, var(--fg-blue), var(--fg-mint) 42%, transparent 72%);
  pointer-events: none;
}
.foo-bar-title { margin: 0; font-size: var(--font-size-heading); font-weight: var(--font-weight-bold); }
.foo-bar-actions { margin-left: auto; display: flex; gap: calc(var(--nav-size) * 0.18); }
```

- **The `<h1>` is the room's name**, two words at most, at `--font-size-heading` or smaller.
  No eyebrow (the header switcher already says where you are), no subtitle, no lead.
- **Live state goes in the row, not in a hero paragraph** — connection, stage, step,
  goals running, kill-switch state. That readout *is* the page's headline.
- **The primary action lives there too**: `+ New goal`, `▶ Start loop`, `● Record`.
- **The row wears the room's two measurements.** Its horizontal padding is the *panel*
  padding, and its radius is the *pane* radius (`--glass-radius`, or whatever the room's
  panels wear — `/fit`'s are `--border-radius-lg`). Its accent hairline is inset by that
  radius so it ends where the corner curve begins: never clipped, never poking past the
  curve, and with its own rounded cap (`.admin-head::after` is the same move).
- **Nothing of the page's own pins.** The site header is the only thing that stays at the
  top, so a row that wraps on a phone needs no `position: static` override at a breakpoint.
  This is the trade `/admin` already made: a pinned head permanently claims a strip of the
  viewport and forces an opaque base, for a control you can reach by scrolling up.

### Layout: a dense panel grid

- **A multi-column grid of panels** is the layout —
  `grid-template-columns: repeat(auto-fit, minmax(300px, 1fr))` gives 3 columns on a
  desktop, 2 on a tablet, 1 on a phone with no media queries.
- **Group into rows, not sections.** Panels that share a subject belong in the same grid
  row (its own 2- or 3-column grid block). Order by how often the user touches it:
  what you watch → what you run → what you keep → what it learned → settings.
  The panels' own titles are the only headings needed.
- **Fold the rest away.** Power-user plumbing goes in a `<details>`, so the first screen is
  the job and not the config.
- **Rows are short.** Row text at `--font-size-small`, panel labels at `--font-size-xs`
  uppercase, tighter line-height, one line per item wherever possible. A readout of four
  chips on one row beats a 2×2 stat grid.

### Copy: labels, not sentences

| Instead of | Write |
| --- | --- |
| "Watch it work on your PC live, and set how far it may go…" | `Control` |
| A paragraph explaining the page | (nothing — the panels explain themselves) |
| A lead paragraph above a panel | A `--font-size-small` hint **under** the control, only if it's ambiguous |
| "Free to start — no credit card required." | (delete — the user is already signed in) |
| "Get started" | The verb of the actual tool: `+ New goal`, `▶ Start loop`, `● Record` |

Prefer `title` / `aria-label` for an explanation over on-page prose, and keep empty states
to one short line plus the action that fixes them.

### Rules that change for service pages

- **Panels are planes of color, not cards.** No border, no outline: give each panel a fill (a wash of
  an accent over `--bg-1`) and let its head and footer be stronger washes of that same hue, so a dense
  grid resolves into blocks of color rather than a spreadsheet. Neighbouring panels should differ in
  tone — that *is* the grouping. §5 has the recipe.
- **Skip the panel shadow too.** A flat plane of color on a flat page needs no elevation to read as a
  block; keep the shadow for things that genuinely float (modals, dropdowns, toasts).
- **No scroll reveals, no stagger.** Reveals delay content on a page whose whole point is
  "help me now"; Squarespace's fade-and-rise belongs to a page you're being sold on. Motion
  here is reserved for **state changing** — a status dot, a progress bar, a button that
  becomes Stop.
- Everything else stands: tokens for every color, `calc(var(--nav-size) * N)` for sizing,
  visible focus rings, and a `prefers-reduced-motion` reset.

### The app shell — the one surface that behaves like an app

`/net` is the exception to this section's "a scrolling page of panels": it is a **fixed-height
shell**, exactly one viewport tall, with the conversation scrolling *inside* it. A chat has one job
and one control, and a document that scrolls a composer off the bottom is the thing that most makes
it read as a website. So `.planit-nnet` (`pages/Simple/Net/Net.css`) is the reference for any future
surface of this shape.

- **No `Footer`.** `/net` is deliberately the one page without one — the links live in the header's
  dropper. Under a composer, a footer is a strip of marketing chrome on the only screen the user has.
- **The height is a four-declaration ladder, and every rung is load-bearing.** No single viewport
  unit is right on a phone: `vh` is the height with the browser's bars *retracted* (so the composer
  sits under them), `svh` never covers but leaves the shell short once they retract, and `dvh`
  tracks the bars but **not the soft keyboard** — a keyboard is not a "dynamic toolbar" to the
  viewport units, so `dvh` still puts the composer behind it.

  ```css
  .foo-shell {
    height: 100vh;   /* fallback for browsers older than svh */
    height: 100svh;  /* bars expanded: never covered, but a fixed value */
  }
  /* ⚠️ Guarded. `height: var(--foo-app-height, 100dvh)` listed with the two above
     is invalid at COMPUTED-value time in a browser that has var() but no dvh — and
     that discards EVERY other height for the element, collapsing the shell to
     `auto`. dvh and svh shipped together, so the browsers this excludes are exactly
     the ones the 100svh line is for. */
  @supports (height: 1dvh) {
    .foo-shell { height: var(--foo-app-height, 100dvh); }
  }
  ```

  `--foo-app-height` is written by the page from `visualViewport.height` (see `Net.jsx`) — the only
  measure that excludes the bars **and** the keyboard. Coalesce the listener to a frame (`scroll` on
  the visual viewport fires per pixel) and **skip the update while `visualViewport.scale !== 1`**, or
  the shell fights a pinch-zoom.
- ⚠️ **Never restate the shell's `height` in a responsive block.** A `@media` rule of the *same
  specificity* placed later in the file beats the guarded rule, and it will look fine on a desktop
  check. The child below it is `flex: 1`, so it tracks whatever height the shell has — pinning it to
  a viewport unit instead is what pushes the composer off-screen the moment the two disagree.
- **Touch behaviour, on the shell only:**
  `touch-action: manipulation` (drops the double-tap-zoom delay, keeps pan and pinch),
  `-webkit-tap-highlight-color: transparent` (no grey flash on tap), and
  `overscroll-behavior: none` — nothing scrolls here by design, so this only ever stops the
  *browser's* rubber-band and pull-to-refresh, both of which slide the browser's bars and move the
  layout under the thumb.
- **`padding-bottom: env(safe-area-inset-bottom, 0px)`** keeps the composer above the home indicator
  / gesture bar. The other three insets are deliberately *not* applied: `--nav-size` sizes the fixed
  header, so insetting only the shell would put the two out of step in landscape on a notched phone.
- **Verify** at 320×568, 390×844 and 844×390 (drawer *closed* — it opens as an overlay), then shrink
  the visual viewport to ~300px and confirm the composer is still fully on screen. Present ratio, no
  horizontal spill, `document.documentElement.scrollHeight === innerHeight`.

### Verifying one

Signed-out is not the service page — it's a gate — so **log in before judging one**. Use the shared
demo account: **"Continue as Guest"** on `/login`, or `guest@gmail.com` / `guest`
(`backend/constants/guestAccount.js`, §10). It already holds workspace data (goals, plans, actions,
notes), so lists, filters and empty states are exercised for real instead of only in theory — and it is
**shared and public**, so delete anything you create while testing.

Then ask: *is the primary tool above the fold at 1366×768, and reachable without scrolling? Is there a
sentence on screen that could be a label? Is there a line on screen that could be a tone change?*

### Reference

`/simple` (`pages/Simple/Simple/`) and `/plans` (`pages/Simple/Plans/`) are the two service
pages built to this section. Each owns its page shell; there is deliberately **no shared band
component** for them, because there are no bands to share.

`/plans` holds **three views of one store** behind a tab row — the goal list, the Dream board
(`DreamBoard.jsx`, a cover-art tile grid) and the Library. So a view inside a service page is
still a service page: the board uses one flat surface, a dense grid of colour planes, and copy
that is labels rather than sentences. It is also why the third tab is labelled `🌟 Board` while
the page's `<h1>` reads "Dream board" — three one-word tabs stay the same height.
