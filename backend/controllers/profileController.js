/**
 * Profile controller — lets a signed-in user update their own account record.
 *
 * How user rows are shaped
 * ------------------------
 * Account rows in the `Simple` table keep their fields in a pipe-delimited
 * `text` blob: `Nickname:x|Email:x|Password:HASH|Birth:x|stripeid:x`. Nickname
 * and email therefore live *inside* that blob, while the profile picture is
 * stored as a separate top-level attribute (`profilePicture`). Keeping the
 * image out of the blob matters: the blob is re-parsed all over the codebase
 * (login, admin, home-title, bug reports) and a base64 image inside it would
 * bloat every one of those reads and break their `indexOf('|Email:')` slicing.
 *
 * The picture itself is a compressed square JPEG data URL baked on the client
 * (see `components/ProfilePicture/ProfilePictureEditor.jsx`), so no S3 round
 * trip is needed and the image syncs across a user's devices with the record.
 */

const asyncHandler = require('express-async-handler');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, ScanCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { checkIP } = require('../utils/accessData.js');
const { logger } = require('../utils/logger');
const { invalidateUserCache } = require('../middleware/authMiddleware');
const { GUEST_EMAIL } = require('../constants/guestAccount.js');

// Configure AWS DynamoDB Client
const client = new DynamoDBClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const dynamodb = DynamoDBDocumentClient.from(client);

// Hard ceiling for the stored data URL. The client bakes a 512px JPEG (usually
// 20–80 KB) so this only ever rejects hand-crafted payloads. DynamoDB items
// cap at 400 KB and the rest of a user row is tiny, so ~250 KB is safe.
const MAX_PICTURE_CHARS = 250000;
const PICTURE_DATA_URL_RE = /^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/;
const EMAIL_RE = /^[^\s@|]{1,100}@[^\s@|]+\.[^\s@|]{2,}$/;
// Matches the registration rules (letters, numbers, underscore, hyphen) plus
// spaces/dots so a display name like "Sam H." is allowed.
const NICKNAME_RE = /^[a-zA-Z0-9 _.-]{2,40}$/;

/**
 * Run a DynamoDB Scan with full pagination (utils/paginatedScan.js).
 * A single ScanCommand only covers up to 1MB, silently skipping rows beyond
 * that boundary — unacceptable for a duplicate check.
 */
const { paginatedScan } = require('../utils/paginatedScan');

/**
 * Resolve the *raw* user item (password hash intact).
 *
 * `protect` attaches a redacted copy to `req.user`, so the hash can't be read
 * from there — and rewriting the record without it would lock the user out.
 * The table's composite key is (id, createdAt), so prefer a direct GetItem and
 * fall back to a Scan for legacy rows that never got a `createdAt`.
 */
const getRawUserItem = async (user) => {
    if (user?.createdAt) {
        try {
            const result = await dynamodb.send(new GetCommand({
                TableName: 'Simple',
                Key: { id: String(user.id), createdAt: user.createdAt },
            }));
            if (result.Item) return result.Item;
        } catch (error) {
            logger.debug('profileController: GetItem by composite key failed, falling back to scan', {
                error: error.message,
            });
        }
    }

    const rows = await paginatedScan({
        TableName: 'Simple',
        FilterExpression: 'id = :id AND contains(#text, :marker)',
        ExpressionAttributeNames: { '#text': 'text' },
        ExpressionAttributeValues: { ':id': String(user.id), ':marker': 'Email:' },
    });
    return rows[0] || null;
};

const readUserTextFields = (text = '') => ({
    nickname: (text.match(/Nickname:([^|]*)/) || [])[1]?.trim() || '',
    email: (text.match(/(?:^|\|)Email:([^|]*)/) || [])[1]?.trim() || '',
});

