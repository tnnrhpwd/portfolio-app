# Admin "Special" user flag (unlimited AI credits + paid-tier bypass)

A per-user, admin-only escape hatch that grants unlimited AI credits and
bypasses paid (Pro) requirements without changing the user's Free/Pro rank.
Special is **distinct from admin** — only `ADMIN_USER_ID` can open the admin
page; `Special:true` never grants admin access.

## What it is

- A `Special:true` field on a user's `text` record in DynamoDB.
- Read by `isSpecialUser()` in `backend/utils/apiUsageTracker.js` (regex
  `/(?:^|\|)Special:true/i`).
- When set, the user is treated as paid-equivalent for feature gates:
  - `canMakeApiCall()` and `trackApiUsage()` treat the user like an admin:
    unlimited access, no credit deduction — usage is still logged.
  - `getUserStorageUsage()` (via `storageTracker.js`) applies the Pro storage
    allowance (50 GB) and reports `membership: 'Pro'`, so both display and
    write-capacity enforcement use the Pro limit.
  - `validateModelTierAccess()` (`llmService.js`) skips model-tier gates.

## How to set / clear it

- Toggled from the Admin user-management table (frontend `Admin.jsx` →
  backend `adminController.js`). No direct DB edit is needed.
- It is a **rank-independent override**: a Free user with `Special:true` gets
  Pro-level AI credits and storage while their underlying `Rank` stays Free.
  It does not create a real Stripe subscription and does not grant admin
  page access.

## Why it must be documented

- It is invisible in the product itself — no tier, no pricing mention.
- The `41a31e6` credit-tracking bug was exactly this kind of quiet exception:
  a stale-cache write silently wiped a user's `Special` flag and, more
  seriously, briefly overwrote their password hash with a literal
  `'[redacted]'` string. The credit-write path in `apiUsageTracker.js` now
  rebuilds from the raw (unredacted) record via `getRawUserRecord` /
  `updateUserCredits` specifically to avoid that.

## Intended use

- Support, testing, and partner accounts.
- **Not** a documented tier. Do not reference it in pricing, Terms, or
  marketing copy.

---

## The Special tier as built

> Moved out of the platform plan doc on 2026-09-16, when it became a pointer file for
> agents ([`agent.md`](agent.md)). Section names are the reference here — no chapter
> numbers.

### Special accounts get four admin views (2026-09-12)

The `Special` tag (`PUT /admin/users/:id/special`, stored as `|Special:true`) used to
grant one thing: unlimited API credits. It now also grants **read-only access to four
admin views** — Dashboard, Visitor map, Reviews and Page rankings — so a helper can
watch the funnel without being handed the write surfaces.

- **The boundary is `backend/middleware/adminAccess.js`** (`requireAdmin` vs
  `requireAdminOrSpecial`), and only three routes take the `OrSpecial` variant:
  `GET /all/admin` (the map + reviews payload), `GET /admin/dashboard` and
  `GET /analytics/page-rankings`. The users list, the purchase gate, the data explorer,
  the home-title editor, the email tests, `POST /admin/agent-fix` and Deep Storage stay
  admin-only. The per-handler checks in `adminController.getAdminDashboard`,
  `pageViewsController.getPageRankings` and `getHashData.getAllData` were widened to match
  — flipping only the route middleware would have 403'd inside the controller.
- **The client mirrors it** (`frontend/src/constants/admin.js`): `SPECIAL_ADMIN_PATHS`
  drives the tab row, the toolbar `<h1>` and a guard that bounces a Special account off
  any other `/admin/*` view instead of showing panels that would 403. `isSpecial` is
  attached to the login/register responses; there is no client-side fallback, so an
  account flagged *after* signing in must sign in again.
- ✅ **`GET /all/admin` was shipping every user's password hash.** It returns `item.text`
  verbatim, and a user row carries `|Password:<bcrypt hash>` inline. No client reads it;
  it is now `redactPassword()`-ed. Non-negotiable before widening access to the endpoint to
  anyone but the owner.
- ⚠️ **A Special account can still see what those four views show**: visitor IPs, cities,
  reviewer emails, signup emails and MRR. That is inherent to the views the owner asked
  for, but it is a lot for what is nominally a credits perk — worth a second look if the
  tag is ever granted more widely.
- ✅ **The purchase gate moved to `/admin/funnel-tester`.** It sat at the top of the
  Dashboard, which is exactly the view a Special account *can* open, so it either had to
  paint a 403 or be conditionally rendered. Moving it is the honest fix: it now lives on
  an admin-only view with the rest of the money plumbing, and the toolbar readout carries
  `Purchasing ON/PAUSED` there instead.
