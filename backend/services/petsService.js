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
  fox: { label: 'Fox Kit', emoji: '🦊' },
  panda: { label: 'Panda Cub', emoji: '🐼' },
  penguin: { label: 'Penguin Chick', emoji: '🐧' },
  hedgehog: { label: 'Hedgehog', emoji: '🦔' },
  turtle: { label: 'Turtle', emoji: '🐢' },
  koala: { label: 'Koala Joey', emoji: '🐨' },
};

const MAX_PETS = 4;
const MAX_REVIVES = 3;
const MAX_CARE_LOG = 30;

// ── Simulation tuning ────────────────────────────────────────────────────────
// Points lost per hour of neglect (0–100 scale). Tuned so a pet needs a few
// interactions per day but won't instantly starve if the user misses a meal.
const DECAY = {
  hunger: 4,
  happiness: 5,
  energy: 4,
  cleanliness: 3,
  bond: 0.5, // friendship fades much more slowly than physical needs
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

// In-game treat currency.
const TREATS_PER_CARE = 2; // earned per ordinary care action
const TREAT_COST = 5; // a snack costs this many treats
const TRAIN_COST = 5; // a training session costs this many treats
const STARTING_TREATS = 20;

const XP_PER_CARE = 10;
const XP_PER_LEVEL = 50;

// Tricks the pet can learn through the `train` action.
const TRICKS = [
  { id: 'sit', label: 'Sit', emoji: '🪑' },
  { id: 'shake', label: 'Shake', emoji: '🤝' },
  { id: 'roll', label: 'Roll Over', emoji: '🌀' },
  { id: 'fetch', label: 'Fetch', emoji: '🎾' },
  { id: 'highfive', label: 'High Five', emoji: '✋' },
];

// Random encounters that can happen on a walk (base walk deltas applied first).
const WALK_EVENTS = [
  { id: 'treats', label: 'found treats on the path!', treats: 5, effects: { happiness: 8, cleanliness: -5 } },
  { id: 'friend', label: 'made a new friend at the park', effects: { happiness: 15, bond: 6 } },
  { id: 'mud', label: 'rolled in a mud puddle', effects: { happiness: 10, cleanliness: -20 } },
  { id: 'stick', label: 'fetched a stick', effects: { happiness: 12, energy: -8, bond: 4 } },
  { id: 'rain', label: 'got sprinkled on by rain', effects: { cleanliness: -8, energy: -6, happiness: 4 } },
  { id: 'ball', label: 'chased a ball until exhausted', effects: { happiness: 18, energy: -15 } },
];

// Daily challenge pool — 3 are rotated through deterministically each UTC day.
const DAILY_CHALLENGES = [
  { id: 'feed-2', label: 'Feed your pet 2 times', metric: 'feed', target: 2, reward: { treats: 10, xp: 25 } },
  { id: 'play-2', label: 'Play with your pet 2 times', metric: 'play', target: 2, reward: { treats: 10, xp: 25 } },
  { id: 'walk-1', label: 'Take your pet on a walk', metric: 'walk', target: 1, reward: { treats: 15, xp: 30 } },
  { id: 'groom-1', label: 'Give your pet a bath', metric: 'groom', target: 1, reward: { treats: 10, xp: 25 } },
  { id: 'train-2', label: 'Train your pet 2 times', metric: 'train', target: 2, reward: { treats: 20, xp: 40 } },
  { id: 'care-5', label: 'Do 5 actions (feed, play, walk, groom, or rest)', metric: 'care', target: 5, reward: { treats: 25, xp: 50 } },
];
const DAILY_CHALLENGE_COUNT = 3;

// ── Pure helpers (unit-tested) ───────────────────────────────────────────────

/** Clamp a stat to the valid 0–100 range. */
function clamp(value) {
  return Math.min(100, Math.max(0, Math.round(value * 10) / 10));
}

/** Apply a set of stat deltas to a stats object in place (0–100 clamped). */
function applyDeltas(stats, deltas) {
  for (const [stat, delta] of Object.entries(deltas)) {
    if (typeof delta !== 'number') continue; // skip non-numeric keys (labels, etc.)
    if (stats[stat] === undefined) stats[stat] = 0;
    stats[stat] = clamp(stats[stat] + delta);
  }
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
    bond: clamp((stats.bond ?? 60) - DECAY.bond * hours),
  };

  const trackedStats = [next.hunger, next.happiness, next.cleanliness];
  const isCritical = trackedStats.some((v) => v <= HEALTH.criticalStat);
  const isThriving = trackedStats.every((v) => v > HEALTH.thriveMin);

  if (isCritical) {
    next.health = clamp(next.health - HEALTH.decayPerHour * hours);
  } else if (isThriving) {
    next.health = clamp(next.health + HEALTH.regenPerHour * hours);
  }

  // Pets never pass away — health can sink to "critical", but never to zero.
  next.health = Math.max(1, next.health);

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

// ── Life stage (age) derivation ──────────────────────────────────────────────
function deriveStage(ageMs) {
  const hours = ageMs / 3600000;
  if (hours < 24) return { id: 'baby', label: 'Baby' };
  if (hours < 72) return { id: 'young', label: 'Young' };
  return { id: 'adult', label: 'Adult' };
}

// ── Daily challenges (deterministic rotation per UTC day) ────────────────────
function dayKey(now) {
  return new Date(now).toISOString().slice(0, 10);
}

function challengesForDay(now) {
  const day = Math.floor(now / 86400000);
  const start = day % DAILY_CHALLENGES.length;
  const out = [];
  for (let i = 0; i < DAILY_CHALLENGE_COUNT; i++) {
    out.push(DAILY_CHALLENGES[(start + i) % DAILY_CHALLENGES.length]);
  }
  return out;
}

const CARE_METRICS = ['feed', 'play', 'groom', 'rest', 'heal', 'walk', 'treat', 'train'];

function isTrainAction(action) {
  return typeof action === 'string' && action.startsWith('train:');
}

function countMetric(entries, metric) {
  if (metric === 'care') {
    return entries.filter((e) => CARE_METRICS.includes(e.action) || isTrainAction(e.action)).length;
  }
  if (metric === 'train') {
    return entries.filter((e) => isTrainAction(e.action)).length;
  }
  return entries.filter((e) => e.action === metric).length;
}

/**
 * Evaluate today's challenges against the pet's care log and award any newly
 * completed ones. Pure — returns the updated completion ledger + rewards.
 */
function evaluateChallenges(payload, now) {
  const day = dayKey(now);
  const defs = challengesForDay(now);
  const completed = { ...(payload.dailyChallenges || {}) };

  // A new UTC day resets the completion ledger.
  if (payload.challengeDay !== day) {
    for (const key of Object.keys(completed)) delete completed[key];
  }

  const log = payload.careLog || [];
  const todayEntries = log.filter((e) => dayKey(new Date(e.at)) === day);

  let treats = 0;
  let xp = 0;
  const newlyCompleted = [];

  for (const def of defs) {
    if (completed[def.id]) continue;
    if (countMetric(todayEntries, def.metric) >= def.target) {
      completed[def.id] = { completedAt: new Date(now).toISOString() };
      treats += def.reward.treats;
      xp += def.reward.xp;
      newlyCompleted.push(def.id);
    }
  }

  return { completed, day, newlyCompleted, treats, xp };
}

/** Build the client-facing challenge list for a pet payload. */
function challengeView(payload, now) {
  const day = dayKey(now);
  const defs = challengesForDay(now);
  const completed = payload.dailyChallenges || {};
  const log = payload.careLog || [];
  const todayEntries = log.filter((e) => dayKey(new Date(e.at)) === day);

  return defs.map((def) => {
    const isCompleted = payload.challengeDay === day && !!(completed[def.id] && completed[def.id].completedAt);
    const raw = countMetric(todayEntries, def.metric);
    return {
      id: def.id,
      label: def.label,
      target: def.target,
      progress: Math.min(def.target, raw),
      completed: isCompleted,
      reward: def.reward,
    };
  });
}

/** Pick a random walk encounter. */
function pickWalkEvent() {
  return WALK_EVENTS[Math.floor(Math.random() * WALK_EVENTS.length)];
}

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
  return { hunger: 70, happiness: 80, energy: 80, cleanliness: 85, health: 100, bond: 60 };
}

