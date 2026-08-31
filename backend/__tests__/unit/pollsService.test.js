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
    const poll = toPublicPoll(baseRow({ durationMinutes: 30 }), createdAt);
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
