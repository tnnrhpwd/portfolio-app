/**
 * memoryService.js — CRUD for user memory items (Goals, Plans, Actions).
 *
 * Each item is stored as a DynamoDB row in the "Simple" table:
 *   id: crypto hex
 *   text: "Creator:<userId>|Memory:<type>|<json payload>"
 *   createdAt / updatedAt: ISO strings
 *
 * Supported types: goal, plan, action
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const crypto = require('crypto');

const client = new DynamoDBClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const dynamodb = DynamoDBDocumentClient.from(client);

const TABLE = 'Simple';
const MEMORY_PREFIX = '|Memory:';

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildMemoryText(userId, type, payload) {
  return `Creator:${userId}${MEMORY_PREFIX}${type}|${JSON.stringify(payload)}`;
}

function parseMemoryText(text) {
  // Creator:<id>|Memory:<type>|<json>
  const creatorMatch = text.match(/^Creator:([^|]+)/);
  const typeMatch = text.match(/\|Memory:([^|]+)\|/);
  if (!creatorMatch || !typeMatch) return null;

  const userId = creatorMatch[1];
  const type = typeMatch[1];
  const jsonStart = text.indexOf(`|Memory:${type}|`) + `|Memory:${type}|`.length;
  let payload;
  try {
    payload = JSON.parse(text.substring(jsonStart));
  } catch {
    payload = { text: text.substring(jsonStart) };
  }
  return { userId, type, payload };
}

// ── Get all memory items for a user (optionally filter by type) ─────────────

async function getMemoryItems(userId, type = null) {
  const filterParts = ['contains(#text, :creator)', 'contains(#text, :memPrefix)'];
  const exprValues = {
    ':creator': `Creator:${userId}`,
    ':memPrefix': MEMORY_PREFIX,
  };

  if (type) {
    filterParts.push('contains(#text, :memType)');
    exprValues[':memType'] = `${MEMORY_PREFIX}${type}|`;
  }

  const params = {
    TableName: TABLE,
    FilterExpression: filterParts.join(' AND '),
    ExpressionAttributeNames: { '#text': 'text' },
    ExpressionAttributeValues: exprValues,
    // Strongly-consistent read so a goal saved moments ago is visible on the
    // next /plans load (and to the dedupe check) instead of lagging behind.
    ConsistentRead: true,
  };

  // DynamoDB Scan returns at most 1MB of data per call, and the filter is
  // applied AFTER that read. Without pagination, memory items beyond the first
  // 1MB scanned are silently dropped — which made /plans, get_my_goals and the
  // save_goals dedupe all return incomplete (and non-deterministic) results on
  // the shared "Simple" table. Loop over LastEvaluatedKey to read everything.
  const rows = [];
  let lastEvaluatedKey;
  do {
    const result = await dynamodb.send(new ScanCommand({
      ...params,
      ...(lastEvaluatedKey ? { ExclusiveStartKey: lastEvaluatedKey } : {}),
    }));
    if (result.Items) rows.push(...result.Items);
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  const items = rows.map(item => {
    const parsed = parseMemoryText(item.text || '');
    return {
      _id: item.id,
      type: parsed?.type || 'unknown',
      data: parsed?.payload || {},
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  });

  // Sort newest first
  items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return items;
}

// ── Get a single memory item (verifies ownership) ───────────────────────────

/**
 * Fetch the raw DynamoDB row for a memory item by its partition key (id).
 *
 * The "Simple" table has a COMPOSITE primary key: partition key `id` (String)
 * + sort key `createdAt` (String). Memory items are created with a random hex
 * `id` and a single real `createdAt` timestamp, so a Query on `id` returns
 * exactly one row (or none). We use Query — not Get — because Get requires the
 * full composite key and the caller only ever has the `id`.
 */
async function findMemoryRow(itemId) {
  const result = await dynamodb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: '#id = :id',
    ExpressionAttributeNames: { '#id': 'id' },
    ExpressionAttributeValues: { ':id': itemId },
  }));
  return (result.Items && result.Items[0]) || null;
}

