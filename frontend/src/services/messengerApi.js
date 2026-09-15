/**
 * messengerApi.js — the Talk messenger (friend graph + direct messages).
 *
 * Every call is signed-in only and sends the user's JWT: the backend keys a
 * conversation off `req.user.id`, and a userId in a path is only ever the PEER,
 * re-authorised server-side on each request (a message send re-checks that the
 * two accounts are actually connected).
 *
 * Message bodies travel as plain text over HTTPS and are encrypted by the
 * backend before they are stored — the server holds that key, so this is
 * encryption in transit + at rest, *not* end-to-end. Nothing here should claim
 * otherwise.
 */

import { getPortfolioApiUrl } from './workspaceApi.js';

/** Pull the server's message out of a non-2xx response and tag the status. */
async function fail(res, fallback) {
  let message = fallback;
  let body = null;
  try {
    body = await res.json();
    message = body?.dataMessage || body?.error || body?.message || fallback;
  } catch {
    /* not JSON — keep the fallback */
  }
  const error = new Error(message);
  error.status = res.status;
  if (body?.retryAfterSeconds) error.retryAfterSeconds = body.retryAfterSeconds;
  return error;
}

async function request(token, path, { method = 'GET', body } = {}) {
  if (!token) throw new Error('Sign in to use Talk');
  const res = await fetch(`${getPortfolioApiUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw await fail(res, 'Something went wrong');
  return res.json();
}

/**
 * The whole dashboard: my handle, connections, pending requests in both
 * directions, and how much of the request budget is left.
 */
export const getMessengerDirectory = (token) => request(token, '/messenger/directory');

/** Who a peer is (nickname) and whether we're connected — used by the DM view. */
export const getMessengerPeer = (token, userId) =>
  request(token, `/messenger/peers/${encodeURIComponent(userId)}`);

/** Send a friend request by username. */
export const sendFriendRequest = (token, username) =>
  request(token, '/messenger/requests', { method: 'POST', body: { username } });

export const acceptFriendRequest = (token, userId) =>
  request(token, `/messenger/requests/${encodeURIComponent(userId)}/accept`, { method: 'POST', body: {} });

export const declineFriendRequest = (token, userId) =>
  request(token, `/messenger/requests/${encodeURIComponent(userId)}/decline`, { method: 'POST', body: {} });

/** Withdraw a request I sent. */
export const cancelFriendRequest = (token, userId) =>
  request(token, `/messenger/requests/${encodeURIComponent(userId)}`, { method: 'DELETE' });

/** Remove a connection (messages are kept). */
export const removeMessengerContact = (token, userId) =>
  request(token, `/messenger/contacts/${encodeURIComponent(userId)}`, { method: 'DELETE' });

/**
 * One page of a conversation, oldest-first.
 *
 * @param {string} token
 * @param {string} userId - the peer
 * @param {object} [options]
 * @param {string} [options.since] - cursor (the last message's `cursor`); only
 *   newer messages come back, which is what the poll uses.
 */
export const getConversationMessages = (token, userId, { since } = {}) => {
  const query = since ? `?since=${encodeURIComponent(since)}` : '';
  return request(token, `/messenger/conversations/${encodeURIComponent(userId)}/messages${query}`);
};

export const sendConversationMessage = (token, userId, body) =>
  request(token, `/messenger/conversations/${encodeURIComponent(userId)}/messages`, {
    method: 'POST',
    body: { body },
  });

export const markConversationRead = (token, userId) =>
  request(token, `/messenger/conversations/${encodeURIComponent(userId)}/read`, { method: 'POST', body: {} });

/**
 * Profile pictures for your accepted connections.
 *
 * Returns a picture only for an account you are actually connected to — sending
 * a username you guessed does not show you their face — plus `unchanged` (the
 * `have` entry your cache already had) and `skipped` (not connected, or no longer
 * an account), which the caller uses to prune its cache.
 *
 * @param {string} token
 * @param {{ ids: string[], have?: string }} batch - From `planAvatarRequest`.
 */
export const getMessengerAvatars = (token, { ids, have }) => {
  const params = new URLSearchParams({ ids: ids.join(',') });
  if (have) params.set('have', have);
  return request(token, `/messenger/avatars?${params.toString()}`);
};
