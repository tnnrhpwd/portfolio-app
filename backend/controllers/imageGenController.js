/**
 * imageGenController.js — AWS Bedrock text-to-image endpoints.
 *
 *   GET  /api/data/image/models    → list supported models + default (public)
 *   POST /api/data/image/generate  → generate image(s) from a prompt (auth)
 *
 * Generation is authenticated + rate-limited (imageGenLimiter) because it is a
 * metered, server-paid Bedrock cost — unlike the public /hype text quotes.
 * Returns base64 PNG data URLs so the frontend can render results immediately
 * without an S3 round-trip.
 */

const asyncHandler = require('express-async-handler');
const { logger } = require('../utils/logger');
const {
    IMAGE_MODELS,
    getDefaultImageModelId,
    isImageGenerationConfigured,
    generateImage: generateBedrockImage,
} = require('../services/bedrockImageService');

// @desc    List supported image models
// @route   GET /api/data/image/models
// @access  Public (static metadata — no cost, no secrets)
const getImageModels = (req, res) => {
    const defaultModel = getDefaultImageModelId();
    res.status(200).json({
        success: true,
        defaultModel,
        models: Object.entries(IMAGE_MODELS).map(([id, info]) => ({
            id,
            provider: info.provider,
            label: info.label,
            aspectRatios: info.aspectRatios,
        })),
    });
};

// @desc    Generate image(s) from a text prompt via AWS Bedrock
// @route   POST /api/data/image/generate
// @access  Private (protect)
const generateImage = asyncHandler(async (req, res) => {
    if (!isImageGenerationConfigured()) {
        return res.status(503).json({
            success: false,
            error: 'Image generation is not configured on the server.',
        });
    }

    const { prompt, model, aspectRatio, numberOfImages, seed, negativePrompt } = req.body || {};

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
        return res.status(400).json({ success: false, error: 'A text prompt is required.' });
    }
    if (prompt.trim().length > 4000) {
        return res.status(400).json({ success: false, error: 'Prompt is too long (max 4000 characters).' });
    }

    const modelId = (typeof model === 'string' && model.trim()) || getDefaultImageModelId();
    if (!IMAGE_MODELS[modelId]) {
        return res.status(400).json({ success: false, error: `Unsupported image model: ${modelId}` });
    }

    const ratio = (typeof aspectRatio === 'string' && aspectRatio.trim()) || '1:1';
    if (!IMAGE_MODELS[modelId].aspectRatios.includes(ratio)) {
        return res.status(400).json({
            success: false,
            error: `Unsupported aspect ratio "${ratio}" for model ${modelId}.`,
        });
    }

    let count = 1;
    if (numberOfImages !== undefined) {
        count = Number(numberOfImages);
        if (!Number.isInteger(count) || count < 1 || count > 4) {
            return res.status(400).json({ success: false, error: 'numberOfImages must be an integer between 1 and 4.' });
        }
    }

    let seedValue;
    if (seed !== undefined) {
        seedValue = Number(seed);
        if (!Number.isInteger(seedValue) || seedValue < 0 || seedValue > 4294967295) {
            return res.status(400).json({ success: false, error: 'seed must be an integer between 0 and 4294967295.' });
        }
    }

    try {
        const result = await generateBedrockImage({
            prompt: prompt.trim(),
            modelId,
            aspectRatio: ratio,
            numberOfImages: count,
            seed: seedValue,
            negativePrompt: (typeof negativePrompt === 'string' && negativePrompt.trim()) || undefined,
        });
        res.status(200).json({ success: true, ...result });
    } catch (error) {
        logger.error('[image-gen] Generation failed:', { message: error.message, code: error.code });
        const status = error.status
            || (error.code === 'BEDROCK_THROTTLED' ? 429 : 502);
        res.status(status).json({
            success: false,
            error: error.code === 'BEDROCK_THROTTLED'
                ? 'Image generation is temporarily busy. Please try again shortly.'
                : 'Image generation failed. Please try again.',
            details: error.message,
        });
    }
});

module.exports = { getImageModels, generateImage };
