/**
 * turnIntent.js — "would a tool own this turn?" for the cloud /net chat.
 *
 * The failure this exists for (reported 2026-09-18): the cloud turn had no
 * act-vs-answer policy at all. `tool_choice: 'auto'` plus a wall of prose was
 * the entire decision layer, so the model would regularly *narrate* an outcome
 * — "I'll add that goal for you", "here's how you'd change that file" — and
 * stop. The user's words: it "answers when it should act".
 *
 * This is the cloud twin of the addon's `routing-lexicon.js`, which does the
 * same job for Windows actions. It is deliberately NOT the same lexicon and NOT
 * shared with it: the addon's word lists are about PC control verbs, and the
 * client's `messageRouter.js` already owns *routing*. This module answers a
 * different, narrower question — "is one of THIS turn's tools plausibly the
 * thing the user asked for?" — and is used for exactly one purpose:
 *
 *   ⚠️ ADVISORY ONLY. A 'tool' verdict may cause ONE extra model call, with a
 *   note telling the model to call a tool if one fits. It never executes
 *   anything, never blocks anything, never routes anything, and never gates a
 *   capability (see toolScopes.js for that). Being wrong in either direction
 *   costs at most one model call, so the patterns are tuned to be conservative
 *   rather than clever — a missed nudge is free, and a false nudge is one call.
 *
 * Exports:
 *   classifyTurnIntent(text, opts) → { verdict, confidence, reason }
 *   actNudgeFor(toolContext)       → ACT_NUDGE | null   (the loop's decision)
 *   appendSystemNote(messages, note)
 *   DECISION_POLICY                → the system-prompt act-vs-answer procedure
 *   ACT_NUDGE                      → the corrective line
 */

/**
 * The act-vs-answer procedure, injected into the system prompt.
 *
 * Kept HERE, beside the lexicon that backs it up, so the rule the model is told
 * and the recovery the loop performs can't drift into disagreeing about what
 * "the user asked for an outcome" means.
 */
const DECISION_POLICY = [
  'HOW TO READ A REQUEST (do this before every reply):',
  '(1) Decide whether the user wants something DONE or something EXPLAINED.',
  '(2) If they want something DONE and one of your tools can do it, CALL THE TOOL FIRST — then say in one line what you did. Do not describe the action, plan it out loud, or explain how the user could do it themselves: performing it IS the answer. Never ask for permission to do something they have already asked you to do.',
  '(3) If they want something EXPLAINED — a question, an opinion, an explanation, ordinary conversation — just answer in text. Do not call a tool to look busy, and do not call one "to be safe".',
  '(4) Ask a short clarifying question ONLY when the request is genuinely ambiguous, or when acting would be irreversible or destroy something. Otherwise pick the most reasonable reading and act on it.',
  '(5) Never say you did something unless a tool result in THIS turn proves it. No tool result means it did not happen — say what you would need instead, in one line.',
].join(' ');

/**
 * Appended to the system prompt for one retry when a 'tool' turn came back as
 * prose. Phrased as a second chance rather than an order, because the verdict
 * is a heuristic: the model is allowed to conclude that no tool fits.
 */
const ACT_NUDGE = '\n\nYOU ANSWERED WITHOUT ACTING: the user asked for an outcome, and you replied with prose and no tool call. If any of your tools can accomplish this request, call it NOW — do not describe it, and do not ask permission for something the user already asked for. If genuinely no tool fits, reply in plain text saying so and why. Do not repeat your previous reply.';

/** Social shapes that are never a request for an outcome. */
const SOCIAL_RE = /^\s*(?:hi|hey|hello|yo|sup|thanks|thank you|thx|ty|ta|cheers|good\s+(?:morning|evening|afternoon)|ok|okay|cool|nice|lol|haha|bye|goodbye|gm|gn)\b[\s!.?]*$/i;

/**
 * Patterns that mean "a tool owns this turn", most specific first.
 * `strong: 0.9` = almost certainly a tool request; `0.7` = likely.
 *
 * Order matters only for which reason is reported, not for the verdict.
 */
