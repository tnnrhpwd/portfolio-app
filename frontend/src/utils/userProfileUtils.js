/**
 * userProfileUtils.js — pure helpers for the public profile page (`/u/<username>`).
 *
 * The vocabulary here is the page's honesty layer: "Rank #1 of 2 players" and
 * "self-reported" only read correctly if the wording is consistent, and the
 * path builder is the single place the URL shape is defined.
 */

/** `/u/<username>` — the public profile path for a nickname. */
export const profilePath = (nickname) => `/u/${encodeURIComponent(String(nickname || '').trim())}`;

/** The two settings the server accepts — mirrors backend/constants/profileVisibility.js. */
export const PROFILE_VISIBILITY = Object.freeze({ PUBLIC: 'public', PRIVATE: 'private' });

/**
 * Read the visibility off anything that carries one — the logged-in `user`
 * object (`profileVisibility`, from the login response and the PUT) or a public
 * profile payload (`visibility`).
 *
 * ⚠️ **Exact match, deliberately.** This mirrors the server's READ path
 * (`normalizeProfileVisibility` in backend/constants/profileVisibility.js), which
 * serves anything that is not literally `'public'` as private — no trimming, no
 * case-folding. The write path goes the other way and *rejects* a value like
 * `'PUBLIC'` outright rather than storing it, so the two can only disagree about a
 * hand-edited row. When that happens the answer that hides the page is the one
 * that has to win: a control reading "Public" for a page the server refuses to
 * serve would tell someone they had published when they had not.
 *
 * @param {{profileVisibility?: string, visibility?: string}|string|null} source
 * @returns {'public'|'private'}
 */
export const profileVisibilityOf = (source) => {
  const raw = typeof source === 'string'
    ? source
    : source?.profileVisibility ?? source?.visibility;
  return raw === PROFILE_VISIBILITY.PUBLIC
    ? PROFILE_VISIBILITY.PUBLIC
    : PROFILE_VISIBILITY.PRIVATE;
};

/** Whether a page is readable by people who are not the owner or a connection. */
export const isPublicVisibility = (source) => profileVisibilityOf(source) === PROFILE_VISIBILITY.PUBLIC;

/** "Public" / "Private" — for badges and status lines. */
export const visibilityLabel = (source) =>
  isPublicVisibility(source) ? 'Public' : 'Private';

/**
 * Who can read the page, as a label rather than a sentence: a panel's "Audience"
 * row has no room for the verb, and the badge above it already says Public or
 * Private. `visibilitySummary` is this plus the verb, so the two can never
 * disagree about who is being told what.
 */
export const visibilityAudience = (source) => (isPublicVisibility(source)
  ? 'Anyone with the link'
  : 'You and your connections');

/**
 * The full sentence a visitor-facing badge shows. Deliberately spells out who
 * can read the page, because "Public" alone reads like "listed somewhere".
 */
export const visibilitySummary = (source) =>
  `${visibilityAudience(source)} can see this page.`;

/** "August 2025" — the join date on its own, for a readout chip. */
export const memberSinceValue = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
};

/**
 * "Member since August 2025" — a join date is context, not a timestamp.
 *
 * Kept as the sentence form for anywhere that has room for one; the service
 * page's readout chips take `memberSinceValue` instead, because a chip's key is
 * already the label ("Member since") and repeating it in the value costs a line.
 */
export const memberSinceLabel = (iso) => {
  const value = memberSinceValue(iso);
  return value ? `Member since ${value}` : '';
};

/** A date, or '' — used for "last played"/"published" lines. */
export const shortDate = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

export const formatNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('en-US') : '—';
};

/**
 * How a board result is described.
 *
 * ⚠️ These rows are **self-reported** public writes (see the backend's
 * `gameBoards.js`), so the copy says where the number came from rather than
 * implying we verified it. The page shows that note once, under the section head.
 *
 * @returns {{ label: string, value: string, detail: string|null, rank: string|null }}
 */
export const boardSummary = (game = {}) => {
  const players = Number(game.players) || 0;
  const detail = Number(game.detail);
  return {
    label: game.label || 'Best',
    value: formatNumber(game.value),
    // A secondary stat of zero carries no information ("Best score 0" on a Rocket
    // run is just the absence of a bonus), so it is dropped rather than printed.
    detail: game.detail != null && game.detailLabel && detail > 0
      ? `${game.detailLabel} ${formatNumber(game.detail)}`
      : null,
    rank: game.rank && players > 0
      ? `Rank #${formatNumber(game.rank)} of ${formatNumber(players)} ${players === 1 ? 'player' : 'players'}`
      : null,
  };
};

/** "Play 2048" — the link label for a board card. */
export const playLabel = (game = {}) => `Play ${game.name || 'the game'}`;

export const publishedKindLabel = (kind) => (kind === 'goal' ? 'Goal' : 'Skill');

/** "4.5 ★ (2 ratings)" / "No ratings yet". */
export const ratingLabel = (count, avgRating) => {
  const ratings = Number(count) || 0;
  if (ratings === 0) return 'No ratings yet';
  const avg = Number(avgRating) || 0;
  return `${avg.toFixed(1)} ★ (${formatNumber(ratings)} ${ratings === 1 ? 'rating' : 'ratings'})`;
};

