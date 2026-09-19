/**
 * Symmetric encryption helper for storing user secrets (e.g. GitHub PATs)
 * in DynamoDB. Uses AES-256-GCM with a key derived from a master secret via
 * scrypt.
 *
 * Ciphertext format (base64): "enc:v1:<base64(salt|iv|tag|ciphertext)>"
 *   - salt: 16 bytes (per-record)
 *   - iv:   12 bytes (GCM nonce)
 *   - tag:  16 bytes (GCM auth tag)
 *   - ciphertext: variable
 *
 * Master secret: `SECRETS_ENCRYPTION_KEY` when set, otherwise `JWT_SECRET`.
 * If neither is present the helpers throw — secrets must never be stored
 * in plaintext silently.
 *
 * ⚠️ The per-record salt does NOT make rotation free. It salts the KDF, but the
 * master secret is still the KDF's input, so a value written under one secret
 * cannot be read with another. Switching `SECRETS_ENCRYPTION_KEY` on would
 * therefore have orphaned every row already stored — so `decryptString` falls
 * back to the `JWT_SECRET`-derived secret (`getLegacySecret`). That fallback is
 * a READ path for pre-rotation rows only; new values never use it.
 */

const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const { logger } = require('./logger');
const KEY_LEN = 32;
const PREFIX = 'enc:v1:';

/** The master secret new values are encrypted with. */
function getMasterSecret() {
    if (!process.env.SECRETS_ENCRYPTION_KEY) {
        logger.warn('secretCrypto: SECRETS_ENCRYPTION_KEY not set — deriving the encryption key from JWT_SECRET. Rotating JWT_SECRET would render stored secrets undecryptable.');
    }
    const secret = process.env.SECRETS_ENCRYPTION_KEY || process.env.JWT_SECRET;
    if (!secret || secret.length < 16) {
        throw new Error('secretCrypto: JWT_SECRET (or SECRETS_ENCRYPTION_KEY) is not configured');
    }
    return secret;
}

/**
 * The master secret values written BEFORE `SECRETS_ENCRYPTION_KEY` was set used,
 * i.e. the one derived from `JWT_SECRET`. `decryptString` falls back to it so
 * configuring the dedicated key does not make stored values unreadable.
 *
 * Null when there is no dedicated key (it IS the master then, so there is
 * nothing to fall back to) or when `JWT_SECRET` is absent.
 *
 * @returns {string|null}
 */
function getLegacySecret() {
    if (!process.env.SECRETS_ENCRYPTION_KEY || !process.env.JWT_SECRET) return null;
    return process.env.JWT_SECRET;
}

function deriveKey(secret, salt) {
    return crypto.scryptSync(secret, salt, KEY_LEN);
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
    const key = deriveKey(getMasterSecret(), salt);
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
 *
 * Two master secrets are tried in order: the current one, then the
 * `JWT_SECRET`-derived one that pre-dates `SECRETS_ENCRYPTION_KEY` (see
 * `getLegacySecret`). Returns null when neither can read the value.
 *
 * @param {string|null|undefined} value
 * @returns {string|null|undefined}
 */
function decryptString(value) {
    if (value === null || value === undefined || value === '') return value;
    if (typeof value !== 'string') return value;
    if (!value.startsWith(PREFIX)) return value; // plaintext / legacy

    const buf = Buffer.from(value.slice(PREFIX.length), 'base64');
    const salt = buf.subarray(0, SALT_LEN);
    const iv = buf.subarray(SALT_LEN, SALT_LEN + IV_LEN);
    const tag = buf.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
    const ct = buf.subarray(SALT_LEN + IV_LEN + TAG_LEN);

    // Resolved inside the try so "not configured at all" degrades to null (the
    // previous behaviour) instead of throwing out of a read path.
    const secrets = [];
    try {
        secrets.push(getMasterSecret());
    } catch (e) {
        logger.error(`[secretCrypto] Failed to decrypt value: ${e.message}`);
        return null;
    }
    const legacy = getLegacySecret();
    if (legacy) secrets.push(legacy);

    let reason = 'no configured key could read this value';
    for (const secret of secrets) {
        try {
            const decipher = crypto.createDecipheriv(ALGO, deriveKey(secret, salt), iv);
            decipher.setAuthTag(tag);
            return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
        } catch (e) {
            reason = e.message || e.code || String(e);
        }
    }

    // The reason goes IN the message: winston's console format prints only
    // `message`, and a string passed as the second argument is stored as splat
    // (a Symbol), which JSON.stringify drops — so a separate argument is
    // invisible in BOTH transports and this logged an empty line.
    logger.error(`[secretCrypto] Failed to decrypt value: ${reason}`);
    return null;
}

function isEncrypted(value) {
    return typeof value === 'string' && value.startsWith(PREFIX);
}

module.exports = {
    encryptString,
    decryptString,
    isEncrypted,
};
