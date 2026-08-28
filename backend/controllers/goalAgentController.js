/**
 * goalAgentController.js — Express handlers for the Goal Agent API.
 *
 *   POST /api/data/goal-agent/start          → start an agent run on a goal
 *   GET  /api/data/goal-agent/status/:goalId → poll run status + progress
 *   POST /api/data/goal-agent/stop           → stop a running agent
 */

const asyncHandler = require('express-async-handler');
const { getMemoryItem } = require('../services/memoryService');
const { runGoalAgent, stopGoalAgentRun, isRunning } = require('../services/goalAgentService');
const { logger } = require('../utils/logger');

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
  // proceeds, so the client polls /status for updates.
  runGoalAgent({ userId: req.user.id, goalId, goal }).catch((err) => {
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

module.exports = { startGoalAgent, getGoalAgentStatus, stopGoalAgent };
