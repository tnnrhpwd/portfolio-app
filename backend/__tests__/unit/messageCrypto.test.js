/**
 * messageCrypto.test.js — the messenger's at-rest encryption.
 *
 * These are the properties that actually matter for the product decision
 * ("encrypted in transit + at rest, server holds the key"): a round trip works,
 * a tampered or foreign blob is rejected rather than silently accepted, and the
 * ciphertext never contains the plaintext.
 */

const { encrypt, decrypt, isEncrypted, _resetKeyCache } = require('../../services/messageCrypto');

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
    process.env.MESSAGE_ENCRYPTION_KEY = 'test-key-that-is-long-enough-to-be-a-secret';
    delete process.env.JWT_SECRET;
    _resetKeyCache();
});

afterAll(() => {
    process.env = ORIGINAL_ENV;
});

describe('messageCrypto', () => {
    test('round-trips a message', () => {
        const blob = encrypt('hello there', 'conv-1');
        expect(isEncrypted(blob)).toBe(true);
        expect(decrypt(blob, 'conv-1')).toBe('hello there');
    });

    test('never stores the plaintext in the blob', () => {
        const secret = 'the eagle lands at midnight';
        const blob = encrypt(secret, 'conv-1');
        expect(blob).not.toContain('eagle');
        expect(blob).not.toContain(secret);
        // base64url only — no separators or padding that would break a `|`-split
        expect(blob).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/);
    });

    test('round-trips unicode and empty strings', () => {
        expect(decrypt(encrypt('héllo 🌍 — ✓', 'c'), 'c')).toBe('héllo 🌍 — ✓');
        expect(decrypt(encrypt('', 'c'), 'c')).toBe('');
    });

    test('the same plaintext encrypts differently every time (random IV)', () => {
        expect(encrypt('same', 'c')).not.toBe(encrypt('same', 'c'));
    });

    test('rejects a blob moved to another conversation (AAD is bound in)', () => {
        const blob = encrypt('for conversation A only', 'conv-a');
        expect(decrypt(blob, 'conv-b')).toBeNull();
        expect(decrypt(blob, 'conv-a')).toBe('for conversation A only');
    });

    test('rejects tampered ciphertext rather than returning garbage', () => {
        const blob = encrypt('trust me', 'c');
        const [version, iv, tag, data] = blob.split('.');
        const flipped = Buffer.from(data, 'base64url');
        flipped[0] ^= 0xff;
        expect(decrypt([version, iv, tag, flipped.toString('base64url')].join('.'), 'c')).toBeNull();
    });

    test('returns null for values that were never encrypted', () => {
        expect(decrypt('plain text', 'c')).toBeNull();
        expect(decrypt(null, 'c')).toBeNull();
        expect(decrypt(undefined, 'c')).toBeNull();
    });

    test('falls back to JWT_SECRET when no dedicated key is set', () => {
        delete process.env.MESSAGE_ENCRYPTION_KEY;
        process.env.JWT_SECRET = 'a-jwt-secret';
        _resetKeyCache();
        const blob = encrypt('fallback works', 'c');
        expect(decrypt(blob, 'c')).toBe('fallback works');
    });

    test('throws a clear error when no key material exists at all', () => {
        delete process.env.MESSAGE_ENCRYPTION_KEY;
        delete process.env.JWT_SECRET;
        _resetKeyCache();
        expect(() => encrypt('nope', 'c')).toThrow(/No encryption key available/);
    });
});
