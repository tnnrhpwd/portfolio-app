// controllers/index.js

const { deleteData } = require('./deleteData');  // DELETE public data
const { deleteHashData, deletePaymentMethod,
    deleteCustomer } = require('./deleteHashData'); // DELETE deleting protected data
const { getData, getUserSubscription, getUserStorage } = require('./getData'); // GET public data
const { getHashData, getPaymentMethods, getAllData, getUserUsageData } = require('./getHashData'); // GET protected data
const { getMembershipPricing } = require('../utils/getMembershipPricing'); // GET membership pricing
const { postData, registerUser, loginUser } = require('./postData'); // CREATE public data
const { postHashData, compressData, createCustomer,
    postPaymentMethod, createInvoice, subscribeCustomer,
    handleWebhook, setCustomLimit, processFileUpload } = require('./postHashData'); // CREATE protected data
const { putData } = require('./putData'); // UPDATE public data
const { putHashData, updateCustomer, putPaymentMethod } = require('./putHashData'); // UPDATE protected data
const { forgotPassword, resetPassword, forgotPasswordAuthenticated } = require('../utils/passwordReset'); // Password reset functionality
const { extractOCR, updateWithOCR } = require('./ocrController'); // OCR functionality
const { getAvailableProviders } = require('../utils/llmProviders'); // LLM providers
const { getAdminDashboard, getAdminUsers, getAdminPaginatedData } = require('./adminController'); // Admin dashboard
const { initTestFunnel, resetTestFunnel, getTestFunnelStatus, recordFunnelStep, getTestEmails } = require('./testFunnelController'); // Test funnel

// @desc    Get available LLM providers and models
// @route   GET /api/data/llm-providers
// @access  Public
const getLLMProviders = (req, res) => {
    try {
        const providers = getAvailableProviders();
        res.status(200).json({
            success: true,
            providers: providers
        });
    } catch (error) {
        console.error('Error getting LLM providers:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get available providers'
        });
    }
};

// @desc    Get Stripe publishable key (returns test key for funnel test user)
// @route   GET /api/data/stripe-config
// @access  Public (optionally auth-aware)
const getStripeConfig = (req, res) => {
    // If the authenticated user is the active test funnel user, return the test key
    const { getTestUserId } = require('./testFunnelController');
    const activeTestUserId = getTestUserId();
    const isTestUser = activeTestUserId && req.user && req.user.id === activeTestUserId;

    const publishableKey = isTestUser
        ? (process.env.TEST_STRIPE_PUBLIC_KEY || process.env.STRIPE_PUBLIC_KEY)
        : process.env.STRIPE_PUBLIC_KEY;

    if (!publishableKey) {
        return res.status(500).json({ success: false, error: 'Stripe is not configured' });
    }
    res.status(200).json({ success: true, publishableKey, testMode: !!isTestUser });
};

module.exports = {
    deleteData,
    deleteHashData, deletePaymentMethod, deleteCustomer,
    getData, getUserSubscription, getUserStorage,
    getHashData, getPaymentMethods, getAllData, getMembershipPricing, getUserUsageData,
    postData, registerUser, loginUser,
    postHashData, compressData, createCustomer,
    postPaymentMethod, createInvoice, subscribeCustomer,
    handleWebhook, setCustomLimit, processFileUpload,
    putData,
    putHashData, updateCustomer, putPaymentMethod,
    forgotPassword, resetPassword, forgotPasswordAuthenticated,
    extractOCR, updateWithOCR,
    getLLMProviders,
    getStripeConfig,
    getAdminDashboard, getAdminUsers, getAdminPaginatedData,
    initTestFunnel, resetTestFunnel, getTestFunnelStatus, recordFunnelStep, getTestEmails,
};
