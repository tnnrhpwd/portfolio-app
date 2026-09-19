/**
 * chat-store.js — the addon chat's conversation model, and where it is kept locally.
 *
 * **This store is the SAME SHAPE as the website's, on purpose.** /net keeps its
 * conversations in `localStorage` (`csimple_chats`) and syncs them to ONE cloud row
 * per user (`csimple_convos_<userId>` via `POST /api/data/csimple/conversations/merge`).
 * The addon writes to that same row, so a thread started here appears in /net's rail
 * and a thread started there appears here — a mirror, not a second inbox.
 *
 * That is why the field names are the website's, and not merely similar:
 *
 *   conversation  { id, title, createdAt, updatedAt, messages[] }   ← ISO 8601 strings
 *   message       { id, role, content, timestamp }                  ← ISO 8601 string
 *
 * ⚠️ **ISO strings are load-bearing, not cosmetic.** The backend's own merge helpers
 * (`csimpleController.js`: `conversationRecency`, `mergeMessageLists`) recover recency
 * and ordering with `Date.parse(timestamp)` / `Date.parse(updatedAt)`. An epoch-ms
 * NUMBER parses to `NaN`, which silently means "no recency" — the addon's
 * conversations would sort last and its messages would lose their order against the
 * website's copy. So the addon speaks the website's units rather than converting at
 * the boundary, where a missed field would be invisible.
 *
 * The addon adds only ADDITIVE fields the website is free to ignore:
 *   kind?      'answer' | 'question' | 'stopped' | 'error'  (how to ink the bubble)
 *   steps?     the tool rows for that turn
 *   goalSlug?  which goal on this PC the turn ran
 *
 * Deletions are TOMBSTONES (`deletedIds`), held here and unioned by the server, so a
 * delete on one device is not resurrected by another device's next sync.
 *
 * Pure + injectable: every function takes the conversation (or the storage object) as
 * an argument and returns a new value. `chat-store.test.js` drives it with a fake
 * storage, so persistence is tested without a browser and without a real profile.
 *
 * Exposed as `window.SimpleChatStore` in a renderer and as `module.exports` under
 * Node (for the test).
 *
 * ⚠️ ONE GLOBAL SCOPE — see the note in `chat-format.js`. Every top-level binding here
 * shares the page with `appearance/appearance.js`, so the export object is named
 * uniquely and the test asserts no name is declared twice across the three modules.
 */

'use strict';

/** Bumped when the shape changes incompatibly — an unknown version is ignored, not migrated.
 *  v1 held epoch-ms timestamps and was superseded before release by the website shape above. */
const STORAGE_VERSION = 2;
const STORAGE_KEY = 'simple_addon_chats_v2';

/** Newest-first list cap. The chat is a log of this PC's work, not an archive. */
const MAX_CONVERSATIONS = 40;

/**
 * Messages kept per conversation.
 *
 * ⚠️ Trimming drops the OLDEST, which is the cheap half — a long-running thread is
 * far more likely to be re-read from its end, and the addon's step rows on each
 * assistant turn are the part that makes a turn big. The alternative (dropping big
 * turns first) would silently delete exactly the turns worth keeping.
 */
const MAX_MESSAGES = 240;

/** A title is a label in a list, not a sentence. */
const TITLE_MAX = 48;

/** Tombstones are kept longer than threads: a delete has to outlive the sync that
 *  carried it. The server unions them too, so this is only the local floor. */
const MAX_DELETED_IDS = 200;

function nowIso(nowMsValue) {
  return new Date(Number.isFinite(nowMsValue) ? nowMsValue : Date.now()).toISOString();
}

/** Ids are local-only; nothing dedupes across devices, so a counter + time is enough. */
let _seq = 0;
function uid(prefix) {
  _seq += 1;
  return `${prefix || 'id'}-${Date.now().toString(36)}-${_seq.toString(36)}`;
}

/** The list label for a thread: the first line of what was asked, clipped. */
function titleFromText(text) {
  const flat = String(text === undefined || text === null ? '' : text)
    .split('\n')[0]
    .replace(/\s+/g, ' ')
    .trim();
  if (!flat) return 'New chat';
  return flat.length > TITLE_MAX ? `${flat.slice(0, TITLE_MAX - 1)}…` : flat;
}

