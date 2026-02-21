/**
 * memoryApi.js — Frontend API helpers for Goals / Plans / Actions memory system.
 *
 * Talks to:
 *   GET    /api/data/memory?type=goal|plan|action
 *   POST   /api/data/memory
 *   PUT    /api/data/memory/:id
 *   DELETE /api/data/memory/:id
 */

const devMode = process.env.NODE_ENV === 'development';

function getApiBase() {
  if (devMode) return '/api/data/';
  if (typeof window !== 'undefined') {
    const h = window.location.hostname;
    if (h === 'www.sthopwood.com' || h === 'sthopwood.com') {
      return 'https://mern-plan-web-service.onrender.com/api/data/';
    }
    return '/api/data/';
  }
  return 'https://mern-plan-web-service.onrender.com/api/data/';
}

function headers(token) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

/**
 * Fetch memory items. Pass type='goal'|'plan'|'action' to filter.
 */
export async function fetchMemoryItems(token, type = null) {
  const url = type
    ? `${getApiBase()}memory?type=${type}`
    : `${getApiBase()}memory`;
  const res = await fetch(url, { headers: headers(token) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || json.error || 'Failed to fetch memory');
  return json.items;
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
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || json.error || 'Failed to create memory item');
  return json.item;
}

/**
 * Update an existing memory item.
 */
export async function updateMemoryItem(token, itemId, data) {
  const res = await fetch(`${getApiBase()}memory/${itemId}`, {
    method: 'PUT',
    headers: headers(token),
    body: JSON.stringify({ data }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || json.error || 'Failed to update memory item');
  return json.item;
}

/**
 * Delete a memory item.
 */
export async function deleteMemoryItem(token, itemId) {
  const res = await fetch(`${getApiBase()}memory/${itemId}`, {
    method: 'DELETE',
    headers: headers(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || json.error || 'Failed to delete memory item');
  return json;
}
