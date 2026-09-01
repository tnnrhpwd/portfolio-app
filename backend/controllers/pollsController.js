/**
 * pollsController.js — Express handlers for the public Polls feature.
 *
 * Routes (all mounted under /api/data, no sign-in required):
 *   GET    /polls              → list recent polls (active + closed)
 *   POST   /polls              → create a poll { question, options, durationMinutes, creator }
 *   POST   /polls/:id/vote     → cast a vote { optionIndex, voterId }
 *   POST   /polls/:id/close    → owner closes a poll { ownerKey }
 *   POST   /polls/:id/delete   → owner deletes a poll { ownerKey }
 */

const asyncHandler = require('express-async-handler');
const {
  LIMITS,
  listPolls,
  createPoll,
  votePoll,
  closePoll,
  deletePoll,
  ensureWeeklyAiPoll,
} = require('../services/pollsService');

function fail(res, statusCode, message) {
  res.status(statusCode);
  throw new Error(message);
}

// @desc    List recent polls
// @route   GET /api/data/polls
// @access  Public
const getPolls = asyncHandler(async (req, res) => {
  // Lazy generation: a new weekly AI poll is only made while a visitor is
  // actually here (no cron). This also resolves last week's results.
  const weekly = await ensureWeeklyAiPoll();
  const polls = await listPolls();
  res.status(200).json({ success: true, polls, ...weekly });
});

// @desc    Create a new poll
// @route   POST /api/data/polls
// @access  Public
const createPollHandler = asyncHandler(async (req, res) => {
  const { question, options, durationMinutes, creator } = req.body || {};

  const q = typeof question === 'string' ? question.trim() : '';
  if (!q) fail(res, 400, 'A poll question is required');
  if (q.length > LIMITS.questionMax) fail(res, 400, `Question must be ${LIMITS.questionMax} characters or fewer`);

  if (!Array.isArray(options)) fail(res, 400, 'Answer options are required');
  const cleaned = options
    .map((o) => (typeof o === 'string' ? o.trim() : ''))
    .filter((o) => o.length > 0);
  if (cleaned.length < LIMITS.minOptions) fail(res, 400, `At least ${LIMITS.minOptions} answer options are required`);
  if (cleaned.length > LIMITS.maxOptions) fail(res, 400, `At most ${LIMITS.maxOptions} answer options are allowed`);
  if (cleaned.some((o) => o.length > LIMITS.optionMax)) {
    fail(res, 400, `Each answer must be ${LIMITS.optionMax} characters or fewer`);
  }

  const duration = Number(durationMinutes);
  if (!Number.isInteger(duration) || duration < LIMITS.durationMin || duration > LIMITS.durationMax) {
    fail(res, 400, `Duration must be a whole number between ${LIMITS.durationMin} and ${LIMITS.durationMax} minutes`);
  }

  let name = creator == null ? '' : String(creator).trim();
  if (name.length > LIMITS.creatorMax) fail(res, 400, `Name must be ${LIMITS.creatorMax} characters or fewer`);

  const poll = await createPoll({ question: q, options: cleaned, durationMinutes: duration, creator: name });
  res.status(201).json({ success: true, poll });
});

// @desc    Vote in a poll
// @route   POST /api/data/polls/:id/vote
// @access  Public
const votePollHandler = asyncHandler(async (req, res) => {
  const { optionIndex, voterId } = req.body || {};

  const idx = Number(optionIndex);
  if (!Number.isInteger(idx) || idx < 0) fail(res, 400, 'A valid option is required');

  const vId = typeof voterId === 'string' ? voterId.trim() : '';
  if (!vId) fail(res, 400, 'A voter identifier is required');
  if (vId.length > LIMITS.voterIdMax) fail(res, 400, 'Invalid voter identifier');

  const poll = await votePoll(req.params.id, idx, vId);
  res.status(200).json({ success: true, poll });
});

// @desc    Close a poll (owner only)
// @route   POST /api/data/polls/:id/close
// @access  Public (owner key)
const closePollHandler = asyncHandler(async (req, res) => {
  const { ownerKey } = req.body || {};
  const poll = await closePoll(req.params.id, typeof ownerKey === 'string' ? ownerKey : '');
  res.status(200).json({ success: true, poll });
});

// @desc    Delete a poll (owner only)
// @route   POST /api/data/polls/:id/delete
// @access  Public (owner key)
const deletePollHandler = asyncHandler(async (req, res) => {
  const { ownerKey } = req.body || {};
  const result = await deletePoll(req.params.id, typeof ownerKey === 'string' ? ownerKey : '');
  res.status(200).json({ success: true, ...result });
});

module.exports = {
  getPolls,
  createPoll: createPollHandler,
  votePoll: votePollHandler,
  closePoll: closePollHandler,
  deletePoll: deletePollHandler,
};
