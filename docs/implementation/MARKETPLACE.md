# The marketplace — published skills and shared goals

Where the community's skills and goals live: the public namespace, versioning and
forking, trust ranking, the pre-run capability summary, and the `/market` surface.

> Moved out of the platform plan doc on 2026-09-16, when it became a pointer file for
> agents ([`agent.md`](agent.md)). Section names are the reference here — no chapter
> numbers.

---

## Marketplace — 🟡 mostly shipped (backend, /market frontend, and pre-run capability + dry-run-first enforcement done; eval scenario + live-DynamoDB pass remain)

> ⚠️ **Scope note:** the marketplace is *not* "extend the existing skill
> endpoints." Today's skill endpoints (`/api/data/csimple/workspace/skill/*`)
> store **private, per-user** items keyed `csimple_ws_{userId}_{kind}_{slug}`.
> The marketplace needs a **new shared/public namespace** with its own read path
> (anyone can discover) and controlled write path (publish/fork).
> Link to it on the addon dashboard, /net, and /simple UIs


### Data model (new backend surface)

- **Published skill record** (public, immutable per version): `marketId`, `authorUserId`, `name`, `slug`, `version` (semver), `steps` (scrubbed — see `AUTOMATION_SECURITY.md` §12.1), `declaredCategories`, `toolSchemaVersion`, `naturalLanguageDescription`, `createdAt`.
- **Versioning + fork:** publishing creates a new immutable version; downloaders pin a version. A user can *fork* a published skill into their private workspace, edit, and re-publish.
- **Ratings:** `{ marketId, version, raterUserId, stars, ranAt, outcome }` — one rating per user per version, only from users who actually downloaded/ran it.
- **Counters (server-side, the KPI source):** `downloads`, `installs`, `creations` incremented atomically on the backend — NOT derived from the per-user action log.
- **Compatibility:** every published skill stores `toolSchemaVersion`; on download the client compares against its own registry and degrades gracefully (`marketplaceCapabilities.js`).


### API surface — ✅ shipped

> Mounted at `/api/data/market/skills*` on the backend (`routeData.js` is mounted
> at `/api/data`). The addon's local server exposes bare `/api/market/skills*` proxies.

| Route (backend: prefix with `/api/data`) | Purpose | Status |
|---|---|---|
| `POST /api/market/skills` | Publish skill (server-side re-scrub before persisting — see *Implementation checklist*) | ✅ Shipped |
| `GET /api/market/skills?q=<nl>&sort=trust\|downloads\|recent` | NL search + ranking | ✅ Shipped |
| `GET /api/market/skills/:marketId[/:version]` | Fetch a specific version | ✅ Shipped |
| `POST /api/market/skills/:marketId/install` | Increment `downloads`/`installs`, return installable scrubbed steps | ✅ Shipped |
| `POST /api/market/skills/:marketId/rate` | Submit run-gated rating | ✅ Shipped |
| `POST /api/market/skills/:marketId/flag` | Community flagging | ✅ Shipped |

**Implemented in:** `backend/controllers/marketplaceController.js` (DynamoDB
`Simple` table, `csimple_market_*` namespace), `backend/services/marketplaceRanking.js`
(pure trust/ranking helpers), `backend/services/marketplaceScrub.js` (*Privacy / PII scrubbing* in [`AUTOMATION_SECURITY.md`](AUTOMATION_SECURITY.md) scrub
port), `backend/services/marketplaceCapabilities.js` (*Inspect-before-run capability summary* in [`AUTOMATION_SECURITY.md`](AUTOMATION_SECURITY.md) mismatch-check port),
routes in `backend/routes/routeData.js`, addon proxies in `server/automation/index.js`,
and `workspace-client.js` wrappers.


### Trust model

