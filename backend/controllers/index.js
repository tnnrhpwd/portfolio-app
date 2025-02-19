// controllers/index.js

const {setData,upload} = require('./setData');
const {getHashData, getAllData} = require('./getHashData');
const {getPublicData} = require('./getData');
const {updateData} = require('./updateData');
const {compressData} = require('./compressData');
const {deleteData} = require('./deleteData');
const {registerUser} = require('./registerUser');
const {loginUser} = require('./loginUser');
const Data = require('../models/dataModel');
const { handleWebhook, 
  createCustomer, 
  createSetupIntent, 
  createInvoice, 
  getPaymentMethods, 
  deletePaymentMethod 
} = require('./stripeData');

module.exports = {
  setData,
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
