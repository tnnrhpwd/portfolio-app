/**
 * memoryController.js — Express handlers for the Memory (Goals / Plans / Actions) API.
 */

const asyncHandler = require('express-async-handler');
const {
  getMemoryItems,
  createMemoryItem,
  updateMemoryItem,
  deleteMemoryItem,
} = require('../services/memoryService');

// @desc    Get user's memory items (goals, plans, actions)
// @route   GET /api/data/memory?type=goal|plan|action
// @access  Protected
const getMemory = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const type = req.query.type || null; // optional filter

  const items = await getMemoryItems(userId, type);
  res.status(200).json({ success: true, items });
});

// @desc    Create a new memory item
// @route   POST /api/data/memory
// @access  Protected
const createMemory = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { type, data } = req.body;

  if (!type || !data) {
    res.status(400);
    throw new Error('type and data are required');
  }

  if (!data.title || !data.title.trim()) {
    res.status(400);
    throw new Error('title is required in data');
  }

  const item = await createMemoryItem(userId, type, data);
  res.status(201).json({ success: true, item });
});

// @desc    Update a memory item
// @route   PUT /api/data/memory/:id
// @access  Protected
const updateMemory = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const itemId = req.params.id;
  const updates = req.body.data;

  if (!updates) {
    res.status(400);
    throw new Error('data updates are required');
  }

  const item = await updateMemoryItem(userId, itemId, updates);
  res.status(200).json({ success: true, item });
});

// @desc    Delete a memory item
// @route   DELETE /api/data/memory/:id
// @access  Protected
const deleteMemory = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const itemId = req.params.id;

  await deleteMemoryItem(userId, itemId);
  res.status(200).json({ success: true, deleted: true });
});

module.exports = { getMemory, createMemory, updateMemory, deleteMemory };
