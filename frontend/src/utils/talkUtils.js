/**
 * talkUtils.js — pure helpers for the Talk messenger UI.
 *
 * Kept out of the components so they can be unit-tested without a DOM: the
 * relative-time wording, the initials fallback, and the "how much of my request
 * budget is left" copy are all things a user reads literally, and each has a
 * boundary case that is easy to get wrong.
 */

export const TALK_LIMITS_FALLBACK = {
  pendingOutMax: 20,
  requestsPerHour: 10,
  requestsPerDay: 40,
  contactsMax: 200,
  bodyMax: 4000,
};

/** Up to two initials from a nickname, for the avatar circle. */
export const initials = (nickname) => {
  const words = String(nickname || '')
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
};

/**
 * "just now" → "5m" → "3h" → "2d" → "Mar 4".
 *
 * Deliberately coarse: this labels a list row, and a conversation list that says
 * "47 seconds ago" reads as a debug readout rather than as a message list.
 *
 * ⚠️ A missing or empty value returns '' rather than a date: `new Date(null)` is
 * epoch 0, which is a perfectly valid timestamp and would render as "Dec 31" —
 * a row with no date at all looked like a message from 1969.
 */
export const relativeTime = (iso, now = Date.now()) => {
  if (!iso) return '';
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return '';
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/** "09:41" — the time stamp under a sent message. */
export const clockTime = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

/** "Mar 4, 2026" — the day divider between messages. */
export const dayLabel = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(date, today)) return 'Today';
  if (sameDay(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

/**
 * The one line that explains the request budget, in the reader's terms.
 *
 * Prefers the *tightest* constraint rather than listing all of them: "3 requests
 * left today" is actionable, "you have sent 7 of 10 this hour and 12 of 40 today"
 * is a readout nobody parses.
 */
export const requestBudgetHint = (remaining = {}, limits = TALK_LIMITS_FALLBACK) => {
  const { thisHour = 0, today = 0, pendingOut = 0 } = remaining;
  if (pendingOut <= 0) return `You have ${limits.pendingOutMax} requests waiting for an answer — wait for one before sending more.`;
  if (thisHour <= 0) return 'You have sent your hourly limit of requests. Try again in an hour.';
  if (today <= 0) return 'You have sent your daily limit of requests. Try again tomorrow.';
  if (thisHour <= 3) return `${thisHour} request${thisHour === 1 ? '' : 's'} left this hour.`;
  return `${today} request${today === 1 ? '' : 's'} left today.`;
};

/**
 * Group messages into day buckets for the divider, preserving order.
 * @returns {Array<{ label: string, messages: Array }>}
 */
export const groupByDay = (messages = []) => {
  const groups = [];
  for (const message of messages) {
    const label = dayLabel(message.sentAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.messages.push(message);
    else groups.push({ label, messages: [message] });
  }
  return groups;
};

/**
 * Friendly text for a failed messenger call.
 *
 * The backend already writes user-facing messages ("No account with that
 * username", "That request was declined…"), so this passes those through and
 * only replaces the ones that would leak plumbing (a 500, a network failure).
 */
export const messengerErrorMessage = (error, fallback = 'Something went wrong. Please try again.') => {
  const message = error?.message || '';
  if (!message) return fallback;
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return 'Could not reach the server. Check your connection and try again.';
  }
  if (error?.status >= 500) return 'The server had a problem. Please try again in a moment.';
  return message;
};
