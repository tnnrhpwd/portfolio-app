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
 * The full sentence a visitor-facing badge shows. Deliberately spells out who
 * can read the page, because "Public" alone reads like "listed somewhere".
 */
export const visibilitySummary = (source) => (isPublicVisibility(source)
  ? 'Anyone with the link can see this page.'
  : 'Only the owner and their connections can see this page.');

/** "Member since August 2025" — a join date is context, not a timestamp. */
export const memberSinceLabel = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `Member since ${date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`;
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
