/**
 * musicController.js — AI music generation endpoints.
 *
 *   GET    /api/data/music/catalog     → genres/moods/tempos + config (public)
 *   POST   /api/data/music/generate    → generate a song (auth + consent)
 *   GET    /api/data/music/songs       → list the user's songs (auth)
 *   DELETE /api/data/music/songs/:id   → delete a song (auth)
 *
 * Generation is authenticated + rate-limited because real providers are
 * metered, server-paid calls (mirrors imageGenController.js). The voice sample
 * is accepted inline (data URL) in this first slice; S3 persistence of the
 * sample is a follow-up.
 */

const asyncHandler = require('express-async-handler');
const { logger } = require('../utils/logger');
const musicService = require('../services/musicService');

// @desc    List music catalogs + generation config
// @route   GET /api/data/music/catalog
// @access  Public (static metadata — no cost, no secrets)
const getMusicCatalog = (req, res) => {
  res.status(200).json({ success: true, ...musicService.getCatalog() });
};

// @desc    Generate a song from a voice sample + lyrics + style
// @route   POST /api/data/music/generate
// @access  Private (protect)
const generateSong = asyncHandler(async (req, res) => {
  if (!musicService.isMusicGenerationConfigured()) {
    return res.status(503).json({
      success: false,
      error: 'Music generation is not configured on the server.',
    });
  }

  const { title, lyrics, style, voice, consent } = req.body || {};

  const validated = musicService.validateGenerateInput({ title, lyrics, style, voice, consent });
  if (validated.error) {
    return res.status(400).json({ success: false, error: validated.error });
  }

  // Credit pre-check (read-only) — skipped in mock mode since the local synth
  // costs nothing. Real providers are metered and must be gated first.
  if (!musicService.isMockMode()) {
    const { checkMusicCredits } = require('../utils/apiUsageTracker');
    const afford = await checkMusicCredits(req.user.id);
    if (!afford.canMake) {
      return res.status(402).json({
        success: false,
        error: afford.reason || 'Not enough AI credits to generate a song.',
        credits: afford.currentCredits,
      });
    }
  }

  try {
    const song = await musicService.generateSong({
      title: validated.title,
      lyrics: validated.lyrics,
      style: validated.style,
      voice: validated.voice,
    });

    await musicService.saveSong(req.user.id, song);

    // Deduct credits for real (non-mock) generations only.
    if (!song.mock) {
      const { trackMusicUsage } = require('../utils/apiUsageTracker');
      await trackMusicUsage(req.user.id, 1);
    }

    res.status(200).json({
      success: true,
      songId: song.songId,
      title: song.title,
      style: song.style,
      provider: song.provider,
      mock: song.mock,
      voiceCloned: song.voiceCloned,
      durationMs: song.durationMs,
      tracks: song.tracks,
      note: song.note,
    });
  } catch (error) {
    logger.error('[music] Generation failed:', { message: error.message, status: error.status });
    const status = error.status || 502;
    res.status(status).json({
      success: false,
      error: error.message || 'Music generation failed. Please try again.',
    });
  }
});

// @desc    List the authenticated user's songs
// @route   GET /api/data/music/songs
// @access  Private (protect)
const listSongs = asyncHandler(async (req, res) => {
  const songs = await musicService.listSongs(req.user.id);
  res.status(200).json({ success: true, songs });
});

// @desc    Delete a song
// @route   DELETE /api/data/music/songs/:id
// @access  Private (protect)
const deleteSong = asyncHandler(async (req, res) => {
  const songId = String(req.params.id || '').trim();
  if (!songId) {
    return res.status(400).json({ success: false, error: 'A song id is required.' });
  }

  try {
    await musicService.deleteSong(req.user.id, songId);
    res.status(200).json({ success: true });
  } catch (error) {
    logger.error('[music] Delete failed:', error.message);
    res.status(500).json({ success: false, error: 'Failed to delete the song.' });
  }
});

module.exports = { getMusicCatalog, generateSong, listSongs, deleteSong };
