const express = require('express');
const router = express.Router();
const { 
  getData, getUserSubscription, getHashData, getPaymentMethods, getAllData,
  postData, registerUser, loginUser, postHashData, compressData, createCustomer, 
  postPaymentMethod, createInvoice, subscribeCustomer, handleWebhook,
  putData, putHashData, updateCustomer, putPaymentMethod,
  deleteData, deleteHashData, deletePaymentMethod, deleteCustomer
} = require('../controllers');
const { protect } = require('../middleware/authMiddleware');

// Add a new route for geocoding - just add this to your existing routes file

// Import the geocoding controller
const { geocodeVisitorLocations } = require('../controllers/geocodingController');

// Import the map config controller
const { getMapConfig } = require('../controllers/mapConfigController');

// Add this route to your existing router
router.post('/geocode', protect, geocodeVisitorLocations);

// Add this route to your existing router
router.get('/map-config', protect, getMapConfig);

// Public routes
router.post('/register', registerUser);
router.post('/login', loginUser);
router.get('/public', getData);

// Private routes
router.route('/').post(protect, postData).get(protect, getHashData);
router.route('/:id').delete(protect, deleteData).put(protect, putData);
router.route('/compress').post(protect, compressData);
router.route('/all/admin').get(protect, getAllData);
router.route('/pay-methods').get(protect, getPaymentMethods).post(protect, postPaymentMethod);
router.route('/pay-methods/:id').delete(protect, deletePaymentMethod);
router.route('/subscribe-customer').post(protect, subscribeCustomer);
router.route('/subscription').get(protect, getUserSubscription);
router.route('/customer').post(protect, createCustomer).put(protect, updateCustomer);
router.route('/payment-method').put(protect, putPaymentMethod);
router.route('/invoice').post(protect, createInvoice);
router.route('/webhook').post(handleWebhook);

module.exports = router;