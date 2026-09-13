// Shared client-side admin gate constants.
//
// IMPORTANT: these are cosmetic only — the backend independently enforces
// ADMIN_USER_ID on every admin endpoint, so a user cannot gain real admin
// access by editing the client. Keeping the values in one place avoids
// re-declaring the literals across pages.
//
// Note: the admin account ID still ships in the client bundle. The ideal
// follow-up is to derive admin-ness server-side (e.g. an `isAdmin` flag on
// the auth user) and drop these constants entirely.
export const ADMIN_USER_ID = '6770a067c725cbceab958619';

// Legacy nickname gate — unlocks the /muse link for the site owner's partner.
export const GIRLFRIEND_NICKNAME = 'girlfriend';

/**
 * Admin check — prefers the server-provided `isAdmin` flag (attached to the
 * auth user at login/register), falling back to the hardcoded ID only for
 * sessions that predate the flag. Drop the fallback once every active session
 * has re-logged in.
 */
export function isAdminUser(user) {
  if (!user) return false;
  if (typeof user.isAdmin === 'boolean') return user.isAdmin;
  return String(user._id) === ADMIN_USER_ID;
}

/**
 * Special access — accounts an admin flagged with the "Special" tag
 * (`PUT /admin/users/:id/special`, stored as `|Special:true` on the user record).
 *
 * The tag exists to grant unlimited API credits, and since 2026-09-12 it also
 * grants **read access to four admin views**: Dashboard, Visitor map, Reviews and
 * Page rankings. `backend/middleware/adminAccess.js` is the real boundary — this
 * list only keeps the console from offering tabs whose endpoints would 403.
 *
 * Keep the two in step: adding a path here without widening its route (or the
 * reverse) gives a user a tab that errors, or a hidden endpoint nobody can see.
 */
export const SPECIAL_ADMIN_PATHS = Object.freeze([
  '/admin',
  '/admin/map',
  '/admin/reviews',
  '/admin/rankings',
]);

/**
 * Does this account carry the Special tag?
 *
 * Reads the flag the server attaches to every auth response (`isSpecial` on
 * login/register). There is no client-side fallback: unlike admin-ness — which
 * has a legacy ID check for sessions that predate the flag — Special can only be
 * known from the server, so an account flagged *after* it signed in needs to sign
 * in again before the console offers it anything.
 */
export function isSpecialUser(user) {
  if (!user) return false;
  return user.isSpecial === true;
}

/** May this account open the admin console at all? */
export function canUseAdminConsole(user) {
  return isAdminUser(user) || isSpecialUser(user);
}

/**
 * May this account open this admin path?
 *
 * Exact-match against `SPECIAL_ADMIN_PATHS` for a Special account (the four
 * views have no sub-routes); admin gets everything.
 *
 * Note the normalization: only a *trailing* slash is dropped, and an empty
 * result is **not** treated as `/admin`. Doing that turned `/` into `/admin`
 * and handed a Special account the dashboard from any root-ish path — the
 * caller is expected to pass a real pathname, and a path that isn't in the list
 * is refused.
 *
 * @param {Object} user
 * @param {string} pathname - e.g. `/admin/map` (a trailing slash is ignored)
 */
export function canOpenAdminPath(user, pathname) {
  if (isAdminUser(user)) return true;
  if (!isSpecialUser(user)) return false;
  const path = String(pathname || '').split('?')[0].split('#')[0];
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return SPECIAL_ADMIN_PATHS.includes(trimmed);
}

/**
 * Muse access — admin, or the owner's partner via nickname.
 */
export function isMuseVisitor(user) {
  if (!user) return false;
  return isAdminUser(user) || String(user.nickname || '').trim().toLowerCase() === GIRLFRIEND_NICKNAME;
}
