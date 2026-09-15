/**
 * messengerService.js — storage for the Talk messenger (friend graph + DMs).
 *
 * Layout, and why it is shaped this way
 * -------------------------------------
 * Everything lives in the shared `Simple` table, whose key is composite —
 * partition `id` + sort `createdAt` — which is what makes a conversation
 * queryable at all:
 *
 *   msg_index_<userId>                 one row per account: the dashboard, as a
 *                                      JSON payload in `text`. Contacts, pending
 *                                      requests in both directions, the outgoing
 *                                      request log (rate limits), and cooldowns.
 *   msg_req_<toUserId>_<fromUserId>    one row per friend request (the record of
 *                                      truth for its status).
 *   msg_friend_<a>_<b>                 one row per friendship, ids sorted so the
 *                                      pair has a single canonical row. This is
 *                                      the *authorisation* check for messaging.
 *   msg_block_<a>_<b>                  one row per block, ids NOT sorted: a block
 *                                      is one-directional, so `<a>` is always the
 *                                      blocker and `<b>` the account they hid
 *                                      from. Its own row (rather than only a list
 *                                      in the blocker's index) is what lets
 *                                      `rebuildIndex` restore it.
 *   msg_msg_<convId>  (+ createdAt)    one row per message. Same partition for a
 *                                      whole conversation, so the sort key gives
 *                                      ordered reads with a `Limit` and a `since`
 *                                      cursor — no index needed.
 *
 * Bodies are encrypted with `messageCrypto` before they are stored (`body`
 * attribute) and so is the sidebar preview; `text` holds only a `|Msg:` marker
 * so the admin/data views can still recognise the row without reading it.
 *
 * The per-user index is a **cache of derived lists**, not a source of truth: the
 * friend rows authorise, and `rebuildIndex` can reconstruct a lost index from
 * them. It exists because the alternative — discovering your contacts — would
 * mean scanning the table on every page load.
 */

const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
    DynamoDBDocumentClient,
    GetCommand,
    PutCommand,
    DeleteCommand,
    QueryCommand,
    UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');
const { logger } = require('../utils/logger');
const { paginatedScan } = require('../utils/paginatedScan');
const { readNickname, isValidNicknameShape } = require('../utils/userIdentity');
const { encrypt, decrypt } = require('./messageCrypto');
const { buildAvatar, etagFor } = require('./avatarService');

const client = new DynamoDBClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});
const dynamodb = DynamoDBDocumentClient.from(client);

const TABLE = 'Simple';

// Single-item rows use the fixed sort key the rest of the codebase uses
// (`csimple_*`, home-title, purchases) so a direct GetCommand works.
const SENTINEL = '2000-01-01T00:00:00.000Z';

const KIND = {
    index: 'msgIndex',
    request: 'msgRequest',
    friend: 'msgFriend',
    block: 'msgBlock',
    message: 'msgMessage',
};

const MARKERS = {
    index: '|MsgIndex:',
    request: '|MsgRequest:',
    friend: '|MsgFriend:',
    block: '|MsgBlock:',
    message: '|Msg:',
};

/**
 * Anti-spam ceilings. These are the product's answer to "reasonable limits":
 * a new account cannot fan out requests, and a declined request cannot be
 * retried immediately.
 */
const LIMITS = {
    pendingOutMax: 20,       // outstanding requests one account may have
    requestsPerHour: 10,
    requestsPerDay: 40,
    contactsMax: 200,
    bodyMax: 4000,
    nicknameMax: 40,
    pageSize: 60,            // messages returned per read (newest N)
    requestLogMax: 300,      // remembered outgoing stamps (daily cap is 40)
    cooldownListMax: 100,
    declineCooldownMs: 7 * 24 * 60 * 60 * 1000,
    nicknameCacheTtlMs: 5 * 60 * 1000,
};

// ── Ids ─────────────────────────────────────────────────────────────────────

/** Sorted so the pair always maps to one row. User ids are hex, so this is stable. */
const sortedPair = (a, b) => [String(a), String(b)].sort();

const indexId = (userId) => `msg_index_${userId}`;
const requestId = (toUserId, fromUserId) => `msg_req_${toUserId}_${fromUserId}`;
const friendId = (a, b) => `msg_friend_${sortedPair(a, b).join('_')}`;
const messagePartition = (convId) => `msg_msg_${convId}`;

/**
 * A block's row id — deliberately **not** sorted, unlike `friendId`.
 *
 * A friendship is symmetric, so its two ids are sorted into one canonical row. A
 * block is not: "A blocked B" and "B blocked A" are different facts with different
 * consequences, and one must not be readable as the other. So the argument order
 * is the meaning — `blocker` first — and `readBlock(blocker, blocked)` is the
 * only way to ask the question.
 */
const blockId = (blockerId, blockedId) => `msg_block_${String(blockerId)}_${String(blockedId)}`;

/** Deterministic conversation id for a pair of accounts. */
const convIdFor = (a, b) =>
    crypto.createHash('sha256').update(sortedPair(a, b).join('|')).digest('hex').slice(0, 32);

/**
 * The message sort key, and why it is not just `toISOString()`.
 *
 * A message row is keyed (id = the conversation, createdAt = this value), so two
 * messages with the same sort key are the *same row* — the second silently
 * overwrites the first. Two things make a whole-millisecond ISO stamp unsafe:
 *
 *   1. `toISOString()` has millisecond resolution, and a conversation can
 *      genuinely produce two messages inside one millisecond (a paste, a
 *      double-tap, a bot).
 *   2. Even with a random tiebreaker, the ORDER of the sort key is what the
 *      conversation is read by — so random suffixes scramble messages sent in
 *      the same millisecond, not merely risk a collision.
 *
 * So there are three parts: the millisecond stamp (readable, and what orders the
 * conversation), a monotonic tail that guarantees this process never repeats or
 * goes backwards, and randomness only for the case the process counter can't
 * cover — two server instances writing in the same millisecond.
 *
 * The result is a fixed-width, lexicographically time-ordered string, which is
 * what lets a conversation be read with a `Limit` and a `since` cursor directly
 * off the sort key. `sentAt` (plain ISO, millisecond) is what the UI displays;
 * nothing parses this value as a date.
 */
