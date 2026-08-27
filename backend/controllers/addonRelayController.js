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
const { logger } = require('../utils/logger');
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
// Devices are pruned from the registry after 7 days without a heartbeat
const DEVICE_REGISTRY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ─── Item id helpers ─────────────────────────────────────────────────────────
// Each addon install has a stable deviceId; heartbeats are stored per-device
// so multiple PCs on the same account show up independently. The registry item
// (`addon_devices_${userId}`) holds a small JSON map of deviceId → metadata so
// we can list devices without a DynamoDB scan/GSI.
const heartbeatItemId = (userId, deviceId) => `addon_heartbeat_${userId}_${deviceId}`;
const legacyHeartbeatItemId = (userId) => `addon_heartbeat_${userId}`;
const devicesRegistryId = (userId) => `addon_devices_${userId}`;
const queueIdFor = (userId) => `addon_queue_${userId}`;
const resultIdFor = (commandId) => `addon_result_${commandId}`;

/** Read the per-user device registry. Returns a plain object { deviceId: meta }. */
async function readDevicesRegistry(userId) {
  try {
    const { Item } = await dynamodb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { id: devicesRegistryId(userId), createdAt: CREATED_AT },
    }));
    if (Item?.text) {
      const parsed = JSON.parse(Item.text);
      return parsed && typeof parsed === 'object' ? parsed : {};
    }
  } catch { /* no registry yet */ }
  return {};
}

/** Persist the per-user device registry (pruned to devices seen recently). */
async function writeDevicesRegistry(userId, devices) {
  const now = Date.now();
  const pruned = {};
  for (const [id, meta] of Object.entries(devices || {})) {
    if (meta?.lastSeen && (now - meta.lastSeen) < DEVICE_REGISTRY_TTL_MS) {
      pruned[id] = meta;
    }
  }
  await dynamodb.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      id: devicesRegistryId(userId),
      createdAt: CREATED_AT,
      text: JSON.stringify(pruned),
      updatedAt: new Date().toISOString(),
    },
  }));
  return pruned;
}

/** Convert a device registry entry into the API-facing status shape. */
function deviceToStatus(device) {
  if (!device) return null;
  const lastSeen = device.lastSeen || null;
  return {
    deviceId: device.deviceId || null,
    hostname: device.hostname || null,
    version: device.version || null,
    platform: device.platform || null,
    lastSeen,
    firstSeen: device.firstSeen || null,
    online: !!lastSeen && (Date.now() - lastSeen) < HEARTBEAT_TTL_MS,
  };
}

/** Pick the most relevant device for the legacy single-device /status endpoint. */
function pickDefaultDevice(devices) {
  const list = Object.values(devices || {})
    .filter(d => d?.lastSeen)
    .sort((a, b) => b.lastSeen - a.lastSeen);
  if (list.length === 0) return null;
  // Prefer the most-recently-seen ONLINE device, else the most recent overall.
  return list.find(d => (Date.now() - d.lastSeen) < HEARTBEAT_TTL_MS) || list[0];
}

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

  const { version, hostname, deviceId: rawDeviceId, platform } = req.body;
  // Older addons don't send a deviceId — collapse them under a single key so
  // they keep working, but new installs always send a stable id.
  const deviceId = (rawDeviceId && String(rawDeviceId).trim()) || 'unknown-device';
  const now = new Date().toISOString();
  const lastSeen = Date.now();

  await dynamodb.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      id: heartbeatItemId(req.user.id, deviceId),
      createdAt: CREATED_AT,
      text: JSON.stringify({
        deviceId,
        lastSeen,
        version: version || null,
        hostname: hostname || null,
        platform: platform || null,
        updatedAt: now,
      }),
      updatedAt: now,
    },
  }));

  // Keep the per-user registry up to date so /addon/devices can list all
  // installs without scanning. Best-effort: a heartbeat must never fail
  // because the registry write raced or the item grew.
  try {
    const registry = await readDevicesRegistry(req.user.id);
    const prev = registry[deviceId] || {};
    registry[deviceId] = {
      deviceId,
      lastSeen,
      version: version || prev.version || null,
      hostname: hostname || prev.hostname || null,
      platform: platform || prev.platform || null,
      firstSeen: prev.firstSeen || lastSeen,
    };
    // Migration: addon builds older than the deviceId change heartbeated as
    // "unknown-device". Once the same PC re-registers under its real UUID
    // (after upgrading), drop the stale placeholder so it doesn't linger as a
    // second, offline copy of the same hostname.
    if (deviceId !== 'unknown-device' && hostname) {
      const legacy = registry['unknown-device'];
      if (legacy && legacy.hostname === hostname) {
        delete registry['unknown-device'];
      }
    }
    await writeDevicesRegistry(req.user.id, registry);
  } catch (err) {
    logger.warn('[AddonRelay] Registry update failed (heartbeat still recorded):', err.message);
  }

  res.status(200).json({ success: true, timestamp: now, deviceId });
});

