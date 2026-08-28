/**
 * Simple Settings Sync Controller
 * 
 * Handles cloud sync of Simple settings, conversations, and behavior files.
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
const { encryptString, decryptString } = require('../utils/secretCrypto');
const { logger } = require('../utils/logger');

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

// Keys whose values are sensitive secrets — encrypted at rest before persisting
// to DynamoDB and decrypted when read back. Currently just the GitHub PAT.
const SENSITIVE_KEYS = ['githubToken'];

/**
 * Encrypt sensitive fields in a settings object. Non-string / empty values
 * pass through. Returns a new object.
 */
function encryptSensitive(settings) {
  if (!settings || typeof settings !== 'object') return settings;
  const out = { ...settings };
  for (const key of SENSITIVE_KEYS) {
    if (key in out) out[key] = encryptString(out[key]);
  }
  return out;
}

/**
 * Decrypt sensitive fields in a settings object pulled from storage.
 * Returns a new object.
 */
function decryptSensitive(settings) {
  if (!settings || typeof settings !== 'object') return settings;
  const out = { ...settings };
  for (const key of SENSITIVE_KEYS) {
    if (key in out) out[key] = decryptString(out[key]);
  }
  return out;
}

// Behavior name validation: alphanumeric, hyphens, underscores, dots only
const VALID_BEHAVIOR_NAME = /^[a-zA-Z0-9_\-. ]{1,100}$/;

// Fixed createdAt sentinel for Simple items (table has composite key: id + createdAt)
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

// @desc    Get user's synced Simple settings
// @route   GET /api/data/csimple/settings
// @access  Private
const getSimpleSettings = asyncHandler(async (req, res) => {
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

    const stored = JSON.parse(Item.text);
    const settings = decryptSensitive(stored);
    res.status(200).json({
      settings,
      updatedAt: Item.updatedAt || Item.createdAt,
    });
  } catch (error) {
    logger.error('[Simple] Error getting settings:', error);
    res.status(500);
    throw new Error('Failed to retrieve Simple settings');
  }
});

// @desc    Save/update user's Simple settings
// @route   PUT /api/data/csimple/settings
// @access  Private
const updateSimpleSettings = asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401);
    throw new Error('User not found');
  }

  const { settings, updatedAt } = req.body;

  if (!settings || typeof settings !== 'object') {
    res.status(400);
    throw new Error('Settings object is required');
  }

  // Strip device-only keys, then encrypt any sensitive secrets (e.g. PATs)
  const sanitized = sanitizeSettings(settings);
  const encrypted = encryptSensitive(sanitized);

  const itemId = `csimple_settings_${req.user.id}`;
  const now = new Date().toISOString();

  try {
    await dynamodb.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        id: itemId,
        text: JSON.stringify(encrypted),
        createdAt: CSIMPLE_CREATED_AT,
        updatedAt: now,
      },
    }));

    res.status(200).json({
      success: true,
      updatedAt: now,
    });
  } catch (error) {
    logger.error('[Simple] Error saving settings:', error);
    res.status(500);
    throw new Error('Failed to save Simple settings');
  }
});

// =============================================================================
// CONVERSATIONS ENDPOINTS
// =============================================================================

// @desc    Get user's synced conversations
// @route   GET /api/data/csimple/conversations
// @access  Private
const getSimpleConversations = asyncHandler(async (req, res) => {
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
      return res.status(200).json({ conversations: null, deletedIds: [], updatedAt: null });
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
      deletedIds: Array.isArray(Item.deletedIds) ? Item.deletedIds.map(String) : [],
      updatedAt: Item.updatedAt || Item.createdAt,
    });
  } catch (error) {
    logger.error('[Simple] Error getting conversations:', error);
    res.status(500);
    throw new Error('Failed to retrieve Simple conversations');
  }
});

