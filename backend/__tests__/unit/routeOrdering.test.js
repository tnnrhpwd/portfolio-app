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
});
