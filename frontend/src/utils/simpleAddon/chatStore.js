/**
 * chatStore.js — the browser-local half of /net's conversation store.
 *
 * `/net` keeps its conversations in `localStorage` (fast, works offline) and
 * mirrors them to the cloud; the cloud copy is the cross-device source of truth.
 * Other surfaces need to reach into that same store — `/plans` opens a goal's
 * thread, the goal page records a finished run into it — and duplicating the
 * storage key in three files is how the two halves silently drift apart. So the
 * key and the read/write live here, and everyone imports them.
 *
 * Deliberately tiny and non-throwing: a browser with `localStorage` disabled
 * (private mode, blocked storage) must degrade to "no local copy" rather than
 * take down a page.
 */

export const CHATS_STORAGE_KEY = 'csimple_chats';
export const ACTIVE_CHAT_KEY = 'csimple_active_chat';

/** Read the locally-stored conversation list. Returns `[]` when unavailable. */
export function readLocalConversations() {
  try {
    const raw = localStorage.getItem(CHATS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Overwrite the locally-stored conversation list.
 *
 * An empty list is intentionally *not* written: an empty array is far more
 * likely to be "we failed to read" than "the user deleted every chat", and
 * wiping the store would take the conversation history with it.
 *
 * @returns {boolean} whether the write happened
 */
export function writeLocalConversations(conversations) {
  if (!Array.isArray(conversations) || conversations.length === 0) return false;
  try {
    localStorage.setItem(CHATS_STORAGE_KEY, JSON.stringify(conversations));
    return true;
  } catch {
    return false;
  }
}
