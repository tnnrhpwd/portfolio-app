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
const { forgotPassword, resetPassword } = require('./passwordReset'); // Password reset functionality

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
    forgotPassword, resetPassword,
};
