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
const { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, ScanCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

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

// Keys that must NEVER be synced to the cloud (device-specific hardware settings)
const NEVER_SYNC_KEYS = ['micDeviceId', 'sttEnabled'];

// Behavior name validation: alphanumeric, hyphens, underscores, dots only
const VALID_BEHAVIOR_NAME = /^[a-zA-Z0-9_\-. ]{1,100}$/;

// Fixed createdAt sentinel for CSimple items (table has composite key: id + createdAt)
// Using a fixed value lets us use GetCommand directly instead of scanning.
const CSIMPLE_CREATED_AT = '2000-01-01T00:00:00.000Z';

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
      Key: { id: itemId, createdAt: CSIMPLE_CREATED_AT },
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
        createdAt: CSIMPLE_CREATED_AT,
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
      Key: { id: itemId, createdAt: CSIMPLE_CREATED_AT },
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
        createdAt: CSIMPLE_CREATED_AT,
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
  if (!name || !VALID_BEHAVIOR_NAME.test(name)) {
    res.status(400);
    throw new Error('Invalid behavior name. Use only letters, numbers, hyphens, underscores, and dots (max 100 chars).');
  }

  const itemId = `csimple_behavior_${req.user.id}_${name}`;

  try {
    const { Item } = await dynamodb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { id: itemId, createdAt: CSIMPLE_CREATED_AT },
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

  if (!name || !VALID_BEHAVIOR_NAME.test(name)) {
    res.status(400);
    throw new Error('Invalid behavior name. Use only letters, numbers, hyphens, underscores, and dots (max 100 chars).');
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
        createdAt: CSIMPLE_CREATED_AT,
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
  if (!name || !VALID_BEHAVIOR_NAME.test(name)) {
    res.status(400);
    throw new Error('Invalid behavior name. Use only letters, numbers, hyphens, underscores, and dots (max 100 chars).');
  }

  const itemId = `csimple_behavior_${req.user.id}_${name}`;

  try {
    await dynamodb.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { id: itemId, createdAt: CSIMPLE_CREATED_AT },
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

// =============================================================================
// MEMORY FILE ENDPOINTS (cloud storage for AI memory)
// =============================================================================

// Valid filename: alphanumeric, hyphens, underscores, dots, spaces, parens (max 100 chars)
const VALID_FILENAME = /^[a-zA-Z0-9_\-. ()]{1,100}$/;

// @desc    List user's synced memory files
// @route   GET /api/data/csimple/memory
// @access  Private
const getCSimpleMemoryFiles = asyncHandler(async (req, res) => {
  if (!req.user) { res.status(401); throw new Error('User not found'); }

  const prefix = `csimple_memory_${req.user.id}_`;
  try {
    const { Items } = await dynamodb.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'begins_with(id, :prefix)',
      ExpressionAttributeValues: { ':prefix': prefix },
      ProjectionExpression: 'id, updatedAt, createdAt',
    }));
    const files = (Items || []).map(item => ({
      name: item.id.replace(prefix, ''),
      updatedAt: item.updatedAt || item.createdAt,
    }));
    res.status(200).json({ files });
  } catch (error) {
    console.error('[CSimple] Error listing memory files:', error);
    res.status(500);
    throw new Error('Failed to list memory files');
  }
});

// @desc    Get a specific memory file
// @route   GET /api/data/csimple/memory/:name
// @access  Private
const getCSimpleMemoryFile = asyncHandler(async (req, res) => {
  if (!req.user) { res.status(401); throw new Error('User not found'); }
  const { name } = req.params;
  if (!name || !VALID_FILENAME.test(name)) {
    res.status(400);
    throw new Error('Invalid filename');
  }
  const itemId = `csimple_memory_${req.user.id}_${name}`;
  try {
    const { Item } = await dynamodb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { id: itemId, createdAt: CSIMPLE_CREATED_AT },
    }));
    if (!Item) { res.status(404); throw new Error('Memory file not found'); }
    res.status(200).json({ name, content: Item.text, updatedAt: Item.updatedAt || Item.createdAt });
  } catch (error) {
    if (error.message === 'Memory file not found') throw error;
    console.error('[CSimple] Error getting memory file:', error);
    res.status(500);
    throw new Error('Failed to retrieve memory file');
  }
});

