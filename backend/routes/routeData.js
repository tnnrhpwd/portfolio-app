// Import necessary dependencies
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { authLimiter, paymentLimiter } = require('../middleware/rateLimiter');
const { 
  validateRegistration, 
  validateLogin, 
  validateDataCreation,
  validatePaymentData,
  handleValidationErrors 
} = require('../middleware/validation');
const { logSecurityEvent } = require('../middleware/logger');
const multer = require('multer');

// Configure multer for memory storage (or disk storage if preferred)
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 5 // Maximum 5 files
  },
  fileFilter: (req, file, cb) => {
    // Allow only specific file types
    const allowedTypes = /jpeg|jpg|png|gif|pdf|txt|doc|docx/;
    const extname = allowedTypes.test(file.originalname.toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images, PDFs, and documents are allowed.'));
    }
  }
});

// Diagnostic logging for incoming requests BEFORE body parsing
router.use((req, res, next) => {
  console.log(`[DEBUG] Incoming request: ${req.method} ${req.originalUrl}`);
  next();
});

// Middleware for parsing JSON and URL-encoded request bodies
router.use(express.json());
router.use(express.urlencoded({ extended: false }));

// Diagnostic logging AFTER body parsing
router.use((req, res, next) => {
  // Only log body for non-sensitive routes and if body is not too large
  if (!req.originalUrl.includes('login') && !req.originalUrl.includes('register') && 
      JSON.stringify(req.body).length < 1000) {
    console.log('[DEBUG] Request Body After Parsing:', JSON.stringify(req.body, null, 2));
  }
  next();
});

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

// Public routes with validation
router.post('/register', 
  authLimiter,
  validateRegistration, 
  handleValidationErrors, 
  (req, res, next) => {
    logSecurityEvent('user_registration_attempt', { email: req.body.email }, req);
    next();
  },
  registerUser
);

router.post('/login', 
  authLimiter,
  validateLogin, 
  handleValidationErrors,
  (req, res, next) => {
    logSecurityEvent('user_login_attempt', { email: req.body.email }, req);
    next();
  },
  loginUser
);

router.route('/public') 
  .get(getData) // GET request for fetching public data
  .post(validateDataCreation, handleValidationErrors, postData); // POST request for creating public data

// Protected routes
router.get('/all/admin', protect, getAllData); // GET request for fetching all data (admin only)
router.post('/compress', protect, compressData); // Route to handle data compression

// Customer routes and specific paths should come before generic routes like /:id
router.post('/create-customer', protect, paymentLimiter, createCustomer); // Protect customer creation
router.post('/create-invoice', protect, paymentLimiter, createInvoice); // Protect invoice creation
router.post('/subscribe-customer', protect, paymentLimiter, subscribeCustomer); // Protect customer subscription
router.get('/subscription', protect, getUserSubscription); // GET request for fetching user subscriptions

router.route('/pay-methods')
  .get(protect, getPaymentMethods) // GET payment methods
  .put(protect, paymentLimiter, validatePaymentData, handleValidationErrors, putPaymentMethod) // PUT payment methods
  .post(protect, paymentLimiter, validatePaymentData, handleValidationErrors, postPaymentMethod); // POST payment methods

router.delete('/pay-methods/:id', protect, paymentLimiter, deletePaymentMethod); // DELETE request for deleting a payment method
router.put('/update-customer/:id', protect, paymentLimiter, updateCustomer); // PUT request for updating customer
router.delete('/delete-customer/:id', protect, paymentLimiter, deleteCustomer); // DELETE request for deleting customer

// Customer routes with payment rate limiting
router.post('/create-customer', protect, paymentLimiter, createCustomer);
router.post('/create-invoice', protect, paymentLimiter, createInvoice);
router.post('/subscribe-customer', protect, paymentLimiter, subscribeCustomer);

// Webhook route
router.post('/webhook', express.raw({ type: 'application/json' }), handleWebhook);

// More specific routes must come before generic ones
router.route('/public/:id')
  .delete(protect, deleteData) // DELETE public data
  .put(protect, putData); // PUT public data

// Now the more generic routes
router.route('/')
  .get(protect, getHashData) // GET protected data
  .post(protect, upload.any(), postHashData); // POST protected data - Added multer middleware upload.any()

router.route('/:id')
  .delete(protect, deleteHashData) // DELETE protected data
  .put(protect, putHashData); // PUT protected data

module.exports = router; // Export the router