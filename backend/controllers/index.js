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
    handleWebhook, setCustomLimit } = require('./postHashData'); // CREATE protected data
const { putData } = require('./putData'); // UPDATE public data
const { putHashData, updateCustomer, putPaymentMethod } = require('./putHashData'); // UPDATE protected data
const { forgotPassword, resetPassword, forgotPasswordAuthenticated } = require('../utils/passwordReset'); // Password reset functionality
const { extractOCR, updateWithOCR } = require('./ocrController'); // OCR functionality
const { getAvailableProviders } = require('../utils/llmProviders'); // LLM providers

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

module.exports = {
    deleteData,
    deleteHashData, deletePaymentMethod, deleteCustomer,
    getData, getUserSubscription, getUserStorage,
    getHashData, getPaymentMethods, getAllData, getMembershipPricing, getUserUsageData,
    postData, registerUser, loginUser,
    postHashData, compressData, createCustomer,
    postPaymentMethod, createInvoice, subscribeCustomer,
    handleWebhook, setCustomLimit,
    putData,
    putHashData, updateCustomer, putPaymentMethod,
    forgotPassword, resetPassword, forgotPasswordAuthenticated,
    extractOCR, updateWithOCR,
    getLLMProviders,
};
