# Frontend UI Standard

> **Single source of truth for how every page in `frontend/src/pages` should look and behave.**
> Read this before creating a new page or refactoring an old one so every page stays visually
> consistent, works in both light and dark mode, and scales across all display sizes.

---

## 1. The goal

Our visual language is **"vibrant editorial"** — Squarespace's structure and feel (typography-led
hierarchy, eyebrow labels, uppercase letter-spaced buttons, full-bleed color bands, generous sizing,
subtle motion) layered on top of our own **vibrant gradient** palette.

Every page should be **"very very very good UI"** — meaning:

1. **Theme-first** — colors adapt automatically to light and dark mode with zero hardcoded colors.
2. **Responsive by token** — nothing is sized in raw pixels; everything scales off one unit (`--nav-size`).
3. **Vibrant + animated** — the animated four-color gradient background is our signature; keep it.
4. **Typography-led** — clear hierarchy: eyebrow label → big heading → subtitle → content.
5. **Structured feel** — flat color-to-color band transitions, soft shadows, uppercase letter-spaced buttons, and subtle hover motion (Squarespace's feel, not its colors).
6. **Consistent anatomy** — every page follows the same structural template (section 4).
7. **Accessible** — semantic markup, visible focus states, `aria-*` where useful, and `prefers-reduced-motion` support.

---

## 2. How theming works

All colors come from CSS custom properties defined in `frontend/src/index.css`.

- Base/font/spacing tokens live on `:root`.
- The `<body>` element carries **one** of two theme classes:
  - `.light-theme`
  - `.dark-theme`
- The header theme toggle (see `components/Header/Header.jsx` and `utils/theme.js`) swaps the class
  and persists the choice to `localStorage('theme')`.

### Rules for theming

- **Never** hardcode a color (`#fff`, `black`, etc.) in page CSS. Always use a token.
- Keep the vibrant palette: `--fg-blue`, `--fg-mint`, `--fg-orange`, and `--fg-pink` are the accent
  colors; `--bg-orange`, `--bg-pink`, `--bg-blue`, and `--bg-mint` are the four gradient corners.
  Use them together for gradients and highlights — that's the look.
- Use `--bg-page` for the base page background (it sits behind the animated gradient).
- Use `--border-nav` for every hairline border: cards, inputs, dividers. Hairlines, not heavy strokes.
- Build the text hierarchy from `--text-color` (primary), `--text-color-accent` (muted/secondary),
  and `--text-color-inv` (text on filled/gradient buttons).
- Buttons: the primary action uses a vibrant gradient fill; the secondary action is an outline
  (`1px solid var(--border-nav)`).
- Test every change in both themes. You can flip themes from the header logo or the hamburger menu.

### Colors CSS variables can't reach

CSS variables only exist for the DOM. Anything that paints itself — Chart.js, WebGL, Phaser — needs a
real color string, so it has to read the resolved value out of the DOM:

```js
// frontend/src/pages/Projects/Annuities/useChartTheme.js
const value = getComputedStyle(document.body).getPropertyValue('--fg-mint');
// → "rgb(0, 255, 255)"        (or "#4da6ff" for a token defined as var(--other))
```

Three rules, each of which cost a real debugging session:

- **Resolve after mount, never during the first render.** On render #1 the app isn't committed and the
  theme class isn't on `<body>` yet, so `getPropertyValue()` returns `''` for every token. A canvas
  built from those values paints black — and because nothing rebuilds it, it *stays* black: almost
  plausible in light mode, invisible in dark.
- **Read from `document.body`, not `<html>`.** The theme class lives on `<body>`, and those blocks are
  what redefine the palette. `<html>` returns the light-theme default even in dark mode.
- **Rebuild on theme change.** Key the canvas on a version you bump from a `MutationObserver` on
  `body.class`; repainting an existing chart with new dataset colors is not reliable.

Also convert alpha yourself for translucent fills — `withAlpha(color, 0.16)` in that same hook handles
`rgb()`, `#rrggbb` and the `color(srgb r g b)` form Chrome returns for values derived from `color-mix()`.

### `--text-color-inv` is not "the text color for bands"

It is *inverted* text for a **filled gradient button**, so it resolves to a dark color in dark mode.
That is fine on a CTA band built from `--fg-blue`/`--fg-mint` (bright in both themes), but the
`--bg-*` gradient corners are **dark in dark mode** — band copy sitting on them must use
`--text-color`, or it will be unreadable. Same rule for hairlines drawn over a gradient:
`color-mix(in srgb, var(--text-color) 30%, transparent)`, not `--text-color-inv`.

### Key tokens

| Token | Purpose |
| --- | --- |
| `--text-color` | Primary text |
| `--text-color-inv` | Text on filled/gradient buttons |
| `--text-color-accent` | Secondary/muted text, subtitles, eyebrows, hints |
| `--bg-page` | Base page background (behind the gradient) |
| `--bg-1` | Card/input surface |
| `--bg-accent` | Subtle accent surfaces (tags, table headers) |
| `--border-nav` | Hairline borders: cards, inputs, dividers |
| `--fg-blue`, `--fg-mint`, `--fg-orange`, `--fg-pink` | Accent colors for gradients, links, focus, highlights |
| `--bg-orange`, `--bg-pink`, `--bg-blue`, `--bg-mint` | The four corners of the animated gradient |
| `--grey3-transp`, `--white1-transp` | Soft shadows / translucent overlays |
| `--shadow-sm` … `--shadow-xl` | Elevation scale — prefer `--shadow-sm`/`--shadow-md` |

### Font & spacing tokens

Use these instead of raw sizes where possible:

- `--font-size-xs`, `--font-size-small`, `--font-size-base`, `--font-size-large`,
  `--font-size-heading`, `--font-size-display`
- `--spacing-xs`, `--spacing-sm`, `--spacing-md`, `--spacing-lg`, `--spacing-xl`, `--spacing-2xl`
- `--border-radius`, `--border-radius-lg`, `--border-radius-xl`

> These are scaled by `--font-size-scale` (user-adjustable), so they keep accessibility settings intact.

---

## 3. Responsive sizing: `--nav-size` is the universal unit

The single most important convention in this codebase: **size things with `calc(var(--nav-size) * N)`**
instead of `px`/`rem`, especially for paddings, gaps, and component dimensions.

`--nav-size` is defined responsively in `index.css`:

```css
@media (orientation: landscape) {
  :root { --nav-size: min(5vw, 5svh); }
}
@media (orientation: portrait) {
  :root { --nav-size: 48px; }
}
```

So a card with `padding: calc(var(--nav-size) * 0.5)` automatically adapts between phone, tablet, and
desktop — and between landscape and portrait — without extra media queries.

### When you DO need a media query

- Use `@media (orientation: portrait)` for layout tweaks that only make sense on tall/narrow screens
  (e.g. collapsing a horizontal row into a single column).
- Use `@media (prefers-reduced-motion: reduce)` to disable entrance/background animations.

---

## 4. Canonical page template

Copy this shape for any new page. (Prefix every class with the page's own name — `foo`, `bar`, etc. —
to avoid collisions with global styles or other pages.)

### JSX skeleton

```jsx
import React, { useState } from 'react';
import Footer from '../../../components/Footer/Footer';
import Header from '../../../components/Header/Header';   // ← modern header
import SEO from '../../../components/SEO/SEO.jsx';          // ← always include
import './Foo.css';

function Foo() {
  return (
    <>
      <SEO
        title="Foo"
        description="A one-sentence description of what this page does."
        path="/foo"
      />
      <Header />

      <div className="foo">
        {/* Decorative, non-interactive background circles */}
        <div className="foo-floating" aria-hidden="true">
          <div className="foo-circle foo-circle-1" />
          <div className="foo-circle foo-circle-2" />
          <div className="foo-circle foo-circle-3" />
        </div>

        {/* Hero: eyebrow → title → subtitle → actions */}
        <section className="foo-section foo-hero">
          <div className="foo-title-wrap">
            <p className="foo-eyebrow">Calculator</p>
            <h1 className="foo-title">Foo</h1>
            <p className="foo-subtitle">Short, friendly explanation of the tool.</p>
            <div className="foo-actions">
              <button className="foo-btn" type="button">Get started</button>
              <a className="foo-btn foo-btn-outline" href="#main">Learn more</a>
            </div>
          </div>
        </section>

        <main id="main" className="foo-section">
          <div className="foo-card">
            <h2>Section Heading</h2>
            {/* inputs, buttons, results, errors go here */}
          </div>
        </main>
      </div>

      <Footer />
    </>
  );
}

export default Foo;
```

### CSS skeleton

```css
.foo {
  color: var(--text-color);
  min-height: 100vh;
  padding: calc(var(--nav-size) * 2) calc(var(--nav-size) * 0.3) calc(var(--nav-size) * 1.5);
  background: linear-gradient(-45deg, var(--bg-orange), var(--bg-pink), var(--bg-blue), var(--bg-mint));
  background-size: 400% 400%;
  animation: fooGradientShift 12s ease infinite;
  position: relative;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.light-theme .foo { animation-duration: 15s; }
.dark-theme .foo { animation-duration: 10s; }

@keyframes fooGradientShift {
  0% { background-position: 0% 50%; }
  25% { background-position: 100% 50%; }
  50% { background-position: 100% 100%; }
  75% { background-position: 0% 100%; }
  100% { background-position: 0% 50%; }
}

/* Decorative, non-interactive floating circles */
.foo-floating { pointer-events: none; position: absolute; inset: 0; z-index: 0; overflow: hidden; }
.foo-circle {
  position: absolute;
  border-radius: 50%;
  background: radial-gradient(circle, var(--white1-transp, #f4f7fd33) 0%, transparent 70%);
  animation: fooFloat 6s ease-in-out infinite;
}
.foo-circle-1 { width: 180px; height: 180px; top: 8%; left: 6%; animation-duration: 9s; }
.foo-circle-2 { width: 120px; height: 120px; top: 55%; right: 8%; animation-duration: 11s; animation-delay: -2s; }
.foo-circle-3 { width: 220px; height: 220px; bottom: 5%; left: 55%; animation-duration: 13s; animation-delay: -4s; }
@keyframes fooFloat {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  50% { transform: translateY(-24px) rotate(180deg); }
}

.foo-section {
  position: relative;
  z-index: 2;
  width: 100%;
  max-width: 760px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

/* Hero: eyebrow → title → subtitle → actions */
.foo-hero { padding: calc(var(--nav-size) * 1.5) 0 calc(var(--nav-size) * 0.75); }
.foo-title-wrap { text-align: center; max-width: 900px; margin: 0 auto; }
.foo-eyebrow {
  margin: 0 0 calc(var(--nav-size) * 0.2);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-color-accent);
}
.foo-title {
  font-weight: var(--font-weight-bold);
  letter-spacing: -0.01em;
  font-size: var(--font-size-display);
  line-height: var(--line-height-tight);
  margin: 0 0 calc(var(--nav-size) * 0.25);
}
.foo-subtitle {
  color: var(--text-color-accent);
  font-size: var(--font-size-large);
  line-height: var(--line-height-relaxed);
  max-width: 640px;
  margin: 0 auto calc(var(--nav-size) * 0.5);
}
.foo-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: calc(var(--nav-size) * 0.25);
}

/* Cards: clean surfaces, hairline border, soft shadow */
.foo-card {
  background: var(--bg-1);
  border: 1px solid var(--border-nav);
  border-radius: var(--border-radius-lg);
  box-shadow: var(--shadow-sm);
  width: 100%;
  max-width: 720px;
  padding: calc(var(--nav-size) * 0.5);
  margin-top: calc(var(--nav-size) * 0.3);
  text-align: left;
}
.foo-card h2 {
  font-size: var(--font-size-heading);
  font-weight: var(--font-weight-semibold);
  margin: 0 0 calc(var(--nav-size) * 0.25);
}
```

The header is fixed, so **the first band needs roughly `2 × --nav-size` of top padding** to clear it
(Home puts it on the hero, the skeleton above on the page root). Put it on one or the other, never on
every band — the bands would drift apart from each other.

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
.foo-band--cta {
  background: linear-gradient(45deg, var(--fg-blue), var(--fg-mint));
  color: var(--text-color-inv);
}
/* A band built from the --bg-* corners instead needs theme-aware copy: */
.foo-band--corners { background: linear-gradient(-45deg, var(--bg-blue), var(--bg-mint)); color: var(--text-color); }

/* Translucent surface for tiles that need contrast without a border. On the
   gradient-everywhere shape use the --bg-1 flavor instead, since --bg-page
   would hide it: color-mix(in srgb, var(--bg-1) 55%, transparent) */
.foo-tile { background: color-mix(in srgb, var(--fg-blue) 7%, transparent); }
.foo-tile:hover { background: color-mix(in srgb, var(--fg-blue) 12%, transparent); }
```

**Put one reveal on the band, not on each card inside it** — wrap the band in a tiny local component
that calls `useScrollReveal` and renders `{children}` into the wrap. `RevealBand.jsx` in
`frontend/src/pages/Projects/Annuities/` is the reference (tones: `surface | tint | wash | cta`).

**Borders are for controls only.** Inputs, selects, pills and buttons keep a hairline; containers,
readouts, tiles and tables do not. Separate them with whitespace, a `border-top: 1px solid
var(--border-nav)` rule, or a tone change — never with a box.

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
- `loading="lazy"` and `alt=""` when decorative.

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
[`STATIC_ASSETS_AND_IMAGE_GENERATION.md`](./STATIC_ASSETS_AND_IMAGE_GENERATION.md);
the short version for repo assets:

```bash
# No server, no JWT needed — reads credentials from backend/.env directly.
node backend/scripts/generate-project-art.js          # all project cards
node backend/scripts/generate-project-art.js pets     # or just these slugs
```

Rules that keep generated art consistent with the existing set:

- The generator returns **PNG**; `frontend/src/assets/art/` is all **`.jpg`**. Convert
  (`sharp`, quality ~90, `mozjpeg`) and delete the PNG before checking in.
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

## 6. Standard component recipes

### Buttons

- **Primary** (the main action): vibrant gradient fill, inverted text.
- **Outline** (secondary, e.g. "Learn more"): transparent with a hairline border.
- Both are **pills** (`border-radius: 999px`) with a subtle hover lift.

```css
.foo-btn {
  font-family: inherit;
  font-weight: var(--font-weight-semibold);
  font-size: var(--font-size-base);
  letter-spacing: 0.02em;
  border-radius: 999px;
  padding: calc(var(--nav-size) * 0.2) calc(var(--nav-size) * 0.55);
  cursor: pointer;
  border: 1px solid transparent;
  color: var(--text-color-inv);
  background: linear-gradient(45deg, var(--fg-blue), var(--fg-mint));
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.foo-btn:hover { transform: translateY(-1px); box-shadow: var(--shadow-md); }
.foo-btn-outline {
  background: transparent;
  color: var(--text-color);
  border-color: var(--border-nav);
}
.foo-btn-outline:hover { background: var(--bg-accent); box-shadow: none; }
```

#### ⚠️ First, the global element styles you inherit

`frontend/src/index.css` styles bare elements, and those rules will fight your components:

| Selector | What it sets |
| --- | --- |
| `button` | gradient fill, `--text-color-inv` text, `2px transparent` border, `min-height: 44px`, `position: relative`, `overflow: hidden` |
| `button:hover:not(:disabled)` | **the site's blue→mint gradient and inverted text** |
| `input`, `select`, `textarea` | `2px solid var(--border-nav)`, `var(--bg-1)`, `min-height: 44px`, `padding: var(--spacing-sm)` |
| `input:focus`, … | the shared focus outline + a blue box-shadow |

The trap is **specificity**. `.foo-btn:hover` is `(0,2,0)`; `button:hover:not(:disabled)` is
`(0,2,1)` — so the global rule wins and *every* control on your page turns into the site gradient on
hover, including outline and text buttons.

Fix it by matching the shape, not by fighting it with `!important`:

```css
.foo-btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: var(--shadow-md); }
/* keep an active state solid while hovered */
.foo-pill:not(.is-active):hover:not(:disabled) { border-color: var(--fg-blue); }
```

Note the `min-height: 44px`: it is a good touch target for buttons, but zero it on compact controls —
Home's dots and carousel arrows both carry an explicit `min-height: 0; /* undo global button
min-height:44px */`. Because `button` also sets `overflow: hidden` and `position: relative`, a caret or
badge inside a button will be clipped unless you let it out.

### Gradient text (large display type only)

The accent gradient makes a big number or heading feel like the site, but it is text pretending to be an
image, so it carries three caveats:

```css
.foo-stat-value {
  background: linear-gradient(45deg, var(--fg-blue), var(--fg-mint));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
```

- **Display type only** — never body copy, a label, or anything under ~`--font-size-large`. A gradient
  crossing a small glyph destroys contrast, and it cannot be measured by an accessibility checker.
- **Keep a plain state for plain values.** A readout that can be empty or a placeholder (`—`) needs a
  `color`-based variant (`.is-empty`), or the dash renders as invisible transparent text.
- **Animated gradients are for one hero element at a time** (`background-size: 300% 300%` plus a slow
  keyframe over `background-position`), and the element must be inside the `prefers-reduced-motion`
  reset like everything else.

### Inputs

```css
.foo-input {
  flex: 1;
  min-width: 120px;
  font-family: inherit;
  font-size: var(--font-size-base);
  padding: calc(var(--nav-size) * 0.18) calc(var(--nav-size) * 0.25);
  border-radius: var(--border-radius);
  border: 1px solid var(--border-nav);
  background: var(--bg-1);
  color: var(--text-color);
}
.foo-input:focus { outline: none; border-color: var(--fg-blue); }
```

### Inline error

```css
.foo-error {
  padding: calc(var(--nav-size) * 0.2);
  border-radius: var(--border-radius);
  border: 1px solid var(--red0);
  background: rgba(220, 0, 0, 0.12);                              /* fallback */
  background: color-mix(in srgb, var(--red0) 12%, transparent);
  color: var(--text-color);
  font-size: var(--font-size-small);
  font-weight: var(--font-weight-semibold);
}
```

### Card grid (feature grids)

Squarespace-style feature grids: equal tiles, hairline borders, no glass.

```css
.foo-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: calc(var(--nav-size) * 0.35);
  width: 100%;
}
.foo-grid .foo-tile {
  background: var(--bg-1);
  border: 1px solid var(--border-nav);
  border-radius: var(--border-radius-lg);
  box-shadow: var(--shadow-sm);
  padding: calc(var(--nav-size) * 0.4);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.foo-grid .foo-tile:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); }
