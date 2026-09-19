/**
 * The wire form of a refusal, for the addon → cloud relay.
 *
 * **Why a token at all.** `permissions.js` now returns a machine-readable
 * `cause`, but almost nothing between here and the cloud can carry a field: the
 * cloud relay's transport is a string by construction — the handler throws, the
 * relay POSTs `{ error: err.message }`, the backend stores that string on the
 * result item and hands it back verbatim (`awaitCommandResult`). Every hop is
 * `String`. So the cause has to ride INSIDE the message or it is lost.
 *
 * It was lost, and the cloud guessed instead. `pcTools.pc_do` classified a
 * refusal with `/denied|not approved|permission policy/i` against the reason
 * text, which is wrong in both directions: the kill switch and an expired prompt
 * matched none of those patterns, so a hard stop and a two-minute absence both
 * reached the model as `Error:` faults — the expired one complete with a
 * `HARNESS: FAILED — not retryable` instruction telling the model to give up on
 * a step the user could simply be asked about again.
 *
 * **Why a token rather than better prose matching.** Wording is the one thing
 * that changes freely; a classifier built on it re-breaks silently every time
 * someone improves a sentence. This is the same lesson that produced the
 * `Error: ` / `Denied: ` prefix convention in `AUTOMATION_SECURITY.md` — with the
 * added requirement that the payload here is a fixed vocabulary (`CAUSES`), not
 * prose, and is parsed by an anchored, exact-match regex on the far side.
 *
 * **The contract.** Encoded here, decoded in `backend/services/pcTools.js` (see
 * `REFUSAL_WIRE_RE` there). There is no shared module — the addon and the backend
 * are separate deployables — so the two ends name each other in comments. If this
 * format changes, that regex changes with it.
 *
 * Backwards compatibility is by ABSENCE, never by mistranslation: an addon that
 * predates this sends a plain reason with no token, and the cloud falls back to
 * its old regex for those. A new addon always sends the token, so the guess is
 * used only for builds already in the field.
 */

/**
 * Encode a refusal for transport.
 *
 * @param {string|null} cause  one of `permissions.CAUSES`, or null when unknown
 * @param {string} reason      the human-facing reason (already user-visible on the PC)
 * @returns {string} the message to throw, so the relay posts it as `error`
 */
function encodeRefusal(cause, reason) {
    const text = String(reason || 'refused').trim();
    // No cause → send the reason alone. Inventing a cause would be worse than
    // sending none: the cloud would act on a guess it believes is a fact.
    if (!cause) return text;
    return `DENIED[${cause}]: ${text}`;
}

module.exports = { encodeRefusal };
