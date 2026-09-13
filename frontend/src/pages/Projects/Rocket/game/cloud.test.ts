/**
 * Cloud progress + leaderboard logic.
 *
 * The tests focus on the PURE half (`cloud.ts` splits I/O from policy on purpose):
 * the merge rules and the ranking, because a bug there is silent — it shows up as
 * "my coins went missing" weeks later, not as an exception.
 */

import {
  formatLeaderboardText,
  formatSaveText,
  parseDelimitedFields,
  parseLeaderboardRow,
  parseSaveText,
  rankLeaderboard,
  sanitizeName,
  type LeaderboardEntry,
} from './cloud';
import { mergeSaves, migrate, type SaveData } from './save';
import { createUpgradeLevels } from './core/upgrades';

function save(overrides: Partial<SaveData> = {}): SaveData {
  return {
    ...migrate({}),
    levels: createUpgradeLevels(),
    ...overrides,
  };
}

describe('delimited row format', () => {
  it('reads flags and values, keeping colons inside values', () => {
    const fields = parseDelimitedFields('RocketLeaderboard|Public:true|Wave:12|At:2026-09-12T10:30:00.000Z');
    expect(fields.RocketLeaderboard).toBe(true);
    expect(fields.Public).toBe('true');
    expect(fields.Wave).toBe('12');
    // Truncating at the first colon would have produced "2026-09-12T10".
    expect(fields.At).toBe('2026-09-12T10:30:00.000Z');
  });
});

describe('save payload', () => {
  it('round-trips through the stored text', () => {
    const original = save({ bestWave: 7, coins: 250, bestScore: 4200, updatedAt: 111 });
    const restored = parseSaveText(formatSaveText(original));
    expect(restored).toMatchObject({ bestWave: 7, coins: 250, bestScore: 4200, updatedAt: 111 });
  });

  it('survives the Creator prefix the backend adds', () => {
    const text = `Creator:user-123|${formatSaveText(save({ coins: 90 }))}`;
    expect(parseSaveText(text)?.coins).toBe(90);
  });

  it('rejects rows that are not ours, and junk', () => {
    expect(parseSaveText('Creator:user-1|Something:else')).toBeNull();
    expect(parseSaveText('')).toBeNull();
    expect(parseSaveText('RocketSave|{not json')).toBeNull();
  });

  it('clamps values a save from another build might carry', () => {
    const wild = parseSaveText('RocketSave|{"levels":{"weapon":99,"nonsense":5},"coins":-4}');
    expect(wild?.levels.weapon).toBe(2); // capped at the upgrade's maxLevel
    expect(wild?.coins).toBe(0); // negatives are not a save
    // `migrate` only walks the known upgrade keys, so a stray one is dropped.
    expect((wild?.levels as Record<string, number>).nonsense).toBeUndefined();
  });
});

describe('mergeSaves', () => {
  it('keeps the best permanent progression from both devices', () => {
    const local = save({ levels: { ...createUpgradeLevels(), weapon: 2, hull: 0 }, unlockedShips: ['scout'], updatedAt: 10 });
    const cloud = save({ levels: { ...createUpgradeLevels(), weapon: 1, hull: 3 }, unlockedShips: ['scout', 'retro'], updatedAt: 20 });
    const merged = mergeSaves(local, cloud);
    expect(merged.levels.weapon).toBe(2); // local's better weapon survived
    expect(merged.levels.hull).toBe(3); // cloud's better hull survived
    expect(merged.unlockedShips).toContain('retro');
  });

  it('takes the wallet from the most recent write, and never mints coins', () => {
    const old = save({ coins: 400, updatedAt: 10 });
    const recent = save({ coins: 50, updatedAt: 20 });
    // The newer save spent 350 coins; max() would have invented 400 spendable.
    expect(mergeSaves(old, recent).coins).toBe(50);
    // Argument order is irrelevant — the timestamp decides, so a sync and a push
    // that happen to disagree about who is "local" still agree on the wallet.
    expect(mergeSaves(recent, old).coins).toBe(50);
    expect(mergeSaves(old, recent).updatedAt).toBe(20);
  });

  it('fully adopts the cloud save on a device that has never played', () => {
    const fresh = save(); // updatedAt 0
    const played = save({ coins: 120, bestWave: 9, levels: { ...createUpgradeLevels(), damage: 2 }, unlockedShips: ['scout', 'retro'], ship: 'retro', updatedAt: 5 });
    const merged = mergeSaves(fresh, played);
    expect(merged.coins).toBe(120);
    expect(merged.bestWave).toBe(9);
    expect(merged.levels.damage).toBe(2);
    expect(merged.ship).toBe('retro');
  });

  it('keeps records from either device', () => {
    const a = save({ bestScore: 900, bestWave: 4, runs: 12, kills: 90, updatedAt: 50 });
    const b = save({ bestScore: 1500, bestWave: 6, runs: 3, kills: 400, updatedAt: 40 });
    const merged = mergeSaves(a, b);
    expect(merged.bestScore).toBe(1500);
    expect(merged.bestWave).toBe(6);
    expect(merged.runs).toBe(12);
    expect(merged.kills).toBe(400);
    expect(merged.updatedAt).toBe(50);
  });

  it('does not leave the selected ship locked', () => {
    const local = save({ ship: 'hauler', unlockedShips: ['scout'], updatedAt: 10 });
    const cloud = save({ ship: 'scout', unlockedShips: ['scout'], updatedAt: 5 });
    // The newer save wants a ship the merged unlock list does not contain.
    expect(mergeSaves(local, cloud).ship).toBe('scout');
  });
});

