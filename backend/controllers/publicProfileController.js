/**
 * publicProfileController.js — the public `/u/<username>` profile.
 *
 * One route, no sign-in required. `optionalAuth` is used rather than nothing at
 * all so the page can tell the *viewer* whether this profile is their own or
 * someone they are already connected to — that answer depends on who is asking,
 * and it is the only thing about the response that does.
 */

const asyncHandler = require('express-async-handler');
const { buildPublicProfile } = require('../services/publicProfile');
const { isValidNicknameShape } = require('../utils/userIdentity');
const { checkIP } = require('../utils/accessData.js');

// @desc    A public profile by username
// @route   GET /api/data/u/:username
// @access  Public (auth-aware)
const getPublicProfile = asyncHandler(async (req, res) => {
    await checkIP(req);

    const username = String(req.params.username || '').trim();

    // A nickname that cannot exist is not worth a table scan; the shape check runs
    // before any lookup.
    if (!isValidNicknameShape(username)) {
        res.status(400);
        throw new Error('That is not a username we can look up');
    }

    const profile = await buildPublicProfile({ username, viewer: req.user || null });
    if (!profile) {
        res.status(404);
        throw new Error('No account with that username');
    }

    res.status(200).json({ success: true, profile });
});

module.exports = { getPublicProfile };
