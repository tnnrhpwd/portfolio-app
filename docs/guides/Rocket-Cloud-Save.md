# Rocket cloud save + leaderboard

Gives Rocket **profile-backed progress** — sign in and your coins, upgrades and
unlocked ships follow you to another device — and a **public leaderboard** ranked
by farthest wave.

It adds **no backend code**. Both features ride the app's generic, schema-less
`/api/data` routes, the same way `Game2048.jsx` does. The whole game stays
offline-first: signed out, unreachable backend, or a garbage response all degrade
to local-only play.

- **Read this** before touching `game/cloud.ts`, `game/save.ts`'s merge policy, or
  the menu's leaderboard overlay.
- Progress only — never run state. A run in flight is *not* synced; that is what
  `session.ts` deliberately keeps in memory.

Files:

| File | Role |
|---|---|
| `frontend/src/pages/Projects/Rocket/game/save.ts` | Local save, `migrate` (clamping), `mergeSaves` (the policy), `updatedAt`/`submittedWave` |
| `frontend/src/pages/Projects/Rocket/game/cloud.ts` | Transport + row formats + ranking + status. Pure helpers are exported for tests |
| `frontend/src/pages/Projects/Rocket/game/cloud.test.ts` | 18 tests over the merge policy, parsing and ranking |
| `frontend/src/pages/Projects/Rocket/game/session.ts` | Decides *when* to sync (`syncCloud`, `whenCloudSynced`, debounced push, submit on new best) |
| `.../game/scenes/MenuScene.ts` | LEADERBOARD overlay, cloud-status line, refresh-after-sync |
| `.../game/scenes/BootScene.ts` | Kicks the boot sync; does not wait for it |
| `.../game/scenes/GameOverScene.ts` | One line saying whether/why this run went to the board |

---

## 1. The API contract (and the three traps)

| Operation | Call | Body / query |
|---|---|---|
| Read my progress | `GET /api/data?data={"text":"RocketSave"}` | auth (returns **only my rows**) |
| Write my progress | `POST /api/data` | `{ text: "RocketSave\|{...}" }` — backend prepends `Creator:<id>\|` |
| Replace my progress | `DELETE /api/data/:id` per existing row, then POST | keeps exactly one row |
| Read the board | `GET /api/data/public?data={"text":"RocketLeaderboard"}` | no auth |
| Publish a wave | `POST /api/data` | `{ text: "RocketLeaderboard\|Public:true\|..." }` |

**Trap 1 — the private and public controllers read different field names.** The
private routes read `req.body.text`; `postData.js` reads `req.body.data.Text`. Send
`{ text }` to `/api/data/public` and you get a **500** (`Cannot read properties of
undefined (reading 'Text')`), not a validation error. This cost a debugging cycle;
the symptom looks like a broken client.

**Trap 2 — response rows use `data` and `_id`, not `text` and `id`.** Reading the
wrong fields filters every row away (saves never load) and makes the delete a
no-op (every write duplicates).

**Trap 3 — never `PUT /api/data/:id`.** It is coupled to unrelated payment-method
gating. Write a fresh row, delete the old ones.

### Why the leaderboard writes through the authenticated route

The board is public, but entries are published with `POST /api/data` (auth) rather
than `POST /api/data/public`. `postData` does **not** stamp `Creator:`, and
`deleteHashData` refuses rows with no creator (`Data creator not found`) — so an
entry posted through the public route can **never be deleted by anyone**, including
the player who posted it. That was verified, not assumed: deleting such a row
returns **500**, while the same delete against an authenticated row returns **200**.

The row stays publicly discoverable either way, because the anonymous scan is
`contains(text, 'RocketLeaderboard') AND contains(text, 'Public:true')`, which
matches regardless of the `Creator:<id>|` prefix. (`parseLeaderboardRow` locates the
marker rather than assuming it is at the start — there is a test for the prefix.)

## 2. Row formats

Flat `Key: value` pairs joined by `|`, with JSON only where the value is structured:

```
Creator:<userId>|RocketSave|{"updatedAt":1789261093466,"bestScore":4200,"bestWave":13,
  "coins":89,"levels":{...},"unlockedShips":["scout"],"ship":"scout","runs":5,
  "kills":50,"submittedWave":13}

Creator:<userId>|RocketLeaderboard|Public:true|Wave:7|Score:2210|Name:Tanne|
  At:2026-09-13T01:04:51.497Z|UserId:<userId>
```

Saves are JSON because an upgrade map and a ship list are not flat values; the
marker and `Public:true` stay flat so the row is greppable and the two row kinds
can never be confused. `parseDelimitedFields` rejoins everything after the first
colon in a field, or ISO timestamps would truncate to `2026-09-13T01`.

## 3. Merge policy (`mergeSaves`)

Merging is driven by what each field *means*, because the two obvious policies are
both wrong: "newest wins" loses real progress, and "add everything up" mints coins.

| Field | Rule | Why |
|---|---|---|
| `levels`, `unlockedShips` | per-key `max`, union | Nothing in the game sells upgrades back, so "best of both" is exact and can only go up |
| `bestScore`, `bestWave`, `runs`, `kills` | `max` | Undercounting a run played elsewhere beats losing the record |
| `coins`, `ship` | the **newer `updatedAt`** wins | Coins are the one value that genuinely moves: `max` mints coins when a newer save has spent them, summing duplicates them |
| `updatedAt`, `submittedWave` | `max` | Monotonic |

Consequences worth knowing:

