// controllers/index.js

const { deleteData } = require('./deleteData');  // DELETE public data
const { deleteHashData, deletePaymentMethod, 
  deleteCustomer } = require('./deleteHashData'); // DELETE deleting protected data
const { getPublicData } = require('./getData'); // GET public data
const { getHashData, getPaymentMethods, getAllData } = require('./getHashData'); // GET protected data
const { postData, registerUser, loginUser } = require('./postData'); // CREATE public data
const { postHashData, compressData, createCustomer, 
  createSetupIntent, createInvoice, subscribeCustomer, 
  handleWebhook } = require('./postHashData'); // CREATE protected data
const { putData } = require('./putData'); // UPDATE public data
const { putHashData, updateCustomer } = require('./putHashData'); // UPDATE protected data
const {  } = require('./deleteCustomer');

module.exports = {
  deleteData,
  deleteHashData, deletePaymentMethod, deleteCustomer,
  getPublicData,
  getHashData, getPaymentMethods, getAllData,
  postData, registerUser, loginUser,
  postHashData, compressData, createCustomer, 
    createSetupIntent, createInvoice, subscribeCustomer, 
    handleWebhook,
  putData,
  putHashData,  updateCustomer,
};
