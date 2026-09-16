# Frontend UI Standard

> **Single source of truth for how every page in `frontend/src/pages` should look and behave.**
> Read this before creating a new page or refactoring an old one so every page stays visually
> consistent, works in both light and dark mode, and scales across all display sizes.

## Where the rest lives

This file is the entry point — the goal, theming, sizing and the page template.
The rest of the standard lives beside it, and **every section keeps the number it
always had**, so a `§5.7` or `§11.2` reference in the code still means the same rule —
it just lives in a different file now.

| Sections | File | What is in it |
| --- | --- | --- |
| **§1–§4, §10** | this file | The goal, how theming works, responsive sizing, the canonical page template, the pre-merge checklist |
| **§5** (incl. §5.7) | [`UI_LAYOUT.md`](./UI_LAYOUT.md) | Layout & motion — bands, scroll reveals, service-page layout |
| **§6–§9** | [`UI_COMPONENTS.md`](./UI_COMPONENTS.md) | Component recipes, page anatomy checklist, do's and don'ts, reference implementations |
| **§11.x** | [`UI_DESIGN_RECORDS.md`](./UI_DESIGN_RECORDS.md) | Dated design records — the responsive and colour passes, and what each one taught |
| — | [`LOGO_SYSTEM.md`](./LOGO_SYSTEM.md) | The brand mark: geometry, colours, usage |

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
