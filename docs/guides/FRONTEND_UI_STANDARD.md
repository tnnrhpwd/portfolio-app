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
/* The ink is named, and the fill with it: this class is worn by a <Link> as often
   as by a <button> — see the anchor trap below. */
.foo-btn:hover:not(:disabled) {
  color: var(--text-color-inv);
  background: var(--action-hover);
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}
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
| `a:hover` | the scheme's emphasis hue as the link ink — `(0,1,1)`, so your own hover must NAME its colour to beat it. A **filled pill styled as a `<Link>`** is where this bites hardest — see the anchor trap below |
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
/* Carry the ink too whenever the class is (or could be) worn by an <a>. */
.foo-btn:hover:not(:disabled) { color: var(--text-color-inv); transform: translateY(-2px); box-shadow: var(--shadow-md); }
/* keep an active state solid while hovered */
.foo-pill:not(.is-active):hover:not(:disabled) { border-color: var(--fg-blue); }
```

Note the `min-height: 44px`: it is a good touch target for buttons, but zero it on compact controls —
Home's dots and carousel arrows both carry an explicit `min-height: 0; /* undo global button
min-height:44px */`. Because `button` also sets `overflow: hidden` and `position: relative`, a caret or
badge inside a button will be clipped unless you let it out.

#### ⚠️ A filled control is often an `<a>`, not a `<button>` — so name its ink on `:hover`

Styling a *route change* as the primary pill is normal —
`<Link className="foo-btn foo-btn--primary">Message</Link>`. It is also the case that keeps breaking,
because `button:hover:not(:disabled)` matches only a real button: the anchor falls through to the
**bare `a:hover`** above, which is `(0,1,1)` and out-ranks the `(0,1,0)` `color` the class just set. The
label is repainted in `--scheme-primary` — *the very hue `--action` is built from*, at the same chroma
and a near-identical lightness:

| Mode | fill (`--action`'s two stops) | hover ink (`--scheme-primary`) |
| --- | --- | --- |
| light | `oklch(from var(--scheme-primary) 0.50 c h)` → `0.40` | `oklch(from var(--scheme-hue-primary) 0.52 …)` |
| dark | `0.82` → `0.72` | `0.76` |

ΔL 0.02 at the ramp's light end: the hovered word is a *slightly lighter patch of its own pill*, and on
`/talk` the **Message** button's label simply disappeared as the cursor reached it. One line on the
class fixes it, and it fixes it for both tags:

```css
.foo-btn--primary:hover:not(:disabled) {
  /* The ANCHOR needs the ink named; the `<button>` siblings were getting it from
     the global `button:hover`. Naming it here makes the two behave identically. */
  color: var(--text-color-inv);
  background: var(--action-hover);   /* the same ramp, its stops swapped */
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}
```

- **Put it on the class, not on `a.foo-btn`.** One class is usually worn by both — `/talk`'s
  `Accept` and `+ Send request` are buttons while `Message` is a link, and the point is that all
  three hover the same way.
- **Naming the fill is the second half of the fix.** The global `button:hover` was already giving the
  button variants `--action-hover`; the anchor kept a flat fill, so hover read differently depending
  on which tag the control happened to be — a difference nobody wrote on purpose.
- **Only `:hover` is affected.** `a:focus` sets an outline and a tint but no colour, and `a:active`
  only zeroes the lift, so the label stays inverted in those states.
- **Ghost and outline variants have the same duty**: name `var(--text-color)` on their hover, or the
  scheme repaints them. The segmented control carries the same note in §6.

`/u/<username>` is the worked example — `.up-btn--primary:hover:not(:disabled)` in `UserProfile.css`,
comment included. **`/talk` was the case that got missed**, in a class worn by a `<Link>` on exactly
one of its four uses.

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
- [ ] **Every class a `<Link>` wears names its colour on `:hover`** — a filled pill's label must not be
      left to the global `a:hover`, which paints it in `--scheme-primary`, the hue its own fill is made
      of. If the class is shared with a `<button>`, name the fill too (§6).
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
- Don't leave a link-styled control's `:hover` ink to `index.css`: `a:hover` is `(0,1,1)` and repaints
  it in `--scheme-primary` — the hue the pill is filled with — so a "Message" link vanishes as the
  cursor arrives (§6).
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

---

## 11. Design records — dated UI passes

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
  `--text-color-accent` to `--plane-muted` (the contrast work in `special-user-flag.md` → *Making the Special tier actually reachable*).
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
  contrast measurements from `special-user-flag.md` → *Making the Special tier actually reachable* — not eyeballed screenshots. Worth a look on a real
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
them), and bring the dashboard onto [`FRONTEND_UI_STANDARD.md`](../guides/FRONTEND_UI_STANDARD.md)
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
  `/net`; the change is one element plus CSS. `docs/guides/FRONTEND_UI_STANDARD.md` §5.7 gains "The app
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
- `SALES_FUNNEL.md` → *The three Simple surfaces are one journey* is the current-state description of this switcher and was updated with it; the sections
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

