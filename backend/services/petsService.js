/**
 * petsService.js — persistence + real-time simulation for the Pets feature.
 *
 * Pets live in the shared "Simple" DynamoDB table using the same storage
 * convention as memoryService: partition key `id` (random hex) + sort key
 * `createdAt` (ISO string). Ownership + payload are encoded in the `text`
 * column:
 *
 *   Creator:<userId>|Pet:<species>|<JSON payload>
 *
 * A pet's needs (hunger, happiness, energy, cleanliness) decay continuously in
 * real time, even while the user is away. We store the canonical stats as of
 * the last write (`lastTouchedAt`) and lazily compute the current, decayed
 * values on every read — the classic "last-write + elapsed-time" simulation
 * used by Tamagotchi-style games. Decay is deterministic given
 * (stats, lastTouchedAt, now), so the pure helpers below are unit-testable
 * without any network access.
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  ScanCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  DeleteCommand,
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
const PET_MARKER = '|Pet:';

// ── Species catalog ──────────────────────────────────────────────────────────
const SPECIES = {
  dog: { label: 'Puppy', emoji: '🐶' },
  cat: { label: 'Kitten', emoji: '🐱' },
  bunny: { label: 'Bunny', emoji: '🐰' },
  hamster: { label: 'Hamster', emoji: '🐹' },
  parrot: { label: 'Parrot', emoji: '🦜' },
  axolotl: { label: 'Axolotl', emoji: '🦎' },
};

const MAX_PETS = 3;
const MAX_REVIVES = 3;
const MAX_CARE_LOG = 20;

// ── Simulation tuning ────────────────────────────────────────────────────────
// Points lost per hour of neglect (0–100 scale). Tuned so a pet needs a few
// interactions per day but won't instantly starve if the user misses a meal.
const DECAY = {
  hunger: 6,
  happiness: 5,
  energy: 4,
  cleanliness: 3,
};

const HEALTH = {
  criticalStat: 0, // a stat at this value (or below) is "critical"
  decayPerHour: 10, // health lost per hour while any tracked stat is critical
  regenPerHour: 6, // health gained per hour while the pet is thriving
  thriveMin: 50, // every thriving stat must be strictly above this
};

// Care actions → stat deltas (clamped to 0–100 on apply).
const ACTIONS = {
  feed: { hunger: +30, cleanliness: -5 },
  play: { happiness: +25, energy: -15, hunger: -10 },
  groom: { cleanliness: +40 },
  rest: { energy: +50, hunger: -5 },
  heal: { health: +40 },
};

const XP_PER_CARE = 10;
const XP_PER_LEVEL = 50;

// ── Pure helpers (unit-tested) ───────────────────────────────────────────────

/** Clamp a stat to the valid 0–100 range. */
function clamp(value) {
  return Math.min(100, Math.max(0, Math.round(value * 10) / 10));
}

/**
 * Compute current (decayed) stats from canonical stats + last write time.
 * @param {Object} stats
 * @param {string|number|Date} lastTouchedAt
 * @param {number} now epoch ms
 */
function applyDecay(stats, lastTouchedAt, now = Date.now()) {
  const elapsedMs = Math.max(0, now - new Date(lastTouchedAt).getTime());
  const hours = elapsedMs / 3600000;

  const next = {
    hunger: clamp(stats.hunger - DECAY.hunger * hours),
    happiness: clamp(stats.happiness - DECAY.happiness * hours),
    energy: clamp(stats.energy - DECAY.energy * hours),
    cleanliness: clamp(stats.cleanliness - DECAY.cleanliness * hours),
    health: clamp(stats.health),
  };

  const trackedStats = [next.hunger, next.happiness, next.cleanliness];
  const isCritical = trackedStats.some((v) => v <= HEALTH.criticalStat);
  const isThriving = trackedStats.every((v) => v > HEALTH.thriveMin);

  if (isCritical) {
    next.health = clamp(next.health - HEALTH.decayPerHour * hours);
  } else if (isThriving) {
    next.health = clamp(next.health + HEALTH.regenPerHour * hours);
  }

  return next;
}

