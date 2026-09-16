/**
 * publicProfile.js — assemble `/u/<username>`: what a stranger may see about an
 * account.
 *
 * The rule this file exists to enforce
 * -----------------------------------
 * Everything returned here is **public by construction**, and the shape is built
 * by listing what to include rather than by deleting what not to. An account row
 * carries an email, a password hash, a Stripe customer id and a plan; none of
 * those are in the returned object, and adding a field to a user row cannot leak
 * it here.
 *
 * What the page deliberately does NOT show: the account's email, their plan/rank,
 * their workspace goals, their pets, their reviews (feedback written to us is not
 * the same as a post they chose to publish under their name), or their internal
 * user id — the client never needs it, and "connect" works by username.
 *
 * Trust levels are worth being precise about, because they differ:
 *   - identity (nickname, picture, join date)      → read from the account row
 *   - connections count                            → from their own messenger index
 *   - published marketplace skills/goals           → `authorUserId` is stamped by
 *                                                    the server on publish
 *   - game bests                                   → self-reported public rows
 *                                                    (see services/gameBoards.js)
 *
 * A block outranks all of it (docs/implementation/PROFILES.md): an account that
 * has blocked the viewer is answered as a private page, so the visibility setting
 * cannot be used to read around a block. The reverse is *not* hidden — the viewer's
 * own block is reported back to them, because a block you cannot see is a block you
 * cannot lift (`blockedByYou`).
 */

const { logger } = require('../utils/logger');
const { paginatedScan } = require('../utils/paginatedScan');
const { readNickname, isValidNicknameShape } = require('../utils/userIdentity');
const {
    PROFILE_VISIBILITY,
    normalizeProfileVisibility,
} = require('../constants/profileVisibility.js');
const { buildAvatar } = require('./avatarService');
const { getPlayerBoards } = require('./gameBoards');
const {
    findUserByNickname,
    countConnections,
    areFriends,
    readBlock,
} = require('./messengerService');

/** How many published items to show before the list stops being a page. */
const PUBLISHED_MAX = 12;

/**
 * Is this marketplace id a catalog entry (a "meta"), rather than one of the
 * version / install / rating / flag / rate-limit rows that share the namespace?
 * Those all live under `csimple_market_*` too (see marketplaceController.js),
 * and listing them as "published work" would show a skill several times over.
 */
function isMarketCatalogId(id) {
    const value = String(id || '');
    if (!value.startsWith('csimple_market_')) return false;
    if (value.startsWith('csimple_market_author_')) return false;   // publish rate limit
    if (/_v\d+$/.test(value)) return false;                          // version row
    return !value.includes('_install_') && !value.includes('_rating_') && !value.includes('_flag_');
}

/**
 * One catalog row → what the profile shows.
 *
 * Deliberately a smaller shape than the marketplace controller's
 * `metaToSummary`: this is a profile card, not a search result, and it re-derives
 * the average from `ratingSum`/`ratingCount` rather than depending on the ranking
 * policy in marketplaceRanking.js.
 */
function toPublishedSummary(item) {
    const ratingCount = Number(item.ratingCount) || 0;
    const ratingSum = Number(item.ratingSum) || 0;
    const avgRating = ratingCount > 0 ? ratingSum / ratingCount : 0;

    return {
        marketId: item.id.replace('csimple_market_', ''),
        kind: item.kind || 'skill',
        name: item.name || 'Untitled',
        description: String(item.naturalLanguageDescription || '').slice(0, 240),
        version: item.latestVersion || null,
        downloads: Number(item.downloads) || 0,
        installs: Number(item.installs) || 0,
        ratingCount,
        avgRating: Math.round(avgRating * 10) / 10,
        publishedAt: item.firstPublishedAt || item.updatedAt || null,
    };
}

/** The caller's published marketplace work, newest first. */
async function listPublished(userId) {
    const items = await paginatedScan({
        TableName: 'Simple',
        FilterExpression: '#author = :author',
        ExpressionAttributeNames: { '#author': 'authorUserId' },
        ExpressionAttributeValues: { ':author': String(userId) },
    });

    return items
        .filter((item) => isMarketCatalogId(item.id))
        .map(toPublishedSummary)
        .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
        .slice(0, PUBLISHED_MAX);
}

/**
 * Build the public view of one account.
 *
 * **Visibility is checked here, before anything is gathered.** A page is private
 * by default, and private means "the owner and the people they are connected with"
 * — so for anyone else this returns only the nickname and the fact that the page
 * is private. No picture is built, no board is scanned and no published work is
 * listed, because none of it should exist for that caller in the first place.
 *
 * The restricted response is a 200 with `restricted: true` rather than a 403: the
 * page still has something true and useful to show (who this is, and a Connect
 * button — after which it opens), and one response shape means the client has one
 * render path instead of an error branch that forgives itself.
 *
 * A block by the target is answered with that same restricted object — see the
 * note on `restrictedPayload` below for why it reports `private` even when the
 * page is public.
 *
 * @param {object} params
 * @param {string} params.username - The account's nickname (case-insensitive).
 * @param {object|null} [params.viewer] - The signed-in caller, if any. Only ever
 *   used to answer "is this me?" and "are we connected?".
 * @returns {Promise<object|null>} `null` when there is no such account.
 */
