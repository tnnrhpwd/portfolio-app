# Talk — member messaging, and editing your own review

The messenger (`/talk`): its storage model, its encryption (in transit and at rest —
**not** end-to-end), its anti-spam limits, avatars, the unread count, and the review-edit
endpoint that shipped in the same pass.

> Moved out of the platform plan doc on 2026-09-16, when it became a pointer file for
> agents ([`agent.md`](agent.md)). Section names are the reference here — no chapter
> numbers.

---

## Talk — member messaging, and editing your own review

Shipped 2026-09-14. Two requests, one pass: **let a user edit their own review**, and **build a
messenger** (`/talk`) with friend requests, spam limits, and a direct conversation that replaces the
AI chat on `/net`.


### Why the review edit needed a new endpoint

A review is a **public** row: the Support form works signed-out, so it is written through
`POST /api/data/public`, which stamps **no `Creator:` segment**. The generic `PUT /api/data/:id`
authorises on `Creator:<userId>` (`putHashData.js`), so it 401s on every review — there was no way to
edit one, not a missing button.

So `controllers/reviewController.js` adds three routes with their own authorisation: the row's
`User:<email>` segment must match the caller's email.

```
GET    /api/data/reviews/mine      → the caller's reviews, newest edit first
PUT    /api/data/reviews/:id       → rewrite the blob (title/category/rating/content)
DELETE /api/data/reviews/:id       → remove it
```

- **Anonymous rows stay read-only.** `User:Anonymous` cannot be proven to belong to anyone, so an
  edit is refused. That is a deliberate trade-off, and the UI says so rather than hiding the button.
- **An edit preserves the author and `Timestamp:`** and appends `|EditedAt:<iso>`, which is what
  lets the admin view show that a review changed after publication. Edits are unlimited (the product
  decision) but rate-limited (`reviewWriteLimiter`, 40/15min).
- **`|` and newlines are replaced, not rejected** — in both the client (`utils/reviewUtils.js`) and
  the server. A `|` inside a title used to split the blob early and corrupt the row for every reader
  that splits on `|` (the admin table, `pull-support-tickets.js`).
- Segments are declared above `router.route('/:id')` and guarded by `routeOrdering.test.js`, the same
  trap `/profile` and `/email-preferences` were registered for.

Frontend: the list lives in the **existing** "Leave Review" tab (`components/Support/ReviewTab.jsx`) —
that is where a user who wants to change a review already is. `useMyReviews.js` owns the list and the
create-vs-edit decision, so `useSupportHandlers` no longer has a `handleReviewSubmit`.


### The messenger

**`/talk` is a SERVICE PAGE** (§5.7 of the UI standard): the shared room for a ground, one row at the top (name + handle
+ request/unread counts + Refresh) — in the flow, nothing pinned — then the panels — connect →
requests → connections — and the limits folded into a `<details>`. No bands, no circles, no reveals.

**There is no user directory.** You type a username you already know. That is what makes the request
limits a real constraint rather than theatre, and it is why `/talk` never lists accounts.

**The handle is the account's existing `Nickname`** — already enforced unique (case-insensitively) by
`registerUser` — so the feature needed no migration and every existing account has one.

**A member conversation lives on `/net?with=<userId>`**, where it *replaces* `SimpleChat`:

- Nothing on that path touches an LLM. The provider catalogue is not even fetched (`Net.jsx` skips
  `getLLMProviders()`), so "no AI in this conversation" is true rather than merely intended.
- It reuses Net's shell (`100svh` ladder, composer above the keyboard, `overscroll-behavior`) by
  filling `.net-hero-section`, and must never restate a height of its own — the same rule the UI standard's §5.7 states
  for the shell.
- `/talk`'s Message button is a `<Link to="/net?with=…">` rather than a `navigate()`, so Talk stays
  open behind the conversation.


### Storage: three item shapes and one derived index

All in the `Simple` table (composite key `id` + `createdAt`):

