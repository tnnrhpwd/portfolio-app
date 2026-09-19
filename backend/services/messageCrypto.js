/**
 * messageCrypto.js — envelope encryption for stored message bodies.
 *
 * What this does and does not protect against
 * -------------------------------------------
 * The product decision for /talk was **encrypted in transit + at rest, with the
 * server holding the key** (not end-to-end). So:
 *
 *   ✅ A dump of the `Simple` table, a DynamoDB console session, an S3 export, a
 *      log line, or a support engineer reading raw rows sees ciphertext.
 *   ✅ A pre-filter scan that matches on message text can't match anything —
 *      there is no plaintext in the row.
 *   ❌ The running server can decrypt anything, because it has the key. That is
 *      inherent to the choice: the API has to read the message to display it.
 *
 * Do not describe this as end-to-end encryption anywhere in the UI. It isn't.
 *
 * Key derivation and rotation
 * ---------------------------
 * `MESSAGE_ENCRYPTION_KEY` (any long random string) is the intended source. If
 * it is absent the key is derived from `JWT_SECRET` instead, so local dev and
 * preview environments work with no new configuration — at the cost of tying
 * message confidentiality to the JWT secret. Setting the dedicated variable is
 * therefore the production state.
 *
 * Setting it does NOT orphan history. Blobs already on disk were written with
 * the `JWT_SECRET`-derived key, so `decrypt` tries the dedicated key first and
 * then falls back to that one (see `getLegacyKey`). Rows written before the
 * switch stay readable; everything written after it uses the dedicated key, so
 * none of it depends on the JWT secret any more. The fallback exists only for
 * those older rows — delete it once none remain.
 *
 * HKDF with a fixed salt/info is used rather than the raw secret so the derived
 * key is exactly 32 bytes and independent of the JWT signing key material.
 *
 * Format: `v1.<iv>.<tag>.<ciphertext>`, all base64url. The version prefix is
 * there so a future scheme can be introduced without guessing which rows use it.
 */

const crypto = require('crypto');
const { logger } = require('../utils/logger');

const VERSION = 'v1';
const SALT = Buffer.from('sthopwood-messenger', 'utf8');
const INFO = Buffer.from('message-body-v1', 'utf8');

let cachedKey = null;
let cachedLegacyKey = null;

/** Derive the 32-byte AES key from a secret. (hkdfSync returns an ArrayBuffer.) */
function deriveKey(secret) {
    return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret, 'utf8'), SALT, INFO, 32));
}

/** The key NEW blobs are written with, derived once per process. */
function getKey() {
    if (cachedKey) return cachedKey;

    const secret = process.env.MESSAGE_ENCRYPTION_KEY || process.env.JWT_SECRET;
    if (!secret) {
        throw new Error(
            'No encryption key available: set MESSAGE_ENCRYPTION_KEY (or JWT_SECRET) in the environment.'
        );
    }
    if (!process.env.MESSAGE_ENCRYPTION_KEY) {
        logger.warn(
            'MESSAGE_ENCRYPTION_KEY is not set — messenger bodies are being encrypted with a key derived from JWT_SECRET. Set the dedicated variable in production.'
        );
    }

    cachedKey = deriveKey(secret);
    return cachedKey;
}

/**
 * The key that blobs written BEFORE `MESSAGE_ENCRYPTION_KEY` was set used — i.e.
 * the one derived from `JWT_SECRET`. `decrypt` falls back to it, which is what
 * makes switching the variable on safe rather than a one-way door for every
 * message already stored.
 *
 * Null when there is no dedicated key (then it IS the primary key, so there is
 * nothing to fall back to) or when `JWT_SECRET` is absent. Read-only path: new
 * blobs never use it.
 *
 * @returns {Buffer|null}
 */
function getLegacyKey() {
    if (!process.env.MESSAGE_ENCRYPTION_KEY || !process.env.JWT_SECRET) return null;
    if (!cachedLegacyKey) cachedLegacyKey = deriveKey(process.env.JWT_SECRET);
    return cachedLegacyKey;
}

/** True when a value looks like a blob this module produced. */
function isEncrypted(value) {
    return typeof value === 'string' && value.startsWith(`${VERSION}.`);
}

/**
 * Encrypt a UTF-8 string.
 *
 * @param {string} plaintext
 * @param {string} [aad] - Associated data, bound into the auth tag but not
 *   stored. The conversation id goes here, so a ciphertext cannot be copied
 *   into another conversation and decrypted there.
 * @returns {string} `v1.<iv>.<tag>.<ciphertext>`
 */
function encrypt(plaintext, aad = '') {
    const iv = crypto.randomBytes(12); // 96-bit nonce, the GCM default
    const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
    if (aad) cipher.setAAD(Buffer.from(String(aad), 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
        VERSION,
        iv.toString('base64url'),
        tag.toString('base64url'),
        ciphertext.toString('base64url'),
    ].join('.');
}

/**
 * Decrypt a blob from `encrypt()`.
 *
 * Returns `null` rather than throwing when the value is unreadable — a row
 * encrypted under a key that has since been rotated, or a hand-edited row,
 * should degrade to "message unavailable" instead of 500-ing a whole
 * conversation. The reason is logged so it isn't silent.
 *
 * Two keys are tried in order: the current one, then the `JWT_SECRET`-derived
 * key that pre-dates `MESSAGE_ENCRYPTION_KEY` (see `getLegacyKey`). An empty
 * string is a legitimate result, so "no plaintext" is expressed as `null` and
 * checked strictly — a falsy test would turn `encrypt('')` into a failure and
 * send the caller down the fallback path.
 *
 * @param {string} blob
 * @param {string} [aad]
 * @returns {string|null}
 */
function decrypt(blob, aad = '') {
    if (!isEncrypted(blob)) return null;

    const keys = [getKey()];
    const legacy = getLegacyKey();
    if (legacy) keys.push(legacy);

    let reason = 'no configured key could read this blob';
    for (const key of keys) {
        try {
            return decryptWith(blob, aad, key);
        } catch (error) {
            // Wrong key, tampered bytes, or a version we don't implement — try
            // the next key, and remember why the last attempt failed.
            reason = error.message;
        }
    }

    logger.warn('Failed to decrypt a stored message body', { error: reason });
    return null;
}

/** One decryption attempt with a given key. Throws when the key is not it. */
function decryptWith(blob, aad, key) {
    const [version, ivB64, tagB64, dataB64] = blob.split('.');
    if (version !== VERSION) throw new Error(`unsupported blob version ${version}`);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'));
    if (aad) decipher.setAAD(Buffer.from(String(aad), 'utf8'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([
        decipher.update(Buffer.from(dataB64, 'base64url')),
        decipher.final(),
    ]).toString('utf8');
}

/** Test seam: forget the derived keys (used after changing env vars in tests). */
function _resetKeyCache() {
    cachedKey = null;
    cachedLegacyKey = null;
}

module.exports = { encrypt, decrypt, isEncrypted, _resetKeyCache, VERSION };
