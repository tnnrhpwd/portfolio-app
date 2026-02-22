// controllers/testFunnelController.js
// Sales-funnel test harness — admin-only endpoints to create a disposable
// test user, walk through the entire purchase funnel against Stripe test-mode,
// capture emails, record per-step timing, and reset everything afterwards.

const asyncHandler = require('express-async-handler');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  DeleteCommand,
  ScanCommand,
  UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');

// Use test Stripe keys for the funnel tester — keeps live keys untouched
const testStripeKey = process.env.TEST_STRIPE_KEY || process.env.STRIPE_KEY;
const stripe = require('stripe')(testStripeKey);
const { invalidateUserCache } = require('../middleware/authMiddleware');

// ── DynamoDB client (same pattern as dataService) ────────────────────────
const awsClient = new DynamoDBClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const dynamodb = DynamoDBDocumentClient.from(awsClient);
const TABLE = 'Simple';

// ── Test user defaults ───────────────────────────────────────────────────
const TEST_EMAIL    = process.env.TEST_FUNNEL_EMAIL    || 'testfunnel@csimple.test';
const TEST_PASSWORD = process.env.TEST_FUNNEL_PASSWORD || 'TestFunnel2024!';
const TEST_NICKNAME = 'Test Funnel User';

// ── In-memory stores (survive server restarts = false, which is fine) ────
let snapshot        = null;   // deep copy of the DynamoDB record before the run
let capturedEmails  = [];     // { to, template, data, timestamp }
let funnelSteps     = [];     // { step, timestamp, meta }
let runCounter      = 0;
let testUserId      = null;   // current DynamoDB id of the test user
let testStripeId    = null;   // Stripe customer id

// ── Helpers ──────────────────────────────────────────────────────────────

function isAdmin(req) {
  const adminId = process.env.ADMIN_USER_ID || '6770a067c725cbceab958619';
  return req.user && req.user.id === adminId;
}

/** Scan for a user record by email in the pipe-delimited text field */
async function findUserByEmail(email) {
  const { Items } = await dynamodb.send(new ScanCommand({
    TableName: TABLE,
    FilterExpression: 'contains(#t, :emailTag)',
    ExpressionAttributeNames: { '#t': 'text' },
    ExpressionAttributeValues: { ':emailTag': `Email:${email}` },
  }));
  // Return the first item that also has Password: (i.e. is a user record)
  return (Items || []).find(i => i.text && i.text.includes('Password:')) || null;
}

/** Parse a value from the pipe-delimited text */
function parseField(text, field) {
  const re = new RegExp(`\\|?${field}:([^|]*)`, 'i');
  const m = text.match(re);
  return m ? m[1].trim() : '';
}

/** Deep-clone a plain object (DynamoDB items are plain objects) */
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API — email capture hook (called from emailService)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check whether an outgoing email should be captured instead of actually sent.
 * Returns true if we intercepted it.
 */
