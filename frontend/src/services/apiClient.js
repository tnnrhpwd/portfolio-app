/**
 * apiClient.js — shared helpers for the portfolio backend API.
 *
 * Centralizes the small pieces that were copy-pasted across every domain API
 * file: auth headers, JSON headers, and defensive JSON parsing. Add new shared
 * helpers here rather than re-defining them per service.
 */

/** Auth headers for a logged-in request. */
export function authHeaders(token) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

/** JSON content-type headers for public (token-less) requests. */
export function jsonHeaders() {
  return { 'Content-Type': 'application/json' };
}

/**
 * Safely read a JSON body. The Netlify SPA catch-all / proxy can occasionally
 * return an HTML error page (e.g. a 502 or a warmed-but-mid-restart backend)
 * instead of JSON; calling `res.json()` on that throws a confusing SyntaxError
 * and hides the real status. Parse defensively so we surface a clear error.
 */
export async function parseJson(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Unexpected response from server (${res.status}). Please try again.`);
  }
}
