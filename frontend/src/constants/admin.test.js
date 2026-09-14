import {
  canOpenAdminPath,
  canUseAdminConsole,
  isAdminUser,
  isSpecialUser,
  SPECIAL_ADMIN_PATHS,
} from './admin';

/**
 * Client-side view of the admin gate.
 *
 * This is cosmetic — `backend/middleware/adminAccess.js` is the real boundary —
 * but it decides which tabs render, so a mistake here shows a user a console of
 * links that all 403 (or hides views they legitimately have). The four views a
 * Special account may open are the interesting cases.
 */

const ADMIN = { _id: 'admin-account', isAdmin: true, isSpecial: false };
const SPECIAL = { _id: 'helper-account', isAdmin: false, isSpecial: true };
const PLAIN = { _id: 'ordinary-account', isAdmin: false, isSpecial: false };

describe('isSpecialUser', () => {
  test('is true only for the server-attached flag', () => {
    expect(isSpecialUser(SPECIAL)).toBe(true);
    expect(isSpecialUser(PLAIN)).toBe(false);
    expect(isSpecialUser(ADMIN)).toBe(false);
    expect(isSpecialUser(null)).toBe(false);
    expect(isSpecialUser(undefined)).toBe(false);
  });

  test('does not guess — a session without the flag is not special', () => {
    // Admins get a legacy ID fallback; Special has no client-side equivalent,
    // because there is nothing on the client that records who was flagged.
    expect(isSpecialUser({ _id: 'unknown', nickname: 'whoever' })).toBe(false);
  });
});

describe('canUseAdminConsole', () => {
  test('admits admin and Special, refuses everyone else', () => {
    expect(canUseAdminConsole(ADMIN)).toBe(true);
    expect(canUseAdminConsole(SPECIAL)).toBe(true);
    expect(canUseAdminConsole(PLAIN)).toBe(false);
    expect(canUseAdminConsole(null)).toBe(false);
  });

  test('still admits a legacy admin session that predates the isAdmin flag', () => {
    expect(canUseAdminConsole({ _id: '6770a067c725cbceab958619' })).toBe(true);
    expect(isAdminUser({ _id: '6770a067c725cbceab958619' })).toBe(true);
  });
});

describe('canOpenAdminPath', () => {
  test('admin may open every view', () => {
    expect(canOpenAdminPath(ADMIN, '/admin')).toBe(true);
    expect(canOpenAdminPath(ADMIN, '/admin/users')).toBe(true);
    expect(canOpenAdminPath(ADMIN, '/admin/funnel-tester')).toBe(true);
  });

  test('Special may open exactly the four allowed views', () => {
    SPECIAL_ADMIN_PATHS.forEach((path) => {
      expect(canOpenAdminPath(SPECIAL, path)).toBe(true);
    });
  });

  test('Special is refused the write surfaces', () => {
    ['/admin/users', '/admin/bugs', '/admin/data', '/admin/home-title', '/admin/funnel-tester'].forEach(
      (path) => expect(canOpenAdminPath(SPECIAL, path)).toBe(false),
    );
  });

  test('ignores a trailing slash and a query string', () => {
    expect(canOpenAdminPath(SPECIAL, '/admin/map/')).toBe(true);
    expect(canOpenAdminPath(SPECIAL, '/admin/map?from=1')).toBe(true);
    expect(canOpenAdminPath(SPECIAL, '/admin/map#visits')).toBe(true);
  });

  test('a root-ish or empty path is not silently treated as /admin', () => {
    // `/` used to normalize to `/admin` (trailing slashes stripped, then an
    // `|| '/admin'` fallback), which handed a Special account the dashboard from
    // any root path. Only a real `/admin` counts.
    ['/', '//', '', null, undefined].forEach((path) => {
      expect(canOpenAdminPath(SPECIAL, path)).toBe(false);
    });
    expect(canOpenAdminPath(SPECIAL, '/admin')).toBe(true);
  });

  test('a plain account may open nothing', () => {
    expect(canOpenAdminPath(PLAIN, '/admin')).toBe(false);
    expect(canOpenAdminPath(null, '/admin/map')).toBe(false);
  });
});