```

### Result readout

Center the answer prominently with a muted label and a large value.

### Header slot (sub-navigation)

`Header` accepts an optional `center` node, rendered *inside* the fixed header band
between the logo and the menu, horizontally centred. Use it for a page's own
sub-navigation or mode switcher:

```jsx
<Header center={<SimpleNav compact />} />
```

It is absolutely positioned and `pointer-events: none` (only the node itself is
clickable), so it never widens the header or pushes the page down. **Prefer this to
a second nav row** — a stacked bar costs ~57px on every page and reads as a second
header. It hides below `820px`, so anything placed there must also be reachable from
`HeaderDropper` on phones.

---

## 7. Page anatomy checklist

- [ ] `SEO` component present with `title`, `description`, and correct `path`.
- [ ] Uses `Header` (the modern header) — **not** the legacy `NavBar`.
- [ ] The animated gradient is present — either as the page root or bookending the hero and closing
      band — with floating circles in the hero (§5).
- [ ] Hero `section` → `title-wrap` (`eyebrow` → `h1` → `subtitle` → optional `actions`).
- [ ] Content sits on full-bleed bands rather than in cards; borders are reserved for compact controls
      (§5).
- [ ] `Footer` rendered at the bottom.
- [ ] Project pages include a "View Source Code" link to the correct GitHub path.
- [ ] All classes prefixed with the page name.
- [ ] Works in light **and** dark theme.
- [ ] Looks right in landscape **and** portrait, at desktop, tablet, and phone widths.
- [ ] `prefers-reduced-motion` disables entrance/background animation.
- [ ] Keyboard: every interactive element is focusable; focus is visible.
- [ ] **Only compact controls carry a border** — no container, readout, tile or table does (§5).
- [ ] **Hover and focus survive `index.css`** — page `:hover` rules repeat `:not(:disabled)` (§6).
- [ ] **Canvas-based visuals re-resolve their colors** when the theme changes, and were read after
      mount (§2).
- [ ] **No band copy uses `--text-color-inv`** on a `--bg-*` gradient corner (§2).
- [ ] Interactive states were eyeballed, not assumed: hover, focus, active, empty, disabled (§10).
- [ ] **Above-the-fold motion is time-driven, not observer-driven**, and the animated headline is not
      the `<h1>` — the real heading is `.sr-only` (§5).
- [ ] **A counting number lands exactly on its target**, and skips the animation under
      `prefers-reduced-motion` (§5).
- [ ] **Carousel arrows and dots are labelled `<button>`s**, step by pixels rather than index, and zero
      the global `min-height` (§5).

---

## 8. Do's and don'ts

### ✅ Do

- Use `calc(var(--nav-size) * N)` for paddings, gaps, and component sizes.
- Use tokens for every color — `--text-color`, `--bg-1`, `--border-nav`, `--fg-blue`.
- Use the vibrant accents (`--fg-blue`, `--fg-mint`, `--fg-orange`, `--fg-pink`) for gradients, links, and highlights.
- Keep buttons vivid: primary gradient fill, secondary outline (`1px solid var(--border-nav)`).
- Use `Link` (from `react-router-dom`) for **internal** navigation.
- Use `<a target="_blank" rel="noopener noreferrer">` for **external** links.
- Validate user input and show a friendly inline error.
- Keep state minimal and local (`useState`) unless data must be shared.
- Give the answer/result an `aria-live` region when it changes without focus moving.
- Use the shared `useScrollReveal` hook for scroll-triggered fade/rise entrances (section 5) instead of a bespoke observer.
- Give cards a combined lift + scale + shadow + accent-border hover response (section 5) — a single `transform` alone feels flat.
- Read theme colors for canvas/WebGL from `document.body` **after mount**, and key the canvas on a theme version so it rebuilds (section 2).
- Disable every animation and transition in the `prefers-reduced-motion` block, including any new `:not(:disabled)` hover selectors you add.

### ❌ Don't

- Don't use `NavBar` on new/refactored pages — it's the legacy header.
- Don't use monochrome/grayscale fills on primary buttons or page backgrounds — keep the vibrant gradient.
- Don't stack `backdrop-filter` glassmorphism on cards; use a hairline border + soft shadow instead.
- Don't use `Times New Roman` or other hardcoded font families; inherit the app font.
- Don't call a state setter directly in `onClick` with the raw event (e.g. `onClick={setFoo(now)}`
  calls `setFoo` during render and passes the event object — wrap it: `onClick={() => setFoo(now)}`).
- Don't reference image assets with `require("...png")` unless the file actually exists in `assets/`.
- Don't reuse IDs across pages (old pages had `#ethanol-calculator-submit` copy-pasted into other pages).
- Don't hardcode hex colors anywhere.
- Don't write a page `:hover` rule without `:not(:disabled)` — the global `button:hover:not(:disabled)` is more specific and will repaint your control with the site gradient (section 6).
- Don't resolve CSS variables for a canvas during the first render — they are all empty strings until the theme class lands on `<body>` (section 2).
- Don't put band copy on a `--bg-*` gradient corner in `--text-color-inv`; that token is dark in dark mode (section 2).

