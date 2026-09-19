/**
 * stepJournal.js — one record per step, for the /net harness.
 *
 * The questions this answers are asked AFTER a turn, not during it: *what did it
 * do? where did it stop? what did that cost?* Today the only trace is a
 * one-line `progress` label that the client overwrites, and a `tools` event that
 * arrives after the fact with no ordering, duration or failure information.
 *
 * Why this is NOT `routingTelemetry`. Telemetry is bounded, low-cardinality and
 * deliberately never writes per request to DynamoDB (see AUTOMATION_SECURITY.md
 * → *Eighth audit pass*). A turn record is the opposite: high-cardinality,
 * per-turn, and it must persist. Two different jobs.
 *
 * Two rules that shape the implementation:
 *
 *   1. **One write per turn, not per step.** A maxed turn is up to 18 model
 *      calls and dozens of steps; a write per step would be dozens of DynamoDB
 *      puts carrying no extra information. Steps accumulate in memory and the
 *      whole run is saved once, in `finishRun`.
 *   2. **A journal must never break a turn.** Every store call is wrapped: a
 *      DynamoDB failure degrades to "no record", never to a failed reply.
 *
 * Redaction follows the addon's rule (`server/automation/event-detail.js`): *an
 * event is a report, the action log is the record.* No step preview may carry
 * PII or a large blob, and for tools whose arguments ARE the user's private text
 * the values are withheld entirely (keys only) rather than trimmed.
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { logger } = require('../../utils/logger');
const { toolPlane, describeToolActivity } = require('../toolProgress.js');
const { parseToolArguments } = require('./toolLoop.js');
const { isReaskableCause } = require('./refusalCause.js');

const TABLE_NAME = 'Simple';
const RUN_KEY_PREFIX = 'csimple_runs_';
/** Same sentinel the memory/personality/behavior rows use for a fixed-key row. */
const FIXED_CREATED_AT = '2000-01-01T00:00:00.000Z';

/** Bounds. A run is a summary, not a transcript. */
const MAX_STEPS = 40;             // steps kept per run; the rest are counted, not stored
const MAX_RUNS = 10;              // runs kept per user (read-modify-write ring)
const MAX_PREVIEW_CHARS = 120;    // per leaf value
const MAX_ARG_STRING_CHARS = 2048; // longer than this: store the length, not the string

/** The harness's own instructional tail on a failed result (see toolOutcome.js). */
const HARNESS_NOTE_RE = /\n\nHARNESS: [\s\S]*$/;

/**
 * Tools whose ARGUMENTS are the user's own private text.
 *
 * For these the journal stores the argument NAMES and nothing else — the same
 * choice `event-detail.js` makes for PII tools on the addon side ("absent, not
 * redacted"). A note body, a support message, a goal title or a memory file is
 * the user's private writing; it has no business being duplicated into a
 * transcript that a later screen renders.
 *
 * Repo/cloud-tool arguments that are *code* are kept (clipped), because that is
 * exactly what makes a step list useful.
 */
const PRIVATE_ARG_TOOLS = new Set([
  'save_note',
  'submit_support_ticket',
  'save_goal',
  'save_goals',
  'log_action',
  'update_memory',
  'delete_memory',
  'update_personality',
  'update_behavior',
]);

/** Clip one argument value to something safe to show and cheap to store. */
function clipValue(value) {
  if (value === null || value === undefined) return value;
  const type = typeof value;
  if (type === 'number' || type === 'boolean') return value;
  if (Array.isArray(value)) return `[${value.length} item(s)]`;
  if (type === 'object') {
    // One level of structure is all a preview needs; anything deeper becomes a
    // bounded string rather than an unbounded object we would have to walk.
    const json = JSON.stringify(value);
    return json.length > MAX_PREVIEW_CHARS ? `[object, ${json.length} chars]` : json;
  }
  const str = String(value);
  if (str.startsWith('data:')) return `[data-url, ${str.length} chars]`;
  if (str.length > MAX_ARG_STRING_CHARS) return `[string, ${str.length} chars]`;
  return str.length > MAX_PREVIEW_CHARS ? `${str.slice(0, MAX_PREVIEW_CHARS)}…` : str;
}

/**
 * A step's argument preview. Pure, so the redaction rules are testable without
 * a database, a turn, or a model.
 *
 * @returns {{preview: object|null, redacted: boolean, keys: string[]}}
 *   `redacted: true` means the arguments exist but are private — the UI shows
 *   that a private argument was passed, never what it was. `keys` names the
 *   withheld arguments, so it is empty whenever `redacted` is false (there is
 *   nothing to name, and the record should not carry noise).
 */
