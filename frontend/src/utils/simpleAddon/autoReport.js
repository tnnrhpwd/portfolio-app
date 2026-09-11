/**
 * Auto bug-report policy for the Simple addon chat.
 *
 * The chat files a bug report automatically whenever an error message lands in
 * the transcript. Left unfiltered that floods the Support → My Reports tracker
 * with duplicates for things that are not application bugs: a rate limit, an
 * offline addon, an out-of-date addon build, or a file instruction the parser
 * simply couldn't read.
 *
 * Two gates apply, in order:
 *   1. `isUserConfigError` — the error already tells the user how to fix it
 *      (config / auth / limits / offline addon / unparsable input), so it is
 *      never an application bug.
 *   2. `shouldSkipDuplicateBugReport` — anything else is reported at most once
 *      per 24h per device, so one recurring failure cannot fill the tracker.
 *
 * Kept as pure functions (only `shouldSkipDuplicateBugReport` touches
 * localStorage) so the policy is unit-tested — see autoReport.test.js.
 */

/**
 * Known, user-actionable errors that already show clear remediation steps in
 * the chat itself. These are not application bugs.
 */
export const KNOWN_CONFIG_ERROR_PATTERNS = [
  /not configured/i,
  /addon is not running/i,
  /can't reach your pc/i,
  /remote addon/i,
  /remote confirmation/i,
  /addon is out of date/i,
  /no access to model/i,
  /model access restricted/i,
  /authentication failed \(401\)/i,
  /rate limit/i,
  /usage limit/i,
  /could not find model/i,
  /request body too large/i,
  /\(413\)/,
  /couldn't understand that instruction/i,
  /unknown command type/i,
  /please log in/i,
];

/** True when `message` is a known, user-actionable error (never auto-reported). */
export const isUserConfigError = (message = '') =>
  KNOWN_CONFIG_ERROR_PATTERNS.some((pattern) => pattern.test(message));

/**
 * Map a raw relay error to a clearer, user-actionable message instead of
 * leaking it verbatim into the chat (and into the auto bug-report queue).
 *
 * `unknown command type` means the desktop addon is running an older build that
 * doesn't understand a command the web app just sent it (e.g. `confirm`).
 */
export const friendlyRemoteError = (message = '') => {
  if (/unknown command type/i.test(message)) {
    return "Your desktop addon is out of date and can't run this request. Please update the Simple addon on your PC, then retry.";
  }
  return message;
};

/** Re-submission window for the exact same recurring error. */
export const BUG_REPORT_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const BUG_REPORT_DEDUPE_KEY = 'csimple_last_auto_bug_report';

/**
 * True when this exact error was already auto-reported within the dedupe
 * window. Records the signature as a side effect when it isn't a duplicate.
 * Falls back to reporting (returns false) when localStorage is unavailable —
 * a rare duplicate beats losing a real report.
 */
export const shouldSkipDuplicateBugReport = (content, now = Date.now()) => {
  const signature = (content || '').slice(0, 200);
  try {
    const stored = JSON.parse(localStorage.getItem(BUG_REPORT_DEDUPE_KEY) || '{}');
    if (stored.signature === signature && now - stored.timestamp < BUG_REPORT_DEDUPE_WINDOW_MS) {
      return true;
    }
    localStorage.setItem(BUG_REPORT_DEDUPE_KEY, JSON.stringify({ signature, timestamp: now }));
  } catch {
    // localStorage unavailable — fall back to reporting
  }
  return false;
};

/**
 * Single decision point used by the chat: should this error message be filed as
 * a bug report? Returns true only for genuine, non-duplicate failures.
 */
export const shouldAutoReportError = (content) =>
  !isUserConfigError(content) && !shouldSkipDuplicateBugReport(content);
