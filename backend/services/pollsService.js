/**
 * pollsService.js — persistence for the public Polls feature.
 *
 * Polls live in the shared "Simple" DynamoDB table using the same convention
 * as memoryService / petsService: partition key `id` (random hex) + sort key
 * `createdAt` (ISO string). Everything is encoded in the `text` column:
 *
 *   |Poll:|<JSON payload>
 *
 * Payload shape:
 *   {
 *     question: string,
 *     options:  string[],     // 2–8 answer choices
 *     votes:    number[],     // parallel to options
 *     durationMinutes: number,
 *     creator:  string,       // display name, defaults to "Anonymous"
 *     closed:   boolean,      // manually closed by owner
 *     closedAt: string|null,
 *     ownerKey: string,       // lets the creator close/delete (never exposed)
 *     voterIds: string[],     // one-vote-per-device dedupe
 *   }
 *
 * Polls are public (no sign-in required) — matching the original PollBox
 * feature's "No sign in required" behavior. A poll is considered "closed"
 * when it was manually closed OR its duration has elapsed.
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  ScanCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
} = require('@aws-sdk/lib-dynamodb');
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
const POLL_MARKER = '|Poll:';

// ── Validation limits (shared with the controller) ──────────────────────────
const LIMITS = {
  questionMax: 200,
  optionMax: 80,
  minOptions: 2,
  maxOptions: 8,
  durationMin: 1,       // minutes
  durationMax: 10080,   // 7 days
  creatorMax: 32,
  voterIdMax: 64,
  listMax: 100,         // most recent polls returned by listPolls()
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildPollText(payload) {
  return `${POLL_MARKER}${JSON.stringify(payload)}`;
}

function parsePollText(text) {
  if (typeof text !== 'string' || !text.startsWith(POLL_MARKER)) return null;
  try {
    return JSON.parse(text.slice(POLL_MARKER.length));
  } catch {
    return null;
  }
}

function expiresAtMs(payload, createdAt) {
  return new Date(createdAt).getTime() + (Number(payload.durationMinutes) || 0) * 60000;
}

/**
 * Convert a raw DynamoDB row into the public shape the frontend consumes.
 * Strips `ownerKey` and `voterIds` — those never leave the server.
 */
function toPublicPoll(row) {
  const payload = parsePollText(row.text);
  if (!payload) return null;

  const expiresAt = expiresAtMs(payload, row.createdAt);
  const closed = !!payload.closed || Date.now() >= expiresAt;
  const options = (payload.options || []).map((text, i) => ({
    text,
    votes: Number(payload.votes?.[i]) || 0,
  }));
  const totalVotes = options.reduce((sum, o) => sum + o.votes, 0);

  return {
    _id: row.id,
    question: payload.question,
    options,
    totalVotes,
    durationMinutes: payload.durationMinutes,
    creator: payload.creator || 'Anonymous',
    closed,
    closedAt: payload.closedAt || null,
    createdAt: row.createdAt,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

/** Fetch a single poll row by partition key, or null if not a valid poll. */
async function findPollRow(pollId) {
  const result = await dynamodb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: '#id = :id',
    ExpressionAttributeNames: { '#id': 'id' },
    ExpressionAttributeValues: { ':id': pollId },
  }));
  const row = (result.Items && result.Items[0]) || null;
  if (!row || !parsePollText(row.text)) return null;
  return row;
}

// ── Public API ───────────────────────────────────────────────────────────────

async function listPolls() {
  const params = {
    TableName: TABLE,
    FilterExpression: 'contains(#text, :marker)',
    ExpressionAttributeNames: { '#text': 'text' },
    ExpressionAttributeValues: { ':marker': POLL_MARKER },
  };

  // Paginate — a single Scan reads at most 1MB and applies the filter after,
  // so without this polls beyond the first 1MB scanned would silently drop.
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

  const polls = rows.map(toPublicPoll).filter(Boolean);
  polls.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return polls.slice(0, LIMITS.listMax);
}

