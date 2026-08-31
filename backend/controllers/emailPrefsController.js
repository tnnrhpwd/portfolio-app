// Email notification preferences controller.
//
// Reads/writes the per-user email notification toggles (billing, product,
// marketing) stored as pipe-delimited fields on the user's `text` blob.
//
// IMPORTANT: req.user.text is the REDACTED copy (password hash replaced with
// "[redacted]" by authMiddleware). Writing that back would destroy the real
// password hash and break login — so every write re-fetches the full record
// from DynamoDB first and only mutates the preference fields.

const asyncHandler = require('express-async-handler');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const {
  getEmailPreferences,
  updateEmailPreferencesInText,
  TOGGLEABLE_CATEGORIES,
} = require('../services/emailPreferences');
const { fetchRawUserRecord } = require('../utils/dynamoUser');
const { logger } = require('../utils/logger');

const client = new DynamoDBClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const dynamodb = DynamoDBDocumentClient.from(client);

// @desc    Get the current user's email notification preferences
// @route   GET /api/data/email-preferences
// @access  Private
const getEmailPrefs = asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401);
    throw new Error('Not authorized');
  }

  // req.user.text is redacted, but preferences never overlap the password
  // field, so parsing it directly is safe (and avoids a DB round-trip).
  res.status(200).json({
    success: true,
    preferences: getEmailPreferences(req.user.text),
  });
});

// @desc    Update the current user's email notification preferences
// @route   PUT /api/data/email-preferences
// @access  Private
const updateEmailPrefs = asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401);
    throw new Error('Not authorized');
  }

  const incoming = req.body?.preferences || req.body || {};
  const updates = {};
  for (const key of TOGGLEABLE_CATEGORIES) {
    if (typeof incoming[key] === 'boolean') updates[key] = incoming[key];
  }

  if (Object.keys(updates).length === 0) {
    res.status(400);
    throw new Error('No valid preference fields provided.');
  }

  // Re-fetch the full (non-redacted) record so the password hash survives.
  // Use the Query-fallback helper — the `Simple` table's key is composite
  // (`id` + `createdAt`), so a plain GetCommand keyed on `id` alone throws.
  const fullItem = await fetchRawUserRecord(dynamodb, req.user.id);

  if (!fullItem) {
    res.status(404);
    throw new Error('User record not found.');
  }

  const updatedText = updateEmailPreferencesInText(fullItem.text, updates);

  await dynamodb.send(new PutCommand({
    TableName: 'Simple',
    Item: {
      ...fullItem,
      text: updatedText,
      updatedAt: new Date().toISOString(),
    },
  }));

  logger.debug('Email preferences updated', { userId: req.user.id, updates });

  res.status(200).json({
    success: true,
    preferences: getEmailPreferences(updatedText),
  });
});

module.exports = { getEmailPrefs, updateEmailPrefs };