const TOOL_PATTERNS = Object.freeze([
  // ── Goals (save_goal / save_goals / get_my_goals) ──
  // The word alone is enough: in a chat that has goal tooling, "goal" is
  // essentially never incidental, and the recovery is cheap. The prompt's
  // hard rule (only save goals the user unambiguously stated) still governs
  // what actually gets written.
  { reason: 'goals', confidence: 0.9, re: /\bgoals?\b/i },

  // ── Notes & memory (save_note / update_memory / get_my_notes) ──
  { reason: 'notes', confidence: 0.9, re: /\b(?:remember|memorize|don'?t forget|make a note|save a note|note that|note down|take a note|keep in mind|jot (?:this|that) down)\b/i },
  { reason: 'notes', confidence: 0.8, re: /\b(?:my notes|saved notes|what (?:did|have) i (?:save|saved|store|stored))\b/i },

  // ── Image generation (generate_image) ──
  // Same shape as the client's cloud-only detector: a make-verb AND a visual
  // noun, so "make a plan" is not an image request.
  { reason: 'image', confidence: 0.9, re: /\b(?:generate|create|draw|render|imagine|design|make|produce|paint)\b[^.?!]{0,40}\b(?:image|picture|photo|artwork|illustration|logo|icon|avatar|wallpaper|drawing|portrait|sketch)\b/i },

  // ── Arithmetic (calculate) ──
  { reason: 'math', confidence: 0.9, re: /^\s*(?:calculate|compute)\b/i },
  { reason: 'math', confidence: 0.8, re: /^\s*[-+]?\d[\d\s+\-*/().^%]*[+\-*/^%][\d\s+\-*/().^%]*\s*[?=]?\s*$/ },
  { reason: 'math', confidence: 0.8, re: /^\s*what(?:'s| is)\s+[-+]?\d[\d\s+\-*/().^%]*[+\-*/^%][\d\s+\-*/().^%]*\s*\??\s*$/i },

  // ── Date & time (get_current_datetime) ──
  { reason: 'datetime', confidence: 0.9, re: /\b(?:what|what'?s|which)\s+(?:time|date|day)\b|\btoday'?s date\b|\bcurrent (?:time|date)\b/i },

  // ── Support tickets (submit_support_ticket) ──
  { reason: 'support', confidence: 0.9, re: /\b(?:report|file|submit|raise|open)\b[^.?!]{0,20}\b(?:bug|issue|ticket|problem|feature request)\b/i },
  { reason: 'support', confidence: 0.9, re: /\b(?:bug report|feature request|request a feature|suggest a feature)\b/i },
  { reason: 'support', confidence: 0.7, re: /\b(?:is|it'?s|something'?s|this is)\s+(?:broken|not working)\b|\bdoes(?:n'?t| not|nt) work\b|\bnot working (?:for me|anymore)\b/i },

  // ── Action logging (log_action) ──
  { reason: 'action-log', confidence: 0.8, re: /\b(?:log|record|track)\s+(?:that|this|it|my|the)\b/i },

  // ── Conversation summary (summarize_conversation) ──
  { reason: 'summarize', confidence: 0.8, re: /\b(?:summari[sz]e|recap)\b[^.?!]{0,30}\b(?:conversation|chat|thread|discussion|this|that|we)\b/i },

  // ── Web search (web_search_suggestion) ──
  { reason: 'web-search', confidence: 0.9, re: /\b(?:search|look\s+up|google|find)\b[^.?!]{0,20}\b(?:web|internet|online)\b/i },
  { reason: 'web-search', confidence: 0.7, re: /\b(?:latest|current|today'?s)\s+(?:news|price|prices|weather|score|scores|stock)\b/i },
]);

/**
 * Repository / site-source work. Only meaningful for a context that can
 * actually use `repo_*` tools, so `classifyTurnIntent` takes the capability as
 * an option — nudging a non-admin toward repo tools it was never offered would
 * guarantee a wasted call and a confusing reply.
 */
const REPO_VOCAB_RE = /\b(?:repo|repository|codebase|source\s+code|pull\s+request)\b|\bgit\s+(?:commit|push|status|diff|checkout|branch|merge)\b|\b(?:commit|push)\s+(?:my|the|these)\s+changes\b/i;
const SITE_TARGET_RE = /\b(?:this|the|my|our|its)\s+(?:web\s?site|web\s?app|webapp|front\s?end|back\s?end|codebase|code\s+base)\b/i;
const SOURCE_CHANGE_VERB_RE = /\b(?:increase|decrease|raise|lower|shorten|lengthen|extend|expand|limit|cap|fix|change|update|adjust|improve|remove|delete|add|rename|rewrite|refactor|resize|restyle|redesign|enable|disable|support|implement|edit|tweak|bump|commit|push|deploy)\b/i;

/** Two or fewer words is a reply to something, not a fresh request. */
function isTooShortToNudge(text) {
  return text.split(/\s+/).filter(Boolean).length <= 2
    // …unless it is one of the shapes that is meaningful at that length.
    && !/^\s*(?:calculate\b|push\b|commit\b)/i.test(text);
}

/**
 * Would a tool own this turn?
 *
 * @param {string} text               the user's message for this turn
 * @param {object} [opts]
 * @param {boolean} [opts.hasRepoCapability]  may this context use repo_* tools?
 * @returns {{verdict:'tool'|'chat'|'ambiguous', confidence:number, reason:string}}
 */
function classifyTurnIntent(text, opts = {}) {
  const raw = typeof text === 'string' ? text : '';
  const trimmed = raw.trim();

  if (!trimmed) return { verdict: 'ambiguous', confidence: 0, reason: 'empty' };
  if (SOCIAL_RE.test(trimmed)) return { verdict: 'chat', confidence: 0.95, reason: 'social' };
  if (isTooShortToNudge(trimmed)) return { verdict: 'ambiguous', confidence: 0.5, reason: 'too-short' };

  if (opts.hasRepoCapability) {
    if (REPO_VOCAB_RE.test(trimmed)) return { verdict: 'tool', confidence: 0.9, reason: 'repo' };
    if (SITE_TARGET_RE.test(trimmed) && SOURCE_CHANGE_VERB_RE.test(trimmed)) {
      return { verdict: 'tool', confidence: 0.85, reason: 'site-source' };
    }
  }

  for (const pattern of TOOL_PATTERNS) {
    if (pattern.re.test(trimmed)) {
      return { verdict: 'tool', confidence: pattern.confidence, reason: pattern.reason };
    }
  }

  return { verdict: 'ambiguous', confidence: 0.4, reason: 'no-signal' };
}

/**
 * The loop's one question: should this turn be retried because the model
 * answered without acting? Returns the note to append, or null.
 *
 * Only called when the turn used NO tools and produced no tool call.
 */
function actNudgeFor(toolContext) {
  const text = String(toolContext?.userMessage || '').trim();
  if (!text) return null;
  const hasRepoCapability = Array.isArray(toolContext?.capabilities)
    && toolContext.capabilities.includes('repo:read');
  const { verdict } = classifyTurnIntent(text, { hasRepoCapability });
  return verdict === 'tool' ? ACT_NUDGE : null;
}

/**
 * Append a note to the request's system prompt.
 *
 * Appends to the EXISTING system message rather than pushing a second one, so
 * the note is always in the system prompt on every provider. The loop already
 * uses this shape for TOOL_LIMIT_NOTICE; Bedrock folds any `system` message
 * into its `system` field (bedrockService.js), but the OpenAI-style providers
 * would see a late system message as an ordinary turn.
 */
function appendSystemNote(messages, note) {
  if (!Array.isArray(messages) || !note) return false;
  const systemMessage = messages.find((m) => m?.role === 'system');
  if (!systemMessage) return false;
  systemMessage.content += note;
  return true;
}

module.exports = {
  DECISION_POLICY,
  ACT_NUDGE,
  classifyTurnIntent,
  actNudgeFor,
  appendSystemNote,
  // exported for tests
  TOOL_PATTERNS,
};
