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

### Two kinds of page — know which one you're building

Every rule below serves one of two jobs, and mixing them up is the most common way a page
ends up wrong. Decide first, then read §5.7 if you're building the second kind.

| | **Discovery page** | **Service page** |
| --- | --- | --- |
| Examples | `/`, `/projects`, project pages, `/pricing` | `/simple`, `/plans`, `/net`, `/profile`, `/u/<username>` |
| Job | Convince a stranger the product is worth trying | *Do the job* for someone who already showed up |
| Hero | Marketing: eyebrow → big `<h1>` → subtitle → CTAs | A **row** at the top: name + live state + primary action — in the flow, never pinned |
| Copy | Persuasive; explains the product | Labels only; a hint under a control at most |
| Layout | Full-bleed bands, one idea each | **No bands** — one flat surface, a dense panel grid |
| Ends on | A CTA band (`SimpleCtaBand`) | The last panel — no pitch, nothing to scroll past |
| Depth | Generous — scrolling is the point | Dense — the tool is above the fold, always |

**Discovery pages sell. Service pages serve.** A service page that opens with a paragraph
about itself has spent attention on the wrong thing, and every extra screen is a tool the
user has to hunt for. Read §5.7 before building one — the rules invert.

---

## 2. How theming works

All colors come from CSS custom properties defined in `frontend/src/index.css`.

- Base/font/spacing tokens live on `:root`.
- The `<body>` element carries **one** of two theme classes:
  - `.light-theme`
  - `.dark-theme`
- The header theme toggle (see `components/Header/Header.jsx` and `utils/theme.js`) swaps the class
  and persists the choice to `localStorage('theme')`.
- `<body>` also carries `data-scheme` — one of the ids in `utils/scheme.js` — which decides *which* two
  hues are the accent and the primary. It is device-local and independent of light/dark.

### Both are painted before the first frame

The mode class and the scheme attribute are applied by a small inline script at the top of
`frontend/index.html`, before `index.jsx` (a deferred module) runs. React can't do it: both used to be
applied in the shared header's **mount effect**, which lands *after* the first paint — so the page
painted the default palette and then jumped to the visitor's, most visibly on a lazy route like `/net`,
whose chunk is still being fetched while that first frame is on screen.

Two things to know about that script:

- **It is deliberately dumb, and it is not the authority.** It copies the storage shape and nothing else:
  `theme` → the class (resolving `system` against the OS), `scheme` → `data-scheme`, plus the inline
  `--scheme-hue-*` pair when the id is `custom`. `initTheme()` and `initScheme()` still run on mount and
  settle everything — they validate the id and they own the repaint. Change the storage shape in
  `utils/theme.js` / `utils/scheme.js` and change it there too.
- **It writes the scheme id unvalidated**, because the id list lives in `utils/scheme.js` and must not be
  copied into HTML. That is only safe because `body[data-scheme]` in `index.css` **seeds** the two
  identity hues: an id no scheme is named for degrades to the theme's default pair instead of collapsing
  the whole accent chain (see the note on that block).

A visitor with **nothing stored** still gets one frame of the default palette — the script has no id to
paint, so the default scheme only lands when `initScheme()` runs on mount. That is why the backdrop
fallbacks in “Pages that *are* their own gradient” (_below_) are not decoration.

### Rules for theming

- **Never** hardcode a color (`#fff`, `black`, etc.) in page CSS. Always use a token.
- Keep the vibrant palette: `--fg-blue`, `--fg-mint`, `--fg-orange`, and `--fg-pink` are the accent
  colors; `--bg-orange`, `--bg-pink`, `--bg-blue`, and `--bg-mint` are the four gradient corners.
  Use them together for gradients and highlights — that's the look.
- Use `--bg-page` for the base page background (it sits behind the animated gradient).
- **Prefer a tone change to a border** — colors beside colors, not lines (§5). `--border-nav` is the
  fallback for a neutral edge that can't be expressed as color, never the default treatment.
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
That is fine on a control filled with `--fg-blue`/`--fg-mint` (bright in both themes), but the
`--bg-*` gradient corners are **dark in dark mode** — band copy sitting on them must use
`--text-color`, or it will be unreadable. Same rule for hairlines drawn over a gradient:
`color-mix(in srgb, var(--text-color) 30%, transparent)`, not `--text-color-inv`.

Which is why a **full-bleed band takes the colour scheme, and the page-relative half of it**. The CTA
band's two stops are `--scheme-accent-bg` → `--scheme-primary-bg` — the same pair `/profile` wears —
not the saturated `--scheme-accent`/`--scheme-primary`. Those carry the hue at a lightness chosen for a
*small* field, so a band built from them has to be either re-pinned in lightness or inked with
`--text-color-inv`, and either way it gets *brighter* as the page gets darker. The `-bg` pair mixes each
hue into **this mode's** page colour, so the band is pale on a light page and deep on a dark one, and
its copy is plain `--text-color`. `SimpleCtaBand` and /about's contact band are the two reference cases.

### Pages that *are* their own gradient: the alias block

