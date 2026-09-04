/**
 * uiMapperController.js — AI auto-mapping for the /uimapper internal tool.
 *
 *   POST /api/data/uimapper/automap → analyze an uploaded screenshot and
 *                                     return named bounding boxes (auth)
 *
 * Uses AWS Bedrock (Claude Haiku 4.5) vision via the same multimodal path as
 * the workspace agent-vision proxy (bedrockService.createBedrockCompletion).
 * This is a metered, server-paid Bedrock invocation, so the route is
 * authenticated + rate-limited (protect + llmLimiter) in routeData.js.
 */

const asyncHandler = require('express-async-handler');
const { logger } = require('../utils/logger');
const { createBedrockCompletion, isBedrockConfigured } = require('../services/bedrockService');

// data:<mime>;base64,<payload> — same shape the agent-vision proxy accepts.
const IMAGE_DATA_URL_RE = /^data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=\r\n]+)$/;
const MAX_DATA_URL_LENGTH = 8_000_000;

/**
 * Build the vision prompt. `width`/`height` are the pixel dimensions of the
 * image actually sent, so the model returns coordinates in that exact space
 * (the frontend scales them back to the original image size afterwards).
 */
function buildPrompt(width, height) {
    const w = Math.max(1, Math.round(Number(width) || 0));
    const h = Math.max(1, Math.round(Number(height) || 0));
    return [
        'You are a UI analysis engine. Look at the attached screenshot of a user interface.',
        'Identify each distinct, meaningful UI component (buttons, text inputs, headings, images, cards, navigation items, links, icons, list rows, etc.).',
        `The image is ${w} pixels wide and ${h} pixels tall.`,
        'Return ONLY a JSON array — no markdown, no code fences, no commentary — in this exact shape:',
        '[{"name":"Login button","x":10,"y":20,"w":120,"h":40}]',
        'Rules:',
        '- x and y are the top-left corner; w and h are width and height. All four are integers, in pixels, within the image bounds.',
        '- Prefer a clean, minimal set of the most meaningful components; do not draw overlapping or duplicate boxes.',
        '- Names should be short, lowercase, human-readable descriptions (at most 4 words).',
        '- If the image contains no UI, return an empty array [].',
    ].join('\n');
}

/**
 * Parse the model's raw text into a normalized region array. Strips accidental
 * code fences and leading/trailing prose, then coerces + clamps each box.
 *
 * @param {string} text - Raw model output.
 * @param {number} width - Sent image width (for clamping).
 * @param {number} height - Sent image height (for clamping).
 * @returns {Array<{name:string,x:number,y:number,w:number,h:number}>}
 */
function parseRegions(text, width, height) {
    let cleaned = String(text || '').trim();
    cleaned = cleaned.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();

    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start >= 0 && end > start) cleaned = cleaned.slice(start, end + 1);

    let parsed;
    try {
        parsed = JSON.parse(cleaned);
    } catch (err) {
        const error = new Error('Could not parse the AI result.');
        error.statusCode = 502;
        throw error;
    }

    if (!Array.isArray(parsed)) {
        const error = new Error('AI returned an unexpected result.');
        error.statusCode = 502;
        throw error;
    }

    const maxX = Math.max(1, Math.round(Number(width) || 0));
    const maxY = Math.max(1, Math.round(Number(height) || 0));

    const regions = [];
    for (const item of parsed) {
        if (!item || typeof item !== 'object') continue;
        const x = Math.round(Number(item.x));
        const y = Math.round(Number(item.y));
        const w = Math.round(Number(item.w));
        const h = Math.round(Number(item.h));
        if (![x, y, w, h].every(Number.isFinite)) continue;
        if (w < 2 || h < 2) continue;
        regions.push({
            name: String(item.name || 'Region').trim().slice(0, 80) || 'Region',
            x: Math.max(0, Math.min(x, maxX - 1)),
            y: Math.max(0, Math.min(y, maxY - 1)),
            w: Math.min(Math.max(2, w), maxX),
            h: Math.min(Math.max(2, h), maxY),
        });
    }
    return regions;
}

// @desc    AI auto-map: detect UI components + names from a screenshot
// @route   POST /api/data/uimapper/automap
// @access  Private (protect)
const autoMap = asyncHandler(async (req, res) => {
    if (!isBedrockConfigured()) {
        return res.status(503).json({
            success: false,
            error: 'AI auto-mapping is not configured on the server.',
        });
    }

    const { imageDataUrl, width, height } = req.body || {};
    if (!imageDataUrl || typeof imageDataUrl !== 'string') {
        return res.status(400).json({ success: false, error: 'An image is required.' });
    }
    if (imageDataUrl.length > MAX_DATA_URL_LENGTH) {
        return res.status(400).json({ success: false, error: 'Image is too large to analyze.' });
    }
    if (!IMAGE_DATA_URL_RE.test(imageDataUrl)) {
        return res.status(400).json({ success: false, error: 'Unsupported image format.' });
    }

    const messages = [{
        role: 'user',
        content: [
            { type: 'text', text: buildPrompt(width, height) },
            { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
    }];

    let result;
    try {
        const response = await createBedrockCompletion(messages, {
            temperature: 0.1,
            maxTokens: 2000,
        });
        result = response?.choices?.[0]?.message?.content?.trim() || '';
    } catch (err) {
        if (err.code === 'BEDROCK_THROTTLED') {
            return res.status(429).json({
                success: false,
                error: 'The AI service is busy right now. Please wait a minute and try again.',
            });
        }
        if (err.code === 'BEDROCK_ACCESS_DENIED') {
            return res.status(502).json({
                success: false,
                error: 'Bedrock model access is not enabled for this AWS account/region. An operator needs to enable "Claude Haiku 4.5" in the Bedrock console and grant bedrock:InvokeModel to the backend IAM user.',
            });
        }
        if (err.code === 'BEDROCK_USE_CASE_NOT_SUBMITTED') {
            return res.status(502).json({
                success: false,
                error: 'Anthropic requires a one-time "use case details" form before this AWS account can invoke Claude models on Bedrock. An operator needs to submit it in the Bedrock console model catalog.',
            });
        }
        logger.error('[uimapper] Auto-map failed:', { message: err.message, code: err.code });
        return res.status(502).json({
            success: false,
            error: 'AI auto-mapping failed. Please try again.',
            details: err.message,
        });
    }

    let regions;
    try {
        regions = parseRegions(result, width, height);
    } catch (err) {
        logger.error('[uimapper] Failed to parse AI result:', { message: err.message, result });
        return res.status(err.statusCode || 502).json({
            success: false,
            error: err.message,
        });
    }

    res.status(200).json({ success: true, regions });
});

module.exports = { autoMap };
