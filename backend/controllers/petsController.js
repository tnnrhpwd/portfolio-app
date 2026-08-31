/**
 * petsController.js — Express handlers for the Pets feature.
 *
 * Routes (all mounted under /api/data):
 *   GET    /pets                  → list the user's pets (stats decayed)
 *   POST   /pets/adopt            → adopt a new pet { name, species }
 *   GET    /pets/:petId           → get one pet
 *   POST   /pets/:petId/action    → perform a care action { action } (or revive)
 *   DELETE /pets/:petId           → release a pet
 */

const asyncHandler = require('express-async-handler');
const {
  SPECIES,
  MAX_PETS,
  listPets,
  getPet,
  adoptPet,
  performAction,
  releasePet,
} = require('../services/petsService');

const NAME_MAX = 24;

function validateName(name) {
  if (typeof name !== 'string' || !name.trim()) return false;
  if (name.trim().length > NAME_MAX) return false;
  return true;
}

// @desc    List the current user's pets
// @route   GET /api/data/pets
// @access  Protected
const getPets = asyncHandler(async (req, res) => {
  const pets = await listPets(req.user.id);
  res.status(200).json({
    success: true,
    pets,
    maxPets: MAX_PETS,
    species: Object.keys(SPECIES).map((key) => ({ key, ...SPECIES[key] })),
  });
});

// @desc    Adopt a new pet
// @route   POST /api/data/pets/adopt
// @access  Protected
const adopt = asyncHandler(async (req, res) => {
  const { name, species } = req.body || {};

  if (!validateName(name)) {
    res.status(400);
    throw new Error(`A name (1–${NAME_MAX} characters) is required`);
  }
  if (!species || !SPECIES[species]) {
    res.status(400);
    throw new Error('A valid species is required');
  }

  const pet = await adoptPet(req.user.id, { name: name.trim(), species });
  res.status(201).json({ success: true, pet });
});

// @desc    Get a single pet
// @route   GET /api/data/pets/:petId
// @access  Protected
const getPetOne = asyncHandler(async (req, res) => {
  const pet = await getPet(req.user.id, req.params.petId);
  res.status(200).json({ success: true, pet });
});

// @desc    Perform a care action (or revive a passed pet)
// @route   POST /api/data/pets/:petId/action
// @access  Protected
const doAction = asyncHandler(async (req, res) => {
  const { action } = req.body || {};
  if (typeof action !== 'string' || !action.trim()) {
    res.status(400);
    throw new Error('An action is required');
  }

  const pet = await performAction(req.user.id, req.params.petId, action.trim().toLowerCase());
  res.status(200).json({ success: true, pet });
});

// @desc    Release (delete) a pet
// @route   DELETE /api/data/pets/:petId
// @access  Protected
const removePet = asyncHandler(async (req, res) => {
  const result = await releasePet(req.user.id, req.params.petId);
  res.status(200).json({ success: true, ...result });
});

module.exports = { getPets, adopt, getPetOne, doAction, removePet };
