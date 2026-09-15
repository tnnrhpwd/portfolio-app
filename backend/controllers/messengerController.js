/**
 * messengerController.js — Express handlers for the Talk messenger.
 *
 * Routes (mounted under /api/data):
 *   GET    /messenger/directory                          → dashboard in one read
 *   GET    /messenger/peers/:userId                       → who a peer is, and are we connected
 *   GET    /messenger/avatars                             → profile pictures of accepted connections
 *   POST   /messenger/requests                           → send a friend request { username }
 *   POST   /messenger/requests/:userId/accept             → accept an inbound request
 *   POST   /messenger/requests/:userId/decline            → decline an inbound request
 *   DELETE /messenger/requests/:userId                    → withdraw an outgoing request
 *   DELETE /messenger/contacts/:userId                    → remove a connection
 *   POST   /messenger/blocks                              → block { username }
 *   DELETE /messenger/blocks                              → lift a block { username }
 *   GET    /messenger/conversations/:userId/messages      → newest page (?since= cursor)
 *   POST   /messenger/conversations/:userId/messages      → send { body }
 *   POST   /messenger/conversations/:userId/read          → clear the unread badge
 *
 * A block (docs/implementation/agent.md §19.4) is not a heavier `DELETE
 * /contacts`: it also refuses every future request from that account and hides the
 * blocker's page from them, and it is the only one of the two that is one-sided.
 * The blocked account is never told — see `blockUser` in the service.
 *
 * ⚠️ The two block routes are addressed by USERNAME, not by id, even though every
 * other peer route is id-addressed. That is not an oversight: the member page a
 * block is placed from never learns another account's internal id unless the two
 * are connected — and a block removes the connection — so a handle is the only
 * identifier it holds. Same reason `POST /messenger/requests` takes one.
 *
 * Every route requires a signed-in user: `protect` sets `req.user`, and the
 * service keys everything off `req.user.id`, never off anything the client sent.
 * A userId in the URL is only ever the *peer*, and every call re-checks that the
 * two accounts are actually connected.
 */

const asyncHandler = require('express-async-handler');
const {
    LIMITS,
    AVATAR_BATCH_MAX,
    getDirectory,
    sendFriendRequest,
    acceptFriendRequest,
    declineFriendRequest,
    cancelFriendRequest,
    removeContact,
    blockUser,
    unblockUser,
    listMessages,
    sendMessage,
    markConversationRead,
    collectAvatars,
    readAccountRow,
    areFriends,
} = require('../services/messengerService');
const { publicIdentity } = require('../utils/userIdentity');
const { checkIP } = require('../utils/accessData.js');

/** Throw a 4xx that the shared error middleware will pass through verbatim. */
function fail(res, statusCode, message) {
    res.status(statusCode);
    throw new Error(message);
}

/** Every handler starts the same way: signed in, requester attached. */
async function requireUser(req, res) {
    await checkIP(req);
    if (!req.user?.id) fail(res, 401, 'Sign in to use Talk');
    return req.user;
}

/** A peer id comes from the URL, so it is validated before it reaches a key. */
function readPeerId(req, res) {
    const peerId = String(req.params.userId || '').trim();
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(peerId)) fail(res, 400, 'Invalid account id');
    return peerId;
}

/**
 * Parse the client's avatar cache, sent as `id:etag,id:etag`.
 *
 * Malformed pairs are dropped rather than rejected: this is an optimisation hint,
 * and a client with a stale or hand-edited cache should still get its avatars,
 * just with more of them re-sent.
 */
function parseAvatarHave(raw) {
    const have = {};
    for (const pair of String(raw || '').split(',')) {
        const at = pair.lastIndexOf(':');
        if (at <= 0) continue;
        const id = pair.slice(0, at).trim();
        const etag = pair.slice(at + 1).trim();
        if (/^[a-zA-Z0-9_-]{1,64}$/.test(id) && /^[a-f0-9]{0,32}$/i.test(etag)) have[id] = etag;
    }
    return have;
}

// @desc    The whole Talk dashboard (contacts, requests, remaining budget)
// @route   GET /api/data/messenger/directory
// @access  Private
const getMessengerDirectory = asyncHandler(async (req, res) => {
    const user = await requireUser(req, res);
    const directory = await getDirectory(user);
    res.status(200).json({ success: true, ...directory });
});

// @desc    Identify a peer account and whether the caller is connected to it
// @route   GET /api/data/messenger/peers/:userId
// @access  Private
const getMessengerPeer = asyncHandler(async (req, res) => {
    const user = await requireUser(req, res);
    const peerId = readPeerId(req, res);

    const row = await readAccountRow(peerId);
    if (!row) fail(res, 404, 'That account no longer exists');

    const isFriend = await areFriends(String(user.id), peerId);
    res.status(200).json({
        success: true,
        peer: { ...publicIdentity(row), isFriend },
    });
});

// @desc    Send a friend request by username
// @route   POST /api/data/messenger/requests
// @access  Private
const postFriendRequest = asyncHandler(async (req, res) => {
    const user = await requireUser(req, res);
    const result = await sendFriendRequest(user, readUsername(req, res));
    const directory = await getDirectory(user);
    res.status(201).json({ success: true, ...result, ...directory });
});