// @desc    List all of the user's addon devices (cloud relay)
// @route   GET /api/data/addon/devices
// @access  Private
const getAddonDevices = asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401);
    throw new Error('User not found');
  }

  try {
    const registry = await readDevicesRegistry(req.user.id);
    const entries = Object.values(registry);
    // Hide the legacy "unknown-device" placeholder whenever a real device
    // with the same hostname exists (the same PC after upgrading past the
    // deviceId change). This cleans the list immediately, without waiting for
    // the next heartbeat's registry cleanup to run.
    const realHostnames = new Set(
      entries
        .filter(d => d.deviceId !== 'unknown-device' && d.hostname)
        .map(d => d.hostname)
    );
    const devices = entries
      .filter(d => d.deviceId !== 'unknown-device' || !(d.hostname && realHostnames.has(d.hostname)))
      .map(deviceToStatus)
      .filter(Boolean)
      .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
    return res.status(200).json({ devices });
  } catch (error) {
    logger.error('[AddonRelay] Error listing addon devices:', error);
    res.status(200).json({ devices: [] });
  }
});

// @desc    Check if user's addon is online
// @route   GET /api/data/addon/status
// @access  Private
const getAddonStatus = asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401);
    throw new Error('User not found');
  }

  try {
    const registry = await readDevicesRegistry(req.user.id);
    const device = pickDefaultDevice(registry);

    // Fall back to the legacy single heartbeat item (pre-deviceId addons).
    if (!device) {
      const { Item } = await dynamodb.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { id: legacyHeartbeatItemId(req.user.id), createdAt: CREATED_AT },
      }));
      if (Item?.text) {
        const heartbeat = JSON.parse(Item.text);
        const isOnline = (Date.now() - heartbeat.lastSeen) < HEARTBEAT_TTL_MS;
        return res.status(200).json({
          online: isOnline,
          lastSeen: heartbeat.lastSeen,
          version: heartbeat.version,
          hostname: heartbeat.hostname,
          deviceId: null,
        });
      }
      return res.status(200).json({ online: false });
    }

    res.status(200).json(deviceToStatus(device));
  } catch (error) {
    logger.error('[AddonRelay] Error checking addon status:', error);
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

  const { type, payload, deviceId: requestedDeviceId } = req.body;
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

  // Resolve the target device: explicit deviceId wins, else the most recently
  // seen device (preferring an online one) so a phone with no selection still
  // reaches the user's primary PC.
  let deviceId = requestedDeviceId ? String(requestedDeviceId).trim() : null;
  if (!deviceId) {
    try {
      const registry = await readDevicesRegistry(req.user.id);
      deviceId = pickDefaultDevice(registry)?.deviceId || null;
    } catch { deviceId = null; }
  }
  if (!deviceId) {
    res.status(409);
    throw new Error('No addon devices online. Start the desktop addon on at least one device first.');
  }

  const commandId = crypto.randomUUID();
  const now = Date.now();

  // Read existing queue
  const queueId = queueIdFor(req.user.id);
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
    deviceId,
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

  res.status(201).json({ commandId, deviceId, status: 'pending' });
});

// @desc    Addon polls for pending commands
// @route   GET /api/data/addon/pending
// @access  Private
const getPendingCommands = asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401);
    throw new Error('User not found');
  }

  const { deviceId } = req.query;
  const queueId = queueIdFor(req.user.id);
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
    // Filter to only pending, non-expired commands. When the addon identifies
    // itself with `?deviceId=`, only return commands addressed to it (this is
    // what lets multiple PCs on one account each pick up their own commands).
    const pending = commands.filter(c =>
      c.status === 'pending' &&
      (now - c.createdAt) < COMMAND_TTL_MS &&
      (!deviceId || c.deviceId === deviceId)
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
    logger.error('[AddonRelay] Error getting pending commands:', error);
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
  const resultId = resultIdFor(commandId);

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
  const queueId = queueIdFor(req.user.id);
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
  const resultId = resultIdFor(commandId);

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
    logger.error('[AddonRelay] Error getting command result:', error);
    res.status(200).json({ status: 'pending', result: null });
  }
});

module.exports = {
  addonHeartbeat,
  getAddonStatus,
  getAddonDevices,
  queueCommand,
  getPendingCommands,
  postCommandResult,
  getCommandResult,
};