`/login` and `/register` are the case worth knowing, because their page root **is** the four-stop
backdrop and they are usually a visitor's first, cold load of the site. They follow the scheme the way
every other converted gradient page does (`Pricing.css`, `Projects.css`, `/support`, `/about`) — by
re-pointing the four corner names and the two accents, which is the whole change, because the page was
already written against them:

```css
.foo-page {
  --fg-blue: var(--scheme-accent);
  --fg-mint: var(--scheme-primary);
  /* BACKDROP tokens, not `--scheme-*-bg`: a full-bleed field has to pin its
     lightness per mode, or a pale identity hue is far too light on a dark page */
  --bg-orange: var(--scheme-backdrop-a, var(--scheme-accent-bg));
  --bg-pink:   var(--scheme-backdrop-b, var(--scheme-primary-bg));
  --bg-blue:   var(--scheme-backdrop-a, var(--scheme-accent-bg));
  --bg-mint:   var(--scheme-backdrop-b, var(--scheme-primary-bg));
}
```

- **`--fg-orange` is deliberately not aliased** — orange is the alert hue, the one colour that must not
  follow the decor. `--bg-orange` *is*, because it only appears in the decorative backdrop.
- **The `-bg` fallback is not decoration.** `index.html` paints the stored scheme before the first frame
  (§2), but that frame can still arrive with no `--scheme-backdrop-*` at all: a visitor with **nothing
  stored** has no id to paint, so the default scheme only lands when `initScheme()` runs on mount — and a
  browser where `localStorage` throws, or a stored id no scheme is named for, has the same problem.
  Without the fallback the entire `background` declaration is invalid on that frame and the page flashes
  with no backdrop at all.
- **A scheme needs no account.** It is device-local — `utils/scheme.js` keeps it in `localStorage` and
  the shared `Header` paints it — so it applies on `/login` and `/register` exactly like light/dark.
- **The primary is the scheme's ramp, at a pinned lightness** (`--login-btn-l-*`, and the same move the
  band makes): a scheme's identity hues are chosen for contrast *on a page*, so white on Cyberpunk's
  yellow at its page lightness does not read. Measured across the thirteen schemes, the worst cell is
  **6.14:1**. An un-pinned ramp would make the picker's most visible control the only one that stopped
  following it — don't "restore" it to a plain gradient.
- ⚠️ **Never put a control's label on a wash of its own hue.** Tinting the sign-in card
  (`color-mix(in srgb, var(--fg-blue) 7%, var(--bg-1))`) cost the accent-coloured links about a stop:
  the worst scheme measured **4.38:1** — under AA — against **4.84:1** or better on the plain `--bg-1`
  card every other page uses. The scheme belongs in the backdrop *behind* a card and in the controls
  *on* it, not in the surface underneath text.

**Watch the global `input:invalid` on a form.** `index.css` paints every invalid input with
`border-color: var(--red0)`, and a `required` field is invalid while it is *empty* — so a sign-in form
can greet a first-time visitor with red-ringed boxes and read as broken before they have typed
anything. Pages that track their own attempt state (`/login`) opt out with
`.foo-input:invalid { border-color: var(--border-nav); }` and keep the red for a real failure.

### Key tokens

| Token | Purpose |
| --- | --- |
| `--text-color` | Primary text |
| `--text-color-inv` | Text on filled/gradient buttons |
| `--text-color-accent` | Secondary/muted text, subtitles, eyebrows, hints |
| `--bg-page` | Base page background (behind the gradient) |
| `--bg-1` | Card/input surface |
| `--bg-accent` | Subtle accent surfaces (tags, table headers) |
| `--border-nav` | Neutral hairline — the **fallback**; prefer a tone change (§5) |
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
[`STATIC_ASSETS_AND_IMAGE_GENERATION.md`](./STATIC_ASSETS_AND_IMAGE_GENERATION.md);
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
  /* A primary control is the scheme's ACTION ramp: ONE hue with its lightness
     pinned per mode (`--action-hi`/`-lo`), which is what lets the label above
     clear AA on every scheme — a raw `--fg-blue` → `--fg-mint` fill is bright in
     both themes and only readable at one end. Fallback line first: relative
     color syntax is what `--action` is built from. */
  background: linear-gradient(45deg, var(--scheme-accent), var(--scheme-primary));
  background: var(--action);
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
| `button` | **the scheme's action ramp** (`--action`), `--text-color-inv` text, `2px transparent` border, `min-height: 44px`, `position: relative`, `overflow: hidden` |
| `button:hover:not(:disabled)` | **the same ramp reversed** (`--action-hover`) and inverted text |
| `a:hover` | the scheme's partner hue as the link ink — `(0,1,1)`, so your own hover must NAME its colour to beat it |
| `input`, `select`, `textarea` | `2px solid var(--border-nav)`, `var(--bg-1)`, `min-height: 44px`, `padding: var(--spacing-sm)` |
| `input:focus`, … | the shared focus outline, a `--scheme-accent` edge and a scheme-tinted box-shadow |

