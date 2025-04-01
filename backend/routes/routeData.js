// Import necessary dependencies
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');

// Import controller functions
const {
  deleteData,
  deleteHashData, deletePaymentMethod, deleteCustomer,
  getData, getUserSubscription,
  getHashData, getPaymentMethods, getAllData,
  postData, registerUser, loginUser,
  postHashData, compressData, createCustomer, 
  postPaymentMethod, createInvoice, subscribeCustomer, 
  handleWebhook,
  putData,
  putHashData, putPaymentMethod, updateCustomer,
} = require('../controllers');

// Public routes
router.post('/register', registerUser); // Route to handle user registration
router.post('/login', loginUser); // Route to handle user login

router.route('/public') 
  .get(getData) // GET request for fetching public data
  .post(postData); // POST request for creating public data

// Protected routes
router.get('/all/admin', protect, getAllData); // GET request for fetching all data (admin only)
router.post('/compress', protect, compressData); // Route to handle data compression

// Customer routes and specific paths should come before generic routes like /:id
router.post('/create-customer', protect, createCustomer); // Protect customer creation
router.post('/create-invoice', protect, createInvoice); // Protect invoice creation
router.post('/subscribe-customer', protect, subscribeCustomer); // Protect customer subscription
router.get('/subscription', protect, getUserSubscription); // GET request for fetching user subscriptions

router.route('/pay-methods')
  .get(protect, getPaymentMethods) // GET payment methods
  .put(protect, putPaymentMethod) // PUT payment methods
  .post(protect, postPaymentMethod); // POST payment methods

router.delete('/pay-methods/:id', protect, deletePaymentMethod); // DELETE request for deleting a payment method
router.put('/update-customer/:id', protect, updateCustomer); // PUT request for updating customer
router.delete('/delete-customer/:id', protect, deleteCustomer); // DELETE request for deleting customer

// Webhook route
router.post('/webhook', express.raw({ type: 'application/json' }), handleWebhook);

// Now the more generic routes
router.route('/')
  .get(protect, getHashData) // GET protected data
  .post(protect, postHashData); // POST protected data

router.route('/:id')
  .delete(protect, deleteHashData) // DELETE protected data
  .put(protect, putHashData); // PUT protected data

router.route('/public/:id')
  .delete(protect, deleteData) // DELETE public data
  .put(protect, putData); // PUT public data

module.exports = router; // Export the router