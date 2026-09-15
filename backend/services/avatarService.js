/**
 * avatarService.js — small, cached avatars for other people's profile pictures.
 *
 * Why this exists rather than just sending `profilePicture`
 * ---------------------------------------------------------
 * `profilePicture` is a 512px square JPEG data URL (20–80 KB of base64) baked on
 * the client and stored on the account row. Rendering someone's face in a 32px
 * circle at that size is ~20x more pixels than the layout can show — and a
 * contact list needs one per row, so the browser would pay that per friend, per
 * load, with no way to cache it (a data URL cannot be HTTP-cached).
 *
 * So the server re-encodes once and hands out a 96px JPEG (~3–5 KB), keyed by a
 * hash of the source picture. That hash doubles as the client's cache key: a
 * friend's face is fetched once per device, and again only if they change it.
 *
 * `sharp` is already a backend dependency (fileProcessingService, the Dream board
 * art script), so this adds no new infrastructure — and deliberately no S3 round
 * trip and no write path. A GET must not write to the account row.
 *
 * ⚠️ This is a *readability* optimisation, not a security boundary. Who is
 * ALLOWED to see a picture is decided by the caller (messengerService gates on an
 * accepted connection); by the time a picture reaches this module, that question
 * is already answered.
 */

const crypto = require('crypto');
const sharp = require('sharp');
const { logger } = require('../utils/logger');

/**
 * Square edge, in px.
 *
 * One size for every place an avatar is drawn, chosen for the LARGEST of them: the
 * profile hero renders it at ~2.2 x `--nav-size` (~105px), which wants ~160px to
 * stay crisp on a 1.5x display. The contact rows and the DM header draw it at
 * ~30px, where 160 is generous — but a second size would mean a second cache key
 * and a second code path for a difference nobody can see, and even at 160px this
 * is 5-10x smaller than the stored picture.
 */
const AVATAR_PX = 160;
const AVATAR_QUALITY = 78;

/** Bounded so a long-lived process that has seen every account can't grow forever. */
const CACHE_MAX = 400;

/** Same shape `profileController` validates on write. */
const PICTURE_DATA_URL_RE = /^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/;

// source-hash → { src, etag }. `Map` keeps insertion order, so eviction can drop
// the oldest key without tracking timestamps.
const cache = new Map();

/** The client's cache key for a picture. Empty string means "no picture". */
function etagFor(picture) {
    if (typeof picture !== 'string' || !picture) return '';
    return crypto.createHash('sha1').update(picture).digest('hex').slice(0, 16);
}

function remember(key, value) {
    if (cache.has(key)) cache.delete(key); // re-insert so it counts as recent
    cache.set(key, value);
    if (cache.size > CACHE_MAX) {
        cache.delete(cache.keys().next().value);
    }
}

/**
 * Downscale a stored profile picture to an avatar.
 *
 * @param {string} picture - The `data:image/...;base64,...` value from the account row.
 * @returns {Promise<{ src: string, etag: string }|null>} `null` when there is no
 *   usable picture — which is a normal answer, not an error (most accounts have
 *   no picture, and the UI draws initials for them).
 */
async function buildAvatar(picture) {
    if (typeof picture !== 'string' || !picture || !PICTURE_DATA_URL_RE.test(picture)) return null;

    const key = etagFor(picture);
    const hit = cache.get(key);
    if (hit) return hit;

    const comma = picture.indexOf(',');
    const buffer = Buffer.from(picture.slice(comma + 1), 'base64');

    try {
        const out = await sharp(buffer)
            // `cover` because the stored picture is already square-cropped by the
            // editor — this only guarantees a square if an older row is not.
            .resize(AVATAR_PX, AVATAR_PX, { fit: 'cover', position: 'centre' })
            .jpeg({ quality: AVATAR_QUALITY, mozjpeg: true })
            .toBuffer();

        const value = { src: `data:image/jpeg;base64,${out.toString('base64')}`, etag: key };
        remember(key, value);
        return value;
    } catch (error) {
        // One corrupt picture must not fail a whole contact list: the caller
        // renders initials and the rest of the avatars still arrive.
        logger.warn('Could not build an avatar from a stored profile picture', { error: error.message });
        return null;
    }
}

/** Test seam: forget every encoded avatar. */
function _resetAvatarCache() {
    cache.clear();
}

/** Test seam: how many avatars are held. */
function _avatarCacheSize() {
    return cache.size;
}

module.exports = {
    AVATAR_PX,
    etagFor,
    buildAvatar,
    _resetAvatarCache,
    _avatarCacheSize,
};
