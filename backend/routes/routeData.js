// Import necessary dependencies
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');

// Import controller functions
const {
  handleWebhook,
  createCustomer,
  createSetupIntent,
  createInvoice,
  setData,
  getHashData,
  getAllData,
  getPublicData,
  updateData,
  compressData,
  deleteData,
  registerUser,
  loginUser,
  getPaymentMethods,
  deletePaymentMethod
} = require('../controllers');

// Routes
router.route('/')
  .get(protect, getHashData) // GET request for fetching protected data

router.route('/:id')
  .delete(protect, deleteData) // DELETE request for deleting data
  .put(protect, updateData); // PUT request for updating data

// Routes for payment methods
router.get('/payment-methods', protect, getPaymentMethods); // GET request for fetching payment methods
router.delete('/payment-methods/:id', protect, deletePaymentMethod); // DELETE request for deleting a payment method

router.post('/create-customer', createCustomer);
router.post('/create-setup-intent', createSetupIntent);
router.post('/create-invoice', createInvoice);

router.post('/compress', protect, compressData); // Route to handle data compression
router.post('/webhook', express.raw({ type: 'application/json' }), handleWebhook);

router.post('/register', registerUser); // Route to handle user registration
router.post('/login', loginUser); // Route to handle user login

// New route for fetching public data
router.get('/public', getPublicData); // GET request for fetching public data
router.get('/all', protect, getAllData); // GET request for fetching all data (admin only)

module.exports = router; // Export the router