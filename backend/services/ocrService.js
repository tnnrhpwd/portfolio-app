// ocrService.js - OCR processing business logic

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { 
    initializeLLMClients, 
    createCompletion, 
    trackCompletion,
    PROVIDERS 
} = require('../utils/llmProviders.js');
const { canMakeApiCall } = require('../utils/apiUsageTracker.js');

require('dotenv').config();

// LLM Clients for OCR
let openaiClient, anthropicClient, googleClient;

// Configure AWS DynamoDB Client
const client = new DynamoDBClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const dynamodb = DynamoDBDocumentClient.from(client);

/**
 * Initialize OCR-specific LLM clients
 */
async function initializeOCRLLMClients() {
    if (!openaiClient) {
        const { OpenAI } = require('openai');
        openaiClient = new OpenAI({
            apiKey: process.env.OPENAI_KEY
        });
    }
}

/**
 * Process image with Google Vision API
 * @param {string} imageData - Base64 encoded image
 * @param {string} model - Model variant
 * @returns {Object} OCR result
 */
async function processWithGoogleVision(imageData, model = 'default') {
    try {
        console.log('Processing with Google Vision API, model:', model);
        
        if (process.env.GOOGLE_CLOUD_KEY_FILE) {
            const vision = require('@google-cloud/vision');
            const client = new vision.ImageAnnotatorClient({
                keyFilename: process.env.GOOGLE_CLOUD_KEY_FILE
            });
            
            const request = { 
                image: { content: Buffer.from(imageData, 'base64') },
                features: [
                    { type: 'TEXT_DETECTION' },
                    { type: 'DOCUMENT_TEXT_DETECTION' }
                ]
            };
            
            const [result] = await client.annotateImage(request);
            const textAnnotations = result.textAnnotations;
            
            if (textAnnotations && textAnnotations.length > 0) {
                return {
                    extractedText: textAnnotations[0].description,
                    confidence: textAnnotations[0].confidence || 0.9,
                    provider: 'google-vision',
                    model: model
                };
            } else {
                return {
                    extractedText: "No text detected in image",
                    confidence: 0.0,
                    provider: 'google-vision',
                    model: model
                };
            }
        } else {
            console.log('Google Vision API credentials not configured, using OpenAI Vision as fallback');
            return await processWithOpenAIVision(imageData, model);
        }
    } catch (error) {
        console.error('Google Vision API error:', error);
        console.log('Falling back to OpenAI Vision');
        return await processWithOpenAIVision(imageData, model);
    }
}

/**
 * Process image with OpenAI Vision API
 * @param {string} imageData - Base64 encoded image
 * @param {string} model - Model variant (default: gpt-4o)
 * @returns {Object} OCR result
 */
async function processWithOpenAIVision(imageData, model = 'gpt-4o') {
    try {
        console.log('Processing with OpenAI Vision API, model:', model);
        
        if (!process.env.OPENAI_KEY) {
            throw new Error('OpenAI API key not configured');
        }
        
        await initializeOCRLLMClients();
        
        if (!openaiClient) {
            throw new Error('OpenAI client not initialized');
        }
        
        const response = await openaiClient.chat.completions.create({
            model: model || 'gpt-4o',
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: 'Extract all text from this image. Focus on handwritten notes, printed text, schedules, tasks, and any productivity-related content. Maintain the original structure and formatting as much as possible. If there are time entries, meetings, or action items, preserve their format.'
                        },
                        {
                            type: 'image_url',
                            image_url: {
                                url: `data:image/jpeg;base64,${imageData}`
                            }
                        }
                    ]
                }
            ],
            max_tokens: 1000
        });
        
        const extractedText = response.choices[0]?.message?.content || 'No text detected';
        
        return {
            extractedText: extractedText,
            confidence: 0.95,
            provider: 'openai-vision',
            model: model || 'gpt-4o',
            usage: response.usage
        };
    } catch (error) {
        console.error('OpenAI Vision API error:', error);
        throw new Error(`OpenAI Vision failed: ${error.message}`);
    }
}

