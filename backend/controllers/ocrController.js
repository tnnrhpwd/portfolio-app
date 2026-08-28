// ocrController.js - Thin HTTP handler for OCR operations

const asyncHandler = require('express-async-handler');
const { checkIP } = require('../utils/accessData.js');
const { canMakeApiCall, trackApiUsage } = require('../utils/apiUsageTracker.js');
const { logger } = require('../utils/logger');
const ocrService = require('../services/ocrService.js');
const s3Service = require('../services/s3Service.js');
const { PROVIDERS } = require('../utils/llmProviders');

// Rough token estimate for a single OCR vision call, used to gate + meter the
// platform-paid providers against the per-tier AI credit allowance. Sized so a
// typical image extraction costs a few cents at Bedrock/OpenAI/XAI rates.
const OCR_INPUT_TOKENS = 1500;
const OCR_OUTPUT_TOKENS = 500;

// Map an OCR method to the metering bucket it bills against. `tesseract` runs
// locally and is never metered.
function getOcrMeter(method, model) {
    switch (method) {
        case 'xai-vision':
            return { apiName: 'xai', model: model || 'grok-4' };
        case 'openai-vision':
            return { apiName: 'openai', model: model || 'gpt-4o' };
        case 'google-vision':
        case 'azure-ocr':
        case 'aws-textract':
            // No dedicated cost table for these rarely-configured providers;
            // meter them against the OpenAI bucket as a flat per-call proxy.
            return { apiName: 'openai', model: 'gpt-4o' };
        case 'tesseract':
            return null;
        default:
            return { apiName: 'xai', model: model || 'grok-4' };
    }
}

/**
 * @route   POST /api/data/ocr-extract
 * @desc    Extract text from image using OCR with optional LLM post-processing
 * @access  Protected
 */
const extractOCR = asyncHandler(async (req, res) => {
    try {
        // IP check
        const ipStatus = await checkIP(req);
        if (!ipStatus.allowed) {
            return res.status(403).json({ 
                success: false, 
                error: 'Access denied. Your IP is not allowed.' 
            });
        }

        const { imageData, imageUrl, s3Key, method, ocrProvider, model, ocrModel, llmProvider, llmModel } = req.body || {};
        const provider = method || ocrProvider || 'xai-vision';
        const modelArg = model || ocrModel;

        // Resolve the image: the frontend sends an S3 key/URL; legacy callers
        // may send raw base64 imageData.
        let resolvedImageData = imageData;
        if (!resolvedImageData && s3Key) {
            resolvedImageData = await s3Service.getFileBuffer(s3Key);
        }
        if (!resolvedImageData && imageUrl) {
            const imageResponse = await fetch(imageUrl);
            if (!imageResponse.ok) {
                throw new Error(`Failed to fetch image: ${imageResponse.status}`);
            }
            resolvedImageData = Buffer.from(await imageResponse.arrayBuffer()).toString('base64');
        }
        if (!resolvedImageData) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing image (provide imageData, s3Key, or imageUrl)' 
            });
        }

        const userId = req.user.email;

        // Gate metered (server-paid) providers against the per-tier AI credit
        // allowance before doing the work. `tesseract` is local and free.
        const meter = getOcrMeter(provider, modelArg);
        if (meter) {
            const gate = await canMakeApiCall(userId, meter.apiName, {
                model: meter.model,
                inputTokens: OCR_INPUT_TOKENS,
                outputTokens: OCR_OUTPUT_TOKENS,
            });
            if (!gate.canMake) {
                return res.status(402).json({
                    success: false,
                    error: gate.reason || 'Monthly AI usage limit reached'
                });
            }
        }

        // Perform OCR processing using service
        const ocrResult = await ocrService.processOCR(resolvedImageData, provider, modelArg);

        // Optional LLM post-processing (opt-in): the client picks a text LLM
        // provider/model (e.g. DeepSeek) to convert raw OCR text into structured
        // datetime + action lines. Only runs when that provider is configured.
        let enhancedText = ocrResult.extractedText;
        let postProvider = null;
        let postModel = null;
        if (llmProvider && llmModel && PROVIDERS[llmProvider]?.apiKey) {
            const enhanced = await ocrService.postProcessWithLLM(
                ocrResult.extractedText, llmProvider, llmModel, userId
            );
            if (enhanced && enhanced.enhancedText && !enhanced.error) {
                enhancedText = enhanced.enhancedText;
                postProvider = enhanced.provider;
                postModel = enhanced.model;
            }
        }

        // Deduct the estimated cost after a successful extraction.
        if (meter) {
            await trackApiUsage(userId, meter.apiName, {
                inputTokens: OCR_INPUT_TOKENS,
                outputTokens: OCR_OUTPUT_TOKENS,
            }, meter.model);
        }

        res.status(200).json({
            success: true,
            extractedText: enhancedText,
            provider: ocrResult.provider,
            model: ocrResult.model,
            postProcessed: !!postProvider,
            postProvider,
            postModel,
            confidence: ocrResult.confidence
        });

    } catch (error) {
        logger.error('[OCR Controller] Error in extractOCR:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'OCR extraction failed' 
        });
    }
});

/**
 * @route   PUT /api/data/ocr-update/:id
 * @desc    Update an existing DynamoDB item with OCR results
 * @access  Protected
 */
const updateWithOCR = asyncHandler(async (req, res) => {
    try {
        // IP check
        const ipStatus = await checkIP(req);
        if (!ipStatus.allowed) {
            return res.status(403).json({ 
                success: false, 
                error: 'Access denied. Your IP is not allowed.' 
            });
        }

        const itemId = req.params.id;
        const userId = req.user.email;
        const { ocrText } = req.body || {};

        // Validate input
        if (!itemId) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing item ID' 
            });
        }

        if (!ocrText) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing ocrText in request body' 
            });
        }

        // Update the item with the OCR-extracted text.
        const updatedItem = await ocrService.updateItemWithOCR(itemId, userId, ocrText);

        res.status(200).json({
            success: true,
            message: 'Item updated with OCR results',
            updatedItem
        });

    } catch (error) {
        logger.error('[OCR Controller] Error in updateWithOCR:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Failed to update item with OCR results' 
        });
    }
});

module.exports = {
    extractOCR,
    updateWithOCR
};