function interceptTestEmail(to, templateName, data) {
  if (to !== TEST_EMAIL) return false;
  capturedEmails.push({
    to,
    template: templateName,
    data: deepClone(data),
    timestamp: new Date().toISOString(),
  });
  recordStep('email_sent', { template: templateName });
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API — timing instrumentation (called from middleware)
// ═══════════════════════════════════════════════════════════════════════════

function recordStep(step, meta = {}) {
  funnelSteps.push({ step, timestamp: new Date().toISOString(), ...meta });
}

function getTestUserId()   { return testUserId; }
function getTestEmail()    { return TEST_EMAIL; }

// ═══════════════════════════════════════════════════════════════════════════
// ROUTE HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

// ── POST /test-funnel/init ───────────────────────────────────────────────
// Creates the test user (or finds it), creates/validates Stripe customer,
// snapshots the DB record, and resets timing + email captures.
const initTestFunnel = asyncHandler(async (req, res) => {
  if (!isAdmin(req)) {
    res.status(403);
    throw new Error('Admin only');
  }

  const hashedPassword = await bcrypt.hash(TEST_PASSWORD, 10);
  const now = new Date().toISOString();

  // 1. Stripe customer first — we need the ID before creating the DB record
  let stripeCustomer;
  const existing = await stripe.customers.list({ email: TEST_EMAIL, limit: 1 });
  if (existing.data.length > 0) {
    stripeCustomer = existing.data[0];
  } else {
    stripeCustomer = await stripe.customers.create({
      email: TEST_EMAIL,
      name: TEST_NICKNAME,
      metadata: { testFunnel: 'true' },
    });
  }
  testStripeId = stripeCustomer.id;

  // 2. Find or create the test user in DynamoDB — with stripeid already set
  let user = await findUserByEmail(TEST_EMAIL);

  if (!user) {
    const id = crypto.randomBytes(16).toString('hex');
    const text = `Nickname:${TEST_NICKNAME}|Email:${TEST_EMAIL}|Password:${hashedPassword}|Birth:${now}|stripeid:${testStripeId}|Rank:Free`;
    user = { id, text, createdAt: now, updatedAt: now };
    await dynamodb.send(new PutCommand({ TableName: TABLE, Item: user }));
  }

  testUserId = user.id;

  // 3. Make sure the DynamoDB record has the correct stripeid + Rank:Free
  const currentStripeId = parseField(user.text, 'stripeid');
  const currentRank = parseField(user.text, 'Rank');
  if (currentStripeId !== testStripeId || currentRank !== 'Free') {
    let updatedText = user.text;
    // Fix stripeid
    if (updatedText.includes('|stripeid:')) {
      updatedText = updatedText.replace(/(\|stripeid:)[^|]*/, `|stripeid:${testStripeId}`);
    } else {
      updatedText += `|stripeid:${testStripeId}`;
    }
    // Ensure Rank:Free
    if (updatedText.includes('|Rank:')) {
      updatedText = updatedText.replace(/(\|Rank:)[^|]*/, `|Rank:Free`);
    } else {
      updatedText += `|Rank:Free`;
    }
    await dynamodb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { id: user.id },
      UpdateExpression: 'SET #t = :t, updatedAt = :u',
      ExpressionAttributeNames: { '#t': 'text' },
      ExpressionAttributeValues: { ':t': updatedText, ':u': now },
    }));
    user.text = updatedText;
  }

  // 4. Invalidate auth cache so the next request fetches the fresh DB record
  invalidateUserCache(testUserId);

  // 5. Snapshot + reset
  snapshot = deepClone(user);
  capturedEmails = [];
  funnelSteps = [];
  runCounter++;

  recordStep('init', { run: runCounter });

  res.json({
    success: true,
    run: runCounter,
    testUser: {
      id: testUserId,
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      nickname: TEST_NICKNAME,
      stripeCustomerId: testStripeId,
    },
    message: 'Test funnel initialised. Login as the test user to begin.',
  });
});

// ── POST /test-funnel/reset ──────────────────────────────────────────────
// Cancel Stripe subscriptions, detach payment methods, restore DynamoDB
// record from snapshot, and clear timing + email captures.
const resetTestFunnel = asyncHandler(async (req, res) => {
  if (!isAdmin(req)) {
    res.status(403);
    throw new Error('Admin only');
  }

  if (!testUserId || !testStripeId) {
    res.status(400);
    throw new Error('Test funnel not initialised. Call init first.');
  }

  // 1. Cancel ALL Stripe subscriptions for the test customer
  const subs = await stripe.subscriptions.list({
    customer: testStripeId,
    status: 'all',
  });

  let cancelledSubs = 0;
  for (const sub of subs.data) {
    if (['active', 'trialing', 'past_due', 'incomplete'].includes(sub.status)) {
      await stripe.subscriptions.cancel(sub.id);
      cancelledSubs++;
    }
  }

  // 2. Detach ALL payment methods
  const pms = await stripe.paymentMethods.list({
    customer: testStripeId,
    type: 'card',
  });
  let detachedPMs = 0;
  for (const pm of pms.data) {
    await stripe.paymentMethods.detach(pm.id);
    detachedPMs++;
  }

  // Also detach other types
  for (const pmType of ['link', 'cashapp']) {
    try {
      const others = await stripe.paymentMethods.list({
        customer: testStripeId,
        type: pmType,
      });
      for (const pm of others.data) {
        await stripe.paymentMethods.detach(pm.id);
        detachedPMs++;
      }
    } catch (_) { /* type may not be supported */ }
  }

  // 3. Restore DynamoDB record from snapshot
  if (snapshot) {
    await dynamodb.send(new PutCommand({
      TableName: TABLE,
      Item: { ...deepClone(snapshot), updatedAt: new Date().toISOString() },
    }));
  }

  // 3b. Invalidate auth cache so the restored record is used immediately
  invalidateUserCache(testUserId);

  // 4. Store the completed run timing before clearing, for the response
  const completedSteps = [...funnelSteps];

  // 5. Reset
  capturedEmails = [];
  funnelSteps = [];
  recordStep('reset', { run: runCounter });

  res.json({
    success: true,
    message: `Reset complete. Cancelled ${cancelledSubs} sub(s), detached ${detachedPMs} payment method(s), restored DB snapshot.`,
    completedRun: computeTiming(completedSteps),
    cancelledSubs,
    detachedPMs,
  });
});

