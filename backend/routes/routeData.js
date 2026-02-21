// routes/routeData.js - API Routes organized by functionality

const express = require('express');
const router = express.Router();
const multer = require('multer');

// ============================================================================
// Middleware Imports
// ============================================================================
const { protect } = require('../middleware/authMiddleware');
const { authLimiter, paymentLimiter } = require('../middleware/rateLimiter');
const { 
  validateRegistration, 
  validateLogin, 
  validateForgotPassword,
  validatePasswordReset,
  validateDataCreation,
  validatePaymentData,
  handleValidationErrors,
  sanitizeInput
} = require('../middleware/validation');
const { logSecurityEvent } = require('../utils/logger');

// ============================================================================
// Controller Imports
// ============================================================================

// Main controllers (from index.js)
const {
  deleteData, deleteHashData, deletePaymentMethod, deleteCustomer,
  getData, getUserSubscription, getUserStorage,
  getHashData, getPaymentMethods, getAllData, getMembershipPricing, getUserUsageData,
  postData, registerUser, loginUser,
  postHashData, compressData, createCustomer,
  postPaymentMethod, createInvoice, subscribeCustomer,
  handleWebhook, setCustomLimit, processFileUpload,
  putData, putHashData, updateCustomer, putPaymentMethod,
  forgotPassword, resetPassword, forgotPasswordAuthenticated,
  extractOCR, updateWithOCR,
  getLLMProviders,
} = require('../controllers');

// File upload controller
const {
  requestUploadUrl,
  confirmUpload,
  deleteUploadedFile
} = require('../controllers/fileUploadController');

// Analytics controller
const {
  getRefererAnalytics,
  getRefererData,
  getRefererSummary
} = require('../controllers/refererAnalytics');

// CSimple sync controller
const {
  getCSimpleSettings,
  updateCSimpleSettings,
  getCSimpleConversations,
  updateCSimpleConversations,
  getCSimpleBehaviors,
  getCSimpleBehavior,
  updateCSimpleBehavior,
  deleteCSimpleBehavior,
} = require('../controllers/csimpleController');

// Memory controller (Goals / Plans / Actions)
const {
  getMemory,
  createMemory,
  updateMemory,
  deleteMemory,
} = require('../controllers/memoryController');

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

// (Controllers imported above)

// ============================================================================
// PUBLIC ROUTES
// ============================================================================

// Authentication Routes
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

// Password Reset (Public)
router.post('/forgot-password', 
  authLimiter,
  validateForgotPassword,
  handleValidationErrors,
  (req, res, next) => {
    logSecurityEvent('password_reset_request', { email: req.body.email }, req);
    next();
  },
  forgotPassword
);

router.post('/reset-password', 
  authLimiter,
  validatePasswordReset,
  handleValidationErrors,
  (req, res, next) => {
    logSecurityEvent('password_reset_attempt', { token: req.body.token }, req);
    next();
  },
  resetPassword
);

// Public Data Routes
router.route('/public')
  .get(getData)
  .post(validateDataCreation, handleValidationErrors, postData);

router.route('/public/:id')
  .put(protect, putData)
  .delete(protect, deleteData);

// Membership & LLM Info
router.get('/membership-pricing', getMembershipPricing);
router.get('/llm-providers', getLLMProviders);

// Stripe Webhook (Public but signature-verified)
router.post('/webhook', express.raw({ type: 'application/json' }), handleWebhook);

// ============================================================================
// PROTECTED ROUTES (Authentication Required)
// ============================================================================

// Authenticated Password Reset
router.post('/forgot-password-authenticated', 
  protect,
  authLimiter,
  (req, res, next) => {
    logSecurityEvent('authenticated_password_reset_request', { 
      email: req.user?.email 
    }, req);
    next();
  },
  forgotPasswordAuthenticated
);

// ============================================================================
// DATA OPERATIONS
// ============================================================================

// Admin Routes
router.get('/all/admin', protect, getAllData);

// Data Compression
router.post('/compress', protect, compressData);

// File Processing (in-memory, no DB storage)
const fileProcessUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
}).single('file');
router.post('/process-file', protect, fileProcessUpload, processFileUpload);

// Protected Data CRUD
router.route('/')
  .get(protect, getHashData)
  .post(protect, upload.any(), postHashData);

router.route('/:id')
  .delete(protect, deleteHashData)
  .put(protect, putHashData);

// ============================================================================
// FILE UPLOAD (S3)
// ============================================================================

router.post('/upload-url', protect, requestUploadUrl);
router.post('/upload-confirm', protect, confirmUpload);
router.delete('/file/:s3Key', protect, deleteUploadedFile);

// ============================================================================
// OCR (Optical Character Recognition)
// ============================================================================

router.post('/ocr-extract', protect, extractOCR);
router.put('/ocr-update/:id', protect, updateWithOCR);

// ============================================================================
// USER ACCOUNT & USAGE
// ============================================================================

router.get('/subscription', protect, getUserSubscription);
router.get('/storage', protect, getUserStorage);
router.get('/usage', protect, getUserUsageData);

// ============================================================================
// PAYMENT & BILLING (Stripe)
// ============================================================================

// Customer Management
router.post('/create-customer', protect, paymentLimiter, createCustomer);
router.put('/update-customer/:id', protect, paymentLimiter, updateCustomer);
router.delete('/delete-customer/:id', protect, paymentLimiter, deleteCustomer);

// Payment Methods
router.route('/pay-methods')
  .get(protect, getPaymentMethods)
  .post(protect, paymentLimiter, validatePaymentData, handleValidationErrors, postPaymentMethod)
  .put(protect, paymentLimiter, validatePaymentData, handleValidationErrors, putPaymentMethod);

router.delete('/pay-methods/:id', protect, paymentLimiter, deletePaymentMethod);

// Billing & Subscriptions
router.post('/create-invoice', protect, paymentLimiter, createInvoice);
router.post('/subscribe-customer', protect, paymentLimiter, subscribeCustomer);
router.post('/custom-limit', protect, paymentLimiter, setCustomLimit);



// ============================================================================
// MEMORY (Goals / Plans / Actions)
// ============================================================================

router.route('/memory')
  .get(protect, getMemory)
  .post(protect, createMemory);

router.route('/memory/:id')
  .put(protect, updateMemory)
  .delete(protect, deleteMemory);

// ============================================================================
// CSIMPLE SETTINGS SYNC
// ============================================================================

router.route('/csimple/settings')
  .get(protect, getCSimpleSettings)
  .put(protect, sanitizeInput, updateCSimpleSettings);

router.route('/csimple/conversations')
  .get(protect, getCSimpleConversations)
  .put(protect, sanitizeInput, updateCSimpleConversations);

router.route('/csimple/behaviors')
  .get(protect, getCSimpleBehaviors);

router.route('/csimple/behaviors/:name')
  .get(protect, getCSimpleBehavior)
  .put(protect, sanitizeInput, updateCSimpleBehavior)
  .delete(protect, deleteCSimpleBehavior);

// ============================================================================
// ANALYTICS (Admin Only)
// ============================================================================

router.get('/analytics/referer-stats', protect, getRefererAnalytics);
router.get('/analytics/referer-data', protect, getRefererData);
router.get('/analytics/referer-summary', protect, getRefererSummary);

module.exports = router; // Export the router