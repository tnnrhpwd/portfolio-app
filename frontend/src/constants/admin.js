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
 * Muse access — admin, or the owner's partner via nickname.
 */
export function isMuseVisitor(user) {
  if (!user) return false;
  return isAdminUser(user) || String(user.nickname || '').trim().toLowerCase() === GIRLFRIEND_NICKNAME;
}
