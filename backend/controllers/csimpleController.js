/**
 * CSimple Settings Sync Controller
 * 
 * Handles cloud sync of CSimple settings, conversations, and behavior files.
 * Data is stored in the existing DynamoDB "Simple" table with prefixed IDs:
 *   - csimple_settings_{userId}
 *   - csimple_convos_{userId}
 *   - csimple_behavior_{userId}_{filename}
 */

require('dotenv').config();
const asyncHandler = require('express-async-handler');
const zlib = require('zlib');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

// Configure AWS DynamoDB Client
const client = new DynamoDBClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const dynamodb = DynamoDBDocumentClient.from(client);
const TABLE_NAME = 'Simple';

// Keys that must NEVER be synced to the cloud
const NEVER_SYNC_KEYS = ['githubToken', 'micDeviceId', 'sttEnabled'];

/**
 * Compress a string with zlib and return base64
 */
function compressString(str) {
  const buf = zlib.deflateSync(Buffer.from(str, 'utf-8'));
  return buf.toString('base64');
}

/**
 * Decompress a base64 zlib string
 */
function decompressString(b64) {
  const buf = zlib.inflateSync(Buffer.from(b64, 'base64'));
  return buf.toString('utf-8');
}

/**
 * Strip sensitive keys from settings before cloud storage
 */
function sanitizeSettings(settings) {
  if (!settings || typeof settings !== 'object') return settings;
  const sanitized = { ...settings };
  NEVER_SYNC_KEYS.forEach(key => delete sanitized[key]);
  return sanitized;
}

// =============================================================================
// SETTINGS ENDPOINTS
// =============================================================================

// @desc    Get user's synced CSimple settings
// @route   GET /api/data/csimple/settings
// @access  Private
const getCSimpleSettings = asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401);
    throw new Error('User not found');
  }

  const itemId = `csimple_settings_${req.user.id}`;

  try {
    const { Item } = await dynamodb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { id: itemId },
    }));

    if (!Item) {
      return res.status(200).json({ settings: null, updatedAt: null });
    }

    const settings = JSON.parse(Item.text);
    res.status(200).json({
      settings,
      updatedAt: Item.updatedAt || Item.createdAt,
    });
  } catch (error) {
    console.error('[CSimple] Error getting settings:', error);
    res.status(500);
    throw new Error('Failed to retrieve CSimple settings');
  }
});

// @desc    Save/update user's CSimple settings
// @route   PUT /api/data/csimple/settings
// @access  Private
const updateCSimpleSettings = asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401);
    throw new Error('User not found');
  }

  const { settings, updatedAt } = req.body;

  if (!settings || typeof settings !== 'object') {
    res.status(400);
    throw new Error('Settings object is required');
  }

  // Strip sensitive keys
  const sanitized = sanitizeSettings(settings);

  const itemId = `csimple_settings_${req.user.id}`;
  const now = new Date().toISOString();

  try {
    await dynamodb.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        id: itemId,
        text: JSON.stringify(sanitized),
        createdAt: updatedAt || now,
        updatedAt: now,
      },
    }));

    res.status(200).json({
      success: true,
      updatedAt: now,
    });
  } catch (error) {
    console.error('[CSimple] Error saving settings:', error);
    res.status(500);
    throw new Error('Failed to save CSimple settings');
  }
});

// =============================================================================
// CONVERSATIONS ENDPOINTS
// =============================================================================

// @desc    Get user's synced conversations
// @route   GET /api/data/csimple/conversations
// @access  Private
const getCSimpleConversations = asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401);
    throw new Error('User not found');
  }

  const itemId = `csimple_convos_${req.user.id}`;

  try {
    const { Item } = await dynamodb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { id: itemId },
    }));

    if (!Item) {
      return res.status(200).json({ conversations: null, updatedAt: null });
    }

    // Conversations may be compressed
    let conversations;
    if (Item.compressed) {
      const decompressed = decompressString(Item.text);
      conversations = JSON.parse(decompressed);
    } else {
      conversations = JSON.parse(Item.text);
    }

    res.status(200).json({
      conversations,
      updatedAt: Item.updatedAt || Item.createdAt,
    });
  } catch (error) {
    console.error('[CSimple] Error getting conversations:', error);
    res.status(500);
    throw new Error('Failed to retrieve CSimple conversations');
  }
});

