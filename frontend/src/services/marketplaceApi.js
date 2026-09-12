/**
 * marketplaceApi.js — Frontend API helpers for the Simple skill marketplace
 * (docs/implementation/simple-agent-prompt.md §4).
 *
 * Talks to the portfolio backend's public/shared marketplace surface:
 *   GET    /api/data/market/skills?q=&sort=&page=&perPage=
 *   POST   /api/data/market/skills
 *   GET    /api/data/market/skills/:marketId[/:version]
 *   POST   /api/data/market/skills/:marketId/install
 *   POST   /api/data/market/skills/:marketId/rate
 *   POST   /api/data/market/skills/:marketId/flag
 *
 * Every route is authenticated (`protect` middleware) — a logged-in user's
 * JWT is required, same pattern as the other cloud-gated Simple services.
 */

import { getApiBase } from '../config/api';
import { parseJson } from './apiClient';

const BASE = 'market/skills';

/** Auth headers for a logged-in marketplace request. */
function headers(token) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

/**
 * Turn a non-2xx error body into a clear Error, appending a "(retry in Xm)"
 * hint when the backend's rate limiter told us how long to wait.
 */
function errorFrom(json, text, status, fallback) {
  const msg = json?.dataMessage || json?.message || json?.error || text || fallback;
  const retryAfterSeconds = json?.retryAfterSeconds;
  let fullMsg = msg;
  if (retryAfterSeconds && !/retry in|try again in/i.test(msg)) {
    const mins = Math.max(1, Math.ceil(retryAfterSeconds / 60));
    fullMsg = `${msg} (retry in ~${mins} minute${mins === 1 ? '' : 's'})`;
  }
  const err = new Error(fullMsg);
  err.status = status;
  if (json?.limiter) err.limiter = json.limiter;
  if (retryAfterSeconds !== undefined) err.retryAfterSeconds = retryAfterSeconds;
  return err;
}

/** Safe JSON read with a fallback error message on non-JSON (proxy HTML) responses. */
async function readError(res, fallback) {
  let json = {};
  let text = '';
  try {
    text = await res.text();
    if (text) json = JSON.parse(text);
  } catch {
    // non-JSON (proxy/HTML error page) — fall through
  }
  throw errorFrom(json, text, res.status, fallback);
}

/**
 * Search / browse published skills.
 *
 * @param {string} token - Logged-in user's JWT.
 * @param {object} [opts] - { q, sort='trust'|'downloads'|'recent', page, perPage }
 * @returns {Promise<{skills:Array, total:number, page:number, perPage:number}>}
 */
export async function searchMarketSkills(token, { q, sort = 'trust', page = 1, perPage = 20 } = {}) {
  if (!token) throw new Error('Sign in required to browse the marketplace');
  const params = new URLSearchParams({ sort, page: String(page), perPage: String(perPage) });
  if (q && String(q).trim()) params.set('q', String(q).trim());

  let res;
  try {
    res = await fetch(`${getApiBase()}${BASE}?${params.toString()}`, { headers: headers(token) });
  } catch (networkErr) {
    throw new Error(`Network error: ${networkErr.message}`);
  }
  if (!res.ok) await readError(res, 'Failed to load the marketplace');
  return parseJson(res);
}

/**
 * Fetch a specific published version (latest when omitted). Response includes
 * the skill summary plus `version` and the scrubbed `steps` array.
 */
export async function getMarketSkill(token, marketId, version) {
  if (!token) throw new Error('Sign in required to view marketplace skills');
  const v = version ? `/${encodeURIComponent(version)}` : '';
  let res;
  try {
    res = await fetch(`${getApiBase()}${BASE}/${encodeURIComponent(marketId)}${v}`, { headers: headers(token) });
  } catch (networkErr) {
    throw new Error(`Network error: ${networkErr.message}`);
  }
  if (!res.ok) await readError(res, 'Failed to load the skill');
  return parseJson(res);
}

/**
 * Install a published skill: server-side downloads/installs bump, install
 * attestation recorded, and the installable scrubbed steps + `lowTrust` flag +
 * pre-run `capabilitySummary` returned.
 */
export async function installMarketSkill(token, marketId, version) {
  if (!token) throw new Error('Sign in required to install marketplace skills');
  let res;
  try {
    res = await fetch(`${getApiBase()}${BASE}/${encodeURIComponent(marketId)}/install`, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify(version ? { version } : {}),
    });
  } catch (networkErr) {
    throw new Error(`Network error: ${networkErr.message}`);
  }
  if (!res.ok) await readError(res, 'Failed to install the skill');
  return parseJson(res);
}

