/**
 * continuity.js — what the LAST turn left behind, for the next one to pick up.
 *
 * The journal (P0) records every turn, and until now nothing read it: it was
 * written-only. This is the first consumer, and the reason is behavioural rather
 * than archival. `/net` sends the model the visible prose of the conversation and
 * NOTHING else — no plans, no steps, no failures — because those live on the
 * assistant's message, not in the transcript. So a genuine, harness-shaped
 * conversation was impossible:
 *
 *   user:  "raise the goal limit"        → plan published, 3 steps, edit + test run
 *   user:  "keep going"                  → the model has never heard of any of it
 *
 * A programming harness does not have that hole: its context window is the
 * session, so "continue" resumes. This closes the hole the cheap way — one compact
 * note describing only what is *unfinished*, rather than replaying the whole
 * journal into every prompt.
 *
 * Three rules decide what earns a place in that note, and all three are about
 * NOISE, because a note that appears on every turn is a note the model learns to
 * ignore:
 *
 *   1. **Only an unfinished plan is news.** A plan with everything `done` is a
 *      completed task, and saying so costs tokens to tell the model nothing.
 *   2. **Only failures and a cancellation are news.** A turn whose steps all
 *      succeeded needs no narration — the user saw it happen.
 *   3. **It is a prompt, not a log.** Two lines, bounded, in the second person:
 *      what is outstanding, and which step failed. Never the steps that worked.
 *
 * Deliberately NOT included: the previous turn's prose (the client already sends
 * that), its cost, or its timings. Those are for the dashboard, not the model.
 */

/** Bounds. This is added to EVERY tool turn's prompt, so it has to stay small. */
const MAX_NOTE_CHARS = 600;
const MAX_PLAN_LINES = 6;

/** A run whose plan still has work in it. `blocked` counts: it is unfinished too. */
const OPEN_STATUSES = ['in_progress', 'pending', 'blocked'];

/** Was the plan left unfinished? */
function hasOpenPlan(run) {
  const items = run?.plan?.items;
  if (!Array.isArray(items) || items.length === 0) return false;
  return items.some((item) => OPEN_STATUSES.includes(item?.status));
}

/** Steps that did not end in a success, as "tool (why)". */
function failedSteps(run) {
  const steps = Array.isArray(run?.steps) ? run.steps : [];
  return steps.filter((s) => s?.status === 'error' || s?.status === 'denied');
}

/**
 * Build the note, or null when there is nothing worth saying.
 *
 * @param {object|null} run  the most recent run record (`stepJournal.readRuns()[0]`)
 * @param {object} [options]
 * @param {number} [options.maxChars]
 * @returns {string|null}
 */
function continuityNote(run, { maxChars = MAX_NOTE_CHARS } = {}) {
  if (!run) return null;

  const open = hasOpenPlan(run);
  const failures = failedSteps(run);
  const cancelled = run.outcome === 'cancelled';
  if (!open && failures.length === 0 && !cancelled) return null;

  const lines = ['\n\nWHERE THE LAST TURN LEFT OFF (you did this — do not ask the user to repeat it):'];

  if (cancelled) {
    // Worth saying because the STOP was the user's, not a failure: without this
    // the model re-plans the same work from scratch or, worse, asks why it stopped.
    lines.push('- The user STOPPED that turn part-way through. Do not resume it unless they ask.');
  }

  if (open) {
    const items = run.plan.items;
    const done = items.filter((i) => i.status === 'done').length;
    const current = items.find((i) => i.status === 'in_progress');
    const remaining = items.filter((i) => OPEN_STATUSES.includes(i.status));
    lines.push(`- Its plan is unfinished (${done}/${items.length} done)${current ? `, and it was working on: ${current.text}` : ''}.`);
    for (const item of remaining.slice(0, MAX_PLAN_LINES)) {
      lines.push(`  · [${item.status}] ${item.text}`);
    }
    if (remaining.length > MAX_PLAN_LINES) {
      lines.push(`  · …and ${remaining.length - MAX_PLAN_LINES} more.`);
    }
    lines.push('- If the user wants to continue, pick up from the step above rather than starting again. If they have moved on, ignore this.');
  }

  if (failures.length) {
    const described = failures.slice(0, 3).map((s) => {
      // The KIND is what matters (see toolOutcome.js): "permission" means asking
      // again is pointless, "invalid-input" means the arguments were the problem.
      const why = s.outcome ? s.outcome : (s.status === 'denied' ? 'permission' : 'error');
      return `${s.tool} (${why})`;
    });
    lines.push(`- Steps that did NOT succeed: ${described.join('; ')}${failures.length > 3 ? ` (+${failures.length - 3} more)` : ''}.`);
    if (failures.some((s) => s.outcome === 'permission' || s.status === 'denied')) {
      // "on your own" is load-bearing: a user CAN legitimately ask for a refused
      // step again — the step list offers a "Try again" action for exactly the
      // refusals a person could answer differently, and that click arrives as an
      // ordinary message ("I'm asking you to" — frontend retryMessage.js). Without
      // the second sentence the model tends to stonewall that request, reading its
      // own earlier "do not retry" as still binding. Kept SHORT on purpose: this
      // note is capped (MAX_NOTE_CHARS) and truncated from the END, so a longer
      // sentence here would risk being sliced mid-word — and would push the
      // unfinished-plan lines out of the part that survives.
      lines.push('  Do not retry a refused step on your own — it needs the user to allow it. If they ask for it, that IS the permission; their PC will prompt again.');
    }
  }

  const note = lines.join('\n');
  return note.length > maxChars ? `${note.slice(0, maxChars)}…` : note;
}

/**
 * The note for a user's recent runs, given `readRuns`' newest-first list.
 *
 * Only the MOST RECENT run is considered. Two turns back is history; the model
 * needs to know what it was doing, not a walk through the session.
 */
function continuityNoteFromRuns(runs, options) {
  if (!Array.isArray(runs) || runs.length === 0) return null;
  return continuityNote(runs[0], options);
}

module.exports = {
  continuityNote,
  continuityNoteFromRuns,
  hasOpenPlan,
  failedSteps,
  MAX_NOTE_CHARS,
  MAX_PLAN_LINES,
  OPEN_STATUSES,
};