describe('names', () => {
  it('removes the delimiters and falls back for empty input', () => {
    expect(sanitizeName('a|b:c')).toBe('a b c');
    expect(sanitizeName('   ')).toBe('Anonymous');
    expect(sanitizeName('x'.repeat(40)).length).toBe(18);
  });
});

describe('leaderboard', () => {
  const entry = (over: Partial<LeaderboardEntry> = {}): LeaderboardEntry => ({
    wave: 1,
    score: 0,
    name: 'Player',
    at: '2026-09-12T00:00:00.000Z',
    userId: 'u1',
    ...over,
  });

  it('parses a public row', () => {
    const row = { data: formatLeaderboardText({ wave: 14, score: 2200, name: 'Tanne', userId: 'abc' }) };
    expect(parseLeaderboardRow(row)).toMatchObject({ wave: 14, score: 2200, name: 'Tanne', userId: 'abc' });
  });

  it('tags entries so the backend public scan can find them', () => {
    // The search is `contains(text, marker) AND contains(text, 'Public:true')`.
    const text = formatLeaderboardText({ wave: 3, score: 10, name: 'A', userId: 'u' });
    expect(text.startsWith('RocketLeaderboard|')).toBe(true);
    expect(text).toContain('Public:true');
  });

  it('ignores rows without a usable wave, and other features’ rows', () => {
    expect(parseLeaderboardRow({ data: 'RocketLeaderboard|Public:true|Score:100' })).toBeNull();
    expect(parseLeaderboardRow({ data: 'Game2048Leaderboard|Public:true|Score:100' })).toBeNull();
    expect(parseLeaderboardRow({})).toBeNull();
  });

  it('ranks by farthest wave, then score, and numbers the rows', () => {
    const { top, total } = rankLeaderboard([
      entry({ wave: 5, score: 100, userId: 'a' }),
      entry({ wave: 9, score: 10, userId: 'b' }),
      entry({ wave: 5, score: 900, userId: 'c' }),
    ]);
    expect(total).toBe(3);
    expect(top.map((e) => e.userId)).toEqual(['b', 'c', 'a']);
    expect(top.map((e) => e.rank)).toEqual([1, 2, 3]);
  });

  it('keeps only the best row per player', () => {
    const { top, total } = rankLeaderboard([
      entry({ wave: 3, userId: 'same', score: 10 }),
      entry({ wave: 11, userId: 'same', score: 10 }),
      entry({ wave: 2, userId: 'other' }),
    ]);
    expect(total).toBe(2);
    expect(top[0]).toMatchObject({ userId: 'same', wave: 11, rank: 1 });
  });

  it('limits the board but still reports how many players it holds', () => {
    const many = Array.from({ length: 25 }, (_, i) => entry({ wave: 25 - i, userId: `u${i}` }));
    const { top, total } = rankLeaderboard(many, 10);
    expect(top).toHaveLength(10);
    expect(total).toBe(25);
    expect(top[0].wave).toBe(25);
  });
});
