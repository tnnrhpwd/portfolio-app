/**
 * userProfileUtils.test.js — the wording and the path shape of `/u/<username>`.
 *
 * Most of this is copy, but two parts are contract: `profilePath` is the only
 * place the URL is built (a link that encodes differently from the route is a
 * broken link), and `boardSummary` must not print a number that means nothing.
 */

import {
  RELATIONSHIP,
  blockConfirmText,
  blockNoticeText,
  boardSummary,
  canBlock,
  canManageRelationship,
  canRemoveConnection,
  canUnblock,
  formatNumber,
  isPublicVisibility,
  isQuietProfile,
  memberSinceLabel,
  playLabel,
  profilePath,
  profileRelationship,
  profileStats,
  profileVisibilityOf,
  publishedKindLabel,
  ratingLabel,
  removeConfirmText,
  removeNoticeText,
  shortDate,
  unblockConfirmText,
  unblockNoticeText,
  visibilityLabel,
  visibilitySummary,
} from './userProfileUtils';

describe('profilePath', () => {
  test('encodes a nickname with a space so it survives the URL', () => {
    expect(profilePath('Guest User')).toBe('/u/Guest%20User');
  });

  test('leaves a simple nickname alone', () => {
    expect(profilePath('tanner')).toBe('/u/tanner');
  });

  test('trims, and never produces a bare /u/', () => {
    expect(profilePath('  tanner  ')).toBe('/u/tanner');
    expect(profilePath('')).toBe('/u/');
    expect(profilePath(null)).toBe('/u/');
  });

  test('encodes the characters that would otherwise break the path', () => {
    expect(profilePath('a/b')).toBe('/u/a%2Fb');
    expect(profilePath('a?b')).toBe('/u/a%3Fb');
  });
});

describe('memberSinceLabel', () => {
  test('month and year only — a join date is context, not a timestamp', () => {
    expect(memberSinceLabel('2025-08-29T01:22:39.486Z')).toMatch(/^Member since \w+ 2025$/);
  });

  test('nothing to say about a missing or bad date', () => {
    expect(memberSinceLabel(null)).toBe('');
    expect(memberSinceLabel('not-a-date')).toBe('');
  });
});

describe('shortDate / formatNumber', () => {
  test('formats a date, and nothing for a bad one', () => {
    expect(shortDate('2026-09-12T18:08:43.552Z')).toMatch(/2026/);
    expect(shortDate('nope')).toBe('');
    expect(shortDate(null)).toBe('');
  });

  test('groups a score so 5188 reads as 5,188', () => {
    expect(formatNumber(5188)).toBe('5,188');
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(undefined)).toBe('—');
  });
});

describe('boardSummary', () => {
  test('labels the value with the game’s own metric', () => {
    const summary = boardSummary({ label: 'Best wave', value: 5, rank: 2, players: 2 });
    expect(summary.value).toBe('5');
    expect(summary.label).toBe('Best wave');
    expect(summary.rank).toBe('Rank #2 of 2 players');
  });

  test('says "player" for a board with one entry', () => {
    expect(boardSummary({ value: 1, rank: 1, players: 1 }).rank).toBe('Rank #1 of 1 player');
  });

  test('⚠️ drops a secondary stat of zero rather than printing "Best score 0"', () => {
    expect(boardSummary({ value: 5, detail: 0, detailLabel: 'Best score' }).detail).toBeNull();
    expect(boardSummary({ value: 5, detail: 4200, detailLabel: 'Best score' }).detail).toBe('Best score 4,200');
  });

  test('no rank when the board size is unknown', () => {
    expect(boardSummary({ value: 5, rank: 1, players: 0 }).rank).toBeNull();
    expect(boardSummary({ value: 5 }).rank).toBeNull();
  });

  test('a missing board does not throw', () => {
    expect(boardSummary().label).toBe('Best');
  });
});

describe('playLabel', () => {
  test('names the game', () => {
    expect(playLabel({ name: '2048' })).toBe('Play 2048');
    expect(playLabel({})).toBe('Play the game');
  });
});