// @desc    Accept an inbound friend request
// @route   POST /api/data/messenger/requests/:userId/accept
// @access  Private
const postAcceptRequest = asyncHandler(async (req, res) => {
    const user = await requireUser(req, res);
    const peerId = readPeerId(req, res);
    const result = await acceptFriendRequest(user, peerId);
    const directory = await getDirectory(user);
    res.status(200).json({ success: true, ...result, ...directory });
});

// @desc    Decline an inbound friend request
// @route   POST /api/data/messenger/requests/:userId/decline
// @access  Private
const postDeclineRequest = asyncHandler(async (req, res) => {
    const user = await requireUser(req, res);
    const peerId = readPeerId(req, res);
    const result = await declineFriendRequest(user, peerId);
    const directory = await getDirectory(user);
    res.status(200).json({ success: true, ...result, ...directory });
});

// @desc    Withdraw an outgoing friend request
// @route   DELETE /api/data/messenger/requests/:userId
// @access  Private
const deleteFriendRequest = asyncHandler(async (req, res) => {
    const user = await requireUser(req, res);
    const peerId = readPeerId(req, res);
    await cancelFriendRequest(user, peerId);
    const directory = await getDirectory(user);
    res.status(200).json({ success: true, ...directory });
});

// @desc    Remove a connection
// @route   DELETE /api/data/messenger/contacts/:userId
// @access  Private
const deleteMessengerContact = asyncHandler(async (req, res) => {
    const user = await requireUser(req, res);
    const peerId = readPeerId(req, res);
    await removeContact(user, peerId);
    const directory = await getDirectory(user);
    res.status(200).json({ success: true, ...directory });
});

/**
 * The handle a block is addressed by. Same validation as a friend request, in the
 * same place, so the two cannot disagree about what a usable username is.
 */
function readUsername(req, res) {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    if (!username) fail(res, 400, 'Enter a username');
    if (username.length > LIMITS.nicknameMax) fail(res, 400, 'That username is too long');
    return username;
}

// @desc    Block an account — removes the connection, refuses their requests, hides the page
// @route   POST /api/data/messenger/blocks  { username }
// @access  Private
//
// 200 rather than 201: a block is idempotent state, not a created resource, and a
// repeat call (a double-tap, a retry after a timeout) is a success, not a conflict.
const postBlockUser = asyncHandler(async (req, res) => {
    const user = await requireUser(req, res);
    const result = await blockUser(user, readUsername(req, res));
    const directory = await getDirectory(user);
    res.status(200).json({ success: true, ...result, ...directory });
});

// @desc    Lift a block (does NOT restore the connection)
// @route   DELETE /api/data/messenger/blocks  { username }
// @access  Private
const deleteBlockUser = asyncHandler(async (req, res) => {
    const user = await requireUser(req, res);
    await unblockUser(user, readUsername(req, res));
    const directory = await getDirectory(user);
    res.status(200).json({ success: true, ...directory });
});

// @desc    Profile pictures for the caller's accepted connections
// @route   GET /api/data/messenger/avatars?ids=a,b,c&have=a:etag,b:etag
// @access  Private
const getMessengerAvatars = asyncHandler(async (req, res) => {
    const user = await requireUser(req, res);

    const ids = String(req.query.ids || '')
        .split(',')
        .map((id) => id.trim())
        .filter((id) => /^[a-zA-Z0-9_-]{1,64}$/.test(id));

    if (ids.length === 0) fail(res, 400, 'No accounts requested');
    if (ids.length > AVATAR_BATCH_MAX) {
        fail(res, 400, `Ask for at most ${AVATAR_BATCH_MAX} avatars at a time`);
    }

    // Only accepted connections come back with a picture — see collectAvatars.
    const result = await collectAvatars(user, ids, parseAvatarHave(req.query.have));
    res.status(200).json({ success: true, ...result });
});

// @desc    Read a conversation (newest page, or everything after `since`)
// @route   GET /api/data/messenger/conversations/:userId/messages
// @access  Private
const getConversationMessages = asyncHandler(async (req, res) => {
    const user = await requireUser(req, res);
    const peerId = readPeerId(req, res);
    const since = typeof req.query.since === 'string' && req.query.since ? req.query.since : undefined;
    const result = await listMessages(user, peerId, { since, limit: req.query.limit });
    res.status(200).json({ success: true, ...result });
});

// @desc    Send a message to a connection
// @route   POST /api/data/messenger/conversations/:userId/messages
// @access  Private
const postConversationMessage = asyncHandler(async (req, res) => {
    const user = await requireUser(req, res);
    const peerId = readPeerId(req, res);
    const result = await sendMessage(user, peerId, req.body?.body);
    res.status(201).json({ success: true, ...result });
});

// @desc    Mark a conversation as read
// @route   POST /api/data/messenger/conversations/:userId/read
// @access  Private
const postConversationRead = asyncHandler(async (req, res) => {
    const user = await requireUser(req, res);
    const peerId = readPeerId(req, res);
    const result = await markConversationRead(user, peerId);
    res.status(200).json({ success: true, ...result });
});

module.exports = {
    getMessengerDirectory,
    getMessengerPeer,
    getMessengerAvatars,
    postFriendRequest,
    postAcceptRequest,
    postDeclineRequest,
    deleteFriendRequest,
    deleteMessengerContact,
    postBlockUser,
    deleteBlockUser,
    getConversationMessages,
    postConversationMessage,
    postConversationRead,
};
