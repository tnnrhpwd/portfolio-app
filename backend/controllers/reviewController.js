/**
 * reviewController.js — let a signed-in user read and edit their own reviews.
 *
 * How a review is stored
 * ----------------------
 * A review is a *public* row in the `Simple` table created through
 * `POST /api/data/public` (no account needed — the review tab is open to
 * visitors). Its fields all live in the pipe-delimited `text` blob:
 *
 *   Review:<title>|Category:<cat>|Rating:<n>/5|Content:<body>|User:<email>|Timestamp:<iso>
 *
 * There is deliberately **no `Creator:` segment**, because public rows are
 * written by `postData`'s public branch and the row is not tied to an account
 * id. Ownership is therefore established by the `User:<email>` segment, which
 * the original submitter wrote from `user.email`.
 *
 * ⚠️ That means these endpoints are **not** the same authorisation model as the
 * rest of `/api/data`: the generic `PUT /:id` requires `Creator:<userId>`, so it
 * 401s on every review. Anything that edits a review has to go through here,
 * where the check is "does this row's `User:` match the caller's email?".
 *
 * Edits are unlimited (the product decision) but stamped: each rewrite appends
 * `|EditedAt:<iso>` so the admin Reviews view can show that a review changed
 * after publication.
 */

const asyncHandler = require('express-async-handler');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
    DynamoDBDocumentClient,
    GetCommand,
    PutCommand,
    DeleteCommand,
} = require('@aws-sdk/lib-dynamodb');
const { checkIP } = require('../utils/accessData.js');
const { logger } = require('../utils/logger');
const { paginatedScan } = require('../utils/paginatedScan');
const { readEmail } = require('../utils/userIdentity');

const client = new DynamoDBClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

const dynamodb = DynamoDBDocumentClient.from(client);

const TABLE = 'Simple';

/**
 * Throw a 4xx the shared error middleware will pass through verbatim.
 *
 * `res.status(code)` alone works too (the middleware reads res.statusCode), but
 * the status then lives only on the response object — a thrown error with the
 * code on it is what the service layer and the messenger endpoints do, and it is
 * what the tests can assert against.
 */
function fail(statusCode, message) {
    throw Object.assign(new Error(message), { statusCode });
}

// Field limits mirror the Support form's own `maxLength` attributes, so the
// client can't submit something the server then silently truncates.
const LIMITS = {
    titleMax: 100,
    contentMax: 1000,
    categoryMax: 32,
    ratingMin: 1,
    ratingMax: 5,
    listMax: 50,
};

// The categories the Support review form offers. Anything else is a hand-rolled
// payload; `general` is the safe landing spot rather than a 400, because the
// category is cosmetic and a rejected review is a lost review.
const CATEGORIES = new Set([
    'general', 'usability', 'performance', 'features', 'design', 'support',
]);

/**
 * A `|` would end the segment early and corrupt every reader that splits the
 * blob on `|` (the admin Reviews table, `pull-support-tickets.js`). Newlines
 * would do the same to anything that writes the blob to a JSONL log, so both
 * are replaced with a visually equivalent glyph instead of rejecting the post.
 */
const sanitizeSegment = (value, max) =>
    String(value ?? '')
        .replace(/\|/g, '/')
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max);

/** Parse a review's `text` blob into its parts. */
function parseReviewText(text = '') {
    const read = (key) => {
        const match = text.match(new RegExp(`(?:^|\\|)${key}:([^|]*)`));
        return match ? match[1].trim() : '';
    };
    const ratingRaw = read('Rating');            // "4/5"
    const rating = parseInt(ratingRaw, 10);
    return {
        title: read('Review'),
        category: read('Category') || 'general',
        rating: Number.isInteger(rating) ? rating : 0,
        content: read('Content'),
        user: read('User').toLowerCase(),
        timestamp: read('Timestamp'),
        editedAt: read('EditedAt'),
    };
}

/** Build the blob in the exact segment order the existing readers expect. */
function buildReviewText({ title, category, rating, content, user, timestamp, editedAt }) {
    const segments = [
        `Review:${title}`,
        `Category:${category}`,
        `Rating:${rating}/5`,
        `Content:${content}`,
        `User:${user}`,
        `Timestamp:${timestamp}`,
    ];
    if (editedAt) segments.push(`EditedAt:${editedAt}`);
    return segments.join('|');
}

/** Validate + normalise the body shared by the (future) create and edit paths. */
function normalizeReviewBody(body = {}) {
    const title = sanitizeSegment(body.title ?? body.reviewTitle, LIMITS.titleMax);
    const content = sanitizeSegment(body.content ?? body.reviewContent, LIMITS.contentMax);
    const rawCategory = String(body.category ?? body.reviewCategory ?? 'general').trim().toLowerCase();
    const category = CATEGORIES.has(rawCategory) ? rawCategory : 'general';
    const rating = Number(body.rating ?? body.reviewRating);

    if (!title) throw Object.assign(new Error('A review title is required'), { statusCode: 400 });
    if (!content) throw Object.assign(new Error('Review text is required'), { statusCode: 400 });
    if (!Number.isInteger(rating) || rating < LIMITS.ratingMin || rating > LIMITS.ratingMax) {
        throw Object.assign(
            new Error(`Rating must be a whole number between ${LIMITS.ratingMin} and ${LIMITS.ratingMax}`),
            { statusCode: 400 }
        );
    }

    return { title, category, rating, content };
}