/**
 * Derive a single mood label from a pet's current stats.
 * Ordered from most severe to most pleasant.
 */
function deriveMood(stats, alive) {
  if (!alive) return 'passed';
  if (stats.health < 15) return 'critical';
  if (stats.health < 35) return 'sick';
  if (stats.hunger <= 0) return 'starving';
  if (stats.energy <= 0) return 'exhausted';
  if (stats.happiness <= 0) return 'lonely';
  if (stats.cleanliness <= 0) return 'dirty';
  if (stats.hunger < 30) return 'hungry';
  if (stats.happiness < 30) return 'sad';
  if (stats.cleanliness < 30) return 'messy';
  if (stats.energy < 30) return 'sleepy';
  if (stats.hunger >= 80 && stats.happiness >= 80 && stats.cleanliness >= 80 && stats.energy >= 80) return 'ecstatic';
  if (stats.hunger >= 60 && stats.happiness >= 60 && stats.cleanliness >= 60) return 'happy';
  return 'content';
}

/** Convert lifetime XP into a level + progress within that level. */
function computeLevel(xp) {
  const level = Math.floor(xp / XP_PER_LEVEL) + 1;
  const xpIntoLevel = xp % XP_PER_LEVEL;
  return { level, xpIntoLevel, xpForLevel: XP_PER_LEVEL };
}

/** Human-readable mood → label/emoji mapping used by the UI. */
const MOOD_META = {
  ecstatic: { label: 'Ecstatic', emoji: '🤩' },
  happy: { label: 'Happy', emoji: '😊' },
  content: { label: 'Content', emoji: '🙂' },
  sleepy: { label: 'Sleepy', emoji: '😴' },
  hungry: { label: 'Hungry', emoji: '😋' },
  sad: { label: 'Sad', emoji: '😢' },
  lonely: { label: 'Lonely', emoji: '🥺' },
  messy: { label: 'Messy', emoji: '😅' },
  dirty: { label: 'Dirty', emoji: '😰' },
  exhausted: { label: 'Exhausted', emoji: '😮‍💨' },
  starving: { label: 'Starving', emoji: '😫' },
  sick: { label: 'Sick', emoji: '🤒' },
  critical: { label: 'Critical', emoji: '🚨' },
  passed: { label: 'Passed away', emoji: '🌈' },
};

// ── Serialization helpers ────────────────────────────────────────────────────

function buildPetText(userId, species, payload) {
  return `Creator:${userId}${PET_MARKER}${species}|${JSON.stringify(payload)}`;
}

function parsePetText(text) {
  const creatorMatch = text.match(/^Creator:([^|]+)/);
  const speciesMatch = text.match(/\|Pet:([^|]+)\|/);
  if (!creatorMatch || !speciesMatch) return null;

  const userId = creatorMatch[1];
  const species = speciesMatch[1];
  const jsonStart = text.indexOf(`${PET_MARKER}${species}|`) + `${PET_MARKER}${species}|`.length;
  let payload;
  try {
    payload = JSON.parse(text.substring(jsonStart));
  } catch {
    payload = {};
  }
  return { userId, species, payload };
}

/** Default stats for a freshly adopted pet. */
function freshStats() {
  return { hunger: 70, happiness: 80, energy: 80, cleanliness: 85, health: 100 };
}

/** Build the API-view object for a pet row (decayed + derived fields). */
function toPetView(row, now = Date.now()) {
  const parsed = parsePetText(row.text || '');
  const payload = parsed?.payload || {};
  const stats = applyDecay(payload.stats || freshStats(), payload.lastTouchedAt || row.createdAt, now);

  // A living pet whose health has fully decayed has passed away.
  const alive = !!(payload.alive !== false) && stats.health > 0;
  const mood = deriveMood(stats, alive);
  const levelInfo = computeLevel(payload.xp || 0);
  const speciesMeta = SPECIES[parsed?.species] || { label: 'Critter', emoji: '🐾' };

  return {
    _id: row.id,
    name: payload.name || 'Unnamed',
    species: parsed?.species || 'unknown',
    speciesLabel: speciesMeta.label,
    emoji: speciesMeta.emoji,
    stats,
    mood,
    moodMeta: MOOD_META[mood],
    alive,
    bornAt: row.createdAt,
    ageMs: now - new Date(row.createdAt).getTime(),
    level: levelInfo.level,
    xp: payload.xp || 0,
    xpIntoLevel: levelInfo.xpIntoLevel,
    xpForLevel: levelInfo.xpForLevel,
    reviveCount: payload.reviveCount || 0,
    careLog: payload.careLog || [],
    lastTouchedAt: payload.lastTouchedAt || row.createdAt,
  };
}

