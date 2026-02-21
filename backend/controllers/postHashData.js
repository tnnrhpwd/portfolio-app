// Main controller file - orchestrates business logic through service calls

const asyncHandler = require('express-async-handler');
const { checkIP } = require('../utils/accessData.js');
const { sendEmail } = require('../services/emailService.js');

// Import service modules
const { 
    validateAndProcessFiles, 
    parseRequestData, 
    createDynamoDBItem,
    dynamodb 
} = require('../services/dataService.js');

const { 
    processCompressionRequest 
} = require('../services/llmService.js');

const {
    parseFileInstruction,
    processFile: executeFileProcessing,
} = require('../services/fileProcessingService.js');

const {
    createOrValidateCustomer,
    validateOrRecoverCustomer,
    updateUserCustomerId,
    attachPaymentMethod,
    createSetupIntent,
    extractCustomerId,
    extractEmail,
    extractName,
    updateUserRank,
    getCurrentMembershipType,
    cancelActiveSubscriptions,
    getOrCreatePriceId,
    createSubscription,
    stripe
} = require('../services/stripeService.js');

const {
    constructWebhookEvent,
    processWebhookEvent,
    processCustomLimitUpdate
} = require('../services/webhookService.js');

const Data = require('../models/dataModel');
require('dotenv').config();

// @desc    Set data
// @route   POST /api/data
// @access  Private
const postHashData = asyncHandler(async (req, res) => {
    console.log('postHashData called');
    console.log('req.body keys:', Object.keys(req.body));
    console.log('req.body.data:', req.body.data);
    console.log('req.files length:', req.files ? req.files.length : 0);
    
    await checkIP(req);

    if (!req.user) {
        res.status(401);
        throw new Error('User not found');
    }

    if (Object.keys(req.body).length === 0 && (!req.files || req.files.length === 0)) {
        res.status(400);
        throw new Error('Request body and files are missing');
    }

    try {
        // Process files if any
        const filesData = validateAndProcessFiles(req.files);
        
        // Parse request data
        const { textContent, actionGroupObjectContent } = parseRequestData(req, filesData);
        
        // Create DynamoDB item
        const item = await createDynamoDBItem(
            req.user.id, 
            textContent, 
            actionGroupObjectContent, 
            filesData
        );
        
        res.status(200).json(item);
    } catch (error) {
        console.error('Error in postHashData:', error);
        const statusCode = error.statusCode || 500;
        res.status(statusCode).json({ 
            error: error.message || 'Failed to create data',
            details: error.details
        });
    }
});

// @desc    Compress Data
// @route   POST /api/compress
// @access  Private
const compressData = asyncHandler(async (req, res) => {
    await checkIP(req);
    
    if (!req.user) {
        res.status(401);
        throw new Error('User not found');
    }

    try {
        const result = await processCompressionRequest(req, dynamodb);
        res.status(result.status).json(result.data);
    } catch (error) {
        console.error('Error in compressData:', error);
        
        if (error.statusCode === 402 && error.details) {
            return res.status(402).json(error.details);
        }
        
        const statusCode = error.statusCode || 500;
        res.status(statusCode).json({ 
            error: error.message || 'An error occurred during compression' 
        });
    }
});

// @desc    Create or validate Stripe customer
// @route   POST /api/customer
// @access  Private
const createCustomer = asyncHandler(async (req, res) => {
    if (!req.user) {
        res.status(401);
        throw new Error('User not found');
    }
    
    if (!req.user.text) {
        res.status(400);
        throw new Error('User data not found or incomplete');
    }
    
    try {
        const { customer, message } = await createOrValidateCustomer(req, dynamodb);
        
        res.status(201).json({
            success: true,
            customer: customer,
            message: message
        });
    } catch (error) {
        console.error('Customer creation/assignment failed:', error);
        res.status(500);
        throw new Error('Customer creation/assignment failed');
    }
});

