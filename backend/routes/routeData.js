// Import necessary dependencies
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');

// Import controller functions
const { handleWebhook, createCustomer, createSetupIntent, createInvoice, setData, getData, getAllData, getPublicData, updateData, compressData, deleteData, registerUser, loginUser } = require('../controllers/index.js');

// Routes
router.route('/')
  .get(protect, getData) // GET request for fetching protected data

router.route('/:id')
  .delete(protect, deleteData) // DELETE request for deleting data
  .put(protect, updateData); // PUT request for updating data

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