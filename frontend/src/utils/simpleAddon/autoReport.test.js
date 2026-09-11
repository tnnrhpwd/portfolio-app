import {
  BUG_REPORT_DEDUPE_KEY,
  BUG_REPORT_DEDUPE_WINDOW_MS,
  friendlyRemoteError,
  isUserConfigError,
  shouldAutoReportError,
  shouldSkipDuplicateBugReport,
} from './autoReport';

/**
 * The exact error texts that were filed as "Simple Auto-Report — LLM Error"
 * tickets. All of them are user-actionable, so none should ever be auto-filed
 * again — this is the regression guard for that report flood.
 */
const TICKETED_ERRORS = [
  '**Error:** Unknown command type: confirm',
  "❌ Couldn't understand that instruction. Try:\n• \"convert to jpg\" / \"png\" / \"webp\"",
  "**Can't reach your PC**\n\nThis page is set up to control a desktop, but the addon isn't currently reachable.",
  '**Usage Limit Reached**\n\nAPI usage limit reached',
];

beforeEach(() => {
  localStorage.clear();
});

describe('isUserConfigError', () => {
  it.each(TICKETED_ERRORS)('suppresses the reported error: %s', (message) => {
    expect(isUserConfigError(message)).toBe(true);
  });

  it('suppresses other known config/auth failures', () => {
    expect(isUserConfigError('Model access restricted')).toBe(true);
    expect(isUserConfigError('Authentication failed (401)')).toBe(true);
    expect(isUserConfigError('Request body too large')).toBe(true);
    expect(isUserConfigError('Please log in to continue')).toBe(true);
  });

  it('does not suppress genuine application errors', () => {
    expect(isUserConfigError('Cannot read properties of undefined')).toBe(false);
    expect(isUserConfigError('')).toBe(false);
    expect(isUserConfigError(undefined)).toBe(false);
  });
});

describe('friendlyRemoteError', () => {
  it('turns a stale-addon command error into an actionable message', () => {
    expect(friendlyRemoteError('Unknown command type: confirm')).toMatch(/addon is out of date/i);
  });

  it('keeps the rewritten message suppressed so it is not reported', () => {
    expect(isUserConfigError(friendlyRemoteError('Unknown command type: confirm'))).toBe(true);
  });

  it('passes unrelated errors through untouched', () => {
    expect(friendlyRemoteError('Something exploded')).toBe('Something exploded');
  });
});

describe('shouldSkipDuplicateBugReport', () => {
  it('reports the first occurrence then skips the repeat', () => {
    expect(shouldSkipDuplicateBugReport('boom')).toBe(false);
    expect(shouldSkipDuplicateBugReport('boom')).toBe(true);
  });

  it('treats a different error as new', () => {
    expect(shouldSkipDuplicateBugReport('boom')).toBe(false);
    expect(shouldSkipDuplicateBugReport('bang')).toBe(false);
  });

  it('allows the same error again once the window has passed', () => {
    const start = 1_000_000;
    expect(shouldSkipDuplicateBugReport('boom', start)).toBe(false);
    expect(shouldSkipDuplicateBugReport('boom', start + BUG_REPORT_DEDUPE_WINDOW_MS + 1)).toBe(false);
  });

  it('only compares the first 200 characters', () => {
    const base = 'x'.repeat(200);
    expect(shouldSkipDuplicateBugReport(`${base} extra detail`)).toBe(false);
    expect(shouldSkipDuplicateBugReport(`${base} different detail`)).toBe(true);
  });

  it('fails open when localStorage is unavailable', () => {
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    try {
      expect(shouldSkipDuplicateBugReport('boom')).toBe(false);
    } finally {
      getItem.mockRestore();
    }
  });

  it('stores the signature under the documented key', () => {
    shouldSkipDuplicateBugReport('boom');
    expect(JSON.parse(localStorage.getItem(BUG_REPORT_DEDUPE_KEY)).signature).toBe('boom');
  });
});

describe('shouldAutoReportError', () => {
  it('reports a new genuine failure', () => {
    expect(shouldAutoReportError('Cannot read properties of undefined')).toBe(true);
  });

  it('never reports a user-actionable failure', () => {
    expect(shouldAutoReportError('API usage limit reached')).toBe(false);
  });

  it('does not report the same genuine failure twice in a row', () => {
    expect(shouldAutoReportError('Cannot read properties of undefined')).toBe(true);
    expect(shouldAutoReportError('Cannot read properties of undefined')).toBe(false);
  });
});
