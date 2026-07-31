// Utility to strip sensitive fields (password hashes) out of the pipe-delimited
// "text" blob used for user records (e.g. "Nickname:x|Email:x|Password:HASH|...").
//
// The password hash must never be logged, cached on req.user, or echoed back in
// an API response. Because the schema-less "Simple" table stores the bcrypt hash
// inline inside the free-text field (not a dedicated column), every place that
// reads a user record needs to scrub it before the value is logged or attached
// to the request. Centralizing that here means new code that logs `user.text`
// is safe as long as it goes through this helper first.

/**
 * Remove the `|Password:<hash>` segment from a user's pipe-delimited text blob.
 * Safe to call on any string; returns the input unchanged if no Password segment exists.
 * @param {string} text
 * @returns {string}
 */
function redactPassword(text) {
    if (typeof text !== 'string' || !text) return text;
    return text.replace(/\|Password:[^|]*/i, '|Password:[redacted]');
}

/**
 * Return a shallow copy of a DynamoDB user item with the password hash redacted
 * from its `text` field. Use this before attaching a user record to `req.user`,
 * caching it, logging it, or returning it in any response.
 * @param {Object} user
 * @returns {Object}
 */
function redactUser(user) {
    if (!user || typeof user !== 'object') return user;
    const { password, ...rest } = user; // drop any literal `password` key too, if present
    if (typeof rest.text === 'string') {
        rest.text = redactPassword(rest.text);
    }
    return rest;
}

module.exports = { redactPassword, redactUser };
