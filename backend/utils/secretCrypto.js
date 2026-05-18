/**
 * Symmetric encryption helper for storing user secrets (e.g. GitHub PATs)
 * in DynamoDB. Uses AES-256-GCM with a key derived from JWT_SECRET via scrypt.
 *
 * Ciphertext format (base64): "enc:v1:<base64(salt|iv|tag|ciphertext)>"
 *   - salt: 16 bytes (per-record, lets us rotate JWT_SECRET later if needed)
 *   - iv:   12 bytes (GCM nonce)
 *   - tag:  16 bytes (GCM auth tag)
 *   - ciphertext: variable
 *
 * If JWT_SECRET is missing the helpers throw — secrets must never be stored
 * in plaintext silently.
 */

const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const PREFIX = 'enc:v1:';

function getMasterSecret() {
    const secret = process.env.SECRETS_ENCRYPTION_KEY || process.env.JWT_SECRET;
    if (!secret || secret.length < 16) {
        throw new Error('secretCrypto: JWT_SECRET (or SECRETS_ENCRYPTION_KEY) is not configured');
    }
    return secret;
}

function deriveKey(salt) {
    return crypto.scryptSync(getMasterSecret(), salt, KEY_LEN);
}

/**
 * Encrypt a plaintext string. Empty / nullish values pass through unchanged.
 * @param {string|null|undefined} plaintext
 * @returns {string|null|undefined} ciphertext with PREFIX, or the original value if empty
 */
function encryptString(plaintext) {
    if (plaintext === null || plaintext === undefined || plaintext === '') return plaintext;
    if (typeof plaintext !== 'string') return plaintext;
    if (plaintext.startsWith(PREFIX)) return plaintext; // already encrypted

    const salt = crypto.randomBytes(SALT_LEN);
    const iv = crypto.randomBytes(IV_LEN);
    const key = deriveKey(salt);
    const cipher = crypto.createCipheriv(ALGO, key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const payload = Buffer.concat([salt, iv, tag, ct]).toString('base64');
    return PREFIX + payload;
}

/**
 * Decrypt a string previously produced by encryptString. Returns the input
 * unchanged if it is not in our encrypted format (back-compat for any rows
 * stored before encryption was rolled out).
 * @param {string|null|undefined} value
 * @returns {string|null|undefined}
 */
function decryptString(value) {
    if (value === null || value === undefined || value === '') return value;
    if (typeof value !== 'string') return value;
    if (!value.startsWith(PREFIX)) return value; // plaintext / legacy

    try {
        const buf = Buffer.from(value.slice(PREFIX.length), 'base64');
        const salt = buf.subarray(0, SALT_LEN);
        const iv = buf.subarray(SALT_LEN, SALT_LEN + IV_LEN);
        const tag = buf.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
        const ct = buf.subarray(SALT_LEN + IV_LEN + TAG_LEN);
        const key = deriveKey(salt);
        const decipher = crypto.createDecipheriv(ALGO, key, iv);
        decipher.setAuthTag(tag);
        const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
        return pt.toString('utf8');
    } catch (e) {
        console.error('[secretCrypto] Failed to decrypt value:', e.message);
        return null;
    }
}

function isEncrypted(value) {
    return typeof value === 'string' && value.startsWith(PREFIX);
}

module.exports = {
    encryptString,
    decryptString,
    isEncrypted,
};
