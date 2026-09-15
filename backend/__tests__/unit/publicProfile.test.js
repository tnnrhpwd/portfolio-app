/**
 * publicProfile.test.js — what a stranger may see about an account.
 *
 * The most important assertions here are the negative ones: this endpoint is
 * PUBLIC, so the test that matters is that an email, a plan, an internal id or a
 * private collection cannot reach it. The shape is built by listing what to
 * include, and these tests pin that down.
 */

jest.mock('../../services/messengerService', () => ({
  findUserByNickname: jest.fn(),
  countConnections: jest.fn(async () => 0),
  areFriends: jest.fn(async () => false),
  readBlock: jest.fn(async () => null),
}));

jest.mock('../../services/avatarService', () => ({
  buildAvatar: jest.fn(async () => ({ src: 'data:image/jpeg;base64,AVATAR', etag: 'e' })),
}));

jest.mock('../../services/gameBoards', () => ({
  getPlayerBoards: jest.fn(async () => []),
}));

jest.mock('../../utils/paginatedScan', () => ({
  paginatedScan: jest.fn(async () => []),
}));

const { findUserByNickname, countConnections, areFriends, readBlock } = require('../../services/messengerService');
const { buildAvatar } = require('../../services/avatarService');
const { getPlayerBoards } = require('../../services/gameBoards');
const { paginatedScan } = require('../../utils/paginatedScan');
const {
  buildPublicProfile,
  isMarketCatalogId,
  toPublishedSummary,
} = require('../../services/publicProfile');

/**
 * An account row with every private field it really carries.
 *
 * ⚠️ No `profileVisibility` — which is the point: an account created before the
 * visibility setting existed reads as **private**, so this helper is the private
 * case. Tests that inspect a FULL profile must ask for `publicRow()` instead, or
 * they would be asserting against a restricted response.
 */
const accountRow = (overrides = {}) => ({
  id: 'user-1',
  createdAt: '2025-08-29T01:22:39.486Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  profilePicture: 'data:image/jpeg;base64,ORIGINAL',
  text: 'Nickname:Guest User|Email:guest@example.com|Password:$2a$10$HASH|Birth:2000-01-01|stripeid:cus_secret|Rank:Pro|Special:true',
  ...overrides,
});

/** The same account with its page published. */
const publicRow = (overrides = {}) => accountRow({ profileVisibility: 'public', ...overrides });

beforeEach(() => {
  jest.clearAllMocks();
  findUserByNickname.mockResolvedValue(accountRow());
  countConnections.mockResolvedValue(0);
  areFriends.mockResolvedValue(false);
  readBlock.mockResolvedValue(null);
  getPlayerBoards.mockResolvedValue([]);
  paginatedScan.mockResolvedValue([]);
  buildAvatar.mockResolvedValue({ src: 'data:image/jpeg;base64,AVATAR', etag: 'e' });
});

