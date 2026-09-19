/**
 * refusalCause.js — the vocabulary of REFUSALS, and what each one means.
 *
 * A refusal is not one thing. The PC's permission gate has six ways to say no, and
 * they need three different responses:
 *
 *   a PERSON said no, or never answered   → worth asking again
 *   a SETTING says no                     → asking again is a guaranteed copy
 *   the prompt itself is broken           → a fault, and nobody was even asked
 *
 * Getting that wrong is not cosmetic. `pc_do` used to infer the cause from the
 * reason TEXT (`/denied|not approved|permission policy/i`), and two of the six
 * branches matched nothing: the emergency kill switch arrived as `Error:` — a
 * deliberate hard stop presented as a crash — and an expired prompt fell through
 * the failure taxonomy to `FATAL`, so the model was literally told
 * `HARNESS: FAILED — this is not retryable … do not repeat it` for a user who had
 * merely stepped away from their desk.
 *
 * ⚠️ **Why this is its own module.** The table has three readers with no common
 * ancestor: `pcTools.js` renders it for the model, `toolOutcome.js` parses the
 * cause out of a result string, and `stepJournal.js` puts `reaskable` on the step
 * record so the UI can offer a retry without re-deriving policy. It must have NO
 * imports of its own — `pcTools` reaches the relay controller through a deferred
 * require precisely because pulling that graph in at load time causes a cycle, so
 * a cause table that dragged it along would reintroduce the problem.
 *
 * The producer of every one of these is the desktop addon
 * (`simple-addon/server/automation/permissions.js`), which is a separate
 * deployable with no shared code. Its `CAUSES` must stay in step with this table;
 * an addon that sends a cause missing here degrades to "unknown", which is
 * deliberately NOT treated as re-askable.
 */

/** The tokens, as they travel on the wire. */
const CAUSES = Object.freeze({
  KILL_SWITCH: 'kill-switch',
  POLICY_DENY: 'policy-deny',
  USER_DECLINED: 'user-declined',
  EXPIRED: 'expired',
  NO_REQUESTER: 'no-requester',
  PROMPT_FAILED: 'prompt-failed',
});

/**
 * The whole vocabulary: what it means, whether a fresh attempt could go
 * differently, and the next move to hand the model.
 *
 * `reaskable` is the field the product actually turns on. When true, asking again
 * is a reasonable thing for the USER to choose — and that is the only sense in
 * which it is used. It is deliberately not called `retryable`: `toolOutcome.js`
 * already uses that word to mean "the harness may repeat this by itself without
 * asking anyone", and the two disagree on the same refusal (`expired` is
 * re-askable and must never be auto-retried, because a `pc_do` drives the user's
 * real machine).
 *
 * `why` and `next` are written for the MODEL, in the order it needs them: what
 * happened, then what to do about it. `next` must never invite a retry of a hard
 * stop — `deny` is documented as a hard stop in `permissions.js`, so offering one
 * would be a lie.
 */
const REFUSAL_CAUSES = Object.freeze({
  [CAUSES.KILL_SWITCH]: {
    reaskable: false,
    why: 'every tool on that PC is blocked by its emergency kill switch, which only the user can clear (Settings → Permissions on their machine)',
    next: 'Do not retry: it will refuse identically until they clear it. Tell them the PC is in emergency-stop and let them decide.',
  },
  [CAUSES.POLICY_DENY]: {
    reaskable: false,
    why: "that PC's permission policy blocks it — a per-tool or per-category rule set to deny",
    next: 'Do not retry the same call: the rule is stored on their machine and will refuse again. Tell them which tool is blocked and that the setting lives on the PC.',
  },
  [CAUSES.USER_DECLINED]: {
    reaskable: true,
    why: 'the user was asked on their PC and declined',
    next: 'Do not ask again on your own — that would be nagging. Say it was declined and wait for them to ask for it; they will be prompted again if they do.',
  },
  [CAUSES.EXPIRED]: {
    reaskable: true,
    why: 'the approval prompt on their PC was never answered, so nothing was run',
    next: 'Nothing on that machine changed. They may simply have been away from it — tell them the prompt went unanswered and let them decide whether to try again. Do not assume the action ran.',
  },
  [CAUSES.NO_REQUESTER]: {
    reaskable: false,
    why: 'that PC has no approval UI wired up at the moment, so the request could not even be put to the user',
    next: 'This is a fault on the PC, not a decision. Report it; a retry will not help until they restart or update the addon.',
  },
  [CAUSES.PROMPT_FAILED]: {
    reaskable: false,
    why: 'the approval prompt itself failed on the PC',
    next: 'This is a fault, not a decision — the user was not asked. Report it; do not present it as something they refused.',
  },
});

/**
 * The wire token written by `simple-addon/server/automation/refusal-wire.js`:
 * `DENIED[<cause>]: <reason>`.
 *
 * Anchored and exact on purpose — the point of a token is to remove guessing, so
 * a reader must not be lenient about what it accepts. A near-miss falls through to
 * the legacy path rather than being half-understood.
 */
const CAUSE_RE = /^DENIED\[([a-z][a-z0-9-]*)\]:\s*([\s\S]*)$/;

/** The same cause, in the readable form the model and the step list see. */
const CAUSE_LABEL_RE = /^Denied \(([a-z][a-z0-9-]*)\):/;

/** True when a fresh attempt could plausibly be answered differently. */
function isReaskableCause(cause) {
  return REFUSAL_CAUSES[cause]?.reaskable === true;
}

module.exports = {
  CAUSES,
  REFUSAL_CAUSES,
  CAUSE_RE,
  CAUSE_LABEL_RE,
  isReaskableCause,
};
