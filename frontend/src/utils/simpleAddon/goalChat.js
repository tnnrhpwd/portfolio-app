/**
 * goalChat.js — the link between a /plans goal and its conversation on /net.
 *
 * Simple is one product with three rooms (💬 Chat · 🎛️ Control · 🎯 Goals) and a
 * goal is the object that travels between them. It is *stored* on /plans,
 * *watched* on /simple — and, with this module, *talked about* on /net in a
 * conversation of its own. Enlisting an agent from a goal therefore hands off to
 * a real chat thread rather than a dead-end page: the thread is seeded with the
 * goal's own words, the run's output lands in it, and the thread's history is
 * what the next instruction is read against — so iterating never means
 * re-typing the goal.
 *
 * The link is by *id*, not by a stored pointer: a goal's conversation id is
 * derived from the goal slug (`goal-<slug>`), so every device and every surface
 * computes the same id with no extra state to sync. That matters because the
 * conversation is itself cloud-synced (see `workspaceApi.mergeCloudConversations`)
 * — a derived id means /plans and /net can find each other's copy without a
 * second, weaker source of truth.
 *
 * Everything here is pure so the rules are unit-testable without mounting
 * `SimpleChat` or `Plans` (see `goalChat.test.js`).
 */

export const GOAL_CONVERSATION_PREFIX = 'goal-';
export const GOAL_CHAT_TITLE_PREFIX = '🎯 ';
export const GOAL_KICKOFF_MESSAGE_ID_PREFIX = 'goal-kickoff-';
export const GOAL_RUN_MESSAGE_ID_PREFIX = 'goal-run-';

const MAX_TITLE_LENGTH = 60;
const MAX_RESULT_CHARS = 4000;

const RUN_STATUS_LABELS = {
  done: 'Done',
  stopped: 'Stopped',
  timeout: 'Timed out',
  failed: 'Failed',
};

function text(value) {
  return String(value ?? '').trim();
}

/**
 * The conversation id for a goal slug. Stable and derived — the same slug
 * always yields the same id on every device, which is what makes the link
 * survive cloud sync with no extra bookkeeping.
 */
export function goalConversationId(slug) {
  const s = text(slug);
  return s ? `${GOAL_CONVERSATION_PREFIX}${s}` : '';
}

/** Inverse of `goalConversationId` — the goal slug behind a conversation id. */
export function goalSlugFromConversationId(id) {
  const s = String(id ?? '');
  if (!s.startsWith(GOAL_CONVERSATION_PREFIX)) return null;
  return s.slice(GOAL_CONVERSATION_PREFIX.length) || null;
}

/** The goal slug a conversation belongs to, or null when it isn't a goal thread. */
export function goalSlugFromConversation(conversation) {
  if (!conversation) return null;
  if (conversation.goalSlug) return text(conversation.goalSlug);
  return goalSlugFromConversationId(conversation.id);
}

/** True when this conversation is a goal's thread. Drives the 🎯 badge in the UI. */
export function isGoalConversation(conversation) {
  return Boolean(goalSlugFromConversation(conversation));
}

/** The conversation-list title for a goal thread (`🎯 <goal title>`). */
export function goalChatTitle(title) {
  const t = text(title) || 'Untitled goal';
  const full = `${GOAL_CHAT_TITLE_PREFIX}${t}`;
  return full.length <= MAX_TITLE_LENGTH ? full : `${full.slice(0, MAX_TITLE_LENGTH - 1)}…`;
}

/**
 * Normalize anything goal-shaped — a /plans card item's `data`, or a raw
 * workspace goal entry — into the small shape the helpers below need.
 */
export function normalizeGoal(goal) {
  const g = goal || {};
  const maxSteps = Number(g.maxSteps);
  return {
    slug: text(g.slug ?? g._id),
    title: text(g.title ?? g.name),
    description: text(g.description ?? g.content),
    successCriteria: text(g.successCriteria),
    constraints: text(g.constraints),
    maxSteps: Number.isFinite(maxSteps) && maxSteps > 0 ? Math.floor(maxSteps) : null,
  };
}

/** Build a goal ref from a raw workspace-store goal entry (what /net fetches). */
export function goalRefFromWorkspaceEntry(entry, fallbackSlug = '') {
  const e = entry || {};
  return normalizeGoal({
    slug: e.slug || fallbackSlug,
    name: e.name,
    content: e.content,
    successCriteria: e.successCriteria,
    constraints: e.constraints,
    maxSteps: e.maxSteps,
  });
}

