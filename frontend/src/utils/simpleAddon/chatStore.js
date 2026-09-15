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

/** True when a conversation has at least one message (i.e. worth syncing). */
export const hasMessages = (c) => Array.isArray(c?.messages) && c.messages.length > 0;

/**
 * Union two message lists by id, oldest first.
 *
 * The client must MERGE with the cloud, never replace: the sync polls while a
 * turn is running, and a conversation's user message exists only locally until
 * the backend saves the finished turn. Replacing local state with that
 * (in-flight, therefore stale) snapshot silently deleted the message the user
 * had just sent — observed 2026-09-14, when two sent messages vanished from
 * `csimple_chats` and the chat fell back to showing an older conversation.
 */
export function mergeMessageLists(a = [], b = []) {
  const byId = new Map();
  for (const msg of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) {
    if (!msg || msg.id == null) continue;
    const key = String(msg.id);
    const seen = byId.get(key);
    // Prefer the longer body: a streamed reply still growing, or a local message
    // the server hasn't seen yet, must not be truncated by the merge.
    if (!seen || String(msg.content ?? '').length >= String(seen.content ?? '').length) {
      byId.set(key, msg);
    }
  }
  return [...byId.values()].sort(
    (x, y) => String(x.timestamp ?? '').localeCompare(String(y.timestamp ?? ''))
  );
}

/** Merge one conversation pair: union the messages, keep the newest metadata. */
export function mergeConversation(local, server) {
  const updatedAt = [local?.updatedAt, server?.updatedAt].filter(Boolean).sort().pop();
  return {
    ...server,
    ...local,
    messages: mergeMessageLists(local?.messages, server?.messages),
    ...(updatedAt ? { updatedAt } : {}),
  };
}

/**
 * Fold the server's conversation list into the local one WITHOUT ever dropping
 * local content.
 *
 * The previous version kept only *empty* local conversations and otherwise took
 * the server list wholesale, so any local conversation the server hadn't
 * acknowledged yet disappeared:
 *
 *   - a chat created locally (messages not saved upstream yet) was discarded,
 *     and
 *   - a chat the server DID know about was replaced by the server's copy, which
 *     is a snapshot taken before the in-flight turn finished — losing the
 *     just-sent user message.
 *
 * Either way the active conversation could vanish, and the caller's fallback
 * then jumped the view to an unrelated older chat. Now same-id conversations are
 * merged (messages unioned) and local-only conversations are kept unless the
 * tombstone set says they were deleted somewhere.
 *
 * @param {Array} prev - current local conversations
 * @param {Array} serverConversations - list from the merge endpoint
 * @param {Array<string>} [deletedIds] - tombstones (local ∪ server)
 * @returns {Array} the next conversation list
 */
export function adoptSyncedConversations(prev, serverConversations, deletedIds = []) {
  const local = Array.isArray(prev) ? prev : [];
  const server = Array.isArray(serverConversations) ? serverConversations : [];
  const deleted = new Set((Array.isArray(deletedIds) ? deletedIds : []).map(String));
  const serverById = new Map(server.map((c) => [String(c?.id), c]));

  const localOnly = [];
  const merged = [];
  for (const c of local) {
    if (!c || deleted.has(String(c.id))) continue;
    const remote = serverById.get(String(c.id));
    if (remote) {
      serverById.delete(String(c.id));
      merged.push(mergeConversation(c, remote));
    } else {
      // Not on the server (yet) — this is the in-flight/unsaved case, so keep it.
      localOnly.push(c);
    }
  }
  for (const remote of serverById.values()) {
    if (remote && !deleted.has(String(remote.id))) merged.push(remote);
  }

  // Local-only chats (a fresh placeholder, or a turn still in flight) lead the
  // list, matching the previous ordering; the rest keep the server's order.
  const next = [...localOnly, ...merged];
  if (next.length === 0) {
    return [{ id: Date.now().toString(), title: 'New Chat', messages: [], createdAt: new Date().toISOString() }];
  }
  if (JSON.stringify(next) === JSON.stringify(prev)) return prev;
  return next;
}