describe('what is public', () => {
  beforeEach(() => {
    // These tests are about the FULL profile path, which now requires the page to
    // be public. The private default is covered in its own describe below.
    findUserByNickname.mockResolvedValue(publicRow());
  });

  test('identity, join date and the downscaled avatar', async () => {
    const profile = await buildPublicProfile({ username: 'Guest User' });
    expect(profile).toMatchObject({
      nickname: 'Guest User',
      avatar: 'data:image/jpeg;base64,AVATAR',
      memberSince: '2025-08-29T01:22:39.486Z',
    });
    // The 512px original is never handed to a stranger.
    expect(JSON.stringify(profile)).not.toContain('ORIGINAL');
  });

  test('⚠️ never an email, a plan, a stripe id, a hash, or the internal id', async () => {
    const serialised = JSON.stringify(await buildPublicProfile({ username: 'Guest User' }));
    for (const secret of ['guest@example.com', 'cus_secret', 'Password', '$2a$10$HASH', 'Rank', 'Pro', 'Special']) {
      expect(serialised).not.toContain(secret);
    }
    // The id is not even a field — a DM link is the only thing that needs it, and
    // only a connected viewer gets that.
    expect(serialised).not.toContain('user-1');
  });

  test('counts and board rows are passed through', async () => {
    countConnections.mockResolvedValue(4);
    getPlayerBoards.mockResolvedValue([{ key: 'game2048', value: 5188, rank: 1, players: 2 }]);
    const profile = await buildPublicProfile({ username: 'Guest User' });
    expect(profile.connections).toBe(4);
    expect(profile.games).toHaveLength(1);
  });

  test('an account with no picture simply has no avatar', async () => {
    findUserByNickname.mockResolvedValue(accountRow({ profilePicture: undefined }));
    const profile = await buildPublicProfile({ username: 'Guest User' });
    expect(profile.avatar).toBeNull();
    expect(buildAvatar).not.toHaveBeenCalled();
  });

  test('a picture that cannot be decoded degrades to no avatar, not an error', async () => {
    buildAvatar.mockRejectedValue(new Error('corrupt'));
    const profile = await buildPublicProfile({ username: 'Guest User' });
    expect(profile.avatar).toBeNull();
  });
});
describe('unknown and invalid usernames', () => {  test('no account → null (the controller turns that into a 404)', async () => {
    findUserByNickname.mockResolvedValue(null);
    expect(await buildPublicProfile({ username: 'Nobody Here' })).toBeNull();
  });

  test('a shape that could not be a nickname never reaches a lookup', async () => {
    expect(await buildPublicProfile({ username: 'x' })).toBeNull();
    expect(await buildPublicProfile({ username: 'bad|pipe' })).toBeNull();
    expect(await buildPublicProfile({ username: '' })).toBeNull();
    expect(findUserByNickname).not.toHaveBeenCalled();
  });
});

describe('the viewer-dependent answers', () => {
  test('signed out: no connect, no self, not connected', async () => {
    const profile = await buildPublicProfile({ username: 'Guest User' });
    expect(profile).toMatchObject({ isSelf: false, isConnected: false, canConnect: false, isSignedIn: false });
    expect(areFriends).not.toHaveBeenCalled();
  });

  test('someone else, not yet connected: connect is offered', async () => {
    const profile = await buildPublicProfile({ username: 'Guest User', viewer: { id: 'viewer-1' } });
    expect(profile).toMatchObject({ isSelf: false, isConnected: false, canConnect: true, isSignedIn: true });
  });

  test('already connected: message is offered and the id comes back for the link', async () => {
    areFriends.mockResolvedValue(true);
    const profile = await buildPublicProfile({ username: 'Guest User', viewer: { id: 'viewer-1' } });
    expect(profile).toMatchObject({ isConnected: true, canConnect: false, connectedUserId: 'user-1' });
  });

  test('my own page: no connect, no message, and no id disclosed', async () => {
    const profile = await buildPublicProfile({ username: 'Guest User', viewer: { id: 'user-1' } });
    expect(profile).toMatchObject({ isSelf: true, isConnected: false, canConnect: false, connectedUserId: null });
    expect(areFriends).not.toHaveBeenCalled();
  });
});

describe('a failing optional section does not break the page', () => {
  beforeEach(() => {
    // A public page, or the sections would never be reached and these tests would
    // pass without exercising anything.
    findUserByNickname.mockResolvedValue(publicRow());
  });

  test.each([
    ['connections', () => countConnections.mockRejectedValue(new Error('boom'))],
    ['games', () => getPlayerBoards.mockRejectedValue(new Error('boom'))],
    ['published', () => paginatedScan.mockRejectedValue(new Error('boom'))],
  ])('%s', async (_label, breakIt) => {
    breakIt();
    const profile = await buildPublicProfile({ username: 'Guest User' });
    expect(profile.nickname).toBe('Guest User');
    expect(profile.avatar).toBeTruthy();
  });
});

