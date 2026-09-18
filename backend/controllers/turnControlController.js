/**
 * turnControlController.js — the two endpoints behind an IN-FLIGHT /net turn.
 *
 *   POST /api/data/compress/cancel   { runId }                 → stop the turn
 *   POST /api/data/compress/approve  { approvalId, approved }   → answer a prompt
 *
 * These are the write half of `services/harness/turnControl.js`; the read half
 * is the SSE stream itself (the `run` and `approval` events hand the client the
 * ids it needs). Deliberately thin — all state and all policy live in the
 * service, and both endpoints answer 200 with an outcome rather than erroring,
 * because "this turn already finished" is a normal race, not a failure:
 *
 *   - the user clicks Stop twice,
 *   - the approval prompt timed out a second before the answer arrived,
 *   - the turn ended (and the tab kept its card open).
 *
 * Cancel is cooperative: nothing is killed mid-tool. The loop stops at its next
 * safe boundary — see turnControl.js for why that is the right contract.
 */

const asyncHandler = require('express-async-handler');
const { cancelTurn, resolveApproval } = require('../services/harness/turnControl.js');
const { logger } = require('../utils/logger');

// @desc    Cancel an in-flight /net chat turn
// @route   POST /api/data/compress/cancel
// @access  Private (the owner of the turn — the id is unguessable and the turn
//          belongs to whoever is streaming it)
const cancelNetTurn = asyncHandler(async (req, res) => {
    const runId = req.body?.runId;
    if (!runId || typeof runId !== 'string') {
        return res.status(400).json({ error: 'runId is required' });
    }

    const result = cancelTurn(runId);
    if (!result.found) {
        // Not an error: the turn may have finished between the client's click
        // and this request. Say so plainly so the UI can settle.
        logger.debug(`[turnControl] cancel for unknown/finished run ${runId}`);
    }
    res.status(200).json(result);
});

// @desc    Answer a pending tool-approval prompt from an in-flight /net turn
// @route   POST /api/data/compress/approve
// @access  Private
const approveNetTurn = asyncHandler(async (req, res) => {
    const { approvalId, approved, reason } = req.body || {};
    if (!approvalId || typeof approvalId !== 'string') {
        return res.status(400).json({ error: 'approvalId is required' });
    }

    // `approved` may arrive as a boolean or as the option label the user clicked
    // ("Approve"/"Deny") — accept both, and read anything else as a denial.
    const isApproved = approved === true || approved === 'true' || approved === 'Approve';
    const resolved = resolveApproval(approvalId, isApproved, typeof reason === 'string' ? reason : '');
    res.status(200).json({ resolved });
});

module.exports = { cancelNetTurn, approveNetTurn };