// @desc    Create a setup intent or attach a payment method
// @route   POST /api/payment-method
// @access  Private
const postPaymentMethod = asyncHandler(async (req, res) => {
    if (!req.user) {
        res.status(401);
        throw new Error('User not found');
    }
    
    if (!req.user.text) {
        res.status(400);
        throw new Error('User data not found or incomplete');
    }
    
    console.log('Request body:', req.body);
    console.log('req.user.text:', req.user.text);

    try {
        const customerId = extractCustomerId(req.user.text);
        
        if (!customerId || customerId.trim() === '') {
            console.log('No Stripe customer ID found');
            return res.status(400).json({
                success: false,
                message: 'No customer ID found. Please create a customer first.',
                code: 'CUSTOMER_REQUIRED'
            });
        }
        
        console.log('Extracted Customer ID:', customerId);
        
        // Validate and potentially recover customer ID
        const email = extractEmail(req.user.text);
        const name = extractName(req.user.text);
        let finalCustomerId = customerId;
        
        try {
            const validatedCustomer = await validateOrRecoverCustomer(customerId, email, name);
            
            if (validatedCustomer.id !== customerId) {
                // Customer ID was recovered/updated
                await updateUserCustomerId(dynamodb, req.user, validatedCustomer.id);
                finalCustomerId = validatedCustomer.id;
            }
        } catch (recoveryError) {
            console.error('Failed to recover customer ID:', recoveryError.message);
            return res.status(500).json({
                success: false,
                message: 'Failed to validate or recover customer ID',
                details: recoveryError.message
            });
        }
        
        console.log('Final customer ID:', finalCustomerId);
        
        // Handle payment method attachment or setup intent creation
        if (req.body.paymentMethodId) {
            try {
                const paymentMethod = await attachPaymentMethod(req.body.paymentMethodId, finalCustomerId);
                res.status(200).json(paymentMethod);
            } catch (attachError) {
                console.error('Payment method attachment failed:', attachError.message);
                
                // Retry with recovery if needed
                if (attachError.code === 'resource_missing') {
                    try {
                        const recoveredCustomer = await validateOrRecoverCustomer(customerId, email, name);
                        await updateUserCustomerId(dynamodb, req.user, recoveredCustomer.id);
                        const paymentMethod = await attachPaymentMethod(req.body.paymentMethodId, recoveredCustomer.id);
                        res.status(200).json(paymentMethod);
                    } catch (recoveryError) {
                        console.error('Recovery failed:', recoveryError.message);
                        res.status(500).json({ 
                            error: 'Failed to attach payment method',
                            details: recoveryError.message
                        });
                    }
                } else {
                    throw attachError;
                }
            }
        } else {
            try {
                const setupIntent = await createSetupIntent(finalCustomerId);
                res.status(200).json(setupIntent);
            } catch (setupIntentError) {
                console.error('Setup intent creation failed:', setupIntentError.message);
                
                // Retry with recovery if needed
                if (setupIntentError.code === 'resource_missing') {
                    try {
                        const recoveredCustomer = await validateOrRecoverCustomer(customerId, email, name);
                        await updateUserCustomerId(dynamodb, req.user, recoveredCustomer.id);
                        const setupIntent = await createSetupIntent(recoveredCustomer.id);
                        res.status(200).json(setupIntent);
                    } catch (recoveryError) {
                        console.error('Recovery failed:', recoveryError.message);
                        res.status(500).json({ 
                            error: 'Failed to create setup intent',
                            details: recoveryError.message
                        });
                    }
                } else {
                    throw setupIntentError;
                }
            }
        }
    } catch (error) {
        console.error('Payment method operation failed:', error);
        res.status(500).json({ error: error.message });
    }
});

// @desc    Create invoice
// @route   POST /api/invoice
// @access  Private
const createInvoice = asyncHandler(async (req, res) => {
    const { customerId, amount, description } = req.body;
    
    const { createInvoice: createInvoiceService } = require('../services/stripeService.js');
    const invoice = await createInvoiceService(customerId, amount, description);
    
    res.status(200).json(invoice);
});

