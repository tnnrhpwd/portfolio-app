/**
 * visionBoardApi.js — the client half of vision boards.
 *
 *   POST   /api/data/csimple/vision-board          → generateVisionBoards
 *   GET    /api/data/csimple/workspace?kind=vision → listVisionBoards
 *   DELETE /api/data/csimple/vision-board/:slug    → deleteVisionBoard
 *
 * Generation is one request that spends two meters (an LLM call to write the
 * image prompt, an image credit to draw it), so the errors that matter are the
 * ones the server refuses with: a 402 (no credits) carries `requiresUpgrade` +
 * `upgradeUrl`, a 413 is storage, a 429 is a limiter with `retryAfterSeconds`.
 * All three are copied onto the Error so a panel can act on them instead of
 * printing a bare message.
 *
 * Boards are read through the ordinary workspace list: they are `kind='vision'`
 * items, one per board, and the list entry carries the board's JSON — so the
 * gallery is a single read rather than a request per thumbnail.
 */

import { getPortfolioApiUrl } from './workspaceApi.js';

const VISION_KIND = 'vision';

/** The scopes the backend accepts, in the order the dialog shows them. */
export const BOARD_SCOPE_KEYS = ['dream', 'all'];

/**
 * Turn a non-2xx body into an Error carrying everything the caller needs to
 * react — the same contract `workspaceApi`'s private helper uses, because a
 * panel that shows "Upgrade" for an out-of-credits 402 and "Free some space"
 * for a 413 needs the status and the hints to survive.
 */
function _errorFromResponse(res, json, text, fallback) {
  const msg = json?.error || json?.dataMessage || json?.message || text || fallback;
  const err = new Error(msg);
  err.status = res.status;
  if (json?.requiresUpgrade) err.requiresUpgrade = true;
  if (json?.upgradeUrl) err.upgradeUrl = json.upgradeUrl;
  if (json?.limiter) err.limiter = json.limiter;
  if (json?.retryAfterSeconds !== undefined) err.retryAfterSeconds = json.retryAfterSeconds;
  if (json?.storageLimitFormatted) err.storageLimitFormatted = json.storageLimitFormatted;
  return err;
}

async function _read(res, fallback) {
  const text = await res.text().catch(() => '');
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  if (!res.ok || json?.ok === false) throw _errorFromResponse(res, json, text, fallback);
  return json;
}

/**
 * Make one vision board per requested scope.
 *
 * Server-side by design: the board has to be saved to the account and listed in
 * the history, so the image is generated, stored and recorded in one pass rather
 * than returned to the browser as a data URL to upload back.
 *
 * @param {string} token - JWT
 * @param {string[]} scopes - Any of `dream`, `all` — one image each
 * @param {object} [opts]
 * @param {string} [opts.hint] - Free text folded into the prompt brief
 * @param {string} [opts.model] - Override the image model
 * @returns {Promise<{boards: Array, skipped: Array, failures: Array, meta: object}>}
 */
export async function generateVisionBoards(token, scopes, { hint = '', model } = {}) {
  const list = (Array.isArray(scopes) ? scopes : [scopes])
    .filter((s) => BOARD_SCOPE_KEYS.includes(s));
  if (!list.length) throw new Error('Pick at least one set of goals to make a board from.');

  const res = await fetch(`${getPortfolioApiUrl()}/csimple/vision-board`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      scopes: [...new Set(list)],
      ...(hint ? { hint: String(hint).slice(0, 200) } : {}),
      ...(model ? { model } : {}),
    }),
  });
  const json = await _read(res, 'The vision board could not be made.');
  return {
    boards: json?.boards || [],
    skipped: json?.skipped || [],
    failures: json?.failures || [],
    meta: json?.meta || {},
  };
}

/**
 * Every board the user has, newest first.
 *
 * Newest first is the order the gallery wants and the server already sorts by
 * `updatedAt`, but the payload's own `generatedAt` is the real timestamp (the
 * item's `updatedAt` moves if anything else ever touches it), so the sort is
 * re-applied here.
 */
export async function listVisionBoards(token) {
  if (!token) return [];
  const res = await fetch(`${getPortfolioApiUrl()}/csimple/workspace?kind=${VISION_KIND}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await _read(res, 'Could not load your vision boards.');
  const entries = Array.isArray(json?.entries) ? json.entries : [];
  return entries;
}

/**
 * Delete a board for good: the item, the image in storage, and the record that
 * counted its bytes against the plan.
 */
export async function deleteVisionBoard(token, slug) {
  if (!token || !slug) return null;
  const res = await fetch(`${getPortfolioApiUrl()}/csimple/vision-board/${encodeURIComponent(slug)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  return _read(res, 'Could not delete that board.');
}
