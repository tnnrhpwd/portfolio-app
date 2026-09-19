# The addon chat — a mirror of `/net`, on the addon's own agent loop

`simple-addon/renderer/chat.html` (opened from the tray's **Open Chat** or the
dashboard's ☰ drawer → *This app → Open chat*) is the addon's own conversation
surface. It is a **mirror of `/net`'s agent conversation, not a copy of its engine**:
the presentation, the wording and the conversation STORE are shared, and the brain is
the one already on this machine.

Mirroring the store matters as much as mirroring the look: the window writes to the
same cloud row `/net` does (§6), so a thread started on either surface appears on the
other.

---

## 1. Why it is a separate window, and not a dashboard view

`/net` is a page: the conversation owns the whole route, with the conversation rail
collapsed behind a `☰`. The addon's chat is the same shape, so it is its own
`BrowserWindow` rather than a panel inside `dashboard.html` — a panel would be
wrapped in the dashboard's head and drawer chrome, which is the chrome the page
exists to get away from.

It is a **singleton**: a second window would be a second view of the same agent, and
two of them racing for the same permission prompt is worse than one.

---

## 2. Which engine answers, and why that one

`/net` splits by **how the addon is reachable**, and this window sits on the
`addon-reachable` side of that split permanently: it *is* the addon. So a message
goes to `POST /api/agent/run` and the live stream comes from
`GET /api/agent/events` — the addon's own O-O-G-P-A loop, its own tools, its own
permission gate. The turn itself never hops through the cloud, and it works signed
out. (The *conversation* syncs to the cloud — that is §6, and it is a separate
transport from the one that runs a turn.)

That also settles the two ADRs the harness plan already fixed
([`NET_HARNESS_PLAN.md`](NET_HARNESS_PLAN.md) §3): the interactive loop stays a
*step* list rather than a message stream, and **approval stays on the machine that
owns the resource** — `permissions.js` is still the authority, and the card in this
window is the same approval the Permission Center shows.

⚠️ The corollary is that this window **cannot** answer a question about cloud data
(goals, notes, tickets) or use cloud-only intents (image generation). Those are
`/net`'s, and `/net`'s router already sends them there. The chat's head says nothing
about it; a request of that shape will simply run — or not run — on this PC.

---

## 3. One turn, step by step

| # | Hop | Where |
|---|---|---|
| 1 | The user's message is appended and the turn is marked running | `renderer/chat.js` → `send()` |
| 2 | An **empty assistant bubble** appears with a typing bubble holding the dots AND a one-line note | `typingEl()`, `.typing__bubble` in `renderer/chat/chat.css` |
| 3 | The live stream is opened **before** the dispatch | `openStream()` → `EventSource(/api/agent/events?types=…&sinceSeq=…)` |
| 4 | `POST /api/agent/run` runs the loop to completion (≤180 s) | `server/automation/index.js` → `runGoalToCompletion()` |
| 5 | `tool.start` / `tool.end` / `agent.step` / `agent.thought` move the note and the step rows | `progressFromEvent()`, `applyStepEvent()` |
| 6 | `approval.pending` puts a card above the composer; the loop is blocked until it is answered | `renderApproval` → `POST /api/automation/approve` |
| 7 | The turn ends: the SAME bubble is filled in with the answer, or with an explanation | `runOutcome()` |
| 8 | The finished turn is appended to the conversation, persisted locally, and pushed to the shared cloud row | `chat-store.js` → `localStorage`; `syncNow({force:true})` → §6 |

The typing bubble is not a stored message. It exists only while the turn runs, which
is why the finished turn arrives as one new message rather than a bubble that is
edited twice.

---

## 4. What is shared with `/net`, and how the sharing is enforced

The **wording** is the same voice, and it is mirrored rather than imported — the
website's copies (`frontend/src/utils/simpleAddon/agentProgress.js`,
`agentStopMessage.js`) are ES modules and the addon's windows are `file://` pages
that load CLASSIC scripts, which Chromium refuses to run as modules.

