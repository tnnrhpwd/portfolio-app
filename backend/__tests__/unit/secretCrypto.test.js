/**
 * secretCrypto.test.js — secrets encrypted at rest in DynamoDB.
 *
 * The properties that matter: a round trip works, plaintext/legacy rows pass
 * through untouched, a tampered or foreign blob is rejected rather than
 * returning garbage, and — the one that bit us in production — switching
 * `SECRETS_ENCRYPTION_KEY` on does NOT make the values already stored
 * unreadable.
 */

const { encryptString, decryptString, isEncrypted } = require('../../utils/secretCrypto');

const ORIGINAL_ENV = { ...process.env };

afterAll(() => {
    process.env = ORIGINAL_ENV;
});

describe('secretCrypto', () => {
    beforeEach(() => {
        process.env.SECRETS_ENCRYPTION_KEY = 'dedicated-secret-key-for-tests';
        process.env.JWT_SECRET = 'jwt-secret-for-tests';
    });

    test('round-trips a value', () => {
        const blob = encryptString('a-secret-value');
        expect(isEncrypted(blob)).toBe(true);
        expect(decryptString(blob)).toBe('a-secret-value');
    });

    test('never stores the plaintext in the ciphertext', () => {
        const blob = encryptString('ghp_supersecrettoken');
        expect(blob).not.toContain('supersecret');
        expect(blob).toMatch(/^enc:v1:[A-Za-z0-9+/=]+$/);
    });

    test('passes empty, nullish and already-plain values through unchanged', () => {
        expect(encryptString('')).toBe('');
        expect(encryptString(null)).toBeNull();
        expect(encryptString(undefined)).toBeUndefined();
        expect(decryptString(null)).toBeNull();
        expect(decryptString(undefined)).toBeUndefined();
        // A row written before encryption was rolled out is not an error.
        expect(decryptString('not-encrypted-at-all')).toBe('not-encrypted-at-all');
    });

    test('is idempotent — re-encrypting a ciphertext leaves it alone', () => {
        const blob = encryptString('value');
        expect(encryptString(blob)).toBe(blob);
    });

    test('returns null rather than throwing on a tampered ciphertext', () => {
        const blob = encryptString('trust me');
        const raw = Buffer.from(blob.slice('enc:v1:'.length), 'base64');
        raw[raw.length - 1] ^= 0xff;
        expect(decryptString(`enc:v1:${raw.toString('base64')}`)).toBeNull();
    });

    test('throws on encrypt when no key material exists at all', () => {
        delete process.env.SECRETS_ENCRYPTION_KEY;
        delete process.env.JWT_SECRET;
        expect(() => encryptString('nope')).toThrow(/is not configured/);
    });

    // ── Rotation ────────────────────────────────────────────────────────────
    // These are the regression tests for the 2026-09-19 incident: setting
    // SECRETS_ENCRYPTION_KEY made two stored githubToken values unreadable and
    // logged "Failed to decrypt value:" with no reason on every settings read.

    test('reads values written before SECRETS_ENCRYPTION_KEY was set', () => {
        delete process.env.SECRETS_ENCRYPTION_KEY;
        const alreadyStored = encryptString('stored-before-the-rotation');

        process.env.SECRETS_ENCRYPTION_KEY = 'the-new-dedicated-key';
        expect(decryptString(alreadyStored)).toBe('stored-before-the-rotation');
    });

    test('stops depending on JWT_SECRET once a dedicated key is set', () => {
        const writtenAfterRotation = encryptString('stored-after-the-rotation');

        // Drop the dedicated key: the old derivation alone must not read what
        // the new one wrote, i.e. new values are off the JWT secret.
        delete process.env.SECRETS_ENCRYPTION_KEY;
        expect(decryptString(writtenAfterRotation)).toBeNull();
    });

    test('the fallback only reads the secret that was actually in use', () => {
        // The fallback bridges the JWT_SECRET → dedicated-key transition. It is
        // not a general "any old key works": change BOTH secrets and a value
        // written under the old pair is unrecoverable, which is the limit worth
        // knowing before a second rotation.
        process.env.SECRETS_ENCRYPTION_KEY = 'the-key-it-was-written-with';
        process.env.JWT_SECRET = 'the-jwt-secret-of-the-time';
        const stranded = encryptString('written under the old pair');

        process.env.SECRETS_ENCRYPTION_KEY = 'a-brand-new-dedicated-key';
        process.env.JWT_SECRET = 'a-brand-new-jwt-secret';
        expect(decryptString(stranded)).toBeNull();
    });

    test('still uses JWT_SECRET when no dedicated key is configured', () => {
        delete process.env.SECRETS_ENCRYPTION_KEY;
        const blob = encryptString('dev-mode-value');
        expect(decryptString(blob)).toBe('dev-mode-value');
    });
});