// ── GET /test-funnel/status ──────────────────────────────────────────────
// Returns current test user state, funnel steps, and timing.
const getTestFunnelStatus = asyncHandler(async (req, res) => {
  if (!isAdmin(req)) {
    res.status(403);
    throw new Error('Admin only');
  }

  if (!testUserId) {
    return res.json({
      initialised: false,
      message: 'No test funnel active. Call POST /test-funnel/init first.',
    });
  }

  // Fetch live state
  let liveUser = null;
  try {
    const { Item } = await dynamodb.send(new GetCommand({
      TableName: TABLE,
      Key: { id: testUserId },
    }));
    liveUser = Item || null;
  } catch (_) {}

  // Fetch Stripe state
  let stripeState = null;
  if (testStripeId) {
    try {
      const subs = await stripe.subscriptions.list({
        customer: testStripeId,
        status: 'all',
        limit: 5,
      });
      const pms = await stripe.paymentMethods.list({
        customer: testStripeId,
        type: 'card',
      });
      stripeState = {
        subscriptions: subs.data.map(s => ({
          id: s.id,
          status: s.status,
          plan: s.items?.data?.[0]?.price?.product || 'unknown',
          created: new Date(s.created * 1000).toISOString(),
        })),
        paymentMethods: pms.data.map(pm => ({
          id: pm.id,
          brand: pm.card?.brand,
          last4: pm.card?.last4,
        })),
      };
    } catch (_) {}
  }

  res.json({
    initialised: true,
    run: runCounter,
    testUser: {
      id: testUserId,
      email: TEST_EMAIL,
      stripeCustomerId: testStripeId,
      currentRank: liveUser ? parseField(liveUser.text, 'Rank') : 'unknown',
    },
    stripeState,
    funnel: computeTiming(funnelSteps),
    emails: capturedEmails,
    snapshotExists: !!snapshot,
  });
});

// ── POST /test-funnel/step ───────────────────────────────────────────────
// Manually record a funnel step (for client-side events the server can't see).
const recordFunnelStep = asyncHandler(async (req, res) => {
  if (!isAdmin(req)) {
    res.status(403);
    throw new Error('Admin only');
  }

  const { step, meta } = req.body;
  if (!step) {
    res.status(400);
    throw new Error('step is required');
  }

  recordStep(step, meta || {});
  res.json({ success: true, steps: computeTiming(funnelSteps) });
});

// ── GET /test-funnel/emails ──────────────────────────────────────────────
// Returns all captured emails for the current run.
const getTestEmails = asyncHandler(async (req, res) => {
  if (!isAdmin(req)) {
    res.status(403);
    throw new Error('Admin only');
  }

  res.json({ emails: capturedEmails });
});

// ═══════════════════════════════════════════════════════════════════════════
// Timing helpers
// ═══════════════════════════════════════════════════════════════════════════

function computeTiming(steps) {
  if (!steps.length) return { steps: [], totalMs: 0 };

  const enriched = steps.map((s, i) => {
    const ts = new Date(s.timestamp).getTime();
    const prevTs = i > 0 ? new Date(steps[i - 1].timestamp).getTime() : ts;
    return {
      ...s,
      elapsedMs: ts - prevTs,
      elapsedFormatted: formatMs(ts - prevTs),
      cumulativeMs: ts - new Date(steps[0].timestamp).getTime(),
    };
  });

  const totalMs = enriched.length > 1
    ? new Date(steps[steps.length - 1].timestamp).getTime() -
      new Date(steps[0].timestamp).getTime()
    : 0;

  return {
    steps: enriched,
    totalMs,
    totalFormatted: formatMs(totalMs),
  };
}

function formatMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = ((ms % 60000) / 1000).toFixed(0);
  return `${mins}m ${secs}s`;
}

// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  // Route handlers
  initTestFunnel,
  resetTestFunnel,
  getTestFunnelStatus,
  recordFunnelStep,
  getTestEmails,
  // Hooks for other modules
  interceptTestEmail,
  recordStep,
  getTestUserId,
  getTestEmail,
};