| Item id | Holds |
| --- | --- |
| `msg_index_<userId>` | one row per account: contacts, pending in/out, the outgoing request log, cooldowns — JSON in `text` |
| `msg_friend_<a>_<b>` | one row per friendship, ids **sorted** so the pair has a single canonical row. This is the authorisation check for messaging |
| `msg_block_<blocker>_<blocked>` | one row per block, ids **NOT sorted** — a block is one-directional (`PROFILES.md` → *Blocking, and removing a connection*) |
| `msg_req_<to>_<from>` | one row per friend request (its status is the record of truth) |
| `msg_msg_<convId>` + `createdAt` | one row per message |

- **The conversation is the partition, the sort key is the timestamp.** That is what makes
  `GET …/messages?since=` a pure key condition (`id = :conv AND createdAt > :since`) with
  `ScanIndexForward: false` and a `Limit` — no filter, no GSI, no cursor table.
- ⚠️ **The sort key must be unique and monotonic.** `toISOString()` has millisecond resolution, and
  two messages in one millisecond are the *same row* — the second silently overwrites the first.
  Worse, ordering the conversation *by* a random tiebreaker scrambles messages sent together. So
  `messageSortKey()` is a millisecond stamp + a monotonic process counter + randomness only for the
  cross-instance case. A test asserts 1000 same-millisecond keys are unique *and* strictly increasing.