// @desc    Create or update a memory file
// @route   PUT /api/data/csimple/memory/:name
// @access  Private
const updateCSimpleMemoryFile = asyncHandler(async (req, res) => {
  if (!req.user) { res.status(401); throw new Error('User not found'); }
  const { name } = req.params;
  const { content } = req.body;
  if (!name || !VALID_FILENAME.test(name)) {
    res.status(400);
    throw new Error('Invalid filename');
  }
  if (typeof content !== 'string') {
    res.status(400);
    throw new Error('Content must be a string');
  }
  // Cap single file at 32KB
  if (Buffer.byteLength(content, 'utf-8') > 32 * 1024) {
    res.status(413);
    throw new Error('Memory file too large (max 32 KB)');
  }
  const itemId = `csimple_memory_${req.user.id}_${name}`;
  const now = new Date().toISOString();
  try {
    await dynamodb.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: { id: itemId, text: content, createdAt: CSIMPLE_CREATED_AT, updatedAt: now },
    }));
    res.status(200).json({ success: true, name, updatedAt: now });
  } catch (error) {
    console.error('[CSimple] Error saving memory file:', error);
    res.status(500);
    throw new Error('Failed to save memory file');
  }
});

// @desc    Delete a memory file
// @route   DELETE /api/data/csimple/memory/:name
// @access  Private
const deleteCSimpleMemoryFile = asyncHandler(async (req, res) => {
  if (!req.user) { res.status(401); throw new Error('User not found'); }
  const { name } = req.params;
  if (!name || !VALID_FILENAME.test(name)) {
    res.status(400);
    throw new Error('Invalid filename');
  }
  const itemId = `csimple_memory_${req.user.id}_${name}`;
  try {
    await dynamodb.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { id: itemId, createdAt: CSIMPLE_CREATED_AT },
    }));
    res.status(200).json({ success: true, name });
  } catch (error) {
    console.error('[CSimple] Error deleting memory file:', error);
    res.status(500);
    throw new Error('Failed to delete memory file');
  }
});

// =============================================================================
// PERSONALITY FILE ENDPOINTS (cloud storage for AI personality)
// =============================================================================

// @desc    List user's synced personality files
// @route   GET /api/data/csimple/personality
// @access  Private
const getCSimplePersonalityFiles = asyncHandler(async (req, res) => {
  if (!req.user) { res.status(401); throw new Error('User not found'); }

  const prefix = `csimple_personality_${req.user.id}_`;
  try {
    const { Items } = await dynamodb.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'begins_with(id, :prefix)',
      ExpressionAttributeValues: { ':prefix': prefix },
      ProjectionExpression: 'id, updatedAt, createdAt',
    }));
    const files = (Items || []).map(item => ({
      name: item.id.replace(prefix, ''),
      updatedAt: item.updatedAt || item.createdAt,
    }));
    res.status(200).json({ files });
  } catch (error) {
    console.error('[CSimple] Error listing personality files:', error);
    res.status(500);
    throw new Error('Failed to list personality files');
  }
});

// @desc    Get a specific personality file
// @route   GET /api/data/csimple/personality/:name
// @access  Private
const getCSimplePersonalityFile = asyncHandler(async (req, res) => {
  if (!req.user) { res.status(401); throw new Error('User not found'); }
  const { name } = req.params;
  if (!name || !VALID_FILENAME.test(name)) {
    res.status(400);
    throw new Error('Invalid filename');
  }
  const itemId = `csimple_personality_${req.user.id}_${name}`;
  try {
    const { Item } = await dynamodb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { id: itemId, createdAt: CSIMPLE_CREATED_AT },
    }));
    if (!Item) { res.status(404); throw new Error('Personality file not found'); }
    res.status(200).json({ name, content: Item.text, updatedAt: Item.updatedAt || Item.createdAt });
  } catch (error) {
    if (error.message === 'Personality file not found') throw error;
    console.error('[CSimple] Error getting personality file:', error);
    res.status(500);
    throw new Error('Failed to retrieve personality file');
  }
});

// @desc    Create or update a personality file
// @route   PUT /api/data/csimple/personality/:name
// @access  Private
const updateCSimplePersonalityFile = asyncHandler(async (req, res) => {
  if (!req.user) { res.status(401); throw new Error('User not found'); }
  const { name } = req.params;
  const { content } = req.body;
  if (!name || !VALID_FILENAME.test(name)) {
    res.status(400);
    throw new Error('Invalid filename');
  }
  if (typeof content !== 'string') {
    res.status(400);
    throw new Error('Content must be a string');
  }
  if (Buffer.byteLength(content, 'utf-8') > 16 * 1024) {
    res.status(413);
    throw new Error('Personality file too large (max 16 KB)');
  }
  const itemId = `csimple_personality_${req.user.id}_${name}`;
  const now = new Date().toISOString();
  try {
    await dynamodb.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: { id: itemId, text: content, createdAt: CSIMPLE_CREATED_AT, updatedAt: now },
    }));
    res.status(200).json({ success: true, name, updatedAt: now });
  } catch (error) {
    console.error('[CSimple] Error saving personality file:', error);
    res.status(500);
    throw new Error('Failed to save personality file');
  }
});