- **Reputation/rating-based, no manual moderation/code-review queue** (matches Non-goals).
- Ranking signal = rating × volume × author reputation × recency × outcome-reliability (`outcomeFailRate`, derived from `successCriteria` outcomes); community flags deprioritize.
- **Cold-start mitigation:** the *real* safety floor is the execution layer (see [`AUTOMATION_SECURITY.md`](AUTOMATION_SECURITY.md)) — every downloaded skill runs through the permission gate, shell allow/deny-list, and protected-path blocking regardless of what it claims. In addition:
  - New/low-trust skills default to **dry-run-first** on first execution.
  - The pre-run capability summary (*Inspect-before-run capability summary* in [`AUTOMATION_SECURITY.md`](AUTOMATION_SECURITY.md)) is mandatory for any marketplace install.
- Marketplace success metric: **skill downloads and creations** are the primary KPI; `/telemetry/summary` folds in the marketplace counters.


### Web frontend — ✅ shipped

- Route `sthopwood.com/market` (`frontend/src/pages/Simple/Market/`): NL search, sort by trust/downloads/recent, detail modal with the pre-run capability summary, install → rate → flag, publish modal with scrub review, and save-to-addon (or JSON download).


### Marketplace implementation checklist

- 🟡 Backend contract tests for pagination/sort stability/install-rate constraints (offline tests cover these; a live-DynamoDB integration pass, `back.test.js`-style, remains).


### Ranking weights as explicit config

Ranking weights (`services/marketplaceRanking.js`) are still inline constants; make them config so trust tuning doesn't need a deploy.


### Shared GOALS — ✅ shipped (2026-09-12)

The marketplace carries **goals alongside skills**: a user can share one of their own
goals, and anyone else can save a copy of it into their workspace.

**Design: one namespace, two kinds.** A goal rides the exact same machinery as a
skill — the same `csimple_market_*` meta/version/install/rating/flag items, the same
trust ranking and `lowTrust` classification, the same install-attestation gate — with
`kind: 'goal'` on the meta item (absent means `'skill'`, so every pre-existing entry
is read correctly) and the goal's **text** in place of a compiled `steps` array:
`content`, `successCriteria`, `constraints`, `priority`.

- **A goal's `marketId` is its slug.** A slug is the thing someone can share, so
  `POST /market/goals` defaults `marketId` to the slugified name and refuses a slug
  already taken by a *skill* (the two would be indistinguishable in search) or by
  another author's goal (409). Publishing a new version of your own goal passes its
  `marketId` explicitly, exactly like a skill.
- **The goal's text is scrubbed** with the same PII/secret pass a skill's steps get
  (`scrubForPublish`; see [`AUTOMATION_SECURITY.md`](AUTOMATION_SECURITY.md)) before it is persisted — the reported `scrubReport`
  doubles as the pre-publish review data.
- **"Install" means "save a copy into my workspace"**, not "put it on my PC".
  `POST /market/goals/:marketId/install` writes an ordinary goal via
  `services/workspaceGoals.upsertGoal` under a *free* slug (a second save becomes
  "… (2)", never a clobber), bumps `downloads`/`installs`, and records the install
  attestation — so a saved goal can be rated through the existing rate endpoint.
- **Endpoints** (all `protect`ed; mounted next to the skill routes):

| Route (prefix `/api/data`) | Purpose |
|---|---|
| `GET /market/goals?q=&sort=trust\|downloads\|recent&page=&perPage=` | Browse shared goals |
| `POST /market/goals` | Share a goal (or publish a new version of your own) |
| `GET /market/goals/:marketId` | One shared goal |
| `POST /market/goals/:marketId/install` | Save it into my workspace |
| `POST /market/skills/:marketId/rate` / `/flag` | Shared route — a goal's marketId works here too |

**Frontend:** `/market` is now a **service page** (§5.7 of the UI standard — flat
surface, a row carrying the name + a **Skills | Goals** switch + the search, nothing
pinned, dense panel grid) and the
fourth room in the header switcher (`SIMPLE_NAV_SURFACES`). Sharing is picked from
the user's own goals (`listWorkspace(kind:'goal')`); saving shows the goal text, its
"done when" criteria, and one **＋ Save to my goals** button.

**Still open:** a live-DynamoDB pass, ratings that reflect a *run* of the saved goal,
and `/market` in the addon dashboard (`renderer/dashboard.html` still links skills
only).