/** A fresh, empty conversation. */
function newConversation(opts) {
  const o = opts || {};
  const at = nowIso(o.now);
  return {
    id: o.id || uid('convo'),
    title: o.title || 'New chat',
    createdAt: at,
    updatedAt: at,
    messages: [],
  };
}

function isMessage(value) {
  return !!value
    && typeof value === 'object'
    && typeof value.id === 'string'
    && (value.role === 'user' || value.role === 'assistant')
    && typeof value.content === 'string';
}

/**
 * Append a message. Returns a NEW conversation.
 *
 * The title is taken from the FIRST user message and then left alone: a thread named
 * after every new message would rename itself as the conversation moves, which makes
 * the list unreadable exactly when it has got long enough to need it.
 */
function appendMessage(conversation, message) {
  if (!conversation || typeof conversation !== 'object') return conversation;
  const at = (message && typeof message.timestamp === 'string' && message.timestamp) || nowIso();
  const msg = {
    id: (message && message.id) || uid('msg'),
    role: message && message.role === 'user' ? 'user' : 'assistant',
    content: String((message && message.content) || ''),
    timestamp: at,
  };
  if (message) {
    // Additive fields only. Anything the website does not know about must not be
    // invented here, or the two surfaces start disagreeing about what a message is.
    // (`pendingAction` is what a "question" bubble's Yes button re-sends.)
    for (const key of ['kind', 'progressNote', 'goalSlug', 'steps', 'toolsUsed', 'pendingAction']) {
      if (message[key] !== undefined && message[key] !== null) msg[key] = message[key];
    }
  }

  const messages = (Array.isArray(conversation.messages) ? conversation.messages : []).concat([msg]);
  const trimmed = messages.length > MAX_MESSAGES ? messages.slice(messages.length - MAX_MESSAGES) : messages;
  const hadOnlyPlaceholder = !Array.isArray(conversation.messages) || conversation.messages.length === 0;
  const title = hadOnlyPlaceholder && msg.role === 'user'
    ? titleFromText(msg.content)
    : conversation.title || 'New chat';

  return { ...conversation, title, messages: trimmed, updatedAt: at };
}

/**
 * Replace fields on one message (matched by id). Returns a NEW conversation, or the
 * same one when nothing matched — the caller uses identity to know it can skip a
 * re-render.
 *
 * This is how a turn is finished: the working bubble is appended first (so the user
 * sees the typing bubble and the live steps), then patched in place with the answer.
 * Appending a second message instead would leave the working bubble behind.
 */
function updateMessage(conversation, id, patch) {
  if (!conversation || typeof conversation !== 'object' || !id) return conversation;
  const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
  let found = false;
  const next = messages.map((msg) => {
    if (msg.id !== id) return msg;
    found = true;
    const merged = { ...msg, ...(patch || {}) };
    merged.content = String(merged.content === undefined || merged.content === null ? '' : merged.content);
    return merged;
  });
  if (!found) return conversation;
  return { ...conversation, messages: next, updatedAt: nowIso() };
}

/** Best-effort recency (ms) for a conversation — the same rule the BACKEND uses
 *  (`csimpleController.conversationRecency`), so both sides sort a merged list the
 *  same way and a pull cannot silently reorder the rail. */
function conversationRecency(conv) {
  if (!conv || typeof conv !== 'object') return 0;
  const updated = conv.updatedAt ? Date.parse(conv.updatedAt) : NaN;
  if (!Number.isNaN(updated)) return updated;

  const msgs = Array.isArray(conv.messages) ? conv.messages : [];
  let max = NaN;
  for (const m of msgs) {
    const t = m && m.timestamp ? Date.parse(m.timestamp) : NaN;
    if (!Number.isNaN(t) && (Number.isNaN(max) || t > max)) max = t;
  }
  if (!Number.isNaN(max)) return max;

  const created = conv.createdAt ? Date.parse(conv.createdAt) : NaN;
  return Number.isNaN(created) ? 0 : created;
}

/** Drop one conversation. Returns a NEW list. */
function deleteConversation(conversations, id) {
  const list = Array.isArray(conversations) ? conversations : [];
  return list.filter((c) => c && String(c.id) !== String(id));
}

/** Add a deletion tombstone. Returns a NEW list, bounded, newest first. */
function addTombstone(deletedIds, id) {
  if (id === undefined || id === null || String(id) === '') return toList(deletedIds);
  const set = new Set(toList(deletedIds));
  set.delete(String(id));
  return [String(id)].concat(Array.from(set)).slice(0, MAX_DELETED_IDS);
}