- **The per-user index is a cache, not a source of truth.** The friend rows authorise; the index just
  makes "who are my contacts?" one `GetItem` instead of a scan. It is read-modify-written behind a
  `version` condition (your own actions and a friend's message are independent writers), and
  `rebuildIndex()` reconstructs a lost one from the friend/request rows the first time it is missing.
- ⚠️ **A conditional write must not carry an unused value.** `attribute_not_exists(#v)` is the FIRST
  write of a user's index and references no placeholder, but the original code passed `:expected`
  alongside it — DynamoDB rejects the whole write with *"Value provided in
  ExpressionAttributeValues unused in expressions"*. That 500'd **every friend request to an account
  that had never opened Talk**, i.e. the common case, and the unit fake (which accepted the extra
  value) did not model the validation. The fake now rejects unused placeholders, which is what
  covered it.
- ⚠️ **A read receipt must be an `UpdateCommand`.** `markConversationRead` marks rows read — and the
  first version did it with a `PutCommand` carrying `body: null`, which *erases the message it was
  marking as read*. The regression test ("reading a conversation does not destroy the messages it
  marks as read") is there for exactly that.


### Encryption: in transit and at rest — NOT end-to-end

The chosen model (asked, and answered): **the server holds the key**. `services/messageCrypto.js` is
AES-256-GCM, key = HKDF(`MESSAGE_ENCRYPTION_KEY` ‖ `JWT_SECRET`, fixed salt/info), stored as
`v1.<iv>.<tag>.<ciphertext>` base64url, with the **conversation id as AAD** so a blob cannot be moved
into another conversation and decrypted there. `lastPreview` is encrypted the same way, so nothing
readable is written to a row.

- ✅ A dump of the table, a DynamoDB console session, an export, a log line, or a support engineer
  reading raw rows sees ciphertext. A pre-filter scan cannot match message text, because there is none.
- ❌ The running server can decrypt anything, because it has to in order to display it.
- **`MESSAGE_ENCRYPTION_KEY` is unset in this environment**, so the key is derived from `JWT_SECRET`
  and the service logs a warning on first use. That is deliberate — dev and preview work with no new
  configuration — but **setting the dedicated variable is the intended production state, and rotating
  it makes previously stored messages undecryptable**.
- **Do not describe this as end-to-end** anywhere in the UI. `/talk` says "encrypted in transit and at
  rest"; it does not say "only you can read it".
- ⚠️ **A message body must NOT go through the shared `sanitizeInput`.** That middleware calls
  sanitize-html with `disallowedTagsMode: 'recursiveEscape'`, which HTML-escapes **plain text**: a
  member typing `Tom & Jerry` had `Tom &amp; Jerry` stored and displayed, and `5 < 6` came back as
  `5 &lt; 6`. Verified by running the middleware's own options (not read off the source). The two
  messenger routes that carry user text therefore skip it — nothing renders either value as markup
  (React escapes text nodes), and both are bounded in `messengerService` instead. Covered by the
  "round-trips message text verbatim" test.


### Anti-spam limits

Enforced in `messengerService.sendFriendRequest` (the service, not only the route), with
`friendRequestLimiter` (20/hour) as the outer wall:

| Limit | Value |
| --- | --- |
| Outstanding outgoing requests | 20 |
| New requests | 10/hour, 40/day |
| Connections | 200 |
| Retry after a decline | 7 days, on **both** sides |
| Message length | 4000 chars |

Two behaviours worth knowing: a request **to someone who already asked you** is auto-accepted instead
of creating a mirror-image pair that both sides would have to resolve, and a decline stamps a cooldown
on both indexes so the same request cannot be re-sent immediately.


### Files

- Backend: `services/messageCrypto.js`, `services/messengerService.js`, `services/avatarService.js`,
  `controllers/messengerController.js`, `controllers/reviewController.js`, `utils/userIdentity.js`,
  routes in `routes/routeData.js`, limits in `middleware/rateLimiter.js`.
- Frontend: `pages/Simple/Talk/Talk.{jsx,css}`, `components/Simple/Talk/DirectChat.{jsx,css}`,
  `components/Simple/Talk/TalkAvatar.jsx`, `services/messengerApi.js`, `services/reviewApi.js`,
  `utils/talkUtils.js`, `utils/reviewUtils.js`, `utils/avatarCache.js`, `hooks/useAvatars.js`,
  `hooks/useMyReviews.js`; `/net` DM mode in `pages/Simple/Net/Net.jsx`; dropper entry in
  `components/HeaderDropper/HeaderDropper.jsx`.
- Tests: backend `messengerService` (35), `avatarService` (9), `reviewController` (22),
  `messageCrypto` (9), `routeOrdering` (+3); frontend `talkUtils` (16), `avatarCache` (20),
  `reviewUtils` (12), `ReviewTab` (11), `TalkAvatar` (6).


### Deliberate omissions

- **No avatars for anyone you are not connected to** — see *Avatars*. This is the one place the feature
  is narrower than it looks, on purpose.
- **Nicknames are stamped into a contact entry when the connection is made**, so a later rename is not
  reflected until the two reconnect. Refreshing it would mean a user read per contact per load.
- **Messages are not deleted when a connection is removed** — "Remove" drops the contact, not the
  transcript, and a **block does the same**: it closes every way in without touching a single message
  row. Nothing in the UI implies otherwise (`PROFILES.md` → *Blocking, and removing a connection*).
- **No notifications.** An unread count in the toolbar and on the contact row is the whole of it.
- **The blocked account is never told**, and `/talk` deliberately has no "Blocked" list to manage —
  the block is lifted from the page it was placed on (`PROFILES.md` → *Blocking, and removing a connection*).


### Avatars

Once a request is **accepted**, the connection's profile picture appears in the `/talk` contact row
and in the `/net` conversation header (falling back to initials — see below).

**The gate is the feature.** `GET /messenger/avatars?ids=…` returns a picture **only for an accepted
connection**: a pending request, a declined one, a stranger's id you guessed, or your own id are all
reported as `skipped` and send no image. Asking for usernames therefore does not show you faces, and
because the id list is capped (24) it cannot be used to enumerate accounts either. The gate is
enforced server-side in `collectAvatars`; the client's copy of that rule is only about not making a
pointless request.

**The stored picture is never sent.** `profilePicture` is a 512px JPEG data URL (20–80 KB). Rendering
it in a 32px circle is ~20x the pixels the layout can show, and a data URL cannot be HTTP-cached, so
the browser would pay that per friend per load. `services/avatarService.js` re-encodes once with
`sharp` (already a dependency) to a **96px JPEG, ~3–5 KB**, and caches it in-process by a hash of the
source that doubles as the client's cache key.

**The client keeps them.** `utils/avatarCache.js` stores `{ src, etag, at }` per account in
`localStorage` (capped at 400 entries, ~1.6 MB), and `hooks/useAvatars.js` asks only for accounts
that are missing or older than 12h. Consequences worth knowing:

- A normal visit (everything cached) makes **no request at all** — verified live: with no contacts the
  page issued zero `/messenger/avatars` calls.
- A cached picture is sent back as its `etag`, so an unchanged picture costs bytes rather than an
  image, and a **changed** picture still arrives on its own.
- "No picture" is a stored answer (`src: null, etag: ''`), not a missing one, so an account without one
  is not re-fetched forever. A picture that fails to decode is cached the same way, with its real etag.
- A **stale** entry is still rendered — a face from yesterday beats initials — and refreshed behind it.
- A `skipped` id is **pruned** from the cache: skipped means "no longer connected", and keeping the
  entry would keep showing the face of someone you just removed.

**Initials, not the brand mark.** `components/Simple/Talk/TalkAvatar.jsx` draws the picture when there
is one and initials otherwise. `ProfileAvatar` (used by `/profile`) falls back to the brand checkmark
instead, and that difference is deliberate: `/profile` shows one person you already know, whereas a
contact list is a column of them, where ten identical checkmarks identify nobody and "GU" vs "GW"
does. The picture is `alt`-described; the initials are `aria-hidden`, because the name is always
beside the frame.


### The unread count, everywhere Talk is entered

Every link into `/talk` carries an unread badge — the header drawer's `Talk` row, both links in the
`/net` rail's People section, all five of the member page's Talk controls, the `/profile` **Talk**
button, and the two dead ends inside a direct conversation. It shows a count, and at **zero it renders
nothing at all**: a badge reading "0" is a badge the eye has to read and dismiss, where an absent one
is already the answer. `components/Simple/Talk/TalkUnreadBadge.jsx` is dumb — it is handed a number —
because its callers get that number in two different ways.

**One number, and it is unread MESSAGES.** A pending friend request is not a message; `/talk`'s own
toolbar already reports requests, waiting and unread as three separate chips, and folding them into
one figure would make every badge mean two things at once.

**Whoever has the dashboard publishes it.** The count only exists in `GET /messenger/directory`, and
two surfaces already fetch it (`/talk` on load, the rail every 30s). Rather than have the chrome ask a
third time, `utils/talkUnread.js` holds the value in a module-level snapshot that both of them write
(`publishTalkUnread`) and `hooks/useTalkUnread.js` reads. So on `/talk` and `/net` the badge makes **no
request at all**, and elsewhere the hook makes one — for the whole page, since the poll and the
in-flight request are module state rather than per-component ones (four badges on a member page, one
GET). A value younger than 15s is never re-asked for, which is also what keeps the hook quiet while
the rail is polling.

**The snapshot is keyed by token**, and a reader holding a different token is answered `0` (a tokenless
publish is refused outright). The module outlives a sign-out — logging out does not reload the page —
so this is the difference between "3 unread" on your account and showing your number to whoever signs
in next.

**Silence on failure, and wake on return.** A failed request keeps the last known count and the next
tick retries; it never throws, toasts or blanks the link it sits on. The poll stops when the last badge
unmounts, and a `focus`/`visibilitychange` listener refreshes when the tab comes back — the moment a
stale badge is most obvious.

**The fill is `--action`, not the row badge's gradient.** `.talk-unread` (a row in `/talk`) still uses
the raw `--fg-blue` → `--fg-mint` pair, but this badge rides the site chrome, outside whichever page
root re-points those hues, and the gradient is bright in both themes (white passes at the blue end and
fails at the mint end). `--action` is the site's one fill whose lightness is pinned per mode, so
`--text-color-inv` clears AA on every scheme — the same trade the buttons make.

**Not on `/all`.** The page index links `/talk` too, but its badge column already means "who this page
is for"; a count there would overload it, and nobody scans a 50-row route index looking for a message.

---