/**
 * The message that starts a goal's thread — and the instruction the agent is
 * run with. Deliberately written as the *user's* ask, because that is what
 * makes the follow-up turn natural ("now do the same for the screenshots
 * folder") and what the conversation history replays on the next run.
 */
export function buildGoalKickoffMessage(goal) {
  const g = normalizeGoal(goal);
  const lines = [`🎯 Goal: ${g.title || 'Untitled goal'}`];
  if (g.description && g.description !== g.title) lines.push('', g.description);
  if (g.successCriteria) lines.push('', `Success criteria: ${g.successCriteria}`);
  if (g.constraints) lines.push('', `Constraints: ${g.constraints}`);
  if (g.maxSteps) lines.push('', `Step budget: at most ${g.maxSteps} steps.`);
  return lines.join('\n');
}

/** The goal's conversation from a conversation list, or null. */
export function findGoalConversation(conversations, slug) {
  const id = goalConversationId(slug);
  if (!id) return null;
  return (Array.isArray(conversations) ? conversations : [])
    .find((c) => String(c?.id) === id) || null;
}

/**
 * Ensure a goal has a conversation, and (when `enlist`) arm it to run.
 *
 * Pure — returns a new list. Re-enlisting an existing thread never re-appends
 * the goal text (it is already in the history); it only re-arms the run, so the
 * thread reads as a continuing conversation rather than a repeated request.
 *
 * The conversation is created empty: the run seeds it by sending the kickoff as
 * the user's own message, which is what puts it through the normal routing,
 * security, and agent paths instead of a parallel "goal run" code path.
 *
 * @param {Array} conversations - current conversation list
 * @param {object} goal - a goal (workspace entry, /plans item data, or ref)
 * @param {object} [opts]
 * @param {boolean} [opts.enlist] - arm the run (`pendingKickoff` = the message)
 * @param {number}  [opts.now] - injectable clock for tests
 * @returns {{ conversations: Array, conversation: object|null, created: boolean }}
 */
export function ensureGoalConversation(conversations, goal, { enlist = false, now = Date.now() } = {}) {
  const list = Array.isArray(conversations) ? conversations : [];
  const g = normalizeGoal(goal);
  const id = goalConversationId(g.slug);
  if (!id) return { conversations: list, conversation: null, created: false };

  const ts = new Date(now).toISOString();
  const kickoff = buildGoalKickoffMessage(g);
  const existing = list.find((c) => String(c?.id) === id);

  if (existing) {
    const wanted = {
      goalSlug: g.slug,
      // Only fill a missing title — never fight the user's or the LLM's rename.
      title: existing.title || goalChatTitle(g.title),
      // Re-arm only when enlisting; a plain "View agent" hand-off must never
      // clear an enlist the user already asked for.
      ...(enlist && !existing.pendingKickoff ? { pendingKickoff: kickoff } : {}),
    };
    const changed = Object.entries(wanted).some(([k, v]) => existing[k] !== v);
    const conversation = { ...existing, ...wanted, ...(changed ? { updatedAt: ts } : {}) };
    return {
      conversations: list.map((c) => (String(c?.id) === id ? conversation : c)),
      conversation,
      created: false,
    };
  }

  const conversation = {
    id,
    title: goalChatTitle(g.title),
    goalSlug: g.slug,
    pendingKickoff: enlist ? kickoff : false,
    messages: [],
    createdAt: ts,
    updatedAt: ts,
  };
  return { conversations: [conversation, ...list], conversation, created: true };
}

/**
 * Map a desktop-addon agent run into the goal's stored agent state — the same
 * shape `goal-agent/result` persists and /plans renders.
 *
 * Shared with `GoalDetail` so a run started from /net and a run started from
 * the goal page can never disagree about what happened.
 */
export function agentStateFromRun(res) {
  const ts = new Date().toISOString();
  const steps = [];
  const plan = [];

  for (const s of res?.stepLog || []) {
    const label = String(s?.tool || 'step');
    plan.push(label);
    steps.push({
      kind: s?.ok === false ? 'error' : 'tool',
      text: s?.ok === false ? `${label} failed` : label,
      ts,
      meta: { tool: s?.tool, args: s?.args || {}, ok: s?.ok },
    });
    if (s?.result != null && s.result !== '') {
      steps.push({ kind: 'tool-result', text: String(s.result).slice(0, 1000), ts, meta: { tool: s?.tool } });
    }
  }

  if (res?.result) steps.push({ kind: 'result', text: String(res.result).slice(0, 1000), ts });
  if (!res?.result && res?.reason && steps.length === 0) {
    steps.push({ kind: 'error', text: `Stopped: ${res.reason}`, ts });
  }

  const status = res?.status === 'done'
    ? 'done'
    : (res?.status === 'timeout' || res?.status === 'stopped' ? 'stopped' : 'failed');

  return {
    status,
    summary: res?.result || res?.reason || '',
    result: res?.result || '',
    steps,
    plan,
    source: 'addon',
  };
}