/** Build the API-view object for a pet row (decayed + derived fields). */
function toPetView(row, now = Date.now()) {
  const parsed = parsePetText(row.text || '');
  const payload = parsed?.payload || {};
  const stats = applyDecay(payload.stats || freshStats(), payload.lastTouchedAt || row.createdAt, now);

  // A pet only shows as "passed" if it was explicitly recorded as such —
  // health is floored at 1 in applyDecay so neglect can no longer kill a pet.
  const alive = !!(payload.alive !== false) && stats.health > 0;
  const mood = deriveMood(stats, alive);
  const levelInfo = computeLevel(payload.xp || 0);
  const speciesMeta = SPECIES[parsed?.species] || { label: 'Critter', emoji: '🐾' };

  const ageMs = now - new Date(row.createdAt).getTime();
  const stage = deriveStage(ageMs);
  const tricks = TRICKS.map((t) => {
    const progress = (payload.tricks && payload.tricks[t.id]) || 0;
    return { id: t.id, label: t.label, emoji: t.emoji, progress, mastered: progress >= 100 };
  });

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
    ageMs,
    stage,
    stageLabel: stage.label,
    level: levelInfo.level,
    xp: payload.xp || 0,
    xpIntoLevel: levelInfo.xpIntoLevel,
    xpForLevel: levelInfo.xpForLevel,
    reviveCount: payload.reviveCount || 0,
    careLog: payload.careLog || [],
    treats: payload.treats || 0,
    tricks,
    challenges: challengeView(payload, now),
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
    treats: STARTING_TREATS,
    tricks: {},
    dailyChallenges: {},
    challengeDay: null,
  };

  await dynamodb.send(
    new PutCommand({
      TableName: TABLE,
      Item: { id, text: buildPetText(userId, species, payload), createdAt: nowIso, updatedAt: nowIso },
    })
  );

  return { _id: id, name, species, speciesLabel: SPECIES[species].label, emoji: SPECIES[species].emoji };
}