function describeStepArgs(tool, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { preview: null, redacted: false, keys: [] };
  }
  const keys = Object.keys(args);
  if (!keys.length) return { preview: {}, redacted: false, keys: [] };
  if (PRIVATE_ARG_TOOLS.has(tool)) return { preview: null, redacted: true, keys };

  const preview = {};
  for (const key of keys.slice(0, 20)) preview[key] = clipValue(args[key]);
  return { preview, redacted: false, keys: [] };
}

// ── In-memory run (written to the store once, in finishRun) ────────────────

let runSeq = 0;

/**
 * Begin a turn's journal.
 * @returns {object} the run handle passed to startStep/completeStep/finishRun
 */
function createRun({ userId, provider, model, message = '', startedAt = Date.now() } = {}) {
  runSeq += 1;
  return {
    id: `run_${startedAt}_${runSeq}`,
    userId: userId || null,
    provider: provider || null,
    model: model || null,
    // The prompt itself is the user's text; only its length is journalled.
    messageChars: String(message || '').length,
    startedAt,
    steps: [],
    stepsDropped: 0,
    nudged: false,
    rounds: 0,
  };
}

/** Open a step (status `running`) and return its record. */
function startStep(run, { tool, args = null, round = null, label = '', plane = 'cloud' } = {}) {
  if (!run || !Array.isArray(run.steps)) return null;
  if (run.steps.length >= MAX_STEPS) {
    run.stepsDropped += 1;
    return null;
  }
  const { preview, redacted, keys } = describeStepArgs(tool, args);
  const step = {
    id: `${run.id}_s${run.steps.length + 1}`,
    index: run.steps.length + 1,
    tool: String(tool || 'unknown'),
    plane,
    label: String(label || ''),
    round,
    status: 'running',
    argsPreview: preview,
    argsRedacted: redacted,
    argKeys: redacted ? keys : [],
    resultPreview: null,
    error: null,
    // The failure KIND (see toolOutcome.js), the producer's refusal CAUSE when it
    // gave one, and whether that refusal is one a person could answer differently
    // next time. All are null/false until the step closes, so a running step and a
    // successful one are the same shape — and a running step must never look
    // re-askable, because there is nothing to re-ask yet.
    outcome: null,
    cause: null,
    reaskable: false,
    retried: false,
    ms: null,
    startedAt: Date.now(),
  };
  run.steps.push(step);
  return step;
}

/** Close a step with its outcome. Mutates and returns the same record. */
function completeStep(step, { result = '', error = null, outcome = null, cause = null, retried = false } = {}) {
  if (!step) return null;
  const text = String(result ?? '');
  const trimmed = text.trim();
  // A refusal is neither success nor failure: the user said no, and the record
  // should say so rather than showing a tick beside a step that never ran. The
  // denial may come from the harness's approval gate (`Denied: <reason>`) or from
  // the PC's own `permissions.js` by way of `pc_do` (`Denied: pc_do … was refused
  // on the PC: <reason>`) — both are a decision, so both match.
  step.status = error || /^Error/.test(trimmed)
    ? 'error'
    : /^(?:Denied|Cancelled)(?::|\s)/.test(trimmed)
      ? 'denied'
      : 'ok';
  // Annotated results carry the harness instruction on their own lines (see
  // toolOutcome.js). That text is written for the MODEL, not for a step list: it
  // is identical for every failure of the same kind, so leaving it in would make
  // every failed step preview look the same and hide what the tool said. The
  // preview shows the tool's own message; the kind is a field of its own.
  step.ms = Math.max(0, Date.now() - step.startedAt);
  step.error = error ? String(error.message || error) : null;
  step.outcome = outcome || null;
  // WHY a refusal happened, when the refuser said (a PC's permission gate does:
  // `user-declined`, `expired`, `policy-deny`, `kill-switch`). It is kept apart
  // from `outcome` because the two answer different questions — `permission` says
  // a gate blocked it, this says whether a person or a setting did, which is the
  // difference between a step worth offering to retry and one that is not.
  step.cause = cause || null;
  // …and the ANSWER to that question, decided here rather than by each reader.
  // The client renders a "Try again" affordance off this field: if the UI kept its
  // own copy of which causes are re-askable, that copy would drift from
  // `refusalCause.js` and could one day offer a retry for a hard stop — a button
  // that lies about what will happen. A stale client can only FAIL to show a
  // button, which is the safe direction, but it should not have to guess at all.
  step.reaskable = isReaskableCause(step.cause);
  step.retried = !!retried;
  const previewText = text.replace(HARNESS_NOTE_RE, '');
  // Bounded: a repo_read_file result is ~40 KB and the journal is a summary.
  step.resultPreview = previewText.length > MAX_PREVIEW_CHARS
    ? `${previewText.slice(0, MAX_PREVIEW_CHARS)}…[${text.length} chars]`
    : previewText;
  return step;
}