function requireOwnership(Item, userId, action) {
  if (!Item) {
    throw Object.assign(new Error('Memory item not found'), { statusCode: 404 });
  }
  const parsed = parseMemoryText(Item.text || '');
  if (!parsed || parsed.userId !== userId) {
    throw Object.assign(new Error(`Not authorized to ${action} this item`), { statusCode: 403 });
  }
  return parsed;
}

async function getMemoryItem(userId, itemId) {
  const Item = await findMemoryRow(itemId);
  const parsed = requireOwnership(Item, userId, 'access');

  return {
    _id: itemId,
    type: parsed.type,
    data: parsed.payload,
    createdAt: Item.createdAt,
    updatedAt: Item.updatedAt,
  };
}

// ── Create a new memory item ────────────────────────────────────────────────

async function createMemoryItem(userId, type, payload) {
  const validTypes = ['goal', 'plan', 'action', 'note'];
  if (!validTypes.includes(type)) {
    throw Object.assign(new Error(`Invalid memory type: ${type}`), { statusCode: 400 });
  }

  // Add default status for goals & plans
  if ((type === 'goal' || type === 'plan') && !payload.status) {
    payload.status = 'active';
  }

  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString();
  const text = buildMemoryText(userId, type, payload);

  await dynamodb.send(new PutCommand({
    TableName: TABLE,
    Item: { id, text, createdAt: now, updatedAt: now },
  }));

  return { _id: id, type, data: payload, createdAt: now, updatedAt: now };
}

// ── Update an existing memory item ─────────────────────────────────────────

async function updateMemoryItem(userId, itemId, updates) {
  // Fetch item first to verify ownership (and to learn its sort key).
  const Item = await findMemoryRow(itemId);
  const parsed = requireOwnership(Item, userId, 'update');

  // Merge updates into existing payload
  const newPayload = { ...parsed.payload, ...updates };
  const newText = buildMemoryText(userId, parsed.type, newPayload);
  const now = new Date().toISOString();

  await dynamodb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { id: itemId, createdAt: Item.createdAt },
    UpdateExpression: 'SET #text = :text, updatedAt = :now',
    ExpressionAttributeNames: { '#text': 'text' },
    ExpressionAttributeValues: { ':text': newText, ':now': now },
  }));

  return { _id: itemId, type: parsed.type, data: newPayload, createdAt: Item.createdAt, updatedAt: now };
}

// ── Delete a memory item ────────────────────────────────────────────────────

async function deleteMemoryItem(userId, itemId) {
  const Item = await findMemoryRow(itemId);
  requireOwnership(Item, userId, 'delete');

  await dynamodb.send(new DeleteCommand({
    TableName: TABLE,
    Key: { id: itemId, createdAt: Item.createdAt },
  }));

  return { deleted: true };
}

// ── Get goals summary for LLM injection ─────────────────────────────────────

async function getGoalsSummary(userId) {
  const goals = await getMemoryItems(userId, 'goal');
  const activeGoals = goals.filter(g => g.data.status === 'active');

  if (activeGoals.length === 0) return null;

  const summary = activeGoals.map((g, i) => {
    const parts = [`${i + 1}. ${g.data.title}`];
    if (g.data.description) parts.push(`   - ${g.data.description}`);
    if (g.data.deadline) parts.push(`   - Deadline: ${g.data.deadline}`);
    if (g.data.priority) parts.push(`   - Priority: ${g.data.priority}`);
    return parts.join('\n');
  }).join('\n');

  return `The user has set the following goals:\n${summary}`;
}

// ── Auto-log an action from /net chat ───────────────────────────────────────

async function logAction(userId, summary, source = 'net') {
  return createMemoryItem(userId, 'action', {
    title: summary.substring(0, 120),
    source,
    timestamp: new Date().toISOString(),
  });
}

module.exports = {
  getMemoryItems,
  getMemoryItem,
  createMemoryItem,
  updateMemoryItem,
  deleteMemoryItem,
  getGoalsSummary,
  logAction,
  parseMemoryText,
  buildMemoryText,
};
