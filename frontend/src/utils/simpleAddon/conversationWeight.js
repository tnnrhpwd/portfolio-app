/**
 * conversationWeight.js — keep a conversation small enough to still SYNC.
 *
 * Cloud sync stores every conversation for a user as ONE row
 * (`csimple_convos_<userId>`), compressing above 100 KB and **rejecting the whole
 * request above 380 KB**. That was already tight; the harness made it tighter,
 * because every tool turn now carries its agent detail on the message:
 *
 *   steps  — one record per tool call, with a clipped args preview and a clipped
 *            result preview (≈300-500 bytes each, up to 16 rounds per turn)
 *   plan   — the checklist the turn published
 *
 * A heavy user's history of tool turns is therefore measured in hundreds of KB,
 * and the failure mode when it crosses the line is the bad one: the save throws,
 * the client logs a `console.warn`, and the user's conversations quietly stop
 * syncing between devices with nothing on screen to say so.
 *
 * So this module answers one question — *is this payload too heavy, and what do we
 * drop first if it is* — and the answer is deliberately the SAME trade-off the
 * backend journal already makes: **the agent trace is a live view, the
 * conversation is the record.** The full record for the last 10 turns lives in the
 * backend run ring (`harness/stepJournal.js`), retrievable independently, so
 * dropping `steps`/`plan` from a synced copy loses a convenience and not evidence.
 *
 * Two mechanisms, in order:
 *
 *   1. **Pre-emptive** — a payload so large that even repeated-key JSON
 *      compression cannot save it gets stripped before it is sent, so a guaranteed
 *      rejection costs no round trip.
 *   2. **Reactive** — anything else is sent as-is, and if the server refuses it,
 *      the caller retries WITHOUT the agent detail. The server's own answer is the
 *      authority on size; guessing its compression ratio here would be a guess, and
 *      a wrong guess either loses detail unnecessarily or keeps failing.
 */

/** The per-message fields that hold the agent trace, and nothing else. */
export const AGENT_DETAIL_KEYS = ['steps', 'plan'];

/**
 * Uncompressed size past which a payload cannot possibly fit.
 *
 * The server compresses first and rejects the COMPRESSED text above 380 KB. This
 * repo's conversation JSON is highly repetitive (the same message keys, over and
 * over), where gzip typically manages better than 4×, so 1.5 MB uncompressed is
 * comfortably past the point where sending it anyway is certain to fail. It is a
 * *lower bound* on hopelessness, deliberately generous: the reactive path is what
 * handles everything below it.
 */
export const PRESUMED_TOO_LARGE_CHARS = 1_500_000;

/**
 * Serialised size of a conversation list.
 *
 * `length` of a JSON string, not bytes: this is only ever compared against a
 * threshold, and JSON of ASCII conversation text is 1 byte per char, so the
 * distinction would not change a single decision.
 */
export function estimateConversationsChars(conversations) {
  if (!Array.isArray(conversations)) return 0;
  try {
    return JSON.stringify(conversations).length;
  } catch {
    // A circular reference would throw here; treating it as "unknown but not
    // obviously huge" keeps the caller on the reactive path rather than crashing
    // a sync that the server may well have accepted.
    return 0;
  }
}

/**
 * The same conversations with the agent trace removed from every message.
 *
 * Everything else is preserved — content, images, actions, timestamps, ids — and
 * the input is never mutated: this produces the payload for a RETRY, so the live
 * in-memory conversation (which is still showing the user their steps) has to come
 * out of it untouched.
 */
export function stripAgentDetail(conversations) {
  if (!Array.isArray(conversations)) return conversations;
  return conversations.map((conversation) => {
    if (!conversation || typeof conversation !== 'object') return conversation;
    if (!Array.isArray(conversation.messages)) return conversation;
    return {
      ...conversation,
      messages: conversation.messages.map((message) => {
        if (!message || typeof message !== 'object') return message;
        if (!AGENT_DETAIL_KEYS.some((key) => key in message)) return message;
        const lean = { ...message };
        for (const key of AGENT_DETAIL_KEYS) delete lean[key];
        return lean;
      }),
    };
  });
}

/** True when this conversation list MUST be stripped before it is worth sending. */
export function isCertainlyTooLarge(conversations, safeChars = PRESUMED_TOO_LARGE_CHARS) {
  return estimateConversationsChars(conversations) > safeChars;
}

/**
 * Decide the payload for a sync attempt.
 *
 * @returns {{conversations: Array, stripped: boolean, chars: number}}
 *   `stripped: true` means the agent detail was already dropped, so a caller that
 *   then gets a size error knows there is nothing left to give up and should
 *   report the failure instead of retrying.
 */
export function prepareConversationsForSync(conversations, { safeChars = PRESUMED_TOO_LARGE_CHARS } = {}) {
  const chars = estimateConversationsChars(conversations);
  if (chars > safeChars) {
    return { conversations: stripAgentDetail(conversations), stripped: true, chars };
  }
  return { conversations, stripped: false, chars };
}

/**
 * Did the server refuse this because it was too big?
 *
 * Matched on the status where one is available (workspaceApi attaches it) and on
 * the message otherwise, because the 413 body is the only other signal and a
 * retry decision must not depend on the exact wording of an error string.
 */
export function isConversationTooLargeError(error) {
  if (!error) return false;
  if (error.status === 413 || error.statusCode === 413) return true;
  return /too large|payload too large|413/i.test(String(error.message || ''));
}

/**
 * Run a sync, and if the server refuses the payload as too large, run it AGAIN
 * without the agent trace.
 *
 * This is the whole policy, kept here rather than inside the chat component for
 * one reason: the component cannot be tested without mounting a very large tree,
 * and this is the part where being wrong loses a user's history or hides a real
 * error. The caller supplies the transport as `merge`.
 *
 * @param {object} args
 * @param {Array} args.conversations
 * @param {Array} [args.deletedIds]
 * @param {(conversations: Array, deletedIds: Array) => Promise<object>} args.merge
 * @returns {Promise<object>} the merge result plus `trimmed` — true when the agent
 *   detail was left out, which the UI must not report as a clean sync
 */
export async function syncWithFallback({ conversations, deletedIds = [], merge }) {
  const prepared = prepareConversationsForSync(conversations);
  try {
    const result = await merge(prepared.conversations, deletedIds);
    return { ...result, trimmed: prepared.stripped };
  } catch (error) {
    // Two ways there is nothing to give up: the detail is already stripped, or this
    // is not a size problem at all. Retrying either would hide a real failure behind
    // a "successful" degraded sync.
    if (prepared.stripped || !isConversationTooLargeError(error)) throw error;
    const result = await merge(stripAgentDetail(conversations), deletedIds);
    return { ...result, trimmed: true };
  }
}
