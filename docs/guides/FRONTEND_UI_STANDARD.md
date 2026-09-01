# Frontend UI Standard

> **Single source of truth for how every page in `frontend/src/pages` should look and behave.**
> Read this before creating a new page or refactoring an old one so every page stays visually
> consistent, works in both light and dark mode, and scales across all display sizes.

---

## 1. The goal

Our visual language is **"vibrant editorial"** — Squarespace's structure and feel (typography-led
hierarchy, eyebrow labels, pill buttons, hairline borders, generous sizing, subtle motion) layered on
top of our own **vibrant gradient** palette.

Every page should be **"very very very good UI"** — meaning:

1. **Theme-first** — colors adapt automatically to light and dark mode with zero hardcoded colors.
2. **Responsive by token** — nothing is sized in raw pixels; everything scales off one unit (`--nav-size`).
3. **Vibrant + animated** — the animated four-color gradient background is our signature; keep it.
4. **Typography-led** — clear hierarchy: eyebrow label → big heading → subtitle → content.
5. **Structured feel** — hairline borders, soft shadows, pill buttons, and subtle hover motion (Squarespace's feel, not its colors).
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

---

## 5. Squarespace-inspired motion & card polish

Our benchmark for "very very very good UI" is [Squarespace's website-design showcase](https://www.squarespace.com/website-design) —
**its structure and motion, not its monochrome palette.** Borrow the oversized cards, generous
whitespace, scroll-triggered reveals, and confident hover states; keep our own vibrant gradient
palette everywhere a color decision is made.

### Scroll reveal

Sections should fade + rise into view the first time they're scrolled into the viewport (not on
every page — once per mount is enough; Squarespace doesn't re-animate on scroll-up). Use the shared
`useScrollReveal` hook (`frontend/src/hooks/useScrollReveal.js`) instead of hand-rolling
`IntersectionObserver` per page:

```jsx
import useScrollReveal from '../../hooks/useScrollReveal';

const [statsRef, statsVisible] = useScrollReveal();

<section ref={statsRef} className={`foo-section foo-reveal ${statsVisible ? 'is-visible' : ''}`}>
```

```css
.foo-reveal {
  opacity: 0;
  transform: translateY(24px);
  transition: opacity 0.6s ease, transform 0.6s ease;
}
.foo-reveal.is-visible { opacity: 1; transform: translateY(0); }

/* Stagger a grid's children by giving each card an increasing delay */
.foo-reveal.is-visible .foo-tile:nth-child(1) { transition-delay: 0ms; }
.foo-reveal.is-visible .foo-tile:nth-child(2) { transition-delay: 80ms; }
.foo-reveal.is-visible .foo-tile:nth-child(3) { transition-delay: 160ms; }
```

`prefers-reduced-motion: reduce` must always disable this (see the reduced-motion block in section 4's
CSS skeleton) — set opacity/transform back to their resting state and drop the transition.

### Oversized, confident cards

Squarespace's cards feel big and tactile: tall color/preview blocks, bold titles, lots of internal
padding, and a strong hover response. Prefer:

- **`--border-radius-xl` or `--border-radius-2xl`** for hero-level cards (template previews, feature
  tiles, the final CTA card) instead of the smaller `--border-radius`/`--border-radius-lg` used for
  inputs and small chips.
- A **tall, colorful preview block** at the top of a card (`linear-gradient(135deg, var(--bg-orange), var(--bg-pink))`
  etc., cycling through the four gradient corners per card) standing in for Squarespace's photography —
  this is exactly where our vibrant palette should shine instead of their grayscale thumbnails.
- **Generous padding** — `calc(var(--nav-size) * 0.4)` to `calc(var(--nav-size) * 0.6)` inside cards,
  not the tighter spacing used for compact UI (tags, table rows).

### Hover interactions

Every interactive card/tile should respond with a combined **lift + subtle scale + shadow escalation +
accent border**, not just one of those:

```css
.foo-tile {
  transition: transform 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease;
}
.foo-tile:hover {
  transform: translateY(-4px) scale(1.015);
  box-shadow: var(--shadow-lg);
  border-color: var(--fg-blue);
}
```

Buttons keep the lighter `translateY(-1px)` + `--shadow-md` treatment from section 5's button recipe —
reserve the stronger lift/scale combo for cards and tiles so buttons don't feel jumpy.

### Section rhythm

Give major sections room to breathe, the way Squarespace's showcase separates each feature block:
`margin-bottom: calc(var(--nav-size) * 1.2)` to `calc(var(--nav-size) * 1.4)` between top-level
`*-section`s is the target on desktop; let it compress naturally under `--nav-size`'s portrait value.

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

---

## 7. Page anatomy checklist

- [ ] `SEO` component present with `title`, `description`, and correct `path`.
- [ ] Uses `Header` (the modern header) — **not** the legacy `NavBar`.
- [ ] Root wrapper has the animated vibrant gradient + floating circles.
- [ ] Hero `section` → `title-wrap` (`eyebrow` → `h1` → `subtitle` → optional `actions`).
- [ ] Content lives in `*-card` surfaces: hairline border + soft shadow.
- [ ] `Footer` rendered at the bottom.
- [ ] Project pages include a "View Source Code" link to the correct GitHub path.
- [ ] All classes prefixed with the page name.
- [ ] Works in light **and** dark theme.
- [ ] Looks right in landscape **and** portrait, at desktop, tablet, and phone widths.
- [ ] `prefers-reduced-motion` disables entrance/background animation.
- [ ] Keyboard: every interactive element is focusable; focus is visible.

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

---

## 9. Reference implementations

> ⚠️ These pages share the same vibrant gradient palette, but predate the editorial structure in this
> standard (eyebrow labels, pill buttons, hairline borders). Use them for **structure** (SEO,
> Header/Footer, card anatomy, input validation, state management) — then apply the new hero/button
> recipes on top.

| Page | Path | Notes |
| --- | --- | --- |
| Ethanol Calculator | `frontend/src/pages/Projects/Ethanol/` | Full template: gradient, floating circles, presets, inputs, errors, result cards, log |
| Sonic | `frontend/src/pages/Projects/Sonic/` | Same template with live status dot, tuner meter, spectrum bars |
| Halfway | `frontend/src/pages/Projects/Halfway/` | Template + quick-fill buttons + solar-times card |
| Projects hub | `frontend/src/pages/Projects/Projects/` | Card-grid variant with search + category filters (closest to the new editorial grid) |
| Home | `frontend/src/pages/Home/Home.jsx` | Hero + typewriter + scroll-reveal sections + oversized template/feature cards (closest to section 5's Squarespace-style motion) |

---

## 10. Quick pre-merge checklist

1. `npm run build` (or at least the dev server) compiles cleanly.
2. Manually toggle light/dark and eyeball text contrast, borders, and button fills.
3. Resize the window through phone → tablet → desktop and check nothing overflows or clips.
4. Tab through the page and confirm focus outlines are visible on every control.
