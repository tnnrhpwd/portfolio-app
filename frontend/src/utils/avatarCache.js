/**
 * avatarCache.js — the client's store of friends' profile pictures.
 *
 * A friend's picture is fetched once and kept, because the alternative is paying
 * 3–5 KB per friend on every single load of `/talk` and every conversation on
 * `/net` — for a photo that changes approximately never.
 *
 * Every entry carries the server's `etag` (a hash of the picture it was built
 * from), which is what makes this a cache rather than a copy: the etag we send
 * back lets the server answer "unchanged" in a few bytes, and a changed picture
 * comes back on its own.
 *
 * ⚠️ A stale entry is still RENDERED (a face from yesterday beats initials), and
 * only *refreshed* in the background — see `resolveAvatar` vs `planAvatarRequest`.
 *
 * All of this is localStorage, so every read and write is wrapped: private
 * browsing and a full quota both throw, and neither is a reason to break the page.
 */

export const AVATAR_STORAGE_KEY = 'talk:avatars';

/** How long an entry is trusted before it is refreshed in the background. */
export const AVATAR_TTL_MS = 12 * 60 * 60 * 1000;

/** Keep the store bounded — 400 entries at ~4 KB is ~1.6 MB. */
export const AVATAR_MAX_ENTRIES = 400;

/** One request may ask about at most this many accounts (matches the server). */
export const AVATAR_BATCH_SIZE = 24;

/** Shape of the localStorage blob. Bump when the entry shape changes. */
const SCHEMA_VERSION = 1;

function safeStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The whole cache as a plain object. Never throws; returns {} when unreadable. */
export function readAvatarCache(storage = safeStorage()) {
  if (!storage) return {};
  try {
    const raw = storage.getItem(AVATAR_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== SCHEMA_VERSION || typeof parsed.entries !== 'object') return {};
    return parsed.entries || {};
  } catch {
    return {};
  }
}

/**
 * Persist the cache, dropping the oldest entries past the cap.
 * Never throws — a full or unavailable store means avatars are simply re-fetched
 * next time rather than the page failing.
 */
export function writeAvatarCache(entries, storage = safeStorage()) {
  if (!storage) return;
  try {
    const trimmed = {};
    Object.entries(entries)
      .sort((a, b) => (b[1]?.at || 0) - (a[1]?.at || 0))
      .slice(0, AVATAR_MAX_ENTRIES)
      .forEach(([id, entry]) => { trimmed[id] = entry; });

    storage.setItem(AVATAR_STORAGE_KEY, JSON.stringify({ v: SCHEMA_VERSION, entries: trimmed }));
  } catch {
    /* quota or private mode — the cache is an optimisation, never a dependency */
  }
}

/**
 * What to draw for an account right now.
 * @returns {{ src: string|null, etag: string, stale: boolean }|null} `null` when
 *   nothing is known about it yet (the caller draws initials).
 */
export function resolveAvatar(cache, userId, now = Date.now()) {
  const entry = cache?.[userId];
  if (!entry) return null;
  return {
    src: entry.src || null,
    etag: entry.etag || '',
    stale: now - (entry.at || 0) > AVATAR_TTL_MS,
  };
}

/**
 * The requests needed to fill this cache in.
 *
 * Only missing or stale accounts are asked about, so a normal visit (everything
 * cached within the TTL) sends **no request at all** — which is the whole point
 * of caching. Accounts we already hold an etag for are asked with it, so the
 * answer for an unchanged picture is a few bytes rather than an image.
 *
 * @param {string[]} ids
 * @param {object} cache
 * @param {number} now
 * @returns {{ batches: Array<{ ids: string[], have: string }>, skipped: string[] }}
 *   `have` is the `id:etag,id:etag` string the server parses; `skipped` is the
 *   accounts already fresh.
 */
export function planAvatarRequest(ids = [], cache = {}, now = Date.now()) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  const needed = [];
  const skipped = [];

  for (const id of unique) {
    const entry = cache[id];
    if (entry && now - (entry.at || 0) <= AVATAR_TTL_MS) {
      skipped.push(id);
      continue;
    }
    needed.push(id);
  }

  const batches = [];
  for (let i = 0; i < needed.length; i += AVATAR_BATCH_SIZE) {
    const slice = needed.slice(i, i + AVATAR_BATCH_SIZE);
    const have = slice
      .filter((id) => cache[id] && typeof cache[id].etag === 'string')
      .map((id) => `${id}:${cache[id].etag}`)
      .join(',');
    batches.push({ ids: slice, have });
  }

  return { batches, skipped };
}

/**
 * Fold a server response into the cache.
 *
 * - `avatars`  → the new (or changed) pictures, `src: null` meaning "no picture".
 * - `unchanged`→ refresh their timestamp so they are not asked about again; the
 *               picture we already hold is still the right one.
 * - `skipped`  → **dropped**. The server only skips ids we are not connected to,
 *               so keeping a picture for one would mean still showing the face of
 *               someone we are no longer connected to.
 *
 * @returns {object} a new cache (the input is not mutated)
 */
export function mergeAvatars(cache = {}, response = {}, now = Date.now()) {
  const next = { ...cache };

  for (const [id, avatar] of Object.entries(response.avatars || {})) {
    next[id] = { src: avatar?.src || null, etag: avatar?.etag || '', at: now };
  }

  for (const id of response.unchanged || []) {
    const existing = next[id];
    if (existing) next[id] = { ...existing, at: now };
  }

  for (const id of response.skipped || []) {
    delete next[id];
  }

  return next;
}
