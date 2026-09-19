/**
 * contextBudget.js — keep a turn's context affordable, and keep it LEGAL.
 *
 * G7 of NET_HARNESS_PLAN.md: when a conversation grew past 30 messages,
 * `compressConversationHistory()` chopped every middle message to 150 characters.
 * Two things were wrong with that:
 *
 *   1. **It counted messages, not size.** A turn that ran 6 tool rounds is ~14
 *      small messages; a turn that read a 40 KB file is ONE huge one. The count
 *      says nothing about what the request costs, and the trigger fired long
 *      after the request was already expensive.
 *   2. **It destroyed the wrong thing.** A tool result is usually the single
 *      largest item AND the only record of what actually happened — "Error: test
 *      failed" is worth more than three paragraphs of the model's own prose. The
 *      old code truncated both kinds of message identically, on a first-in
 *      first-out basis, so the oldest tool evidence (the thing that justifies
 *      the next step) went first while chatter survived.
 *
 * This module does the opposite, in order of least loss:
 *
 *   phase 1 — THIN an old tool result: keep the message, keep its id, keep the
 *             first line ("Error: …", "PASSED", the diff header) and drop the
 *             bulk. The model still knows what happened; it just can't re-read
 *             the whole file it already read.
 *   phase 2 — DROP an old tool step entirely: the assistant's `tool_calls`
 *             message and its results go TOGETHER, replaced by one line naming
 *             what was used. Never one without the other.
 *   then    — report whatever is still over budget and STOP.
 *
 * **The invariant that matters:** in an OpenAI-shaped history every
 * `assistant.tool_calls` entry must be followed by a `role:'tool'` message for
 * each call id before the next assistant message. Breaking that makes the
 * request a hard provider error, not a degradation — so nothing here ever
 * removes one half of a pair, and a pair with a missing result is left alone
 * rather than half-removed. That is also why phase 2 is a *replacement*, not a
 * filter: a filter can leave an orphan.
 *
 * This module never touches what it cannot safely touch:
 *   - `system` messages are never removed (the harness prompt, the tools list).
 *   - the LAST user message is never removed or rewritten — it is what the turn
 *     is about.
 *   - the newest results are never thinned (the model is mid-reasoning on them).
 *
 * When those rules leave the request over budget, the answer is not to mangle
 * the user's own message — it is to end the turn gracefully (`TOOL_LIMIT_NOTICE`
 * in `toolLoop.js`) and tell the user, which is why `compactMessages` reports
 * `overBudget` instead of forcing the issue.
 */

/** Characters per token for the cheap estimate. English prose is ~4; code is closer to 3. */
const CHARS_PER_TOKEN = 4;

/** How many of the newest tool results are never thinned. */
const KEEP_RECENT_RESULTS = 3;

/** Length of the first line kept from a thinned result. */
const HEADLINE_CHARS = 160;

/** Marks a result this module already thinned, so a second pass is a no-op. */
const THIN_MARK = '[thinned]';

/**
 * Cheap token estimate. Deliberately NOT a real tokenizer: it is used to decide
 * "is this request getting expensive", and being 10% off never changes that
 * answer — while pulling in a tokenizer would add a dependency and milliseconds
 * to every round for a number nothing else uses.
 */
function estimateTokens(text) {
  if (text == null) return 0;
  const str = typeof text === 'string' ? text : JSON.stringify(text);
  return Math.ceil((str || '').length / CHARS_PER_TOKEN);
}

/** Characters in one message, counting both its prose and its tool arguments. */
function messageChars(message) {
  if (!message) return 0;
  let total = 0;
  if (typeof message.content === 'string') {
    total += message.content.length;
  } else if (Array.isArray(message.content)) {
    total += JSON.stringify(message.content).length;
  }
  if (Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls) {
      total += (call?.function?.name || '').length;
      const args = call?.function?.arguments;
      total += typeof args === 'string' ? args.length : (args ? JSON.stringify(args).length : 0);
    }
  }
  return total;
}

/** Total characters across a history. */
function totalChars(messages = []) {
  return messages.reduce((sum, m) => sum + messageChars(m), 0);
}

/** True when the history is past the character budget. */
function overBudget(messages, maxChars) {
  if (!Number.isFinite(maxChars) || maxChars <= 0) return false;
  return totalChars(messages) > maxChars;
}

/** A one-line stand-in for a result: its first line, clipped, plus what was lost. */
function headlineFor(result) {
  const str = typeof result === 'string' ? result : String(result ?? '');
  const firstLine = (str.split('\n')[0] || '').trim();
  const clipped = firstLine.length > HEADLINE_CHARS
    ? `${firstLine.slice(0, HEADLINE_CHARS)}…`
    : firstLine;
  const lost = str.length - firstLine.length;
  const suffix = lost > 0 ? ` [+${lost} chars omitted]` : '';
  return `${clipped}${suffix}`;
}

