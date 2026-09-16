# Pages and routing — one manifest, `/all`, and the dropper

`frontend/src/constants/pages.js` as the single routing table, the `/all` page index
generated from it, and the header dropper trimmed to point at it.

> Moved out of the platform plan doc on 2026-09-16, when it became a pointer file for
> agents ([`agent.md`](agent.md)). Section names are the reference here — no chapter
> numbers.

---

## `/all` — the page index, and one manifest for every route

Shipped 2026-09-15: **an index of every page, for the owner**, and **a manifest the router and the
index are both built from**, so adding a page is one entry and the list cannot go stale. The header
dropper was trimmed in the same pass, because it had become a second, worse version of the index.


### `constants/pages.js` — the routing table

`App.js` used to hold ~75 hand-written `<Route>` lines plus its own `lazy()` imports. Both moved into
`frontend/src/constants/pages.js`, and `App.js` now calls `PAGES.flatMap(routesForPage)`.

- **One entry per page**: `path`, `label`, `group`, `access`, `element`, and optionally `aliases`
  (`/home`, `/Coliseum`), `children` (the admin console's nine nested routes), `dynamic`
  (`/u/:username`), `redirect` (`/contact` → `/support?tab=contact`) and a one-line `note`.
- **`routesForPage()` renders the shapes**: a plain route, one route per alias, a nested block for a
  parent with children (`segment: ''` → `index`), or a `<Navigate replace>`. An alias renders the
  page rather than redirecting, so the address a visitor typed is the one they keep.
- **The catch-all stayed in `App.js`** (`NOT_FOUND.path`). It is not a page anybody can link to, so it
  has no place in the index — and a route list that generates itself would otherwise have advertised
  `*`.
- **`access` is DESCRIPTIVE, not enforcement.** Every page still gates its own content and the backend
  owns the real boundary; the field exists so the index can say who each page is for. A wrong value is
  a wrong badge, never a hole — and `/deepstorage` is the live example: its badge reads Staff because
  `isAdminUser` is what the page checks, but the *route* has never been guarded (a signed-out visit
  renders the page and its data call 401s). Pre-existing, and left alone.
- **Home stays eager.** It is the only non-`lazy()` import, which is where the split already was.
- `flattenPages()` is the other export the page needs: it lifts the admin console's children into nine
  rows instead of one parent row that duplicates its own index.


### `/all` — the page

A SERVICE PAGE (§5.7 of the UI standard): `.service-room` for a ground, one row at the top (name, live count, actions) and
one glass panel per group in `PAGE_GROUPS` — panes of `--glass`, colour kept for the badges, as the
`/settings` restyle settled. No bands, no reveals, no floating anything.

- **Gate: `canUseAdminConsole(user)`** — admin or a Special account, the same gate the console itself
  uses. Everyone else gets `<NotFound />`, i.e. the 404 the route would give a stranger; the page is
  advertised nowhere they can see, so a 404 is both honest and quiet. Cosmetic, like every client gate
  here: it renders a static manifest, so there is nothing behind it to protect.
- **A row is one line in a three-column grid**: name · path (+ any chips) · access badge. The columns
  are the point — every path starts on the same left edge down the list and every badge makes the same
  right edge, which is what makes 68 rows scannable instead of a paragraph of links. Below 620px the
  row re-flows to two lines (`name badge` / `meta`) via `grid-template-areas`, so a phone gets a name
  and a badge per line instead of three ellipsed columns.
- **Two columns of rows, from a row-flow GRID rather than `column-count`.** 68 rows one per line is a
  page you scroll for a minute; an index should be visible. `column-count` was the first attempt and it
  is wrong here for two reasons: balanced columns put the second half of the list *below* the first, so
  DOM order (and the tab order that follows it) stops matching what the eye sees — and `nth-child`
  stripes then run down one column at a time, so the zebra came out as a staircase. A
  `grid-template-columns: repeat(2, minmax(0,1fr))` grid fills left-to-right, and the stripe can take a
  whole grid row (`.all-row:nth-child(4n + 1), :nth-child(4n + 2)`) so it reads as one band across both
  columns. One column below 900px, where the stripe switches to every other row.
- **The whole row is the hit area**, not the name: a long index is clicked fast and a four-word link is
  a small thing to hit. The name is therefore not itself a link, so the hover that names a colour lives
  on the row (`a.all-row-hit:hover .all-row-name`) — otherwise the global `a:hover` at `(0,1,1)` would
  paint every name the scheme's partner hue.
- **Rows are separated by that tint, not a hairline under each one** (§5 of the UI standard), and hover deepens the tone
  (4% → 7.5%) rather than adding a ring, a border or a shadow.
- **The panel's title is an eyebrow, not a heading** — `--font-size-xs`, tracked out, muted. At the
  panel-title size a 24-row panel read as a page inside the page and the list lost its hierarchy.
- **The badge's colour is in the WASH, never the words.** Painting an accent-coloured label on a wash
  of its own hue loses about a stop — the failure `/login` measured at 4.38:1 — so every badge inks
  with `--text-color`. Four levels as three hues plus a neutral: public = a text-colour wash, member =
  `--scheme-accent`, staff = `--scheme-primary`, muse = `--fg-pink`.
- **`Copy paths` is an OUTLINE, not the action ramp.** The page's one piece of brand is the accent rule
  under the row (§5.7); a saturated pill on the least-used control made it the loudest thing on the
  page. Its hover repeats `:not(:disabled)`, or the global `button:hover` repaints it (§6 of the UI standard).
- **The row carries the live state** — Pages 68 · Staff only 12 · Showing 68 — plus a filter (name,
  path or group; panels with no match disappear, with a one-line empty state and the control that fixes
  it) and `Copy paths`, which puts the newline-separated list on the clipboard. That is the reason the
  page exists: pasting the full URL list somewhere should not mean scrolling and retyping.
- Page root carries the scheme alias block, so the accent rule, the link hover and the input's edge
  follow the visitor's colour scheme like every converted page.


### The dropper — grouped, trimmed, and pointed at the index

- **Grouped with eyebrow labels**: Account · Explore · Workspace · Staff. `.dropper-label` is new in
  `dropper.css` (`--font-size-xs`, tracked out, `--text-color-accent`) — a label, not a heading.
- **Trimmed: `Plans` and `Market` are gone.** Both are rooms *inside* Simple, one tap from `SimpleNav`
  on every Simple surface, and listing them here made the drawer a second, worse switcher. The
  Workspace group is now the three front doors: Net, Talk, Simple.
- **`All pages` added** to the Staff group, behind the same `canUseAdminConsole` gate as the page.


### Verification

- `front.test.js` (the one suite that renders `App`) — **29/29 pass**; it mocks page modules by path,
  and the manifest resolves to the same ones, so no mock changed.
- **Routes still behave**, checked live as a signed-in admin: `/home` alias renders Home, `/contact`
  redirects to `/support?tab=contact`, `/admin` renders the Dashboard and `/admin/map` the Visitor Map
  (the nested block), `/plans/goal/:id` still bounces to `/login`, `/u/<username>` renders its
  not-found state.
- **`/all` signed out → 404**; signed in as admin → 68 rows in 7 panels, badges Public/Member/Staff/Muse,
  no console errors. Filter "staff" → 12 rows; "zzz" → zero rows plus the one-line empty state and its
  Clear control; clearing restores 68.
- **The row states were driven, not assumed**: hover deepens the tint (4% → 7.5%,
  `color(srgb … / 0.04)` → `/ 0.075`), and the row link takes the shared focus ring (`solid 2.5px`)
  because it is a real `<a>` with a visible outline.
- **Layout sweep** 320/620/900/1280/1920 × light and dark: zero horizontal overflow, zero clipped
  names, zero laid-out-but-invisible elements. The two-line phone row and the single-column list engage
  at their breakpoints (320 → 1 column, `areas: "name badge" "meta meta"`; 900+ → two 533–584px
  columns). Page height at desktop is 1816px for all 68 rows, against 4202px at 320.
- No test covers `/all` or the dropper (there is none to run — neither has a test file);
  `AdminLayout.test.jsx` mocks `Header`, so it is unaffected by the drawer change.

---

