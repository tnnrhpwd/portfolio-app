/**
 * pollsService.test.js — unit tests for the pure helpers in the Polls feature.
 * No network, no DynamoDB — only encoding/parsing and the public-shape mapping
 * so the poll rules stay locked down as the feature evolves.
 */

const {
  buildPollText,
  parsePollText,
  toPublicPoll,
  LIMITS,
  startOfWeek,
  weekStartIso,
  weekLabel,
  parseAiPollJson,
} = require('../../services/pollsService');

describe('pollsService.buildPollText / parsePollText', () => {
  test('round-trips a payload through the text marker', () => {
    const payload = { question: 'Q?', options: ['A', 'B'], votes: [0, 1] };
    expect(parsePollText(buildPollText(payload))).toEqual(payload);
  });

  test('returns null for non-poll text', () => {
    expect(parsePollText('Creator:abc|Memory:goal|{}')).toBeNull();
    expect(parsePollText('')).toBeNull();
    expect(parsePollText('|Polls:|{}')).toBeNull(); // wrong marker
  });

  test('returns null for malformed JSON after the marker', () => {
    expect(parsePollText('|Poll:not-json')).toBeNull();
  });
});

describe('pollsService.toPublicPoll', () => {
  const baseRow = (overrides = {}, createdAt = new Date().toISOString()) => ({
    id: 'poll-123',
    text: buildPollText({
      question: 'Best color?',
      options: ['Red', 'Blue'],
      votes: [2, 3],
      durationMinutes: 60,
      creator: 'Sam',
      closed: false,
      closedAt: null,
      ownerKey: 'secret-owner-key',
      voterIds: ['voter-1', 'voter-2'],
      ...overrides,
    }),
    createdAt,
    updatedAt: createdAt,
  });

  test('strips ownerKey and voterIds from the public shape', () => {
    const poll = toPublicPoll(baseRow());
    expect(poll.ownerKey).toBeUndefined();
    expect(poll.voterIds).toBeUndefined();
    expect(poll).not.toHaveProperty('voterIds');
  });

  test('maps options/votes and totals them', () => {
    const poll = toPublicPoll(baseRow());
    expect(poll.options).toEqual([
      { text: 'Red', votes: 2 },
      { text: 'Blue', votes: 3 },
    ]);
    expect(poll.totalVotes).toBe(5);
  });

  test('active while the duration has not elapsed', () => {
    const poll = toPublicPoll(baseRow({ durationMinutes: 10080 }));
    expect(poll.closed).toBe(false);
  });

  test('closed once the duration has elapsed', () => {
    const createdAt = new Date(Date.now() - 10 * 60000).toISOString(); // 10 min ago
    const poll = toPublicPoll(baseRow({ durationMinutes: 1 }, createdAt));
    expect(poll.closed).toBe(true);
  });

  test('closed when the owner manually closed it', () => {
    const poll = toPublicPoll(baseRow({ closed: true, closedAt: new Date().toISOString() }));
    expect(poll.closed).toBe(true);
  });

  test('defaults creator to Anonymous', () => {
    const poll = toPublicPoll(baseRow({ creator: '' }));
    expect(poll.creator).toBe('Anonymous');
  });

  test('exposes an expiresAt ISO timestamp', () => {
    const createdAt = new Date().toISOString();
    const poll = toPublicPoll(baseRow({ durationMinutes: 30 }, createdAt));
    const expected = new Date(new Date(createdAt).getTime() + 30 * 60000).toISOString();
    expect(poll.expiresAt).toBe(expected);
  });
});

describe('pollsService.LIMITS', () => {
  test('enforces a sane option range', () => {
    expect(LIMITS.minOptions).toBe(2);
    expect(LIMITS.maxOptions).toBeGreaterThanOrEqual(2);
    expect(LIMITS.durationMin).toBeGreaterThan(0);
    expect(LIMITS.durationMax).toBeGreaterThan(LIMITS.durationMin);
  });
});