describe('isMarketCatalogId', () => {
  test('accepts a catalog entry', () => {
    expect(isMarketCatalogId('csimple_market_abc123')).toBe(true);
    expect(isMarketCatalogId('csimple_market_sort-my-downloads')).toBe(true);
  });

  test('⚠️ rejects every sibling row that shares the namespace', () => {
    // Listing these as "published work" would show one skill several times over,
    // or list a rate-limit row as a publication.
    expect(isMarketCatalogId('csimple_market_abc_v2')).toBe(false);
    expect(isMarketCatalogId('csimple_market_abc_v10')).toBe(false);
    expect(isMarketCatalogId('csimple_market_abc_install_user-1')).toBe(false);
    expect(isMarketCatalogId('csimple_market_abc_v1_rating_user-1')).toBe(false);
    expect(isMarketCatalogId('csimple_market_abc_flag_user-1_123')).toBe(false);
    expect(isMarketCatalogId('csimple_market_author_user-1')).toBe(false);
    expect(isMarketCatalogId('csimple_ws_user-1_skill_thing')).toBe(false);
    expect(isMarketCatalogId('')).toBe(false);
  });
});

describe('toPublishedSummary', () => {
  test('maps a meta row and derives the average rating', () => {
    const summary = toPublishedSummary({
      id: 'csimple_market_abc',
      kind: 'goal',
      name: 'Sort my Downloads',
      naturalLanguageDescription: 'Tidy the folder.',
      latestVersion: 3,
      downloads: 12,
      installs: 4,
      ratingCount: 4,
      ratingSum: 18,
      firstPublishedAt: '2026-09-12T18:08:43.552Z',
    });

    expect(summary).toMatchObject({
      marketId: 'abc',
      kind: 'goal',
      name: 'Sort my Downloads',
      version: 3,
      downloads: 12,
      ratingCount: 4,
      avgRating: 4.5,
      publishedAt: '2026-09-12T18:08:43.552Z',
    });
  });

  test('no ratings is 0 stars, not a division by zero', () => {
    const summary = toPublishedSummary({ id: 'csimple_market_a', name: 'X', ratingCount: 0, ratingSum: 0 });
    expect(summary.avgRating).toBe(0);
    expect(Number.isNaN(summary.avgRating)).toBe(false);
  });

  test('a missing kind is a skill (everything written before goals existed is one)', () => {
    expect(toPublishedSummary({ id: 'csimple_market_a', name: 'X' }).kind).toBe('skill');
  });

  test('a very long description is clipped', () => {
    const summary = toPublishedSummary({ id: 'csimple_market_a', name: 'X', naturalLanguageDescription: 'y'.repeat(500) });
    expect(summary.description).toHaveLength(240);
  });
});

/**
 * Visibility — the gate on the whole page.
 *
 * Private is the DEFAULT (an account row with no attribute at all), so the first
 * two tests are the ones that matter most: they are what an existing account gets.
 */
