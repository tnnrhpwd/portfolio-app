/**
 * user_confirm — stop and get the human's explicit OK before something irreversible.
 *
 * **Why it exists.** A user asked: *"google message my girlfriend that I love her …
 * Dakota is my girlfriend, the one I message the most. **please verify before sending
 * the message**."* Nothing in the toolset could do that:
 *
 *   - `goal_ask_user` writes the question into the goal and marks it blocked, then
 *     RETURNS — the run continues without an answer, so it cannot gate anything;
 *   - the permission gate asks *"may I run browser_press?"*, which is a question
 *     about a TOOL, not about the content. It cannot show "about to send *I love
 *     you* to Dakota";
 *   - and there is no undo. A sent message is sent.
 *
 * So this is the one tool that trades a pause for certainty, on exactly the actions
 * where being wrong is not recoverable: sending a message or an email, posting,
 * submitting a form, buying something, deleting something.
 *
 * It BLOCKS on the same approval prompt the user already answers tool permissions
 * in, and it is deliberately NOT subject to `autoApproveAll` — see
 * `permissions.requestConfirmation`.
 */

const permissions = require('../permissions');

const userConfirm = {
    name: 'user_confirm',
    category: 'safe-read',   // this IS the gate; gate-keeping the gate would be a prompt asking to prompt
    description:
        'Ask the user to approve a specific IRREVERSIBLE action and WAIT for their answer before you do it. ' +
        'Use it before sending a message or email, posting a comment, submitting a form, confirming an order ' +
        'or purchase, or deleting anything — put the EXACT content in `details` (who it goes to, and the ' +
        'full text) so they can check it rather than take your word for it. ' +
        'It blocks until they answer. If it is refused, do NOT do the action and do not rephrase it: say what ' +
        'was not done. Never claim you sent something without this returning approved:true.',
    parameters: {
        type: 'object',
        properties: {
            what: {
                type: 'string',
                description: 'One line naming the action, e.g. "Send a Google Messages message to Dakota".',
            },
            details: {
                type: 'string',
                description: 'The exact content to be confirmed — recipient and the full message/body text.',
            },
        },
        required: ['what'],
    },
    async run(args, ctx) {
        const what = String(args?.what || '').trim();
        if (!what) throw new Error('what is required — describe the action in one line so the user knows what they are approving');

        const details = args?.details == null ? '' : String(args.details);

        const res = await permissions.requestConfirmation({
            what,
            details,
            // Same deadline as any other relay-dispatched prompt: under the cloud's
            // dispatch window, so an unanswered confirmation becomes a definite
            // refusal the harness can act on rather than an unknown.
            approvalTimeoutMs: ctx?.approvalTimeoutMs,
        });

        if (res.approved) {
            return { approved: true, what, ...(details ? { details } : {}), approvedBy: res.approvedBy || 'user' };
        }

        // ⚠️ Prefixed, per the convention this codebase already learned the hard
        // way (`AUTOMATION_SECURITY.md`): every consumer decides "did this work?"
        // from the prefix. A bare sentence here would be counted as SUCCESS — and
        // for this tool specifically that would read as "the user approved", which
        // is the worst possible way to be wrong.
        const why = res.unavailable
            ? 'the user could not be asked (no approval prompt is available on this machine right now)'
            : (res.reason || 'the user did not approve');
        throw new Error(
            `Denied: the user did NOT approve this: ${what}. Reason: ${why}. `
            + 'Do not perform it, and do not try to work around it — tell the user it was not done.'
        );
    },
};

module.exports = { userConfirm };
