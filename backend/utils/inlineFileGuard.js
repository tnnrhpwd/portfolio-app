/**
 * inlineFileGuard.js — keeps base64 (inline) attachments out of DynamoDB
 * beyond a hard cap.
 *
 * Why: a record's `files` entries may either reference an S3 object
 * (`s3Key` + `size`, ~100 bytes of DynamoDB) or carry the file bytes inline as
 * base64 (`data`, which is what the old upload path did). Inline bytes cost
 * ~10x S3 to store and inflate every Scan/Get that touches the record — the
 * Simple table's paginated scans exist partly because of them. New attachments
 * should go through the presigned S3 flow (POST /api/data/upload-url); this
 * guard bounds the legacy path so it can't be abused.
 */
const { INLINE_FILE_LIMITS } = require('../constants/upload');

/** True when this entry's bytes live in S3 (so it isn't an inline payload). */
function isS3Backed(file) {
    return Boolean(file && file.s3Key && (file.size || file.publicUrl || file.cloudFrontUrl || file.s3Url));
}

/** Approximate decoded byte size of a single inline entry. */
function inlineBytesOf(file) {
    if (!file || isS3Backed(file)) return 0;
    if (typeof file.data !== 'string') return 0;
    // base64 encodes 3 bytes into 4 chars.
    return Math.floor(Buffer.byteLength(file.data, 'utf8') * 0.75);
}

/** Total inline (base64) bytes across a record's file entries. */
function inlineFileBytes(files) {
    if (!Array.isArray(files)) return 0;
    return files.reduce((sum, f) => sum + inlineBytesOf(f), 0);
}

/**
 * Throw a 413 when inline attachments exceed the per-file or per-record cap.
 * S3-backed entries are ignored.
 * @param {Array} files - the record's `files` array
 * @returns {number} the inline byte total (0 when all entries are S3-backed)
 */
function assertInlineFilesWithinLimits(files) {
    if (!Array.isArray(files) || files.length === 0) return 0;

    const perFile = INLINE_FILE_LIMITS.MAX_INLINE_FILE_BYTES;
    const total = INLINE_FILE_LIMITS.MAX_INLINE_TOTAL_BYTES;

    for (const f of files) {
        const bytes = inlineBytesOf(f);
        if (bytes > perFile) {
            const err = new Error(
                `Attachment "${f.filename || f.fileName || 'file'}" is too large to store inline ` +
                `(${Math.round(bytes / 1024)}KB, limit ${Math.round(perFile / 1024)}KB). ` +
                'Upload it via POST /api/data/upload-url instead.'
            );
            err.statusCode = 413;
            throw err;
        }
    }

    const totalBytes = inlineFileBytes(files);
    if (totalBytes > total) {
        const err = new Error(
            `Attachments are too large to store inline (${Math.round(totalBytes / 1024)}KB, ` +
            `limit ${Math.round(total / 1024)}KB). Upload them via POST /api/data/upload-url instead.`
        );
        err.statusCode = 413;
        throw err;
    }

    return totalBytes;
}

module.exports = { isS3Backed, inlineBytesOf, inlineFileBytes, assertInlineFilesWithinLimits };
