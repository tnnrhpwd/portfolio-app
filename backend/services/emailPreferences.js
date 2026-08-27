/**
 * Email notification preferences.
 *
 * Stored on the user's DynamoDB record (`text` field) as pipe-delimited
 * fields, matching the existing `Nickname:` / `Email:` / `Rank:` convention:
 *   |EmailBilling:true|EmailProduct:true|EmailMarketing:false
 *
 * Categories:
 *   - account   : password resets, welcome, security alerts — ALWAYS on
 *                 (transactional; not stored and not toggleable).
 *   - billing   : plan changes, receipts, subscription updates — default ON.
 *   - product   : product updates, feature announcements — default ON.
 *   - marketing : promotions, newsletters — default OFF (opt-in).
 */

const DEFAULTS = Object.freeze({
  account: true, // always on — not stored
  billing: true,
  product: true,
  marketing: false,
});

// Map each toggleable category to its pipe field name in the user's `text`.
const FIELD_BY_CATEGORY = Object.freeze({
  billing: 'EmailBilling',
  product: 'EmailProduct',
  marketing: 'EmailMarketing',
});

/** Toggleable categories (everything except the always-on `account`). */
const TOGGLEABLE_CATEGORIES = Object.keys(FIELD_BY_CATEGORY);

/** Read a single pipe field from the user text. Returns undefined if absent. */
function readField(text, field) {
  if (!text || typeof text !== 'string') return undefined;
  const m = text.match(new RegExp(`\\|${field}:([^|]*)`));
  return m ? m[1] : undefined;
}

/**
 * Read a user's effective email preferences, applying defaults for anything
 * not explicitly stored. `account` is always true.
 * @param {string} text - User record `text` field
 * @returns {{account:boolean,billing:boolean,product:boolean,marketing:boolean}}
 */
function getEmailPreferences(text) {
  const prefs = { account: true };
  for (const category of TOGGLEABLE_CATEGORIES) {
    const raw = readField(text, FIELD_BY_CATEGORY[category]);
    prefs[category] = raw === undefined ? DEFAULTS[category] : raw === 'true';
  }
  return prefs;
}

/**
 * Whether an email in `category` should be sent to this user.
 * `account` (transactional) is always true.
 * @param {string} text - User record `text` field
 * @param {string} category - 'account' | 'billing' | 'product' | 'marketing'
 * @returns {boolean}
 */
function shouldSendEmail(text, category) {
  if (category === 'account') return true;
  if (!(category in FIELD_BY_CATEGORY)) return false;
  return getEmailPreferences(text)[category] !== false;
}

/**
 * Merge `updates` into the user's `text`, writing (or inserting) the pipe
 * fields for the toggleable categories. Returns the new text with any
 * existing fields in place (including `Password:`) untouched.
 * @param {string} text - Existing user record `text`
 * @param {Object} updates - e.g. { billing: false, marketing: true }
 * @returns {string}
 */
function updateEmailPreferencesInText(text, updates) {
  let next = text || '';
  for (const category of TOGGLEABLE_CATEGORIES) {
    if (!(category in updates)) continue;
    const field = FIELD_BY_CATEGORY[category];
    const value = updates[category] ? 'true' : 'false';
    const re = new RegExp(`\\|${field}:[^|]*`);
    if (re.test(next)) {
      next = next.replace(re, `|${field}:${value}`);
    } else {
      next = `${next}|${field}:${value}`;
    }
  }
  return next;
}

module.exports = {
  DEFAULTS,
  TOGGLEABLE_CATEGORIES,
  getEmailPreferences,
  shouldSendEmail,
  updateEmailPreferencesInText,
};
