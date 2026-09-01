/**
 * bedrockImageService.js — AWS Bedrock text-to-image adapter.
 *
 * Powers POST /api/data/image/generate with a curated set of Bedrock image
 * models. Two model families are supported, each translated to Bedrock's
 * native request shapes:
 *
 *   1. Stability AI (default) — invoked via the low-level InvokeModel API
 *      (NOT Converse), which is the only surface Stability image models expose:
 *        - stability.sd3-5-large-v1:0        (Stable Diffusion 3.5 Large)
 *        - stability.stable-image-core-v1:1   (fast / cheap)
 *        - stability.stable-image-ultra-v1:1  (max photorealism)
 *      All three return { images: [base64 png...], seed }.
 *
 *   2. Google Gemini — invoked via Converse (Gemini is a multimodal model):
 *        - gemini-2.5-flash-image             (a.k.a. "Nano Banana")
 *      Converse returns image content blocks on the assistant turn, which are
 *      parsed into the same normalized { mimeType, base64 } shape.
 *
 * Model selection: the caller (imageGenController) passes an explicit modelId,
 * which is validated against IMAGE_MODELS below. The server default is read
 * from BEDROCK_IMAGE_MODEL_ID (hydrated from AWS Secrets Manager in prod) and
 * falls back to Stable Diffusion 3.5 Large.
 *
 * Credentials: reused from services/bedrockService.js (dedicated
 * AWS_BEDROCK_* pair, falling back to the shared AWS_* pair). The IAM identity
 * needs bedrock:InvokeModel permission; Gemini additionally uses Converse
 * (also bedrock:InvokeModel). Enable the chosen model's access in the Bedrock
 * console (per region) — the console prerequisite, same as the chat models.
 */

const { BedrockRuntimeClient, InvokeModelCommand, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');
const { logger } = require('../utils/logger');
const { resolveBedrockCredentials, isBedrockConfigured, classifyBedrockError } = require('./bedrockService');

// Supported aspect ratios per model (documented Bedrock ranges). A "1:1"
// default keeps callers from guessing — every model supports it.
const IMAGE_MODELS = {
    'stability.sd3-5-large-v1:0': {
        provider: 'stability',
        label: 'Stable Diffusion 3.5 Large',
        aspectRatios: ['1:1', '16:9', '21:9', '2:3', '3:2', '4:5', '5:4', '9:16', '9:21'],
    },
    'stability.stable-image-core-v1:1': {
        provider: 'stability',
        label: 'Stable Image Core (fast)',
        aspectRatios: ['1:1', '16:9', '21:9', '2:3', '3:2', '4:5', '5:4', '9:16'],
    },
    'stability.stable-image-ultra-v1:1': {
        provider: 'stability',
        label: 'Stable Image Ultra (photoreal)',
        aspectRatios: ['1:1', '16:9', '21:9', '2:3', '3:2', '4:5', '5:4', '9:16', '9:21'],
    },
    'gemini-2.5-flash-image': {
        provider: 'gemini',
        label: 'Gemini 2.5 Flash Image (Nano Banana)',
        aspectRatios: ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
    },
};

const DEFAULT_IMAGE_MODEL_ID = 'stability.sd3-5-large-v1:0';
const MAX_IMAGES_PER_REQUEST = 4;

// The Stability text-to-image generators (SD3.5 Large / Core / Ultra) are NOT
// in us-east-1 — they are ACTIVE in us-west-2 (verified via ListFoundationModels,
// 2026-09). us-east-1 only has the Legacy Nova Canvas + Stability *editing* tools.
// So image generation defaults to Oregon, independent of the chat client's region
// (Claude Haiku 4.5 stays in us-east-1). Override with AWS_BEDROCK_IMAGE_REGION.
const IMAGE_DEFAULT_REGION = 'us-west-2';

let _imageClient = null;
function getImageClient() {
    if (!_imageClient) {
        const { accessKeyId, secretAccessKey, dedicated } = resolveBedrockCredentials();
        const region = process.env.AWS_BEDROCK_IMAGE_REGION || process.env.AWS_BEDROCK_REGION || IMAGE_DEFAULT_REGION;
        logger.debug(`🖼️ Bedrock image client using ${dedicated ? 'dedicated AWS_BEDROCK_*' : 'shared AWS_*'} credentials (region: ${region})`);
        _imageClient = new BedrockRuntimeClient({
            region,
            credentials: { accessKeyId, secretAccessKey },
        });
    }
    return _imageClient;
}

/** Server-side default model (BEDROCK_IMAGE_MODEL_ID, or SD3.5 Large). */
function getDefaultImageModelId() {
    const configured = (process.env.BEDROCK_IMAGE_MODEL_ID || '').trim();
    return IMAGE_MODELS[configured] ? configured : DEFAULT_IMAGE_MODEL_ID;
}

/** Small 400-shaped error helper so controllers can map to a clean response. */
function badRequest(message) {
    const err = new Error(message);
    err.status = 400;
    return err;
}

/**
 * Generate one image via a Stability model using InvokeModel. Returns an array
 * of normalized image objects (length 1 for these models).
 */
async function generateStabilityImage(client, modelId, prompt, aspectRatio, seed, negativePrompt) {
    const body = {
        prompt,
        aspect_ratio: aspectRatio,
        output_format: 'png',
        seed,
    };
    // SD3.5 Large requires `mode`; Core/Ultra reject it.
    if (modelId === 'stability.sd3-5-large-v1:0') body.mode = 'text-to-image';
    if (negativePrompt) body.negative_prompt = negativePrompt;

    const command = new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(body),
    });

    let response;
    try {
        response = await client.send(command);
    } catch (error) {
        throw classifyBedrockError(error);
    }

    const payload = JSON.parse(Buffer.from(response.body).toString('utf-8'));
    const images = payload.images || [];
    return images.map((b64) => ({ mimeType: 'image/png', base64: b64 }));
}

