/**
 * gameBoards.test.js — reading the public game leaderboards for a profile.
 *
 * Two things are load-bearing here:
 *   1. the row format is parsed the same way the games themselves parse it (a
 *      marker that may not be at the start of the string, and ISO timestamps whose
 *      colons must not truncate the value), and
 *   2. the ranking matches what the player sees when they open the game — a
 *      profile that disagrees with the board is worse than no profile.
 */

jest.mock('../../utils/paginatedScan', () => ({
  paginatedScan: jest.fn(async () => []),
}));

const { paginatedScan } = require('../../utils/paginatedScan');
const {
  BOARDS,
  parseDelimitedFields,
  parseEntry,
  rankLeaderboard,
  getPlayerBoards,
  _resetBoardCache,
} = require('../../services/gameBoards');

const board = (key) => BOARDS.find((b) => b.key === key);
const entryFor = (key) => parseEntry(board(key));

/** A 2048 leaderboard row exactly as `Game2048.jsx` writes it. */
const row2048 = ({ score, tile = 512, name = 'Guest User', userId = 'u1', at = '2026-09-02T00:15:30.257Z' } = {}) => ({
  text: `Game2048Leaderboard|Public:true|Score:${score}|Tile:${tile}|Name:${name}|At:${at}|UserId:${userId}`,
  createdAt: at,
});

/** A Rocket row exactly as `cloud.ts` writes it. */
const rowRocket = ({ wave, score = 100, name = 'Guest User', userId = 'u1', at = '2026-09-13T01:04:51.497Z' } = {}) => ({
  text: `RocketLeaderboard|Public:true|Wave:${wave}|Score:${score}|Name:${name}|At:${at}|UserId:${userId}`,
  createdAt: at,
});

beforeEach(() => {
  _resetBoardCache();
  paginatedScan.mockReset();
  paginatedScan.mockResolvedValue([]);
});

describe('parseDelimitedFields', () => {
  test('splits key:value pairs and keeps the colons inside a value', () => {
    const fields = parseDelimitedFields('RocketLeaderboard|Public:true|Wave:5|At:2026-09-13T01:04:51.497Z');
    expect(fields.RocketLeaderboard).toBe(true);
    expect(fields.Wave).toBe('5');
    // Truncating at the first colon would give "2026-09-13T01".
    expect(fields.At).toBe('2026-09-13T01:04:51.497Z');
  });
});

describe('parseEntry', () => {
  test('reads a 2048 row', () => {
    expect(entryFor('game2048')(row2048({ score: 5188 }))).toMatchObject({
      userId: 'u1', name: 'Guest User', value: 5188, detail: 512, at: '2026-09-02T00:15:30.257Z',
    });
  });

  test('reads a Rocket row, where wave is the value and score the tie-break', () => {
    expect(entryFor('rocket')(rowRocket({ wave: 5, score: 4200 }))).toMatchObject({
      userId: 'u1', value: 5, score: 4200,
    });
  });

  test('finds the marker even when the row has a prefix', () => {
    // Authenticated writes get `Creator:<id>|` prepended, so the marker is not
    // always first — the games locate it rather than assuming.
    const prefixed = { text: `Creator:u1|${row2048({ score: 99 }).text}`, createdAt: 'x' };
    expect(entryFor('game2048')(prefixed).value).toBe(99);
  });

  test('rejects rows that are not entries for this board', () => {
    expect(entryFor('game2048')({ text: 'RocketLeaderboard|Wave:3' })).toBeNull();
    expect(entryFor('game2048')({ text: 'Review:Nice|Rating:5/5|User:someone' })).toBeNull();
    expect(entryFor('game2048')({})).toBeNull();
    expect(entryFor('game2048')({ text: 'Game2048Leaderboard|Name:nobody|UserId:u1' })).toBeNull(); // no score
  });

  test('an unnamed entry is Anonymous rather than blank', () => {
    const parsed = entryFor('game2048')({ text: 'Game2048Leaderboard|Score:10|Name:|UserId:' });
    expect(parsed.name).toBe('Anonymous');
    expect(parsed.userId).toBe('');
  });
});

