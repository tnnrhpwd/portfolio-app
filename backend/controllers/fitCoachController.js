/**
 * fitCoachController.js — the LLM coaching endpoint behind /fit.
 *
 *   POST /api/data/fit/coach  → { success, advice, disclaimer, provider, screened }
 *
 * Signed in only, because this is a server-paid Bedrock call and the whole
 * point of /fit for a signed-in athlete is that their history — sessions,
 * runs, body-weight check-ins, pain reports — is what makes the advice
 * specific. Guests get the deterministic generator instead, at no cost.
 *
 * Metered at the provider boundary, exactly like agent-chat/agent-vision
 * (docs/implementation/agent.md §8.1): the gate runs *before* Bedrock, and a
 * screened response — red flags, so the model is never called — is not billed.
 */

const asyncHandler = require('express-async-handler');
const { logger } = require('../utils/logger');
const { getCoachAdvice, HEALTH_DISCLAIMER } = require('../services/fitCoachService');

// Pre-call cost estimate for the gate; actual usage is recorded afterwards.
const ESTIMATED_USAGE = { inputTokens: 1600, outputTokens: 700 };

/**
 * @desc    Get personalised training advice from the athlete's logged data
 * @route   POST /api/data/fit/coach
 * @access  Private (metered cloud LLM)
 */
const askFitCoach = asyncHandler(async (req, res) => {
    const { canMakeApiCall, trackApiUsage } = require('../utils/apiUsageTracker');

    const gate = await canMakeApiCall(req.user.id, 'bedrock', ESTIMATED_USAGE);
    if (!gate.canMake) {
        return res.status(402).json({
            ok: false,
            success: false,
            error: gate.reason || 'Monthly AI usage limit reached for your plan.',
            planRequired: true,
            requiresUpgrade: true,
            membership: gate.membership,
            limit: gate.limit,
            creditsRemaining: gate.currentCredits,
            upgradeUrl: '/pricing',
        });
    }

    let result;
    try {
        result = await getCoachAdvice(req.body || {});
    } catch (err) {
        logger.error('[fit-coach] advice generation failed:', err.message);
        return res.status(502).json({
            success: false,
            error: 'The coach is unavailable right now. Your logged data is safe — try again in a moment.',
        });
    }

    // A screened response never reached a model, so there is nothing to bill.
    if (!result.screened && result.usage) {
        try {
            await trackApiUsage(
                req.user.id,
                'bedrock',
                {
                    inputTokens: result.usage.prompt_tokens || 0,
                    outputTokens: result.usage.completion_tokens || 0,
                },
                req.body?.model
            );
        } catch (err) {
            logger.warn('[fit-coach] usage tracking failed:', err.message);
        }
    }

    return res.status(200).json({
        success: true,
        advice: result.advice,
        disclaimer: HEALTH_DISCLAIMER,
        provider: result.provider,
        screened: result.screened,
    });
});

module.exports = { askFitCoach, HEALTH_DISCLAIMER };