/** Has this result already been thinned? */
const isThinned = (message) =>
  typeof message?.content === 'string' && message.content.startsWith(THIN_MARK);

/** Rewrite an old tool result down to its headline. Mutates the message. */
function thinToolResult(message) {
  const label = message.name ? `${message.name} ` : '';
  message.content = `${THIN_MARK}${label}returned ${messageChars(message)} chars: ${headlineFor(message.content)}`;
}

/**
 * Remove ONE old tool step (the assistant's call message plus every result that
 * answers it) and append the tool names to `used`.
 *
 * Returns false when no complete, safe pair exists. A pair is refused when:
 *   - a call id has no matching `role:'tool'` message (already inconsistent —
 *     removing it would not fix that),
 *   - it is the first message (the history must not start with a result), or
 *   - removing it would leave fewer than two messages.
 */
function dropOldestToolStep(messages, used) {
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const calls = message?.role === 'assistant' ? message.tool_calls : null;
    if (!Array.isArray(calls) || calls.length === 0) continue;
    if (i === 0) continue;

    const pending = new Set(calls.map((c) => c.id));
    let end = i + 1;
    while (end < messages.length && messages[end]?.role === 'tool') {
      pending.delete(messages[end].tool_call_id);
      end++;
    }
    if (pending.size > 0) continue; // incomplete pair — leave it alone
    if (messages.length - (end - i) < 2) continue;

    for (const call of calls) {
      const name = call?.function?.name;
      if (name) used.push(name);
    }
    messages.splice(i, end - i);
    return true;
  }
  return false;
}

/**
 * Bring a history under a character budget, least-lossy change first.
 *
 * @param {object[]} messages  OpenAI-shaped history. Mutated in place — the
 *                             providers require it, and callers hold slices.
 * @param {object} [options]
 * @param {number} [options.maxChars]     budget; `<= 0` / missing disables it.
 * @param {number} [options.keepRecent]   newest results left intact (default 3).
 * @returns {{changed: boolean, omittedResults: number, droppedSteps: number,
 *            droppedTools: string[], overBudget: boolean, chars: number}}
 */
function compactMessages(messages = [], options = {}) {
  const { maxChars, keepRecent = KEEP_RECENT_RESULTS } = options;
  const summary = {
    changed: false,
    omittedResults: 0,
    droppedSteps: 0,
    droppedTools: [],
    overBudget: false,
    chars: totalChars(messages),
  };
  if (!Array.isArray(messages) || messages.length === 0) return summary;
  if (!Number.isFinite(maxChars) || maxChars <= 0) return summary;

  // ── phase 1: thin old tool results, newest `keepRecent` untouched ──────────
  const toolIndexes = [];
  messages.forEach((m, i) => { if (m?.role === 'tool') toolIndexes.push(i); });
  const protectedIndexes = new Set(toolIndexes.slice(-keepRecent));

  for (const i of toolIndexes) {
    if (!overBudget(messages, maxChars)) break;
    if (protectedIndexes.has(i)) continue;
    const message = messages[i];
    if (isThinned(message)) continue;
    thinToolResult(message);
    summary.omittedResults++;
    summary.changed = true;
  }

  // ── phase 2: drop old tool steps whole, oldest first ──────────────────────
  while (overBudget(messages, maxChars)) {
    if (!dropOldestToolStep(messages, summary.droppedTools)) break;
    summary.droppedSteps++;
    summary.changed = true;
  }

  // Phase 2 leaves one note per dropped step's worth of evidence; add it once,
  // where a `system` message is legal and cannot orphan a pair.
  if (summary.droppedSteps > 0) {
    const names = [...new Set(summary.droppedTools)];
    messages.push({
      role: 'system',
      content: `[CONTEXT TRIMMED — ${summary.droppedSteps} earlier tool step(s) removed to fit the turn's budget: ${names.join(', ') || 'unknown'}. Their results are gone; re-run a tool if you need one again.]`,
    });
  }

  summary.chars = totalChars(messages);
  summary.overBudget = overBudget(messages, maxChars);
  return summary;
}

/**
 * A per-turn budget expressed in characters.
 *
 * The default is ~200K characters ≈ 50K tokens of input, which leaves the whole
 * output budget and a long tool history inside a 200K-token window without ever
 * being the thing that fails a turn. It is deliberately generous: this is a
 * backstop against runaway growth, not a cost-optimisation knob. Override with
 * `NET_CONTEXT_MAX_CHARS`.
 */
const DEFAULT_MAX_CONTEXT_CHARS = 200_000;

function maxContextChars() {
  const raw = Number(process.env.NET_CONTEXT_MAX_CHARS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_CONTEXT_CHARS;
}

module.exports = {
  compactMessages,
  estimateTokens,
  messageChars,
  totalChars,
  overBudget,
  headlineFor,
  maxContextChars,
  DEFAULT_MAX_CONTEXT_CHARS,
  CHARS_PER_TOKEN,
  KEEP_RECENT_RESULTS,
  THIN_MARK,
};