// ── Row lookups ──────────────────────────────────────────────────────────────

async function findPetRow(petId) {
  const result = await dynamodb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: '#id = :id',
      ExpressionAttributeNames: { '#id': 'id' },
      ExpressionAttributeValues: { ':id': petId },
    })
  );
  return (result.Items && result.Items[0]) || null;
}

function requireOwnership(row, userId) {
  if (!row) {
    throw Object.assign(new Error('Pet not found'), { statusCode: 404 });
  }
  const parsed = parsePetText(row.text || '');
  if (!parsed || parsed.userId !== userId) {
    throw Object.assign(new Error('Not authorized to access this pet'), { statusCode: 403 });
  }
  return parsed;
}

/** Persist a decayed payload back to the row (used for lazy death recording). */
async function putPetRow(petId, row, parsed, payload, nowIso) {
  await dynamodb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { id: petId, createdAt: row.createdAt },
      UpdateExpression: 'SET #text = :text, updatedAt = :now',
      ExpressionAttributeNames: { '#text': 'text' },
      ExpressionAttributeValues: {
        ':text': buildPetText(parsed.userId, parsed.species, payload),
        ':now': nowIso,
      },
    })
  );
}

/**
 * If a living pet has decayed to 0 health, record its passing once so the
 * memorial (passedAt) is stable across requests.
 */
async function persistPassingIfNeeded(row, parsed, payload, view, now) {
  if (payload.alive !== false && !view.alive) {
    const nowIso = new Date(now).toISOString();
    const decayed = view.stats;
    await putPetRow(
      row.id,
      row,
      parsed,
      {
        ...payload,
        stats: decayed,
        alive: false,
        passedAt: nowIso,
        lastTouchedAt: nowIso,
      },
      nowIso
    );
  }
}

// ── Public service API ───────────────────────────────────────────────────────

async function listPets(userId) {
  const params = {
    TableName: TABLE,
    FilterExpression: 'contains(#text, :creator) AND contains(#text, :marker)',
    ExpressionAttributeNames: { '#text': 'text' },
    ExpressionAttributeValues: { ':creator': `Creator:${userId}`, ':marker': PET_MARKER },
  };

  // Scan in pages — the shared table can exceed DynamoDB's 1MB read limit.
  const rows = [];
  let lastEvaluatedKey;
  do {
    const result = await dynamodb.send(
      new ScanCommand({ ...params, ...(lastEvaluatedKey ? { ExclusiveStartKey: lastEvaluatedKey } : {}) })
    );
    if (result.Items) rows.push(...result.Items);
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  const now = Date.now();
  const pets = rows.map((row) => {
    const parsed = parsePetText(row.text || '');
    const view = toPetView(row, now);
    // Fire-and-forget: record a passing lazily (best effort, non-blocking).
    if (parsed && parsed.payload?.alive !== false && !view.alive) {
      persistPassingIfNeeded(row, parsed, parsed.payload, view, now).catch((err) =>
        logger.warn('[Pets] failed to persist passing', { petId: row.id, error: err.message })
      );
    }
    return view;
  });

  // Alive pets first, then passed; then newest first.
  pets.sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    return new Date(b.bornAt) - new Date(a.bornAt);
  });
  return pets;
}

async function getPet(userId, petId) {
  const row = await findPetRow(petId);
  const parsed = requireOwnership(row, userId);
  const now = Date.now();
  const view = toPetView(row, now);
  await persistPassingIfNeeded(row, parsed, parsed.payload, view, now);
  return view;
}