- **Permanent progression is guaranteed to merge.** "Same upgrades on any device"
  is not a heuristic.
- Only a wallet that changed on **two devices at once** can lose the older side's
  coins — the least-bad of the three outcomes.
- A save that was **never written has `updatedAt: 0`**, deliberately not
  `Date.now()`. A fresh install must lose the wallet comparison, or signing in on a
  new device would keep its zero coins. Verified: an empty profile adopted
  `coins: 89, damage: 2` from the cloud.
- **A wipe stamps `Date.now()`** (`resetSave`), so a deliberate reset wins the merge
  — otherwise signing in again would resurrect deleted progress.
- `merged.ship` is re-validated against the merged unlock list, so a merge can never
  leave the selected ship locked.

## 4. Lifecycle

```
BootScene.create()
  └─ void syncCloud()            (does not block the loading screen)
        ├─ read profile save ──► mergeSaves(local, cloud) ──► adopt + persist
        └─ (nothing stored) ────► push, but only if this device has written
MenuScene.create()
  ├─ onCloudChange(refresh)       status changes while the menu is open
  └─ whenCloudSynced().then(refresh)   ← closes the race below
Play / Shop
  └─ commit(save)  ──► stamp updatedAt, persistSave, schedule push
                          └─ 4s debounce ──► cloudPushSave
GameOverScene (via finishRun)
  └─ wave > submittedWave && signed in ──► submitScore ──► persist submittedWave
```

**The debounce is not optional.** Coins are banked on every pickup, so a single
wave would otherwise fire dozens of writes.

**The race, and why `whenCloudSynced()` exists.** The menu shows before the sync
finishes (so a slow network never delays play). Refreshing only from a change
notification is not enough: if the sync settles *before* the scene exists, the
notification is missed and the menu renders pre-merge numbers — a new device showed
`COINS 0` while the cloud save said 89. The scene therefore also awaits the settled
sync promise, which resolves immediately if it already finished. The listener is
kept for changes that arrive later (a push completing while the menu is open).

Both `SHUTDOWN` **and** `DESTROY` detach the listener: the shell destroys the whole
game on rotation, so `SHUTDOWN` alone leaves a callback writing into dead text.

**A failed read must never become a write.** `fetchOwnRows` throws on a non-ok
response instead of returning `[]`, so "no rows" and "could not ask" cannot be
confused — otherwise a transient 500 would push this device's stale save over a
good one. For the same reason the boot sync pushes nothing when `updatedAt === 0`
(a fresh install has no progress worth publishing).

## 5. UI

- **Cloud-status line** under `BEST / WAVE / RUNS` (y 196 landscape, 224 portrait,
  `TEXT.dim`): guest / syncing / saved / unreachable. A guest sees one muted line,
  never a nag.
- **LEADERBOARD button** beside HOW TO PLAY in landscape (`cx ∓ 140`, y 598, both
  260 wide — a 20px gap) and below it in portrait (y 1014 / 1090, 280 wide). The
  two-layout rules in `Rocket-Game-Guide.md` §3 apply: no resizing, a plain ternary
  between the two arrangements.
- **Overlay** (720×560 landscape, `w-40`×760 portrait): header columns `#`, `PILOT`,
  `WAVE`, `SCORE` with right-aligned numbers, up to 10 rows, then a footer. The
  current player's row is gold and bold. States: loading / rows / empty ("no runs on
  the board yet") / signed out ("Sign in to appear here. Your best so far: wave N.")
  / own entry ("Your best: wave N · rank #1").
- The fetch is fired *after* the overlay is on screen, so the button feels instant
  and an unreachable backend explains itself instead of freezing the menu. Rows are
  added to the overlay container on arrival, and the callback re-checks that the
  overlay is still that same container before drawing.

## 6. Verification

Proven against the **live local backend** while building this:

- Boot sync wrote a real row; the profile round trip matched local state exactly
  (`coins: 89`, `levels.damage: 2`, identical `updatedAt`).
- Replacing progress left **exactly one** row (delete-then-post works; no
  duplicates).
- A brand-new browser profile with empty local storage **adopted** the profile save
  — 89 coins, damage level 2, and a `bestWave` it had never held locally.
- The published wave appeared on the anonymous board scan and was **deletable by its
  author** (`DELETE` → 200).
- Both orientations render correctly (screenshots taken in landscape 1280×720 and
  portrait 720×1280), plus the signed-out board state.
- 100 Rocket tests / 7 suites pass; `tsc --noEmit` clean.

The merge tripwire was verified the reliable way: loosening the wallet rule to
`Math.max` makes exactly one test fail (`takes the wallet from the most recent write,
and never mints coins`). A test that cannot fail is not a test.

**Note the jest working directory.** The jsdom default lives in the **root**
`package.json`; running `npx jest` from `frontend/` silently uses the node
environment and breaks any test touching `window` (2 failures in `layout.test.ts`).
Run suites from the repo root: `npx jest frontend/src/pages/Projects/Rocket`.

## 7. Known limitations

- **No server-side plausibility check on a submitted wave.** The client clamps wave
  and score, which is a soft guard only; real anti-cheat needs a dedicated backend
  controller. (Same caveat as the 2048 board.)
- **Rows published before this change** (via the public route, no `Creator:`) cannot
  be deleted through the API by anyone. One such test row remains on the board.
- A run that ends while offline is still recorded locally, but its wave is only
  published on a later boot if it still beats `submittedWave` — a failed publish is
  retried by the next qualifying run, not by a queue.
- The leaderboard is fetched fresh on each open; there is no polling or cache.