/**
 * The readout under the hero: what this person has actually done here.
 * Zeroes are omitted — a row of "0 games · 0 published" reads as an empty account
 * rather than as one that simply has not used those parts of the site.
 */
export const profileStats = (profile = {}) => {
  const stats = [];
  const connections = Number(profile.connections) || 0;
  const games = Array.isArray(profile.games) ? profile.games.length : 0;
  const published = Array.isArray(profile.published) ? profile.published.length : 0;

  if (connections > 0) stats.push({ key: 'connections', label: connections === 1 ? 'Connection' : 'Connections', value: formatNumber(connections) });
  if (games > 0) stats.push({ key: 'games', label: games === 1 ? 'Game played' : 'Games played', value: formatNumber(games) });
  if (published > 0) stats.push({ key: 'published', label: published === 1 ? 'Published' : 'Published', value: formatNumber(published) });

  return stats;
};

/** True when there is nothing but the identity to show. */
export const isQuietProfile = (profile = {}) =>
  profileStats(profile).length === 0;

// ── The relationship, and what may be done about it ─────────────────────────
//
// The row's one action and the "Manage" pane's contents are both decided by ONE
// fact — where this viewer stands with this account — so that fact is computed
// once, here, rather than re-derived at each control. Every branch below is read
// straight off the server's payload; nothing is inferred from what is on screen.

/** The four ways a viewer can stand with the account they are looking at. */
export const RELATIONSHIP = Object.freeze({
  SELF: 'self',
  BLOCKED: 'blocked',
  CONNECTED: 'connected',
  STRANGER: 'stranger',
  VISITOR: 'visitor',
});

/**
 * Where the viewer stands with this account.
 *
 * **`blockedByYou` is answered before `connected`, and that ordering is the rule**
 * — a block removes the connection, so the two can only be reported together if
 * one is stale, and the block is the newer fact. It is also the only branch that
 * comes from the viewer's own action: the reverse (someone has blocked *you*) is
 * deliberately not reported at all, and the server answers that viewer as a
 * stranger looking at a private page (`backend/services/publicProfile.js`).
 *
 * `connectedUserId` is required for CONNECTED rather than `isConnected` alone: the
 * id is what a DM link is built from, so without it there is a "Message them"
 * button that goes nowhere.
 *
 * @returns {'self'|'blocked'|'connected'|'stranger'|'visitor'}
 */
export const profileRelationship = (profile = {}) => {
  if (profile.isSelf) return RELATIONSHIP.SELF;
  if (profile.blockedByYou) return RELATIONSHIP.BLOCKED;
  if (profile.isConnected && profile.connectedUserId) return RELATIONSHIP.CONNECTED;
  if (profile.canConnect) return RELATIONSHIP.STRANGER;
  return RELATIONSHIP.VISITOR;
};

/**
 * May this viewer change anything about the relationship? Only for a signed-in
 * visitor on someone else's page — never your own (you cannot befriend or block
 * yourself) and never signed out (there is no relationship to change).
 */
export const canManageRelationship = (profile = {}) =>
  Boolean(profile.isSignedIn) && !profile.isSelf;

/** Only a connection can be removed; a stranger is not one. */
export const canRemoveConnection = (profile = {}) =>
  profileRelationship(profile) === RELATIONSHIP.CONNECTED;

/** A block exists and can be lifted. */
export const canUnblock = (profile = {}) =>
  profileRelationship(profile) === RELATIONSHIP.BLOCKED;

/** A block can be placed: signed in, not yourself, and not already blocked. */
export const canBlock = (profile = {}) =>
  canManageRelationship(profile) && !canUnblock(profile);

/**
 * The confirmations, in one place because each one is the ONLY place a
 * consequence is stated before it happens — the controls themselves are labels
 * ("Block"), so a dialog that understates what it is about to do is a bug, not
 * copy. Both say what survives: messages are kept either way, and a block is not
 * announced to the other person.
 */
export const blockConfirmText = (nickname) => {
  const name = String(nickname || 'this account');
  return `Block ${name}?\n\n`
    + `They lose the connection and cannot ask to connect again or message you. Your page is hidden from them. `
    + `They are not told. Your messages are kept, and you can unblock them later.`;
};

export const removeConfirmText = (nickname) =>
  `Remove ${String(nickname || 'this account')} from your connections? Your messages are kept.`;

/**
 * Lifting a block is not the same as reconnecting, and the confirm has to say so:
 * the one thing a user expects from "Unblock" is that the other person is back,
 * and they are not — they can ask again, and that still has to be accepted.
 */
export const unblockConfirmText = (nickname) => {
  const name = String(nickname || 'this account');
  return `Unblock ${name}?\n\n`
    + `You are not connected again — they can ask to connect, and you will have to accept. `
    + `Your page becomes visible to them again if it is public.`;
};

/** What the status line says afterwards. State, not praise — and no "they know". */
export const blockNoticeText = (nickname) =>
  `${nickname} is blocked. Your page is hidden from them and they cannot ask again.`;

export const unblockNoticeText = (nickname) =>
  `${nickname} is unblocked. You are not connected — they can ask again if they want to.`;

export const removeNoticeText = (nickname) =>
  `${nickname} is no longer a connection. Your messages are kept.`;
