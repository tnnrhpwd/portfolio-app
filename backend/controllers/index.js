// controllers/index.js

const { postData, upload: postUpload } = require('./postData');
const { setData, upload: setUpload } = require('./postHashData');
const { getHashData, getAllData } = require('./getHashData');
const { getPublicData } = require('./getData');
const { updateData } = require('./putData');
const { compressData } = require('./compressData');
const { deleteData } = require('./deleteData');
const { registerUser } = require('./registerUser');
const { loginUser } = require('./loginUser');
const { handleWebhook, 
  createCustomer, 
  createSetupIntent, 
  createInvoice, 
  getPaymentMethods, 
  deletePaymentMethod 
} = require('./stripeData');

module.exports = {
  postData,
  postUpload,
  setData,
  setUpload,
  getHashData,
  getPublicData,
  updateData,
  compressData,
  deleteData,
  registerUser,
  loginUser,
  getAllData,
  handleWebhook,
  createCustomer,
  createSetupIntent,
  createInvoice,
  getPaymentMethods, 
  deletePaymentMethod
};
