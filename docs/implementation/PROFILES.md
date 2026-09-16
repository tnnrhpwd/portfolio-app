# Member pages — `/u/<username>`, visibility, and blocking

The page a member sends someone: what it renders and for whom, who may read it (private
by default), and the two destructive controls — remove a connection, and block someone
without telling them.

> Moved out of the platform plan doc on 2026-09-16, when it became a pointer file for
> agents ([`agent.md`](agent.md)). Section names are the reference here — no chapter
> numbers.

---

## The member page — `/u/<username>`


### What it is

The page a member sends someone — and the page they open to check what a stranger sees. A
**service page** (`UI_LAYOUT.md` §5.7), which is a deliberate re-classification: it was
built as a Discovery page, on the argument that a stranger can arrive from a shared link knowing
nothing and has to be sold on the product before they read any detail. That argument lost to how the
page is actually used. The owner is on it as often as a visitor is, the visitor already decided who
they are looking at before the page loaded, and the two of them want the same thing from it — what is
here, without scrolling past a pitch to find it.

So it wears the service material: one flat ground (the shared `.service-room`), one row at the top
carrying the name, its live state (visibility, join date, counts) and the one action, and a dense
grid of glass panes below it. No bands, no gradient behind the numbers, no floating circles, no
scroll reveals — nothing of the page's own is pinned, and the site header is the only thing that
stays put. `/talk` and `/settings` are the same shape; the member page is the same room with a face
in it. It is linked from the Talk contact row, the `/net` conversation header and `/profile`.

**The row says who is looking.** The action is the owner's (`Edit your profile`), a connection's
(`Message <name>`), a signed-in stranger's (`Connect with <name>`) or a signed-out visitor's (`Create
your page` / `Sign in`) — the same four cases the old hero carried, collapsed onto one line. Only the
owner sees the `Page` chip and the `Your page` panel: to a visitor the page is simply readable, and
a chip saying `Public` is noise.

**What the numbers come from differs, so the page says which.** Identity and join date come from the
account row. Games come from the **public leaderboards**, whose rows are posted by the players
themselves — the section says "self-reported rather than verified" out loud rather than dressing them
up as a record. Published skills and goals carry an `authorUserId` stamped by the server on publish,
so those are genuinely attributable. A band with nothing in it is not rendered at all.

**The face wears no ring** (2026-09-16). `ProfileAvatar`'s frame painted
`linear-gradient(135deg, --fg-orange, --fg-pink)` behind a `0.05 × --nav-size` inset — an orange →
hot-pink ring around every avatar on the site. Those two tokens are the *pre-scheme* palette and the
UI standard deliberately leaves them un-aliased (orange is the alert hue), so the ring never followed
the visitor's colour scheme: on a green scheme a stranger's face sat in a pink ring, beside a glass
pane that did follow it, which is how it was noticed. The frame now paints nothing and the picture
fills the circle — `border-radius` + `overflow: hidden` are what make it a circle, and they are also
what clip the checkmark PNG's transparent corners, so the fill was never load-bearing. `Profile.css`
held a page-local copy of that inset (`0.06`, to thicken the ring on the large avatar) and it went
with it. **The default face still shows the mark's own ring** — that is the `plate` artwork
(`LOGO_SYSTEM.md` §4–5), not a frame colour, and it is static on purpose.


### Visibility — private by default

**Private means the owner and the people they are connected with, and nobody else.** The default is
`private`, and — this is the part that matters — an account row written before this setting existed
has no `profileVisibility` attribute at all, which must read as private rather than as "no
preference, so show everything".

One constant module owns that rule, `backend/constants/profileVisibility.js`, because two places have
to agree: the controller that **writes** the setting and the service that **enforces** it. A second
copy of the string `'public'` is how a gate stops matching its own setting. Note the asymmetry:

- **On write** the controller validates and **rejects** anything that is not exactly `public` or
  `private` (`400`) instead of coercing it. Coercing a typo to the default would leave a user
  believing they had published a page nobody can reach.
