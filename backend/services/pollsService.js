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
const { logger } = require('../utils/logger');

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
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// ── Validation limits (shared with the controller) ──────────────────────────
const LIMITS = {
  questionMax: 200,
  optionMax: 80,
  minOptions: 2,
  maxOptions: 8,
  durationMin: 1,       // minutes
  durationMax: 525600,  // 365 days
  creatorMax: 32,
  voterIdMax: 64,
  listMax: 100,         // most recent polls returned by listPolls()
};

// Rotating display names for the weekly AI poll. The week index picks one, so
// the "author" changes week to week without any extra storage.
const AI_CREATORS = [
  'Weekly AI',
  'The Oracle',
  'GPT-4am Thoughts',
  'The Poll Goblin',
  'Caffeinated Model',
];

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

/** Monday 00:00 UTC for the given date (or now). */
function startOfWeek(date = new Date()) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay(); // 0 = Sunday … 6 = Saturday
  const mondayOffset = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - mondayOffset);
  return d;
}

function weekStartIso(date = new Date()) {
  return startOfWeek(date).toISOString();
}

/** "Aug 31 – Sep 6" for the ISO Monday that opens a week. */
function weekLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const monday = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const sunday = new Date(d.getTime() + 6 * 24 * 60 * 60 * 1000)
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${monday} – ${sunday}`;
}

function weeklyAiCreator(weekStart) {
  const index = Math.floor(new Date(weekStart).getTime() / WEEK_MS);
  return AI_CREATORS[((index % AI_CREATORS.length) + AI_CREATORS.length) % AI_CREATORS.length];
}

/** Parse + validate the JSON an LLM returns for a weekly poll. */
function parseAiPollJson(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  let cleaned = text.trim();

  // Strip markdown code fences if the model wrapped its JSON.
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) cleaned = fence[1].trim();

  // Some models add prose around the JSON — pull out just the outer object.
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  cleaned = cleaned.slice(start, end + 1);

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }

  const question = typeof parsed.question === 'string' ? parsed.question.trim() : '';
  const options = Array.isArray(parsed.options)
    ? [...new Set(parsed.options
        .map((o) => (typeof o === 'string' ? o.trim() : ''))
        .filter(Boolean))]
    : [];

  if (!question || question.length > LIMITS.questionMax) return null;
  if (options.length < LIMITS.minOptions || options.length > 4) return null;
  if (options.some((o) => o.length > LIMITS.optionMax)) return null;
  return { question, options };
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
    kind: payload.kind || null,
    weekStart: payload.weekStart || null,
    isAi: payload.kind === 'weekly',
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

/**
 * Scan every row whose `text` column carries the poll marker. A single Scan
 * reads at most 1MB and applies the filter after, so paginate with
 * LastEvaluatedKey to avoid silently dropping older polls.
 */
async function scanAllPollRows() {
  const rows = [];
  let lastEvaluatedKey;
  do {
    const result = await dynamodb.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'contains(#text, :marker)',
      ExpressionAttributeNames: { '#text': 'text' },
      ExpressionAttributeValues: { ':marker': POLL_MARKER },
      ...(lastEvaluatedKey ? { ExclusiveStartKey: lastEvaluatedKey } : {}),
    }));
    if (result.Items) rows.push(...result.Items);
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);
  return rows;
}

async function listPolls() {
  const rows = await scanAllPollRows();
  const polls = rows.map(toPublicPoll).filter(Boolean);
  polls.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return polls.slice(0, LIMITS.listMax);
}

// ── Weekly AI poll ───────────────────────────────────────────────────────────

/** AI-created polls only (`kind === 'weekly'`), newest first. */
async function listWeeklyPolls() {
  const rows = await scanAllPollRows();
  const polls = rows
    .map((row) => {
      const payload = parsePollText(row.text);
      if (!payload || payload.kind !== 'weekly') return null;
      return toPublicPoll(row);
    })
    .filter(Boolean);
  polls.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return polls;
}

/**
 * Ask Bedrock (Claude Haiku 4.5) for this week's poll, then parse + validate
 * its JSON response into `{ question, options }`.
 */
async function generateWeeklyAiQuestion() {
  const { createBedrockCompletion } = require('./bedrockService');
  const response = await createBedrockCompletion([
    {
      role: 'system',
      content: [
        'You are the house comedian for a personal portfolio site.',
        'Every week you write ONE poll question for the site visitors.',
        'The tone is edgy, funny, and a little unhinged — but never hateful,',
        'bigoted, sexual, or genuinely mean. Think late-night comedy, not shock',
        'content. Nothing that would get a normal person fired from a normal job.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        'Write this week\'s poll.',
        'Return ONLY valid JSON, no markdown, no commentary, shaped exactly like:',
        '{"question": "...", "options": ["...", "...", "..."]}',
        'Rules: 2 to 4 options. Question under 200 characters. Each option under 80 characters.',
        'Make it a question you would actually argue about with friends. Avoid overused internet poll cliches.',
      ].join(' '),
    },
  ], { temperature: 0.95, maxTokens: 300 });

  const text = response?.choices?.[0]?.message?.content;
  return parseAiPollJson(typeof text === 'string' ? text : '');
}

/**
 * Persist a newly generated weekly poll, anchored to the week start so it
 * expires exactly at the start of next week.
 */
async function putWeeklyAiPoll({ question, options, weekStart }) {
  const id = crypto.randomBytes(16).toString('hex');
  const ownerKey = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString();

  const payload = {
    question,
    options,
    votes: options.map(() => 0),
    durationMinutes: 7 * 24 * 60, // 10080 — one week
    creator: weeklyAiCreator(weekStart),
    closed: false,
    closedAt: null,
    ownerKey,
    voterIds: [],
    kind: 'weekly',
    weekStart,
  };

  await dynamodb.send(new PutCommand({
    TableName: TABLE,
    Item: { id, text: buildPollText(payload), createdAt: weekStart, updatedAt: now },
  }));

  return toPublicPoll({ id, text: buildPollText(payload), createdAt: weekStart, updatedAt: now });
}

let weeklyAiInFlight = null;

/**
 * Lazily make sure this week's AI poll exists — and only this week's. Called
 * from GET /polls, so nothing is generated while nobody visits the page.
 * Concurrent requests within this process share one in-flight generation.
 *
 * Returns:
 *   {
 *     weekly:           public poll for the current week (or null if LLM down)
 *     generated:        true when this call created `weekly`
 *     lastWeekResults:  public poll for last week, but only when it got >1 vote
 *     lastWeekHadPoll:  true when last week's AI poll existed at all
 *     lastWeekVotes:    total votes last week's poll received (0 if none)
 *   }
 */
async function ensureWeeklyAiPoll() {
  if (weeklyAiInFlight) return weeklyAiInFlight;

  weeklyAiInFlight = (async () => {
    try {
      const currentWeek = weekStartIso();
      const weeklyPolls = await listWeeklyPolls();

      let weekly = weeklyPolls.find((p) => p.weekStart === currentWeek) || null;
      let generated = false;

      if (!weekly) {
        const idea = await generateWeeklyAiQuestion().catch((err) => {
          logger.warn('[pollsService] weekly AI generation failed:', err.message);
          return null;
        });
        if (idea) {
          weekly = await putWeeklyAiPoll({
            question: idea.question,
            options: idea.options,
            weekStart: currentWeek,
          });
          generated = true;
        }
      }

      const lastWeekStart = new Date(new Date(currentWeek).getTime() - WEEK_MS).toISOString();
      const last = weeklyPolls.find((p) => p.weekStart === lastWeekStart) || null;
      const lastWeekVotes = last ? last.totalVotes : 0;

      return {
        weekly,
        generated,
        weeklyLabel: weekly ? weekLabel(weekly.weekStart) : '',
        lastWeekResults: last && lastWeekVotes > 1 ? last : null,
        lastWeekHadPoll: !!last,
        lastWeekVotes,
      };
    } finally {
      weeklyAiInFlight = null;
    }
  })();

  return weeklyAiInFlight;
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
  ensureWeeklyAiPoll,
  // Exported for unit tests (pure helpers, no DynamoDB)
  buildPollText,
  parsePollText,
  toPublicPoll,
  startOfWeek,
  weekStartIso,
  weekLabel,
  parseAiPollJson,
};