describe('rankLeaderboard', () => {
  test('a player appears once, at their best, and gets a rank', () => {
    const ranked = rankLeaderboard(board('game2048'), [
      { userId: 'a', name: 'A', value: 100, score: 100, at: '1' },
      { userId: 'a', name: 'A', value: 900, score: 900, at: '2' },
      { userId: 'b', name: 'B', value: 500, score: 500, at: '3' },
    ]);
    expect(ranked.map((e) => [e.userId, e.value, e.rank])).toEqual([['a', 900, 1], ['b', 500, 2]]);
  });

  test('2048 ranks on score alone', () => {
    const ranked = rankLeaderboard(board('game2048'), [
      { userId: 'a', name: 'A', value: 100, score: 100, at: '1' },
      { userId: 'b', name: 'B', value: 200, score: 200, at: '2' },
    ]);
    expect(ranked.map((e) => e.userId)).toEqual(['b', 'a']);
  });

  test('Rocket ranks on wave, then score, then who got there first', () => {
    const ranked = rankLeaderboard(board('rocket'), [
      { userId: 'a', name: 'A', value: 5, score: 100, at: '2026-01-02T00:00:00Z' },
      { userId: 'b', name: 'B', value: 7, score: 10, at: '2026-01-03T00:00:00Z' },
      { userId: 'c', name: 'C', value: 5, score: 900, at: '2026-01-04T00:00:00Z' },
    ]);
    expect(ranked.map((e) => e.userId)).toEqual(['b', 'c', 'a']);
  });

  test('an entry with no user id is keyed by name, so anonymous players still place', () => {
    const ranked = rankLeaderboard(board('game2048'), [
      { userId: '', name: 'Anonymous', value: 400, score: 400, at: '1' },
      { userId: '', name: 'Anonymous', value: 100, score: 100, at: '2' }, // same player, worse run
      { userId: 'a', name: 'A', value: 50, score: 50, at: '3' },
    ]);
    expect(ranked.map((e) => [e.name, e.value, e.rank])).toEqual([['Anonymous', 400, 1], ['A', 50, 2]]);
  });

  test('ignores nulls rather than throwing', () => {
    expect(rankLeaderboard(board('game2048'), [null, undefined, { userId: 'a', name: 'A', value: 1, score: 1, at: '1' }]))
      .toHaveLength(1);
  });
});

describe('getPlayerBoards', () => {
  test('returns a row per board the player appears on, best placement first', async () => {
    paginatedScan.mockImplementation(async (params) => {
      const marker = params.ExpressionAttributeValues[':marker'];
      if (marker === 'Game2048Leaderboard') {
        return [row2048({ score: 100, userId: 'me' }), row2048({ score: 5000, userId: 'them' })];
      }
      return [rowRocket({ wave: 9, userId: 'them' }), rowRocket({ wave: 3, userId: 'me' })];
    });

    const boards = await getPlayerBoards('me');
    expect(boards.map((b) => [b.key, b.value, b.rank, b.players])).toEqual([
      ['game2048', 100, 2, 2],
      ['rocket', 3, 2, 2],
    ]);
  });

  test('a board the player has never posted to is absent, not a zero', async () => {
    paginatedScan.mockResolvedValue([row2048({ score: 100, userId: 'them' })]);
    expect(await getPlayerBoards('me')).toEqual([]);
  });

  test('ignores entries attributed to nobody', async () => {
    paginatedScan.mockResolvedValue([row2048({ score: 900, userId: '' })]);
    expect(await getPlayerBoards('me')).toEqual([]);
  });

  test('one board failing does not take the others with it', async () => {
    paginatedScan.mockImplementation(async (params) => {
      if (params.ExpressionAttributeValues[':marker'] === 'Game2048Leaderboard') {
        throw new Error('scan exploded');
      }
      return [rowRocket({ wave: 4, userId: 'me' })];
    });

    const boards = await getPlayerBoards('me');
    expect(boards.map((b) => b.key)).toEqual(['rocket']);
  });

  test('caches the board scan, so a page view does not rescan per visitor', async () => {
    paginatedScan.mockResolvedValue([row2048({ score: 100, userId: 'me' })]);
    await getPlayerBoards('me');
    const first = paginatedScan.mock.calls.length;
    await getPlayerBoards('someone-else');
    expect(paginatedScan.mock.calls.length).toBe(first);
  });

  test('a cached board is re-read once the TTL lapses', async () => {
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000_000);
    paginatedScan.mockResolvedValue([row2048({ score: 100, userId: 'me' })]);
    await getPlayerBoards('me');

    const callsAfterFirst = paginatedScan.mock.calls.length;
    nowSpy.mockReturnValue(1_000_000 + 61_000);
    await getPlayerBoards('me');
    expect(paginatedScan.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    nowSpy.mockRestore();
  });
});
