/**
 * Addon Relay Controller
 * 
 * Enables remote command execution: phone → cloud backend → desktop addon.
 * 
 * Flow:
 *   1. Desktop addon sends heartbeat every 30s → backend knows it's online
 *   2. Phone frontend checks addon status → "is my addon online?"
 *   3. Phone sends a chat command → backend queues it
 *   4. Desktop addon polls for pending commands → picks up + executes
 *   5. Desktop addon posts result → backend stores it
 *   6. Phone polls for result → gets the response
 * 
 * DynamoDB items:
 *   - addon_heartbeat_{userId}  — addon online status
 *   - addon_queue_{userId}      — pending command queue
 *   - addon_result_{commandId}  — individual command results
 */

require('dotenv').config();
const crypto = require('crypto');
const asyncHandler = require('express-async-handler');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const dynamodb = DynamoDBDocumentClient.from(client);
const TABLE_NAME = 'Simple';
const CREATED_AT = '2000-01-01T00:00:00.000Z';

// Addon is considered offline after 60s without heartbeat
const HEARTBEAT_TTL_MS = 60000;
// Commands expire after 5 minutes if not picked up
const COMMAND_TTL_MS = 300000;
// Results expire after 10 minutes
const RESULT_TTL_MS = 600000;

// ============================================================================
// HEARTBEAT — addon registers itself as online
// ============================================================================

// @desc    Addon sends heartbeat to register as online
// @route   POST /api/data/addon/heartbeat
// @access  Private
const addonHeartbeat = asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401);
    throw new Error('User not found');
  }

  const { version, hostname } = req.body;
  const itemId = `addon_heartbeat_${req.user.id}`;
  const now = new Date().toISOString();

  await dynamodb.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      id: itemId,
      createdAt: CREATED_AT,
      text: JSON.stringify({
        lastSeen: Date.now(),
        version: version || null,
        hostname: hostname || null,
        updatedAt: now,
      }),
      updatedAt: now,
    },
  }));

  res.status(200).json({ success: true, timestamp: now });
});

// @desc    Check if user's addon is online
// @route   GET /api/data/addon/status
// @access  Private
const getAddonStatus = asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401);
    throw new Error('User not found');
  }

  const itemId = `addon_heartbeat_${req.user.id}`;

  try {
    const { Item } = await dynamodb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { id: itemId, createdAt: CREATED_AT },
    }));

    if (!Item?.text) {
      return res.status(200).json({ online: false });
    }

    const heartbeat = JSON.parse(Item.text);
    const isOnline = (Date.now() - heartbeat.lastSeen) < HEARTBEAT_TTL_MS;

    res.status(200).json({
      online: isOnline,
      lastSeen: heartbeat.lastSeen,
      version: heartbeat.version,
      hostname: heartbeat.hostname,
    });
  } catch (error) {
    console.error('[AddonRelay] Error checking addon status:', error);
    res.status(200).json({ online: false });
  }
});

// ============================================================================
// COMMAND QUEUE — frontend queues commands for addon execution
// ============================================================================

// @desc    Queue a chat command for the addon to execute
// @route   POST /api/data/addon/command
// @access  Private
const queueCommand = asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401);
    throw new Error('User not found');
  }

  const { type, payload } = req.body;
  if (!type || !payload) {
    res.status(400);
    throw new Error('type and payload are required');
  }

  // Validate type
  const VALID_TYPES = ['chat', 'chat_stream'];
  if (!VALID_TYPES.includes(type)) {
    res.status(400);
    throw new Error(`Invalid command type. Must be one of: ${VALID_TYPES.join(', ')}`);
  }

  const commandId = crypto.randomUUID();
  const now = Date.now();

  // Read existing queue
  const queueId = `addon_queue_${req.user.id}`;
  let commands = [];
  try {
    const { Item } = await dynamodb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { id: queueId, createdAt: CREATED_AT },
    }));
    if (Item?.text) {
      commands = JSON.parse(Item.text);
      // Prune expired commands
      commands = commands.filter(c => (now - c.createdAt) < COMMAND_TTL_MS);
    }
  } catch { /* empty queue */ }

  // Add new command
  commands.push({
    id: commandId,
    type,
    payload,
    status: 'pending',
    createdAt: now,
  });

  // Save queue
  await dynamodb.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      id: queueId,
      createdAt: CREATED_AT,
      text: JSON.stringify(commands),
      updatedAt: new Date().toISOString(),
    },
  }));

  res.status(201).json({ commandId, status: 'pending' });
});

