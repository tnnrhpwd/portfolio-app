/**
 * stop-reason.js — why an agent run stopped, in words a user can act on.
 *
 * **The bug this exists for.** A run that ended without a final answer was
 * rendered in the chat as:
 *
 *     🤖 Agent stopped — goal status=done (goal status=done).
 *     🤖 Agent stopped — stalled (stalled).
 *
 * Two failures compound there. The run's `status` and `reason` were both set to
 * the loop's raw internal stop string — literally the same expression — so the
 * message printed the same token twice and read as nonsense. And the token itself
 * is written for a log, not a person: `goal status=done` does not tell the user
 * that NOTHING WAS ATTEMPTED, which is the one thing they need to know.
 *
 * So the loop keeps its precise internal vocabulary (it is what the log needs),
 * and this module is the single place that turns it into an explanation.
 *
 * ⚠️ **The `steps === 0` distinction is the important one.** `goal status=done`
 * with no steps means the agent looked at the goal, found it already terminal, and
 * stopped before doing anything — a request that went nowhere and, if the user did
 * not finish that goal themselves, is a real problem worth reporting as one. The
 * same reason with steps > 0 means the opposite: the work was underway and the
 * goal was closed mid-run, which is a legitimate stop. Both used to produce the
 * identical message.
 */

/** Coarse, stable outcomes. Safe to switch on; never a raw loop string. */
const OUTCOMES = Object.freeze({
  DONE: 'done',
  STALLED: 'stalled',
  MAX_STEPS: 'max-steps',
  TIMEOUT: 'timeout',
  GOAL_ENDED: 'goal-ended',
  STOPPED: 'stopped',
  ERROR: 'error',
});

/** Loop stop reasons look like `goal status=<status>`; pull the status out. */
const GOAL_STATUS_RE = /^goal status=(\w+)$/;

/** …and after the fix in `agent-loop.js`, this one carries its own count. */
const STALLED_RE = /^stalled(?:\s+after\s+(\d+))?/;

/**
 * Classify a raw stop reason into an outcome token.
 *
 * Deliberately tolerant of a reason it has never seen: an unrecognised string is
 * `stopped` with the raw text preserved, never a guess at what it meant.
 */
function classifyStop(reason) {
  const raw = String(reason || '').trim();
  if (!raw) return OUTCOMES.STOPPED;
  if (raw === 'goal-done-sentinel') return OUTCOMES.DONE;
  if (GOAL_STATUS_RE.test(raw)) return OUTCOMES.GOAL_ENDED;
  if (STALLED_RE.test(raw)) return OUTCOMES.STALLED;
  if (raw === 'max-steps-reached') return OUTCOMES.MAX_STEPS;
  if (/timeout/i.test(raw)) return OUTCOMES.TIMEOUT;
  if (/^llm-error|^error/i.test(raw)) return OUTCOMES.ERROR;
  if (/^manual|^user|^stopped/i.test(raw)) return OUTCOMES.STOPPED;
  return OUTCOMES.STOPPED;
}

/** The goal status embedded in a `goal status=X` reason, or null. */
function goalStatusFrom(reason) {
  const m = GOAL_STATUS_RE.exec(String(reason || '').trim());
  return m ? m[1] : null;
}

/**
 * Turn a finished run into `{ outcome, reason }` — a token and a SENTENCE.
 *
 * @param {object} run
 * @param {string} run.stopReason   the loop's raw reason
 * @param {number} [run.steps]      steps actually executed
 * @param {number} [run.maxSteps]   the run's step budget
 * @param {number} [run.stallCount] consecutive no-progress ticks
 * @param {boolean} [run.hadAnswer] whether a final answer was produced
 * @returns {{outcome: string, reason: string}}
 */
function stopReport({ stopReason, steps = 0, maxSteps = null, stallCount = 0, hadAnswer = false } = {}) {
  const outcome = classifyStop(stopReason);
  const n = Number(steps) || 0;

  switch (outcome) {
    case OUTCOMES.DONE:
      return {
        outcome,
        // Only reachable when there is no final answer, since the caller shows the
        // answer instead when there is one.
        reason: hadAnswer
          ? 'the goal was completed.'
          : 'the agent decided the goal was finished, but did not write a summary of what it did.',
      };

    case OUTCOMES.GOAL_ENDED: {
      const status = goalStatusFrom(stopReason) || 'closed';
      if (n === 0) {
        // The important case: nothing was attempted at all.
        return {
          outcome,
          reason: `nothing was attempted — the goal was already marked "${status}" before the agent looked at it, so it stopped immediately. `
            + 'Reopen the goal, or ask again, to run it.',
        };
      }
      const phrasing = {
        done: 'was marked done while the agent was working, so it stopped there',
        paused: 'was paused while the agent was working, so it stopped there',
        blocked: 'is blocked, so the agent stopped there',
        failed: 'was marked failed while the agent was working, so it stopped there',
        missing: 'no longer exists, so the agent stopped there',
      }[status];
      return {
        outcome,
        reason: phrasing
          ? `the goal ${phrasing}.`
          : `the goal closed with status "${status}" while the agent was working, so it stopped there.`,
      };
    }

    case OUTCOMES.STALLED: {
      const fromText = STALLED_RE.exec(String(stopReason || ''))?.[1];
      const ticks = Number(fromText) || Number(stallCount) || null;
      return {
        outcome,
        reason: 'it kept trying without getting anywhere'
          + (ticks ? ` for ${ticks} steps in a row` : '')
          + ' — the same approach was not working — so it stopped rather than repeat itself.',
      };
    }

    case OUTCOMES.MAX_STEPS:
      return {
        outcome,
        reason: `it used its whole budget${maxSteps ? ` of ${maxSteps} steps` : ''} for one run without finishing.`,
      };

    case OUTCOMES.TIMEOUT:
      return { outcome, reason: 'it ran past the time limit for one run and was stopped.' };

    case OUTCOMES.ERROR:
      return { outcome, reason: 'a model call failed, so the agent could not continue.' };

    default:
      // 'manual' / 'user' / anything unrecognised. Echo the raw token rather than
      // asserting a meaning the reason does not have.
      return {
        outcome: OUTCOMES.STOPPED,
        reason: stopReason && /^manual|^user/i.test(String(stopReason))
          ? 'it was stopped before it finished.'
          : `it stopped (${stopReason || 'no reason given'}).`,
      };
  }
}

module.exports = { OUTCOMES, classifyStop, goalStatusFrom, stopReport };