describe('profile visibility', () => {
  /** Every field a restricted response must NOT carry. */
  const assertNothingLeaked = (profile) => {
    expect(profile).toMatchObject({
      restricted: true,
      avatar: null,
      memberSince: null,
      connections: 0,
      games: [],
      published: [],
      connectedUserId: null,
    });
  };

  test('⚠️ an account with no setting at all is private', async () => {
    const profile = await buildPublicProfile({ username: 'Guest User' });
    expect(profile.visibility).toBe('private');
    assertNothingLeaked(profile);
  });

  test('⚠️ and private means no work is done to build the page', async () => {
    await buildPublicProfile({ username: 'Guest User' });
    // Not merely hidden from the response — never fetched.
    expect(buildAvatar).not.toHaveBeenCalled();
    expect(getPlayerBoards).not.toHaveBeenCalled();
    expect(paginatedScan).not.toHaveBeenCalled();
    expect(countConnections).not.toHaveBeenCalled();
  });

  test('private still says who this is, and offers the way in', async () => {
    const profile = await buildPublicProfile({ username: 'Guest User', viewer: { id: 'viewer-1' } });
    expect(profile.nickname).toBe('Guest User');
    expect(profile.canConnect).toBe(true);
    expect(profile.isSignedIn).toBe(true);
  });

  test('an unrecognised setting is treated as private, never as public', async () => {
    findUserByNickname.mockResolvedValue(accountRow({ profileVisibility: 'yes' }));
    const profile = await buildPublicProfile({ username: 'Guest User' });
    expect(profile.visibility).toBe('private');
    assertNothingLeaked(profile);
  });

  test('an explicit "public" opens the page to anyone', async () => {
    findUserByNickname.mockResolvedValue(accountRow({ profileVisibility: 'public' }));
    countConnections.mockResolvedValue(2);

    const profile = await buildPublicProfile({ username: 'Guest User' });
    expect(profile).toMatchObject({ visibility: 'public', restricted: false, connections: 2 });
    expect(profile.avatar).toBeTruthy();
  });

  test('the owner sees their own private page in full, and is told it is private', async () => {
    const profile = await buildPublicProfile({ username: 'Guest User', viewer: { id: 'user-1' } });
    expect(profile).toMatchObject({ isSelf: true, restricted: false, visibility: 'private' });
    expect(profile.avatar).toBeTruthy();
  });

  test('a connection sees a private page in full', async () => {
    areFriends.mockResolvedValue(true);
    const profile = await buildPublicProfile({ username: 'Guest User', viewer: { id: 'viewer-1' } });

    expect(profile).toMatchObject({
      restricted: false,
      visibility: 'private',
      isConnected: true,
      connectedUserId: 'user-1',
    });
  });

  test('a signed-in stranger does not, but can connect', async () => {
    const profile = await buildPublicProfile({ username: 'Guest User', viewer: { id: 'viewer-1' } });
    expect(profile).toMatchObject({ restricted: true, canConnect: true, isConnected: false });
  });

  test('a signed-out visitor does not, and is offered no connect', async () => {
    const profile = await buildPublicProfile({ username: 'Guest User' });
    expect(profile).toMatchObject({ restricted: true, canConnect: false, isSignedIn: false });
  });

  test('the friendship check runs only when it can change the answer', async () => {
    // Own page: allowed regardless, so no need to ask.
    await buildPublicProfile({ username: 'Guest User', viewer: { id: 'user-1' } });
    expect(areFriends).not.toHaveBeenCalled();

    // Public page, signed out: nobody to check.
    findUserByNickname.mockResolvedValue(accountRow({ profileVisibility: 'public' }));
    await buildPublicProfile({ username: 'Guest User' });
    expect(areFriends).not.toHaveBeenCalled();

    // Private page, signed in as someone else: this is the check that decides it.
    findUserByNickname.mockResolvedValue(accountRow());
    await buildPublicProfile({ username: 'Guest User', viewer: { id: 'viewer-1' } });
    expect(areFriends).toHaveBeenCalledWith('viewer-1', 'user-1');
  });
});

/**
 * Blocks (docs/implementation/agent.md §19.4).
 *
 * The rule under test is asymmetric, and the asymmetry is the whole feature:
 * the account that HAS been blocked must not be able to tell (§19.2's "restricted
 * is a 200" is what makes that possible — the blocked answer IS the private
 * answer), while the account that DID the blocking must be told, or the block
 * could never be lifted.
 */
