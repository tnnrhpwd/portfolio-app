# Frontend UI Standard

> **Single source of truth for how every page in `frontend/src/pages` should look and behave.**
> Read this before creating a new page or refactoring an old one so every page stays visually
> consistent, follows the visitor's **colour scheme** in both light and dark mode, and scales across
> all display sizes.

---

## 1. The goal

Our visual language is **"vibrant editorial"** — Squarespace's structure and feel (typography-led
hierarchy, eyebrow labels, uppercase letter-spaced buttons, full-bleed color bands, generous sizing,
subtle motion) layered on top of our own **vibrant gradient** palette.

Every page should be **"very very very good UI"** — meaning:

1. **Scheme-first** — colors adapt automatically to the visitor's **colour scheme** *and* to light/dark mode, with zero hardcoded colors (§2.1).
2. **Responsive by token** — nothing is sized in raw pixels; everything scales off one unit (`--nav-size`).
3. **Vibrant + animated** — the animated gradient background is our signature; keep it. It is the **scheme's** two hues now, not four fixed ones (§2.1).
4. **Typography-led** — clear hierarchy: eyebrow label → big heading → subtitle → content.
5. **Structured feel** — flat color-to-color band transitions, soft shadows, uppercase letter-spaced buttons, and subtle hover motion (Squarespace's feel, not its colors).
6. **Consistent anatomy** — every page follows the same structural template (section 4).
7. **Accessible** — semantic markup, visible focus states, `aria-*` where useful, and `prefers-reduced-motion` support.

### Two kinds of page — know which one you're building

Every rule below serves one of two jobs, and mixing them up is the most common way a page
ends up wrong. Decide first, then read §5.7 if you're building the second kind.

| | **Discovery page** | **Service page** |
| --- | --- | --- |
| Examples | `/`, `/projects`, project pages, `/pricing` | `/simple`, `/plans`, `/net`, `/profile`, `/admin` |
| Job | Convince a stranger the product is worth trying | *Do the job* for someone who already showed up |
| Hero | Marketing: eyebrow → big `<h1>` → subtitle → CTAs | A toolbar: name + live state + primary action |
| Copy | Persuasive; explains the product | Labels only; a hint under a control at most |
| Layout | Full-bleed bands, one idea each | **No bands** — one surface, a dense panel grid |
| Colour | Bands tinted from the scheme; a full-bleed backdrop from `--scheme-backdrop-*` | Glass panes over the scheme's **room**; a hue means something (§5.7) |
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
  - …and a `data-scheme="…"` attribute for the colour scheme (§2.1) — a **separate axis**.
- The header theme toggle (see `components/Header/Header.jsx` and `utils/theme.js`) swaps the class
  and persists the choice to `localStorage('theme')`.

### Rules for theming

- **Never** hardcode a color (`#fff`, `black`, etc.) in page CSS. Always use a token.
- The brand families are `--fg-blue`, `--fg-mint`, `--fg-orange`, `--fg-pink` (accents) and
  `--bg-orange`, `--bg-pink`, `--bg-blue`, `--bg-mint` (the four gradient corners) — but those are the
  theme's **defaults**, not the final word. A page a visitor should be able to re-colour reads
  `--scheme-*` instead (§2.1).
- Use `--bg-page` for the base page background (it sits behind the animated gradient).
- **Prefer a tone change to a border** — colors beside colors, not lines (§5). `--border-nav` is the
  fallback for a neutral edge that can't be expressed as color, never the default treatment.
- Build the text hierarchy from `--text-color` (primary), `--text-color-accent` (muted/secondary),
  and `--text-color-inv` (text on filled/gradient buttons).
- Buttons: the primary action uses a vibrant gradient fill; the secondary action is an outline
  (`1px solid var(--border-nav)`).
- Test every change in **both themes *and* at least two schemes** — `Ocean` (the default), `Neutral`
  (the one with no hue), and a Custom pick. You can flip themes from the header logo or the hamburger
  menu; the scheme picker is on `/profile`.

### 2.1 Colour schemes — which hues, on a second axis

A visitor picks **two** things, and they are independent:

| Axis | Question | Carried by | Picker |
| --- | --- | --- | --- |
| **Mode** | how light is the surface? | `.light-theme` / `.dark-theme` on `<body>` | header logo, hamburger, `/profile` |
| **Scheme** | *which* hues sit on it? | `data-scheme="…"` on `<body>` | `/profile` (and the addon's own picker) |

Every scheme therefore has **both** a light and a dark version — the scheme owns the hue *angles* only,
and `index.css` derives everything else per mode — so there is no second palette to author. Twelve
named presets plus a **Custom** pair the visitor builds: `frontend/src/utils/scheme.js` owns the list,
the storage and the **one** place that writes `data-scheme`; `index.css` owns the derivation; `Header`
calls `initScheme()` on mount, so every page gets it — not just the one with the picker on it.

**Never let a brand hue come from `--fg-*` / `--bg-*` on a page that should follow the scheme.** Read
the scheme instead:

| Token | Role |
| --- | --- |
| `--scheme-accent` | The **dominant** hue: links, focus, interaction. (`--fg-blue`'s role.) |
| `--scheme-primary` | The **partner/emphasis** hue: the one action, the headline figure. (`--fg-mint`'s role.) |
| `--scheme-accent-bg`, `--scheme-primary-bg` | The two hues as a **tint** — a small field on the page |
| `--scheme-backdrop-a`, `--scheme-backdrop-b` | The two hues as a **full-bleed field**, lightness pinned per mode |
| `--scheme-alert`, `--scheme-alert-bg` | The alarm. **Deliberately not part of a scheme** — see below |

Three rules are easy to get wrong:

1. **A tint is not a backdrop.** `--scheme-*-bg` is calibrated for a *small* field: it mixes the hue
   toward `--bg-page`, so it inherits that mode's lightness. Stretched over a full-bleed backdrop
   **as-is**, that is fine in light mode and wrong in dark — a pale identity hue (Cyberpunk's yellow,
   Monokai's lime) lands far lighter than the theme's own planes, and muted text on top drops from
   ~3.8:1 to ~2.5:1. `--scheme-backdrop-a/-b` pin lightness and take only the hue, which is what makes
   them safe for any hue. **Backdrop tokens for a field that text sits on, tint tokens for a chip** —
   and a *room* (a field the glass sits over) mixes the tint tokens toward `--bg-page` instead, which
   is what `/admin` and `/profile` do and why their wash is quieter than a marketing backdrop.
2. **The alert does not follow the scheme.** `--fg-orange` / `--bg-orange` stay the theme's own orange
   under every scheme, because an alarm that changes colour with the decor is not an alarm. When you
   alias the brand families onto the scheme, **leave `--fg-orange` alone** — `Support.css` uses it as
   a notice callout's border and `PurchaseGateNotice` mixes its whole warning wash from it.
3. **Put the aliases on the page's own subtree, never globally.** The recipe the pages use is eight
   lines at the page root (or on its bands), which re-points the *existing* `--fg-*` / `--bg-*` uses
   onto the scheme without touching a single rule below it:

```css
/* The whole scheme pass, for a page that already paints with the brand families.
   `--fg-mint` only ever appears OPPOSITE `--fg-blue` in a ramp, so it maps to
   `primary` — mapping both to the accent would flatten every ramp to a flat fill. */
.foo-band,
.foo-hero {
  --fg-blue: var(--scheme-accent);
  --fg-mint: var(--scheme-primary);
  /* BACKDROP tokens: these four stops are a full-bleed field. */
  --bg-orange: var(--scheme-backdrop-a);
  --bg-pink: var(--scheme-backdrop-b);
  --bg-blue: var(--scheme-backdrop-a);
  --bg-mint: var(--scheme-backdrop-b);
}
```

   **Scope it to the page's bands, not to the shell, when the page renders a *shared* component.**
   `SimpleCtaBand` is a *sibling* of `Home`'s sections, so an alias block on `.home` would silently
   restyle the band on Home only and make `/home` and `/projects` drift apart. `Home.css` carries that
   note; `SimpleCtaBand.css` styles the band from the component itself, so both pages follow the
   picker together. The same reasoning applies to any shared band you add.

**A scheme's hues are contrast-checked for a *page*, not for a filled band.** `index.css` re-pins the
accents to a per-mode lightness — 0.52 in light is the measured point at which the worst of the
identity hues still clears 4.5:1 as *text*; dark takes 0.76, where the accents come *up* to stay
visible. A band whose label is `--text-color-inv` has the opposite problem, so it re-pins the two
stops itself: `SimpleCtaBand.css` and `Admin.css`'s primary action both do, and both spell out the
measurement. Since the rest of the service pages were migrated to the glass material (§5.7) they share
one token for it instead of a per-file gradient — `--action` in `index.css`, which is what every
primary button on `/simple`, `/plans` and `/market` now paints with. Chroma always rides along (`c`) so
a scheme with no chroma stays grey.

**Custom never gets a second palette.** `utils/scheme.js` writes the visitor's two hexes as *inline*
custom properties on `<body>`, and `index.css` derives them with the same rule the presets use —
except that the chroma is **capped** at the shared value rather than replaced. The cap does three jobs
at once: a grey stays grey (zero is below the cap), a vivid pick is harmonised onto exactly what a
named scheme would do with that hue, and a muted pick keeps its muting (it is a `min`, not a
replacement). The inline pair is removed the moment a named scheme is applied, because an inline
property beats every stylesheet rule and a stale pair would override the next pick.

**One order rule in `index.css`, and it is load-bearing:** the derivation (`body[data-scheme]`) comes
**first**, the schemes come **after** it, because a scheme may override something derived (`neutral`
turns the chroma off). Move a scheme above the derivation and its overrides stop working, with no
error to tell you.

> ⚠️ Declare `--scheme-*` on the **same element as the palette** (`<body>`, i.e. `.light-theme` /
> `.dark-theme`), **never on `:root`**. A custom property is substituted where it is *declared*:
> `:root` is `<html>`, a *descendant* of the `<body>` that carries `--fg-*` — so
> `--scheme-accent: var(--fg-mint)` declared on `:root` resolves against an element that has never seen
> `--fg-mint`. The chain collapses to the guaranteed-invalid value and the page quietly loses its
> accents. No error, no warning.

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
- **Rebuild on theme *or scheme* change.** Key the canvas on a version you bump from a
  `MutationObserver` on `body`. `useChartTheme.js` filters to `['class']`, which is enough for a chart
  that reads the theme's default hues — but the moment it reads a `--scheme-*` token it also needs
  `attributeFilter: ['class', 'data-scheme']`, or a scheme change repaints the whole page and leaves
  the canvas on the old colours. Repainting an existing chart with new dataset colors is not reliable;
  **rebuild** it.

Also convert alpha yourself for translucent fills — `withAlpha(color, 0.16)` in that same hook handles
`rgb()`, `#rrggbb` and the `color(srgb r g b)` form Chrome returns for values derived from `color-mix()`.

### `--text-color-inv` is not "the text color for bands"

It is *inverted* text for a **filled gradient button**, so it resolves to a dark color in dark mode.
That is fine on a CTA band built from bright hues that have been **re-pinned so the label clears AA**
(§2.1 — `SimpleCtaBand.css` does exactly that), but the `--bg-*` gradient corners and a scheme's
`--scheme-backdrop-*` are **dark in dark mode** — band copy sitting on them must use
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
| `--border-nav` | Neutral hairline — the **fallback**; prefer a tone change (§5) |
| `--fg-blue`, `--fg-mint`, `--fg-orange`, `--fg-pink` | The theme's **default** accents — gradients, links, focus, highlights |
| `--bg-orange`, `--bg-pink`, `--bg-blue`, `--bg-mint` | The four corners of the animated gradient |
| `--scheme-accent`, `--scheme-primary` | The **visitor's** two hues — the dominant one and its partner (§2.1) |
| `--scheme-accent-bg`, `--scheme-primary-bg` | Those hues as a **tint** (a small field) |
| `--scheme-backdrop-a`, `--scheme-backdrop-b` | Those hues as a **full-bleed field** |
| `--scheme-alert`, `--scheme-alert-bg` | The alarm — deliberately **not** part of a scheme |
| `--glass`, `--glass-land`, `--glass-a` | The service-page **pane** (§5.7) |
| `--glass-sheen`, `--glass-sunken`, `--glass-row` | A pane's head / a nested block / a zebra row — all from the text colour |
| `--glass-radius`, `--glass-shadow`, `--glass-hover`, `--glass-btn-hover` | Its corner, its lift, its hover, a control's hover |
| `--action` (`--action-hi` / `--action-lo`) | The **one** action colour: a gradient inside `--scheme-primary`, re-pinned so it clears AA for `--text-color-inv` |
| `--room-mix`, `--room-halo` | How much of the scheme the page's **room** keeps |
| `.service-room` | The class a service page's root wears to get the room (§5.7) |
| `--plane-*` | The retired plane material's tokens (§5) — the *helpers* are still in use on glass (`--plane-muted`, `--plane-ink-*`) |
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
  /* The four stops are the SCHEME's two hues (§2.1), not the fixed --bg-* corners.
     BACKDROP tokens, because this is a full-bleed field — the tint tokens carry the
     page's lightness and would go wrong under a pale hue in dark mode. */
  background: linear-gradient(-45deg, var(--scheme-backdrop-a), var(--scheme-backdrop-b), var(--scheme-backdrop-a), var(--scheme-backdrop-b));
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

**If your page paints with the brand families rather than `--scheme-*` directly**, add the eight-line
alias block from §2.1 to the page root or its bands, and use the backdrop tokens for any full-bleed
field. That is the whole scheme pass — the rules below it are untouched.

---

## 5. Squarespace-inspired layout & motion

Our benchmark for "very very very good UI" is [Squarespace's website-design showcase](https://www.squarespace.com/website-design) —
**its structure and motion, not its monochrome palette.** The signature moves we borrow: full-bleed
color bands that meet edge-to-edge with *no card borders*, oversized media blocks (photos or artwork,
not emojis), uppercase letter-spaced buttons, paginated horizontal carousels, alternating media/text
rows, and scroll-triggered reveals. Keep our own vibrant palette everywhere a color decision is made —
and on a page the visitor should be able to re-colour, keep **their** palette, not the default one
(§2.1).

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

### The brand hue is the visitor's scheme

A Discovery page is the first thing a stranger sees, so it is the page where following the picker
matters most — and it is nearly free, because the pages already paint with the brand families. Three
consequences:

- **A full-bleed backdrop** (the `gradient-everywhere` page root, or a hero) uses
  `--scheme-backdrop-a/-b` — **not** `--scheme-*-bg`, which is a tint and carries the page's lightness.
  `/projects`, `/pricing` and `/support` all wire their four stops this way.
- **A band's tint** is a `color-mix` of the scheme's hue and the page
  (`color-mix(in srgb, var(--fg-mint) 12%, var(--bg-page))` on `Home`/`Pricing`) — the same move
  whether the hue is the default or the visitor's, because the alias block in §2.1 has already
  re-pointed `--fg-mint` to `--scheme-primary`.
- **A shared band reads the scheme from its own stylesheet**, not from the page that renders it:
  `SimpleCtaBand.css` styles the closing CTA band from the component, so `/home` and `/projects`
  follow the picker *together* and neither can restyle the other's copy. Do the same for the next
  shared band you extract.

**The alert is the one exception.** `--fg-orange` is `Support.css`'s notice-callout border and
`PurchaseGateNotice`'s whole warning wash. It is deliberately **not** aliased on any of the pages given
the scheme — an alarm that changes colour with the decor is not an alarm (§2.1). If you alias four
brand families on a new page, alias three.

### Color beside color, not borders

**We don't draw lines — we put colors next to each other.** A border is one way of saying "these two
things are different"; a change of tone says the same thing and looks like a designed page instead of
a spreadsheet. Squarespace's calm comes from planes of color meeting edge-to-edge, and that is the
house style here.

- **Containers get a fill, never an outline.** A panel, tile, table or readout is `--bg-1` or a
  **saturated plane** of an accent — see "Planes are saturated, not pastel" below — never a box with
  a 1px edge.
- **Give neighbouring blocks different tones.** Two adjacent panels in the same color read as one
  panel that failed to load; step the hue so the grid reads as blocks of color. Deriving a block's
  head and footer from *its own* hue keeps the block one family:
  ```css
  .foo-panel {
    --foo-hue: var(--fg-blue);
    /* fallback first, then the real one (see "Planes are saturated, not pastel") */
    background: color-mix(in srgb, var(--foo-hue) var(--plane-fallback), var(--bg-1));
    background: oklch(from var(--foo-hue) var(--plane-l) c h);
  }
  .foo-panel:nth-child(3n + 2) { --foo-hue: var(--fg-mint); }
  .foo-panel:nth-child(3n + 3) { --foo-hue: var(--fg-pink); }
  .foo-panel-head { background: color-mix(in srgb, var(--foo-hue) var(--plane-raise), transparent); }
  ```
- **Hover deepens the tone** — don't answer a hover with a ring *and* a shadow *and* a border. Pick
  one, or use none: color and motion are already doing the work. On a plane, hover is the same hue
  one step deeper (light) or lighter (dark): `oklch(from var(--foo-hue) var(--plane-l-strong) c h)`.
- **Separate rows with alternating tints**, not a hairline under every row:
  `.foo-row:nth-child(odd) { background: color-mix(in srgb, var(--foo-hue) var(--plane-row), transparent); }`
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
are panes of glass, never a boxed card (§5.7).

### Planes are saturated, not pastel

This is the **plane material** — the older service-page material, kept here because a saturated plane
of one hue is still a good way to group a grid of same-shaped controls. **No page uses it today**:
all five service pages are the glass in §5.7, which reserves colour for signal instead. A glass page
deliberately does **not** use this recipe; its panes are neutral and the colour is in the room behind
them. The `--plane-*` tokens below are a **different** thing from the planes themselves, and they are
very much in use: `--plane-muted` and `--plane-ink-*` are the *muted-text* and *hue-as-text* helpers a
tinted surface needs (glass included), and 20-odd rules across `/plans` and `/market` rely on them.

`color-mix(in srgb, <hue> 7%, var(--bg-1))` is a hue *diluted into the page*, and at 7–15% what you
get back is grey with a temperature: every surface ends up a slightly different off-white and the
page reads as pastel by accident. **Pin lightness, keep chroma** instead — that is the most saturated
version of the hue that still takes dark text (light) or white text (dark):

```css
.foo-panel {
  --foo-hue: var(--fg-blue);
  background: color-mix(in srgb, var(--foo-hue) var(--plane-fallback), var(--bg-1)); /* fallback */
  background: oklch(from var(--foo-hue) var(--plane-l) c h);                      /* the real one */
}
```

The tokens live in `index.css`, one set per theme, so "more color" is a token change and not a
per-rule hunt:

| token | light | dark | what it's for |
| --- | --- | --- | --- |
| `--plane-l` | 0.87 | 0.30 | a solid plane (a panel, a card) |
| `--plane-l-strong` | 0.76 | 0.40 | its head, a bar, an active tab, a hover |
| `--plane-fallback` | 32% | 48% | the dose the `color-mix` fallback line uses |
| `--plane-row` | 12% | 18% | a translucent zebra tint **on** a plane |
| `--plane-raise` | 24% | 32% | a translucent "raised" block **on** a plane |
| `--plane-muted` | accent → text | accent → text | muted text that has to land on a plane |
| `--plane-ink-l` / `--plane-ink-fallback` | 0.38 / 55% | 0.88 / 62% | a *hue used as text* on a plane |

Rules that fall out of it:

- **Two planes never touch as equals.** If a block sits *inside* a plane, it is a translucent wash of
  the same hue (`--plane-raise`), not a second solid plane — solid-on-solid just looks like a stack
  of cards.
- **A hue used as *text* is not the same color as a hue used as *fill*.** `--fg-blue` is tuned to sit
  on `--bg-1`; printed on a blue plane it measures ~2.9:1 (light) / ~2.0:1 (dark). Run it through the
  ink pair first:
  ```css
  .foo-badge {
    --badge-tone: var(--fg-blue);
    background: var(--bg-1);   /* a chip, so it can't dissolve into a plane of its own hue */
    color: color-mix(in srgb, var(--badge-tone) var(--plane-ink-fallback), var(--text-color));
    color: oklch(from var(--badge-tone) var(--plane-ink-l) c h);
  }
  ```
  The same trade applies to links, retry/reset buttons and status words that land on a plane.
- **Muted text on a plane is `--plane-muted`**, never bare `--text-color-accent` — the accent is
  measured against `--bg-page`, not against a saturated plane.
- **Measure it, don't eyeball it.** Composite the alpha stack (a plane is usually translucent) before
  computing the ratio, and remember Chrome serialises relative colors as `oklch(…)` — reading
  `getComputedStyle().color` needs a canvas round-trip to get back to sRGB. §13.13 in
  `docs/implementation/agent.md` is the worked example.
- **A browser without relative color syntax gets the `color-mix` line**, which is pastel — that is the
  intended degradation, and it is why both lines are always written out.

### A workspace on a phone (service pages, ≤ 640px)

A service page is a tool, so on a phone the question is not "what can we drop" but "what costs
height on every scroll". The reference is `pages/Admin/Admin.css` §18.

- **Budget the head first.** A sticky head is the only thing that takes space from *every* screen a
  user scrolls through, so it gets measured in viewport terms: at 320px the admin head was 192px of a
  720px viewport — a quarter of the glass, permanently. That measurement is exactly why the console
  stopped pinning it (§5.7). Either way, keep it to two or three rows: title + state, one row of
  readout, the view switcher.
- **A row of chips scrolls, it doesn't wrap.** `flex-wrap: nowrap; overflow-x: auto` with the
  scrollbar hidden keeps a readout at one predictable row instead of three.
- **A full-width action is a whole row.** The ≤768px "stack the actions under the title" rule is
  right for a tablet and wrong for a phone; below 420px let the link take its natural width and drop
  its label, with `aria-label` carrying the name.
- **Wide tables stop being tables.** Past ~5 columns a table either scrolls sideways or squeezes a
  column until 120 characters become a 20-line block — measured: one reviews row was taller than a
  phone screen. Below 640px hide the `thead`, make each `td` a `9ch | 1fr` grid, and put the field
  name in `::before`. That means the labels are CSS, so the markup and the label list must point at
  each other in comments. Zebra-stripe the *even* rows once blocks are this tall — an odd-row tint
  reads as a divider rather than a stripe.
- **`overflow: hidden` clips, it doesn't complain.** Panels hide their overflow to keep the plane
  edges clean, so any child that refuses to shrink is silently cut off instead of pushing the page
  wide: a `input[type=date]` was untappable, and a `nowrap` count was pushed out of its row. Give the
  flexible half `min-width: 0` (and `overflow-wrap: anywhere`) and stack the control pair on a phone.
- **Watch the order of overlapping media queries.** A `@media (orientation: portrait)` block later in
  the file silently outranks a `max-width: 640px` block above it; scope it with `min-width` instead of
  relying on source order.
- **Format the number before it lands in a card.** A raw float (`11.390175819396973 MB`) overflows a
  120px card and reads as a bug at every width.

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

## 5.7 Service pages — a workspace, not a story

A **service page** (`/simple`, `/plans`, `/net`, `/profile`, `/admin`) is a tool someone already
opened on purpose. It shares the palette, the tokens and the typography — but **not the band stack**.
Bands exist to sell an idea; a workspace has no idea to sell, it has tasks to finish. A Discovery page
earns its scroll; a service page costs the user time, and every extra screen is a control they have to
hunt for.

**The goal is utility: fewer screens, fewer words, the work visible immediately — and it still has to
look good.** Think a well-made instrument, not a poster.

### The material: glass over a room

Every service page is built from **one** material — a translucent pane resting on an ambient
**room** that carries the colour scheme. It is shared token-for-token (`index.css`), so a page
cannot invent its own version of it:

| | **Glass pane** |
| --- | --- |
| Page ground | an **ambient room**: `.service-room` on the page root draws the scheme's two `-bg` hues sweeping behind the data, plus one looser halo layer at its own speed |
| Panels | `--glass` (`--glass-land` at 84%), `--glass-radius`, `--glass-shadow` — no border, no outline |
| A pane's parts | `--glass-sheen` (its head), `--glass-sunken` (a nested block), `--glass-row` (a zebra row) — all mixed from the **text** colour, never a hue |
| Colour | **reserved for signal** — a status, the one action, the data. A hue that is only decoration is the failure this material exists to prevent |
| Controls | **solid**, never glass: `--bg-1` fill, at most an edge mixed from `--scheme-accent` |

⚠️ Four rules the material depends on:

- **Never glass on glass.** Anything nested *inside* a pane is a flat sunken tint
  (`color-mix(in srgb, var(--text-color) 6%, transparent)`), never a second translucent surface.
- **Never glass a control.** Buttons, inputs and chips stay **solid**: they must read as objects you
  can push, and a translucent control over data loses its edge.
- **No `backdrop-filter`** (see §8). The depth is *layering* — a translucent fill over a room that is
  already coloured — and a blur is a per-frame repaint for an effect the gradient gives you free.
- **The room is not a band stack and not a background for its own sake.** It is one field behind the
  whole page, mixed toward `--bg-page` so it never competes with the data, and the glass is what keeps
  it from reading as decoration.

**The colour-plane material it replaced is in §5** ("Planes are saturated, not pastel"). It is still
there — a saturated plane of one hue is a legitimate way to group a grid of controls — but **no page
uses it today**: `/simple`, `/plans`, `/market`, `/profile` and `/admin` are all glass, and one page
running a different material is exactly how two pages drift apart. If you are adding a *service* page,
build it from the table above.

### No bands

- **One surface, not a sequence of them.** There is no band stack: the ground is the ambient room
  (glass) or — on the pages still to be migrated — `--bg-page`. A full-bleed colour *change* would carve
  one workspace into "sections" that aren't there. A room is not a band stack: it is one field behind
  the whole page, and the glass is what keeps it from ever competing with the data.
- **No floating circles, no scroll reveals.** §5's decoration belongs to a marketing hero — reveals
  delay content on a page whose whole point is "help me now". (The room and its halo are the exception:
  they are the page's ground, not an entrance.)
- **Keep one small piece of brand**: an accent-gradient hairline on the toolbar, or a single
  gradient-filled primary action. That is enough to place the page in the family.
- **The colour is the scheme's.** All the service pages read `--scheme-*` (directly, or through the
alias block on the page root) — and `/net`'s chat palette does too, so a visitor who re-colours the
site on `/profile` (the page that carries the picker) sees every room follow, including the two hues
the glass is tinted *by*.
- The page root only clears the fixed header: `padding-top: calc(var(--nav-size) * 1.15)`.

### The hero collapses into a toolbar (or a glass head)

Everything §4's hero would carry becomes **one row** — the only thing that stays put while the
user works:

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
  position: sticky;
  top: var(--nav-size);            /* just under the site header — no gap, no drift */
  z-index: 5;                      /* below the header's 10, above the panels */
  display: flex; align-items: center; gap: calc(var(--nav-size) * 0.25);
  flex-wrap: wrap;
  padding: calc(var(--nav-size) * 0.2) calc(var(--nav-size) * 0.3);
  background: var(--bg-page);      /* opaque — NO backdrop-filter (see §8) */
  border-bottom: 1px solid var(--border-nav);
}
.foo-bar-title { margin: 0; font-size: var(--font-size-heading); font-weight: var(--font-weight-bold); }
.foo-bar-actions { margin-left: auto; display: flex; gap: calc(var(--nav-size) * 0.18); }
```

- **The `<h1>` is the room's name**, two words at most, at `--font-size-heading` or smaller.
  No eyebrow (the header switcher already says where you are), no subtitle, no lead.
- **Live state goes in the toolbar, not in a hero paragraph** — connection, stage, step,
  goals running, kill-switch state. That readout *is* the page's headline.
- **The primary action lives there too**, so it is reachable from anywhere on the page:
  `+ New goal`, `▶ Start loop`, `● Record`.
- **Sticky is a choice, not a rule.** The workspace family pins its toolbar at `top: var(--nav-size)`
  (the CSS above). The console deliberately does **not**: `.admin-head`'s own note records the trade —
  the head plus the 48px site nav is ~160px of viewport spoken for permanently, and a pane that has to
  stay legible over text scrolling beneath it forces an opaque base. With nothing scrolling under it,
  the head can be ordinary glass and the page gets its height back. Scrolling to the top to change view
  is the price, and it was chosen deliberately.

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

- **A pane, never a boxed card.** A translucent page-colour fill (`--glass`), a radius and a soft
  shadow, with a tone change (`--glass-sheen`) for the head. No border, no outline around a container,
  and **nothing nested is a second pane** — a block inside a pane is a flat `--glass-sunken` tint.
- **Colour means something, or it isn't there.** The panes are neutral and a hue appears only where it
  carries a signal — state, data, the one action. A hue that is only decoration is the thing that turns
  a page into a highlighter display, which is exactly what the old per-panel hue rotation did.
- **No scroll reveals, no stagger.** Reveals delay content on a page whose whole point is
  "help me now"; Squarespace's fade-and-rise belongs to a page you're being sold on. Motion
  here is reserved for **state changing** — a status dot, a progress bar, a button that
  becomes Stop. (The admin console adds one short rise as each panel appears, plus a
  breathing brand rule and a pulsing status dot. It is the console its owner opens all day,
  not a template for a customer-facing service page — don't copy the rise out of `Admin.css`.)
- Everything else stands: tokens for every color — `--scheme-*` on a page that should follow the
  picker (§2.1) — `calc(var(--nav-size) * N)` for sizing, visible focus rings, and a
  `prefers-reduced-motion` reset. On a glass page that reset has to catch **every** moving piece: the
  room's sweep, the halo, the rule sweep and the status pulse — not just the one panel rise.
- **A sticky toolbar needs the app root to _clip_, not _hide_.** `App.css` clamps `.App`
  with `overflow-x: clip` (with `overflow-x: hidden` before it, as the fallback for
  browsers without `clip`). `hidden` on one axis resolves the other to `auto`, which makes
  `.App` a scroll container that never scrolls — and every `position: sticky` inside it then
  offsets itself against that box instead of the viewport and silently never engages. This
  is exactly what had happened here: the `.sd-bar` / `.plans-bar` toolbars were sticky in
  name only until 2026-09-12. Don't reintroduce it, and never clamp a page root with
  `overflow-x: hidden` either (see the note on `.plans-page`).

### Verifying one

Signed-out is not the service page — it's a gate — so **log in before judging one**. Use the shared
demo account: **"Continue as Guest"** on `/login`, or `guest@gmail.com` / `guest`
(`backend/constants/guestAccount.js`, §10). It already holds workspace data (goals, plans, actions,
notes), so lists, filters and empty states are exercised for real instead of only in theory — and it is
**shared and public**, so delete anything you create while testing.

Then ask: *is the primary tool above the fold at 1366×768, and reachable without scrolling? Is there a
sentence on screen that could be a label? Is there a line on screen that could be a tone change?*

### Reference — the five built pages

| Page | Path | Notes |
| --- | --- | --- |
| Chat (`/net`) | `pages/Simple/Net/` + `components/SimpleAddon/` | the room behind a chat that brings its own palette — see below |
| Control (`/simple`) | `pages/Simple/Simple/` | the workspace: sticky glass toolbar + dense panel grid |
| Goals (`/plans`) | `pages/Simple/Plans/` | the same shell for three views of one store |
| Market (`/market`) | `pages/Simple/Market/` | one toolbar + one panel holding the grid of result cards |
| Profile (`/profile`) | `pages/Profile/` | the **account** shape — and where the scheme picker lives |
| Admin (`/admin`) | `pages/Admin/` | the **console** shape |

Each owns its page shell; there is deliberately **no shared band component** for them, because there
are no bands to share. What *is* shared is the material: `.service-room` and the `--glass-*` /
`--action` / `--room-*` tokens all live in `index.css`, so `/admin` and `/profile` — which were built
first and still carry local copies (`--admin-*`) at the same values — cannot be joined by a page that
invents its own pane.

**`/plans` holds three views of one store** behind a tab row — the goal list, the Dream board
(`DreamBoard.jsx`, a cover-art tile grid) and the Library. So a view inside a service page is still a
service page: the board uses one flat surface, a dense grid of glass tiles, and copy that is labels
rather than sentences. It is also why the third tab is labelled `🌟 Board` while the page's `<h1>`
reads "Dream board" — three one-word tabs stay the same height.

**`/profile` is the account shape** — the post-purchase home base (§16). It is the older of the two
glass pages and the source of the material: an animated backdrop from the scheme's `-bg` hues, three
decorative floating circles, and **translucent page-colour panels** (`--bg-page` at 84%,
`--border-radius-2xl`, `--shadow-md`) carrying a hero, a two-column card layout that collapses to one
column at 860px, and a settings grid. Its role in this standard is larger than its own layout: the
**scheme picker lives here**, so it is the page a visitor re-colours, and it has to repaint the moment
that control changes. That is also why the picker carries no swatches — the page behind it *is* the
preview.

**`/admin` is the console shape.** Same material, harder job: it carries the numbers. Its structure is
this section at its most literal — a floating glass head (the route's view name as `<h1>`, a live
readout the mounted view publishes, then the view tabs) over a stack of dense panels, KPI tiles and
tables, ordered by how often they get touched. The material rules above are all load-bearing there:
the land is `--bg-page` (an *input* token doing a surface's job is what made Console panels lighter
than Profile cards), nesting is a flat sunken tint, controls stay solid, and the room is pulled back
with a percentage *mix* rather than an alpha — an alpha lets the neutral page through, and a neutral
page showing through is just a grey tint. When the ambient version replaced the plane version, colour
stopped carrying grouping (so a hue could mean something again) and the shadow came back (glass needs
the lift; a plane never did).

**`/net` is the exception that proves the rule.** Its chat panels are an app-like surface
that brings its own palette (`SimpleTheme.css`, with `data-simple-theme` on `.simple-root`
— the same ten names as the site's schemes, plus light/dark/system), so it does **not** pane
itself in glass on this page. What it does share is the **room** (`Net.css` wears
`.service-room`, which is why the band behind the site header is the scheme rather than the
four-colour gradient it used to paint) and the **scheme's hue**, because the chat's brand
roles now derive from `--scheme-*` instead of a hardcoded indigo. Same discipline as the
rest: the HUE follows the visitor, the LIGHTNESS is re-pinned to whatever surface it lands
on — here the chat's own theme, which is independent of the site's mode — and status
colours (success/warning/error) do not follow it at all.

⚠️ A service page has **no header hero and no closing CTA**: it is one surface, and the last panel is
the end of the page. Everything the visitor needs is either in the head or in the grid.

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
- [ ] Works in light **and** dark theme, and under **at least two colour schemes** — `Ocean` (the
      default), `Neutral` (the one with no hue) and a Custom pick (§2.1).
- [ ] **Brand hues come from the scheme** — `--scheme-*` directly, or the brand families aliased onto
      it on the page's own subtree (§2.1, §5). A raw `--fg-*` brand hue doing brand work is a page that
      ignores the picker.
- [ ] **A full-bleed field uses `--scheme-backdrop-a/-b`**, not the tint tokens — and a field the glass
      sits over mixes the tint tokens toward `--bg-page` instead (§2.1).
- [ ] **`--fg-orange` / `--bg-orange` are left alone** — the alert never follows the decor (§2.1).
- [ ] **`--scheme-*` is declared on the element that carries the palette** (`<body>`'s theme class),
      never on `:root` (§2.1).
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
- [ ] **Service page?** One surface — no band stack, no circles, no scroll reveals — a head carrying
      the name + live state + primary action, and a dense panel grid (§5.7). Built from the shared
      material: `.service-room` on the root and `--glass*` panes, with **no glass-on-glass, no glassed
      control and no `backdrop-filter`**, and the room mixed toward `--bg-page` so it never competes
      with the data.
- [ ] **Service page? The page root has no opaque background of its own** — the room paints it — and
      neither the root nor a wrapper gained `isolation` / `z-index`, which would trap the room's
      `z-index: -1` layers under the page (§5.7).
- [ ] **Service page? The primary tool is above the fold at 1366×768** and reachable without scrolling,
      and nothing on screen is a sentence that could be a label (§5.7).

---

## 8. Do's and don'ts

### ✅ Do

- Use `calc(var(--nav-size) * N)` for paddings, gaps, and component sizes.
- Use tokens for every color — `--text-color`, `--bg-1`, `--border-nav`, `--fg-blue`.
- **Use the visitor's scheme** on any page they should be able to re-colour: read `--scheme-accent` /
  `--scheme-primary`, or add the eight-line alias block at the page root (§2.1). It is the cheapest
  eleven lines of consistency on the site.
- Verify a page under **≥2 schemes and both modes** — `Ocean`, `Neutral` and a Custom pick. `Neutral` is
  the one that catches a chroma assumption (a grey handed chroma is not a grey).
- Use the vibrant accents (`--fg-blue`, `--fg-mint`, `--fg-orange`, `--fg-pink`) for gradients, links, and highlights — they are the theme's **defaults**, and they are the right choice on a page that deliberately does not follow the picker.
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
- Don't stack `backdrop-filter` glassmorphism on cards; depth comes from a translucent fill over a
  coloured room plus a soft shadow (§5.7).
- Don't glass a control or nest a pane inside a pane — a nested block is a flat sunken tint, and a
  translucent button loses its edge (§5.7).
- Don't alias `--fg-orange` onto the scheme — orange is the alert, and an alarm that follows the decor
  is not an alarm (§2.1).
- Don't use `--scheme-*-bg` (a tint) for a full-bleed backdrop, and don't declare `--scheme-*` on
  `:root` — it must sit on the element that carries the palette (§2.1).
- Don't put a page's scheme aliases on a selector that also wraps a **shared** component — scope them to
  the page's own bands, or the shared band follows the picker on one page only (§2.1, §5).
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
| Control (`/simple`) | `frontend/src/pages/Simple/Simple/` | **Service page, glass (§5.7)** — sticky glass toolbar + dense panel grid on the shared room, no bands |
| Goals (`/plans`) | `frontend/src/pages/Simple/Plans/` | **Service page, glass (§5.7)** — same shape: live state in the toolbar, panels grouped into grid rows |
| Profile (`/profile`) | `frontend/src/pages/Profile/` | **Service page, glass material (§5.7)** — the account shape and the source of the material: a scheme-driven gradient backdrop, floating circles, and translucent `--bg-page`-at-84% panels (hero → two-column cards → one column at 860px, then a settings grid). **Where the colour-scheme picker lives** (`utils/scheme.js`), so it repaints the instant the scheme changes — and carries no swatches because the page behind it *is* the preview |
| Dream board (`/plans` 🌟) | `frontend/src/pages/Simple/Plans/DreamBoard.jsx` | **Service page view (§5.7)** — a third tab over the *same* goals: a cover-art tile grid where each tile is a goal you can hand to the agent. Tiles are glass panes and the cover art is the only colour on them; no bands, no reveals. Covers are real artwork (`assets/art/dream-*.jpg`), never emoji tiles (§5) |
| Admin console (`/admin`) | `frontend/src/pages/Admin/` | **Service page, glass material (§5.7)** — one floating glass head (deliberately **not** sticky: the route's view name as `<h1>` + a live readout published by the mounted view + the tab row) over a stack of dense panels, with colour **reserved for signal** rather than rotated per panel. `components/Admin/AdminPanel.jsx` builds a panel; `useAdminReadout` (`Admin/adminBarContext.js`) publishes the toolbar chips; `Admin.css` owns `.admin-table` / `.admin-search` scoped to `.admin-surface` so `/deepstorage`'s `ScrollableTable.css` can't repaint them. The tab row a **Special** account sees is `SPECIAL_ADMIN_PATHS` (`constants/admin.js`) — four read-only views, mirrored by `backend/middleware/adminAccess.js` |

The earlier entries predate the editorial structure; **Annuities is the markup reference for it.** When
in doubt about how a band, a staggered reveal, a borderless readout or a themed canvas should be built,
copy from there rather than re-inventing it — the older pages will lead you back to cards.

**Which pages follow the colour scheme today** (§2.1): `/home`, `/projects` and the project pages
(`Annuities`, `Quizzes`, `IQ Test`, About/resume), `/pricing`, `/support`, and **every service page** —
`/net` (chat palette included), `/simple`, `/plans` (and the goal detail and Dream board views),
`/market`, `/profile` and `/admin`. The pattern in all of them is the same: alias the brand families
onto the scheme on the page's own root — or, for `/net`, in the chat's own theme layer — and leave the
signal hues (`--fg-orange`, `--fg-pink`, `--red0`, the chat's success/warning/error) exactly where
they were.

---

## 10. Quick pre-merge checklist

### Verifying an authenticated page

Most pages sit behind login, so a logged-out eyeball only proves the hero renders.
**Agents and humans should log in to the shared demo account and click through the
real thing** — "Continue as Guest" on `/login`, or `guest@gmail.com` / `guest`
(`backend/constants/guestAccount.js`). It already has workspace data (goals, plans,
actions, notes), so lists, filters, and empty states can be checked for real.

- It's a **shared, public** account — delete any data you create while testing.
- Validate **light + dark** × **at least two schemes** and **phone → tablet → desktop** before calling
  a page done. `Neutral` is the scheme that catches a chroma assumption; `Custom` catches the inline
  custom-property path.
- Check the interactive states a screenshot hides: hover, focus, disabled, empty,
  loading, and any confirmation dialog.

1. `npm run build` (or at least the dev server) compiles cleanly.
2. Manually toggle light/dark and eyeball text contrast, borders, and button fills.
3. **Flip the colour scheme to `Neutral` and to `Custom`, in both modes** (picker on `/profile`), and
   confirm nothing turns pink under `Neutral` and nothing keeps the old hue.
4. Resize the window through phone → tablet → desktop and check nothing overflows or clips.
5. Tab through the page and confirm focus outlines are visible on every control.
6. **Hover every control in both themes.** Hover is where the global `button` rules bite (§6), and it
   is the state a screenshot never shows.
7. **Check anything on a gradient band in dark mode.** The `--bg-*` corners and a scheme's
   `--scheme-backdrop-*` both go dark, so copy that reads fine in light mode can disappear there.
8. **Canvas visuals: verify by eye.** `getImageData()` returns an all-black buffer in the agent browser
   tool regardless of what was drawn, so a pixel readback will "prove" a working chart is broken — take
   a screenshot instead.