/** Union of two tombstone lists — mirrors the backend's `unionTombstones`. */
function unionTombstones(a, b) {
  const set = new Set();
  toList(a).forEach((id) => set.add(id));
  toList(b).forEach((id) => set.add(id));
  return Array.from(set);
}

function toList(value) {
  return (Array.isArray(value) ? value : [])
    .filter((v) => v !== undefined && v !== null && String(v) !== '')
    .map(String);
}

/** Remove tombstoned conversations from a list. */
function filterTombstoned(conversations, deletedIds) {
  const dead = new Set(toList(deletedIds));
  return (Array.isArray(conversations) ? conversations : []).filter((c) => c && !dead.has(String(c.id)));
}

/**
 * Union two message lists by id, mirroring the website's `chatStore.mergeMessageLists`
 * (itself a mirror of the backend's `csimpleController.mergeMessageLists`).
 *
 * ⚠️ **This union is why a pull cannot lose the agent trace.** The cloud only ever
 * receives a STRIPPED payload when a thread is heavy, so the copy it returns has no
 * `steps` on those messages. Replacing local messages with that echo deleted the tool
 * rows from the only place they existed. `{ ...seen, ...msg }` — local first, remote
 * second — keeps every key only the LOCAL copy carries while the remote's own fields
 * win, which is exactly the property needed, and it is the website's rule rather than
 * one invented here.
 *
 * The longer body wins for `content` because a reply can still be growing locally when
 * the server's copy of it arrives.
 */
function mergeMessages(local, remote) {
  const byId = new Map();
  const asText = (v) => (v === undefined || v === null ? '' : String(v));
  for (const msg of [...(Array.isArray(local) ? local : []), ...(Array.isArray(remote) ? remote : [])]) {
    if (!msg || typeof msg !== 'object' || msg.id === undefined || msg.id === null) continue;
    const key = String(msg.id);
    const seen = byId.get(key);
    if (!seen) {
      byId.set(key, msg);
      continue;
    }
    const longer = asText(msg.content).length >= asText(seen.content).length ? msg : seen;
    byId.set(key, { ...seen, ...msg, content: longer.content });
  }
  return Array.from(byId.values())
    .sort((x, y) => String(x.timestamp || '').localeCompare(String(y.timestamp || '')));
}

/** A title is only worth keeping if it says something. */
function isMeaningfulTitle(conversation) {
  const title = conversation && typeof conversation.title === 'string' ? conversation.title.trim() : '';
  return !!title && !/^new chat$/i.test(title);
}

/**
 * Merge one conversation pair — the same rule the BACKEND applies
 * (`csimpleController.mergeConversation`): newer metadata wins, the title falls back to
 * whichever side has a meaningful one (so a local "New chat" can never clobber the
 * website's title), messages are unioned, and `updatedAt` is the later of the two.
 */
function mergeConversationPair(local, remote) {
  const localRecency = conversationRecency(local);
  const remoteRecency = conversationRecency(remote);
  const newer = remoteRecency > localRecency ? remote : local;
  const older = newer === local ? remote : local;
  const recency = Math.max(localRecency, remoteRecency);

  let title = newer.title || older.title || 'New chat';
  if (isMeaningfulTitle(newer)) title = newer.title;
  else if (isMeaningfulTitle(older)) title = older.title;

  return {
    ...older,
    ...newer,
    title,
    messages: mergeMessages(local.messages, remote.messages),
    ...(Number.isFinite(recency) && recency > 0 ? { updatedAt: new Date(recency).toISOString() } : {}),
  };
}

/**
 * Adopt the server's merged list after a sync.
 *
 * Every same-id conversation is MERGED, not replaced (see `mergeConversationPair`),
 * plus the two local cases /net had to work out the hard way:
 *
 *   1. **Tombstoned** conversations are dropped — a delete on another device has to
 *      win over this device's stale copy.
 *   2. **Local-only** conversations are KEPT when they carry messages. They are absent
 *      from the answer only because the request that carried them was in flight, or the
 *      write failed — and dropping them would lose a turn the user just watched happen.
 *      An EMPTY local-only conversation is dropped instead: the server filters empty
 *      threads on purpose (they used to pile up, one per device's "New chat"
 *      placeholder), so keeping it would just fight the server.
 *
 * ⚠️ Rule 2 is the bug /net hit and fixed (`adoptSyncedConversations` replaced local
 * state with the server list and dropped a just-sent message, and the poll runs while a
 * turn is in flight). The merge above is the other half of the same lesson: a replace is
 * not merely "the server's copy is better", it is a place where a field only this device
 * holds disappears.
 */
