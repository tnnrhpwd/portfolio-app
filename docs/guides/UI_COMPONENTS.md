# Frontend UI — components & page anatomy

Part of the [frontend UI standard](./FRONTEND_UI_STANDARD.md), which indexes the whole set.
The section numbers are the standard's own and were not renumbered when the file was
split, so this file carries **§6–§9**. §1–§4 and §10 stay in the hub; §5 is in `UI_LAYOUT.md`; §11.x in `UI_DESIGN_RECORDS.md`.

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
