/**
 * Shared helper for re-fetching a user's *unredacted* DynamoDB record before
 * any write that mutates the `text` blob.
 *
 * `req.user` (set by authMiddleware) intentionally carries a redacted `text`
 * where `|Password:<hash>` has been replaced with `|Password:[redacted]`
 * (see sanitizeUserText.js). Building a write payload from that redacted text
 * would PERMANENTLY overwrite the user's real bcrypt hash and lock them out
 * of their account. Callers MUST re-fetch the raw record via this helper and
 * write THAT back instead.
 *
 * The `Simple` table's primary key is composite (`id` partition key +
 * `createdAt` sort key) for most item types, so a plain GetCommand keyed on
 * `id` alone throws a ValidationException; fall back to a Query on the
 * partition key alone.
 */

const { GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

/**
 * Fetch the raw (unredacted) user record by primary key.
 * @param {import('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient} dynamodb
 * @param {string} userId
 * @returns {Promise<Object|null>} Raw DynamoDB item, or null if not found.
 */
async function fetchRawUserRecord(dynamodb, userId) {
    const TableName = 'Simple';
    const key = String(userId);

    try {
        const result = await dynamodb.send(new GetCommand({ TableName, Key: { id: key } }));
        if (result.Item) return result.Item;
    } catch (error) {
        // Expected when the table's key schema includes a sort key — fall through.
    }

    try {
        const result = await dynamodb.send(new QueryCommand({
            TableName,
            KeyConditionExpression: 'id = :id',
            ExpressionAttributeValues: { ':id': key },
            Limit: 1,
        }));
        return (result.Items && result.Items[0]) || null;
    } catch (error) {
        return null;
    }
}

module.exports = { fetchRawUserRecord };
