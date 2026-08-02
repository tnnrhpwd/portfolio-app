/**
 * Home Title Controller — dynamic homepage headline with admin-configurable
 * per-visitor rules (nickname, email, geo-location, logged-in state, etc.)
 *
 * GET  /api/data/home-title           — public, optionally-auth-aware
 * GET  /api/data/admin/home-title     — admin: read raw settings
 * PUT  /api/data/admin/home-title     — admin: save settings
 *
 * Storage: DynamoDB "Simple" table, single item keyed by a fixed id so we
 * can use GetCommand/PutCommand directly (same pattern as csimpleController).
 */

const asyncHandler = require('express-async-handler');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { resolveHomeTitle, validateHomeTitleSettings, FALLBACK_TITLE } = require('../utils/homeTitleRules');
const { getGeoForIp, extractIp } = require('../utils/geoLookup');
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
const SETTINGS_ITEM_ID = 'site_settings_home_title';
// Fixed sentinel createdAt so this single item can be fetched via GetCommand
// without needing to know its true creation time (table key is id+createdAt).
const SETTINGS_CREATED_AT = '2000-01-01T00:00:00.000Z';

const DEFAULT_SETTINGS = { defaultTitle: FALLBACK_TITLE, rules: [] };

async function loadSettings() {
  const { Item } = await dynamodb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { id: SETTINGS_ITEM_ID, createdAt: SETTINGS_CREATED_AT },
  }));

  if (!Item || !Item.text) return { settings: DEFAULT_SETTINGS, updatedAt: null };

  try {
    return { settings: JSON.parse(Item.text), updatedAt: Item.updatedAt || Item.createdAt };
  } catch {
    return { settings: DEFAULT_SETTINGS, updatedAt: null };
  }
}

// @desc    Get the dynamic homepage title for the current visitor
// @route   GET /api/data/home-title
// @access  Public (optionalAuth attaches req.user when a valid token is sent)
const getHomeTitle = asyncHandler(async (req, res) => {
  try {
    const { settings } = await loadSettings();

    const context = {};
    if (req.user) {
      context.isLoggedIn = true;
      context.nickname = req.user.nickname || (req.user.text || '').match(/Nickname:([^|]*)/)?.[1]?.trim();
      context.email = req.user.email || (req.user.text || '').match(/Email:([^|]*)/)?.[1]?.trim();
      context.plan = (req.user.text || '').match(/Rank:([^|]*)/)?.[1]?.trim();
      context.accountCreatedAt = req.user.createdAt;
    } else {
      context.isLoggedIn = false;
    }

    // Only bother with a geo lookup if at least one rule needs it — avoids
    // an unnecessary external API call on every homepage load.
    const needsGeo = Array.isArray(settings.rules) && settings.rules.some(
      (r) => r && r.enabled !== false && ['country', 'region', 'city'].includes(r.type)
    );
    if (needsGeo) {
      const ip = extractIp(req);
      const geo = await getGeoForIp(ip);
      if (geo) {
        context.country = geo.country;
        context.region = geo.region;
        context.city = geo.city;
      }
    }

    const { title, matchedRuleId } = resolveHomeTitle(settings, context);
    res.status(200).json({ title, matchedRuleId });
  } catch (error) {
    logger.error('[HomeTitle] Failed to resolve title, using fallback:', error.message);
    // Never fail the homepage over this — always return something usable.
    res.status(200).json({ title: FALLBACK_TITLE, matchedRuleId: null, fallback: true });
  }
});

// @desc    Get the raw home title settings (default + rules) for the admin UI
// @route   GET /api/data/admin/home-title
// @access  Private (admin only — requireAdmin middleware applied in routes)
const getHomeTitleSettings = asyncHandler(async (req, res) => {
  const { settings, updatedAt } = await loadSettings();
  res.status(200).json({ settings, updatedAt });
});

// @desc    Save home title settings (default + rules)
// @route   PUT /api/data/admin/home-title
// @access  Private (admin only — requireAdmin middleware applied in routes)
const updateHomeTitleSettings = asyncHandler(async (req, res) => {
  let sanitized;
  try {
    sanitized = validateHomeTitleSettings(req.body?.settings);
  } catch (error) {
    res.status(400);
    throw error;
  }

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

  res.status(200).json({ success: true, settings: sanitized, updatedAt: now });
});

module.exports = { getHomeTitle, getHomeTitleSettings, updateHomeTitleSettings };
