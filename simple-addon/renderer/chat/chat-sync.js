/**
 * chat-sync.js — keep the addon's conversation payload small enough to still SYNC.
 *
 * The cloud keeps every conversation for a user as ONE row
 * (`csimple_convos_<userId>`), compressing above 100 KB and **rejecting the whole
 * request above 380 KB** (compressed). The addon's chat adds to that weight in a way
 * `/net` does not: every assistant turn can carry its tool rows
 * (`steps` — one record per tool call, with a clipped result preview, and a turn can
 * have dozens), and the addon is the surface where the *most* tool-heavy turns
 * happen.
 *
 * The failure mode when it crosses the line is the bad one: the save throws, nobody
 * retries, and the user's conversations quietly stop syncing between devices with
 * nothing on screen to say so.
 *
 * So this module answers one question — *is this payload too heavy, and what do we
 * drop first if it is* — with the SAME trade-off the website's
 * `frontend/src/utils/simpleAddon/conversationWeight.js` already makes:
 * **the agent trace is a live view, the conversation is the record.** The full record
 * of the last turns lives in the addon's own log and history, so dropping `steps`
 * from a *synced copy* loses a convenience, not evidence.
 *
 * Two mechanisms, in order:
 *
 *   1. **Pre-emptive** — a payload so large that even compression cannot save it is
 *      stripped before it is sent, so a guaranteed rejection costs no round trip.
 *   2. **Reactive** — anything else is sent as-is, and if the server refuses it, the
 *      caller retries WITHOUT the agent detail. The server's own answer is the
 *      authority on size; guessing its compression ratio here would be a guess, and a
 *      wrong guess either loses detail unnecessarily or keeps failing.
 *
 * ⚠️ This is a MIRROR of the website's module, and `chat-sync.test.js` reads that file
 * and asserts the two still agree on the dropped keys and the threshold — the addon
 * cannot import it (ES module vs. a `file://` classic script). A change on one side
 * must be made on both, and the test names which one drifted.
 *
 * Exposed as `window.SimpleChatSync` in a renderer and as `module.exports` under Node.
 */

'use strict';

/** The per-message fields that hold the agent trace, and nothing else. */
const SYNC_AGENT_DETAIL_KEYS = ['steps', 'plan'];

/**
 * Uncompressed size past which a payload cannot possibly fit.
 *
 * The server compresses first and rejects the COMPRESSED text above 380 KB. This
 * repo's conversation JSON is highly repetitive (the same message keys, over and
 * over), where gzip typically manages better than 4×, so 1.5 MB uncompressed is
 * comfortably past the point where sending it anyway is certain to fail. It is a
 * *lower bound* on hopelessness, deliberately generous: the reactive path handles
 * everything below it.
 */
const SYNC_PRESUMED_TOO_LARGE_CHARS = 1_500_000;

/**
 * Does this device have anything the cloud copy has not got?
 *
 * **Why this exists.** The very first draft merged on every open and on every poll,
 * which meant WRITING the whole cloud row to say "nothing new" — and this row can be
 * hundreds of KB, so that is not a rounding error (DynamoDB bills per write, and the
 * addon would pay it every 30 seconds and on every window open). Worse, a boot-time
 * merge PUSHES first: the addon's fresh empty "New chat" went up before the pull, so
 * the cloud was written on the strength of nothing at all.
 *
 * So the decision is inverted: read the cloud copy first, and only merge when there is
 * a reason. The reasons are exactly three, and each is a thing the cloud cannot know:
 *
 *   1. a conversation we have (with messages) that the cloud does not have at all;
 *   2. a conversation where we hold MORE messages than the cloud — i.e. turns that
 *      happened here and were never sent;
 *   3. a tombstone the cloud has not recorded yet.
 *
 * ⚠️ Empty conversations are deliberately not a reason: the server filters them out of
 * its own store (they used to accumulate, one per device's placeholder), so pushing one
 * changes nothing and only costs a write.
 *
 * ⚠️ `updatedAt` is compared with a tolerance because a just-merged conversation comes
 * back as the server's reconstruction of the same instant, and a device whose clock is
 * milliseconds ahead would otherwise re-push on every poll forever.
 */
function pendingUpload(local, remote, localDeletedIds, remoteDeletedIds) {
  const TOLERANCE_MS = 1000;
  const remoteById = new Map();
  for (const c of (Array.isArray(remote) ? remote : [])) {
    if (c && c.id !== undefined && c.id !== null) remoteById.set(String(c.id), c);
  }

  for (const c of (Array.isArray(local) ? local : [])) {
    if (!c || c.id === undefined || c.id === null) continue;
    const mine = Array.isArray(c.messages) ? c.messages.length : 0;
    if (mine === 0) continue;
    const theirs = remoteById.get(String(c.id));
    if (!theirs) return true;
    const theirCount = Array.isArray(theirs.messages) ? theirs.messages.length : 0;
    if (mine > theirCount) return true;
    const oursAt = Date.parse(c.updatedAt || '');
    const theirsAt = Date.parse(theirs.updatedAt || '');
    if (!Number.isNaN(oursAt) && (Number.isNaN(theirsAt) || oursAt > theirsAt + TOLERANCE_MS)) return true;
  }

  const knownDead = new Set((Array.isArray(remoteDeletedIds) ? remoteDeletedIds : []).map(String));
  for (const id of (Array.isArray(localDeletedIds) ? localDeletedIds : [])) {
    // Junk ids are skipped for the same reason `chat-store.addTombstone` refuses to
    // record them: a tombstone for nothing is not evidence of anything, and treating it
    // as one would make every poll try to write.
    if (id === undefined || id === null || String(id) === '') continue;
    if (!knownDead.has(String(id))) return true;
  }
  return false;
}