`simple-addon/renderer/chat/chat-format.js` is the addon's half, and
`chat-format.test.js` reads the two website modules and asserts every shared
fragment is still there. A wording change on one surface and not the other fails the
addon's test run and names the string — the same drift alarm
`appearance.test.js` uses for the scheme list.

The two deliberately differ in **where a step row comes from**:

| | `/net` | the addon chat |
|---|---|---|
| live rows | the harness journal's `step` SSE (`running` → `ok`/`error`/`denied`) | `tool.start` / `tool.end` from `events.js` |
| finished rows | `message.steps` — the journal's step records, carried on the message so a reopened conversation still shows them | `result.stepLog` — the loop's own `{tool, args, ok, result}` |

Both normalise to one row shape (`applyStepEvent` / `stepsFromStepLog`), so one
renderer draws either.

### The failure vocabulary is *not* shared, on purpose

`/net` has the P6 taxonomy (`harness/toolOutcome.js`: `transient`,
`invalid-input`, `not-found`, `permission`, `fatal`, plus `step.reaskable`). The
addon's local loop has no such classifier — a tool either worked or it did not — so
this window does not invent one. It shows `ok` / `failed` and the tool's own error
text, and it does **not** offer a "Try again" button: on this surface the whole point
is that the user is at the machine, so the honest next step is to say what happened
and let them ask again.

---

## 5. The things that are easy to get wrong here

1. **The SSE stream replays its ring on subscribe** (`events.recent(20)`). Two
   filters: `sinceSeq` on the URL (so a replay is not even sent — `lastSeq` is kept
   across turns) and `since: turnStartedAt` per event, for the FIRST turn where
   there is no seq to start from. Without them the previous run's last tool flashes
   up as if it were happening now. ⚠️ `lastSeq` is FORGOTTEN on a stream error: the
   addon server restarts its counter, so a remembered seq from before a restart sits
   above every new event and suppresses the live note for a whole turn. Taking the
   replay again costs at most 20 events, each dropped by the `since` filter.
2. **Named SSE events never reach `onmessage`.** Every type must be in the URL's
   `types` filter AND have its own `addEventListener`. The filter is built from
   `SimpleChatFormat.AGENT_PROGRESS_TYPES`, and `chat-format.test.js` asserts that —
   a type that is handled but not listed fails silently.
3. **The status poll is a fallback only.** `/api/agent/status` describes a *loop
   instance*, and a chat run lives on a pooled loop (`_getOrCreateLoop(slug)`), so it
   can be reporting a different run. It is skipped for the rest of the turn as soon
   as a live event has moved the note — same rule as `/net`.
4. **⚠️ ONE GLOBAL SCOPE.** `chat.html` loads classic scripts, so every top-level
   `const` in `appearance.js`, `chat-format.js` and `chat-store.js` shares one
   lexical scope, and a duplicate is a **SyntaxError that kills the whole file** —
   not a shadow. This shipped broken once: both `chat-format.js` and `appearance.js`
   declared `const API`, and the window rendered its "failed to load its own scripts"
   fallback with no other clue. The export objects are now named uniquely, and a test
   asserts no name is declared twice across the three modules. A future module should
   either use a unique name or be wrapped in an IIFE.
5. **A failure must announce itself.** `runOutcome()` renders an error as
   `Error: …`, because the repo's convention is that an unprefixed string is counted
   as a success by the consumers that only look at the prefix.
6. **⚠️ A pull must not be able to destroy what the cloud does not carry.** The cloud
   copy is a *stripped* one whenever a thread is heavy, so an adopt that REPLACED local
   messages deleted the agent trace from its only home. The fix is the website's own
   rule rather than a special case: adopt UNIONS same-id messages. See §6 rule 3.
7. **A timestamp is read leniently.** The store speaks ISO strings; a reader that does
   `Number(value)` turns every one of them into `NaN` and renders nothing at all. That
   is what a `ts` → `timestamp` rename did here, silently, to every bubble and rail
   row. `formatWhen()` accepts both on purpose.

