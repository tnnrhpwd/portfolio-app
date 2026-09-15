/**
 * routeData.js route-ordering guard.
 *
 * Express matches routes in declaration order, so any single-segment route
 * registered with the same verb as the generic `router.route('/:id')` handler
 * AFTER it is unreachable — the request is captured as `/:id` instead. That
 * exact bug shipped twice: `PUT /api/data/profile` and
 * `PUT /api/data/email-preferences` both silently hit `putHashData` and 404'd
 * with "Data item not found".
 *
 * Loading the real router here isn't practical (it pulls in every controller,
 * several of which import AWS SDK ESM builds Jest can't parse), so this asserts
 * the declared order directly in the source.
 */

const fs = require('fs');
const path = require('path');

const ROUTES_PATH = path.join(__dirname, '../../routes/routeData.js');

describe('routeData.js route ordering', () => {
  const source = fs.readFileSync(ROUTES_PATH, 'utf8');

  const indexOf = (needle) => source.indexOf(needle);

  it('declares the generic /:id handler exactly once', () => {
    expect(indexOf("router.route('/:id')")).toBeGreaterThan(-1);
    expect(source.match(/router\.route\('\/:id'\)/g)).toHaveLength(1);
  });

  it('registers PUT /profile before the generic /:id route', () => {
    const profileIndex = indexOf("router.put('/profile'");
    expect(profileIndex).toBeGreaterThan(-1);
    expect(profileIndex).toBeLessThan(indexOf("router.route('/:id')"));
  });

  it('registers /email-preferences before the generic /:id route', () => {
    const prefsIndex = indexOf("router.route('/email-preferences')");
    expect(prefsIndex).toBeGreaterThan(-1);
    expect(prefsIndex).toBeLessThan(indexOf("router.route('/:id')"));
  });

  // A review is a PUBLIC row (created through POST /public, so it carries no
  // `Creator:` segment) — the generic `PUT /:id` can never edit one. The
  // dedicated routes are two-segment, so they cannot be captured by `/:id`, but
  // they are declared above it so the ordering is obvious rather than accidental.
  it('registers the review routes before the generic /:id route', () => {
    const listIndex = indexOf("router.route('/reviews/mine')");
    const editIndex = indexOf("router.route('/reviews/:id')");
    expect(listIndex).toBeGreaterThan(-1);
    expect(editIndex).toBeGreaterThan(-1);
    expect(listIndex).toBeLessThan(indexOf("router.route('/:id')"));
    expect(editIndex).toBeLessThan(indexOf("router.route('/:id')"));
  });

  it('registers every messenger route before the generic /:id route', () => {
    const generic = indexOf("router.route('/:id')");
    const messengerRoutes = [
      "'/messenger/directory'",
      "'/messenger/peers/:userId'",
      "'/messenger/avatars'",
      "'/messenger/requests'",
      "'/messenger/requests/:userId/accept'",
      "'/messenger/requests/:userId/decline'",
      "'/messenger/contacts/:userId'",
      "'/messenger/conversations/:userId/messages'",
      "'/messenger/conversations/:userId/read'",
    ];
    for (const route of messengerRoutes) {
      const at = indexOf(route);
      expect(at).toBeGreaterThan(-1);
      expect(at).toBeLessThan(generic);
    }
  });

  // ⚠️ `/messenger/requests` (send) and `/messenger/requests/:userId/accept`
  // differ by method AND depth, but `/messenger/requests/:userId` (cancel) is a
  // DELETE on the same path the POST above uses — that is intentional and not a
  // collision, so what actually matters is that no message route is declared
  // AFTER a broader route on the same path, which the loop above covers.
  it('does not declare the same messenger path twice with the same verb', () => {
    const declarations = source.match(/router\.(get|post|delete|put)\('(\/messenger\/[^']*)'/g) || [];
    expect(declarations.length).toBeGreaterThan(0);
    expect(new Set(declarations).size).toBe(declarations.length);
  });
});