function adoptSynced(local, remote, deletedIds) {
  const tombstones = toList(deletedIds);
  const dead = new Set(tombstones);
  const remoteList = filterTombstoned(remote, tombstones);
  const remoteById = new Map(remoteList.map((c) => [String(c.id), c]));

  const kept = [];
  const localOnly = [];
  for (const c of (Array.isArray(local) ? local : [])) {
    if (!c || dead.has(String(c.id))) continue;
    const theirs = remoteById.get(String(c.id));
    if (theirs) {
      remoteById.delete(String(c.id));
      kept.push(mergeConversationPair(c, theirs));
    } else if (Array.isArray(c.messages) && c.messages.length > 0) {
      localOnly.push(c);
    }
  }
  for (const theirs of remoteById.values()) kept.push(theirs);

  return pruneConversations(kept.concat(localOnly), MAX_CONVERSATIONS);
}

/** Keep the newest `max` conversations (by recency), newest first. */
function pruneConversations(conversations, max) {
  const limit = Number.isFinite(max) && max > 0 ? max : MAX_CONVERSATIONS;
  const list = (Array.isArray(conversations) ? conversations : [])
    .filter((c) => c && typeof c === 'object' && typeof c.id === 'string')
    .slice()
    .sort((a, b) => {
      const ra = conversationRecency(a);
      const rb = conversationRecency(b);
      if (ra !== rb) return rb - ra;
      return String(a.id).localeCompare(String(b.id));
    });
  return list.slice(0, limit);
}

/**
 * Read the stored state: `{ conversations, deletedIds }`.
 *
 * ⚠️ Never throws and never returns junk: a corrupt profile, a half-written value
 * from a crashed window, a v1 payload or a future version all read as "nothing yet".
 * A chat window that refuses to OPEN because its own history is malformed would be a
 * worse bug than losing the history.
 */
function loadState(storage) {
  const empty = { conversations: [], deletedIds: [] };
  try {
    const raw = storage && typeof storage.getItem === 'function' ? storage.getItem(STORAGE_KEY) : null;
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.conversations)) return empty;
    return {
      conversations: pruneConversations(
        parsed.conversations.map((c) => ({
          id: String(c.id),
          title: typeof c.title === 'string' && c.title ? c.title : 'New chat',
          createdAt: typeof c.createdAt === 'string' ? c.createdAt : nowIso(),
          updatedAt: typeof c.updatedAt === 'string' ? c.updatedAt : nowIso(),
          messages: (Array.isArray(c.messages) ? c.messages : []).filter(isMessage),
        })),
        MAX_CONVERSATIONS,
      ),
      deletedIds: toList(parsed.deletedIds).slice(0, MAX_DELETED_IDS),
    };
  } catch {
    return empty;
  }
}

/** Persist the state. Best-effort: a full or unavailable store must not break the chat. */
function saveState(storage, state) {
  try {
    if (!storage || typeof storage.setItem !== 'function') return false;
    const payload = {
      version: STORAGE_VERSION,
      conversations: pruneConversations(state && state.conversations, MAX_CONVERSATIONS),
      deletedIds: toList(state && state.deletedIds).slice(0, MAX_DELETED_IDS),
    };
    storage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

/** The conversation to show when the window opens: the most recently touched one. */
function mostRecent(conversations) {
  const list = pruneConversations(conversations, MAX_CONVERSATIONS);
  return list.length ? list[0] : null;
}

const CHAT_STORE_API = {
  STORAGE_KEY,
  STORAGE_VERSION,
  MAX_CONVERSATIONS,
  MAX_MESSAGES,
  TITLE_MAX,
  MAX_DELETED_IDS,
  uid,
  nowIso,
  titleFromText,
  newConversation,
  appendMessage,
  updateMessage,
  deleteConversation,
  conversationRecency,
  addTombstone,
  unionTombstones,
  filterTombstoned,
  adoptSynced,
  pruneConversations,
  loadState,
  saveState,
  mostRecent,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CHAT_STORE_API;
} else if (typeof window !== 'undefined') {
  window.SimpleChatStore = CHAT_STORE_API;
}
