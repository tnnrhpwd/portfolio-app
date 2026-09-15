/**
 * reviewApi.js — the caller's own reviews.
 *
 * Reviews are *public* rows (the Support review tab works signed-out), so they
 * are created through `POST /api/data/public`, which stamps no `Creator:` id.
 * Ownership lives in the review's `User:<email>` field instead, which is why
 * editing goes through the dedicated `/reviews/*` endpoints rather than the
 * generic `PUT /api/data/:id` (that one requires `Creator:<userId>` and 401s).
 *
 * All three routes require a signed-in user.
 */

import { getPortfolioApiUrl } from './workspaceApi.js';

/** Pull the message out of a non-2xx response and attach its status. */
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

const authHeaders = (token) => ({ Authorization: `Bearer ${token}` });

/** The signed-in user's reviews, newest first. */
export async function listMyReviews(token) {
  if (!token) throw new Error('Sign in to manage your reviews');
  const res = await fetch(`${getPortfolioApiUrl()}/reviews/mine`, { headers: authHeaders(token) });
  if (!res.ok) throw await fail(res, 'Could not load your reviews');
  const body = await res.json();
  return body.reviews || [];
}

/**
 * Edit one of the caller's own reviews.
 *
 * @param {string} token
 * @param {string} id - Review row id
 * @param {{ title: string, category: string, rating: number, content: string }} review
 */
export async function updateMyReview(token, id, review) {
  if (!token) throw new Error('Sign in to edit your review');
  const res = await fetch(`${getPortfolioApiUrl()}/reviews/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(review),
  });
  if (!res.ok) throw await fail(res, 'Could not save your review');
  const body = await res.json();
  return body.review;
}

/** Delete one of the caller's own reviews. */
export async function deleteMyReview(token, id) {
  if (!token) throw new Error('Sign in to delete your review');
  const res = await fetch(`${getPortfolioApiUrl()}/reviews/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  if (!res.ok) throw await fail(res, 'Could not delete your review');
  return id;
}