/**
 * Process image with XAI Vision API
 * @param {string} imageData - Base64 encoded image
 * @param {string} model - Model variant (default: grok-4)
 * @returns {Object} OCR result
 */
async function processWithXAIVision(imageData, model = 'grok-4') {
    try {
        console.log('Processing with XAI Vision API, model:', model);
        
        if (!process.env.XAI_API_KEY && !process.env.XAI_KEY) {
            throw new Error('XAI API key not configured');
        }
        
        await initializeLLMClients();
        
        const imageSizeMB = imageData ? (imageData.length * 0.75) / (1024 * 1024) : 0;
        console.log('Image size (estimated MB):', imageSizeMB.toFixed(2));
        
        let processedImageData = imageData;
        if (imageSizeMB > 0.5) {
            const maxLength = Math.floor(700000 * 0.75);
            processedImageData = imageData.substring(0, maxLength);
            console.log('Compressed image to length:', processedImageData.length);
        }

        const messageContent = [
            {
                type: 'image_url',
                image_url: {
                    url: `data:image/jpeg;base64,${processedImageData}`,
                    detail: 'high'
                }
            },
            {
                type: 'text',
                text: 'Extract all text from this image and convert it to a structured datetime + action format. For each time entry and associated task/activity, output one line in this exact format: MM/DD/YYYY H:MM:SS\tactionname (tab-separated). Convert times to 24-hour format with full dates. Combine related activities into concise action names (no spaces, use camelCase or concatenation). Focus on extracting: time entries, meetings, tasks, activities, breaks, meals. Output should be clean lines of datetime\\taction pairs only.'
            }
        ];

        const completion = await PROVIDERS.xai.client.chat.completions.create({
            model: model || 'grok-4',
            messages: [
                {
                    role: 'user',
                    content: messageContent
                }
            ],
            max_tokens: 4000
        });
        
        const extractedText = completion.choices?.[0]?.message?.content || 'No text detected';
        
        console.log('XAI Vision OCR completed, text length:', extractedText.length);
        
        return {
            extractedText: extractedText,
            confidence: 0.95,
            provider: 'xai-vision',
            model: model || 'grok-4',
            usage: completion.usage
        };
    } catch (error) {
        console.error('XAI Vision API error:', error);
        throw new Error(`XAI Vision failed: ${error.message}`);
    }
}

/**
 * Process image with Azure Computer Vision
 * @param {string} imageData - Base64 encoded image
 * @param {string} model - Model variant
 * @returns {Object} OCR result
 */
async function processWithAzureOCR(imageData, model = 'default') {
    try {
        console.log('Processing with Azure Computer Vision, model:', model);
        
        if (process.env.AZURE_COMPUTER_VISION_KEY && process.env.AZURE_COMPUTER_VISION_ENDPOINT) {
            const { ComputerVisionClient } = require('@azure/cognitiveservices-computervision');
            const { ApiKeyCredentials } = require('@azure/ms-rest-js');
            
            const computerVisionClient = new ComputerVisionClient(
                new ApiKeyCredentials({ 
                    inHeader: { 'Ocp-Apim-Subscription-Key': process.env.AZURE_COMPUTER_VISION_KEY } 
                }),
                process.env.AZURE_COMPUTER_VISION_ENDPOINT
            );
            
            const imageBuffer = Buffer.from(imageData, 'base64');
            const readResult = await computerVisionClient.readInStream(imageBuffer);
            const operationId = readResult.operationLocation.split('/').slice(-1)[0];
            
            let result;
            do {
                await new Promise(resolve => setTimeout(resolve, 1000));
                result = await computerVisionClient.getReadResult(operationId);
            } while (result.status === 'running' || result.status === 'notStarted');
            
            if (result.status === 'succeeded') {
                let extractedText = '';
                for (const page of result.analyzeResult.readResults) {
                    for (const line of page.lines) {
                        extractedText += line.text + '\n';
                    }
                }
                
                return {
                    extractedText: extractedText.trim(),
                    confidence: 0.92,
                    provider: 'azure-ocr',
                    model: model
                };
            } else {
                throw new Error('Azure OCR operation failed');
            }
        } else {
            console.log('Azure credentials not configured, using OpenAI Vision as fallback');
            return await processWithOpenAIVision(imageData, model);
        }
    } catch (error) {
        console.error('Azure Computer Vision error:', error);
        return await processWithOpenAIVision(imageData, model);
    }
}