let lastSortKey = '';

function messageSortKey(now = new Date()) {
    const base = now.toISOString().replace('Z', '');   // 2026-09-14T10:00:00.000
    const micros = String(crypto.randomInt(0, 1000)).padStart(3, '0');
    let key = `${base}${micros}Z-${crypto.randomBytes(3).toString('hex')}`;

    if (key <= lastSortKey) {
        // Same millisecond, and the random tail lost the toss (or an earlier
        // call already wrote this exact value): continue from the previous key
        // instead of returning something that would sort before it.
        const bumped = (parseInt(lastSortKey.slice(-6), 16) + 1) & 0xffffff;
        key = `${lastSortKey.slice(0, -6)}${bumped.toString(16).padStart(6, '0')}`;
    }

    lastSortKey = key;
    return key;
}

// ── Small helpers ───────────────────────────────────────────────────────────

const emptyIndex = () => ({
    contacts: [],
    pendingIn: [],
    pendingOut: [],
    requestLog: [],
    cooldowns: [],
    // Accounts THIS one has hidden. Never the reverse: a block is one-directional,
    // and the other side is deliberately not told, so it must not appear in their
    // index either.
    blocks: [],
});

const clone = (value) => JSON.parse(JSON.stringify(value));

const parsePayload = (text, marker) => {
    if (typeof text !== 'string' || !text.startsWith(marker)) return null;
    try {
        return JSON.parse(text.slice(marker.length));
    } catch {
        return null;
    }
};

/**
 * Trim + bound a user-supplied message body, rejecting whitespace-only input.
 *
 * The text is stored VERBATIM — deliberately not HTML-sanitized. The route does
 * not run the shared `sanitizeInput` (see the note in routes/routeData.js), because
 * it HTML-escapes plain text: a member typing "Tom & Jerry" would be stored, and
 * then displayed, as "Tom &amp; Jerry", and "5 < 6" as "5 &lt; 6". Nothing renders
 * a message as markup — React escapes text nodes at render time — so there is no
 * injection surface to close. `trim()` plus the length bound is the whole of it.
 */
function normalizeBody(raw) {
    const body = typeof raw === 'string' ? raw.trim() : '';
    if (!body) throw Object.assign(new Error('A message cannot be empty'), { statusCode: 400 });
    if (body.length > LIMITS.bodyMax) {
        throw Object.assign(new Error(`Messages must be ${LIMITS.bodyMax} characters or fewer`), { statusCode: 400 });
    }
    return body;
}

// ── User lookup by nickname ─────────────────────────────────────────────────

// nickname(lowercased) → { user, expiresAt }. A friend request does a scan;
// typing the same name twice (or a retry after a 429) shouldn't repeat it.
const nicknameCache = new Map();

/**
 * Find an account row by nickname, case-insensitively.
 *
 * Two passes, cheapest first: usernames are stored exactly as typed at signup,
 * so the common case ("they told me their handle and I typed it correctly")
 * matches an exact `contains` filter on the blob. Only when that misses do we
 * fall back to a broader scan and compare case-insensitively — which is what
 * makes `Guest User` findable as `guest user`.
 */
async function findUserByNickname(nickname) {
    const wanted = String(nickname || '').trim();
    if (!isValidNicknameShape(wanted)) return null;

    const cacheKey = wanted.toLowerCase();
    const cached = nicknameCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.user;

    const exact = await paginatedScan({
        TableName: TABLE,
        FilterExpression: 'contains(#text, :nick) AND contains(#text, :email)',
        ExpressionAttributeNames: { '#text': 'text' },
        ExpressionAttributeValues: { ':nick': `Nickname:${wanted}|`, ':email': '|Email:' },
    });

    let item = exact.find((row) => readNickname(row).toLowerCase() === cacheKey);

    if (!item) {
        const broad = await paginatedScan({
            TableName: TABLE,
            FilterExpression: 'contains(#text, :nick) AND contains(#text, :email)',
            ExpressionAttributeNames: { '#text': 'text' },
            ExpressionAttributeValues: { ':nick': 'Nickname:', ':email': '|Email:' },
        });
        item = broad.find((row) => readNickname(row).toLowerCase() === cacheKey);
    }

    const user = item || null;
    nicknameCache.set(cacheKey, { user, expiresAt: Date.now() + LIMITS.nicknameCacheTtlMs });
    return user;
}

/** Test seam. */
function _clearNicknameCache() {
    nicknameCache.clear();
}

// ── Index read / write (optimistic concurrency) ─────────────────────────────

async function readIndex(userId) {
    const result = await dynamodb.send(new GetCommand({
        TableName: TABLE,
        Key: { id: indexId(userId), createdAt: SENTINEL },
    }));
    const payload = parsePayload(result.Item?.text, MARKERS.index);
    return {
        payload: payload || emptyIndex(),
        version: Number(result.Item?.version) || 0,
        exists: Boolean(result.Item),
    };
}

/**
 * Apply `mutate` to a user's index, retrying on a lost race.
 *
 * The index is read-modify-written, and the two writers are independent: your
 * own actions, and a friend sending you a message. Without the version check a
 * message arriving while you cancel a request would silently drop one of the
 * two edits.
 */
async function updateIndex(userId, mutate, attempts = 4) {
    let lastError = null;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const current = await readIndex(userId);
        const next = mutate(clone(current.payload)) || current.payload;
        const version = current.version + 1;

        // ⚠️ The condition and its values must match. `attribute_not_exists(#v)`
        // is the FIRST write of a user's index, and it references no value — so
        // passing `:expected` alongside it made DynamoDB reject the whole write
        // with "Value provided in ExpressionAttributeValues unused in
        // expressions". That broke friend requests to any account that had never
        // opened Talk, which is the common case. The unit fake did not model that
        // validation, which is why it only showed up in the server log.
        const item = {
            id: indexId(userId),
            createdAt: SENTINEL,
            kind: KIND.index,
            version,
            text: `${MARKERS.index}${JSON.stringify(next)}`,
            updatedAt: new Date().toISOString(),
        };
        const params = {
            TableName: TABLE,
            Item: item,
            ExpressionAttributeNames: { '#v': 'version' },
        };
        if (current.exists) {
            params.ConditionExpression = '#v = :expected';
            params.ExpressionAttributeValues = { ':expected': current.version };
        } else {
            params.ConditionExpression = 'attribute_not_exists(#v)';
        }

        try {
            await dynamodb.send(new PutCommand(params));
            return next;
        } catch (error) {
            if (error.name !== 'ConditionalCheckFailedException') throw error;
            lastError = error; // someone else wrote; re-read and re-apply
            logger.debug('messenger index write raced, retrying', { userId, attempt });
        }
    }

    throw lastError || new Error('Could not update messenger state');
}

