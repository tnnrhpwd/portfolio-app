/**
 * talkUnread.js — "how many unread messages do I have?", as ONE number the whole
 * site can read.
 *
 * The count only exists in the Talk dashboard (`GET /messenger/directory`, which
 * reports `unread` per connection). Two surfaces already fetch that dashboard —
 * `/talk` itself and the /net rail — so the chrome does not ask for the same
 * payload a third time: whoever holds a fresh dashboard PUBLISHES its total here
 * (`publishTalkUnread`), and `useTalkUnread` reads this module. One request per
 * page, whoever made it.
 *
 * Deliberately plain — no React, no redux, no fetch — so the arithmetic and the
 * fan-out can be tested on their own. The hook owns the fetching, the badge
 * component owns the drawing.
 *
 * ⚠️ The value is keyed by TOKEN. An unread count is one account's business, and
 * this module outlives a sign-out (logging out does not reload the page), so a
 * reader holding a different token must never be handed the previous account's
 * number — `readTalkUnread` answers 0 for anyone else, and `publishTalkUnread`
 * refuses an empty token rather than storing "the signed-out user has 3".
 */

/**
 * Total unread messages across an account's connections.
 *
 * Tolerant on purpose: the dashboard's own shape is the server's business, and a
 * badge must never be the thing that throws. A missing list is 0, a missing
 * `unread` is 0, and a stringified count still counts.
 *
 * @param {Array<{unread?: number|string}>} [contacts] - `directory.contacts`.
 * @returns {number}
 */
export function sumUnread(contacts) {
  if (!Array.isArray(contacts)) return 0;
  return contacts.reduce((total, contact) => total + (Number(contact?.unread) || 0), 0);
}

/** `{ token, unread, at }` — the last published value, and when it arrived. */
let snapshot = { token: '', unread: 0, at: 0 };

const listeners = new Set();

/**
 * The published count, for a given account. 0 for anyone else (including a
 * signed-out reader), so a stale number can never be shown to the wrong user.
 *
 * @param {string} token - The reader's JWT.
 * @returns {number}
 */
export function readTalkUnread(token) {
  const key = token || '';
  return key && snapshot.token === key ? snapshot.unread : 0;
}

/**
 * How long ago the current value was published, in ms — `Infinity` when there is
 * nothing for this account yet. The hook uses it to skip a fetch that another
 * component made seconds ago.
 *
 * @param {string} token
 * @param {number} [now] - Injectable clock, so the check is testable.
 * @returns {number}
 */
export function talkUnreadAge(token, now = Date.now()) {
  const key = token || '';
  if (!key || snapshot.token !== key) return Infinity;
  return Math.max(0, now - snapshot.at);
}

/**
 * Publish a count — from a dashboard the caller already fetched, or from the
 * hook's own poll. A repeat of the same number only renews its freshness: there
 * is nothing to re-render, and the freshness matters because it says "someone
 * just asked the server".
 *
 * @param {string} token - The account the count belongs to.
 * @param {number} unread
 */
export function publishTalkUnread(token, unread) {
  const key = token || '';
  if (!key) return;

  const count = Number(unread) || 0;
  const unchanged = snapshot.token === key && snapshot.unread === count;
  snapshot = { token: key, unread: count, at: Date.now() };
  if (unchanged) return;

  listeners.forEach((listener) => listener(snapshot));
}

/** Forget everything — sign-out, and the test suite's reset between cases. */
export function resetTalkUnread() {
  snapshot = { token: '', unread: 0, at: 0 };
  listeners.forEach((listener) => listener(snapshot));
}

/**
 * Listen for publishes. The listener receives the whole snapshot (token and all),
 * because it is the reader's job to decide whether the value is theirs — which is
 * the only way a listener can also observe a publish that means "not yours".
 *
 * @param {(snapshot: {token: string, unread: number, at: number}) => void} listener
 * @returns {() => void} unsubscribe
 */
export function subscribeTalkUnread(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
