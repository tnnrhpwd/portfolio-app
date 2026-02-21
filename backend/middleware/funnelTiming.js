// middleware/funnelTiming.js
// Automatically records funnel step timestamps when the test user
// hits key API endpoints (register, login, create-customer, pay-methods,
// subscribe-customer).

// Lazy-load to avoid circular requires
let _controller = null;
function ctrl() {
  if (!_controller) {
    try {
      _controller = require('../controllers/testFunnelController');
    } catch (_) {
      _controller = false;
    }
  }
  return _controller || null;
}

// Map route+method to funnel step names
const STEP_MAP = {
  'POST /api/data/register':             'signup',
  'POST /api/data/login':                'login',
  'POST /api/data/create-customer':      'customer_created',
  'POST /api/data/pay-methods':          'payment_method_added',
  'POST /api/data/subscribe-customer':   'subscription_confirmed',
  'GET /api/data/membership-pricing':    'pricing_viewed',
  'GET /api/data/subscription':          'subscription_checked',
};

/**
 * Express middleware — must be mounted AFTER the request body has been parsed
 * but BEFORE the actual route handler.  It only fires for the test user.
 */
function funnelTimingMiddleware(req, res, next) {
  const c = ctrl();
  if (!c) return next();

  const testUserId = c.getTestUserId();
  if (!testUserId) return next();

  // Identify who is making this request:
  // - For auth-protected routes: req.user.id
  // - For public routes (register/login): check req.body.email
  const isTestUser =
    (req.user && req.user.id === testUserId) ||
    (req.body && req.body.email === c.getTestEmail());

  if (!isTestUser) return next();

  const key = `${req.method} ${req.baseUrl}${req.path}`.replace(/\/$/, '');
  const step = STEP_MAP[key];

  if (step) {
    // For pay-methods with empty body, it's a SetupIntent creation, not PM attachment
    if (step === 'payment_method_added' && !req.body?.paymentMethodId) {
      c.recordStep('setup_intent_created');
    } else {
      const meta = {};
      if (step === 'subscription_confirmed' && req.body?.planId) {
        meta.plan = req.body.planId;
      }
      c.recordStep(step, meta);
    }
  }

  // Also record timing on response completion
  const startTime = Date.now();
  const originalEnd = res.end;
  res.end = function (...args) {
    const duration = Date.now() - startTime;
    if (step) {
      c.recordStep(`${step}_response`, {
        statusCode: res.statusCode,
        durationMs: duration,
      });
    }
    originalEnd.apply(res, args);
  };

  next();
}

module.exports = funnelTimingMiddleware;