// @desc    Save/update user's conversations
// @route   PUT /api/data/csimple/conversations
// @access  Private
const updateSimpleConversations = asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401);
    throw new Error('User not found');
  }

  const { conversations, deletedIds } = req.body;

  if (!Array.isArray(conversations)) {
    res.status(400);
    throw new Error('Conversations array is required');
  }

  const itemId = `csimple_convos_${req.user.id}`;
  const now = new Date().toISOString();

  try {
    // Preserve any server-persisted deletion tombstones and union them with
    // the ones this request may carry, so a full overwrite can't resurrect a
    // conversation another device deleted.
    let existingDeletedIds = [];
    try {
      const { Item } = await dynamodb.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { id: itemId, createdAt: CSIMPLE_CREATED_AT },
      }));
      if (Array.isArray(Item?.deletedIds)) existingDeletedIds = Item.deletedIds.map(String);
    } catch { /* no stored copy yet */ }

    const allDeletedIds = unionTombstones(existingDeletedIds, deletedIds);
    const tombstone = new Set(allDeletedIds);
    const filtered = conversations
      .filter(c => c && c.id != null && !tombstone.has(String(c.id)))
      // Empty conversations (no messages) carry nothing worth persisting. The
      // client always keeps a local "New Chat" placeholder and used to eagerly
      // sync it, which accumulated dozens of empty chats across devices.
      .filter(c => Array.isArray(c?.messages) && c.messages.length > 0);

    const jsonStr = JSON.stringify(filtered);

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
        deletedIds: allDeletedIds,
        createdAt: CSIMPLE_CREATED_AT,
        updatedAt: now,
      },
    }));

    res.status(200).json({
      success: true,
      updatedAt: now,
      deletedIds: allDeletedIds,
      compressed,
      sizeBytes: text.length,
    });
  } catch (error) {
    if (error.message?.includes('too large')) {
      throw error; // Re-throw size errors
    }
    logger.error('[Simple] Error saving conversations:', error);
    res.status(500);
    throw new Error('Failed to save Simple conversations');
  }
});

// @desc    Merge local conversations with the cloud copy (bidirectional sync)
// @route   POST /api/data/csimple/conversations/merge
// @access  Private
const mergeSimpleConversations = asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401);
    throw new Error('User not found');
  }

  const { conversations, deletedIds } = req.body;
  if (!Array.isArray(conversations)) {
    res.status(400);
    throw new Error('Conversations array is required');
  }

  const itemId = `csimple_convos_${req.user.id}`;
  const now = new Date().toISOString();

  try {
    // Read the existing cloud copy (if any).
    let existing = [];
    let existingDeletedIds = [];
    try {
      const { Item } = await dynamodb.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { id: itemId, createdAt: CSIMPLE_CREATED_AT },
      }));
      if (Item?.text) {
        const raw = Item.compressed ? decompressString(Item.text) : Item.text;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) existing = parsed;
      }
      if (Array.isArray(Item?.deletedIds)) existingDeletedIds = Item.deletedIds.map(String);
    } catch { /* no cloud copy yet — start from scratch */ }

    // Union the server-persisted tombstones with the client's, so a delete on
    // any device stays deleted everywhere instead of being resurrected by a
    // stale device that never saw it.
    const allDeletedIds = unionTombstones(existingDeletedIds, deletedIds);

    const merged = mergeConversationLists(existing, conversations, allDeletedIds);

    // Drop empty conversations (no messages) — they carry nothing worth
    // persisting and previously accumulated from each device's fresh
    // "New Chat" placeholder being eagerly synced.
    const nonEmpty = merged.filter(c => Array.isArray(c?.messages) && c.messages.length > 0);

    const jsonStr = JSON.stringify(nonEmpty);
    let text, compressed;
    if (jsonStr.length > 100 * 1024) {
      text = compressString(jsonStr);
      compressed = true;
    } else {
      text = jsonStr;
      compressed = false;
    }

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
        deletedIds: allDeletedIds,
        createdAt: CSIMPLE_CREATED_AT,
        updatedAt: now,
      },
    }));

    res.status(200).json({
      success: true,
      conversations: nonEmpty,
      deletedIds: allDeletedIds,
      updatedAt: now,
      compressed,
      sizeBytes: text.length,
    });
  } catch (error) {
    if (error.message?.includes('too large')) {
      throw error; // Re-throw size errors
    }
    logger.error('[Simple] Error merging conversations:', error);
    res.status(500);
    throw new Error('Failed to merge Simple conversations');
  }
});

// =============================================================================
// CONVERSATION MERGE HELPERS
// =============================================================================

/**
 * Best-effort recency timestamp (ms) for a conversation. Prefers an explicit
 * `updatedAt`, then the latest message timestamp, then `createdAt`. Used to
 * pick which copy of a same-id conversation is newer without trusting clock
 * skew across devices.
 */
