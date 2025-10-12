// ocrController.js - Handles OCR extraction from images

const asyncHandler = require('express-async-handler');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { checkIP } = require('../utils/accessData.js');
const { trackApiUsage, canMakeApiCall } = require('../utils/apiUsageTracker.js');

// LLM Providers
require('dotenv').config();
let openaiClient, anthropicClient, googleClient;

// Initialize local OCR-specific LLM clients (separate from the unified system for OCR processing)
async function initializeOCRLLMClients() {
    if (!openaiClient) {
        const { OpenAI } = require('openai');
        openaiClient = new OpenAI({
            apiKey: process.env.OPENAI_KEY
        });
    }
    // Add other LLM clients here when needed
    // anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });
    // googleClient = new GoogleGenerativeAI(process.env.GOOGLE_AI_KEY);
}

// Configure AWS DynamoDB Client
const client = new DynamoDBClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const dynamodb = DynamoDBDocumentClient.from(client);

// OCR Provider Functions
async function processWithGoogleVision(imageData, model = 'default') {
    // Google Vision API implementation
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
                const extractedText = textAnnotations[0].description;
                const confidence = textAnnotations[0].confidence || 0.9;
                
                return {
                    extractedText: extractedText,
                    confidence: confidence,
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

async function processWithOpenAIVision(imageData, model = 'gpt-4o') {
    // OpenAI Vision API implementation - Production default
    try {
        console.log('Processing with OpenAI Vision API, model:', model);
        console.log('Image data length:', imageData ? imageData.length : 0);
        
        // Check if OpenAI API key is available
        if (!process.env.OPENAI_KEY) {
            throw new Error('OpenAI API key not configured');
        }
        
        await initializeOCRLLMClients();
        
        if (!openaiClient) {
            throw new Error('OpenAI client not initialized');
        }
        
        console.log('OpenAI client initialized successfully');
        
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
            confidence: 0.95, // OpenAI Vision is generally very accurate
            provider: 'openai-vision',
            model: model || 'gpt-4o',
            usage: response.usage
        };
        
    } catch (error) {
        console.error('OpenAI Vision API error:', error);
        throw new Error(`OpenAI Vision failed: ${error.message}`);
    }
}

async function processWithXAIVision(imageData, model = 'grok-4') {
    // XAI Vision API implementation using unified LLM provider
    try {
        console.log('Processing with XAI Vision API, model:', model);
        console.log('Image data length:', imageData ? imageData.length : 0);
        
        // Check if XAI API key is available
        if (!process.env.XAI_API_KEY && !process.env.XAI_KEY) {
            throw new Error('XAI API key not configured');
        }
        
        // Initialize LLM clients through unified system
        await initializeLLMClients();
        
        console.log('XAI client initialized successfully via unified system');
        console.log('XAI API endpoint:', 'https://api.x.ai/v1/chat/completions');
        const xaiKey = process.env.XAI_API_KEY || process.env.XAI_KEY;
        console.log('XAI API key status:', xaiKey ? `Available (${xaiKey.substring(0, 10)}...)` : 'Not configured');
        
        // Prepare the message content for XAI Vision
        const messageContent = [
            {
                type: 'image_url',
                image_url: {
                    url: `data:image/jpeg;base64,${imageData}`,
                    detail: 'high' // High detail for better OCR extraction
                }
            },
            {
                type: 'text',
                text: 'Extract all text from this image and convert it to a structured datetime + action format. For each time entry and associated task/activity, output one line in this exact format: MM/DD/YYYY H:MM:SS\tactionname (tab-separated). Convert times to 24-hour format with full dates. Combine related activities into concise action names (no spaces, use camelCase or concatenation). Focus on extracting: time entries, meetings, tasks, activities, breaks, meals. Output should be clean lines of datetime\\taction pairs only.'
            }
        ];
        
        console.log('XAI Debug - Message structure:', {
            contentItems: messageContent.length,
            hasImageUrl: !!messageContent.find(c => c.type === 'image_url'),
            hasTextPrompt: !!messageContent.find(c => c.type === 'text'),
            imageDataLength: imageData ? imageData.length : 0,
            imageDataPreview: imageData ? imageData.substring(0, 50) + '...' : 'none'
        });
        
        // Check if image is too large - XAI has issues with large base64 images
        const imageSizeMB = imageData ? (imageData.length * 0.75) / (1024 * 1024) : 0; // base64 is ~33% larger
        console.log('XAI Debug - Image size (estimated MB):', imageSizeMB.toFixed(2));
        
        // XAI Vision API has problems with base64 images but works with URLs
        // For now, let's reduce the image size if it's too large
        let processedImageData = imageData;
        if (imageSizeMB > 0.5) { // More than 0.5MB, compress it
            console.log('XAI Debug - Image too large, need to compress or use different approach');
            // For now, truncate the base64 data (this is a temporary hack)
            const maxLength = Math.floor(700000 * 0.75); // Roughly 0.5MB in base64
            processedImageData = imageData.substring(0, maxLength);
            console.log('XAI Debug - Compressed image to length:', processedImageData.length);
        }

        // Update message content with potentially compressed image
        const finalMessageContent = [
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

        console.log('XAI Debug - Making API call with processed image...');
        
        const completion = await PROVIDERS.xai.client.chat.completions.create({
            model: model || 'grok-4',
            messages: [
                {
                    role: 'user',
                    content: finalMessageContent
                }
            ],
            max_tokens: 4000
        });
        
        // Debug the completion object structure
        console.log('=== OCR Response Structure Debug ===');
        console.log('Completion type:', typeof completion);
        console.log('Has choices:', !!completion.choices);
        console.log('Choices length:', completion.choices?.length);
        console.log('Content exists:', !!completion.choices?.[0]?.message?.content);
        console.log('Raw message content (direct access):');
        console.log('---RAW CONTENT START---');
        console.log(completion.choices?.[0]?.message?.content || 'NO CONTENT FOUND');
        console.log('---RAW CONTENT END---');
        
        const extractedText = completion.choices?.[0]?.message?.content || 'No text detected';
        
        // Debug logging for XAI Vision response
        console.log('=== XAI Vision OCR Debug ===');
        console.log('Content extraction path: completion.choices[0].message.content');
        console.log('Extracted text length:', extractedText.length);
        console.log('FULL OCR EXTRACTED TEXT:');
        console.log('---START FULL TEXT---');
        console.log(extractedText);
        console.log('---END FULL TEXT---');
        console.log('Usage data:', completion.usage);
        console.log('=== End XAI Vision Debug ===');
        
        return {
            extractedText: extractedText,
            confidence: 0.95, // XAI Vision is generally very accurate
            provider: 'xai-vision',
            model: model || 'grok-4',
            usage: completion.usage
        };
        
    } catch (error) {
        console.error('XAI Vision API error:', error);
        console.error('Error type:', error.constructor.name);
        console.error('Error code:', error.code);
        console.error('Error cause:', error.cause);
        
        // Just throw the XAI error - no fallback to other providers
        throw new Error(`XAI Vision failed: ${error.message}`);
    }
}

async function processWithAzureOCR(imageData, model = 'default') {
    // Azure Computer Vision API implementation
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
            
            // Get operation ID from the operation URL
            const operationId = readResult.operationLocation.split('/').slice(-1)[0];
            
            // Wait for the operation to complete
            let result;
            do {
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
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
            console.log('Azure Computer Vision credentials not configured, using OpenAI Vision as fallback');
            return await processWithOpenAIVision(imageData, model);
        }
        
    } catch (error) {
        console.error('Azure Computer Vision error:', error);
        console.log('Falling back to OpenAI Vision');
        return await processWithOpenAIVision(imageData, model);
    }
}

async function processWithAWSTextract(imageData, model = 'default') {
    // AWS Textract implementation
    try {
        console.log('Processing with AWS Textract, model:', model);
        
        // Placeholder for AWS Textract API call
        // const { TextractClient, DetectDocumentTextCommand } = require('@aws-sdk/client-textract');
        
        // For now, return mock data
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

async function processWithTesseract(imageData, model = 'default') {
    // Tesseract.js implementation for local OCR
    try {
        console.log('Processing with Tesseract (local), model:', model);
        
        const Tesseract = require('tesseract.js');
        
        // Configure Tesseract options based on model
        let tesseractOptions = {
            logger: m => console.log(m) // Optional logging
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
        
        // Convert base64 to buffer
        const imageBuffer = Buffer.from(imageData, 'base64');
        
        // Perform OCR
        const { data: { text, confidence } } = await Tesseract.recognize(imageBuffer, 'eng', tesseractOptions);
        
        return {
            extractedText: text.trim(),
            confidence: confidence / 100, // Tesseract returns confidence as 0-100, normalize to 0-1
            provider: 'tesseract',
            model: model
        };
        
    } catch (error) {
        console.error('Tesseract error:', error);
        
        // Fallback to OpenAI Vision if Tesseract fails
        console.log('Tesseract failed, falling back to OpenAI Vision');
        return await processWithOpenAIVision(imageData, model);
    }
}

const { 
    initializeLLMClients, 
    createCompletion, 
    trackCompletion,
    PROVIDERS 
} = require('../utils/llmProviders.js');

// LLM Post-processing function
async function postProcessWithLLM(ocrText, llmProvider, llmModel, userId) {
    try {
        console.log(`Post-processing OCR with ${llmProvider}:${llmModel}`);
        console.log('=== LLM Input Debug ===');
        console.log('Original OCR text length:', ocrText?.length || 0);
        console.log('FULL ORIGINAL OCR TEXT BEING PROCESSED:');
        console.log('---START ORIGINAL OCR---');
        console.log(ocrText || 'NO OCR TEXT PROVIDED');
        console.log('---END ORIGINAL OCR---');
        console.log('=== End LLM Input Debug ===');
        
        // Check if user can make LLM API call
        const canMakeCall = await canMakeApiCall(userId, 'openai'); // For now, use openai limits for all providers
        if (!canMakeCall.canMake) {
            console.log('LLM API call blocked:', canMakeCall.reason);
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

        let response, inputTokens, outputTokens, modelUsed;
        
        // Initialize LLM clients
        await initializeLLMClients();
        
        // Use unified completion function
        modelUsed = llmModel || (llmProvider === 'xai' ? 'grok-4' : 'o1-mini');
        response = await createCompletion(llmProvider, modelUsed, [
            { role: 'user', content: prompt }
        ], {
            maxTokens: 4000,
            temperature: 0.3
        });
        
        // Track usage using unified function
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

// @desc    Extract text from image using OCR
// @route   POST /api/data/ocr-extract  
// @access  Private
const extractOCR = asyncHandler(async (req, res) => {
    console.log('OCR extraction request received');
    
    try {
        await checkIP(req);
        console.log('IP check passed');
    } catch (error) {
        console.error('IP check failed:', error);
        res.status(403);
        throw new Error(`IP check failed: ${error.message}`);
    }
    
    // Check for user authentication
    if (!req.user) {
        console.error('No user found in request');
        res.status(401);
        throw new Error('User not found');
    }
    
    console.log(`User authenticated: ${req.user.id}`);

    const { imageData, contentType, filename, method, model, llmProvider, llmModel } = req.body;
    
    console.log('Request data:', {
        hasImageData: !!imageData,
        imageDataLength: imageData ? imageData.length : 0,
        contentType,
        filename,
        method,
        model,
        llmProvider,
        llmModel
    });
    
    if (!imageData) {
        console.error('No image data provided');
        res.status(400);
        throw new Error('No image data provided');
    }

    if (!contentType || !contentType.startsWith('image/')) {
        console.error('Invalid content type:', contentType);
        res.status(400);
        throw new Error('Invalid content type. Must be an image');
    }

    console.log(`OCR extraction request - Method: ${method}, Model: ${model}, File: ${filename}`);
    
    try {
        let ocrResult;
        
        // Route to appropriate OCR provider
        switch (method) {
            case 'xai-vision':
                ocrResult = await processWithXAIVision(imageData, model);
                break;
            case 'openai-vision':
                ocrResult = await processWithOpenAIVision(imageData, model);
                break;
            case 'google-vision':
                ocrResult = await processWithGoogleVision(imageData, model);
                break;
            case 'azure-ocr':
                ocrResult = await processWithAzureOCR(imageData, model);
                break;
            case 'aws-textract':
                ocrResult = await processWithAWSTextract(imageData, model);
                break;
            case 'tesseract':
                ocrResult = await processWithTesseract(imageData, model);
                break;
            default:
                // Default to XAI Vision as requested
                ocrResult = await processWithXAIVision(imageData, model);
                break;
        }
        
        console.log('=== OCR Processing Complete ===');
        console.log('OCR Method used:', method);
        console.log('OCR Provider:', ocrResult?.provider);
        console.log('OCR Confidence:', ocrResult?.confidence);
        console.log('OCR FULL RESULT TEXT:');
        console.log('---START OCR RESULT---');
        console.log(ocrResult?.extractedText || 'No text extracted');
        console.log('---END OCR RESULT---');
        console.log('=== End OCR Processing ===');
        
        // Post-process with LLM if provider is specified
        let finalResult = ocrResult;
        if (llmProvider && llmProvider !== 'none') {
            console.log(`Starting LLM post-processing with ${llmProvider}:${llmModel}`);
            const llmResult = await postProcessWithLLM(
                ocrResult.extractedText, 
                llmProvider, 
                llmModel, 
                req.user.id
            );
            
            if (llmResult.error) {
                // If LLM processing fails, still return OCR results with error info
                console.log('=== LLM Post-Processing Failed ===');
                console.log('LLM Error:', llmResult.error);
                console.log('LLM Reason:', llmResult.reason);
                console.log('Returning original OCR text only');
                console.log('=== End LLM Error Debug ===');
                
                finalResult = {
                    ...ocrResult,
                    llmError: llmResult.error,
                    llmReason: llmResult.reason
                };
            } else {
                // Merge LLM results with OCR results
                finalResult = {
                    ...ocrResult,
                    extractedText: llmResult.enhancedText,
                    originalOcrText: ocrResult.extractedText,
                    llmProvider: llmResult.provider,
                    llmModel: llmResult.model
                };
                
                console.log('=== LLM Post-Processing Complete ===');
                console.log('LLM Provider:', llmResult.provider);
                console.log('LLM Model:', llmResult.model);
                console.log('Original OCR text length:', ocrResult.extractedText?.length);
                console.log('Enhanced text length:', llmResult.enhancedText?.length);
                console.log('FULL ENHANCED TEXT:');
                console.log('---START ENHANCED TEXT---');
                console.log(llmResult.enhancedText);
                console.log('---END ENHANCED TEXT---');
                console.log('=== End LLM Post-Processing ===');
            }
        }
        
        // Add metadata to the result
        const response = {
            ...finalResult,
            filename: filename,
            contentType: contentType,
            processedAt: new Date().toISOString(),
            userId: req.user.id
        };
        
        console.log(`OCR processing completed - Provider: ${finalResult.provider}, Confidence: ${finalResult.confidence}`);
        if (llmProvider && !finalResult.llmError) {
            console.log(`LLM enhancement completed - Provider: ${llmProvider}, Model: ${llmModel}`);
        }
        
        res.status(200).json(response);
        
    } catch (error) {
        console.error('OCR extraction error:', error);
        console.error('Error stack:', error.stack);
        
        // More specific error handling
        if (error.code === 'insufficient_quota') {
            res.status(429).json({ error: 'OpenAI API quota exceeded. Please check your billing.' });
        } else if (error.code === 'invalid_api_key') {
            res.status(401).json({ error: 'Invalid OpenAI API key' });
        } else if (error.message.includes('network')) {
            res.status(503).json({ error: 'Network error connecting to OCR service' });
        } else {
            res.status(500).json({ 
                error: `OCR processing failed: ${error.message}`,
                details: error.code || 'Unknown error code',
                timestamp: new Date().toISOString()
            });
        }
    }
});

// @desc    Update data item with OCR results
// @route   PUT /api/data/ocr-update/:id
// @access  Private  
const updateWithOCR = asyncHandler(async (req, res) => {
    await checkIP(req);
    
    // Check for user authentication
    if (!req.user) {
        res.status(401);
        throw new Error('User not found');
    }

    const itemId = req.params.id;
    const { ocrText, originalText } = req.body;
    
    if (!ocrText) {
        res.status(400);
        throw new Error('No OCR text provided');
    }

    console.log(`OCR update request for item: ${itemId}`);
    
    try {
        // First, scan for the item to verify ownership and get current data
        const scanParams = {
            TableName: 'Simple',
            FilterExpression: 'id = :itemId',
            ExpressionAttributeValues: {
                ':itemId': itemId
            }
        };

        const scanResult = await dynamodb.send(new ScanCommand(scanParams));
        
        if (!scanResult.Items || scanResult.Items.length === 0) {
            res.status(404);
            throw new Error('Data item not found');
        }

        const item = scanResult.Items[0];
        
        // Check ownership
        if (item.text && item.text.includes('Creator:')) {
            const dataCreator = item.text.substring(item.text.indexOf("Creator:") + 8, item.text.indexOf("Creator:") + 8 + 24);
            if (dataCreator !== req.user.id) {
                res.status(401);
                throw new Error('User not authorized to update this item');
            }
        }

        // Update the text with OCR results
        // Find the Action: field and append OCR text
        let updatedText = item.text;
        
        // Look for |Action: pattern and insert OCR text
        const actionMatch = updatedText.match(/(\|Action:)([^|]*?)(\||$)/);
        if (actionMatch) {
            // If there's already text in Action field, append OCR text
            const existingActionText = actionMatch[2];
            const newActionText = existingActionText.trim() ? 
                `${existingActionText.trim()}\n\nRich Action Data Extracted:\n${ocrText}` : 
                `Rich Action Data Extracted:\n${ocrText}`;
            
            updatedText = updatedText.replace(
                actionMatch[0], 
                `${actionMatch[1]}${newActionText}${actionMatch[3] ? actionMatch[3] : ''}`
            );
        } else {
            // If no Action field exists, add one
            updatedText += `|Action:Rich Action Data Extracted:\n${ocrText}`;
        }

        // Update the item in DynamoDB
        const putParams = {
            TableName: 'Simple',
            Item: {
                ...item,
                text: updatedText,
                updatedAt: new Date().toISOString()
            }
        };

        await dynamodb.send(new PutCommand(putParams));

        console.log(`Successfully updated item ${itemId} with OCR results`);
        
        res.status(200).json({
            success: true,
            message: 'Item updated with OCR results',
            updatedItem: putParams.Item
        });
        
    } catch (error) {
        console.error('Error updating item with OCR:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: `Failed to update item: ${error.message}` });
        }
    }
});

module.exports = {
    extractOCR,
    updateWithOCR
};