async function adoptPet(userId, { name, species }) {
  if (!SPECIES[species]) {
    throw Object.assign(new Error(`Unknown species: ${species}`), { statusCode: 400 });
  }

  const existing = await listPets(userId);
  const living = existing.filter((p) => p.alive);
  if (living.length >= MAX_PETS) {
    throw Object.assign(new Error(`You can only care for ${MAX_PETS} pets at a time`), { statusCode: 400 });
  }

  const id = crypto.randomBytes(16).toString('hex');
  const nowIso = new Date().toISOString();
  const payload = {
    name,
    species,
    stats: freshStats(),
    lastTouchedAt: nowIso,
    alive: true,
    level: 1,
    xp: 0,
    reviveCount: 0,
    careLog: [],
  };

  await dynamodb.send(
    new PutCommand({
      TableName: TABLE,
      Item: { id, text: buildPetText(userId, species, payload), createdAt: nowIso, updatedAt: nowIso },
    })
  );

  return { _id: id, name, species, speciesLabel: SPECIES[species].label, emoji: SPECIES[species].emoji };
}

async function performAction(userId, petId, action) {
  const row = await findPetRow(petId);
  const parsed = requireOwnership(row, userId);

  if (action === 'revive') {
    return revivePet(userId, petId);
  }

  const deltas = ACTIONS[action];
  if (!deltas) {
    throw Object.assign(new Error(`Unknown action: ${action}`), { statusCode: 400 });
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const current = toPetView(row, now);

  if (!current.alive) {
    throw Object.assign(new Error('This pet has passed away and cannot be cared for'), { statusCode: 409 });
  }

  const stats = { ...current.stats };
  for (const [stat, delta] of Object.entries(deltas)) {
    if (stats[stat] === undefined) stats[stat] = 0;
    stats[stat] = clamp(stats[stat] + delta);
  }
  // Any care action gives the pet a little health back (comforting presence).
  if (action === 'heal') stats.health = clamp(stats.health + deltas.health);
  else stats.health = clamp(stats.health + 2);

  const xp = (parsed.payload.xp || 0) + XP_PER_CARE;
  const careLog = [
    { action, at: nowIso },
    ...(parsed.payload.careLog || []),
  ].slice(0, MAX_CARE_LOG);

  const payload = {
    ...parsed.payload,
    stats,
    lastTouchedAt: nowIso,
    alive: true,
    xp,
    careLog,
  };

  await putPetRow(petId, row, parsed, payload, nowIso);
  return toPetView({ ...row, text: buildPetText(parsed.userId, parsed.species, payload) }, now);
}

async function revivePet(userId, petId) {
  const row = await findPetRow(petId);
  const parsed = requireOwnership(row, userId);

  if (parsed.payload.alive !== false) {
    throw Object.assign(new Error('This pet is still with you — no need to revive it'), { statusCode: 409 });
  }
  if ((parsed.payload.reviveCount || 0) >= MAX_REVIVES) {
    throw Object.assign(new Error(`This pet has used all ${MAX_REVIVES} of its lives`), { statusCode: 409 });
  }

  const nowIso = new Date().toISOString();
  const payload = {
    ...parsed.payload,
    stats: freshStats(),
    lastTouchedAt: nowIso,
    alive: true,
    reviveCount: (parsed.payload.reviveCount || 0) + 1,
  };

  await putPetRow(petId, row, parsed, payload, nowIso);
  return toPetView({ ...row, text: buildPetText(parsed.userId, parsed.species, payload) }, Date.now());
}

async function releasePet(userId, petId) {
  const row = await findPetRow(petId);
  requireOwnership(row, userId);

  await dynamodb.send(
    new DeleteCommand({
      TableName: TABLE,
      Key: { id: petId, createdAt: row.createdAt },
    })
  );
  return { deleted: true, petId };
}

module.exports = {
  SPECIES,
  MAX_PETS,
  MAX_REVIVES,
  ACTIONS,
  XP_PER_CARE,
  XP_PER_LEVEL,
  MOOD_META,
  // Pure helpers for tests
  clamp,
  applyDecay,
  deriveMood,
  computeLevel,
  // Service API
  listPets,
  getPet,
  adoptPet,
  performAction,
  revivePet,
  releasePet,
};
