// routes/routeData.js - API Routes organized by functionality

const express = require('express');
const router = express.Router();
const multer = require('multer');

// ============================================================================
// Middleware Imports
// ============================================================================
const { protect } = require('../middleware/authMiddleware');
const { apiLimiter, authLimiter, paymentLimiter, llmLimiter, ocrLimiter, uploadLimiter } = require('../middleware/rateLimiter');
const { 
  validateRegistration, 
  validateLogin, 
  validateForgotPassword,
  validatePasswordReset,
  validateDataCreation,
  validatePaymentData,
  validateSubscription,
  validateCustomLimit,
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
  getAdminDashboard, getAdminUsers, getAdminPaginatedData,
  initTestFunnel, resetTestFunnel, getTestFunnelStatus, recordFunnelStep, getTestEmails,
  getStripeConfig,
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
  getCSimpleMemoryFiles,
  getCSimpleMemoryFile,
  updateCSimpleMemoryFile,
  deleteCSimpleMemoryFile,
  getCSimplePersonalityFiles,
  getCSimplePersonalityFile,
  updateCSimplePersonalityFile,
  getCSimpleUserContext,
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

// ============================================================================
// WEBHOOK ROUTE — must come BEFORE express.json() to preserve raw body
// for Stripe signature verification
// ============================================================================
router.post('/webhook', express.raw({ type: 'application/json' }), handleWebhook);

// Middleware for parsing JSON and URL-encoded request bodies
router.use(express.json());
router.use(express.urlencoded({ extended: false }));

// NOTE: apiLimiter is applied globally in server.js — not duplicated here.

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

// Stripe publishable key (public, but auth-aware to serve test key for funnel users)
const { optionalAuth } = require('../middleware/authMiddleware');
router.get('/stripe-config', optionalAuth, getStripeConfig);

// Stripe Webhook is registered above (before express.json()) to preserve raw body

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

// Admin Routes — require authentication AND admin role
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.id !== process.env.ADMIN_USER_ID) {
    return res.status(403).json({ dataMessage: 'Forbidden: admin access required' });
  }
  next();
};
router.get('/all/admin', protect, requireAdmin, getAllData);
router.get('/admin/dashboard', protect, requireAdmin, getAdminDashboard);
router.get('/admin/users', protect, requireAdmin, getAdminUsers);
router.get('/admin/data', protect, requireAdmin, getAdminPaginatedData);

// Test Funnel Routes
router.post('/test-funnel/init', protect, initTestFunnel);
router.post('/test-funnel/reset', protect, resetTestFunnel);
router.get('/test-funnel/status', protect, getTestFunnelStatus);
router.post('/test-funnel/step', protect, recordFunnelStep);
router.get('/test-funnel/emails', protect, getTestEmails);

// Data Compression
router.post('/compress', protect, compressData);

// File Processing (in-memory, no DB storage)
const fileProcessUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
}).single('file');
router.post('/process-file', protect, uploadLimiter, fileProcessUpload, processFileUpload);

// Protected Data CRUD (with sanitization on write operations)
router.route('/')
  .get(protect, getHashData)
  .post(protect, sanitizeInput, upload.any(), postHashData);

router.route('/:id')
  .delete(protect, deleteHashData)
  .put(protect, sanitizeInput, putHashData);

// ============================================================================
// FILE UPLOAD (S3)
// ============================================================================

router.post('/upload-url', protect, uploadLimiter, requestUploadUrl);
router.post('/upload-confirm', protect, uploadLimiter, confirmUpload);
router.delete('/file/:s3Key', protect, deleteUploadedFile);

// ============================================================================
// OCR (Optical Character Recognition)
// ============================================================================

router.post('/ocr-extract', protect, ocrLimiter, extractOCR);
router.put('/ocr-update/:id', protect, ocrLimiter, updateWithOCR);

// ============================================================================
// USER ACCOUNT & USAGE
// ============================================================================

router.get('/subscription', protect, getUserSubscription);
router.get('/storage', protect, getUserStorage);
router.get('/usage', protect, getUserUsageData);

// ============================================================================
// PAYMENT & BILLING (Stripe)
// ============================================================================

// Payment audit logging — log all payment-related requests for monitoring
const logPaymentAction = (req, res, next) => {
  const { method, originalUrl, ip } = req;
  const userId = req.user?.id || 'anonymous';
  console.log(`[PAYMENT AUDIT] ${new Date().toISOString()} | ${method} ${originalUrl} | user=${userId} | ip=${ip}`);
  next();
};

// Customer Management
router.post('/create-customer', protect, paymentLimiter, logPaymentAction, sanitizeInput, createCustomer);
router.put('/update-customer/:id', protect, paymentLimiter, logPaymentAction, sanitizeInput, updateCustomer);
router.delete('/delete-customer/:id', protect, paymentLimiter, logPaymentAction, deleteCustomer);

// Payment Methods
router.route('/pay-methods')
  .get(protect, getPaymentMethods)
  .post(protect, paymentLimiter, logPaymentAction, validatePaymentData, handleValidationErrors, postPaymentMethod)
  .put(protect, paymentLimiter, logPaymentAction, validatePaymentData, handleValidationErrors, putPaymentMethod);

router.delete('/pay-methods/:id', protect, paymentLimiter, logPaymentAction, deletePaymentMethod);

// Billing & Subscriptions
router.post('/create-invoice', protect, paymentLimiter, logPaymentAction, sanitizeInput, createInvoice);
router.post('/subscribe-customer', protect, paymentLimiter, logPaymentAction, validateSubscription, handleValidationErrors, subscribeCustomer);
router.post('/custom-limit', protect, paymentLimiter, logPaymentAction, validateCustomLimit, handleValidationErrors, setCustomLimit);



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

// CSIMPLE MEMORY FILES (cloud storage for AI memory)
router.route('/csimple/memory')
  .get(protect, getCSimpleMemoryFiles);

router.route('/csimple/memory/:name')
  .get(protect, getCSimpleMemoryFile)
  .put(protect, sanitizeInput, updateCSimpleMemoryFile)
  .delete(protect, deleteCSimpleMemoryFile);

// CSIMPLE PERSONALITY FILES (cloud storage for AI personality)
router.route('/csimple/personality')
  .get(protect, getCSimplePersonalityFiles);

router.route('/csimple/personality/:name')
  .get(protect, getCSimplePersonalityFile)
  .put(protect, sanitizeInput, updateCSimplePersonalityFile);

// CSIMPLE USER CONTEXT (aggregate memory + personality + behavior for LLM)
router.get('/csimple/context', protect, getCSimpleUserContext);

// ============================================================================
// ANALYTICS (Admin Only)
// ============================================================================

router.get('/analytics/referer-stats', protect, requireAdmin, getRefererAnalytics);
router.get('/analytics/referer-data', protect, requireAdmin, getRefererData);
router.get('/analytics/referer-summary', protect, requireAdmin, getRefererSummary);

module.exports = router; // Export the router