// @desc    Addon polls for pending commands
// @route   GET /api/data/addon/pending
// @access  Private
const getPendingCommands = asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401);
    throw new Error('User not found');
  }

  const queueId = `addon_queue_${req.user.id}`;
  const now = Date.now();

  try {
    const { Item } = await dynamodb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { id: queueId, createdAt: CREATED_AT },
    }));

    if (!Item?.text) {
      return res.status(200).json({ commands: [] });
    }

    let commands = JSON.parse(Item.text);
    // Filter to only pending, non-expired commands
    const pending = commands.filter(c =>
      c.status === 'pending' && (now - c.createdAt) < COMMAND_TTL_MS
    );

    // Mark fetched commands as 'processing' so they aren't picked up again
    if (pending.length > 0) {
      const pendingIds = new Set(pending.map(c => c.id));
      commands = commands.map(c =>
        pendingIds.has(c.id) ? { ...c, status: 'processing' } : c
      );
      // Prune old commands
      commands = commands.filter(c => (now - c.createdAt) < COMMAND_TTL_MS);
      await dynamodb.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          id: queueId,
          createdAt: CREATED_AT,
          text: JSON.stringify(commands),
          updatedAt: new Date().toISOString(),
        },
      }));
    }

    res.status(200).json({ commands: pending });
  } catch (error) {
    console.error('[AddonRelay] Error getting pending commands:', error);
    res.status(200).json({ commands: [] });
  }
});

// ============================================================================
// RESULTS — addon posts results, frontend polls for them
// ============================================================================

// @desc    Addon posts the result of a command execution
// @route   POST /api/data/addon/result/:commandId
// @access  Private
const postCommandResult = asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401);
    throw new Error('User not found');
  }

  const { commandId } = req.params;
  if (!commandId) {
    res.status(400);
    throw new Error('commandId is required');
  }

  const { result, error: resultError, tokens, cost } = req.body;
  const resultId = `addon_result_${commandId}`;

  await dynamodb.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      id: resultId,
      createdAt: CREATED_AT,
      text: JSON.stringify({
        commandId,
        userId: req.user.id,
        result: result || null,
        error: resultError || null,
        tokens: tokens || null,
        cost: cost || null,
        completedAt: Date.now(),
      }),
      updatedAt: new Date().toISOString(),
    },
  }));

  // Remove the command from the queue
  const queueId = `addon_queue_${req.user.id}`;
  try {
    const { Item } = await dynamodb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { id: queueId, createdAt: CREATED_AT },
    }));
    if (Item?.text) {
      let commands = JSON.parse(Item.text);
      commands = commands.filter(c => c.id !== commandId);
      await dynamodb.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          id: queueId,
          createdAt: CREATED_AT,
          text: JSON.stringify(commands),
          updatedAt: new Date().toISOString(),
        },
      }));
    }
  } catch { /* ignore cleanup errors */ }

  res.status(200).json({ success: true });
});

// @desc    Frontend polls for a command result
// @route   GET /api/data/addon/result/:commandId
// @access  Private
const getCommandResult = asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401);
    throw new Error('User not found');
  }

  const { commandId } = req.params;
  const resultId = `addon_result_${commandId}`;

  try {
    const { Item } = await dynamodb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { id: resultId, createdAt: CREATED_AT },
    }));

    if (!Item?.text) {
      return res.status(200).json({ status: 'pending', result: null });
    }

    const data = JSON.parse(Item.text);

    // Verify the result belongs to this user
    if (data.userId !== req.user.id) {
      return res.status(200).json({ status: 'pending', result: null });
    }

    // Clean up the result after it's been read
    await dynamodb.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { id: resultId, createdAt: CREATED_AT },
    })).catch(() => {});

    if (data.error) {
      return res.status(200).json({ status: 'error', error: data.error });
    }

    res.status(200).json({
      status: 'completed',
      result: data.result,
      tokens: data.tokens,
      cost: data.cost,
    });
  } catch (error) {
    console.error('[AddonRelay] Error getting command result:', error);
    res.status(200).json({ status: 'pending', result: null });
  }
});

module.exports = {
  addonHeartbeat,
  getAddonStatus,
  queueCommand,
  getPendingCommands,
  postCommandResult,
  getCommandResult,
};
