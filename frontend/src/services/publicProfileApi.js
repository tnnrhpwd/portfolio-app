/**
 * publicProfileApi.js — the public profile at `/u/<username>`.
 *
 * Open to signed-out visitors, but it takes the caller's token when there is one:
 * the response depends on *who is asking* for exactly two facts — "is this my own
 * page?" and "are we already connected?" — and nothing else about it does.
 */

import { getPortfolioApiUrl } from './workspaceApi.js';

async function fail(res, fallback) {
  let message = fallback;
  try {
    const body = await res.json();
    message = body?.dataMessage || body?.error || body?.message || fallback;
  } catch {
    /* not JSON — keep the fallback */
  }
  const error = new Error(message);
  error.status = res.status;
  return error;
}

/**
 * @param {string} username - The account's nickname (spaces and all).
 * @param {string} [token] - Optional; only affects `isSelf` / `isConnected`.
 * @returns {Promise<object>} The public profile.
 * @throws {Error & { status?: number }} `status === 404` means no such account,
 *   which the page renders as a friendly "not found" rather than an error.
 */
export async function getPublicProfile(username, token) {
  const res = await fetch(
    `${getPortfolioApiUrl()}/u/${encodeURIComponent(String(username || '').trim())}`,
    token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
  );
  if (!res.ok) throw await fail(res, 'Could not load that profile');
  const body = await res.json();
  return body.profile;
}