/** Shape returned to the client — never the raw blob. */
const toReview = (item) => {
    const parsed = parseReviewText(item.text);
    return {
        id: item.id,
        title: parsed.title,
        category: parsed.category,
        rating: parsed.rating,
        content: parsed.content,
        user: parsed.user,
        createdAt: parsed.timestamp || item.createdAt,
        updatedAt: item.updatedAt || parsed.timestamp || item.createdAt,
        editedAt: parsed.editedAt || null,
        edited: Boolean(parsed.editedAt),
    };
};

/**
 * Find one review row by id.
 *
 * A `GetCommand` would need the sort key, which these public rows do have
 * (`createdAt`) but which the client doesn't send — and the generic
 * `putHashData` already reads items by scanning on `id`, so this follows the
 * same convention rather than inventing a second one.
 */
async function findReviewById(id) {
    const items = await paginatedScan({
        TableName: TABLE,
        FilterExpression: '#id = :id',
        ExpressionAttributeNames: { '#id': 'id' },
        ExpressionAttributeValues: { ':id': String(id) },
    });
    return items[0] || null;
}

/**
 * Confirm the caller owns this row.
 *
 * Returns the caller's email on success. An anonymous submitter (`User:Anonymous`)
 * can never be edited — there is no way to prove who they were, so the row stays
 * read-only. That is a deliberate trade-off, not an oversight.
 */
function assertOwnership(item, req) {
    const email = readEmail(req.user);
    const parsed = parseReviewText(item.text);
    if (!email || !parsed.user || parsed.user !== email) {
        fail(403, 'This review belongs to another account');
    }
    return email;
}

// @desc    List the caller's own reviews
// @route   GET /api/data/reviews/mine
// @access  Private
const listMyReviews = asyncHandler(async (req, res) => {
    await checkIP(req);

    const email = readEmail(req.user);
    if (!email) {
        fail(401, 'User not found');
    }

    // Pre-filter on the `User:<email>` segment (cheap, case-sensitive) and then
    // confirm case-insensitively — the same two-step the registration duplicate
    // check uses, because a `contains` filter can't ignore case.
    const items = await paginatedScan({
        TableName: TABLE,
        FilterExpression: 'contains(#text, :marker) AND contains(#text, :user)',
        ExpressionAttributeNames: { '#text': 'text' },
        ExpressionAttributeValues: {
            ':marker': 'Review:',
            ':user': `User:${email}`,
        },
    });

    const reviews = items
        .filter((item) => parseReviewText(item.text).user === email)
        .map(toReview)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .slice(0, LIMITS.listMax);

    res.status(200).json({ success: true, reviews });
});

// @desc    Edit one of the caller's own reviews
// @route   PUT /api/data/reviews/:id
// @access  Private (must be the review's author)
const updateMyReview = asyncHandler(async (req, res) => {
    await checkIP(req);

    const item = await findReviewById(req.params.id);
    if (!item) {
        fail(404, 'Review not found');
    }

    assertOwnership(item, req);

    const next = normalizeReviewBody(req.body);
    const existing = parseReviewText(item.text);
    const now = new Date().toISOString();

    const updated = {
        ...item,
        text: buildReviewText({
            ...next,
            // Keep the original author + submission time: an edit is a change to
            // a review, not a new one, and the admin view sorts by both.
            user: existing.user,
            timestamp: existing.timestamp || item.createdAt || now,
            editedAt: now,
        }),
        updatedAt: now,
    };

    await dynamodb.send(new PutCommand({ TableName: TABLE, Item: updated }));

    logger.info('Review updated', { id: item.id, user: existing.user });
    res.status(200).json({ success: true, review: toReview(updated) });
});

// @desc    Delete one of the caller's own reviews
// @route   DELETE /api/data/reviews/:id
// @access  Private (must be the review's author)
const deleteMyReview = asyncHandler(async (req, res) => {
    await checkIP(req);

    const item = await findReviewById(req.params.id);
    if (!item) {
        fail(404, 'Review not found');
    }

    assertOwnership(item, req);

    // The table's key is composite (id + createdAt), so the sort key has to come
    // off the row we just read — a delete by `id` alone throws
    // ValidationException "The provided key element does not match the schema".
    await dynamodb.send(new DeleteCommand({
        TableName: TABLE,
        Key: { id: String(item.id), createdAt: item.createdAt },
    }));

    logger.info('Review deleted', { id: item.id });
    res.status(200).json({ success: true, id: item.id });
});

module.exports = {
    LIMITS,
    CATEGORIES,
    parseReviewText,
    buildReviewText,
    normalizeReviewBody,
    listMyReviews,
    updateMyReview,
    deleteMyReview,
};
