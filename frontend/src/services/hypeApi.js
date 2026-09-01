/**
 * hypeApi.js — Frontend API helper for the public /hype page.
 *
 *   POST /api/data/hype/quote → { success, quote, provider }
 */

import { getApiBase } from '../config/api';

/**
 * Safely read a JSON body. The Netlify SPA catch-all / proxy can occasionally
 * return an HTML error page instead of JSON; parsing defensively surfaces a
 * clear error instead of a confusing SyntaxError.
 */
async function parseJson(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Unexpected response from server (${res.status}). Please try again.`);
  }
}

/**
 * Generate a brand-new motivational hype quote via the backend LLM.
 * The endpoint is public (no token needed).
 *
 * @param {string} [mood] - Optional reader mood to flavor the quote.
 * @returns {Promise<{quote: string, provider: string}>}
 */
export async function generateHypeQuote(mood = '') {
  const res = await fetch(`${getApiBase()}hype/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(mood ? { mood } : {}),
  });
  const json = await parseJson(res);
  if (!res.ok) throw new Error(json.error || json.message || 'Failed to generate a quote');
  return json;
}
