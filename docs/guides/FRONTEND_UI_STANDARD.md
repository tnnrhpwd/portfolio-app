# Frontend UI Standard

> **Single source of truth for how every page in `frontend/src/pages` should look and behave.**
> Read this before creating a new page or refactoring an old one so every page stays visually
> consistent, works in both light and dark mode, and scales across all display sizes.

---

## 1. The goal

Every page should be **"very very very good UI"** — meaning:

1. **Theme-first** — colors adapt automatically to light and dark mode with zero hardcoded colors.
2. **Responsive by token** — nothing is sized in raw pixels; everything scales off one unit (`--nav-size`).
3. **Gradient + glass** — an animated gradient background with translucent "glass" cards on top.
4. **Consistent anatomy** — every page follows the same structural template (section 4).
5. **Accessible** — semantic markup, visible focus states, `aria-*` where useful, and `prefers-reduced-motion` support.

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
- The only place hardcoded translucency is acceptable is the "glass" effect, which intentionally uses
  `#ffffff26`, `#ffffff0d`, `#00000026`, etc. (these layer fine over both themes).
- Test every change in both themes. You can flip themes from the header logo or the hamburger menu.

### Key tokens

| Token | Purpose |
| --- | --- |
| `--text-color` | Primary text |
| `--text-color-inv` | Text on top of gradient/filled buttons |
| `--text-color-accent` | Secondary/muted text, subtitles, hints |
| `--bg` | Translucent page background |
| `--bg-1` | Solid card/input surface |
| `--bg-page` | App background behind the gradient |
| `--bg-accent` | Subtle accent surfaces (tags, table headers) |
| `--border-nav` | Standard borders/input borders |
| `--fg-blue`, `--fg-mint`, `--fg-orange`, `--fg-pink` | Accent colors for gradients & highlights |
| `--bg-orange`, `--bg-pink`, `--bg-blue`, `--bg-mint` | The four corners of the animated gradient |
| `--grey3-transp`, `--white1-transp` | Soft shadows / translucent overlays |
| `--shadow-sm` … `--shadow-xl` | Elevation scale |

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

        <section className="foo-section">
          <div className="foo-title-wrap">
            <h1 className="foo-title">Foo</h1>
            <div className="foo-underline" aria-hidden="true" />
            <p className="foo-subtitle">Short, friendly explanation of the tool.</p>
          </div>

          <div className="foo-card">
            <h2>Section Heading</h2>
            {/* inputs, buttons, results, errors go here */}
          </div>
        </section>
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

.foo-section { position: relative; z-index: 2; width: 100%; max-width: 760px; display: flex; flex-direction: column; align-items: center; }

.foo-title-wrap { text-align: center; max-width: 900px; margin: calc(var(--nav-size) * 0.3) auto calc(var(--nav-size) * 0.5); }
.foo-title {
  font-weight: bold;
  letter-spacing: 0.04em;
  font-size: calc(var(--nav-size) * 0.85);
  margin: 0 0 calc(var(--nav-size) * 0.2) 0;
  text-shadow: calc(var(--nav-size)*.025) calc(var(--nav-size)*.02) var(--grey3-transp);
}
.foo-underline {
  height: 4px;
  width: 70px;
  margin: 0 auto calc(var(--nav-size) * 0.3);
  background: linear-gradient(90deg, var(--fg-blue), var(--fg-pink));
  border-radius: 2px;
}
.foo-subtitle {
  color: var(--text-color-accent);
  font-size: calc(var(--nav-size) * 0.3);
  line-height: 1.6;
  max-width: 640px;
  margin: 0 auto;
}