- ✅ **`Hide my visits` → `Hide admin visits` + `Hide special visits`** on `/admin/map`.
  The old toggle compared against *whoever was signed in*; the two new ones filter the
  `ADMIN_USER_ID` account and the set of `|Special:true` accounts, independently. The
  nickname/Special directory is now built from the `getAllData` payload the page already
  loads, which also fixed a silent cap: the previous lookup asked `/admin/users` for
  `limit: 200`, so any account past the first 200 had no nickname.
- ✅ **Top countries (and the map's Location column) spell the country out.** ipinfo
  returns `country: "CA"`, which is fine in a dump and useless in a report —
  `frontend/src/utils/countryName.js` maps it via `Intl.DisplayNames`, passes anything
  that isn't a bare two-letter code through untouched, and never invents a value.
- ✅ **The sales funnel showed three identical rectangles.** Each bar's label sat *inside*
  it with `min-width: 108px`, so a 0.3% step was padded to the same width as the 100%
  step. It is now a `label | track | count` grid: the widths are true proportions (1.5%
  floor so a small step is still a visible sliver), the conversion captions sit under the
  bar they convert from, and the overall rate moved into the panel head.
- ✅ **Two `VisitorMap` bugs found while polishing it**: the dark tile `invert()`
  filter ran in light mode too (navy map on a light page — now scoped to `.dark-theme`),
  and the popups/tooltips used `--bg-2`, a token that does not exist in `index.css`, so
  they rendered with no background at all (now `--bg-1` + a real shadow).


### Making the Special tier actually reachable (2026-09-12)

Trying to *use* *Special accounts get four admin views* turned up three things, two of them real bugs and one of them the
reason it looked broken in the browser.

- ⚠️ **The dev backend was serving pre-change code.** The live `/login` response came back
  without `isSpecial` even though `postData.js` adds it (and logs the key list), so the
  Special plumbing added there — the middleware, the three widened routes, the login
  flag — was not in the running process at all. Symptom: a Special-bound account shows the
  four tabs (client-side, from a stored flag) but every request behind them 403s. Any test
  of this feature needs a **restarted** backend; nothing in the frontend can paper over it.
- ✅ **`PUT /admin/users/:id/special` refreshed only one of the two caches.** The flag lives
  *inside* the record's `text` blob (`|Special:true`), so every cache holding that record
  answers with the old value until its TTL runs out. The handler dropped the credits cache
  (`apiUsageTracker.refreshUserDataCache`) but not the auth one
  (`authMiddleware.invalidateUserCache`, 5-minute TTL) — and it is the auth cache that
  `isSpecialRequest` reads through `req.user.text`. Both directions were wrong: a freshly
  tagged account was refused for up to five minutes, and a **revoked** account kept its
  four views for up to five minutes. Now one call, `refreshAccessCaches(id, item)`, in
  `middleware/adminAccess.js`, which is also where the invariant is documented. Covered by
  three tests in `__tests__/unit/adminAccess.test.js`.
- ✅ **A tag applied mid-session needed a re-login, and no longer does.** `isSpecial` rode
  only on the login response, so an account flagged *after* it signed in had no way to
  learn about it on the client. `/usage` already reports the live flag, so
  `getUserUsage.fulfilled` now raises `state.user.isSpecial` (and `dataService.getUserUsage`
  persists it), and `AdminLayout` asks the server that one question before deciding "not
  Special" for a signed-in non-admin. It only ever *raises* the flag, from an explicit
  `isSpecial: true` in a successful response — the server stays the authority.
- 🐛 **The new gate had a bug the new tests caught.** Folding "is the check in flight?" into
  the same flag that told the gate to wait meant the gate stopped waiting the moment the
  request started, and bounced the account home before the answer arrived. The two are now
  separate (`awaitingSpecialCheck` for the wait, `shouldAskForSpecial` for the request).
  `frontend/src/pages/Admin/AdminLayout.test.jsx` pins all of it: 9 tabs for admin, exactly
  4 for Special, `/admin/users` bounced, a mid-session tag let through, a failed check
  settling the wait, and no check at all for a signed-out visitor.
- ✅ **The hidden views really are hidden.** The console's tab row is built from
  `allowedViews` (admin: all nine; Special: the four in `SPECIAL_ADMIN_PATHS`), verified in
  the browser as 4 tabs — and the only `/admin/*` link rendered *inside* a view is the
  Dashboard's referrer rows pointing at `/admin/map`, which a Special account may open.

