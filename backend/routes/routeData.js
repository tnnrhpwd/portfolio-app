// routes/routeData.js - API Routes organized by functionality

const express = require('express');
const router = express.Router();
const multer = require('multer');

// ============================================================================
// Middleware Imports
// ============================================================================
const { protect } = require('../middleware/authMiddleware');
const { authLimiter, paymentLimiter, llmLimiter, imageGenLimiter, ocrLimiter, uploadLimiter, workspaceReadLimiter, workspaceWriteLimiter, workspaceActionLimiter, marketReadLimiter, marketPublishLimiter, marketWriteLimiter, pollsReadLimiter, pollsWriteLimiter } = require('../middleware/rateLimiter');
const { 
  validateRegistration, 
  validateLogin, 
  validateForgotPassword,
  validatePasswordReset,
  validateDataCreation,
  validatePaymentData,
  validateSubscription,
  handleValidationErrors,
  sanitizeInput
} = require('../middleware/validation');
const { logSecurityEvent, logger } = require('../utils/logger');

// ============================================================================
// Controller Imports
// ============================================================================

// Main controllers (from index.js)
const {
  deleteData, deleteHashData, deletePaymentMethod, deleteCustomer,
  getData, getUserSubscription, getUserStorage,
  getHashData, getPaymentMethods, getAllData, getMembershipPricing, getUserUsageData,
  postData, registerUser, loginUser,
  postHashData, compressData, compressDataStream, createCustomer,
  postPaymentMethod, createInvoice, subscribeCustomer,
  handleWebhook, processFileUpload,
  putData, putHashData, updateCustomer, putPaymentMethod,
  forgotPassword, resetPassword, forgotPasswordAuthenticated,
  extractOCR, updateWithOCR,
  getLLMProviders,
  getAdminDashboard, getAdminUsers, getAdminPaginatedData, updateUserSpecial, getEmailStatus, testEmailSend, enlistAgentForBug,
  initTestFunnel, resetTestFunnel, getTestFunnelStatus, recordFunnelStep, getTestEmails,
  getStripeConfig,
  getDeepStorageItems, regenerateDeepStorageItems,
  getHomeTitle, getHomeTitleSettings, updateHomeTitleSettings,
  getPurchaseGateStatus, getPurchaseGateSettings, updatePurchaseGateSettings,
  getEmailPrefs, updateEmailPrefs,
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

// Simple sync controller
const {
  getSimpleSettings,
  updateSimpleSettings,
  getSimpleConversations,
  updateSimpleConversations,
  mergeSimpleConversations,
  getSimpleBehaviors,
  getSimpleBehavior,
  updateSimpleBehavior,
  deleteSimpleBehavior,
  getSimpleMemoryFiles,
  getSimpleMemoryFile,
  updateSimpleMemoryFile,
  deleteSimpleMemoryFile,
  getSimplePersonalityFiles,
  getSimplePersonalityFile,
  updateSimplePersonalityFile,
  getSimpleUserContext,
} = require('../controllers/csimpleController');

// Simple Workspace controller (OpenClaw-style AI workspace)
const {
  listWorkspace,
  getWorkspaceItem,
  upsertWorkspaceItem,
  deleteWorkspaceItem,
  appendLog,
  appendAction,
  getRecentActions,
  getNextGoal,
  getTelemetrySummary,
  getWorkspaceContextPreview,
  getWorkspaceTemplates,
  compileMacroNatural,
  editMacroNatural,
  agentChatProxy,
  agentVisionProxy,
} = require('../controllers/workspaceController');

// Simple Marketplace controller (public/shared skill marketplace, §4)
const {
  publishSkill,
  searchMarketSkills,
  getMarketSkill,
  installMarketSkill,
  rateMarketSkill,
  flagMarketSkill,
} = require('../controllers/marketplaceController');

// Addon relay controller (cloud command relay for remote execution)
const {
  addonHeartbeat,
  getAddonStatus,
  getAddonDevices,
  queueCommand,
  getPendingCommands,
  postCommandResult,
  getCommandResult,
} = require('../controllers/addonRelayController');

// Memory controller (Goals / Plans / Actions)
const {
  getMemory,
  getMemoryOne,
  createMemory,
  updateMemory,
  deleteMemory,
} = require('../controllers/memoryController');

// Goal Agent controller (LLM agent that works on a goal)
const {
  startGoalAgent,
  getGoalAgentStatus,
  stopGoalAgent,
} = require('../controllers/goalAgentController');

// Pets controller (Nintendogs-style virtual pets)
const {
  getPets,
  adopt,
  getPetOne,
  doAction,
  removePet,
} = require('../controllers/petsController');

// Polls controller (public — no sign-in required)
const {
  getPolls,
  createPoll,
  votePoll,
  closePoll,
  deletePoll,
} = require('../controllers/pollsController');

// Hype controller (public — LLM motivational quotes for /hype)
const {
  generateHypeQuote,
} = require('../controllers/hypeController');

// Image generation controller (AWS Bedrock — Stability / Gemini)
const {
  getImageModels,
  generateImage,
} = require('../controllers/imageGenController');

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

// Diagnostic logging for incoming requests BEFORE body parsing.
// Debug-level only — enable with LOG_LEVEL=debug when you need a full
// per-request trace; not shown in normal dev/prod console output.
router.use((req, res, next) => {
  logger.debug(`Incoming request: ${req.method} ${req.originalUrl}`);
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

// Diagnostic logging AFTER body parsing (debug-level, see note above)
router.use((req, res, next) => {
  // req.body is undefined for requests with no matching body (e.g. GET
  // requests without a JSON content-type) since express.json()/urlencoded()
  // skip setting it in that case. Guard against that before stringifying,
  // otherwise JSON.stringify(undefined) returns `undefined` (not a string)
  // and `.length` throws, 500-ing every bodyless GET request.
  const bodyJson = req.body ? JSON.stringify(req.body) : '';
  // Only log body for non-sensitive routes and if body is not too large
  if (!req.originalUrl.includes('login') && !req.originalUrl.includes('register') &&
      bodyJson.length > 0 && bodyJson.length < 1000) {
    logger.debug('Request body after parsing', { url: req.originalUrl, body: req.body });
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

// Image generation — model catalog (public, static metadata only)
router.get('/image/models', getImageModels);

// Hype — public motivational quote generator (LLM-backed, IP rate-limited)
router.post('/hype/quote', llmLimiter, sanitizeInput, generateHypeQuote);

// Web Vitals (analytics beacon — public, fire-and-forget).
// NOTE: apiLimiter is already applied globally in server.js for every /api/
// route — do NOT pass it here too. Doing so double-incremented the shared
// IP bucket (2 tokens consumed per beacon instead of 1) since it's the same
// limiter instance/store, quietly burning through user budget on every page
// load/tab-close.
router.post('/web-vitals', (req, res) => {
  const { url, ttfb, cls, fcp, lcp, fid, connection, deviceMemory, timestamp } = req.body || {};
  if (url && timestamp) {
    // Debug-level observability beacon — fires on every page load, so it's
    // not shown by default; enable with LOG_LEVEL=debug when investigating.
    logger.debug('web-vitals', {
      url, ttfb, cls, fcp, lcp, fid, connection, deviceMemory, timestamp,
      ip: req.ip,
    });
  }
  res.status(204).end();
});

// Stripe publishable key (public, but auth-aware to serve test key for funnel users)
const { optionalAuth } = require('../middleware/authMiddleware');
router.get('/stripe-config', optionalAuth, getStripeConfig);

// Dynamic homepage title (public, auth-aware for nickname/email/plan rules)
router.get('/home-title', optionalAuth, getHomeTitle);

// Purchase gate status (public — used by frontend to hide/disable upgrade CTAs)
router.get('/purchase-gate', getPurchaseGateStatus);

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
router.put('/admin/users/:id/special', protect, requireAdmin, sanitizeInput, updateUserSpecial);
router.get('/admin/data', protect, requireAdmin, getAdminPaginatedData);
router.get('/admin/email-status', protect, requireAdmin, getEmailStatus);
router.post('/admin/email-test', protect, requireAdmin, testEmailSend);
router.post('/admin/agent-fix', protect, requireAdmin, sanitizeInput, enlistAgentForBug);
router.route('/admin/home-title')
  .get(protect, requireAdmin, getHomeTitleSettings)
  .put(protect, requireAdmin, sanitizeInput, updateHomeTitleSettings);
router.route('/admin/purchase-gate')
  .get(protect, requireAdmin, getPurchaseGateSettings)
  .put(protect, requireAdmin, sanitizeInput, updatePurchaseGateSettings);

// ============================================================================
// DEEP STORAGE (Bedrock Minecraft stackable item catalog)
// ============================================================================
router.get('/deepstorage/items', getDeepStorageItems);
router.post('/deepstorage/regenerate', protect, requireAdmin, regenerateDeepStorageItems);

// Test Funnel Routes
router.post('/test-funnel/init', protect, initTestFunnel);
router.post('/test-funnel/reset', protect, resetTestFunnel);
router.get('/test-funnel/status', protect, getTestFunnelStatus);
router.post('/test-funnel/step', protect, recordFunnelStep);
router.get('/test-funnel/emails', protect, getTestEmails);

// Data Compression
router.post('/compress', protect, compressData);
router.post('/compress/stream', protect, compressDataStream);

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

// Email notification preferences (per-user opt-in/opt-out)
router.route('/email-preferences')
  .get(protect, getEmailPrefs)
  .put(protect, sanitizeInput, updateEmailPrefs);

// ============================================================================
// PAYMENT & BILLING (Stripe)
// ============================================================================

// Payment audit logging — log all payment-related requests for monitoring
const logPaymentAction = (req, res, next) => {
  const { method, originalUrl, ip } = req;
  const userId = req.user?.id || 'anonymous';
  logger.info('Payment action', { method, url: originalUrl, userId, ip });
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
// custom-limit route removed — no per-user custom credit limits



// ============================================================================
// MEMORY (Goals / Plans / Actions)
// ============================================================================

router.route('/memory')
  .get(protect, getMemory)
  .post(protect, createMemory);

router.route('/memory/:id')
  .get(protect, getMemoryOne)
  .put(protect, updateMemory)
  .delete(protect, deleteMemory);

// ============================================================================
// IMAGE GENERATION (AWS Bedrock — Stability / Gemini)
// ============================================================================

router.post('/image/generate', protect, imageGenLimiter, sanitizeInput, generateImage);

// ============================================================================
// GOAL AGENT (LLM agent that autonomously works on a user goal)
// ============================================================================

router.post('/goal-agent/start', protect, llmLimiter, sanitizeInput, startGoalAgent);
router.get('/goal-agent/status/:goalId', protect, workspaceReadLimiter, getGoalAgentStatus);
router.post('/goal-agent/stop', protect, workspaceWriteLimiter, sanitizeInput, stopGoalAgent);

// ============================================================================
// PETS (Nintendogs-style virtual pets — per-user, stats decay in real time)
// ============================================================================

// Order matters: register the specific /adopt route before /:petId.
router.get('/pets', protect, workspaceReadLimiter, getPets);
router.post('/pets/adopt', protect, workspaceWriteLimiter, sanitizeInput, adopt);
router.get('/pets/:petId', protect, workspaceReadLimiter, getPetOne);
router.post('/pets/:petId/action', protect, workspaceActionLimiter, sanitizeInput, doAction);
router.delete('/pets/:petId', protect, workspaceWriteLimiter, removePet);

// ============================================================================
// CSIMPLE SETTINGS SYNC
// ============================================================================

router.route('/csimple/settings')
  .get(protect, getSimpleSettings)
  .put(protect, sanitizeInput, updateSimpleSettings);

router.route('/csimple/conversations')
  .get(protect, getSimpleConversations)
  .put(protect, sanitizeInput, updateSimpleConversations)
  .post(protect, sanitizeInput, mergeSimpleConversations);

// Dedicated merge route matching the frontend's `/csimple/conversations/merge`
// URL. Without this alias the client's POST to `/merge` 404s and chats never
// sync across devices. (The POST on `/csimple/conversations` above is kept for
// backward compatibility with any older client.)
router.route('/csimple/conversations/merge')
  .post(protect, sanitizeInput, mergeSimpleConversations);

router.route('/csimple/behaviors')
  .get(protect, getSimpleBehaviors);

router.route('/csimple/behaviors/:name')
  .get(protect, getSimpleBehavior)
  .put(protect, sanitizeInput, updateSimpleBehavior)
  .delete(protect, deleteSimpleBehavior);

// CSIMPLE MEMORY FILES (cloud storage for AI memory)
router.route('/csimple/memory')
  .get(protect, getSimpleMemoryFiles);

router.route('/csimple/memory/:name')
  .get(protect, getSimpleMemoryFile)
  .put(protect, sanitizeInput, updateSimpleMemoryFile)
  .delete(protect, deleteSimpleMemoryFile);

// CSIMPLE PERSONALITY FILES (cloud storage for AI personality)
router.route('/csimple/personality')
  .get(protect, getSimplePersonalityFiles);

router.route('/csimple/personality/:name')
  .get(protect, getSimplePersonalityFile)
  .put(protect, sanitizeInput, updateSimplePersonalityFile);

// CSIMPLE USER CONTEXT (aggregate memory + personality + behavior for LLM)
router.get('/csimple/context', protect, getSimpleUserContext);

// ============================================================================
// CSIMPLE WORKSPACE (OpenClaw-style AI workspace: core/agent/knowledge/
//                   notebook/skill/log/decision/project)
// ============================================================================

// Order matters: specific routes BEFORE parameterized ones.
router.get('/csimple/workspace/templates', protect, workspaceReadLimiter, getWorkspaceTemplates);
router.get('/csimple/workspace/context',   protect, workspaceReadLimiter, getWorkspaceContextPreview);
router.post('/csimple/workspace/log/append', protect, workspaceWriteLimiter, sanitizeInput, appendLog);
router.post('/csimple/workspace/action/append', protect, workspaceActionLimiter, sanitizeInput, appendAction);
router.get('/csimple/workspace/action/recent', protect, workspaceReadLimiter, getRecentActions);
router.get('/csimple/workspace/goals/next', protect, workspaceReadLimiter, getNextGoal);
router.get('/csimple/workspace/telemetry/summary', protect, workspaceReadLimiter, getTelemetrySummary);
// NL macro compiler — works without the addon installed (Bedrock, server-side only)
router.post('/csimple/compile-natural', protect, llmLimiter, sanitizeInput, compileMacroNatural);
// NL macro editor — modify an existing macro's steps via English instruction
router.post('/csimple/edit-natural', protect, llmLimiter, sanitizeInput, editMacroNatural);
// §7.1 addon LLM provider seam backend routes — the Simple Addon's agent
// loop / skill repair / vision lookups ALWAYS proxy through these (never a
// direct LLM call from the addon). See simple-addon/server/automation/llm-provider.js.
router.post('/csimple/agent-chat', protect, llmLimiter, sanitizeInput, agentChatProxy);
router.post('/csimple/agent-vision', protect, llmLimiter, sanitizeInput, agentVisionProxy);

router.route('/csimple/workspace')
  .get(protect, workspaceReadLimiter, listWorkspace);

router.route('/csimple/workspace/:kind/:slug')
  .get(protect, workspaceReadLimiter, getWorkspaceItem)
  .put(protect, workspaceWriteLimiter, sanitizeInput, upsertWorkspaceItem)
  .delete(protect, workspaceWriteLimiter, deleteWorkspaceItem);

// ============================================================================
// CSIMPLE MARKETPLACE (public/shared skill marketplace — §4 of
//                      docs/new/simple-agent-prompt.md)
// ============================================================================

// Order matters: specific routes BEFORE parameterized ones.
router.route('/market/skills')
  .get(protect, marketReadLimiter, searchMarketSkills)
  .post(protect, marketPublishLimiter, sanitizeInput, publishSkill);

router.get('/market/skills/:marketId{/:version}', protect, marketReadLimiter, getMarketSkill);
router.post('/market/skills/:marketId/install', protect, marketWriteLimiter, sanitizeInput, installMarketSkill);
router.post('/market/skills/:marketId/rate', protect, marketWriteLimiter, sanitizeInput, rateMarketSkill);
router.post('/market/skills/:marketId/flag', protect, marketWriteLimiter, sanitizeInput, flagMarketSkill);

// ============================================================================
// ADDON RELAY (cloud command relay for phone → desktop execution)
// ============================================================================

router.post('/addon/heartbeat', protect, addonHeartbeat);
router.get('/addon/status', protect, getAddonStatus);
router.get('/addon/devices', protect, getAddonDevices);
router.post('/addon/command', protect, sanitizeInput, queueCommand);
router.get('/addon/pending', protect, getPendingCommands);
router.post('/addon/result/:commandId', protect, sanitizeInput, postCommandResult);
router.get('/addon/result/:commandId', protect, getCommandResult);

// ============================================================================
// POLLS (public — no sign-in required)
// ============================================================================

router.get('/polls', pollsReadLimiter, getPolls);
router.post('/polls', pollsWriteLimiter, sanitizeInput, createPoll);
router.post('/polls/:id/vote', pollsWriteLimiter, sanitizeInput, votePoll);
router.post('/polls/:id/close', pollsWriteLimiter, sanitizeInput, closePoll);
router.post('/polls/:id/delete', pollsWriteLimiter, sanitizeInput, deletePoll);

// ============================================================================
// ANALYTICS (Admin Only)
// ============================================================================

router.get('/analytics/referer-stats', protect, requireAdmin, getRefererAnalytics);
router.get('/analytics/referer-data', protect, requireAdmin, getRefererData);
router.get('/analytics/referer-summary', protect, requireAdmin, getRefererSummary);

module.exports = router; // Export the router