// @desc    Subscribe customer to a membership plan
// @route   POST /api/subscribe
// @access  Private
const subscribeCustomer = asyncHandler(async (req, res) => {
    if (!req.user) {
        res.status(401);
        throw new Error('User not found');
    }

    const { paymentMethodId, membershipType, customPrice } = req.body;
    console.log('Subscription request:', { membershipType, paymentMethodId, customPrice });
    
    const customerId = extractCustomerId(req.user.text);
    if (!customerId) {
        res.status(400);
        throw new Error('Invalid customer ID format');
    }
    
    console.log('Customer ID for subscription management:', customerId);

    try {
        // Validate and potentially recover customer ID
        const email = extractEmail(req.user.text);
        const name = extractName(req.user.text);
        const validatedCustomer = await validateOrRecoverCustomer(customerId, email, name);
        let finalCustomerId = validatedCustomer.id;
        
        if (finalCustomerId !== customerId) {
            await updateUserCustomerId(dynamodb, req.user, finalCustomerId);
        }
        
        // No custom price validation needed - Pro and Simple use fixed Stripe prices
        
        const userEmail = extractEmail(req.user.text);
        
        // Get current membership type
        const currentMembership = await getCurrentMembershipType(finalCustomerId);
        console.log(`Current membership: ${currentMembership}, Requested membership: ${membershipType}`);
        
        // Prevent subscribing to current plan
        if (membershipType === currentMembership) {
            res.status(400);
            throw new Error(`You are already subscribed to the ${membershipType} plan`);
        }
        
        const oldPlan = currentMembership.charAt(0).toUpperCase() + currentMembership.slice(1);
        
        // Cancel active subscriptions
        await cancelActiveSubscriptions(finalCustomerId);
        
        // Handle free membership type
        if (membershipType === 'free') {
            await updateUserRank(finalCustomerId, 'Free');
            
            if (userEmail) {
                try {
                    await sendEmail(userEmail, 'subscriptionCancelled', {
                        plan: oldPlan,
                        userData: req.user.data
                    });
                } catch (emailError) {
                    console.error('Failed to send cancellation email:', emailError);
                }
            }
            
            res.status(200).json({ 
                success: true, 
                membershipType: 'free',
                message: 'Successfully switched to free plan'
            });
            return;
        }
        
        // Set default payment method if provided
        if (paymentMethodId) {
            await stripe.customers.update(finalCustomerId, {
                invoice_settings: {
                    default_payment_method: paymentMethodId,
                },
            });
        }
        
        // Get or create price ID
        const priceId = await getOrCreatePriceId(membershipType, customPrice);
        
        // Create subscription
        const subscription = await createSubscription(finalCustomerId, priceId);
        
        // Update user rank
        await updateUserRank(finalCustomerId, membershipType);
        
        // Send subscription confirmation email
        if (userEmail) {
            try {
                if (currentMembership === 'free') {
                    await sendEmail(userEmail, 'subscriptionCreated', {
                        plan: membershipType.charAt(0).toUpperCase() + membershipType.slice(1),
                        userData: req.user.data
                    });
                } else {
                    await sendEmail(userEmail, 'subscriptionUpdated', {
                        oldPlan: oldPlan,
                        newPlan: membershipType.charAt(0).toUpperCase() + membershipType.slice(1),
                        userData: req.user.data
                    });
                }
            } catch (emailError) {
                console.error('Failed to send subscription email:', emailError);
            }
        }
        
        const response = {
            subscriptionId: subscription.id,
            clientSecret: subscription.latest_invoice?.payment_intent?.client_secret,
            membershipType: membershipType,
            productName: membershipType === 'pro' ? 'Pro Membership' : 'Simple Membership'
        };
        
        res.status(200).json(response);
    } catch (error) {
        console.error('Error managing subscription:', error);
        
        if (membershipType === 'free') {
            try {
                const customerId = extractCustomerId(req.user.text);
                await updateUserRank(customerId, 'Free');
            } catch (fallbackError) {
                console.error('Fallback rank update failed:', fallbackError);
            }
        }
        
        res.status(500).json({ error: error.message });
    }
});

// @desc    Handle webhook events
// @route   POST /api/webhook
// @access  Public
const handleWebhook = asyncHandler(async (req, res) => {
    const result = constructWebhookEvent(req, process.env.STRIPE_WEBHOOK_SECRET);
    
    if (!result.success) {
        res.status(400).send(`Webhook Error: ${result.error}`);
        return;
    }
    
    processWebhookEvent(result.event);
    res.status(200).send();
});

// @desc    Set custom usage limit for Simple (top-tier) users
// @route   POST /api/custom-limit
// @access  Private
const setCustomLimit = asyncHandler(async (req, res) => {
    console.log('setCustomLimit called:', req.body);

    if (!req.user) {
        res.status(401);
        throw new Error('User not found');
    }

    try {
        const result = await processCustomLimitUpdate(req, dynamodb);
        res.status(200).json(result);
    } catch (error) {
        console.error('Error in setCustomLimit:', error);
        const statusCode = error.statusCode || 500;
        res.status(statusCode);
        throw error;
    }
});

// @desc    Process a file in-memory (convert, resize, compress, etc.) — nothing saved to DB
// @route   POST /api/data/process-file
// @access  Private
const processFileUpload = asyncHandler(async (req, res) => {
    if (!req.user) {
        res.status(401);
        throw new Error('User not found');
    }

    if (!req.file) {
        res.status(400);
        throw new Error('No file uploaded');
    }

    const instruction = req.body.instruction || '';
    if (!instruction.trim()) {
        res.status(400);
        throw new Error('No instruction provided. Tell me what to do with the file (e.g. "convert to jpg").');
    }

    try {
        const operation = parseFileInstruction(instruction, req.file.originalname);
        const result = await executeFileProcessing(req.file.buffer, req.file.originalname, operation);

        // Return the processed file as base64 so the frontend can trigger a download
        const base64 = result.buffer.toString('base64');

        res.status(200).json({
            success: true,
            description: result.description,
            file: {
                data: base64,
                filename: result.filename,
                mimeType: result.mimeType,
                size: result.buffer.length,
            },
        });
    } catch (error) {
        console.error('Error in processFileUpload:', error);
        const statusCode = error.statusCode || 500;
        res.status(statusCode).json({
            success: false,
            error: error.message || 'File processing failed',
        });
    }
});

module.exports = { 
    postHashData, 
    compressData, 
    processFileUpload,
    createCustomer, 
    postPaymentMethod, 
    createInvoice, 
    subscribeCustomer, 
    handleWebhook,
    setCustomLimit 
};
