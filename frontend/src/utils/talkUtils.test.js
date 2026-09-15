/**
 * talkUtils.test.js — the pure helpers behind the Talk UI.
 *
 * These all end up as text a user reads, and each has a boundary that is easy to
 * get wrong: an initials fallback for a single-word (or empty) nickname, a
 * relative time that has to stay coarse, a day divider that has to say
 * "Yesterday" only when it *is* yesterday, and a budget line that must not
 * contradict itself.
 */

import {
  TALK_LIMITS_FALLBACK,
  clockTime,
  dayLabel,
  groupByDay,
  initials,
  messengerErrorMessage,
  relativeTime,
  requestBudgetHint,
} from './talkUtils';

describe('initials', () => {
  test('takes the first and last word of a multi-word nickname', () => {
    expect(initials('Guest User')).toBe('GU');
    expect(initials('Sam H.')).toBe('SH');
    expect(initials('mary jane watson')).toBe('MW');
  });

  test('handles a single word, separators, and nothing at all', () => {
    expect(initials('tanner')).toBe('TA');
    expect(initials('sam_h_')).toBe('SH');
    expect(initials('')).toBe('?');
    expect(initials(null)).toBe('?');
    expect(initials('   ')).toBe('?');
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2026-09-14T12:00:00.000Z');
  const ago = (ms) => new Date(now - ms).toISOString();

  test('stays coarse as it ages', () => {
    expect(relativeTime(ago(5_000), now)).toBe('just now');
    expect(relativeTime(ago(5 * 60_000), now)).toBe('5m');
    expect(relativeTime(ago(3 * 3_600_000), now)).toBe('3h');
    expect(relativeTime(ago(2 * 86_400_000), now)).toBe('2d');
  });

  test('a week or more falls back to a date', () => {
    expect(relativeTime(ago(30 * 86_400_000), now)).toMatch(/\d/);
    expect(relativeTime(ago(30 * 86_400_000), now)).not.toMatch(/d$/);
  });

  test('never says a future timestamp is in the past by a negative amount', () => {
    expect(relativeTime(new Date(now + 60_000).toISOString(), now)).toBe('just now');
  });

  test('an unparseable value renders nothing rather than "NaN"', () => {
    expect(relativeTime('not-a-date', now)).toBe('');
    // ⚠️ `new Date(null)` is epoch 0 — a VALID timestamp that would render as a
    // real date ("Dec 31") for a row that has no date at all.
    expect(relativeTime(null, now)).toBe('');
    expect(relativeTime(undefined, now)).toBe('');
    expect(relativeTime('', now)).toBe('');
  });
});

describe('dayLabel', () => {
  test('names today and yesterday, and dates anything older', () => {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    expect(dayLabel(today.toISOString())).toBe('Today');
    expect(dayLabel(yesterday.toISOString())).toBe('Yesterday');
    expect(dayLabel('2020-03-04T10:00:00.000Z')).toMatch(/2020/);
  });
});

describe('groupByDay', () => {
  test('buckets consecutive messages and keeps their order', () => {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const groups = groupByDay([
      { sentAt: yesterday.toISOString(), body: 'a' },
      { sentAt: today.toISOString(), body: 'b' },
      { sentAt: today.toISOString(), body: 'c' },
    ]);

    expect(groups.map((g) => g.label)).toEqual(['Yesterday', 'Today']);
    expect(groups[1].messages.map((m) => m.body)).toEqual(['b', 'c']);
  });

  test('an empty transcript has no groups', () => {
    expect(groupByDay([])).toEqual([]);
  });
});

describe('requestBudgetHint', () => {
  test('leads with the tightest constraint', () => {
    expect(requestBudgetHint({ pendingOut: 0, thisHour: 9, today: 30 })).toMatch(/waiting for an answer/);
    expect(requestBudgetHint({ pendingOut: 5, thisHour: 0, today: 30 })).toMatch(/hourly limit/);
    expect(requestBudgetHint({ pendingOut: 5, thisHour: 2, today: 0 })).toMatch(/daily limit/);
    expect(requestBudgetHint({ pendingOut: 5, thisHour: 2, today: 20 })).toBe('2 requests left this hour.');
    expect(requestBudgetHint({ pendingOut: 5, thisHour: 8, today: 20 })).toBe('20 requests left today.');
  });

  test('singular and plural both read correctly', () => {
    expect(requestBudgetHint({ pendingOut: 5, thisHour: 1, today: 20 })).toBe('1 request left this hour.');
    expect(requestBudgetHint({ pendingOut: 5, thisHour: 8, today: 1 })).toBe('1 request left today.');
  });

  test('falls back to the default limits when the server sent none', () => {
    expect(requestBudgetHint({}, TALK_LIMITS_FALLBACK)).toMatch(String(TALK_LIMITS_FALLBACK.pendingOutMax));
  });
});

describe('messengerErrorMessage', () => {
  test('passes the server\u2019s own wording through, since it is already user-facing', () => {
    expect(messengerErrorMessage(new Error('No account with that username'))).toBe('No account with that username');
    expect(messengerErrorMessage(new Error('You are already connected with Sam'))).toBe('You are already connected with Sam');
  });

  test('replaces plumbing with something a person can act on', () => {
    expect(messengerErrorMessage(new Error('Failed to fetch'))).toMatch(/Check your connection/);
    const serverError = Object.assign(new Error('Internal server error'), { status: 500 });
    expect(messengerErrorMessage(serverError)).toMatch(/try again in a moment/i);
  });

  test('uses the fallback when there is no message at all', () => {
    expect(messengerErrorMessage(null, 'Could not send that request.')).toBe('Could not send that request.');
  });
});

describe('clockTime', () => {
  test('renders a time, and nothing for a bad value', () => {
    expect(clockTime('2026-09-14T09:41:00.000Z')).toMatch(/\d{1,2}:\d{2}/);
    expect(clockTime('nope')).toBe('');
  });
});