// @desc    Update the caller's own profile (nickname, email, profile picture)
// @route   PUT /api/data/profile
// @access  Private
const updateProfile = asyncHandler(async (req, res) => {
    await checkIP(req);

    if (!req.user) {
        res.status(401);
        throw new Error('User not found');
    }

    const body = req.body || {};
    const hasNickname = Object.prototype.hasOwnProperty.call(body, 'nickname');
    const hasEmail = Object.prototype.hasOwnProperty.call(body, 'email');
    const hasPicture = Object.prototype.hasOwnProperty.call(body, 'profilePicture');

    if (!hasNickname && !hasEmail && !hasPicture) {
        res.status(400);
        throw new Error('Nothing to update');
    }

    const item = await getRawUserItem(req.user);
    if (!item) {
        res.status(404);
        throw new Error('Account record not found');
    }

    const current = readUserTextFields(item.text);

    // The public demo account is shared — one visitor must not be able to
    // rename or deface it for everyone else.
    if ((current.email || '').toLowerCase() === GUEST_EMAIL.toLowerCase()) {
        res.status(403);
        throw new Error('The public guest account cannot be modified.');
    }

    // ── Validate ───────────────────────────────────────────────────────────
    let nextNickname = current.nickname;
    let nextEmail = current.email;

    if (hasNickname) {
        const candidate = String(body.nickname || '').trim();
        if (!NICKNAME_RE.test(candidate)) {
            res.status(400);
            throw new Error('Profile name must be 2–40 characters (letters, numbers, spaces, _ . -).');
        }
        nextNickname = candidate;
    }

    if (hasEmail) {
        const candidate = String(body.email || '').trim().toLowerCase();
        if (!EMAIL_RE.test(candidate)) {
            res.status(400);
            throw new Error('Please enter a valid email address.');
        }
        nextEmail = candidate;
    }

    let nextPicture = hasPicture ? item.profilePicture ?? null : item.profilePicture ?? null;
    if (hasPicture) {
        const raw = body.profilePicture;
        if (raw === null || raw === '') {
            nextPicture = null;
        } else if (typeof raw !== 'string' || raw.length > MAX_PICTURE_CHARS || !PICTURE_DATA_URL_RE.test(raw)) {
            res.status(400);
            throw new Error('Profile picture must be a PNG, JPEG, or WebP image under 250 KB.');
        } else {
            nextPicture = raw;
        }
    }

    // ── Duplicate guard (only when a field actually changes) ───────────────
    const nicknameChanged = nextNickname.toLowerCase() !== (current.nickname || '').toLowerCase();
    const emailChanged = nextEmail.toLowerCase() !== (current.email || '').toLowerCase();

    if (nicknameChanged || emailChanged) {
        const filters = [];
        const values = {};
        if (emailChanged) {
            filters.push('contains(#text, :emailValue)');
            values[':emailValue'] = `Email:${nextEmail}`;
        }
        if (nicknameChanged) {
            filters.push('contains(#text, :nicknameValue)');
            values[':nicknameValue'] = `Nickname:${nextNickname}|`;
        }

        const rows = await paginatedScan({
            TableName: 'Simple',
            FilterExpression: filters.join(' OR '),
            ExpressionAttributeNames: { '#text': 'text' },
            ExpressionAttributeValues: values,
        });

        const clash = rows.find((row) => {
            if (String(row.id) === String(item.id)) return false;
            const other = readUserTextFields(row.text);
            return (emailChanged && other.email.toLowerCase() === nextEmail.toLowerCase())
                || (nicknameChanged && other.nickname.toLowerCase() === nextNickname.toLowerCase());
        });

        if (clash) {
            res.status(409);
            throw new Error('That email or profile name is already taken.');
        }
    }

    // ── Rewrite the text blob in place ─────────────────────────────────────
    // Replace only the Nickname/Email segments so Password, Birth, stripeid and
    // any fields appended later (e.g. `|Special:true`, `|Rank:Pro`) survive.
    let nextText = item.text || '';
    if (hasNickname) {
        nextText = nextText.replace(/Nickname:[^|]*/, `Nickname:${nextNickname}`);
    }
    if (hasEmail) {
        nextText = nextText.replace(/(^|\|)Email:[^|]*/, `$1Email:${nextEmail}`);
    }

    const nextItem = {
        ...item,
        text: nextText,
        profilePicture: nextPicture,
        updatedAt: new Date().toISOString(),
    };

    await dynamodb.send(new PutCommand({ TableName: 'Simple', Item: nextItem }));

    // The auth middleware caches user rows for 5 minutes — drop this user's
    // entry so the very next request sees the new nickname/picture.
    invalidateUserCache(item.id);

    logger.debug('profileController: profile updated', { userId: item.id });

    res.status(200).json({
        success: true,
        profile: {
            nickname: nextNickname,
            email: nextEmail,
            profilePicture: nextPicture,
        },
    });
});

module.exports = { updateProfile };