/**
 * The kickoff message object seeded into a goal thread when a run is recorded
 * from somewhere other than /net itself (e.g. the goal page's own "Enlist
 * agent", which runs the loop inline and then leaves the trail here).
 *
 * The id is derived from the slug so a re-seed can never produce a duplicate
 * message in the same thread.
 */
export function goalKickoffMessage(goal, now = Date.now()) {
  const g = normalizeGoal(goal);
  return {
    id: `${GOAL_KICKOFF_MESSAGE_ID_PREFIX}${g.slug}`,
    role: 'user',
    content: buildGoalKickoffMessage(g),
    timestamp: new Date(now).toISOString(),
    goalKickoff: true,
  };
}

/**
 * Record an agent run in a goal's thread, creating the thread if needed.
 *
 * This is what keeps the two enlist paths honest: a run started from the goal
 * page (`GoalDetail`) must end up in the same thread as one started from /plans,
 * or "View agent" would mean different things depending on which button the
 * user pressed. Pure — the caller owns persistence.
 *
 * @returns {{ conversations: Array, conversation: object|null }}
 */
export function appendGoalRunToConversation(conversations, goal, res, { now = Date.now() } = {}) {
  const g = normalizeGoal(goal);
  const ensured = ensureGoalConversation(conversations, g);
  if (!ensured.conversation) return { conversations: ensured.conversations, conversation: null };

  const ts = new Date(now).toISOString();
  const runMessage = {
    id: `${GOAL_RUN_MESSAGE_ID_PREFIX}${ts}`,
    role: 'assistant',
    content: formatAgentRunMessage(res),
    timestamp: ts,
    agentRun: { goalSlug: g.slug, status: res?.status || null, steps: res?.steps ?? (res?.stepLog || []).length },
  };

  // A thread must open with the ask, otherwise it reads as an answer to nothing.
  const seeded = ensured.conversation.messages.length === 0
    ? [goalKickoffMessage(g, now)]
    : [];

  const conversation = {
    ...ensured.conversation,
    messages: [...ensured.conversation.messages, ...seeded, runMessage],
    pendingKickoff: false,
    updatedAt: ts,
  };
  return {
    conversations: ensured.conversations.map((c) => (String(c?.id) === conversation.id ? conversation : c)),
    conversation,
  };
}

/** The chat message shown while the agent works a goal (no token stream yet). */
export function goalRunPlaceholder(goalTitle) {
  const t = text(goalTitle);
  return `🤖 **Working on this goal**${t ? ` — ${t}` : ''}…\n\nThis runs on your PC and can take a few minutes.`
    + '\n\nThe steps and the final result will appear here when it finishes.';
}

/** Markdown for a finished agent run, written into the goal's thread. */
export function formatAgentRunMessage(res) {
  const state = agentStateFromRun(res);
  const stepLog = Array.isArray(res?.stepLog) ? res.stepLog : [];
  const out = [
    `🤖 **Agent run** — ${RUN_STATUS_LABELS[state.status] || state.status}`
      + (stepLog.length ? ` · ${stepLog.length} step${stepLog.length === 1 ? '' : 's'}` : ''),
  ];

  if (stepLog.length) {
    out.push('', stepLog.map((s) => `${s?.ok === false ? '❌' : '✅'} \`${s?.tool || 'step'}\``).join('\n'));
  }

  if (state.result) {
    const body = String(state.result).slice(0, MAX_RESULT_CHARS);
    out.push('', '**Result**', '', '```', body, '```');
  } else if (res?.reason) {
    out.push('', `_Stopped: ${res.reason}_`);
  }

  out.push('', '_Continue in this thread to refine the goal — the conversation is what the next run reads._');
  return out.join('\n');
}

/** The message written into the thread when the PC agent can't be reached. */
export function goalRunOfflineMessage() {
  return [
    '**Your PC agent isn\'t reachable** — the goal was saved, but nothing ran.',
    '',
    '1. Make sure the **Simple desktop app** is running on the PC you want this done on.',
    '2. If you\'re on a phone, open the Simple web app on that PC at least once while signed in so it registers with the cloud relay.',
    '',
    'Then press **🤖 Enlist agent** again on /plans — the run will appear in this thread.',
  ].join('\n');
}
