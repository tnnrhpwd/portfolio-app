/**
 * userIdentity.js — read and find the identity of an account row.
 *
 * Account rows in the `Simple` table keep everything in a pipe-delimited `text`
 * blob: `Nickname:x|Email:x|Password:HASH|Birth:x|stripeid:x`. Nothing on the
 * record is a top-level attribute except `id`, `createdAt`, `updatedAt` and
 * (recently) `profilePicture`, so identity has to be parsed out of the blob.
 *
 * This module is the single reader for that, because the *same* question —
 * "who is this row?" — is asked by the profile controller, the reviews
 * ownership check, and the messenger's friend-request lookup, and three copies
 * of the regex is how they drift.
 *
 * ⚠️ `req.user` has already been through `redactUser`, so its `text` carries
 * `|Password:[redacted]`. That is fine: nothing here reads the hash, and the
 * redaction preserves the segment boundaries the regexes rely on.
 */

/** Nickname — the unique, human handle an account signs up with. */
function readNickname(user) {
    if (!user) return '';
    if (typeof user.nickname === 'string' && user.nickname.trim()) return user.nickname.trim();
    const text = typeof user.text === 'string' ? user.text : '';
    const match = text.match(/(?:^|\|)Nickname:([^|]*)/);
    return match ? match[1].trim() : '';
}

/** Email, lowercased — the stable identifier behind a nickname. */
function readEmail(user) {
    if (!user) return '';
    if (typeof user.email === 'string' && user.email.trim()) return user.email.trim().toLowerCase();
    const text = typeof user.text === 'string' ? user.text : '';
    const match = text.match(/(?:^|\|)Email:([^|]*)/);
    return match ? match[1].trim().toLowerCase() : '';
}

/**
 * The public face of an account: what another signed-in user is allowed to see
 * about it. Deliberately just the handle — no email, no rank, no stripe id.
 */
function publicIdentity(user) {
    return {
        userId: String(user?.id ?? ''),
        nickname: readNickname(user) || 'Someone',
    };
}

/** The nickname rules registration enforces (2–40 chars, `a-zA-Z0-9 _.-`). */
const NICKNAME_RE = /^[a-zA-Z0-9 _.-]{2,40}$/;

/** True when `value` could be a nickname at all — a cheap gate before a scan. */
function isValidNicknameShape(value) {
    return typeof value === 'string' && NICKNAME_RE.test(value.trim());
}

module.exports = {
    readNickname,
    readEmail,
    publicIdentity,
    isValidNicknameShape,
    NICKNAME_RE,
};