- **On read** `normalizeProfileVisibility` serves anything that is not a literal `'public'` as
  private. The client mirrors *this* rule, not the write rule — `profileVisibilityOf` in
  `utils/userProfileUtils.js` matches exactly, with no trimming or case-folding, so the `/profile`
  dropper can never read "Public" for a page the server refuses to serve.

**The gate runs before anything is gathered.** For a viewer who is neither the owner nor a
connection, `buildPublicProfile` returns early with a **restricted** payload: the nickname, the
visibility, and flags — no picture, no board scan, no published list, because none of it should exist
for that caller in the first place. Skipping the work is the point; there is nothing to leak because
nothing was fetched.

**Restricted is a `200`, not a `403`.** The page still has something true to show (who this is, and
the one action that would open it), so a shared private link lands somewhere sensible instead of on a
dead end that looks identical to a mistyped username — and the client gets one render path instead of
an error branch that forgives itself. `UserProfile.jsx` renders that state as the lock in the row, the
nickname, `Page: Private` / `Access: Connections only`, **Connect** (only when signed in), and — in
the second panel — what is being held back, as a row per thing rather than as a paragraph: no picture,
no boards, no published work, no connections. After a request is sent that panel swaps its line for
**↻ Check again**.

**A private page is never indexed.** `SEO` takes `noindex` whenever the setting is not `public`, for
every viewer including the owner: being able to read your own private page does not make it public.

**How a private page opens.** Accepting the friend request is the gate, so the page opens on the next
load — and if a request is **auto-accepted** (both sides had already asked), the client re-fetches
immediately rather than telling you it sent a request against a page you may now read.


### The control, on `/profile`

A panel between the identity and storage sections, titled "Who can see your page", holding two things:
a `<select>` (private — only you and your connections; public — anyone with the link) and a link to
the page itself. It reuses the preferences grid's existing control classes rather than adding a second
select style to the same page, and the live meaning of the current setting is printed underneath,
because "Public" alone reads like "listed somewhere".

The value is seeded from the login response (`postData.js` returns `profileVisibility` alongside
`profilePicture`) and kept in step by the `updateProfile.fulfilled` reducer, which merges the returned
profile back into `state.user` — so the setting survives a reload without a second round trip. A
failed save **puts the dropper back** and says so: leaving it on a value the server rejected is the
same lie the validation exists to prevent.

The public guest account cannot change its own visibility — or anything else — because
`PUT /api/data/profile` returns `403` for `GUEST_EMAIL`. It is a shared demo login.


### Blocking, and removing a connection

Shipped 2026-09-15. Two controls on the member page, in a folded `Manage` pane. They are **not the
same operation and must not be presented as one**:

|  | Remove connection | Block |
| --- | --- | --- |
| Direction | mutual — both sides lose the contact | **one-sided** — only the blocker's list records it |
| Requests | the connection is gone; either side may ask again | every future request is refused, both directions |
| The page | follows the visibility setting as usual | the blocked account is answered as if it were **private**, whatever the setting says |
| Messaging | both sides refused (no friendship row) | both sides refused (no friendship row) |
| Undone by | a new request and an acceptance | `Unblock` — which does **not** reconnect either |

**Where they live.** In a `<details>` pane in the pane grid (`ManagePanel`), not in the row. the UI standard's §5.7 asks
for exactly this: the row's buttons are for *engaging* with a person, and a destructive control parked
next to `Message` is a misclick waiting to happen. The pane is a `--glass` pane like its neighbours so
it still reads as part of the room, and it is a real `<details>` rather than a hand-rolled popover —
keyboard-accessible, no JS state, no outside-click handler, no focus trap.

**A block announces itself in exactly one place: the summary.** The `Blocked` badge on the pane's
summary is the only sign of it while the pane is shut, and it is load-bearing — a block you cannot find
is a block you cannot lift. The row carries a `Blocked` chip too (it explains an absent `Message`
button) but **no action at all**: a block has already switched off everything the row's buttons do,
and lifting a block is a settings change, not an engagement.

**⚠️ The blocked account is not told. This is the rule the whole design is bent around.**