/**
 * Rebuild a missing index from the friendship and request rows.
 *
 * Only called when the index row is absent (first use, or a deleted row), so the
 * cost of the scan is paid once per account rather than per page load.
 */
async function rebuildIndex(userId, nickname) {
    const rows = await paginatedScan({
        TableName: TABLE,
        FilterExpression: '#kind = :req OR #kind = :fri OR #kind = :blk',
        ExpressionAttributeNames: { '#kind': 'kind' },
        ExpressionAttributeValues: { ':req': KIND.request, ':fri': KIND.friend, ':blk': KIND.block },
    });

    const payload = emptyIndex();
    const me = String(userId);

    for (const row of rows) {
        if (row.kind === KIND.friend) {
            const pair = parsePayload(row.text, MARKERS.friend);
            if (!pair) continue;
            if (pair.a !== me && pair.b !== me) continue;
            const peerId = pair.a === me ? pair.b : pair.a;
            payload.contacts.push({
                userId: peerId,
                nickname: pair.nicknames?.[peerId] || 'Someone',
                convId: pair.convId || convIdFor(pair.a, pair.b),
                lastAt: pair.since || row.createdAt,
                lastPreview: '',
                unread: 0,
            });
        } else if (row.kind === KIND.request) {
            const req = parsePayload(row.text, MARKERS.request);
            if (!req) continue;
            if (req.toUserId === me && req.status === 'pending') {
                payload.pendingIn.push({ userId: req.fromUserId, nickname: req.fromNickname || 'Someone', at: req.createdAt });
            } else if (req.fromUserId === me && req.status === 'pending') {
                payload.pendingOut.push({ userId: req.toUserId, nickname: req.toNickname || 'Someone', at: req.createdAt });
            }
        } else if (row.kind === KIND.block) {
            // ⚠️ `blockerId`, not "either side". A rows-from-me filter would put the
            // *blocked* account's list into my index if it were a pair, which would
            // both show them a control they must not have and hide the block from
            // the one person it belongs to.
            const block = parsePayload(row.text, MARKERS.block);
            if (!block || block.blockerId !== me) continue;
            payload.blocks.push({
                userId: String(block.blockedId),
                nickname: block.blockedNickname || 'Someone',
                at: block.at || row.createdAt,
            });
        }
        // Other accounts' indexes and every message row are filtered out above.
    }

    payload.contacts.sort((a, b) => new Date(b.lastAt || 0) - new Date(a.lastAt || 0));
    await writeIndexDirect(userId, payload);
    logger.info('Rebuilt messenger index', { userId, contacts: payload.contacts.length });
    return { payload, version: 1, exists: true };
}

/** Unconditional write, used by the rebuild path where there is no row to guard. */
async function writeIndexDirect(userId, payload, nickname) {
    const withName = { ...payload, nickname: nickname || payload.nickname || '' };
    await dynamodb.send(new PutCommand({
        TableName: TABLE,
        Item: {
            id: indexId(userId),
            createdAt: SENTINEL,
            kind: KIND.index,
            version: 1,
            text: `${MARKERS.index}${JSON.stringify(withName)}`,
            updatedAt: new Date().toISOString(),
        },
    }));
    return withName;
}

/**
 * How many connections an account has.
 *
 * Read-only on purpose: a public profile view must never create the index row for
 * the account being looked at (see the note on `getOrCreateIndex`), so this reads
 * what exists and reports 0 when there is nothing to read.
 */
async function countConnections(userId) {
    if (!userId) return 0;
    const { payload } = await readIndex(String(userId));
    return payload.contacts.length;
}

/** The caller's index, rebuilding it from the graph the first time it is missing. */
async function getOrCreateIndex(userId, nickname) {
    const current = await readIndex(userId);
    if (current.exists) return current;
    return rebuildIndex(userId, nickname);
}

// ── Friend graph ────────────────────────────────────────────────────────────

async function getFriendship(a, b) {
    const result = await dynamodb.send(new GetCommand({
        TableName: TABLE,
        Key: { id: friendId(a, b), createdAt: SENTINEL },
    }));
    return result.Item || null;
}

async function areFriends(a, b) {
    if (!a || !b || String(a) === String(b)) return false;
    return Boolean(await getFriendship(a, b));
}

/** Create the friendship row if it is missing (idempotent, safe to re-run). */
async function createFriendship(a, b, nicknames) {
    const [first, second] = sortedPair(a, b);
    const now = new Date().toISOString();
    await dynamodb.send(new PutCommand({
        TableName: TABLE,
        Item: {
            id: friendId(a, b),
            createdAt: SENTINEL,
            kind: KIND.friend,
            text: `${MARKERS.friend}${JSON.stringify({
                a: first,
                b: second,
                nicknames: { [first]: nicknames?.[first] || 'Someone', [second]: nicknames?.[second] || 'Someone' },
                convId: convIdFor(a, b),
                since: now,
            })}`,
            updatedAt: now,
        },
    }));
}

const contactEntry = (peerId, nickname, convId) => ({
    userId: String(peerId),
    nickname,
    convId,
    lastAt: new Date().toISOString(),
    lastPreview: '',
    unread: 0,
});

const addContact = (payload, entry) => {
    const contacts = payload.contacts.filter((c) => c.userId !== entry.userId);
    contacts.unshift(entry);
    payload.contacts = contacts;
};

const dropContact = (payload, peerId) => {
    payload.contacts = payload.contacts.filter((c) => c.userId !== String(peerId));
};

