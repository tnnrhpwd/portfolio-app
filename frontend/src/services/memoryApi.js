/**
 * memoryApi.js — Frontend API helpers for Goals / Plans / Actions memory system.
 *
 * Talks to:
 *   GET    /api/data/memory?type=goal|plan|action
 *   POST   /api/data/memory
 *   PUT    /api/data/memory/:id
 *   DELETE /api/data/memory/:id
 */

import { getApiBase } from '../config/api';

function headers(token) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

/**
 * Safely read a JSON body. The Netlify SPA catch-all / proxy can occasionally
 * return an HTML error page (e.g. a 502 or a warmed-but-mid-restart backend)
 * instead of JSON; calling `res.json()` on that throws a confusing SyntaxError
 * and hides the real status. Parse defensively so we surface a clear error.
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
 * Fetch memory items. Pass type='goal'|'plan'|'action' to filter.
 */
export async function fetchMemoryItems(token, type = null) {
  const url = type
    ? `${getApiBase()}memory?type=${type}`
    : `${getApiBase()}memory`;
  const res = await fetch(url, { headers: headers(token) });
  const json = await parseJson(res);
  if (!res.ok) throw new Error(json.message || json.error || 'Failed to fetch memory');
  return json.items;
}

/**
 * Fetch a single memory item by id (includes its `data.agent` run state).
 */
export async function fetchMemoryItem(token, itemId) {
  const res = await fetch(`${getApiBase()}memory/${encodeURIComponent(itemId)}`, { headers: headers(token) });
  const json = await parseJson(res);
  if (!res.ok) throw new Error(json.message || json.error || 'Failed to fetch memory item');
  return json.item;
}

/**
 * Create a new memory item.
 * @param {string} token
 * @param {'goal'|'plan'|'action'} type
 * @param {Object} data — must include at least { title }
 */
export async function createMemoryItem(token, type, data) {
  const res = await fetch(`${getApiBase()}memory`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ type, data }),
  });
  const json = await parseJson(res);
  if (!res.ok) throw new Error(json.message || json.error || 'Failed to create memory item');
  return json.item;
}

/**
 * Update an existing memory item.
 */
export async function updateMemoryItem(token, itemId, data) {
  const res = await fetch(`${getApiBase()}memory/${encodeURIComponent(itemId)}`, {
    method: 'PUT',
    headers: headers(token),
    body: JSON.stringify({ data }),
  });
  const json = await parseJson(res);
  if (!res.ok) throw new Error(json.message || json.error || 'Failed to update memory item');
  return json.item;
}

/**
 * Delete a memory item.
 */
export async function deleteMemoryItem(token, itemId) {
  const res = await fetch(`${getApiBase()}memory/${encodeURIComponent(itemId)}`, {
    method: 'DELETE',
    headers: headers(token),
  });
  const json = await parseJson(res);
  if (!res.ok) throw new Error(json.message || json.error || 'Failed to delete memory item');
  return json;
}
