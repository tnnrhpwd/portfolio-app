/**
 * DeepStorage Controller — powers the /deepstorage page.
 *
 * Serves the cached catalog of stackable Minecraft Bedrock Edition items,
 * and lets an admin regenerate that catalog from the live source on demand
 * (instead of it being re-fetched/re-parsed on every page load).
 *
 * GET  /api/data/deepstorage/items       — read the cached catalog (public)
 * POST /api/data/deepstorage/regenerate  — re-fetch, re-parse, and persist (admin only)
 */

const asyncHandler = require('express-async-handler');
const {
    loadDeepStorageList,
    regenerateAndSave,
} = require('../services/deepStorageService');

const isAdmin = (req) => req.user && req.user.id === process.env.ADMIN_USER_ID;

// ═══════════════════════════════════════════════════════════════
// GET /api/data/deepstorage/items
// ═══════════════════════════════════════════════════════════════
const getDeepStorageItems = asyncHandler(async (req, res) => {
    const list = await loadDeepStorageList();

    if (!list) {
        return res.status(200).json({
            items: [],
            generatedAt: null,
            totalKept: 0,
            message: 'No item list has been generated yet. An admin needs to press "Regenerate" first.',
        });
    }

    res.status(200).json(list);
});

// ═══════════════════════════════════════════════════════════════
// POST /api/data/deepstorage/regenerate
// ═══════════════════════════════════════════════════════════════
const regenerateDeepStorageItems = asyncHandler(async (req, res) => {
    if (!isAdmin(req)) {
        res.status(403);
        throw new Error('Access denied. Admin privileges required.');
    }

    try {
        const list = await regenerateAndSave();
        res.status(200).json(list);
    } catch (error) {
        console.error('Error regenerating DeepStorage item list:', error);
        res.status(502).json({
            error: 'Failed to regenerate item list from source',
            details: error.message,
        });
    }
});

module.exports = { getDeepStorageItems, regenerateDeepStorageItems };