---

## 9. Reference implementations

> ⚠️ The calculator pages share the same vibrant gradient palette, but predate the editorial structure
> in this standard (eyebrow labels, pill buttons, hairline borders). Use them for **structure** (SEO,
> Header/Footer, card anatomy, input validation, state management) — then apply the new hero/button
> recipes on top. **Annuities** is the one row below that already follows this standard.

| Page | Path | Notes |
| --- | --- | --- |
| Ethanol Calculator | `frontend/src/pages/Projects/Ethanol/` | Full template: gradient, floating circles, presets, inputs, errors, result cards, log |
| Sonic | `frontend/src/pages/Projects/Sonic/` | Same template with live status dot, tuner meter, spectrum bars |
| Halfway | `frontend/src/pages/Projects/Halfway/` | Template + midpoint/end/start modes, tolerant 24h & 12h parsing, shareable result URLs, solar-times card (logic in `halfwayUtils.js`, unit tested) |
| Projects hub | `frontend/src/pages/Projects/Projects/` | Card-grid variant with search + category filters (closest to the new editorial grid) |
| Home | `frontend/src/pages/Home/Home.jsx` | Gradient hero + typewriter headline + counted stats + paginated carousel. **The source for §5's motion recipes** — typing, counting and the carousel are all documented from here |
| Annuities | `frontend/src/pages/Projects/Annuities/` | **Built entirely to this standard** — full-bleed bands via a local `RevealBand`, borderless surfaces, staggered reveals, and a theme-aware canvas chart (`useChartTheme.js`) |