async function performAction(userId, petId, action, params = {}) {
  const row = await findPetRow(petId);
  const parsed = requireOwnership(row, userId);

  if (action === 'revive') {
    return revivePet(userId, petId);
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const current = toPetView(row, now);

  if (!current.alive) {
    throw Object.assign(new Error('This pet has passed away and cannot be cared for'), { statusCode: 409 });
  }

  const base = parsed.payload;
  const stats = { ...current.stats };
  let treats = base.treats || 0;
  let walkEvent = null;
  let logAction = action;

  if (action === 'walk') {
    // Base walk deltas + a random encounter.
    const event = pickWalkEvent();
    applyDeltas(stats, { energy: -12, cleanliness: -4, happiness: +6, hunger: -6, bond: +4 });
    applyDeltas(stats, event.effects);
    treats += event.treats || 0;
    walkEvent = { id: event.id, label: event.label, treats: event.treats || 0 };
  } else if (action === 'treat') {
    if (treats < TREAT_COST) {
      throw Object.assign(new Error(`You need ${TREAT_COST} treats for a snack (you have ${treats})`), { statusCode: 409 });
    }
    treats -= TREAT_COST;
    applyDeltas(stats, { happiness: +15, bond: +6 });
  } else if (action === 'train') {
    const trick = TRICKS.find((t) => t.id === params.trickId);
    if (!trick) {
      throw Object.assign(new Error('Choose a trick to practice'), { statusCode: 400 });
    }
    if (treats < TRAIN_COST) {
      throw Object.assign(new Error(`You need ${TRAIN_COST} treats to train (you have ${treats})`), { statusCode: 409 });
    }
    treats -= TRAIN_COST;
    applyDeltas(stats, { happiness: +6, bond: +8 });
    const tricks = { ...(base.tricks || {}) };
    const gain = 15 + Math.floor(Math.random() * 8); // 15–22 progress per session
    tricks[trick.id] = Math.min(100, (tricks[trick.id] || 0) + gain);
    base.tricks = tricks;
    logAction = `train:${trick.id}`;
  } else {
    const deltas = ACTIONS[action];
    if (!deltas) {
      throw Object.assign(new Error(`Unknown action: ${action}`), { statusCode: 400 });
    }
    applyDeltas(stats, deltas);
    treats += TREATS_PER_CARE;
    stats.bond = clamp(stats.bond + 3);
    // Any ordinary care action is soothing (except the vet, which heals a lot).
    if (action !== 'heal') stats.health = clamp(stats.health + 2);
  }

  const careLog = [{ action: logAction, at: nowIso }, ...(base.careLog || [])].slice(0, MAX_CARE_LOG);

  // Award any newly completed daily challenges based on the updated log.
  const challengeState = evaluateChallenges({ ...base, careLog }, now);
  treats += challengeState.treats;

  const xp = (base.xp || 0) + XP_PER_CARE + challengeState.xp;

  const payload = {
    ...base,
    stats,
    lastTouchedAt: nowIso,
    alive: true,
    xp,
    treats,
    careLog,
    dailyChallenges: challengeState.completed,
    challengeDay: challengeState.day,
  };

  await putPetRow(petId, row, parsed, payload, nowIso);
  const view = toPetView({ ...row, text: buildPetText(parsed.userId, parsed.species, payload) }, now);
  if (walkEvent) view.walkEvent = walkEvent;
  if (challengeState.newlyCompleted.length) view.newlyCompleted = challengeState.newlyCompleted;
  return view;
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
  TRICKS,
  WALK_EVENTS,
  DAILY_CHALLENGES,
  TREAT_COST,
  TRAIN_COST,
  STARTING_TREATS,
  XP_PER_CARE,
  XP_PER_LEVEL,
  MOOD_META,
  // Pure helpers for tests
  clamp,
  applyDeltas,
  applyDecay,
  deriveMood,
  computeLevel,
  deriveStage,
  dayKey,
  challengesForDay,
  countMetric,
  evaluateChallenges,
  challengeView,
  pickWalkEvent,
  // Service API
  listPets,
  getPet,
  adoptPet,
  performAction,
  revivePet,
  releasePet,
};
