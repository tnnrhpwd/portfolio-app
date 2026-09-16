/**
 * storageRecords.js — keep the `files` array of a storage row in step with what
 * is actually in S3.
 *
 * `getUserStorageUsage()` counts bytes by summing `files[].size` over the
 * caller's rows. So deleting an object from S3 without dropping its entry leaves
 * those bytes on the user's quota **forever** — the object is gone, the bill is
 * not. Three callers write these rows (`netTools.generate_image`, the cover
 * upload, and the vision-board generator) and they do not agree on their shape:
 * two store `{ filename, contentType, size }` while the newest also stores
 * `s3Key`. The delete path used to filter on `file.s3Key` alone, which silently
 * matched nothing for the first two — the files array came back unchanged and the
 * bytes kept counting.
 *
 * Hence one helper that matches a file entry by `s3Key` **or** by the basename of
 * the key (`filename`), so it works for every shape written so far, and so the
 * next writer only has to be careful about one thing instead of three.
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
    DynamoDBDocumentClient, QueryCommand, UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');
const { logger } = require('./logger');

const TABLE_NAME = 'Simple';

const client = new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});
const dynamodb = DynamoDBDocumentClient.from(client);

/** Read one row by partition key (the table's key is composite: id + createdAt). */
async function findRowById(id) {
    if (!id) return null;
    const result = await dynamodb.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'id = :id',
        ExpressionAttributeValues: { ':id': id },
        Limit: 1,
    }));
    return (result.Items && result.Items[0]) || null;
}

/** The creator id inside a row's `text` ("Creator:<id>|..."), or null. */
function creatorIdOf(item) {
    const match = String(item?.text || '').match(/(?:^|\|)Creator:([^|]+)/);
    return match ? match[1].trim() : null;
}

/** Basename of an S3 key — what the earlier writers stored as `filename`. */
function keyBasename(s3Key) {
    return String(s3Key || '').split('/').pop();
}

/**
 * Does this `files` entry describe the object at `s3Key`?
 *
 * Exported because "which entry is this object" is the whole bug, and it deserves
 * to be asserted directly rather than inferred from a row that changed.
 */
function fileEntryMatches(file, s3Key) {
    if (!file) return false;
    if (file.s3Key) return file.s3Key === s3Key;
    return Boolean(file.filename) && file.filename === keyBasename(s3Key);
}

/**
 * Drop one file from a storage row and return how many entries went.
 *
 * Best-effort and quiet by design: this runs *after* the object is already gone,
 * so a failure here is an accounting wrinkle, never a reason to fail a delete the
 * user asked for. Callers invalidate the usage cache themselves.
 *
 * @param {string} recordId - Storage row id (may be null for older records)
 * @param {string} s3Key    - Key of the deleted object
 * @param {string} userId   - Caller, checked against the row's `Creator:` tag
 * @returns {Promise<{removed: number, skipped: string|null}>}
 */
async function removeRecordedFile(recordId, s3Key, userId) {
    if (!recordId || !s3Key) return { removed: 0, skipped: 'no-record' };

    const row = await findRowById(recordId);
    if (!row) return { removed: 0, skipped: 'missing-row' };

    // The row's own creator tag has to be the caller's: an id is guessable in a
    // way an S3 key prefix is not, so this is the ownership check that matters.
    const owner = creatorIdOf(row);
    if (owner && userId && owner !== userId) return { removed: 0, skipped: 'not-yours' };

    const files = Array.isArray(row.files) ? row.files : [];
    const kept = files.filter((file) => !fileEntryMatches(file, s3Key));
    const removed = files.length - kept.length;
    if (!removed) return { removed: 0, skipped: 'no-entry' };

    await dynamodb.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { id: row.id, createdAt: row.createdAt },
        UpdateExpression: 'SET files = :files, updatedAt = :now',
        ExpressionAttributeValues: {
            ':files': kept,
            ':now': new Date().toISOString(),
        },
    }));
    logger.debug(`[storage] dropped ${removed} file entr${removed === 1 ? 'y' : 'ies'} from ${recordId}`);
    return { removed, skipped: null };
}

module.exports = {
    fileEntryMatches,
    keyBasename,
    creatorIdOf,
    findRowById,
    removeRecordedFile,
};