The earlier entries predate the editorial structure; **Annuities is the markup reference for it.** When
in doubt about how a band, a staggered reveal, a borderless readout or a themed canvas should be built,
copy from there rather than re-inventing it — the older pages will lead you back to cards.

---

## 10. Quick pre-merge checklist

### Verifying an authenticated page

Most pages sit behind login, so a logged-out eyeball only proves the hero renders.
**Agents and humans should log in to the shared demo account and click through the
real thing** — "Continue as Guest" on `/login`, or `guest@gmail.com` / `guest`
(`backend/constants/guestAccount.js`). It already has workspace data (goals, plans,
actions, notes), so lists, filters, and empty states can be checked for real.

- It's a **shared, public** account — delete any data you create while testing.
- Validate **light + dark** and **phone → tablet → desktop** before calling a page done.
- Check the interactive states a screenshot hides: hover, focus, disabled, empty,
  loading, and any confirmation dialog.

1. `npm run build` (or at least the dev server) compiles cleanly.
2. Manually toggle light/dark and eyeball text contrast, borders, and button fills.
3. Resize the window through phone → tablet → desktop and check nothing overflows or clips.
4. Tab through the page and confirm focus outlines are visible on every control.
5. **Hover every control in both themes.** Hover is where the global `button` rules bite (§6), and it
   is the state a screenshot never shows.
6. **Check anything on a gradient band in dark mode.** The `--bg-*` corners go dark, so copy that reads
   fine in light mode can disappear there.
7. **Canvas visuals: verify by eye.** `getImageData()` returns an all-black buffer in the agent browser
   tool regardless of what was drawn, so a pixel readback will "prove" a working chart is broken — take
   a screenshot instead.