.foo-card {
  background: var(--bg-1);
  border: 1px solid #ffffff26;
  border-radius: 12px;
  box-shadow: 0 8px 24px #00000026;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  width: 100%;
  max-width: 720px;
  padding: calc(var(--nav-size) * 0.5);
  margin-top: calc(var(--nav-size) * 0.3);
  text-align: left;
}
.foo-card h2 { font-size: calc(var(--nav-size) * 0.38); margin: 0 0 calc(var(--nav-size) * 0.25); }
```

---

## 5. Standard component recipes

### Buttons

- **Primary** (the main action): gradient fill, inverted text.
- **Secondary** (less important, e.g. quick-fill buttons): transparent with a border.

```css
.foo-btn {
  font-family: inherit;
  font-weight: 700;
  font-size: calc(var(--nav-size) * 0.3);
  border-radius: 8px;
  padding: calc(var(--nav-size) * 0.22) calc(var(--nav-size) * 0.5);
  cursor: pointer;
  border: 2px solid transparent;
  color: var(--text-color-inv);
  background: linear-gradient(45deg, var(--fg-blue), var(--fg-mint));
  box-shadow: 0 4px 15px #00000033;
}
.foo-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 25px #0000004d; }
.foo-btn.secondary {
  background: transparent;
  color: var(--text-color);
  border: 2px solid var(--border-nav);
}
.foo-btn.secondary:hover { background: #ffffff1a; }
```

### Inputs

```css
.foo-input {
  flex: 1;
  min-width: 120px;
  font-family: inherit;
  font-size: calc(var(--nav-size) * 0.3);
  padding: calc(var(--nav-size) * 0.15) calc(var(--nav-size) * 0.2);
  border-radius: 8px;
  border: 2px solid var(--border-nav);
  background: var(--bg);
  color: var(--text-color);
}
.foo-input:focus { outline: none; border-color: var(--fg-blue); }
```

### Inline error

```css
.foo-error {
  padding: calc(var(--nav-size) * 0.2);
  border-radius: 8px;
  background: rgba(230, 70, 70, 0.16);
  border: 1px solid rgb(230, 70, 70);
  color: var(--text-color);
  font-size: calc(var(--nav-size) * 0.26);
  font-weight: 600;
}
```

### Result readout

Center the answer prominently with a muted label and a large value.

---

## 6. Page anatomy checklist

- [ ] `SEO` component present with `title`, `description`, and correct `path`.
- [ ] Uses `Header` (the modern header) — **not** the legacy `NavBar`.
- [ ] Root wrapper has the animated gradient + floating circles (unless the page is intentionally different, e.g. the Projects hub which uses a card grid).
- [ ] `section` → `title-wrap` (`h1` + underline + subtitle).
- [ ] Content lives in `*-card` "glass" containers.
- [ ] `Footer` rendered at the bottom.
- [ ] Project pages include a "View Source Code" link to the correct GitHub path.
- [ ] All classes prefixed with the page name.
- [ ] Works in light **and** dark theme.
- [ ] Looks right in landscape **and** portrait, at desktop, tablet, and phone widths.
- [ ] `prefers-reduced-motion` disables entrance/background animation.
- [ ] Keyboard: every interactive element is focusable; focus is visible.

---

## 7. Do's and don'ts

### ✅ Do

- Use `calc(var(--nav-size) * N)` for paddings, gaps, and component sizes.
- Use tokens (`--text-color`, `--fg-blue`, …) for every color.
- Use `Link` (from `react-router-dom`) for **internal** navigation.
- Use `<a target="_blank" rel="noopener noreferrer">` for **external** links.
- Validate user input and show a friendly inline error.
- Keep state minimal and local (`useState`) unless data must be shared.
- Give the answer/result an `aria-live` region when it changes without focus moving.

### ❌ Don't

- Don't use `NavBar` on new/refactored pages — it's the legacy header.
- Don't use `Times New Roman` or other hardcoded font families; inherit the app font.
- Don't call a state setter directly in `onClick` with the raw event (e.g. `onClick={setFoo(now)}`
  calls `setFoo` during render and passes the event object — wrap it: `onClick={() => setFoo(now)}`).
- Don't reference image assets with `require("...png")` unless the file actually exists in `assets/`.
- Don't reuse IDs across pages (old pages had `#ethanol-calculator-submit` copy-pasted into other pages).
- Don't hardcode hex colors outside of the intentional glass-effect translucency values.

---

## 8. Reference implementations

Copy patterns from these (they're the gold standard):

| Page | Path | Notes |
| --- | --- | --- |
| Ethanol Calculator | `frontend/src/pages/Projects/Ethanol/` | Full template: gradient, floating circles, presets, inputs, errors, result cards, log |
| Sonic | `frontend/src/pages/Projects/Sonic/` | Same template with live status dot, tuner meter, spectrum bars |
| Halfway | `frontend/src/pages/Projects/Halfway/` | Template + quick-fill buttons + solar-times card |
| Projects hub | `frontend/src/pages/Projects/Projects/` | Card-grid variant with search + category filters (no gradient background) |
| Home | `frontend/src/pages/Home/Home.jsx` | Hero + link tiles + typewriter, the original gradient background |

---

## 9. Quick pre-merge checklist

1. `npm run build` (or at least the dev server) compiles cleanly.
2. Manually toggle light/dark and eyeball text contrast, borders, and button fills.
3. Resize the window through phone → tablet → desktop and check nothing overflows or clips.
4. Tab through the page and confirm focus outlines are visible on every control.