The global defaults follow the visitor's **colour scheme**, so a page that keeps them lands in the
scheme for free. The legacy `--fg-blue`/`--fg-mint` pair is no longer what a bare control paints —
reach for `var(--action)` for a filled control, and keep `--fg-blue`/`--fg-mint` where a page has
deliberately not been converted yet.

The trap is **specificity**. `.foo-btn:hover` is `(0,2,0)`; `button:hover:not(:disabled)` is
`(0,2,1)` — so the global rule wins and *every* control on your page turns into the scheme's action
ramp on hover, including outline and text buttons.

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

### Segmented control — a switcher of places

`SimpleNav` (the header's room switcher) and `/plans`' view switch are the same
control: a track with the current item raised out of it. Four rules make it read as
one control rather than a row of links with one highlighted.

- **The active segment is a PLACE, not an action.** It must not wear the action ramp
  — a page you are already on is not a button to press, and it makes the current
  location the loudest thing in the chrome. Use a tint of `--scheme-primary` over
  `--bg-1` with plain `--text-color` ink:
  `.plans-switch-btn.is-active { background: color-mix(in srgb, var(--scheme-primary) 20%, var(--bg-1)); }`.
  The header switcher uses 40% instead of 20%, because its track is translucent and
  sits over a tinted room — at 20% the step from the track was ~1.2:1 in light mode.
- **Muted ink for the items you are not on** (`--text-color-accent`), full ink for
  the current one. The fill alone is not reliable: a near-white track and a light
  tint can be within 1.8:1 of each other.
- **The track is a surface (`--bg-1`), never a film of the ink.** The header is
  transparent and `/net`'s room paints a scheme-tinted backdrop behind it, so a
  translucent control takes on that tint whole — in light mode the pill went from a
  grey control to a saturated cyan bar whose track out-shouted its own selected
  segment. Controls keep `--bg-1` (§5.7). The track gets no border and no shadow: a
  groove is a tone difference, and it does not float (§5).
- ⚠️ **An `inline-flex` item inside a block-level `<li>` carries ~5px of phantom
  height.** The `<li>` gets a line box, so it is taller than the link it contains by
  the descender space under the baseline — enough that the *container* was setting
  the control's height rather than its segments (41px of pill around 10.5px labels).
  `li { display: flex }` removes the line box. Same trap for any inline-level box in
  a block parent.
- ⚠️ **Restate the ink on your `:hover`.** The global `a:hover` is `(0,1,1)` and
  paints every anchor in the scheme's *partner* hue — on an active segment (a tint of
  the scheme) that is one hue on a tint of itself.

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
- [ ] **Nothing is separated by a line that could be separated by a tone** — colors beside colors, no
      outlines, no per-row hairlines (§5).
- [ ] **Adjacent blocks differ in tone**, and each block's head/footer derive from its own hue (§5).
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
- [ ] **Service page? No bands, no gradient background behind data, no circles, no scroll reveals.**
      One flat surface, a row at the top carrying the name + live state + primary action, and a dense
      panel grid (§5.7). **Nothing of the page's own is pinned** — only the site header stays.
- [ ] **Service page? The primary tool is above the fold at 1366×768** and reachable without scrolling,
      and nothing on screen is a sentence that could be a label (§5.7).

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
- Ask which kind of page you're building before styling anything: a Discovery page sells, a service page
  serves (§1, §5.7).
- Separate with color: alternating tints, a stronger wash on a head or footer, a hue per block (§5).
- Debug authenticated pages with the shared guest account — "Continue as Guest" on `/login`, or
  `guest@gmail.com` / `guest` (§10) — and delete whatever you create in it.

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
- Don't open a service page with a subtitle describing the page, don't decorate it with bands or
  circles, and don't make the user scroll to reach the tool — it is already open in front of them (§5.7).
- Don't add a scroll reveal or a stagger to a service page: content that fades in is content that
  arrives late on a page whose whole point is "help me now". Motion there means *state changed* (§5.7).
- Don't reach for a border to separate two things — a tone change does the same job and looks
  deliberate (§5). Don't stack a fill, a border and a shadow on one block either.

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
| Control (`/simple`) | `frontend/src/pages/Simple/Simple/` | **Service page (§5.7)** — name/state/action row + dense panel grid on one flat surface, no bands, nothing pinned |
| Goals (`/plans`) | `frontend/src/pages/Simple/Plans/` | **Service page (§5.7)** — same shape: live state in the top row, panels grouped into grid rows |
| Dream board (`/plans` 🌟) | `frontend/src/pages/Simple/Plans/DreamBoard.jsx` | **Service page view (§5.7)** — a third tab over the *same* goals: a cover-art tile grid where each tile is a goal you can hand to the agent. Panels stay colour planes; no bands, no reveals. Covers are real artwork (`assets/art/dream-*.jpg`), never emoji tiles (§5) |
| Member page (`/u/<username>`) | `frontend/src/pages/UserProfile/` | **Service page (§5.7)** — the page a member sends someone. One row (face + name + live state + the one action, which differs for the owner, a connection, a signed-in stranger and a signed-out visitor) over a dense glass-pane grid. The owner's own state is the only thing hidden from visitors: no `Page` chip, no `Your page` panel |

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