function conversationRecency(conv) {
  if (!conv || typeof conv !== 'object') return 0;
  const updated = conv.updatedAt ? Date.parse(conv.updatedAt) : NaN;
  if (!Number.isNaN(updated)) return updated;

  const msgs = Array.isArray(conv.messages) ? conv.messages : [];
  let max = NaN;
  for (const m of msgs) {
    const t = m?.timestamp ? Date.parse(m.timestamp) : NaN;
    if (!Number.isNaN(t) && (Number.isNaN(max) || t > max)) max = t;
  }
  if (!Number.isNaN(max)) return max;

  const created = conv.createdAt ? Date.parse(conv.createdAt) : NaN;
  return Number.isNaN(created) ? 0 : created;
}

/** Prefer a meaningful title over the default "New Chat" placeholder. */
function pickConversationTitle(a, b) {
  const newer = conversationRecency(b) > conversationRecency(a) ? b : a;
  const older = newer === a ? b : a;
  const meaningful = (c) =>
    typeof c?.title === 'string' &&
    c.title.trim() !== '' &&
    !/^new chat$/i.test(c.title.trim());
  if (meaningful(newer)) return newer.title;
  if (meaningful(older)) return older.title;
  return newer?.title || older?.title || 'New Chat';
}

/** Stable key for a message — id when present, else a content hash. */
function messageKey(m) {
  if (m && m.id != null) return `id:${m.id}`;
  return `hash:${m?.role || ''}|${m?.timestamp || ''}|${String(m?.content || '').slice(0, 200)}`;
}

/**
 * Merge two message arrays: union by key, ordered by timestamp (stable for
 * ties). This is what lets the default "New Chat" (id '1') that exists on
 * every device actually merge its messages instead of one side clobbering it.
 */
function mergeMessageLists(a, b) {
  const listA = Array.isArray(a) ? a : [];
  const listB = Array.isArray(b) ? b : [];
  const byKey = new Map();
  for (const m of listA) if (m && typeof m === 'object') byKey.set(messageKey(m), m);
  for (const m of listB) if (m && typeof m === 'object') byKey.set(messageKey(m), m);
  const msgs = Array.from(byKey.values());
  msgs.sort((x, y) => {
    const tx = x?.timestamp ? Date.parse(x.timestamp) : NaN;
    const ty = y?.timestamp ? Date.parse(y.timestamp) : NaN;
    if (!Number.isNaN(tx) && !Number.isNaN(ty) && tx !== ty) return tx - ty;
    if (Number.isNaN(tx) !== Number.isNaN(ty)) return Number.isNaN(tx) ? 1 : -1;
    return 0;
  });
  return msgs;
}

/** Merge two same-id conversations: union messages, keep the newer metadata. */
function mergeConversation(a, b) {
  const recencyA = conversationRecency(a);
  const recencyB = conversationRecency(b);
  const newer = recencyB > recencyA ? b : a;
  const older = newer === a ? b : a;

  return {
    ...older,
    ...newer,
    messages: mergeMessageLists(a.messages, b.messages),
    title: pickConversationTitle(a, b),
    updatedAt: new Date(Math.max(recencyA, recencyB)).toISOString(),
  };
}

/**
 * Union of deletion tombstones from the server-persisted set and the
 * client's set. Tombstones are stored server-side so a delete made on one
 * device stays deleted on every other device — otherwise a stale device that
 * never saw the delete would resurrect the conversation on its next sync.
 * Pure helper (exported for tests as `_unionTombstones`).
 */
function unionTombstones(existingDeletedIds, clientDeletedIds) {
  const set = new Set();
  (Array.isArray(existingDeletedIds) ? existingDeletedIds : []).forEach(id => set.add(String(id)));
  (Array.isArray(clientDeletedIds) ? clientDeletedIds : []).forEach(id => set.add(String(id)));
  return Array.from(set);
}

/**
 * Merge two full conversation lists: union by conversation id, merging any
 * same-id conversations message-by-message. Removes conversations whose id is
 * in `deletedIds` (deletion tombstones) so a delete on one device isn't
 * resurrected by another device's next sync. Order is deterministic
 * (newest-first by recency).
 */