// @desc    Save/update user's conversations
// @route   PUT /api/data/csimple/conversations
// @access  Private
const updateCSimpleConversations = asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401);
    throw new Error('User not found');
  }

  const { conversations } = req.body;

  if (!Array.isArray(conversations)) {
    res.status(400);
    throw new Error('Conversations array is required');
  }

  const itemId = `csimple_convos_${req.user.id}`;
  const now = new Date().toISOString();

  try {
    const jsonStr = JSON.stringify(conversations);

    // Compress if data is large (>100KB uncompressed) or approaching DynamoDB 400KB limit
    let text, compressed;
    if (jsonStr.length > 100 * 1024) {
      text = compressString(jsonStr);
      compressed = true;
    } else {
      text = jsonStr;
      compressed = false;
    }

    // Check if final item exceeds DynamoDB 400KB limit
    if (text.length > 380 * 1024) {
      res.status(413);
      throw new Error('Conversation data too large. Try clearing old conversations.');
    }

    await dynamodb.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        id: itemId,
        text,
        compressed,
        createdAt: now,
        updatedAt: now,
      },
    }));

    res.status(200).json({
      success: true,
      updatedAt: now,
      compressed,
      sizeBytes: text.length,
    });
  } catch (error) {
    if (error.message?.includes('too large')) {
      throw error; // Re-throw size errors
    }
    console.error('[CSimple] Error saving conversations:', error);
    res.status(500);
    throw new Error('Failed to save CSimple conversations');
  }
});

// =============================================================================
// BEHAVIORS ENDPOINTS
// =============================================================================

// @desc    List user's synced behavior files
// @route   GET /api/data/csimple/behaviors
// @access  Private
const getCSimpleBehaviors = asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401);
    throw new Error('User not found');
  }

  const prefix = `csimple_behavior_${req.user.id}_`;

  try {
    const { Items } = await dynamodb.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'begins_with(id, :prefix)',
      ExpressionAttributeValues: { ':prefix': prefix },
      ProjectionExpression: 'id, updatedAt, createdAt',
    }));

    const behaviors = (Items || []).map(item => {
      const name = item.id.replace(prefix, '');
      return {
        name,
        updatedAt: item.updatedAt || item.createdAt,
      };
    });

    res.status(200).json({ behaviors });
  } catch (error) {
    console.error('[CSimple] Error listing behaviors:', error);
    res.status(500);
    throw new Error('Failed to list CSimple behaviors');
  }
});

// @desc    Get a specific behavior file content
// @route   GET /api/data/csimple/behaviors/:name
// @access  Private
const getCSimpleBehavior = asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401);
    throw new Error('User not found');
  }

  const { name } = req.params;
  if (!name) {
    res.status(400);
    throw new Error('Behavior name is required');
  }

  const itemId = `csimple_behavior_${req.user.id}_${name}`;

  try {
    const { Item } = await dynamodb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { id: itemId },
    }));

    if (!Item) {
      res.status(404);
      throw new Error('Behavior file not found');
    }

    res.status(200).json({
      name,
      content: Item.text,
      updatedAt: Item.updatedAt || Item.createdAt,
    });
  } catch (error) {
    if (error.message === 'Behavior file not found') throw error;
    console.error('[CSimple] Error getting behavior:', error);
    res.status(500);
    throw new Error('Failed to retrieve behavior file');
  }
});

// @desc    Save/update a behavior file
// @route   PUT /api/data/csimple/behaviors/:name
// @access  Private
const updateCSimpleBehavior = asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401);
    throw new Error('User not found');
  }

  const { name } = req.params;
  const { content } = req.body;

  if (!name) {
    res.status(400);
    throw new Error('Behavior name is required');
  }

  if (typeof content !== 'string') {
    res.status(400);
    throw new Error('Behavior content must be a string');
  }

  const itemId = `csimple_behavior_${req.user.id}_${name}`;
  const now = new Date().toISOString();

  try {
    await dynamodb.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        id: itemId,
        text: content,
        createdAt: now,
        updatedAt: now,
      },
    }));

    res.status(200).json({
      success: true,
      name,
      updatedAt: now,
    });
  } catch (error) {
    console.error('[CSimple] Error saving behavior:', error);
    res.status(500);
    throw new Error('Failed to save behavior file');
  }
});

// @desc    Delete a behavior file
// @route   DELETE /api/data/csimple/behaviors/:name
// @access  Private
const deleteCSimpleBehavior = asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401);
    throw new Error('User not found');
  }

  const { name } = req.params;
  if (!name) {
    res.status(400);
    throw new Error('Behavior name is required');
  }

  const itemId = `csimple_behavior_${req.user.id}_${name}`;

  try {
    await dynamodb.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { id: itemId },
    }));

    res.status(200).json({
      success: true,
      name,
    });
  } catch (error) {
    console.error('[CSimple] Error deleting behavior:', error);
    res.status(500);
    throw new Error('Failed to delete behavior file');
  }
});

module.exports = {
  getCSimpleSettings,
  updateCSimpleSettings,
  getCSimpleConversations,
  updateCSimpleConversations,
  getCSimpleBehaviors,
  getCSimpleBehavior,
  updateCSimpleBehavior,
  deleteCSimpleBehavior,
};