- **Their page-answer is byte-identical to a private page's.** `buildPublicProfile` returns the same
  `restricted` object it returns for a genuinely private page — *including a `private` visibility*,
  even when the page is public. That is a deliberate inaccuracy told to the one person the block
  exists to withhold from, and it is the price of the alternative: any difference at all (a distinct
  status, a `blocked` flag, the real visibility) is a **block receipt**. A test asserts the two
  payloads are `toEqual`, so adding a field to the restricted branch breaks it loudly.
- **Their friend request is refused exactly as a declined one is** — the same 429 and the same
  sentence, from one function (`declinedError` in `messengerService`), so the two cannot drift. They
  are still *offered* the `Connect` button, because withholding it would be the same tell.
- Their index loses the contact and the requests, so nothing is left dangling — and that is
  indistinguishable from a plain `Remove`, which is the point.

**The blocker, by contrast, IS told**, or the block could never be lifted: `blockedByYou` in the
payload, a `Blocked` chip in the row, and the `Unblock` control. That flag is only ever about the
viewer's **own** action, so reporting it cannot leak anything about the other side — which is also why
it is safe to report in the restricted branch, the one place a blocker of a private account lands.

**Storage.** A block is a graph row of its own, `msg_block_<blocker>_<blocked>` — **ids not sorted**,
unlike `msg_friend_<a>_<b>`, because "A blocked B" and "B blocked A" are different facts and neither
may be read as the other. `readBlock(blocker, blocked)` is directional; `areBlocked(a, b)` asks both
ways. The blocker's index also carries a `blocks` list (for the pane and `getDirectory`), but the
**row** is what survives: an index is a cache, and `rebuildIndex` now restores blocks from these rows
alongside friends and requests. A block that lived only in a cache would silently vanish with it —
the one failure a safety control cannot have, and there is a test for it.

`blockUser` does three things in one call, in this order: writes the block row (**first**, so a later
failure leaves a block already in force rather than a removed connection with nothing recording why it
cannot be re-made), deletes the friendship row, and deletes both pending request rows. Then it makes
**one** index write per side rather than four — the block, the dropped contact and the two dropped
requests are a single new state, and `updateIndex` is a read-modify-write that retries on a lost race.

**Blocking is addressed by USERNAME, not by id**, like a friend request and unlike every other peer
route. Not an oversight: the member page a block is placed from never learns another account's internal
id unless the two are connected (`connectedUserId`) — and a block removes the connection. So
`POST`/`DELETE /api/data/messenger/blocks` take `{ username }`. `DELETE` with a body is unusual but
deliberate: the alternative was one operation with two addressing schemes.

**Unblocking does not reconnect.** It deletes the block row, drops the list entry, and clears the
cooldown it implied — clearing that is load-bearing, because blocking implies the same refusal a
decline does and leaving the stamp behind would mean an unblocked account still could not ask for a
week, i.e. a control that appears to work and does nothing. Reconnecting still takes a request and an
acceptance, and both the confirm dialog and the follow-up notice say so.

Confirmations are `window.confirm`, the same choice `/talk` makes for `Remove`. The wording lives in
`utils/userProfileUtils.js` because the dialog is the **only** place a consequence is stated before it
happens — the controls are labels (`Block`), so a dialog that understates what it is about to do is a
bug rather than copy. The block dialog says what it does, that messages are kept, that they are **not
told**, and that it can be undone.


### Files

| Concern | File |
| --- | --- |
| The setting, in one place | `backend/constants/profileVisibility.js` |
| Write path (`PUT /api/data/profile`) | `backend/controllers/profileController.js` |
| The gate + the page's data | `backend/services/publicProfile.js` |
| Boards / published work | `backend/services/gameBoards.js` |
| Route | `backend/routes/routeData.js` — `GET /u/:username` |
| The page | `frontend/src/pages/UserProfile/UserProfile.jsx` |
| Wording + path building + the relationship rules | `frontend/src/utils/userProfileUtils.js` |
| The control | `frontend/src/pages/Profile/Profile.jsx` |
| Remove / block storage | `backend/services/messengerService.js` (`blockUser`, `unblockUser`, `readBlock`, `areBlocked`) |
| Their routes | `backend/routes/routeData.js` — `POST`/`DELETE /messenger/blocks` (**by username**) |
| Their client | `frontend/src/services/messengerApi.js` |

---

