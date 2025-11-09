// ocrController.js - Thin HTTP handler for OCR operations

const asyncHandler = require('express-async-handler');
const { checkIP } = require('../utils/accessData.js');
const { trackApiUsage } = require('../utils/apiUsageTracker.js');
const ocrService = require('../services/ocrService.js');

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

        // Validate input
        if (!req.body.imageData) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing imageData in request body' 
            });
        }

        const { 
            imageData, 
            ocrProvider = 'openai',  // Default to OpenAI
            ocrModel,                // Optional model specification
            postProcessWithLLM = false,
            llmProvider,             // LLM provider for post-processing
            llmModel,                // LLM model for post-processing
            additionalPrompt         // Additional instructions for LLM
        } = req.body;

        const userId = req.user.email;

        // Perform OCR processing using service
        const ocrResult = await ocrService.processOCR({
            imageData,
            ocrProvider,
            ocrModel,
            userId
        });

        // Track API usage for OCR
        await trackApiUsage(userId, ocrProvider, ocrResult.tokensUsed || 0);

        let finalResult = ocrResult;

        // Optional LLM post-processing
        if (postProcessWithLLM && ocrResult.text) {
            const llmResult = await ocrService.postProcessWithLLM({
                extractedText: ocrResult.text,
                llmProvider,
                llmModel,
                additionalPrompt,
                userId
            });

            // Track LLM usage
            if (llmResult.tokensUsed) {
                await trackApiUsage(userId, llmProvider || 'openai', llmResult.tokensUsed);
            }

            finalResult = {
                ...ocrResult,
                llmProcessed: true,
                llmProvider: llmResult.provider,
                llmModel: llmResult.model,
                processedText: llmResult.processedText,
                llmTokensUsed: llmResult.tokensUsed
            };
        }

        res.status(200).json({
            success: true,
            data: finalResult
        });

    } catch (error) {
        console.error('[OCR Controller] Error in extractOCR:', error);
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

        // Validate input
        if (!itemId) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing item ID' 
            });
        }

        if (!req.body.imageData) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing imageData in request body' 
            });
        }

        const { 
            imageData, 
            ocrProvider = 'openai',
            ocrModel,
            postProcessWithLLM = false,
            llmProvider,
            llmModel,
            additionalPrompt
        } = req.body;

        // Perform OCR and update item using service
        const result = await ocrService.updateItemWithOCR({
            itemId,
            userId,
            imageData,
            ocrProvider,
            ocrModel,
            postProcessWithLLM,
            llmProvider,
            llmModel,
            additionalPrompt
        });

        // Track API usage
        if (result.ocrTokensUsed) {
            await trackApiUsage(userId, ocrProvider, result.ocrTokensUsed);
        }
        if (result.llmTokensUsed) {
            await trackApiUsage(userId, llmProvider || 'openai', result.llmTokensUsed);
        }

        res.status(200).json({
            success: true,
            message: 'Item updated with OCR results',
            data: result
        });

    } catch (error) {
        console.error('[OCR Controller] Error in updateWithOCR:', error);
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
