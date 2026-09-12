/**
 * paginatedScan.js — one DynamoDB Scan that actually reaches the whole table.
 *
 * The trap this exists for: a single `ScanCommand` examines at most 1 MB and
 * then hands back a `LastEvaluatedKey` for the rest. Ignoring that key is
 * silent — no error, no "partial results" flag, just *fewer rows than exist*.
 * With a `FilterExpression` it is worse, because the filter is applied only
 * within the scanned page, so a filter that should match a few rows somewhere in
 * the table can come back empty instead.
 *
 * The `Simple` table has been several megabytes for a while (thousands of rows,
 * many carrying base64 blobs), so an unpaginated scan is a live bug, not a
 * theoretical one — it has already caused "no saved games yet" after a
 * successful save, under-reported storage usage (a quota bypass), and searches
 * that returned nothing for rows past the first page.
 *
 * Why it lives here: this exact helper had been copy-pasted into six modules,
 * each carrying its own paragraph explaining the same mistake. Reusing it by
 * copying it is how a seventh copy gets written, so it is now a module the
 * callers import.
 *
 * Bounded on purpose. `MAX_SCAN_PAGES` (env `SCAN_MAX_PAGES`, default 200) stops
 * a runaway scan on a table that has grown unexpectedly: a scan is billed per MB
 * read and this sits on request-handler paths. Hitting the cap is logged at
 * warn — a partial result must never look like a complete one.
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { logger } = require('./logger');

const client = new DynamoDBClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

const dynamodb = DynamoDBDocumentClient.from(client);

const DEFAULT_MAX_SCAN_PAGES = 200;

function maxScanPages() {
    const raw = parseInt(process.env.SCAN_MAX_PAGES, 10);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_SCAN_PAGES;
}

/**
 * Run a Scan to completion, returning every matching item.
 *
 * @param {Object} params Scan params, *without* `ExclusiveStartKey` (this
 *   function owns the cursor).
 * @param {Object} [options]
 * @param {number} [options.maxPages] Override the page cap for this call.
 * @param {Object} [options.client] Doc-client to use instead of this module's
 *   own — for callers that inject their client (llmService,
 *   workspaceContext) rather than importing one.
 * @returns {Promise<Array>} All matching items, in scan order
 */
async function paginatedScan(params, options = {}) {
    const maxPages = Number.isFinite(options.maxPages) && options.maxPages > 0
        ? options.maxPages
        : maxScanPages();
    const db = options.client || dynamodb;

    const items = [];
    let lastKey;
    let pages = 0;

    do {
        // The cursor is only present from the second call on — passing
        // `ExclusiveStartKey: undefined` also works, but omitting it keeps the
        // first request identical to a plain single-page scan.
        const page = await db.send(new ScanCommand({
            ...params,
            ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
        }));

        items.push(...(page.Items || []));
        lastKey = page.LastEvaluatedKey;
        pages += 1;
    } while (lastKey && pages < maxPages);

    if (lastKey) {
        logger.warn(
            `[paginatedScan] Stopped after ${pages} pages without reaching the end of `
            + `"${params?.TableName}" — results are INCOMPLETE. Raise SCAN_MAX_PAGES if this is expected.`
        );
    }

    return items;
}

module.exports = { paginatedScan, DEFAULT_MAX_SCAN_PAGES, maxScanPages };
