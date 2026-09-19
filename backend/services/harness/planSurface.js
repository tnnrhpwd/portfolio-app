/**
 * planSurface.js — the PLAN, as distinct from the steps.
 *
 * The journal (P0) answers "what did it do?". This answers "what is it *trying*
 * to do?" — which is the question a user asks after a wrong turn, and the only
 * thing that makes a long agent run correctable mid-flight rather than merely
 * reviewable afterwards. G8 of NET_HARNESS_PLAN.md.
 *
 * One rule shapes everything here: **the plan is the model's own words about its
 * own work, so it must never be able to fail a turn.** A malformed plan is
 * normalised, not rejected — the alternative is a model that loses a whole turn
 * because it wrote `"in progress"` instead of `"in_progress"`. So this module
 * coerces, drops and notes, and always returns a usable plan.
 *
 * `normalisePlan` is pure and total: no throws, no I/O, no clock. That is what
 * lets the tool executor, the SSE emitter and the persisted turn record all agree
 * on one shape without any of them owning validation.
 */

/** The four states a step can be in. `in_progress` is the UI's "you are here". */
const PLAN_STATUSES = Object.freeze(['pending', 'in_progress', 'done', 'blocked']);

/** Bounds. A plan is a summary of intent, not a transcript (the journal is that). */
const MAX_ITEMS = 12;
const MAX_TEXT_CHARS = 200;

/**
 * Status spellings the model actually produces. Accepting these is not sloppiness:
 * a rejected plan teaches the model nothing except that `set_plan` is unreliable,
 * and the point of the tool is to make it *report* its intent.
 */
const STATUS_ALIASES = {
  pending: 'pending',
  todo: 'pending',
  not_started: 'pending',
  in_progress: 'in_progress',
  inprogress: 'in_progress',
  inprogress_: 'in_progress',
  active: 'in_progress',
  current: 'in_progress',
  doing: 'in_progress',
  done: 'done',
  complete: 'done',
  completed: 'done',
  finished: 'done',
  blocked: 'blocked',
  stuck: 'blocked',
  waiting: 'blocked',
};

/** `"In Progress"` / `"in-progress"` / `"IN_PROGRESS"` → `in_progress`. */
function normaliseStatus(raw) {
  const key = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return STATUS_ALIASES[key] || 'pending';
}

/**
 * Coerce whatever the model sent into a plan the rest of the harness can trust.
 *
 * @param {unknown} raw  the tool's `items` argument, or a whole plan object
 * @returns {{items: Array<{id: string, text: string, status: string}>,
 *            counts: Record<string, number>, notes: string[]}}
 *   `notes` explains every correction, so the model is TOLD what it got wrong
 *   rather than silently corrected — a silent fix teaches it nothing and the
 *   mistake repeats next turn.
 */
function normalisePlan(raw) {
  const notes = [];
  const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.items) ? raw.items : null);

  if (!list) {
    return { items: [], counts: emptyCounts(), notes: ['no items were provided'] };
  }
  if (list.length > MAX_ITEMS) {
    notes.push(`only the first ${MAX_ITEMS} steps were kept (${list.length} were sent)`);
  }

  const items = [];
  let dropped = 0;
  for (const entry of list.slice(0, MAX_ITEMS)) {
    const text = String(entry?.text ?? entry?.title ?? '').trim();
    if (!text) { dropped++; continue; }
    items.push({
      id: `p${items.length + 1}`,
      text: text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}…` : text,
      status: normaliseStatus(entry?.status),
    });
  }
  if (dropped) notes.push(`${dropped} step(s) had no text and were dropped`);

  // Exactly one step may be in progress: it is the one the user is watching, and
  // two of them would make the checklist ambiguous about where the agent is. The
  // LATER one is kept — a model that marks two has moved on from the first, and
  // "where am I now" is the question the field answers.
  const inProgress = items.filter((i) => i.status === 'in_progress');
  if (inProgress.length > 1) {
    const keep = inProgress[inProgress.length - 1];
    for (const item of inProgress) {
      if (item === keep) continue;
      item.status = 'pending';
    }
    notes.push(`more than one step was in progress; keeping "${keep.text}" and marking the other(s) pending`);
  }

  if (!items.length) notes.push('no usable steps — the plan is empty');

  return { items, counts: countsFor(items), notes };
}

function emptyCounts() {
  return { pending: 0, in_progress: 0, done: 0, blocked: 0 };
}

function countsFor(items) {
  const counts = emptyCounts();
  for (const item of items) counts[item.status] = (counts[item.status] || 0) + 1;
  return counts;
}

/** Human status, for the checklist the model reads back. */
const STATUS_LABEL = {
  pending: 'pending',
  in_progress: 'in progress',
  done: 'done',
  blocked: 'blocked',
};

/**
 * Render a plan as the tool result.
 *
 * This is the ONLY prompt the model gets about keeping the plan current, so it
 * states both the list and the rule: it is read at the moment the tool is called,
 * which is exactly when the reminder is worth having.
 */
function renderPlan(plan) {
  const counts = plan.counts || countsFor(plan.items || []);
  const total = (plan.items || []).length;
  const bits = [`${total} step${total === 1 ? '' : 's'}`];
  if (counts.in_progress) bits.push(`${counts.in_progress} in progress`);
  if (counts.done) bits.push(`${counts.done} done`);
  if (counts.blocked) bits.push(`${counts.blocked} blocked`);

  const lines = (plan.items || []).map((item, i) => (
    `${i + 1}. [${STATUS_LABEL[item.status] || item.status}] ${item.text}`
  ));

  const parts = [`PLAN VISIBLE TO THE USER (${bits.join(', ')}):`, ...lines];

  if (counts.in_progress === 0 && counts.pending + counts.blocked > 0) {
    // The most likely drift by far: the model finishes a step and forgets to move
    // the marker, so the checklist keeps pointing at work that is already done.
    parts.push('NOTE: nothing is marked in progress, but steps remain. If you are still working, mark the current step in progress with set_plan — otherwise the user cannot tell what you are doing.');
  } else if (counts.in_progress === 1) {
    parts.push(`Keep this current: call set_plan again when "${(plan.items.find((i) => i.status === 'in_progress') || {}).text}" finishes.`);
  }

  if ((plan.notes || []).length) parts.push(`(${plan.notes.join('; ')})`);
  return parts.join('\n');
}

/** Cheap change detector, so the route emits the plan only when it moved. */
function planChanged(a, b) {
  if (a === b) return false;
  if (!a || !b) return true;
  return JSON.stringify(a.items || []) !== JSON.stringify(b.items || []);
}

/** A one-line summary for logs and the turn record. */
function summarisePlan(plan) {
  if (!plan || !plan.items?.length) return null;
  const counts = plan.counts || countsFor(plan.items);
  const current = plan.items.find((i) => i.status === 'in_progress');
  return [
    `${plan.items.length} steps`,
    counts.done ? `${counts.done} done` : null,
    current ? `working on: ${current.text}` : null,
  ].filter(Boolean).join(' · ');
}

module.exports = {
  normalisePlan,
  renderPlan,
  planChanged,
  summarisePlan,
  normaliseStatus,
  countsFor,
  PLAN_STATUSES,
  STATUS_LABEL,
  MAX_ITEMS,
  MAX_TEXT_CHARS,
};