function mergeConversationLists(existing, incoming, deletedIds = []) {
  const tombstone = new Set((deletedIds || []).map(String));
  const byId = new Map();

  for (const c of existing) {
    if (!c || typeof c !== 'object' || c.id == null) continue;
    const id = String(c.id);
    if (tombstone.has(id)) continue;
    byId.set(id, c);
  }
  for (const c of incoming) {
    if (!c || typeof c !== 'object' || c.id == null) continue;
    const id = String(c.id);
    if (tombstone.has(id)) continue;
    const prev = byId.get(id);
    byId.set(id, prev ? mergeConversation(prev, c) : c);
  }

  const merged = Array.from(byId.values());
  merged.sort((a, b) => {
    const ra = conversationRecency(a);
    const rb = conversationRecency(b);
    if (ra !== rb) return rb - ra;
    return String(a.id).localeCompare(String(b.id));
  });
  return merged;
}

// =============================================================================
// BEHAVIORS ENDPOINTS
// =============================================================================

// @desc    List user's synced behavior files
// @route   GET /api/data/csimple/behaviors
// @access  Private
const getSimpleBehaviors = asyncHandler(async (req, res) => {
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
    logger.error('[Simple] Error listing behaviors:', error);
    res.status(500);
    throw new Error('Failed to list Simple behaviors');
  }
});

// @desc    Get a specific behavior file content
// @route   GET /api/data/csimple/behaviors/:name
// @access  Private
const getSimpleBehavior = asyncHandler(async (req, res) => {
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
    logger.error('[Simple] Error getting behavior:', error);
    res.status(500);
    throw new Error('Failed to retrieve behavior file');
  }
});

// @desc    Save/update a behavior file
// @route   PUT /api/data/csimple/behaviors/:name
// @access  Private
const updateSimpleBehavior = asyncHandler(async (req, res) => {
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
    logger.error('[Simple] Error saving behavior:', error);
    res.status(500);
    throw new Error('Failed to save behavior file');
  }
});

// @desc    Delete a behavior file
// @route   DELETE /api/data/csimple/behaviors/:name
// @access  Private
const deleteSimpleBehavior = asyncHandler(async (req, res) => {
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
    logger.error('[Simple] Error deleting behavior:', error);
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
const getSimpleMemoryFiles = asyncHandler(async (req, res) => {
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
    logger.error('[Simple] Error listing memory files:', error);
    res.status(500);
    throw new Error('Failed to list memory files');
  }
});

// @desc    Get a specific memory file
// @route   GET /api/data/csimple/memory/:name
// @access  Private
const getSimpleMemoryFile = asyncHandler(async (req, res) => {
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
    logger.error('[Simple] Error getting memory file:', error);
    res.status(500);
    throw new Error('Failed to retrieve memory file');
  }
});

// @desc    Create or update a memory file
// @route   PUT /api/data/csimple/memory/:name
// @access  Private
const updateSimpleMemoryFile = asyncHandler(async (req, res) => {
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
    logger.error('[Simple] Error saving memory file:', error);
    res.status(500);
    throw new Error('Failed to save memory file');
  }
});

// @desc    Delete a memory file
// @route   DELETE /api/data/csimple/memory/:name
// @access  Private
const deleteSimpleMemoryFile = asyncHandler(async (req, res) => {
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
    logger.error('[Simple] Error deleting memory file:', error);
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
const getSimplePersonalityFiles = asyncHandler(async (req, res) => {
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
    logger.error('[Simple] Error listing personality files:', error);
    res.status(500);
    throw new Error('Failed to list personality files');
  }
});

// @desc    Get a specific personality file
// @route   GET /api/data/csimple/personality/:name
// @access  Private
const getSimplePersonalityFile = asyncHandler(async (req, res) => {
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
    logger.error('[Simple] Error getting personality file:', error);
    res.status(500);
    throw new Error('Failed to retrieve personality file');
  }
});

// @desc    Create or update a personality file
// @route   PUT /api/data/csimple/personality/:name
// @access  Private
const updateSimplePersonalityFile = asyncHandler(async (req, res) => {
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
    logger.error('[Simple] Error saving personality file:', error);
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
const getSimpleUserContext = asyncHandler(async (req, res) => {
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
    logger.error('[Simple] Error loading user context:', error);
    res.status(500);
    throw new Error('Failed to load user context');
  }
});

module.exports = {
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

  // Test-only exports of the pure conversation-merge helpers.
  _mergeConversationLists: mergeConversationLists,
  _mergeConversation: mergeConversation,
  _mergeMessageLists: mergeMessageLists,
  _unionTombstones: unionTombstones,
};