/** Serialised size of a conversation list. `length` of a JSON string, not bytes. */
function estimateConversationsChars(conversations) {
  if (!Array.isArray(conversations)) return 0;
  try {
    return JSON.stringify(conversations).length;
  } catch {
    // A circular reference throws here; treating it as "unknown but not obviously
    // huge" keeps the caller on the reactive path rather than crashing a sync the
    // server may well have accepted.
    return 0;
  }
}

/**
 * The same conversations with the agent trace removed from every message.
 *
 * Everything else is preserved — content, ids, timestamps, the addon's own `kind`
 * and `goalSlug` — and the input is NEVER mutated: this produces the payload for a
 * retry, so the live in-memory conversation (still showing the user their steps) has
 * to come out of it untouched.
 */
function stripAgentDetail(conversations) {
  if (!Array.isArray(conversations)) return conversations;
  return conversations.map((conversation) => {
    if (!conversation || typeof conversation !== 'object') return conversation;
    if (!Array.isArray(conversation.messages)) return conversation;
    return {
      ...conversation,
      messages: conversation.messages.map((message) => {
        if (!message || typeof message !== 'object') return message;
        if (!SYNC_AGENT_DETAIL_KEYS.some((key) => key in message)) return message;
        const lean = { ...message };
        for (const key of SYNC_AGENT_DETAIL_KEYS) delete lean[key];
        return lean;
      }),
    };
  });
}

/** True when this conversation list MUST be stripped before it is worth sending. */
function isCertainlyTooLarge(conversations, safeChars) {
  const limit = Number.isFinite(safeChars) ? safeChars : SYNC_PRESUMED_TOO_LARGE_CHARS;
  return estimateConversationsChars(conversations) > limit;
}

/**
 * Decide the payload for a sync attempt.
 *
 * @returns {{conversations: Array, stripped: boolean, chars: number}}
 *   `stripped: true` means the agent detail was already dropped, so a caller that
 *   then gets a size error knows there is nothing left to give up and should report
 *   the failure instead of retrying.
 */
function prepareConversationsForSync(conversations, opts) {
  const safeChars = Number.isFinite(opts && opts.safeChars) ? opts.safeChars : SYNC_PRESUMED_TOO_LARGE_CHARS;
  const chars = estimateConversationsChars(conversations);
  if (chars > safeChars) {
    return { conversations: stripAgentDetail(conversations), stripped: true, chars };
  }
  return { conversations, stripped: false, chars };
}

/**
 * Did the server refuse this because it was too big?
 *
 * Matched on the value where one is available (the addon's proxy attaches it) and on
 * a 413-shaped token otherwise, because the body is the only other signal and a retry
 * decision must not depend on the exact wording of an error string.
 */
function isConversationTooLargeError(error) {
  if (!error) return false;
  if (error.status === 413 || error.statusCode === 413) return true;
  return /too large|payload too large|413/i.test(String(error.message || ''));
}

/**
 * Run a sync, and if the server refuses the payload as too large, run it AGAIN
 * without the agent trace.
 *
 * The whole policy lives here rather than inside the chat window for one reason: this
 * is the part where being wrong loses a user's history or hides a real error, and it
 * is testable without a browser. The caller supplies the transport as `merge`.
 *
 * ⚠️ Two ways there is nothing to give up: the detail is already stripped, or this is
 * not a size problem at all. Retrying either would hide a real failure behind a
 * "successful" degraded sync.
 *
 * @param {object} args
 * @param {Array} args.conversations
 * @param {Array} [args.deletedIds]
 * @param {(conversations: Array, deletedIds: Array) => Promise<object>} args.merge
 * @returns {Promise<object>} the merge result plus `trimmed` — true when the agent
 *   detail was left out, which the UI must not report as a clean sync
 */
async function syncWithFallback(args) {
  const conversations = (args && args.conversations) || [];
  const deletedIds = (args && args.deletedIds) || [];
  const merge = args && args.merge;
  if (typeof merge !== 'function') throw new Error('syncWithFallback requires a merge transport');

  const prepared = prepareConversationsForSync(conversations);
  try {
    const result = await merge(prepared.conversations, deletedIds);
    return { ...result, trimmed: prepared.stripped };
  } catch (error) {
    if (prepared.stripped || !isConversationTooLargeError(error)) throw error;
    const result = await merge(stripAgentDetail(conversations), deletedIds);
    return { ...result, trimmed: true };
  }
}

const CHAT_SYNC_API = {
  SYNC_AGENT_DETAIL_KEYS,
  SYNC_PRESUMED_TOO_LARGE_CHARS,
  pendingUpload,
  estimateConversationsChars,
  stripAgentDetail,
  isCertainlyTooLarge,
  prepareConversationsForSync,
  isConversationTooLargeError,
  syncWithFallback,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CHAT_SYNC_API;
} else if (typeof window !== 'undefined') {
  window.SimpleChatSync = CHAT_SYNC_API;
}