/**
 * Generate one image via a Gemini multimodal model using Converse. Parses
 * image content blocks out of the assistant turn into normalized objects.
 */
async function generateGeminiImage(client, modelId, prompt) {
    const command = new ConverseCommand({
        modelId,
        messages: [{ role: 'user', content: [{ text: prompt }] }],
        inferenceConfig: { maxTokens: 8192 },
    });

    let response;
    try {
        response = await client.send(command);
    } catch (error) {
        throw classifyBedrockError(error);
    }

    const blocks = response.output?.message?.content || [];
    const images = [];
    for (const block of blocks) {
        const bytes = block.image?.source?.bytes;
        if (!bytes) continue;
        const format = block.image.format || 'png';
        images.push({
            mimeType: `image/${format}`,
            base64: Buffer.from(bytes).toString('base64'),
        });
    }

    if (images.length === 0) {
        throw new Error('Image model returned no image content');
    }
    return images;
}

/**
 * Generate one or more images from a text prompt.
 *
 * @param {Object} params
 * @param {string} params.prompt - Text prompt (required)
 * @param {string} params.modelId - Model id from IMAGE_MODELS (required)
 * @param {string} [params.aspectRatio='1:1'] - Aspect ratio the model supports
 * @param {number} [params.numberOfImages=1] - 1..MAX_IMAGES_PER_REQUEST
 * @param {number} [params.seed] - Deterministic seed (Stability only)
 * @param {string} [params.negativePrompt] - What to avoid (Stability only)
 * @returns {Promise<{images: Array<{mimeType:string, base64:string}>, seed: number, model: string, provider: string}>}
 */
async function generateImage({ prompt, modelId, aspectRatio = '1:1', numberOfImages = 1, seed, negativePrompt }) {
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
        throw badRequest('A text prompt is required');
    }

    const model = IMAGE_MODELS[modelId];
    if (!model) {
        throw badRequest(`Unsupported image model: ${modelId}`);
    }

    if (!model.aspectRatios.includes(aspectRatio)) {
        throw badRequest(`Unsupported aspect ratio "${aspectRatio}" for model ${modelId}`);
    }

    if (!Number.isInteger(numberOfImages) || numberOfImages < 1 || numberOfImages > MAX_IMAGES_PER_REQUEST) {
        throw badRequest(`numberOfImages must be an integer between 1 and ${MAX_IMAGES_PER_REQUEST}`);
    }

    if (seed !== undefined && seed !== null && (!Number.isInteger(seed) || seed < 0 || seed > 4294967295)) {
        throw badRequest('seed must be an integer between 0 and 4294967295');
    }

    const client = getImageClient();
    const baseSeed = seed ?? Math.floor(Math.random() * 4294967295);

    const images = [];
    for (let i = 0; i < numberOfImages; i++) {
        if (model.provider === 'gemini') {
            images.push(...await generateGeminiImage(client, modelId, prompt.trim()));
        } else {
            // Vary the seed per image so multiple images in one call differ.
            const imageSeed = (baseSeed + i) % 4294967295;
            images.push(...await generateStabilityImage(client, modelId, prompt.trim(), aspectRatio, imageSeed, negativePrompt));
        }
    }

    logger.debug(`🖼️ Bedrock image generation: ${modelId} (${numberOfImages} image(s))`);
    return { images, seed: baseSeed, model: modelId, provider: model.provider };
}

module.exports = {
    IMAGE_MODELS,
    DEFAULT_IMAGE_MODEL_ID,
    MAX_IMAGES_PER_REQUEST,
    getDefaultImageModelId,
    isImageGenerationConfigured: isBedrockConfigured,
    generateImage,
};