// =============================================================================
// USER CONTEXT ENDPOINT (loads memory + personality + behavior for LLM)
// =============================================================================

const MAX_CONTEXT_BYTES = 16 * 1024;
const MAX_SINGLE_FILE = 32 * 1024;
const PRIORITY_PATTERNS = [/^user/i, /profile/i, /preference/i, /identity/i, /name/i];

// @desc    Get full user context for LLM (memory + personality + behavior)
// @route   GET /api/data/csimple/context?behavior=default.txt
// @access  Private
const getCSimpleUserContext = asyncHandler(async (req, res) => {
  if (!req.user) { res.status(401); throw new Error('User not found'); }
  const userId = req.user.id;
  const behaviorName = req.query.behavior || 'default.txt';

  try {
    // ── Load memory files ──
    const memPrefix = `csimple_memory_${userId}_`;
    const { Items: memItems } = await dynamodb.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'begins_with(id, :prefix)',
      ExpressionAttributeValues: { ':prefix': memPrefix },
    }));

    let memoryContext = '';
    if (memItems && memItems.length > 0) {
      // Sort: priority files first, then small → large
      const fileInfos = memItems.map(item => ({
        name: item.id.replace(memPrefix, ''),
        content: (item.text || '').trim(),
        size: Buffer.byteLength(item.text || '', 'utf-8'),
      }));
      fileInfos.sort((a, b) => {
        const aPri = PRIORITY_PATTERNS.some(p => p.test(a.name)) ? 0 : 1;
        const bPri = PRIORITY_PATTERNS.some(p => p.test(b.name)) ? 0 : 1;
        if (aPri !== bPri) return aPri - bPri;
        return a.size - b.size;
      });

      const memories = [];
      let totalSize = 0;
      for (const info of fileInfos) {
        if (info.size > MAX_SINGLE_FILE || !info.content) continue;
        if (totalSize + info.size > MAX_CONTEXT_BYTES) {
          memories.push('[Memory truncated — more files not loaded due to size limit]');
          break;
        }
        const displayName = info.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
        memories.push(`## ${displayName}\n${info.content}`);
        totalSize += info.size;
      }
      if (memories.length > 0) {
        memoryContext = '\n\n--- MEMORY (persistent knowledge) ---\n' + memories.join('\n\n') + '\n--- END MEMORY ---\n';
      }
    }

    // ── Load personality files ──
    const persPrefix = `csimple_personality_${userId}_`;
    const { Items: persItems } = await dynamodb.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'begins_with(id, :prefix)',
      ExpressionAttributeValues: { ':prefix': persPrefix },
    }));

    let personalityContext = '';
    if (persItems && persItems.length > 0) {
      const sections = persItems
        .map(item => (item.text || '').trim())
        .filter(Boolean);
      if (sections.length > 0) {
        personalityContext = '\n\n---\n' + sections.join('\n\n---\n') + '\n\n---\n';
      }
    }

    // ── Load behavior file ──
    let behaviorContext = '';
    if (behaviorName && VALID_BEHAVIOR_NAME.test(behaviorName)) {
      const bhvId = `csimple_behavior_${userId}_${behaviorName}`;
      try {
        const { Item } = await dynamodb.send(new GetCommand({
          TableName: TABLE_NAME,
          Key: { id: bhvId, createdAt: CSIMPLE_CREATED_AT },
        }));
        if (Item?.text) {
          behaviorContext = '\n\n--- BEHAVIOR INSTRUCTIONS ---\n' + Item.text.trim() + '\n--- END BEHAVIOR ---\n';
        }
      } catch { /* behavior not found — ok */ }
    }

    res.status(200).json({
      memoryContext,
      personalityContext,
      behaviorContext,
      hasMemory: memoryContext.length > 0,
      hasPersonality: personalityContext.length > 0,
      hasBehavior: behaviorContext.length > 0,
    });
  } catch (error) {
    console.error('[CSimple] Error loading user context:', error);
    res.status(500);
    throw new Error('Failed to load user context');
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
  getCSimpleMemoryFiles,
  getCSimpleMemoryFile,
  updateCSimpleMemoryFile,
  deleteCSimpleMemoryFile,
  getCSimplePersonalityFiles,
  getCSimplePersonalityFile,
  updateCSimplePersonalityFile,
  getCSimpleUserContext,
};