const stampCooldown = (payload, peerId, at) => {
    const cooldowns = payload.cooldowns.filter((c) => c.userId !== String(peerId));
    cooldowns.push({ userId: String(peerId), at });
    payload.cooldowns = cooldowns.slice(-LIMITS.cooldownListMax);
};

const cooldownRemainingMs = (payload, peerId) => {
    const entry = payload.cooldowns.find((c) => c.userId === String(peerId));
    if (!entry) return 0;
    const until = new Date(entry.at).getTime() + LIMITS.declineCooldownMs;
    return Math.max(0, until - Date.now());
};

/** Requests allowed in the trailing window, from the outgoing request log. */
function countRequestsSince(payload, windowMs) {
    const cutoff = Date.now() - windowMs;
    return payload.requestLog.filter((iso) => new Date(iso).getTime() > cutoff).length;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * The whole /talk dashboard in one read: contacts, both request lists, and how
 * much of the request budget is left. Previews are decrypted here, because the
 * caller is the account the index belongs to.
 */
async function getDirectory(user) {
    const userId = String(user.id);
    const nickname = readNickname(user) || 'Someone';
    const { payload } = await getOrCreateIndex(userId, nickname);

    const remaining = {
        pendingOut: Math.max(0, LIMITS.pendingOutMax - payload.pendingOut.length),
        thisHour: Math.max(0, LIMITS.requestsPerHour - countRequestsSince(payload, 60 * 60 * 1000)),
        today: Math.max(0, LIMITS.requestsPerDay - countRequestsSince(payload, 24 * 60 * 60 * 1000)),
        contacts: Math.max(0, LIMITS.contactsMax - payload.contacts.length),
    };

    return {
        me: { userId, nickname },
        contacts: payload.contacts.map((c) => ({
            userId: c.userId,
            nickname: c.nickname || 'Someone',
            convId: c.convId || convIdFor(userId, c.userId),
            lastAt: c.lastAt || null,
            lastPreview: c.lastPreview ? decrypt(c.lastPreview, c.convId || convIdFor(userId, c.userId)) : '',
            unread: Number(c.unread) || 0,
        })).sort((a, b) => new Date(b.lastAt || 0) - new Date(a.lastAt || 0)),
        pendingIn: payload.pendingIn.map((r) => ({ userId: r.userId, nickname: r.nickname || 'Someone', at: r.at })),
        pendingOut: payload.pendingOut.map((r) => ({ userId: r.userId, nickname: r.nickname || 'Someone', at: r.at })),
        // Accounts this one has blocked, so the state is enumerable rather than
        // only reachable by re-finding each blocked account's page. Not the mirror
        // of it: an account that has been blocked by someone else is not told, and
        // nothing in this payload would reveal it.
        blocks: (payload.blocks || []).map((b) => ({ userId: b.userId, nickname: b.nickname || 'Someone', at: b.at || null })),
        limits: LIMITS_PUBLIC,
        remaining,
    };
}

const LIMITS_PUBLIC = {
    pendingOutMax: LIMITS.pendingOutMax,
    requestsPerHour: LIMITS.requestsPerHour,
    requestsPerDay: LIMITS.requestsPerDay,
    contactsMax: LIMITS.contactsMax,
    bodyMax: LIMITS.bodyMax,
};

/**
 * The refusal a request meets when the other side has already said no — whether
 * they declined a request or blocked the sender before one could ever be sent.
 *
 * ⚠️ **One function for both, on purpose.** A block that answered differently
 * would be a block receipt: the sender could tell "declined" from "blocked", and
 * the point of `blockUser` is that they are not told. So a blocked requester gets
 * byte-identical copy to a declined one, and the wording lives in one place so the
 * two cannot drift apart.
 */
function declinedError(remainingMs) {
    const days = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
    return Object.assign(
        new Error(`That request was declined. You can try again in ${days} day${days === 1 ? '' : 's'}.`),
        { statusCode: 429 }
    );
}

/**
 * Send a friend request to `nickname`.
 *
 * Enforces every anti-spam rule in one place. If the target already has a
 * *pending request out to us*, this accepts theirs instead of creating a
 * mirror-image pair of requests that would sit unresolved until both sides
 * happened to open the page — the two are the same intent.
 */
async function sendFriendRequest(user, nickname) {
    const me = String(user.id);
    const myNickname = readNickname(user) || 'Someone';
    const target = await findUserByNickname(nickname);

    if (!target) {
        throw Object.assign(new Error('No account with that username'), { statusCode: 404 });
    }
    const targetId = String(target.id);
    if (targetId === me) {
        throw Object.assign(new Error('That is your own username'), { statusCode: 400 });
    }
    const targetNickname = readNickname(target) || 'Someone';

    const { payload, version } = await getOrCreateIndex(me, myNickname);

    if (await areFriends(me, targetId)) {
        throw Object.assign(new Error(`You are already connected with ${targetNickname}`), { statusCode: 409 });
    }

    // Blocked, either direction. A block IS a pre-emptive decline, so it answers
    // exactly as one — the cooldown is only the fallback for a requester who
    // somehow reached here past the gate (see `declinedError`).
    if (await areBlocked(me, targetId)) {
        throw declinedError(LIMITS.declineCooldownMs);
    }

    const cooldownMs = cooldownRemainingMs(payload, targetId);
    if (cooldownMs > 0) {
        throw declinedError(cooldownMs);
    }

    const alreadyPendingOut = payload.pendingOut.find((r) => r.userId === targetId);
    if (alreadyPendingOut) {
        throw Object.assign(new Error(`You already have a pending request to ${targetNickname}`), { statusCode: 409 });
    }

    if (payload.pendingOut.length >= LIMITS.pendingOutMax) {
        throw Object.assign(
            new Error(`You have ${LIMITS.pendingOutMax} requests waiting for an answer. Wait for a reply before sending more.`),
            { statusCode: 429 }
        );
    }
    if (payload.contacts.length >= LIMITS.contactsMax) {
        throw Object.assign(new Error('Your contact list is full.'), { statusCode: 429 });
    }

    const perHour = countRequestsSince(payload, 60 * 60 * 1000);
    if (perHour >= LIMITS.requestsPerHour) {
        throw Object.assign(
            new Error(`You have sent ${LIMITS.requestsPerHour} requests in the last hour. Please try again later.`),
            { statusCode: 429 }
        );
    }
    const perDay = countRequestsSince(payload, 24 * 60 * 60 * 1000);
    if (perDay >= LIMITS.requestsPerDay) {
        throw Object.assign(
            new Error(`You have sent ${LIMITS.requestsPerDay} requests today. Please try again tomorrow.`),
            { statusCode: 429 }
        );
    }

    // Their pending request to us? Accept it rather than starting a second one.
    const inbound = payload.pendingIn.find((r) => r.userId === targetId);
    if (inbound) {
        await acceptFriendRequest(user, targetId);
        return { autoAccepted: true, nickname: targetNickname };
    }

    const now = new Date().toISOString();
    await dynamodb.send(new PutCommand({
        TableName: TABLE,
        Item: {
            id: requestId(targetId, me),
            createdAt: SENTINEL,
            kind: KIND.request,
            text: `${MARKERS.request}${JSON.stringify({
                fromUserId: me,
                fromNickname: myNickname,
                toUserId: targetId,
                toNickname: targetNickname,
                status: 'pending',
                createdAt: now,
            })}`,
            updatedAt: now,
        },
    }));

    await updateIndex(me, (current) => {
        current.pendingOut.push({ userId: targetId, nickname: targetNickname, at: now });
        current.requestLog = [...current.requestLog, now].slice(-LIMITS.requestLogMax);
        return current;
    });

    await updateIndex(targetId, (current) => {
        if (!current.pendingIn.some((r) => r.userId === me)) {
            current.pendingIn.push({ userId: me, nickname: myNickname, at: now });
        }
        return current;
    });

    logger.info('Friend request sent', { from: me, to: targetId });
    return { autoAccepted: false, nickname: targetNickname, version };
}

/** Read the request row and confirm it is still a pending request to `me`. */
async function loadPendingRequest(me, fromUserId) {
    const result = await dynamodb.send(new GetCommand({
        TableName: TABLE,
        Key: { id: requestId(me, fromUserId), createdAt: SENTINEL },
    }));
    const row = result.Item;
    if (!row) throw Object.assign(new Error('That request is no longer available'), { statusCode: 404 });
    const req = parsePayload(row.text, MARKERS.request);
    if (!req || req.status !== 'pending') {
        throw Object.assign(new Error('That request is no longer available'), { statusCode: 404 });
    }
    if (req.toUserId !== String(me)) {
        throw Object.assign(new Error('That request is not addressed to you'), { statusCode: 403 });
    }
    return { row, req };
}

/** Accept a pending request addressed to the caller. */
async function acceptFriendRequest(user, fromUserId) {
    const me = String(user.id);
    const myNickname = readNickname(user) || 'Someone';
    const { row, req } = await loadPendingRequest(me, fromUserId);
    const peerId = String(req.fromUserId);
    const peerNickname = req.fromNickname || 'Someone';

    const myIndex = await getOrCreateIndex(me, myNickname);
    if (myIndex.payload.contacts.length >= LIMITS.contactsMax) {
        throw Object.assign(new Error('Your contact list is full.'), { statusCode: 429 });
    }

    await createFriendship(me, peerId, { [me]: myNickname, [peerId]: peerNickname });

    await dynamodb.send(new PutCommand({
        TableName: TABLE,
        Item: {
            ...row,
            text: `${MARKERS.request}${JSON.stringify({ ...req, status: 'accepted', respondedAt: new Date().toISOString() })}`,
            updatedAt: new Date().toISOString(),
        },
    }));

    const convId = convIdFor(me, peerId);
    await updateIndex(me, (current) => {
        current.pendingIn = current.pendingIn.filter((r) => r.userId !== peerId);
        current.cooldowns = current.cooldowns.filter((c) => c.userId !== peerId);
        addContact(current, contactEntry(peerId, peerNickname, convId));
        return current;
    });

    await updateIndex(peerId, (current) => {
        current.pendingOut = current.pendingOut.filter((r) => r.userId !== me);
        current.cooldowns = current.cooldowns.filter((c) => c.userId !== me);
        addContact(current, contactEntry(me, myNickname, convId));
        return current;
    });

    logger.info('Friend request accepted', { by: me, peer: peerId });
    return { nickname: peerNickname, convId };
}

/** Decline a pending request. Both sides get a cooldown so it can't be retried. */
async function declineFriendRequest(user, fromUserId) {
    const me = String(user.id);
    const myNickname = readNickname(user) || 'Someone';
    const { row, req } = await loadPendingRequest(me, fromUserId);
    const peerId = String(req.fromUserId);
    const now = new Date().toISOString();

    await dynamodb.send(new PutCommand({
        TableName: TABLE,
        Item: {
            ...row,
            text: `${MARKERS.request}${JSON.stringify({ ...req, status: 'declined', respondedAt: now })}`,
            updatedAt: now,
        },
    }));

    await updateIndex(me, (current) => {
        current.pendingIn = current.pendingIn.filter((r) => r.userId !== peerId);
        stampCooldown(current, peerId, now);
        return current;
    });

    await updateIndex(peerId, (current) => {
        current.pendingOut = current.pendingOut.filter((r) => r.userId !== me);
        stampCooldown(current, me, now);
        return current;
    });

    logger.info('Friend request declined', { by: me, peer: peerId });
    return { nickname: req.fromNickname || 'Someone' };
}

/** Withdraw an outgoing request the caller sent. */
async function cancelFriendRequest(user, toUserId) {
    const me = String(user.id);
    const myNickname = readNickname(user) || 'Someone';
    const targetId = String(toUserId);

    await dynamodb.send(new DeleteCommand({
        TableName: TABLE,
        Key: { id: requestId(targetId, me), createdAt: SENTINEL },
    }));

    await updateIndex(me, (current) => {
        current.pendingOut = current.pendingOut.filter((r) => r.userId !== targetId);
        return current;
    });

    await updateIndex(targetId, (current) => {
        current.pendingIn = current.pendingIn.filter((r) => r.userId !== me);
        return current;
    });

    logger.info('Friend request cancelled', { by: me, peer: targetId });
    return { ok: true };
}

/** Remove an existing connection. Messages are kept — this is not a message delete. */
async function removeContact(user, peerId) {
    const me = String(user.id);
    const myNickname = readNickname(user) || 'Someone';
    const peer = String(peerId);

    await dynamodb.send(new DeleteCommand({
        TableName: TABLE,
        Key: { id: friendId(me, peer), createdAt: SENTINEL },
    }));

    await updateIndex(me, (current) => {
        dropContact(current, peer);
        return current;
    });

    await updateIndex(peer, (current) => {
        dropContact(current, me);
        return current;
    });

    logger.info('Contact removed', { by: me, peer });
    return { ok: true };
}

// ── Blocks ──────────────────────────────────────────────────────────────────

/**
 * Resolve a handle to the account row it names, or refuse with a 404.
 *
 * ⚠️ Blocking is addressed by USERNAME, and this is why. A friend request already
 * is (`sendFriendRequest(user, nickname)`) because a stranger holds no other
 * identifier for the account they want to reach — and the public profile payload
 * refuses to disclose another account's internal id to anyone who is not already
 * connected (`services/publicProfile.js`, `connectedUserId`). A block is placed
 * from exactly that page, by exactly that viewer, so it has to speak the same
 * language: a handle. Keeping the id-addressed form for the reverse direction
 * would mean one operation with two addressing schemes.
 */
async function resolveByNickname(nickname) {
    const row = await findUserByNickname(nickname);
    if (!row) {
        throw Object.assign(new Error('No account with that username'), { statusCode: 404 });
    }
    return row;
}

/** `blocker` has hidden `blocked` — one direction only. */
async function readBlock(blockerId, blockedId) {
    if (!blockerId || !blockedId) return null;
    const result = await dynamodb.send(new GetCommand({
        TableName: TABLE,
        Key: { id: blockId(blockerId, blockedId), createdAt: SENTINEL },
    }));
    return result.Item || null;
}

/** Is there a block between these two accounts, in *either* direction? */
async function areBlocked(a, b) {
    if (!a || !b || String(a) === String(b)) return false;
    const [forward, backward] = await Promise.all([readBlock(a, b), readBlock(b, a)]);
    return Boolean(forward || backward);
}

/**
 * Block an account.
 *
 * What a block *is*, in one sentence: **it removes the connection and refuses
 * everything the removed connection would have allowed, permanently and from one
 * side only.** So this is not a heavier `removeContact` — it is the three things
 * that can reach the blocker, closed in one operation:
 *
 *   1. the friendship row (which is the authorisation check for messaging),
 *   2. any pending request in *either* direction, and
 *   3. the friend-request gate — `sendFriendRequest` refuses while this row exists.
 *
 * Plus the read gate: `publicProfile` answers the blocked account as if the page
 * were private, whatever its visibility setting says.
 *
 * **The blocked account is not told, and that is a rule, not an omission.** Every
 * mutation here is applied to their index as well (the contact and the requests do
 * disappear from their side) so nothing is left dangling, but no copy, status or
 * flag anywhere distinguishes "blocked" from "the connection was removed" and
 * "that page is private". A block the other side can detect is a block that starts
 * an argument instead of ending one.
 *
 * Idempotent: blocking twice rewrites the same row and the same list entry, so a
 * double-tap, a retry after a timeout, or blocking someone who has already blocked
 * you all land on the same state.
 */
async function blockUser(user, nickname) {
    const me = String(user.id);
    const myNickname = readNickname(user) || 'Someone';
    const target = await resolveByNickname(nickname);
    const peer = String(target.id);

    if (peer === me) {
        throw Object.assign(new Error('You cannot block yourself'), { statusCode: 400 });
    }

    const peerNickname = readNickname(target) || 'Someone';
    const now = new Date().toISOString();

    // ⚠️ Order matters. The block row goes FIRST, so that a failure later in this
    // function leaves a block that is *already in force* rather than a removed
    // connection with nothing recording why it cannot be re-made.
    await dynamodb.send(new PutCommand({
        TableName: TABLE,
        Item: {
            id: blockId(me, peer),
            createdAt: SENTINEL,
            kind: KIND.block,
            text: `${MARKERS.block}${JSON.stringify({
                blockerId: me,
                blockedId: peer,
                blockedNickname: peerNickname,
                at: now,
            })}`,
            updatedAt: now,
        },
    }));

    await dynamodb.send(new DeleteCommand({
        TableName: TABLE,
        Key: { id: friendId(me, peer), createdAt: SENTINEL },
    }));

    // Both directions of a pending request, because both are a way in: mine is one
    // I no longer want, and theirs is one I am refusing without answering it.
    await Promise.all([
        dynamodb.send(new DeleteCommand({ TableName: TABLE, Key: { id: requestId(peer, me), createdAt: SENTINEL } })),
        dynamodb.send(new DeleteCommand({ TableName: TABLE, Key: { id: requestId(me, peer), createdAt: SENTINEL } })),
    ]);

    // One index write per side, not four: the block, the dropped contact and the
    // two dropped requests are a single new state, and `updateIndex` is a
    // read-modify-write that retries on a lost race — splitting it into more passes
    // only widens the window another writer can slip into.
    await updateIndex(me, (current) => {
        dropContact(current, peer);
        current.pendingIn = current.pendingIn.filter((r) => r.userId !== peer);
        current.pendingOut = current.pendingOut.filter((r) => r.userId !== peer);
        current.blocks = [
            { userId: peer, nickname: peerNickname, at: now },
            ...(current.blocks || []).filter((b) => b.userId !== peer),
        ];
        return current;
    });

    await updateIndex(peer, (current) => {
        dropContact(current, me);
        current.pendingIn = current.pendingIn.filter((r) => r.userId !== me);
        current.pendingOut = current.pendingOut.filter((r) => r.userId !== me);
        return current;
    });

    logger.info('Account blocked', { by: me, peer });
    return { ok: true, nickname: peerNickname };
}

/**
 * Lift a block.
 *
 * Deliberately does **not** restore the connection, and does not send a request:
 * an unblock says "you may ask again", not "we are connected" — a re-connection
 * still takes a request and an acceptance, which is the whole point of having
 * removed one.
 *
 * ⚠️ The decline cooldown is cleared as well. Blocking implies the same refusal a
 * decline does (see `sendFriendRequest`), and leaving that stamp behind would mean
 * an unblocked account still could not ask for a week — a control that appears to
 * work and does nothing.
 */
async function unblockUser(user, nickname) {
    const me = String(user.id);
    const peer = String((await resolveByNickname(nickname)).id);
    const now = new Date().toISOString();

    await dynamodb.send(new DeleteCommand({
        TableName: TABLE,
        Key: { id: blockId(me, peer), createdAt: SENTINEL },
    }));

    await updateIndex(me, (current) => {
        current.blocks = (current.blocks || []).filter((b) => b.userId !== peer);
        current.cooldowns = current.cooldowns.filter((c) => c.userId !== peer);
        return current;
    });

    // Their side is touched too, for the mirror of the reason it is touched on
    // block: the cooldown stamped on them (if any) has to go, or the unblock is
    // invisible to the only person it was meant to release.
    await updateIndex(peer, (current) => {
        current.cooldowns = current.cooldowns.filter((c) => c.userId !== me);
        return current;
    });

    logger.info('Account unblocked', { by: me, peer, at: now });
    return { ok: true };
}

// ── Messaging ───────────────────────────────────────────────────────────────

/** Membership check shared by every conversation endpoint. */
async function assertConversation(user, peerId) {
    const me = String(user.id);
    const peer = String(peerId);
    if (peer === me) throw Object.assign(new Error('You cannot message yourself'), { statusCode: 400 });

    // Read the friendship row itself rather than only "do the two ids match":
    // its `nicknames` map is where a contact's display name is known without a
    // second user lookup, and it is what stops a contact being created as
    // "Someone" when one side's index had to be recreated.
    const friendship = await getFriendship(me, peer);
    if (!friendship) {
        throw Object.assign(new Error('You are not connected with that account'), { statusCode: 403 });
    }

    // ⚠️ The block is checked even though `blockUser` deletes the friendship row
    // above, and it is checked here rather than only on send: this is the single
    // gate every conversation read AND write passes through, and the invariant it
    // enforces must not rest on two rows having been deleted in the right order.
    // The copy is the no-friendship copy, so a block is not distinguishable here
    // either (see `declinedError`).
    if (await areBlocked(me, peer)) {
        throw Object.assign(new Error('You are not connected with that account'), { statusCode: 403 });
    }

    const pair = parsePayload(friendship.text, MARKERS.friend) || {};

    return { me, peer, convId: convIdFor(me, peer), nicknames: pair.nicknames || {} };
}

const toMessage = (item, convId, me) => ({
    id: item.createdAt,
    cursor: item.createdAt,
    from: String(item.fromUserId) === String(me) ? 'me' : 'them',
    fromUserId: item.fromUserId,
    body: decrypt(item.body, convId),
    sentAt: item.sentAt || item.createdAt,
    readAt: item.readAt || null,
});

/**
 * The newest page of a conversation, oldest-first.
 *
 * Reads the conversation's partition and walks the sort key backwards, which is
 * what the (id, createdAt) key is for: no filtering, no index, and `since` is a
 * pure key condition rather than a post-read filter.
 */
async function listMessages(user, peerId, { since, limit } = {}) {
    const { me, convId } = await assertConversation(user, peerId);
    const pageSize = Math.min(Number(limit) > 0 ? Number(limit) : LIMITS.pageSize, 200);

    // ⚠️ `#createdAt` and `:since` are declared ONLY when there is a cursor to
    // compare against. DynamoDB rejects a request whose ExpressionAttributeNames
    // or ExpressionAttributeValues holds an entry the expression never uses
    // ("Value provided in ExpressionAttributeNames unused in expressions"), and
    // naming the sort key up front made every FIRST page — the one call with no
    // `since` — a 500. That is the call that opens a conversation, so the whole
    // thread was unreadable while the poll (which always passes a cursor) was
    // the only path that worked.
    const names = { '#id': 'id' };
    const values = { ':id': messagePartition(convId) };
    let keyCondition = '#id = :id';
    if (since) {
        names['#createdAt'] = 'createdAt';
        values[':since'] = String(since);
        keyCondition += ' AND #createdAt > :since';
    }

    const params = {
        TableName: TABLE,
        KeyConditionExpression: keyCondition,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ScanIndexForward: false, // newest first, then reversed for display
        Limit: pageSize,
    };

    const result = await dynamodb.send(new QueryCommand(params));
    const items = (result.Items || []).slice().reverse();

    return {
        convId,
        messages: items.map((item) => toMessage(item, convId, me)),
        peerUserId: String(peerId),
    };
}

/** Send a message on an existing connection. */
async function sendMessage(user, peerId, rawBody) {
    const me = String(user.id);
    const body = normalizeBody(rawBody);
    const { peer, convId, nicknames } = await assertConversation(user, peerId);
    const myNickname = readNickname(user) || 'Someone';
    const peerNickname = nicknames[peer] || 'Someone';

    const sentAt = new Date().toISOString();
    const sortKey = messageSortKey(new Date(sentAt));

    await dynamodb.send(new PutCommand({
        TableName: TABLE,
        Item: {
            id: messagePartition(convId),
            createdAt: sortKey,          // sort key — must be unique per message
            kind: KIND.message,
            convId,
            fromUserId: me,
            toUserId: peer,
            sentAt,
            readAt: null,
            text: MARKERS.message,       // marker only; the body lives below, encrypted
            body: encrypt(body, convId),
            updatedAt: sentAt,
        },
    }));

    // Preview for the sidebar. A short snippet is enough, and it is encrypted
    // like the body so nothing readable is written to the row.
    const preview = body.length > 90 ? `${body.slice(0, 90)}…` : body;
    const previewCipher = encrypt(preview, convId);

    await updateIndex(me, (current) => {
        upsertContactPreview(current, peer, convId, sentAt, previewCipher, 0, peerNickname);
        return current;
    });

    await updateIndex(peer, (current) => {
        upsertContactPreview(current, me, convId, sentAt, previewCipher, 1, myNickname);
        return current;
    });

    logger.info('Message sent', { from: me, to: peer, convId });
    return {
        message: { id: sortKey, cursor: sortKey, from: 'me', body, sentAt, readAt: null },
        convId,
    };
}

/**
 * Stamp the conversation summary on one side's index.
 *
 * `bumpUnread` is 0 for the sender (they have obviously read it) and 1 for the
 * recipient; a contact the recipient no longer lists is added back, because a
 * message from an accepted connection should never be orphaned. `nickname` is
 * the peer's display name, used only when the entry has to be created.
 */
function upsertContactPreview(payload, peerId, convId, at, previewCipher, bumpUnread, nickname) {
    const existing = payload.contacts.find((c) => c.userId === String(peerId));
    if (existing) {
        existing.convId = convId;
        existing.lastAt = at;
        existing.lastPreview = previewCipher;
        existing.unread = (Number(existing.unread) || 0) + bumpUnread;
        // Newest first.
        payload.contacts = [existing, ...payload.contacts.filter((c) => c.userId !== String(peerId))];
        return;
    }
    payload.contacts.unshift({
        userId: String(peerId),
        nickname: nickname || 'Someone',
        convId,
        lastAt: at,
        lastPreview: previewCipher,
        unread: bumpUnread,
    });
}

/** Clear the unread badge for a conversation. */
async function markConversationRead(user, peerId) {
    const me = String(user.id);
    const peer = String(peerId);
    const { convId } = await assertConversation(user, peerId);

    await updateIndex(me, (current) => {
        const contact = current.contacts.find((c) => c.userId === peer);
        if (contact) contact.unread = 0;
        return current;
    });

    // The read receipt the sender sees: stamp `readAt` on the newest unread
    // inbound rows. This MUST be an UpdateCommand on the two date attributes and
    // nothing else — a PutCommand would replace the whole row, and the row's
    // `body` is the encrypted message, so a Put here silently destroys the text
    // it was trying to mark as read.
    const { messages } = await listMessages(user, peer, { limit: 40 });
    const unread = messages.filter((m) => m.from === 'them' && !m.readAt);
    if (unread.length) {
        const now = new Date().toISOString();
        await Promise.all(unread.map((m) => dynamodb.send(new UpdateCommand({
            TableName: TABLE,
            Key: { id: messagePartition(convId), createdAt: m.cursor },
            UpdateExpression: 'SET readAt = :now, updatedAt = :now',
            ExpressionAttributeValues: { ':now': now },
        }))));
    }

    return { ok: true, convId, marked: unread.length };
}

// ── Avatars ─────────────────────────────────────────────────────────────────

/** How many accounts one avatar request may ask about. */
const AVATAR_BATCH_MAX = 24;

/**
 * Read an account row by id.
 *
 * The table's key is composite, so this is a Query on the partition key with a
 * `Limit: 1` rather than a GetItem (which would need the sort key too). The id
 * always comes from a friendship row, so it is a real account — a random data
 * row can never match.
 */
async function readAccountRow(userId) {
    const result = await dynamodb.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'id = :id',
        ExpressionAttributeValues: { ':id': String(userId) },
        Limit: 1,
    }));
    return result.Items?.[0] || null;
}