describe('publishedKindLabel / ratingLabel', () => {
  test('a goal is a goal; anything else is a skill', () => {
    expect(publishedKindLabel('goal')).toBe('Goal');
    expect(publishedKindLabel('skill')).toBe('Skill');
    expect(publishedKindLabel(undefined)).toBe('Skill');
  });

  test('stars read with the count, singular and plural', () => {
    expect(ratingLabel(0, 0)).toBe('No ratings yet');
    expect(ratingLabel(1, 5)).toBe('5.0 ★ (1 rating)');
    expect(ratingLabel(4, 4.5)).toBe('4.5 ★ (4 ratings)');
  });
});

describe('profileStats', () => {
  test('omits the zeroes, so the readout is not a row of noughts', () => {
    expect(profileStats({ connections: 0, games: [], published: [] })).toEqual([]);
    expect(profileStats({ connections: 3, games: [{}], published: [] })).toEqual([
      { key: 'connections', label: 'Connections', value: '3' },
      { key: 'games', label: 'Game played', value: '1' },
    ]);
  });

  test('counts what the arrays actually hold', () => {
    const stats = profileStats({ connections: 1, games: [{}, {}], published: [{}, {}, {}] });
    expect(stats.map((s) => [s.key, s.value])).toEqual([['connections', '1'], ['games', '2'], ['published', '3']]);
  });

  test('a quiet profile is recognised, so the page can say so instead of showing nothing', () => {
    expect(isQuietProfile({ connections: 0, games: [], published: [] })).toBe(true);
    expect(isQuietProfile({ connections: 1, games: [], published: [] })).toBe(false);
  });

  test('a malformed profile does not throw', () => {
    expect(profileStats()).toEqual([]);
    expect(isQuietProfile()).toBe(true);
  });
});

/**
 * Visibility is the one setting here with a privacy consequence, and the whole
 * point of the frontend helper is that it cannot disagree with the server: a
 * control that reads "Public" for a page the server refuses to serve would tell
 * someone they had published when they had not. `normalizeProfileVisibility`
 * (backend/constants/profileVisibility.js) treats anything not exactly "public"
 * as private, and so must this.
 */
describe('profileVisibilityOf', () => {
  test('reads the setting off both shapes the app holds', () => {
    // The logged-in user object (login response / PUT reply)…
    expect(profileVisibilityOf({ profileVisibility: 'public' })).toBe('public');
    // …and the public profile payload the /u page renders.
    expect(profileVisibilityOf({ visibility: 'public' })).toBe('public');
    expect(profileVisibilityOf({ profileVisibility: 'private', visibility: 'public' })).toBe('private');
  });

  test('defaults to private when the account has no stored setting', () => {
    expect(profileVisibilityOf({})).toBe('private');
    expect(profileVisibilityOf(null)).toBe('private');
    expect(profileVisibilityOf(undefined)).toBe('private');
    expect(profileVisibilityOf('')).toBe('private');
  });

  test('anything unrecognised is private, never a surprise publication', () => {
    // The server rejects these outright on write; if one ever reaches the client
    // through an older row or a hand-edited response, it must not render as open.
    expect(profileVisibilityOf({ profileVisibility: 'PUBLIC' })).toBe('private');
    expect(profileVisibilityOf({ profileVisibility: ' public ' })).toBe('private');
    expect(profileVisibilityOf({ profileVisibility: 'yes' })).toBe('private');
    expect(profileVisibilityOf({ profileVisibility: true })).toBe('private');
    expect(profileVisibilityOf({ profileVisibility: 1 })).toBe('private');
  });

  test('the owner badge and the gate agree on what is public', () => {
    expect(isPublicVisibility({ visibility: 'public' })).toBe(true);
    expect(isPublicVisibility({ visibility: 'private' })).toBe(false);
    expect(isPublicVisibility({})).toBe(false);
  });

  test('the label and the sentence never contradict the setting', () => {
    expect(visibilityLabel({ profileVisibility: 'public' })).toBe('Public');
    expect(visibilityLabel({})).toBe('Private');
    expect(visibilitySummary({ visibility: 'public' })).toMatch(/anyone/i);
    expect(visibilitySummary({ visibility: 'private' })).toMatch(/connections/i);
  });
});

/**
 * The relationship decides both the row's one action and which controls the
 * Manage pane offers (docs/implementation/PROFILES.md), so it is the one piece
 * of page logic worth asserting: two controls reading it differently is how a page
 * ends up offering to connect you to somebody you have blocked.
 */
