/**
 * Purchase Gate Controller — a single admin-controlled kill switch that lets
 * the site owner instantly pause new Pro subscriptions and caveat/hide
 * "upgrade" mentions across the app, without a deploy.
 *
 * Why this exists: see docs/guides/ACTION_PLAN.md ("Gate: hide and disable
 * purchasing until a real readiness bar is met"). Until the core CSimple
 * addon loop is reliable, it should be possible to pause selling it in one
 * click rather than shipping a working checkout for a non-working product.
 *
 * GET  /api/data/purchase-gate         — public, read-only status for the frontend
 * GET  /api/data/admin/purchase-gate   — admin: read raw settings
 * PUT  /api/data/admin/purchase-gate   — admin: save settings
 *
 * Storage: DynamoDB "Simple" table, single item keyed by a fixed id (same
 * pattern as homeTitleController.js).
 *
 * Existing Pro subscribers are never affected by this toggle — it only
 * blocks *new* upgrades (Free → Pro). Switching down to Free always works,
 * so nobody gets stuck unable to cancel.
 */

const asyncHandler = require('express-async-handler');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { logger } = require('../utils/logger');

const client = new DynamoDBClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const dynamodb = DynamoDBDocumentClient.from(client);

const TABLE_NAME = 'Simple';
const SETTINGS_ITEM_ID = 'site_settings_purchase_gate';
// Fixed sentinel createdAt so this single item can be fetched via GetCommand
// without needing to know its true creation time (table key is id+createdAt).
const SETTINGS_CREATED_AT = '2000-01-01T00:00:00.000Z';

const DEFAULT_MESSAGE = "Upgrading is temporarily paused while we finish getting the core product ready. Existing plans aren't affected.";
const DEFAULT_SETTINGS = { purchasesEnabled: true, message: DEFAULT_MESSAGE };

function sanitizeSettings(input) {
  const src = input && typeof input === 'object' ? input : {};
  return {
    purchasesEnabled: src.purchasesEnabled !== false, // default true unless explicitly false
    message: typeof src.message === 'string' ? src.message.slice(0, 500) : DEFAULT_MESSAGE,
  };
}

async function loadSettings() {
  try {
    const { Item } = await dynamodb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { id: SETTINGS_ITEM_ID, createdAt: SETTINGS_CREATED_AT },
    }));

    if (!Item || !Item.text) return { settings: DEFAULT_SETTINGS, updatedAt: null };

    try {
      return { settings: sanitizeSettings(JSON.parse(Item.text)), updatedAt: Item.updatedAt || Item.createdAt };
    } catch {
      return { settings: DEFAULT_SETTINGS, updatedAt: null };
    }
  } catch (error) {
    logger.error('[PurchaseGate] Failed to load settings, defaulting to purchases enabled:', error.message);
    return { settings: DEFAULT_SETTINGS, updatedAt: null };
  }
}

/**
 * Public helper used by other controllers (e.g. subscribeCustomer) to check
 * whether new/upgraded purchases are currently allowed. Fails open (returns
 * true) on read errors so a DB hiccup never silently blocks paying customers.
 */
async function arePurchasesEnabled() {
  const { settings } = await loadSettings();
  return settings.purchasesEnabled !== false;
}

// @desc    Get the public purchase-gate status (used to hide/disable upgrade CTAs)
// @route   GET /api/data/purchase-gate
// @access  Public
const getPurchaseGateStatus = asyncHandler(async (req, res) => {
  const { settings } = await loadSettings();
  res.status(200).json({
    purchasesEnabled: settings.purchasesEnabled,
    message: settings.purchasesEnabled ? null : (settings.message || DEFAULT_MESSAGE),
  });
});

// @desc    Get the raw purchase-gate settings for the admin UI
// @route   GET /api/data/admin/purchase-gate
// @access  Private (admin only — requireAdmin middleware applied in routes)
const getPurchaseGateSettings = asyncHandler(async (req, res) => {
  const { settings, updatedAt } = await loadSettings();
  res.status(200).json({ settings, updatedAt });
});

// @desc    Save purchase-gate settings (toggle + caveat message)
// @route   PUT /api/data/admin/purchase-gate
// @access  Private (admin only — requireAdmin middleware applied in routes)
const updatePurchaseGateSettings = asyncHandler(async (req, res) => {
  const sanitized = sanitizeSettings(req.body?.settings);

  const now = new Date().toISOString();
  await dynamodb.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      id: SETTINGS_ITEM_ID,
      text: JSON.stringify(sanitized),
      createdAt: SETTINGS_CREATED_AT,
      updatedAt: now,
    },
  }));

  logger.info(`[PurchaseGate] Purchases ${sanitized.purchasesEnabled ? 'ENABLED' : 'DISABLED'} by admin ${req.user?.id}`);
  res.status(200).json({ success: true, settings: sanitized, updatedAt: now });
});

module.exports = {
  getPurchaseGateStatus,
  getPurchaseGateSettings,
  updatePurchaseGateSettings,
  arePurchasesEnabled,
};
