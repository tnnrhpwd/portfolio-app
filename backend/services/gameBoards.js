/**
 * gameBoards.js — read the public game leaderboards for a player's profile.
 *
 * The boards already exist: each game writes plain public rows through
 * `POST /api/data/public` with a marker and pipe-delimited fields, and the game
 * page itself scans for them. Nothing new is written here — this is the same data
 * read from the server, so a profile can show "your best 2048 score" without the
 * browser having to load two games to find out.
 *
 * ⚠️ What these numbers are, and are not
 * -------------------------------------
 * The rows are PUBLIC writes and the `UserId:` field is supplied by the client
 * that made them, so a score is **self-reported, not verified**. That is inherent
 * to how the boards have always worked (they also accept a typed `Name:`), and it
 * is why the profile labels the section as coming from the public leaderboards
 * rather than presenting it as an achievement record. Making these verified would
 * mean an authenticated submit path, which is a change to two working games —
 * a deliberate non-goal here.
 *
 * Adding a game is one entry in BOARDS: a marker, which field is the score, and
 * how to order it. `rankLeaderboard` mirrors the ranking each game's own page
 * applies (see `Projects/Rocket/game/cloud.ts`), so a profile's rank matches the
 * board the player sees when they open the game.
 */

const { logger } = require('../utils/logger');
const { paginatedScan } = require('../utils/paginatedScan');

/** The board scan is global (identical for every viewer), so a short cache turns
 * N page views into one scan. */
const CACHE_TTL_MS = 60 * 1000;

const BOARDS = [
    {
        key: 'game2048',
        name: '2048',
        href: '/2048',
        title: 'Highest tile, highest score.',
        marker: 'Game2048Leaderboard',
        primary: 'Score',
        label: 'Best score',
        /** 2048 ranks on score alone. */
        order: (a, b) => b.value - a.value || String(a.at).localeCompare(String(b.at)),
        extra: (fields) => ({ detail: numberOrNull(fields.Tile), detailLabel: 'Best tile' }),
    },
    {
        key: 'rocket',
        name: 'Rocket',
        href: '/rocket',
        title: 'How deep into the asteroid field.',
        marker: 'RocketLeaderboard',
        primary: 'Wave',
        label: 'Best wave',
        /** Farthest wave wins, then the higher score, then whoever got there first. */
        order: (a, b) => b.value - a.value || b.score - a.score || String(a.at).localeCompare(String(b.at)),
        extra: (fields) => ({ score: numberOrNull(fields.Score), detailLabel: 'Best score' }),
    },
];

/**
 * Parse `Key:value` pairs separated by `|` — the house convention for these rows.
 * Colons are re-joined rather than truncated at the first one, because ISO
 * timestamps contain them.
 */
function parseDelimitedFields(text) {
    const fields = {};
    for (const part of String(text ?? '').split('|')) {
        const at = part.indexOf(':');
        if (at === -1) {
            if (part.trim()) fields[part.trim()] = true;
            continue;
        }
        fields[part.slice(0, at).trim()] = part.slice(at + 1);
    }
    return fields;
}

const numberOrNull = (value) => {
    const parsed = parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) ? parsed : null;
};

/** One stored row → one board entry, or `null` if it is not an entry for this board. */
function parseEntry(board) {
    return (item) => {
        const text = item?.text;
        if (typeof text !== 'string' || !text.includes(board.marker)) return null;

        // The row may carry a `Creator:<id>|` prefix or other segments before the
        // marker, so locate it rather than assuming it is first.
        const fields = parseDelimitedFields(text.slice(text.indexOf(board.marker)));
        const value = numberOrNull(fields[board.primary]);
        if (value === null) return null;

        const extra = board.extra ? board.extra(fields) : {};
        return {
            userId: typeof fields.UserId === 'string' ? fields.UserId.trim() : '',
            name: String(fields.Name ?? '').trim() || 'Anonymous',
            at: typeof fields.At === 'string' ? fields.At : (item.createdAt || ''),
            value,
            score: numberOrNull(fields.Score) ?? 0,
            ...extra,
        };
    };
}

/**
 * Collapse every entry into one row per player, best first, and number them.
 *
 * Mirrors the games' own boards: a player appears once (their best), and a player
 * with no `UserId` is keyed by name, so an anonymous entry still takes a place
 * rather than being dropped.
 */
function rankLeaderboard(board, entries = []) {
    const best = new Map();
    for (const entry of entries) {
        if (!entry) continue;
        const key = entry.userId || `anon:${entry.name.toLowerCase()}`;
        const current = best.get(key);
        if (!current || board.order(entry, current) < 0) best.set(key, entry);
    }

    const ranked = [...best.values()].sort((a, b) => board.order(a, b));
    ranked.forEach((entry, index) => { entry.rank = index + 1; });
    return ranked;
}

const cache = new Map(); // board.key → { at, ranked }

/** Read + rank one board, from the cache when it is fresh. */
async function readBoard(board, { now = Date.now(), ttl = CACHE_TTL_MS } = {}) {
    const hit = cache.get(board.key);
    if (hit && now - hit.at < ttl) return hit.ranked;

    const items = await paginatedScan({
        TableName: 'Simple',
        FilterExpression: 'contains(#text, :marker)',
        ExpressionAttributeNames: { '#text': 'text' },
        ExpressionAttributeValues: { ':marker': board.marker },
    });

    const ranked = rankLeaderboard(board, items.map(parseEntry(board)));
    cache.set(board.key, { at: now, ranked });
    logger.debug('Read a game leaderboard', { board: board.key, entries: items.length, players: ranked.length });
    return ranked;
}

/**
 * Where this player sits on every board they have ever posted to.
 *
 * @param {string} userId
 * @returns {Promise<Array<{key,name,href,title,label,value,rank,players,at,detailLabel}>>}
 *   One row per board **they appear on** — a board they have never played is not
 *   a zero, it is absent.
 */
async function getPlayerBoards(userId) {
    const me = String(userId);
    const summaries = [];

    for (const board of BOARDS) {
        // One board failing must not take the whole profile with it.
        let ranked = [];
        try {
            ranked = await readBoard(board);
        } catch (error) {
            logger.warn('Could not read a game leaderboard for a profile', {
                board: board.key, error: error.message,
            });
            continue;
        }

        const mine = ranked.find((entry) => entry.userId && entry.userId === me);
        if (!mine) continue;

        summaries.push({
            key: board.key,
            name: board.name,
            href: board.href,
            title: board.title,
            label: board.label,
            value: mine.value,
            rank: mine.rank,
            players: ranked.length,
            at: mine.at || null,
            detail: mine.detail ?? mine.score ?? null,
            detailLabel: mine.detailLabel || null,
        });
    }

    // Strongest placement first — the number worth leading with.
    return summaries.sort((a, b) => a.rank - b.rank);
}

/** Test seam. */
function _resetBoardCache() {
    cache.clear();
}

module.exports = {
    BOARDS,
    CACHE_TTL_MS,
    parseDelimitedFields,
    parseEntry,
    rankLeaderboard,
    readBoard,
    getPlayerBoards,
    _resetBoardCache,
};