// ── Persistence ────────────────────────────────────────────────────────────

let _store = null;

/** Test hook: swap the persistence layer (mirrors repoAgentService's proposal store). */
function setRunStoreForTests(store) { _store = store; }

function defaultStore() {
  const client = new DynamoDBClient({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  const dynamodb = DynamoDBDocumentClient.from(client);
  return {
    async load(userId) {
      const { Item } = await dynamodb.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { id: `${RUN_KEY_PREFIX}${userId}`, createdAt: FIXED_CREATED_AT },
      }));
      if (!Item?.text) return [];
      try { return JSON.parse(Item.text) || []; } catch { return []; }
    },
    async save(userId, runs) {
      await dynamodb.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          id: `${RUN_KEY_PREFIX}${userId}`,
          createdAt: FIXED_CREATED_AT,
          text: JSON.stringify(runs),
          updatedAt: new Date().toISOString(),
        },
      }));
    },
  };
}

const store = () => _store || defaultStore();

/**
 * Persist a finished run into the per-user ring (newest first, capped).
 *
 * Read-modify-write, deliberately: one row per user keeps growth bounded and
 * self-cleaning, the same shape `msg_index_<userId>` uses for the Talk
 * dashboard. Never throws — a journal that can fail a turn is worse than none.
 *
 * @returns {Promise<{saved: boolean}>}
 */
async function finishRun(run, { outcome = 'completed', usage = null, plan = null } = {}) {
  if (!run || !run.userId) return { saved: false };
  const record = {
    id: run.id,
    at: new Date(run.startedAt).toISOString(),
    provider: run.provider,
    model: run.model,
    outcome,
    messageChars: run.messageChars,
    rounds: run.rounds,
    nudged: !!run.nudged,
    durationMs: Math.max(0, Date.now() - run.startedAt),
    steps: run.steps,
    stepsDropped: run.stepsDropped,
    // The agent's own plan for this turn (harness/planSurface.js), when it
    // published one. Stored beside the steps it explains, not instead of them.
    plan: plan && plan.items?.length ? plan : null,
    usage: usage || null,
  };

  try {
    const existing = await store().load(run.userId);
    const runs = [record, ...(Array.isArray(existing) ? existing : [])].slice(0, MAX_RUNS);
    await store().save(run.userId, runs);
    return { saved: true };
  } catch (err) {
    logger.warn?.(`[stepJournal] could not save run ${run.id}: ${err.message}`);
    return { saved: false };
  }
}

/** Read a user's recent runs. Never throws — the UI degrades to "no history". */
async function readRuns(userId) {
  if (!userId) return [];
  try {
    const runs = await store().load(userId);
    return Array.isArray(runs) ? runs : [];
  } catch {
    return [];
  }
}

/**
 * Build the `runToolLoop` hooks for a run, so BOTH routes describe the same step
 * the same way. A caller that renders (the streaming route) passes `onStep`;
 * one that only records passes nothing.
 *
 * @param {object|null} run
 * @param {object} [opts]
 * @param {(step: object) => void} [opts.onStep]          step opened, and again when it closes
 * @param {(info: object) => void} [opts.onAnnounce]      just before a tool runs (progress line)
 * @returns {{onToolStart?: Function, onToolEnd?: Function}} `{}` when there is no run
 */
function journalHooks(run, { onStep = null, onAnnounce = null } = {}) {
  if (!run) return {};
  const open = new Map();
  return {
    onToolStart: ({ toolCall, name, round }) => {
      const args = parseToolArguments(toolCall).args;
      const label = describeToolActivity(name, args);
      if (onAnnounce) onAnnounce({ toolCall, name, args, label, round });
      const step = startStep(run, { tool: name, args, round, label, plane: toolPlane(name) });
      if (step) open.set(toolCall.id, step);
      if (onStep) onStep(step);
    },
    onToolEnd: ({ toolCall, result, error, outcome, cause, retried }) => {
      const step = open.get(toolCall.id);
      if (!step) return;
      open.delete(toolCall.id);
      if (onStep) onStep(completeStep(step, { result, error, outcome, cause, retried }));
    },
  };
}

module.exports = {
  createRun,
  startStep,
  completeStep,
  finishRun,
  readRuns,
  describeStepArgs,
  journalHooks,
  setRunStoreForTests,
  // exported for tests
  PRIVATE_ARG_TOOLS,
  MAX_STEPS,
  MAX_RUNS,
};