/**
 * Submit a run-gated rating. `ranAt` is the run-evidence timestamp the backend
 * requires (§4.1) — only call after the skill has actually been run in the
 * addon. `outcome` is the successCriteria result ('passed'|'failed'|null).
 */
export async function rateMarketSkill(token, marketId, { stars, outcome, ranAt, version } = {}) {
  if (!token) throw new Error('Sign in required to rate marketplace skills');
  let res;
  try {
    res = await fetch(`${getApiBase()}${BASE}/${encodeURIComponent(marketId)}/rate`, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({ stars, outcome, ranAt, ...(version ? { version } : {}) }),
    });
  } catch (networkErr) {
    throw new Error(`Network error: ${networkErr.message}`);
  }
  if (!res.ok) await readError(res, 'Failed to submit rating');
  return parseJson(res);
}

/**
 * Community flag — no moderation queue; flags feed the ranking penalty (§4.3).
 */
export async function flagMarketSkill(token, marketId, reason) {
  if (!token) throw new Error('Sign in required to flag marketplace skills');
  let res;
  try {
    res = await fetch(`${getApiBase()}${BASE}/${encodeURIComponent(marketId)}/flag`, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify(reason ? { reason } : {}),
    });
  } catch (networkErr) {
    throw new Error(`Network error: ${networkErr.message}`);
  }
  if (!res.ok) await readError(res, 'Failed to flag the skill');
  return parseJson(res);
}

/**
 * Publish a skill to the marketplace (new entry or a new version of one this
 * user authored). The backend independently re-scrubs + re-checks capability
 * declarations before persisting (§4.5).
 */
export async function publishMarketSkill(token, payload) {
  if (!token) throw new Error('Sign in required to publish marketplace skills');
  let res;
  try {
    res = await fetch(`${getApiBase()}${BASE}`, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify(payload),
    });
  } catch (networkErr) {
    throw new Error(`Network error: ${networkErr.message}`);
  }
  if (!res.ok) await readError(res, 'Failed to publish the skill');
  return parseJson(res);
}

/* ── Shared GOALS (§4.7) ────────────────────────────────────────────────────
   Same shape as the skill helpers, against /market/goals. A goal has no steps:
   it is its text. "Install" saves a private copy into the caller's workspace
   goal store, so the caller ends up owning an ordinary editable goal.
   Rating and flagging a goal reuse the skill endpoints (marketId-addressed). */

const GOALS_BASE = 'market/goals';

/** Browse shared goals. Returns { goals, total, page, perPage }. */
export async function searchMarketGoals(token, { q, sort = 'trust', page = 1, perPage = 20 } = {}) {
  if (!token) throw new Error('Sign in required to browse shared goals');
  const params = new URLSearchParams({ sort, page: String(page), perPage: String(perPage) });
  if (q && String(q).trim()) params.set('q', String(q).trim());

  let res;
  try {
    res = await fetch(`${getApiBase()}${GOALS_BASE}?${params.toString()}`, { headers: headers(token) });
  } catch (networkErr) {
    throw new Error(`Network error: ${networkErr.message}`);
  }
  if (!res.ok) await readError(res, 'Failed to load shared goals');
  return parseJson(res);
}

/** Publish a goal (`kind: 'goal'`) — `marketId` omitted means "create". */
export async function publishMarketGoal(token, payload) {
  if (!token) throw new Error('Sign in required to share a goal');
  let res;
  try {
    res = await fetch(`${getApiBase()}${GOALS_BASE}`, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify(payload),
    });
  } catch (networkErr) {
    throw new Error(`Network error: ${networkErr.message}`);
  }
  if (!res.ok) await readError(res, 'Failed to share the goal');
  return parseJson(res);
}

/** Save a shared goal into the signed-in user's own workspace. */
export async function installMarketGoal(token, marketId) {
  if (!token) throw new Error('Sign in required to save shared goals');
  let res;
  try {
    res = await fetch(`${getApiBase()}${GOALS_BASE}/${encodeURIComponent(marketId)}/install`, {
      method: 'POST',
      headers: headers(token),
    });
  } catch (networkErr) {
    throw new Error(`Network error: ${networkErr.message}`);
  } if (!res.ok) await readError(res, 'Failed to save the goal');
  return parseJson(res);
}

/** One shared goal (summary — the goal text is on the summary itself). */
export async function getMarketGoal(token, marketId) {
  if (!token) throw new Error('Sign in required to view shared goals');
  let res;
  try {
    res = await fetch(`${getApiBase()}${GOALS_BASE}/${encodeURIComponent(marketId)}`, { headers: headers(token) });
  } catch (networkErr) {
    throw new Error(`Network error: ${networkErr.message}`);
  }
  if (!res.ok) await readError(res, 'Failed to load the goal');
  return parseJson(res);
}
