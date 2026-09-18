/**
 * turnControl.js — cancel an in-flight turn, and ask before a risky step.
 *
 * NET_HARNESS_PLAN.md §0 property #3: *the turn is controllable.* Before this,
 * a tool turn was fire-and-forget — the client could stop rendering tokens, but
 * the backend kept making model calls and kept executing tools. Eighteen model
 * calls and a repository commit could happen after the user had walked away.
 *
 * Two capabilities, one handle per run:
 *
 *   cancel            — cooperative, checked at SAFE BOUNDARIES only (between
 *                       rounds and before each tool). A tool is never
 *                       interrupted mid-flight: a half-applied edit is worse
 *                       than a completed one, so the loop finishes the step it
 *                       is on and stops before the next. That is the same
 *                       contract the addon's kill switch uses.
 *   requestApproval   — a promise the turn awaits; the client answers with
 *                       `POST /compress/approve`. Auto-denied on cancel, on
 *                       timeout, or if the user simply never answers.
 *
 * ⚠️ State lives in this process. That is correct for the streaming route (the
 * SSE connection IS the turn, and it is pinned to one instance), but it means a
 * `cancel`/`approve` POST that lands on a DIFFERENT instance cannot find the
 * turn. If this is ever scaled out, these two maps move to DynamoDB — the same
 * conclusion the relay reached for its command queue.
 *
 * The approval is a UX gate, NOT a security boundary. Capability scoping
 * (`toolScopes.js`) is what stops a non-admin from touching the repository; this
 * decides whether the operator wants the agent to take a particular step.
 */

/** How long an unanswered prompt pins a turn before it denies itself. */
const APPROVAL_TIMEOUT_MS = 3 * 60 * 1000;

/** SSE comment interval while waiting, so an idle proxy doesn't drop the stream. */
const HEARTBEAT_MS = 15000;

/** runId → state. */
const turns = new Map();
/** approvalId → { runId, resolve } — global so a POST needs only the id. */
const approvals = new Map();

let approvalSeq = 0;

/**
 * Open a controllable turn.
 * @param {string} runId - the journal's run id (one id for the whole turn)
 * @returns {object} handle: isCancelled / cancelReason / requestApproval / close
 */
function openTurn(runId) {
  if (!runId) throw new Error('openTurn requires a runId');
  const state = {
    runId,
    cancelled: false,
    reason: null,
    pending: new Set(),
    approvedTools: new Set(),
  };
  turns.set(runId, state);

  return {
    runId,
    isCancelled: () => state.cancelled,
    cancelReason: () => state.reason,

    /** Stop this turn. Same effect as `cancelTurn(runId)`, for the owning caller. */
    cancel(reason = 'you stopped it') {
      return cancelTurn(runId, reason);
    },

    /**
     * Ask for permission to run a tool. Resolves `{approved, reason}` — never
     * rejects, because a turn must always be able to continue or stop cleanly.
     *
     * @param {object} args
     * @param {string} args.tool
     * @param {string} [args.question]  shown to the user
     * @param {string[]} [args.options] default `['Approve', 'Deny']`
     * @param {Function} [args.heartbeat] called every HEARTBEAT_MS while pending
     * @returns {{id: string, promise: Promise<{approved: boolean, reason: string}>}}
     */
    requestApproval({ tool, question, options, heartbeat } = {}) {
      // Already allowed once this turn: asking again for the same tool is how a
      // loop of prompts starts (the model commits, then commits again).
      if (state.approvedTools.has(tool)) {
        return { id: null, promise: Promise.resolve({ approved: true, reason: 'approved earlier this turn' }) };
      }
      if (state.cancelled) {
        return { id: null, promise: Promise.resolve({ approved: false, reason: 'the turn was cancelled' }) };
      }

      approvalSeq += 1;
      const id = `ap_${runId}_${approvalSeq}`;

      const promise = new Promise((resolve) => {
        const finish = (approved, reason) => {
          clearTimeout(timer);
          clearInterval(beat);
          approvals.delete(id);
          state.pending.delete(id);
          if (approved) state.approvedTools.add(tool);
          resolve({ approved, reason });
        };

        const timer = setTimeout(
          () => finish(false, 'no answer in time — try again if you still want this'),
          APPROVAL_TIMEOUT_MS,
        );
        const beat = setInterval(() => {
          try { heartbeat?.(); } catch { /* the stream may be gone; the timeout still fires */ }
        }, HEARTBEAT_MS);
        // Do not hold the process open for a prompt.
        if (timer.unref) timer.unref();
        if (beat.unref) beat.unref();

        approvals.set(id, { runId, tool, question, options, finish });
        state.pending.add(id);
      });

      return { id, promise };
    },

    close() {
      for (const id of [...state.pending]) approvals.get(id)?.finish(false, 'the turn ended');
      turns.delete(runId);
    },
  };
}

/**
 * Cancel an in-flight turn by id. Pending approvals are denied immediately so a
 * turn parked on a prompt does not have to wait for its timeout.
 * @returns {{found: boolean, reason?: string}}
 */
function cancelTurn(runId, reason = 'you stopped it') {
  const state = runId ? turns.get(runId) : null;
  if (!state) return { found: false };
  state.cancelled = true;
  state.reason = reason;
  for (const id of [...state.pending]) approvals.get(id)?.finish(false, 'the turn was cancelled');
  return { found: true, reason };
}

/**
 * Answer a pending approval.
 * @returns {boolean} whether the id was still pending (false = already answered or expired)
 */
function resolveApproval(approvalId, approved, reason = '') {
  const entry = approvalId ? approvals.get(approvalId) : null;
  if (!entry) return false;
  entry.finish(!!approved, reason || (approved ? 'approved' : 'denied'));
  return true;
}

/** Observability + test helpers. */
function pendingApprovalCount() { return approvals.size; }
function activeTurnCount() { return turns.size; }
/** Cancel everything and forget it. Used by tests; harmless to call in prod on shutdown. */
function _resetForTests() {
  for (const state of turns.values()) {
    for (const id of [...state.pending]) approvals.get(id)?.finish(false, 'reset');
  }
  turns.clear();
  approvals.clear();
  approvalSeq = 0;
}

module.exports = {
  openTurn,
  cancelTurn,
  resolveApproval,
  pendingApprovalCount,
  activeTurnCount,
  _resetForTests,
  APPROVAL_TIMEOUT_MS,
  HEARTBEAT_MS,
};