/**
 * Process image with AWS Textract
 * @param {string} imageData - Base64 encoded image
 * @param {string} model - Model variant
 * @returns {Object} OCR result
 */
async function processWithAWSTextract(imageData, model = 'default') {
    try {
        console.log('Processing with AWS Textract, model:', model);
        
        // Placeholder for AWS Textract implementation
        return {
            extractedText: "Mock OCR result from AWS Textract",
            confidence: 0.88,
            provider: 'aws-textract',
            model: model
        };
    } catch (error) {
        console.error('AWS Textract error:', error);
        throw new Error(`AWS Textract failed: ${error.message}`);
    }
}

/**
 * Process image with Tesseract.js (local OCR)
 * @param {string} imageData - Base64 encoded image
 * @param {string} model - Model variant
 * @returns {Object} OCR result
 */
async function processWithTesseract(imageData, model = 'default') {
    try {
        console.log('Processing with Tesseract (local), model:', model);
        
        const Tesseract = require('tesseract.js');
        
        let tesseractOptions = {
            logger: m => console.log(m)
        };
        
        switch (model) {
            case 'handwriting':
                tesseractOptions.tessedit_char_whitelist = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,!?:;-/() \n';
                break;
            case 'document':
                tesseractOptions.tessedit_pageseg_mode = Tesseract.PSM.SINGLE_BLOCK;
                break;
            case 'table':
                tesseractOptions.tessedit_pageseg_mode = Tesseract.PSM.SINGLE_UNIFORM_BLOCK;
                break;
            default:
                tesseractOptions.tessedit_pageseg_mode = Tesseract.PSM.AUTO;
        }
        
        const imageBuffer = Buffer.from(imageData, 'base64');
        const { data: { text, confidence } } = await Tesseract.recognize(imageBuffer, 'eng', tesseractOptions);
        
        return {
            extractedText: text.trim(),
            confidence: confidence / 100,
            provider: 'tesseract',
            model: model
        };
    } catch (error) {
        console.error('Tesseract error:', error);
        console.log('Tesseract failed, falling back to OpenAI Vision');
        return await processWithOpenAIVision(imageData, model);
    }
}

/**
 * Post-process OCR text with LLM for structured output
 * @param {string} ocrText - Raw OCR text
 * @param {string} llmProvider - LLM provider to use
 * @param {string} llmModel - LLM model to use
 * @param {string} userId - User ID for usage tracking
 * @returns {Object} Enhanced text result
 */
async function postProcessWithLLM(ocrText, llmProvider, llmModel, userId) {
    try {
        console.log(`Post-processing OCR with ${llmProvider}:${llmModel}`);
        
        const canMakeCall = await canMakeApiCall(userId, 'openai');
        if (!canMakeCall.canMake) {
            return {
                error: 'API usage limit reached',
                reason: canMakeCall.reason,
                originalText: ocrText
            };
        }

        await initializeLLMClients();
        
        const prompt = `Convert the following OCR-extracted text into a structured datetime + action format for productivity tracking.

OCR Text:
"""
${ocrText}
"""

Instructions:
1. Parse all time entries and associated activities/tasks
2. Convert to this exact format: MM/DD/YYYY H:MM:SS\tactionname (tab-separated)
3. Use 24-hour time format (convert AM/PM if present)
4. Infer reasonable dates based on context (use current date if unclear)
5. Create concise action names (no spaces, use camelCase: emails, planning, debugging, lunch, meeting, etc.)
6. Correct OCR errors in times and activities
7. Output ONLY the datetime\taction lines, nothing else

Example format:
9/26/2022 3:30:00\temails
9/26/2022 5:00:00\tplanning
9/26/2022 12:15:00\tlunch

Output the structured data now:`;

        const modelUsed = llmModel || (llmProvider === 'xai' ? 'grok-4' : 'o1-mini');
        const response = await createCompletion(llmProvider, modelUsed, [
            { role: 'user', content: prompt }
        ], {
            maxTokens: 4000,
            temperature: 0.3
        });
        
        await trackCompletion(userId, llmProvider, modelUsed, response, prompt);
        
        return {
            enhancedText: response.choices[0].message.content,
            provider: llmProvider,
            model: modelUsed,
            originalText: ocrText
        };
    } catch (error) {
        console.error('LLM post-processing error:', error);
        return {
            error: `LLM processing failed: ${error.message}`,
            originalText: ocrText
        };
    }
}

