/**
 * retryMessage.js — the message a "Try again" click sends.
 *
 * **Why a plain chat message and not a re-dispatch endpoint.**
 *
 * The obvious implementation is a `POST …/steps/:id/retry` that re-runs the step.
 * It is the wrong one, for three reasons:
 *
 *   1. **The cloud cannot do it.** A `pc_do` step's arguments are redacted in the
 *      journal by design (`argsRedacted`, `argsPreview: null` for anything private),
 *      so the server does not hold what it would need to re-run.
 *   2. **It would bypass the model.** A refusal is often a signal to *change* the
 *      request — the tool may be gone, the name wrong, the intent stale. Re-running
 *      blindly repeats the mistake that was refused.
 *   3. **It would move the consent.** The decision that matters happens on the PC
 *      (ADR-4). Re-asking through the normal turn keeps it there: the addon prompts
 *      again, and the user can decline again. This button asks; it does not approve.
 *
 * So the click produces an ordinary user turn. The user is the one asking, which is
 * exactly the exception `continuity.js` already describes — a refused step must not
 * be retried "on your own", and this is not on the model's own.
 *
 * **Why the message names the step.** Continuity only knows the MOST RECENT run. A
 * user can scroll back and click the button on a step from ten turns ago, and then
 * the model has nothing in context tying "that" to anything. Naming it closes that
 * gap; without it the button would work in the one case everyone tests and quietly
 * misbehave in the case nobody does.
 *
 * **Why the wording depends on the cause.** "I'll answer the prompt this time" is
 * true after an expiry and false after a decline — the user did answer, and said no.
 * The server decides which causes are re-askable at all (`step.reaskable`); this
 * only decides what to say about one.
 */

/** Longest step descriptor embedded in the message. */
const MAX_LABEL_CHARS = 120;

/**
 * ⚠️ Every phrasing below carries an explicit "I'm asking you to".
 *
 * This is not filler. When a step is refused, TWO instructions telling the model
 * not to retry are already in its context: the taxonomy's `HARNESS: REFUSED — …
 * do not retry it and do not rephrase it`, and continuity's `Do not retry a
 * refused step on your own`. A user clicking a button is easy for a model to read
 * as noise next to those, and the failure looks like a bug in the harness
 * ("I can't retry that — it was refused") rather than a missed hand-off.
 *
 * The counter-phrase is deliberately the same words: continuity refuses a retry
 * "on your own". This message is the user asking, so it says so outright instead
 * of relying on the model to infer whose request outranks which note.
 */
const PHRASING = {
  // Nothing ran and nobody was asked — the prompt simply went unanswered.
  expired: "Retry that step — I'm asking you to. I'll answer the prompt on my PC this time.",
  // The user answered, and changed their mind. Say so rather than pretending
  // their earlier "no" never happened.
  'user-declined': "Retry that step anyway — I'm asking you to. I'll approve it on my PC this time.",
};

const NEUTRAL = "Retry that step — I'm asking you to. Please re-ask my PC for approval.";

/**
 * Build the message for a "Try again" click.
 *
 * @param {object} step  a step record from the journal (needs `reaskable`, `cause`,
 *                       and ideally `label` or `tool`)
 * @returns {string|null} the message to send, or null when there is nothing honest
 *                        to offer — which is the answer for every step that is not
 *                        a re-askable refusal
 */
export function retryMessageFor(step) {
  // Fail closed. `reaskable` is the server's decision (see
  // backend/services/harness/refusalCause.js) and the only signal this file trusts:
  // offering a retry for a policy denial or the kill switch would be a button that
  // promises something the machine has already refused to do.
  if (!step || step.reaskable !== true) return null;

  const body = PHRASING[step.cause] || NEUTRAL;
  const named = describeStep(step);

  return named ? `${body} (The step: ${named})` : body;
}

/**
 * A short, safe description of which step this was.
 *
 * `label` is generated server-side by `toolProgress.describeToolActivity` and is
 * already shown in the step list, so it reveals nothing the user cannot see. Falls
 * back to the tool name; returns null rather than an empty parenthetical.
 *
 * ⚠️ Never read `argsPreview` here. It is null for tools whose arguments are
 * private, and a fallback that reconstructed the description from the arguments
 * would undo a deliberate redaction rule for a cosmetic gain.
 */
export function describeStep(step, maxChars = MAX_LABEL_CHARS) {
  const raw = String(step?.label || step?.tool || '').trim().replace(/\s+/g, ' ');
  if (!raw) return null;
  return raw.length > maxChars ? `${raw.slice(0, maxChars - 1)}…` : raw;
}
