/**
 * Local secret-at-rest helper for the addon.
 *
 * Uses Electron `safeStorage` (which wraps Windows DPAPI on Windows, Keychain
 * on macOS, libsecret on Linux) to encrypt sensitive values before they hit
 * disk. The ciphertext is base64 and tagged with the prefix `dpapi:v1:` so we
 * can tell encrypted blobs apart from plaintext during migration.
 *
 * Falls back gracefully:
 *   - If running outside Electron (unit tests, standalone Node), values pass
 *     through unchanged. A console warning is emitted ONCE so the dev notices.
 *   - If safeStorage is loadable but `isEncryptionAvailable()` returns false
 *     (rare — e.g. Linux without libsecret), same fallback.
 *
 * Used by `server/index.js` to protect `webapp.githubToken` in `settings.json`.
 */

const PREFIX = 'dpapi:v1:';

let _safeStorage = null;
let _safeStorageChecked = false;
let _fallbackWarned = false;

function getSafeStorage() {
    if (_safeStorageChecked) return _safeStorage;
    _safeStorageChecked = true;
    try {
        // Electron exposes safeStorage from the 'electron' module in main process.
        // Lazy-required so non-electron contexts (Jest, CLI scripts) don't blow up.
        // eslint-disable-next-line global-require
        const electron = require('electron');
        const safeStorage = electron && (electron.safeStorage || electron.remote?.safeStorage);
        if (safeStorage && typeof safeStorage.isEncryptionAvailable === 'function'
            && safeStorage.isEncryptionAvailable()) {
            _safeStorage = safeStorage;
            return _safeStorage;
        }
    } catch (_e) {
        // Not running under Electron; fall through to plaintext fallback.
    }
    return null;
}

function warnFallback(op) {
    if (_fallbackWarned) return;
    _fallbackWarned = true;
    console.warn(`[secret-storage] safeStorage unavailable (${op}); secrets will be stored in PLAINTEXT. ` +
        `This is expected outside Electron, but in production the addon should always run inside Electron.`);
}

/**
 * Encrypt a plaintext string. Returns input unchanged if:
 *   - input is null/undefined/empty
 *   - input already has our prefix (idempotent)
 *   - safeStorage is unavailable (logs a one-shot warning)
 */
function encryptSecret(plaintext) {
    if (plaintext == null || plaintext === '') return plaintext;
    if (typeof plaintext !== 'string') return plaintext;
    if (plaintext.startsWith(PREFIX)) return plaintext;
    const ss = getSafeStorage();
    if (!ss) {
        warnFallback('encrypt');
        return plaintext;
    }
    try {
        const buf = ss.encryptString(plaintext);
        return PREFIX + buf.toString('base64');
    } catch (e) {
        console.warn('[secret-storage] encryptString failed, storing plaintext:', e.message);
        return plaintext;
    }
}

/**
 * Decrypt a value previously produced by `encryptSecret`.
 * Returns the input unchanged if it lacks our prefix (legacy plaintext).
 * Returns empty string if decryption fails (corrupted ciphertext).
 */
function decryptSecret(value) {
    if (value == null || value === '') return value;
    if (typeof value !== 'string') return value;
    if (!value.startsWith(PREFIX)) return value;
    const ss = getSafeStorage();
    if (!ss) {
        warnFallback('decrypt');
        // We have ciphertext but no key. Return empty so the caller treats it as
        // missing rather than sending garbage to an API.
        return '';
    }
    try {
        const buf = Buffer.from(value.slice(PREFIX.length), 'base64');
        return ss.decryptString(buf);
    } catch (e) {
        console.warn('[secret-storage] decryptString failed:', e.message);
        return '';
    }
}

function isEncrypted(value) {
    return typeof value === 'string' && value.startsWith(PREFIX);
}

/**
 * Whether the encryption layer is actually usable in the current process.
 * Useful in startup logs ("DPAPI: ON").
 */
function isAvailable() {
    return !!getSafeStorage();
}

module.exports = {
    encryptSecret,
    decryptSecret,
    isEncrypted,
    isAvailable,
    PREFIX,
};