---

## 6. Storage — one cloud row, shared with `/net`

**The addon writes to the SAME row the website does** (`csimple_convos_<userId>`, via
`POST /api/data/csimple/conversations/merge`), so a thread started here appears in
`/net`'s rail and a thread started there appears here. That is the point of the mirror:
two surfaces, one conversation history.

`localStorage` (`simple_addon_chats_v2`) is the offline copy, not a second store — the
window opens and works signed out, and the cloud is what makes it a mirror.

### The message shape is the WEBSITE's, and that is load-bearing

    conversation  { id, title, createdAt, updatedAt, messages[] }   ← ISO 8601 strings
    message       { id, role, content, timestamp }                  ← ISO 8601 string
    + additive:     kind, steps, goalSlug

⚠️ **ISO strings, not epoch ms.** The backend's own merge helpers
(`csimpleController.js`: `conversationRecency`, `mergeMessageLists`) recover recency and
ordering with `Date.parse(timestamp)` / `Date.parse(updatedAt)`. An epoch-ms *number*
parses to `NaN` — silently "no recency" — so the addon's conversations would sort last
and their messages would lose order against the website's copy. The addon therefore
speaks the website's units rather than converting at the boundary, where a missed field
would be invisible. (The first draft used epoch ms, before the cloud work started; the
storage version was bumped rather than migrated, since nothing had shipped.)

### The four rules that make the sync safe

| # | Rule | Where |
|---|---|---|
| 1 | **Read first; write only for a reason.** | `chat-sync.js` → `pendingUpload` |
| 2 | **The server merges; we adopt — by merging again.** | `chat-store.js` → `adoptSynced` |
| 3 | **A pull can never drop a field only this device holds** (above all the agent trace). | `chat-store.js` → `mergeMessages` |
| 4 | **Never mid-turn; a failure never costs local data.** | `chat.js` → `syncNow` |

**1 — Read first.** This row can be hundreds of KB, so re-writing it to say "nothing
new" is not free (DynamoDB bills per write). So every sync is a `GET` first, and a merge
happens only when this device holds something the cloud does not: a conversation the
cloud lacks, a conversation where we have MORE messages, or a tombstone the cloud has
not recorded. ⚠️ The first draft merged on **every open**, which pushed this device's
empty "New chat" placeholder at the cloud *before* pulling — a write bought with nothing,
and the first thing a fresh install did. A window open and a 30 s poll are now read-only
in the common case.

**2 — Adopt, with two local exceptions.** Tombstoned conversations are dropped (a delete
on another device wins); a local-only conversation **with messages** is kept (it is
absent from the answer only because the write was in flight, and dropping it would
delete a turn the user just watched); an empty local-only conversation is dropped
because the server filters empty threads on purpose. This is the bug `/net` hit and
fixed — the rule is stated once, unit-tested, and it is the one place a sync can lose
the user's data.

