/**
 * goalAgentController.js — Express handlers for the Goal Agent API.
 *
 *   POST /api/data/goal-agent/start          → start an agent run on a goal
 *   GET  /api/data/goal-agent/status/:goalId → poll run status + progress
 *   POST /api/data/goal-agent/stop           → stop a running agent
 */

const asyncHandler = require('express-async-handler');
const { getMemoryItem, updateMemoryItem } = require('../services/memoryService');
const { runGoalAgent, stopGoalAgentRun, isRunning } = require('../services/goalAgentService');
const { logger } = require('../utils/logger');

// Whitelisted agent-state keys we accept from the mirror endpoint so a client
// (or the desktop addon) can record run results onto a goal without being able
// to clobber unrelated goal fields.
const AGENT_STATE_KEYS = ['status', 'summary', 'result', 'steps', 'plan', 'updatedAt', 'source', 'error', 'history'];

// Live-streaming guards: cap how many steps a goal's feed can accumulate and
// how long any single step's text may be, so a runaway addon can't bloat the
// DynamoDB item past its size limit.
const MAX_AGENT_STEPS = 200;
const STEP_TEXT_MAX = 1000;

/**
 * Normalize a raw stepLog entry from the desktop addon into one or more feed
 * steps using the same { kind, text, meta, ts } shape the /plans page renders.
 */
function normalizeStepEntry(entry) {
  const ts = entry.ts || new Date().toISOString();
  const tool = String(entry.tool || 'step');
  const args = (entry.args && typeof entry.args === 'object' && !Array.isArray(entry.args)) ? entry.args : {};
  const steps = [{
    kind: entry.ok === false ? 'error' : 'tool',
    text: entry.ok === false ? `${tool} failed` : tool,
    meta: { tool, args, ok: entry.ok !== false },
    ts,
  }];
  if (entry.result) {
    steps.push({ kind: 'tool-result', text: String(entry.result).slice(0, STEP_TEXT_MAX), meta: { tool }, ts });
  }
  return steps;
}

// @desc    Start an LLM agent run on a goal
// @route   POST /api/data/goal-agent/start
// @access  Protected
const startGoalAgent = asyncHandler(async (req, res) => {
  const { goalId } = req.body || {};
  if (!goalId) {
    res.status(400);
    throw new Error('goalId is required');
  }

  // Ownership check + must actually be a goal.
  const goal = await getMemoryItem(req.user.id, goalId);
  if (goal.type !== 'goal') {
    res.status(400);
    throw new Error('Only goals can enlist an agent');
  }

  if (isRunning(goalId)) {
    res.status(409).json({ success: false, message: 'An agent is already working on this goal.' });
    return;
  }

  // Run asynchronously — progress is persisted to the goal item as the run
  // proceeds, so the client polls /status for updates. Pass the user record
  // so the agent can file bug reports with the right identity.
  runGoalAgent({ userId: req.user.id, goalId, goal, user: req.user }).catch((err) => {
    logger.error('[goalAgent] run error:', err.message);
  });

  res.status(202).json({ success: true, message: 'Agent started', goalId });
});

// @desc    Get agent run status for a goal
// @route   GET /api/data/goal-agent/status/:goalId
// @access  Protected
const getGoalAgentStatus = asyncHandler(async (req, res) => {
  // Ownership check.
  const goal = await getMemoryItem(req.user.id, req.params.goalId);

  res.status(200).json({
    success: true,
    running: isRunning(req.params.goalId),
    agent: goal.data?.agent || { status: 'idle', steps: [] },
  });
});

// @desc    Stop a running agent
// @route   POST /api/data/goal-agent/stop
// @access  Protected
const stopGoalAgent = asyncHandler(async (req, res) => {
  const { goalId } = req.body || {};
  if (!goalId) {
    res.status(400);
    throw new Error('goalId is required');
  }

  // Ownership check.
  await getMemoryItem(req.user.id, goalId);

  const stopped = stopGoalAgentRun(goalId);
  res.status(200).json({ success: true, stopped });
});

// @desc    Record an external (desktop addon) agent result onto a goal so the
//          webapp /plans page is the single source of truth for progress even
//          when the O-O-G-P-A loop ran on the local machine.
// @route   POST /api/data/goal-agent/result
// @access  Protected
const recordGoalAgentResult = asyncHandler(async (req, res) => {
  const { goalId, agent } = req.body || {};
  if (!goalId) {
    res.status(400);
    throw new Error('goalId is required');
  }
  if (!agent || typeof agent !== 'object' || Array.isArray(agent)) {
    res.status(400);
    throw new Error('agent result object is required');
  }

  // Ownership check + must actually be a goal.
  const goal = await getMemoryItem(req.user.id, goalId);
  if (goal.type !== 'goal') {
    res.status(400);
    throw new Error('Only goals can record agent results');
  }

  // Start from the existing agent state (so history/source survive an addon
  // mirror) and overlay only the whitelisted keys; never let a client overwrite
  // the goal's title/description/status via this endpoint.
  const next = { ...(goal.data?.agent || {}) };
  for (const key of AGENT_STATE_KEYS) {
    if (agent[key] !== undefined) next[key] = agent[key];
  }
  next.updatedAt = new Date().toISOString();

  await updateMemoryItem(req.user.id, goalId, { agent: next });

  res.status(200).json({ success: true, agent: next });
});

// @desc    Append one live step to a goal's agent feed while a desktop addon
//          run is in progress (the addon pushes each executed tool mid-run).
// @route   POST /api/data/goal-agent/step
// @access  Protected
const appendGoalAgentStep = asyncHandler(async (req, res) => {
  const { goalId, step } = req.body || {};
  if (!goalId) {
    res.status(400);
    throw new Error('goalId is required');
  }
  if (!step || typeof step !== 'object' || Array.isArray(step)) {
    res.status(400);
    throw new Error('step object is required');
  }

  // Ownership check + must actually be a goal.
  const goal = await getMemoryItem(req.user.id, goalId);
  if (goal.type !== 'goal') {
    res.status(400);
    throw new Error('Only goals can receive agent steps');
  }

  const prev = goal.data?.agent || {};
  const steps = Array.isArray(prev.steps) ? prev.steps.slice() : [];
  steps.push(...normalizeStepEntry(step));
  const capped = steps.length > MAX_AGENT_STEPS
    ? steps.slice(steps.length - MAX_AGENT_STEPS)
    : steps;

  const agent = {
    ...prev,
    status: 'running',
    steps: capped,
    updatedAt: new Date().toISOString(),
  };

  await updateMemoryItem(req.user.id, goalId, { agent });

  res.status(200).json({ success: true, stepCount: capped.length });
});

module.exports = { startGoalAgent, getGoalAgentStatus, stopGoalAgent, recordGoalAgentResult, appendGoalAgentStep, normalizeStepEntry };
