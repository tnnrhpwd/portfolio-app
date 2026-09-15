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
 * Key derivation
 * --------------
 * `MESSAGE_ENCRYPTION_KEY` (any long random string) is the intended source. If
 * it is absent the key is derived from `JWT_SECRET` instead, so local dev and
 * preview environments work with no new configuration — at the cost of tying
 * message confidentiality to the JWT secret. Setting the dedicated variable is
 * therefore recommended in production; switching it later makes previously
 * stored messages undecryptable, which is the expected trade-off.
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

/** The 32-byte AES key, derived once per process. */
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

    // hkdfSync returns an ArrayBuffer, not a Buffer.
    cachedKey = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret, 'utf8'), SALT, INFO, 32));
    return cachedKey;
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
 * @param {string} blob
 * @param {string} [aad]
 * @returns {string|null}
 */
function decrypt(blob, aad = '') {
    if (!isEncrypted(blob)) return null;
    try {
        const [version, ivB64, tagB64, dataB64] = blob.split('.');
        if (version !== VERSION) throw new Error(`unsupported blob version ${version}`);
        const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64url'));
        if (aad) decipher.setAAD(Buffer.from(String(aad), 'utf8'));
        decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
        return Buffer.concat([
            decipher.update(Buffer.from(dataB64, 'base64url')),
            decipher.final(),
        ]).toString('utf8');
    } catch (error) {
        logger.warn('Failed to decrypt a stored message body', { error: error.message });
        return null;
    }
}

/** Test seam: forget the derived key (used after changing env vars in tests). */
function _resetKeyCache() {
    cachedKey = null;
}

module.exports = { encrypt, decrypt, isEncrypted, _resetKeyCache, VERSION };
