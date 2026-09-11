/**
 * upload.js — single source of truth for upload limits and allowed types.
 *
 * Three consumers read this, so the numbers can't drift:
 *   1. services/s3Service.js                       — validation on the presigned path
 *   2. controllers/fileUploadController.js         — GET /api/data/upload-config,
 *      which the frontend fetches so its pre-check matches the server
 *   3. services/dataService.js + controllers/postData.js — inline (base64) caps
 *
 * Env overrides still win for the presigned path (ALLOWED_FILE_TYPES,
 * MAX_FILE_SIZE) so an operator can widen/narrow without a deploy.
 */

/**
 * Content types the upload UI offers. Keep in step with EXTENSION_CONTENT_TYPES.
 */
const ALLOWED_FILE_TYPES = Object.freeze([
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf',
    'text/plain', 'text/csv', 'application/json',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

/**
 * extension → canonical content type. Defence-in-depth: the client supplies
 * `contentType`, so a mismatch (e.g. an .html relabelled as image/png) is
 * rejected rather than trusted.
 */
const EXTENSION_CONTENT_TYPES = Object.freeze({
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    pdf: 'application/pdf',
    txt: 'text/plain',
    csv: 'text/csv',
    json: 'application/json',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
});

/** Extensions never allowed on the presigned path, regardless of content type. */
const BLOCKED_EXTENSIONS = Object.freeze([
    'html', 'htm', 'svg', 'js', 'mjs', 'exe', 'dll', 'bat', 'cmd',
    'sh', 'php', 'asp', 'jsp', 'xml', 'xhtml',
]);

/** Largest single object accepted on the presigned S3 path. */
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

/**
 * Inline (base64-in-DynamoDB) attachments. DynamoDB storage costs ~10x S3 and
 * base64 blobs bloat every Scan/Get, so inline attachments are capped hard.
 * Anything larger must go through the presigned S3 flow.
 */
const INLINE_FILE_LIMITS = Object.freeze({
    MAX_INLINE_FILE_BYTES: 300 * 1024,  // 300 KB per file
    MAX_INLINE_TOTAL_BYTES: 350 * 1024, // 350 KB per record
});

/** Resolve the effective allow-list, honoring the env override. */
function resolveAllowedFileTypes() {
    return process.env.ALLOWED_FILE_TYPES
        ? process.env.ALLOWED_FILE_TYPES.split(',').map((t) => t.trim()).filter(Boolean)
        : [...ALLOWED_FILE_TYPES];
}

/** Resolve the effective max file size, honoring the env override. */
function resolveMaxFileBytes() {
    const raw = parseInt(process.env.MAX_FILE_SIZE, 10);
    return Number.isFinite(raw) && raw > 0 ? raw : MAX_FILE_BYTES;
}

module.exports = {
    ALLOWED_FILE_TYPES,
    EXTENSION_CONTENT_TYPES,
    BLOCKED_EXTENSIONS,
    MAX_FILE_BYTES,
    INLINE_FILE_LIMITS,
    resolveAllowedFileTypes,
    resolveMaxFileBytes,
};