/**
 * Other people's profile pictures, for the accounts that are ALLOWED to be shown.
 *
 * ⚠️ **The friendship check is the point of this function.** A picture is only
 * returned for an accepted connection, which is what makes the feature
 * "once the request is accepted" rather than "type any username and see their
 * face": a pending request, a declined one, or a stranger is reported as
 * `skipped` and never sends an image. The id list is capped too, so the endpoint
 * cannot be used to enumerate accounts in bulk.
 *
 * The `have` map is the client's cache (`id` → the etag it already holds), so a
 * repeat visit transfers only what actually changed.
 *
 * @returns {Promise<{avatars: Object, unchanged: string[], skipped: string[], limit: number}>}
 */
async function collectAvatars(user, ids, have = {}) {
    const me = String(user.id);
    const wanted = [...new Set((Array.isArray(ids) ? ids : []).map(String))]
        .filter((id) => id && id !== me)
        .slice(0, AVATAR_BATCH_MAX);

    const avatars = {};
    const unchanged = [];
    const skipped = [];

    await Promise.all(wanted.map(async (id) => {
        if (!(await areFriends(me, id))) {
            skipped.push(id);
            return;
        }

        const row = await readAccountRow(id);
        if (!row) {
            skipped.push(id);
            return;
        }

        const etag = etagFor(row.profilePicture);
        if (Object.prototype.hasOwnProperty.call(have, id) && have[id] === etag) {
            unchanged.push(id);
            return;
        }

        // `src: null` is a valid answer — the account has no picture, or the one
        // it has cannot be decoded. It is paired with the REAL etag so the client
        // caches "no avatar" and stops asking; a mismatched etag here would make
        // every load re-request the same broken picture.
        const avatar = row.profilePicture ? await buildAvatar(row.profilePicture) : null;
        avatars[id] = { src: avatar?.src || null, etag };
    }));

    return { avatars, unchanged, skipped, limit: AVATAR_BATCH_MAX };
}

module.exports = {
    LIMITS,
    KIND,
    MARKERS,
    LIMITS_PUBLIC,
    normalizeBody,
    AVATAR_BATCH_MAX,
    convIdFor,
    friendId,
    blockId,
    indexId,
    messagePartition,
    requestId,
    messageSortKey,
    getDirectory,
    sendFriendRequest,
    acceptFriendRequest,
    declineFriendRequest,
    cancelFriendRequest,
    removeContact,
    readBlock,
    areBlocked,
    blockUser,
    unblockUser,    listMessages,
    sendMessage,
    markConversationRead,
    collectAvatars,
    countConnections,
    readAccountRow,
    areFriends,
    findUserByNickname,
    _clearNicknameCache,
    _updateIndex: updateIndex,
    _readIndex: readIndex,
};
