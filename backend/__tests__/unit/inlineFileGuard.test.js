/**
 * inlineFileGuard.test.js — the cap that keeps base64 attachments out of
 * DynamoDB. DynamoDB storage costs ~10x S3, so this guard is the cost
 * backstop for the legacy inline path.
 */
const {
    isS3Backed,
    inlineBytesOf,
    inlineFileBytes,
    assertInlineFilesWithinLimits,
} = require('../../utils/inlineFileGuard');
const { INLINE_FILE_LIMITS } = require('../../constants/upload');

const base64Of = (bytes) => Buffer.alloc(bytes, 65).toString('base64');

describe('inlineFileGuard', () => {
    test('treats an entry with s3Key + size as S3-backed', () => {
        expect(isS3Backed({ s3Key: 'users/u/x.png', size: 1234 })).toBe(true);
        expect(inlineBytesOf({ s3Key: 'users/u/x.png', size: 1234 })).toBe(0);
    });

    test('treats a bare base64 entry as inline', () => {
        // 999 bytes → 1332 base64 chars → exactly 999 back at *0.75.
        const file = { filename: 'a.txt', contentType: 'text/plain', data: base64Of(999) };
        expect(isS3Backed(file)).toBe(false);
        expect(inlineBytesOf(file)).toBe(999);
    });

    test('sums only the inline entries', () => {
        const files = [
            { s3Key: 'k', size: 10_000_000 },
            { data: base64Of(999) },
        ];
        expect(inlineFileBytes(files)).toBe(999);
    });

    test('allows attachments within the cap', () => {
        const files = [{ data: base64Of(999) }];
        expect(() => assertInlineFilesWithinLimits(files)).not.toThrow();
        expect(assertInlineFilesWithinLimits(files)).toBe(999);
    });

    test('rejects a single file over the per-file cap with 413', () => {
        const files = [{ filename: 'big.bin', data: base64Of(INLINE_FILE_LIMITS.MAX_INLINE_FILE_BYTES + 1000) }];
        try {
            assertInlineFilesWithinLimits(files);
            throw new Error('expected assertInlineFilesWithinLimits to throw');
        } catch (err) {
            expect(err.statusCode).toBe(413);
            expect(err.message).toMatch(/too large to store inline/);
        }
    });

    test('rejects a set of files over the total cap with 413', () => {
        const perFile = INLINE_FILE_LIMITS.MAX_INLINE_FILE_BYTES - 1024;
        const files = [
            { data: base64Of(perFile) },
            { data: base64Of(perFile) },
        ];
        expect(() => assertInlineFilesWithinLimits(files)).toThrow(/too large to store inline/);
    });

    test('ignores S3-backed attachments entirely', () => {
        const files = [
            { s3Key: 'users/u/a.png', size: 5_000_000 },
            { s3Key: 'users/u/b.pdf', size: 5_000_000 },
        ];
        expect(() => assertInlineFilesWithinLimits(files)).not.toThrow();
        expect(assertInlineFilesWithinLimits(files)).toBe(0);
    });

    test('handles missing/empty input', () => {
        expect(inlineFileBytes(undefined)).toBe(0);
        expect(assertInlineFilesWithinLimits([])).toBe(0);
        expect(assertInlineFilesWithinLimits(undefined)).toBe(0);
    });
});