async function createPoll({ question, options, durationMinutes, creator }) {
  const id = crypto.randomBytes(16).toString('hex');
  const ownerKey = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString();

  const payload = {
    question,
    options,
    votes: options.map(() => 0),
    durationMinutes,
    creator: creator || 'Anonymous',
    closed: false,
    closedAt: null,
    ownerKey,
    voterIds: [],
  };

  await dynamodb.send(new PutCommand({
    TableName: TABLE,
    Item: { id, text: buildPollText(payload), createdAt: now, updatedAt: now },
  }));

  const poll = toPublicPoll({ id, text: buildPollText(payload), createdAt: now, updatedAt: now });
  return { ...poll, ownerKey };
}

async function votePoll(pollId, optionIndex, voterId) {
  const row = await findPollRow(pollId);
  if (!row) throw Object.assign(new Error('Poll not found'), { statusCode: 404 });

  const payload = parsePollText(row.text);
  if (payload.closed || Date.now() >= expiresAtMs(payload, row.createdAt)) {
    throw Object.assign(new Error('This poll is closed'), { statusCode: 409 });
  }
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= payload.options.length) {
    throw Object.assign(new Error('Invalid option'), { statusCode: 400 });
  }
  if ((payload.voterIds || []).includes(voterId)) {
    throw Object.assign(new Error('You have already voted in this poll'), { statusCode: 409 });
  }

  payload.votes[optionIndex] = (Number(payload.votes[optionIndex]) || 0) + 1;
  payload.voterIds = payload.voterIds || [];
  payload.voterIds.push(voterId);

  const now = new Date().toISOString();
  await dynamodb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { id: row.id, createdAt: row.createdAt },
    UpdateExpression: 'SET #text = :text, updatedAt = :now',
    ExpressionAttributeNames: { '#text': 'text' },
    ExpressionAttributeValues: { ':text': buildPollText(payload), ':now': now },
  }));

  return toPublicPoll({ id: row.id, text: buildPollText(payload), createdAt: row.createdAt, updatedAt: now });
}

async function closePoll(pollId, ownerKey) {
  const row = await findPollRow(pollId);
  if (!row) throw Object.assign(new Error('Poll not found'), { statusCode: 404 });

  const payload = parsePollText(row.text);
  if (!ownerKey || payload.ownerKey !== ownerKey) {
    throw Object.assign(new Error('Not authorized to close this poll'), { statusCode: 403 });
  }
  if (payload.closed) {
    return toPublicPoll({ ...row, text: buildPollText(payload) });
  }

  payload.closed = true;
  payload.closedAt = new Date().toISOString();

  const now = new Date().toISOString();
  await dynamodb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { id: row.id, createdAt: row.createdAt },
    UpdateExpression: 'SET #text = :text, updatedAt = :now',
    ExpressionAttributeNames: { '#text': 'text' },
    ExpressionAttributeValues: { ':text': buildPollText(payload), ':now': now },
  }));

  return toPublicPoll({ id: row.id, text: buildPollText(payload), createdAt: row.createdAt, updatedAt: now });
}

async function deletePoll(pollId, ownerKey) {
  const row = await findPollRow(pollId);
  if (!row) throw Object.assign(new Error('Poll not found'), { statusCode: 404 });

  const payload = parsePollText(row.text);
  if (!ownerKey || payload.ownerKey !== ownerKey) {
    throw Object.assign(new Error('Not authorized to delete this poll'), { statusCode: 403 });
  }

  await dynamodb.send(new DeleteCommand({
    TableName: TABLE,
    Key: { id: row.id, createdAt: row.createdAt },
  }));

  return { deleted: true };
}

module.exports = {
  LIMITS,
  listPolls,
  createPoll,
  votePoll,
  closePoll,
  deletePoll,
  // Exported for unit tests (pure helpers, no DynamoDB)
  buildPollText,
  parsePollText,
  toPublicPoll,
};