describe('pollsService.toPublicPoll weekly AI fields', () => {
  test('exposes isAi/kind/weekStart for weekly polls', () => {
    const row = {
      id: 'poll-ai',
      text: buildPollText({
        question: 'Q?',
        options: ['A', 'B'],
        votes: [1, 2],
        durationMinutes: 10080,
        creator: 'Weekly AI',
        closed: false,
        closedAt: null,
        ownerKey: 'secret',
        voterIds: [],
        kind: 'weekly',
        weekStart: '2026-08-31T00:00:00.000Z',
      }),
      createdAt: '2026-08-31T00:00:00.000Z',
      updatedAt: '2026-08-31T00:00:00.000Z',
    };
    const poll = toPublicPoll(row);
    expect(poll.isAi).toBe(true);
    expect(poll.kind).toBe('weekly');
    expect(poll.weekStart).toBe('2026-08-31T00:00:00.000Z');
  });

  test('defaults to non-AI for user polls', () => {
    const row = {
      id: 'poll-user',
      text: buildPollText({
        question: 'Q?',
        options: ['A', 'B'],
        votes: [1, 0],
        durationMinutes: 60,
        creator: 'Sam',
        closed: false,
        closedAt: null,
        ownerKey: 'secret',
        voterIds: [],
      }),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const poll = toPublicPoll(row);
    expect(poll.isAi).toBe(false);
    expect(poll.kind).toBeNull();
    expect(poll.weekStart).toBeNull();
  });
});

describe('pollsService.startOfWeek / weekStartIso', () => {
  test('rolls a mid-week date back to Monday 00:00 UTC', () => {
    // 2026-09-02 is a Wednesday → Monday 2026-08-31
    expect(startOfWeek(new Date('2026-09-02T15:30:00Z')).toISOString())
      .toBe('2026-08-31T00:00:00.000Z');
  });

  test('treats Sunday as the tail of the previous Monday', () => {
    // 2026-09-06 is a Sunday → Monday 2026-08-31
    expect(startOfWeek(new Date('2026-09-06T23:59:59Z')).toISOString())
      .toBe('2026-08-31T00:00:00.000Z');
  });

  test('keeps a Monday intact', () => {
    expect(startOfWeek(new Date('2026-08-31T18:00:00Z')).toISOString())
      .toBe('2026-08-31T00:00:00.000Z');
    expect(weekStartIso(new Date('2026-08-31T18:00:00Z')))
      .toBe('2026-08-31T00:00:00.000Z');
  });
});

describe('pollsService.weekLabel', () => {
  test('formats a Monday–Sunday range', () => {
    expect(weekLabel('2026-08-31T00:00:00.000Z')).toBe('Aug 31 – Sep 6');
  });

  test('returns an empty string for invalid dates', () => {
    expect(weekLabel('not-a-date')).toBe('');
  });
});

describe('pollsService.parseAiPollJson', () => {
  test('parses plain JSON', () => {
    expect(parseAiPollJson('{"question":"A?","options":["X","Y"]}')).toEqual({
      question: 'A?',
      options: ['X', 'Y'],
    });
  });

  test('strips markdown fences', () => {
    expect(parseAiPollJson('```json\n{"question":"A?","options":["X","Y"]}\n```')).toEqual({
      question: 'A?',
      options: ['X', 'Y'],
    });
  });

  test('trims and dedupes options', () => {
    expect(parseAiPollJson('{"question":"  A? ","options":[" X "," X ","Y"]}')).toEqual({
      question: 'A?',
      options: ['X', 'Y'],
    });
  });

  test('ignores prose wrapped around the JSON object', () => {
    expect(parseAiPollJson('Sure! here you go: {"question":"A?","options":["X","Y"]} enjoy!')).toEqual({
      question: 'A?',
      options: ['X', 'Y'],
    });
  });

  test('rejects more than 4 options', () => {
    expect(parseAiPollJson('{"question":"A?","options":["1","2","3","4","5"]}')).toBeNull();
  });

  test('rejects non-JSON', () => {
    expect(parseAiPollJson('not json at all')).toBeNull();
  });

  test('rejects empty input', () => {
    expect(parseAiPollJson('')).toBeNull();
    expect(parseAiPollJson(null)).toBeNull();
  });
});