**3 — Adopting MERGES; it never replaces.** Same-id conversations are merged and their
messages unioned by id (the website's `chatStore.mergeMessageLists` rule, which is
also the backend's). `{ ...local, ...remote }` keeps every key only the LOCAL copy
carries while the remote's own fields win — which is what protects the agent trace,
because the cloud only ever receives a *stripped* payload when a thread is heavy and
its copy therefore has no `steps` at all.

⚠️ The first implementation took the cloud's copy wholesale and then patched the
trace back in with a dedicated repair step. Driving a 413 through the window proved
the hole (the tool rows vanished from the screen and from storage on the next pull),
and the repair was the wrong shape: a replace-plus-exception is fragile to the NEXT
field the wire format decides not to carry, while a union is immune by construction.
It is also simply what the website does, which is the point of a mirror.

**4 — Never mid-turn.** A merge replaces the conversation objects a running turn is
holding. `/net` skips its poll while generating for the same reason. Every failure path
leaves `conversations` untouched and only moves the sync badge.

### Tombstones

Deleting is a tombstone (`deletedIds`), persisted next to the conversations and unioned
by the server (`unionTombstones`), so a delete on one surface is not resurrected by the
other's next sync. A delete pushes immediately rather than waiting for the poll.

### Weight, and what gets dropped first

`chat-sync.js` mirrors the website's `conversationWeight.js`: past 1.5 MB uncompressed
the payload is stripped before it is sent, and a server **413** is retried **once**
without the agent detail. The trade-off is the same one the backend journal already
makes — *the agent trace is a live view, the conversation is the record* — and the
trade-off is the same on both surfaces because a drift test reads the website's module
and asserts the addon still agrees on the dropped keys and the threshold.

⚠️ Two refusals are deliberately **not** retried: a payload that was already stripped,
and any non-size failure. Retrying either would hide a real error behind a "successful"
degraded sync. When the retry succeeds the badge says **`✓ Synced (steps trimmed)`** —
never a bare "Synced", which would hide the one consequence the user could act on.

### Signed out

`GET /api/conversations` answers 200 with `signedIn: false` (and `merge` answers **401**,
not 502) so the window renders **"On this PC only — sign in on the web app to sync"**
rather than painting a failure over a fresh install. A stale token reads as signed out
for the same reason.

### The JWT never reaches the renderer

The token lives in the addon's process (`cloud-relay` → `setTokenGetter`). The window
calls two addon routes — `GET /api/conversations` and `POST /api/conversations/merge` —
which proxy to the backend through `workspace-client.js`, exactly as `compile-natural`
and `edit-natural` do. A `file://` window holding the auth token is a token that leaks
with any renderer bug.

⚠️ **The proxy passes the backend's status through unchanged.** The renderer's size
policy retries on a 413 and nothing else, so flattening a failure to 502 would turn that
retry into a guess at the error's wording — or hide the one signal that says "this
payload is too heavy". `conversation-routes.test.js` pins that.

---

## 7. How it was verified

- **Unit** — 134 cases across five suites, all registered in `simple-addon`'s
  `test:unit`: `chat-format.test.js` (34), `chat-store.test.js` (36),
  `chat-sync.test.js` (37), `conversation-routes.test.js` (10), plus the pre-existing
  `appearance.test.js` (17).
- **Structure** — every page's inline scripts parse; tag counts balance; CSS brace and
  comment pairs balance; no classic-script global collisions (that check exists because
  two files declaring `const API` killed the page with a SyntaxError and no other clue).
- **The proxy contract, in-process** — `conversation-routes.test.js` boots the real
  `mountAutomation()` app with a fake workspace client and asserts: signed-out is 200
  with `signedIn: false`; a tokenless merge is 401 and never reaches the network; **413
  stays 413**; 401 stays 401; a statusless error becomes 502; both routes are reachable
  (not shadowed).
- **The window's sync flow, DRIVEN** — against a throwaway stub that models the real
  backend (union merge, tombstones, 413-until-stripped), so no real conversation data
  was touched:
  - a thread created on `/net` appeared in the addon's rail **and rendered its
    messages**, with **zero writes**;
  - a turn taken in the addon was pushed, and the merge **kept** the web thread (4
    messages: 2 web + 2 ours);
  - a thread added on `/net` later was pulled with **no write**;
  - a delete recorded the tombstone, pushed, and removed it from the cloud copy;
  - a 413 retried stripped → badge `✓ Synced (steps trimmed)`, the cloud copy has **no
    `steps` at all** but keeps the turn text, and the local copy kept its rows — and
    after the FOLLOW-UP PULL (the operation that used to delete them) both the screen
    and `localStorage` still showed **2 rows** (`window list` ✓, `click at` ✕) while
    the pull itself stayed a read;
  - a hard failure → `Sync failed — this device still has your chats` with every local
    thread and bubble intact, and signed out → `On this PC only …` with zero writes.
- **The display and the re-send paths, driven** in the same harness:
  - every bubble and rail row shows a real time (this caught the `ts` → `timestamp`
    regression, which had left all of them blank);
  - a reply's links: `https://…` reaches `openExternal` and `C:\…\Downloads` reaches
    `openPath` — so neither opens a stray Electron window — while a `javascript:` URL
    stays literal text and is never linkified;
  - the low-confidence **"Yes, do it on my PC"** button re-runs the turn with the text
    the USER typed (`{description: 'email my girlfriend that I love her',
    forceAction: true}`), not the question the agent asked back.
- **Also driven, against the installed addon** (port 3001): a non-actionable message →
  the conversational reply; an actionable one → the live note moved (`Step 2 of 60…`), a
  step row opened and closed (`✓ window list 1.2s`), and the turn ended with the stop
  report ("The agent stopped before finishing / Why: … / How far it got: 2 steps / What
  it tried: `window list` — worked, `goal update` — worked") plus the persisted step
  list. Drawer behaviour at 420px, both modes, and no page errors on a fresh load.
- ✅ **The real cloud round trip, VERIFIED against the live backend** (`npm --prefix
  simple-addon start`, i.e. the addon's own server carrying the new routes, signed in):
  - `GET /api/conversations` answered `signedIn: true` with **20 real conversations**
    from the account's `/net` history and 16 tombstones;
  - the window's rail filled with those 20 threads, the badge read **`✓ Synced`**, and
    opening one rendered the real thread (the user's request, the assistant's stop
    message, and a real timestamp);
  - ⚠️ and the sync **wrote nothing at all**: the cloud item's `updatedAt` was
    byte-identical before and after the open. That is the read-first gate (§6 rule 1)
    holding against real DynamoDB, which is the whole reason it exists.
- ⚠️ **Still NOT exercised: the approval card.** No prompt can fire on the test machine
  — every permission category is `allow`, and changing the user's permission policy for
  a UI check is not a fair trade. Set one category to `ask` and send an action in it to
  close that gap. (`approval.pending` → `approvals.set` → `renderApprovals`, plus the
  `/api/automation/pending-approvals` read at boot, is verified by reading only.)
- ⚠️ **A dev run does not auto-update**: Electron reports "not packed", so
  `Check for Updates` is skipped. An installed build is what the updater serves, which
  is why the version-gap state below exists at all.
- ✅ **Checked, and NOT a problem: `/net` losing steps on a stripped sync.** This was
  flagged here as a suspicion; reading the code settles it the other way. The website's
  `chatStore.mergeMessageLists` folds the copies with `{ ...local, ...remote }`, so a key
  only the local copy carries — `steps`, `plan` — survives, and `adoptSyncedConversations`
  goes through it. Its behaviour is the same as this window's, which is why the addon
  adopted the same rule rather than a repair step of its own.
- ⚠️ **A build that predates these routes answers 404 to every sync.** That is not a
  failure and must not be painted as one: the badge says *"On this PC only — this addon
  build has no cloud sync yet"* with the tooltip *"Update the addon to sync these
  conversations with the web app."* A red error there would make a working chat look
  broken, and it is exactly the state seen between shipping the renderer and shipping a
  build that can serve it.

---


## 8. Where it is wired

| Piece | File |
|---|---|
| The page | `renderer/chat.html`, `renderer/chat/chat.css` |
| The controller | `renderer/chat.js` |
| Pure parts (testable) | `renderer/chat/chat-format.js`, `chat-store.js`, `chat-sync.js` |
| Native bridge | `renderer/chat-preload.js` → `window.simpleChat` |
| Window + IPC | `main.js` → `openChat()`, `chat:open-external`, `chat:open-path`, `chat:open-web-app`, `chat:open-dashboard` |
| Entries | `tray.js` → **Open Chat**; `dashboard.html` drawer → **Open chat** (`dashboard:open-chat`) |
| Cloud proxy | `server/automation/index.js` → `GET /api/conversations`, `POST /api/conversations/merge`; `workspace-client.js` → `getConversations()` / `mergeConversations()` |
| Dev preview | `scripts/dev-preview.js` — `--page chat.html`; the `simpleChat` bridge is stubbed by the shim |