/**
 * Process image with specified OCR method
 * @param {string} imageData - Base64 encoded image
 * @param {string} method - OCR method/provider
 * @param {string} model - Model variant
 * @returns {Object} OCR result
 */
async function processOCR(imageData, method, model) {
    switch (method) {
        case 'xai-vision':
            return await processWithXAIVision(imageData, model);
        case 'openai-vision':
            return await processWithOpenAIVision(imageData, model);
        case 'google-vision':
            return await processWithGoogleVision(imageData, model);
        case 'azure-ocr':
            return await processWithAzureOCR(imageData, model);
        case 'aws-textract':
            return await processWithAWSTextract(imageData, model);
        case 'tesseract':
            return await processWithTesseract(imageData, model);
        default:
            return await processWithXAIVision(imageData, model);
    }
}

/**
 * Update DynamoDB item with OCR results
 * @param {string} itemId - Item ID to update
 * @param {string} userId - User ID for authorization
 * @param {string} ocrText - OCR extracted text
 * @returns {Object} Updated item
 */
async function updateItemWithOCR(itemId, userId, ocrText) {
    const scanParams = {
        TableName: 'Simple',
        FilterExpression: 'id = :itemId',
        ExpressionAttributeValues: {
            ':itemId': itemId
        }
    };

    const scanResult = await dynamodb.send(new ScanCommand(scanParams));
    
    if (!scanResult.Items || scanResult.Items.length === 0) {
        throw new Error('Data item not found');
    }

    const item = scanResult.Items[0];
    
    // Check ownership
    if (item.text && item.text.includes('Creator:')) {
        const dataCreator = item.text.substring(
            item.text.indexOf("Creator:") + 8, 
            item.text.indexOf("Creator:") + 32
        );
        if (dataCreator !== userId) {
            throw new Error('User not authorized to update this item');
        }
    }

    let updatedText = item.text;
    const actionMatch = updatedText.match(/(\|Action:)([^|]*?)(\||$)/);
    
    if (actionMatch) {
        const existingActionText = actionMatch[2];
        const newActionText = existingActionText.trim() ? 
            `${existingActionText.trim()}\n\nRich Action Data Extracted:\n${ocrText}` : 
            `Rich Action Data Extracted:\n${ocrText}`;
        
        updatedText = updatedText.replace(
            actionMatch[0], 
            `${actionMatch[1]}${newActionText}${actionMatch[3] || ''}`
        );
    } else {
        updatedText += `|Action:Rich Action Data Extracted:\n${ocrText}`;
    }

    const putParams = {
        TableName: 'Simple',
        Item: {
            ...item,
            text: updatedText,
            updatedAt: new Date().toISOString()
        }
    };

    await dynamodb.send(new PutCommand(putParams));
    return putParams.Item;
}

module.exports = {
    processOCR,
    postProcessWithLLM,
    updateItemWithOCR,
    // Export individual processors for testing
    processWithOpenAIVision,
    processWithXAIVision,
    processWithGoogleVision,
    processWithAzureOCR,
    processWithAWSTextract,
    processWithTesseract
};