describe('blocks', () => {
  /** The viewer has blocked the account the page belongs to. */
  const viewerBlockedThem = () => readBlock.mockImplementation(async (blocker, blocked) => (
    blocker === 'viewer-1' && blocked === 'user-1' ? { id: 'msg_block_viewer-1_user-1' } : null
  ));

  /** The account the page belongs to has blocked the viewer. */
  const theyBlockedViewer = () => readBlock.mockImplementation(async (blocker, blocked) => (
    blocker === 'user-1' && blocked === 'viewer-1' ? { id: 'msg_block_user-1_viewer-1' } : null
  ));

  test('⚠️ a block closes a PUBLIC page — visibility is not a way around it', async () => {
    findUserByNickname.mockResolvedValue(publicRow());
    theyBlockedViewer();

    const profile = await buildPublicProfile({ username: 'Guest User', viewer: { id: 'viewer-1' } });

    expect(profile).toMatchObject({
      restricted: true,
      avatar: null,
      memberSince: null,
      connections: 0,
      games: [],
      published: [],
    });
    // Not merely hidden — never gathered. Same promise the private gate makes.
    expect(buildAvatar).not.toHaveBeenCalled();
    expect(getPlayerBoards).not.toHaveBeenCalled();
    expect(paginatedScan).not.toHaveBeenCalled();
  });

  test('⚠️ the blocked viewer cannot tell a block from a private page', async () => {
    // Two runs over the SAME account: one because it is private, one because the
    // viewer is blocked and the page is public. The payloads have to be equal —
    // any difference at all is a block receipt, and this is the assertion that
    // fails the moment someone adds a "blocked" flag to the restricted branch.
    const privateAnswer = await buildPublicProfile({ username: 'Guest User', viewer: { id: 'viewer-1' } });

    findUserByNickname.mockResolvedValue(publicRow());
    theyBlockedViewer();
    const blockedAnswer = await buildPublicProfile({ username: 'Guest User', viewer: { id: 'viewer-1' } });

    expect(blockedAnswer).toEqual(privateAnswer);
    // Including the visibility it reports, which is the one deliberate inaccuracy.
    expect(blockedAnswer.visibility).toBe('private');
  });

  test('and the blocked viewer is still offered Connect, exactly as before', async () => {
    theyBlockedViewer();
    const profile = await buildPublicProfile({ username: 'Guest User', viewer: { id: 'viewer-1' } });
    // The server refuses the request itself (a decline-shaped refusal, see
    // messengerService.declinedError). Withholding the button would be a tell.
    expect(profile.canConnect).toBe(true);
    expect(profile.blockedByYou).toBe(false);
  });

  test('the viewer\u2019s own block IS reported, or it could never be lifted', async () => {
    findUserByNickname.mockResolvedValue(publicRow());
    viewerBlockedThem();

    const profile = await buildPublicProfile({ username: 'Guest User', viewer: { id: 'viewer-1' } });

    expect(profile).toMatchObject({ blockedByYou: true, restricted: false });
    // Block and Unblock are never offered together, and the connect offer is the
    // one thing a blocker has already refused.
    expect(profile.canBlock).toBe(false);
    expect(profile.canConnect).toBe(false);
  });

  test('and it survives the other account keeping its page private', async () => {
    // The common case after blocking someone you were connected to: their page is
    // private, so the blocker lands in the restricted branch — and that branch is
    // the only place the Unblock control can live.
    viewerBlockedThem();

    const profile = await buildPublicProfile({ username: 'Guest User', viewer: { id: 'viewer-1' } });

    expect(profile).toMatchObject({ restricted: true, blockedByYou: true, canBlock: false });
  });

  test('blocks are one-directional: the blocker keeps reading the page', async () => {
    findUserByNickname.mockResolvedValue(publicRow());
    viewerBlockedThem();

    const profile = await buildPublicProfile({ username: 'Guest User', viewer: { id: 'viewer-1' } });

    expect(profile.restricted).toBe(false);
    expect(profile.avatar).toBeTruthy();
  });

  test('the block lookup runs only when it can change the answer', async () => {
    // Your own page: nobody is blocking anybody.
    await buildPublicProfile({ username: 'Guest User', viewer: { id: 'user-1' } });
    expect(readBlock).not.toHaveBeenCalled();

    // Signed out: no viewer to be blocked by, and none to have blocked.
    await buildPublicProfile({ username: 'Guest User' });
    expect(readBlock).not.toHaveBeenCalled();

    // Signed in as someone else: both directions are asked, because either one
    // changes the answer and they change it differently.
    await buildPublicProfile({ username: 'Guest User', viewer: { id: 'viewer-1' } });
    expect(readBlock).toHaveBeenCalledWith('viewer-1', 'user-1');
    expect(readBlock).toHaveBeenCalledWith('user-1', 'viewer-1');
  });
});
