// Import necessary dependencies
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');

// Import controller functions
const {
  deleteData,
  deleteHashData, deletePaymentMethod, deleteCustomer,
  getPublicData,
  getHashData, getPaymentMethods, getAllData,
  postData, registerUser, loginUser,
  postHashData, compressData, createCustomer, 
  createSetupIntent, createInvoice, subscribeCustomer, 
  handleWebhook,
  putData,
  putHashData, updateCustomer,
} = require('../controllers');

router.route('/')
  .get(getHashData) // GET protected data
  .post(postHashData) // POST protected data

router.route('/:id')
  .delete(protect, deleteHashData) // DELETE protected data
  .put(protect, putHashData); // PUT protected data

router.get('/all', getPublicData); // GET request for fetching public data
router.get('/all/admin', protect, getAllData); // GET request for fetching all data (admin only)

router.post('/register', registerUser); // Route to handle user registration
router.post('/login', loginUser); // Route to handle user login

router.get('/pay-methods', protect, getPaymentMethods); // GET request for fetching payment methods
router.delete('/pay-methods/:id', protect, deletePaymentMethod); // DELETE request for deleting a payment method

// router.post('/create-customer', protect, createCustomer); // Protect customer creation
// router.post('/create-setup-intent', protect, createSetupIntent); // Protect setup intent creation
// router.post('/create-invoice', protect, createInvoice); // Protect invoice creation
// router.post('/subscribe-customer', protect, subscribeCustomer); // Protect customer subscription

// router.post('/compress', protect, compressData); // Route to handle data compression
// router.post('/webhook', express.raw({ type: 'application/json' }), handleWebhook);

// router.put('/update-customer/:id', protect, updateCustomer); // PUT request for updating customer
// router.delete('/delete-customer/:id', protect, deleteCustomer); // DELETE request for deleting customer

module.exports = router; // Export the router