describe('profileRelationship', () => {
  const signedIn = { isSignedIn: true };
  const connectable = { ...signedIn, canConnect: true };

  test('your own page is its own case', () => {
    // Even when the payload also says you can connect — which it does not, but the
    // rule must not depend on that.
    expect(profileRelationship({ ...connectable, isSelf: true })).toBe(RELATIONSHIP.SELF);
  });

  test('a connection is recognised by the id, not just the flag', () => {
    expect(profileRelationship({ ...signedIn, isConnected: true, connectedUserId: 'u1' }))
      .toBe(RELATIONSHIP.CONNECTED);
    // `isConnected` with no id would build a "Message them" link to nowhere, so it
    // is not a connection — it falls through to whatever else the payload says.
    expect(profileRelationship({ ...signedIn, isConnected: true, connectedUserId: null }))
      .toBe(RELATIONSHIP.VISITOR);
  });

  test('a block outranks everything, because it is the newer fact', () => {
    // `blockUser` removes the connection, so a payload carrying both is one where
    // a stale half survived — and the block is the half that decides.
    expect(profileRelationship({ ...signedIn, blockedByYou: true, isConnected: true, connectedUserId: 'u1' }))
      .toBe(RELATIONSHIP.BLOCKED);
    expect(profileRelationship({ ...connectable, blockedByYou: true })).toBe(RELATIONSHIP.BLOCKED);
  });

  test('⚠️ someone else having blocked YOU is not reported as a state', () => {
    // The server answers that viewer exactly as it answers a stranger looking at a
    // private page, and this mirrors it: `blockedByYou` is about the viewer's own
    // action, and nothing else in the payload can reveal the reverse.
    expect(profileRelationship({ ...connectable })).toBe(RELATIONSHIP.STRANGER);
    expect(profileRelationship({ ...signedIn })).toBe(RELATIONSHIP.VISITOR);
    expect(profileRelationship()).toBe(RELATIONSHIP.VISITOR);
  });

  test('the controls are derived from that one fact, not from the flags beside it', () => {
    const blocked = { ...signedIn, blockedByYou: true };
    expect(canUnblock(blocked)).toBe(true);
    expect(canBlock(blocked)).toBe(false);
    // No connection to remove — blocking already removed it.
    expect(canRemoveConnection(blocked)).toBe(false);

    const connected = { ...signedIn, isConnected: true, connectedUserId: 'u1' };
    expect(canRemoveConnection(connected)).toBe(true);
    expect(canBlock(connected)).toBe(true);
    expect(canUnblock(connected)).toBe(false);

    expect(canBlock(connectable)).toBe(true);
  });

  test('nothing is offered on your own page, or to a signed-out visitor', () => {
    expect(canManageRelationship({ isSelf: true, isSignedIn: true })).toBe(false);
    expect(canManageRelationship({ isSignedIn: false, canConnect: false })).toBe(false);
    expect(canBlock({ isSelf: true, isSignedIn: true })).toBe(false);
    expect(canManageRelationship(connectable)).toBe(true);
  });
});

describe('the confirmations', () => {
  test('a block says what it does, what it does not do, and that they are not told', () => {
    const text = blockConfirmText('Peer One');
    expect(text).toMatch(/Peer One/);
    expect(text).toMatch(/not told/i);
    expect(text).toMatch(/messages are kept/i);
    expect(text).toMatch(/unblock/i);
  });

  test('an unblock is not a reconnect, and says so', () => {
    const text = unblockConfirmText('Peer One');
    expect(text).toMatch(/not connected/i);
    expect(text).toMatch(/accept/i);
  });

  test('removing keeps the messages — that is the one thing it does not do', () => {
    expect(removeConfirmText('Peer One')).toMatch(/messages are kept/i);
  });

  test('a missing nickname still produces a sentence, not "undefined"', () => {
    for (const text of [blockConfirmText(), unblockConfirmText(), removeConfirmText(null)]) {
      expect(text).toMatch(/this account/);
      expect(text).not.toMatch(/undefined/);
    }
  });

  test('the follow-up notices state the new state, and never claim they were told', () => {
    expect(blockNoticeText('Peer One')).toMatch(/blocked/i);
    expect(unblockNoticeText('Peer One')).toMatch(/not connected/i);
    expect(removeNoticeText('Peer One')).toMatch(/no longer a connection/i);
    for (const text of [blockNoticeText('Peer One'), unblockNoticeText('Peer One')]) {
      expect(text).not.toMatch(/they know|they were told|notified/i);
    }
  });
});
