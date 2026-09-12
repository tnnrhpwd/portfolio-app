/**
 * fitApi.js — frontend API helpers for the /fit coach.
 *
 *   POST /api/data/fit/coach → { success, advice, disclaimer, provider, screened }
 *
 * Signed in only. The endpoint is a server-paid cloud LLM call metered at the
 * provider boundary, so a 402 carries the same structured upgrade fields the
 * rest of the app uses (`planRequired` / `creditsRemaining` / `upgradeUrl`).
 */

import { getApiBase } from '../config/api';
import { authHeaders as headers, parseJson } from './apiClient';

/**
 * Ask the coach about the athlete's own logged data.
 *
 * @param {string} token — user JWT
 * @param {object} payload — see `coachPayload()` in fitStorage
 * @returns {Promise<{advice: object, disclaimer: string, provider: string, screened: boolean}>}
 */
export async function askFitCoach(token, payload) {
  if (!token) throw new Error('Sign in to get coaching on your logged training.');

  const res = await fetch(`${getApiBase()}fit/coach`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify(payload || {}),
  });

  const json = await parseJson(res);

  if (!res.ok) {
    const error = new Error(
      json.message || json.error || json.dataMessage || 'The coach could not be reached. Please try again.'
    );
    error.status = res.status;
    // Preserve the structured upgrade info so the UI can offer the same
    // "Upgrade / Ask us" affordance the chat 402 path uses.
    error.planRequired = Boolean(json.planRequired);
    error.requiresUpgrade = Boolean(json.requiresUpgrade);
    error.membership = json.membership;
    error.limit = json.limit;
    error.creditsRemaining = json.creditsRemaining;
    error.upgradeUrl = json.upgradeUrl;
    throw error;
  }

  return {
    advice: json.advice || null,
    disclaimer: json.disclaimer || '',
    provider: json.provider || 'llm',
    screened: Boolean(json.screened),
  };
}

export default { askFitCoach };
