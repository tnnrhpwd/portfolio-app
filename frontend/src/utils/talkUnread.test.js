/**
 * The shared unread count: the arithmetic, the account keying, and the fan-out.
 *
 * The case worth having is the LAST one in each block — a value that outlives
 * whoever published it. This module is process-global and a sign-out does not
 * reload the page, so "the previous account's number must not be shown to the
 * next reader" is the rule the whole keyed-snapshot design exists for.
 */

import {
  publishTalkUnread,
  readTalkUnread,
  resetTalkUnread,
  subscribeTalkUnread,
  sumUnread,
  talkUnreadAge,
} from './talkUnread.js';

beforeEach(() => {
  resetTalkUnread();
});

describe('sumUnread', () => {
  test('adds the per-connection counts', () => {
    expect(sumUnread([{ unread: 2 }, { unread: 0 }, { unread: 3 }])).toBe(5);
  });

  test('treats a stringified count as a number rather than as text to concatenate', () => {
    expect(sumUnread([{ unread: '2' }, { unread: '3' }])).toBe(5);
  });

  test('is 0 for anything that is not a list of connections', () => {
    expect(sumUnread(undefined)).toBe(0);
    expect(sumUnread(null)).toBe(0);
    expect(sumUnread({ contacts: [] })).toBe(0);
    expect(sumUnread([])).toBe(0);
  });

  test('survives a malformed row — the badge must never be what throws', () => {
    expect(sumUnread([null, {}, { unread: null }, { unread: 'nope' }, { unread: 4 }])).toBe(4);
  });
});

describe('publish / read', () => {
  test('reports the published count to the account it belongs to', () => {
    publishTalkUnread('me', 3);
    expect(readTalkUnread('me')).toBe(3);
  });

  test('publishing 0 is a real answer, not a missing one', () => {
    publishTalkUnread('me', 3);
    publishTalkUnread('me', 0);
    expect(readTalkUnread('me')).toBe(0);
  });

  test('never hands one account the count another account published', () => {
    publishTalkUnread('someone-else', 7);
    expect(readTalkUnread('me')).toBe(0);
  });

  test('answers 0 to a signed-out reader, and refuses to store a tokenless publish', () => {
    publishTalkUnread('me', 5);
    expect(readTalkUnread('')).toBe(0);
    expect(readTalkUnread(undefined)).toBe(0);

    publishTalkUnread('', 5);
    expect(readTalkUnread('')).toBe(0);
    expect(readTalkUnread('me')).toBe(5); // and it did not clobber the real account
  });
});

describe('subscribe', () => {
  test('tells listeners about a change, with the token that produced it', () => {
    const seen = [];
    const unsubscribe = subscribeTalkUnread((snapshot) => seen.push(snapshot));

    publishTalkUnread('me', 3);
    publishTalkUnread('me', 5);
    unsubscribe();
    publishTalkUnread('me', 9);

    expect(seen.map((s) => s.unread)).toEqual([3, 5]);
    expect(seen[0].token).toBe('me');
  });

  test('a repeat of the same number is not a change — it only renews freshness', () => {
    const listener = jest.fn();
    subscribeTalkUnread(listener);

    publishTalkUnread('me', 3);
    publishTalkUnread('me', 3);

    expect(listener).toHaveBeenCalledTimes(1);
    // …but it still counts as "someone just asked the server", which is what
    // stops the hook from asking again a second later.
    expect(talkUnreadAge('me', Date.now() + 60000)).toBeGreaterThan(59000);
  });

  test('reset clears the value for everyone and says so', () => {
    const listener = jest.fn();
    publishTalkUnread('me', 3);
    subscribeTalkUnread(listener);

    resetTalkUnread();

    expect(readTalkUnread('me')).toBe(0);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ token: '', unread: 0 }));
  });
});

describe('talkUnreadAge', () => {
  test('is infinite until something is published for that account', () => {
    expect(talkUnreadAge('me')).toBe(Infinity);
    publishTalkUnread('other', 1);
    expect(talkUnreadAge('me')).toBe(Infinity);
  });

  test('measures from the publish, so a cached value can go stale', () => {
    publishTalkUnread('me', 1);
    expect(talkUnreadAge('me')).toBeLessThan(1000);
    expect(talkUnreadAge('me', Date.now() + 45000)).toBeGreaterThanOrEqual(45000);
  });
});