async function buildPublicProfile({ username, viewer = null }) {
    if (!isValidNicknameShape(username)) return null;

    const row = await findUserByNickname(username);
    if (!row) return null;

    const userId = String(row.id);
    const viewerId = viewer?.id ? String(viewer.id) : '';
    const isSelf = viewerId === userId;
    const nickname = readNickname(row) || 'Someone';
    const visibility = normalizeProfileVisibility(row.profileVisibility);

    // Answered before the gate, because it is what opens the gate.
    const isConnected = viewerId && !isSelf
        ? await areFriends(viewerId, userId).catch(() => false)
        : false;

    // ── Blocks ──────────────────────────────────────────────────────────────
    // Asked as two separate questions, because the two answers go to two different
    // people and only one of them may be told. `readBlock(a, b)` is directional by
    // construction (`messengerService.blockId`), so this cannot be got backwards.
    const [viewerBlockedThem, theyBlockedViewer] = viewerId && !isSelf
        ? await Promise.all([
            readBlock(viewerId, userId).catch(() => null),
            readBlock(userId, viewerId).catch(() => null),
        ])
        : [null, null];

    /** The viewer's OWN block. Never about the other side, so it cannot leak. */
    const blockedByYou = Boolean(viewerBlockedThem);

    /**
     * The restricted answer: who this is, and the one action that would open it.
     *
     * ⚠️ **A block BY the target is answered with this same object, including a
     * `private` visibility, whatever the setting really says.** That is the whole
     * design: a blocked account must not be able to tell a block from a page that
     * was simply kept private, so the two produce byte-identical responses. The
     * trade-off is deliberate — a blocked viewer of a PUBLIC page is shown the
     * private copy, which is a small inaccuracy told to the one person the block
     * exists to withhold from. Without it, "Private" vs. a slightly different
     * answer would be a block receipt.
     */
    const restrictedPayload = (/** @type {string} */ reportedVisibility) => ({
        nickname,
        visibility: reportedVisibility,
        restricted: true,
        avatar: null,
        memberSince: null,
        connections: 0,
        games: [],
        published: [],
        isSelf: false,
        isConnected: false,
        // Their own block is still reported here, and it has to be: this is the
        // branch a blocker lands in whenever the account they blocked keeps its
        // page private, and without the flag the only way back would be gone.
        blockedByYou,
        canBlock: Boolean(viewerId) && !blockedByYou,
        canConnect: Boolean(viewerId) && !blockedByYou,
        connectedUserId: null,
        isSignedIn: Boolean(viewerId),
    });

    if (theyBlockedViewer) {
        return restrictedPayload(PROFILE_VISIBILITY.PRIVATE);
    }

    if (visibility !== PROFILE_VISIBILITY.PUBLIC && !isSelf && !isConnected) {
        return restrictedPayload(visibility);
    }

    // Each optional section is best-effort: a profile with no games played is the
    // normal case, and a failing scan must not turn the page into an error.
    const [connections, games, published] = await Promise.all([
        countConnections(userId).catch((error) => {
            logger.warn('Could not count connections for a public profile', { userId, error: error.message });
            return 0;
        }),
        getPlayerBoards(userId).catch((error) => {
            logger.warn('Could not read game boards for a public profile', { userId, error: error.message });
            return [];
        }),
        listPublished(userId).catch((error) => {
            logger.warn('Could not list published work for a public profile', { userId, error: error.message });
            return [];
        }),
    ]);

    let avatar = null;
    if (row.profilePicture) {
        const built = await buildAvatar(row.profilePicture).catch(() => null);
        avatar = built?.src || null;
    }

    return {
        nickname,
        visibility,
        /** False for every viewer who was allowed in — the page is readable. */
        restricted: false,
        avatar,
        memberSince: row.createdAt || null,
        connections,
        games,
        published,
        isSelf,
        isConnected,
        blockedByYou,
        // The page offers "Connect" only when that action can actually work — and
        // not to a viewer who has already blocked this account, for whom the
        // offer is the one thing they have explicitly refused.
        canConnect: Boolean(viewerId) && !isSelf && !isConnected && !blockedByYou,
        // "Block" becomes "Unblock" once there is a block, so the two never appear
        // together. Self is excluded by `blockedByYou` too: blocking yourself is
        // rejected by the service (400), so the control must not be offered.
        canBlock: Boolean(viewerId) && !isSelf && !blockedByYou,
        // ⚠️ The only case the internal id is disclosed, and only to someone who is
        // already connected: a DM link is `/net?with=<userId>`, so the viewer needs
        // it to send a message. It is *not* returned to a stranger — "connect"
        // works by username, which is the whole point of the request flow.
        connectedUserId: isConnected ? userId : null,
        // Shown to the viewer, never used to identify the account.
        isSignedIn: Boolean(viewerId),
    };
}

module.exports = {
    PUBLISHED_MAX,
    isMarketCatalogId,
    toPublishedSummary,
    listPublished,
    buildPublicProfile,
};
