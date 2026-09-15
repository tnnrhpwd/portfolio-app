/**
 * messengerService.test.js — the friend graph and DM store.
 *
 * Runs against an in-memory stand-in for the `Simple` table (the same
 * composite-key shape: `id` partition + `createdAt` sort) rather than a live
 * DynamoDB, so the rules that are easy to get wrong can be asserted directly:
 *
 *   - the anti-spam ceilings actually refuse,
 *   - a message body is never written in the clear,
 *   - reading a conversation does NOT destroy the messages it marks as read
 *     (that exact regression — a read receipt written with a whole-row Put —
 *     is why this file exists),
 *   - the conversation query is ordered by the sort key, oldest-first.
 */

/**
 * Minimal filter support: only what the service's scan calls need.
 */
function hashText(item) {
  return typeof item.text === 'string' ? item.text : '';
}
jest.mock('@aws-sdk/lib-dynamodb', () => {
  const rows = new Map();
  const keyOf = (key) => `${key.id}::${key.createdAt}`;
  const clone = (value) => JSON.parse(JSON.stringify(value));

  const send = async (command) => {
    const input = command.input || {};

    // ⚠️ DynamoDB REJECTS a write whose ExpressionAttributeValues contains a
    // placeholder the expression never uses ("Value provided in
    // ExpressionAttributeValues unused in expressions"). Modelling that here is
    // deliberate: the first version of `updateIndex` passed `:expected` alongside
    // `attribute_not_exists(#v)`, which broke every friend request to an account
    // that had never opened Talk — and this fake accepted it while real DynamoDB
    // returned a 500.
    if (input.ExpressionAttributeValues && input.ConditionExpression) {
        const used = new Set(String(input.ConditionExpression).match(/:[A-Za-z0-9_]+/g) || []);
        const provided = Object.keys(input.ExpressionAttributeValues);
        const unused = provided.filter((name) => !used.has(name));
        if (unused.length > 0) {
            const error = new Error(
                `1 validation error detected: Value provided in ExpressionAttributeValues unused in expressions: keys: {${unused.join(', ')}}`
            );
            error.name = 'ValidationException';
            throw error;
        }
    }

    switch (command.constructor.name) {
      case 'GetCommand': {
        const item = rows.get(keyOf(input.Key));
        return item ? { Item: clone(item) } : {};
      }
      case 'PutCommand': {
        if (input.ConditionExpression) {
          const existing = rows.get(keyOf(input.Item));
          const expected = input.ExpressionAttributeValues?.[':expected'];
          if (input.ConditionExpression.startsWith('attribute_not_exists')) {
            if (existing) {
              const error = new Error('conditional check failed');
              error.name = 'ConditionalCheckFailedException';
              throw error;
            }
          } else if (!existing || existing.version !== expected) {
            const error = new Error('conditional check failed');
            error.name = 'ConditionalCheckFailedException';
            throw error;
          }
        }
        rows.set(keyOf(input.Item), clone(input.Item));
        return {};
      }
      case 'DeleteCommand': {
        rows.delete(keyOf(input.Key));
        return {};
      }
      case 'UpdateCommand': {
        const existing = rows.get(keyOf(input.Key));
        if (!existing) return {};
        // Deliberately modelled on the ONE update the service performs
        // (`SET readAt = :now, updatedAt = :now`), by attribute name: the point
        // of the test is that anything NOT named in the update survives, so a
        // future whole-row rewrite shows up as data loss rather than being
        // quietly emulated here.
        const now = input.ExpressionAttributeValues[':now'];
        for (const clause of String(input.UpdateExpression).replace(/^SET\s+/i, '').split(',')) {
          existing[clause.split('=')[0].trim()] = now;
        }
        rows.set(keyOf(input.Key), existing);
        return {};
      }
      case 'QueryCommand': {
        const id = input.ExpressionAttributeValues[':id'];
        const since = input.ExpressionAttributeValues[':since'];
        let items = [...rows.values()].filter((row) => row.id === id);
        if (since !== undefined) items = items.filter((row) => row.createdAt > since);
        items.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
        if (input.ScanIndexForward === false) items.reverse();
        if (input.Limit) items = items.slice(0, input.Limit);
        return { Items: items.map(clone) };
      }
      default:
        throw new Error(`unexpected command ${command.constructor.name}`);
    }
  };

  // `send` above dispatches on `command.constructor.name`, so each class needs a
  // real name — an anonymous class expression would report ''.
  class GetCommand { constructor(input) { this.input = input; } }
  class PutCommand { constructor(input) { this.input = input; } }
  class DeleteCommand { constructor(input) { this.input = input; } }
  class UpdateCommand { constructor(input) { this.input = input; } }
  class QueryCommand { constructor(input) { this.input = input; } }

  return {
    DynamoDBDocumentClient: { from: () => ({ send }) },
    GetCommand,
    PutCommand,
    DeleteCommand,
    UpdateCommand,
    QueryCommand,
    __rows: rows,
    __reset: () => rows.clear(),
  };
});

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class { constructor() {} },
}));

// The service scans through the shared paginated helper, which builds its own
// client. Mocking it at the module boundary keeps this test about the service.
jest.mock('../../utils/paginatedScan', () => ({
  paginatedScan: jest.fn(async () => []),
}));

const { paginatedScan } = require('../../utils/paginatedScan');
const awsLib = require('@aws-sdk/lib-dynamodb');
const sharp = require('sharp');
const { encrypt } = require('../../services/messageCrypto');
const {
  LIMITS,
  convIdFor,
  friendId,
  messageSortKey,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  cancelFriendRequest,
  removeContact,
  listMessages,
  sendMessage,
  markConversationRead,
  collectAvatars,
  getDirectory,
  areFriends,
  _clearNicknameCache,
} = require('../../services/messengerService');

process.env.MESSAGE_ENCRYPTION_KEY = 'unit-test-messenger-key';

const ME = { id: 'user-me', text: 'Nickname:Me User|Email:me@example.com|Password:[redacted]' };
const PEER = { id: 'user-peer', text: 'Nickname:Peer One|Email:peer@example.com|Password:[redacted]' };
const STRANGER = { id: 'user-stranger', text: 'Nickname:Stranger|Email:stranger@example.com|Password:[redacted]' };

const userRow = (user) => ({ id: user.id, text: user.text, createdAt: '2020-01-01T00:00:00.000Z' });
const rowFor = (id, createdAt = '2000-01-01T00:00:00.000Z') => awsLib.__rows.get(`${id}::${createdAt}`);

beforeEach(() => {
  awsLib.__reset();
  paginatedScan.mockReset();
  paginatedScan.mockResolvedValue([]);
  _clearNicknameCache();
});

/** Route nickname lookups at the scan boundary. */
function stubUserLookup(...users) {
  paginatedScan.mockImplementation(async (params) => {
    const nick = params.ExpressionAttributeValues?.[':nick'] || '';
    if (!nick.startsWith('Nickname:')) return [];
    // Mimic `contains(text, ...)` well enough for the service's two passes.
    return users
      .filter((row) => hashText(row).includes(nick) && hashText(row).includes('|Email:'));
  });
}

describe('messengerService ids', () => {
  test('a conversation id is the same from either side and stable', () => {
    expect(convIdFor('a', 'b')).toBe(convIdFor('b', 'a'));
    expect(convIdFor('a', 'b')).toHaveLength(32);
  });

  test('a friendship row is keyed by the sorted pair, so there is only ever one', () => {
    expect(friendId('zz', 'aa')).toBe(friendId('aa', 'zz'));
    expect(friendId('aa', 'zz')).toBe('msg_friend_aa_zz');
  });

  test('message sort keys are unique and strictly increasing, even in one millisecond', () => {
    const at = new Date('2026-09-14T10:00:00.000Z');
    const keys = Array.from({ length: 1000 }, () => messageSortKey(at));
    // A collision here is not a cosmetic problem: the second message would
    // overwrite the first, because (id, createdAt) is the row's key.
    expect(new Set(keys).size).toBe(1000);
    for (let i = 1; i < keys.length; i += 1) {
      expect(keys[i] > keys[i - 1]).toBe(true); // and ordering is what messages read by
    }
    const earlier = messageSortKey(new Date('2026-09-14T09:59:59.999Z'));
    const later = messageSortKey(new Date('2026-09-14T10:00:00.001Z'));
    expect(earlier < later).toBe(true);
  });
});

describe('friend requests', () => {
  test('refuses an unknown username', async () => {
    stubUserLookup(PEER);
    await expect(sendFriendRequest(ME, 'Nobody Here')).rejects.toMatchObject({ statusCode: 404 });
  });

  test('refuses your own username', async () => {
    stubUserLookup(ME, PEER);
    await expect(sendFriendRequest(ME, 'Me User')).rejects.toMatchObject({ statusCode: 400 });
  });

  test('finds a username regardless of case', async () => {
    stubUserLookup(PEER);
    const result = await sendFriendRequest(ME, 'peer one');
    expect(result.nickname).toBe('Peer One');
    expect(rowFor('msg_req_user-peer_user-me')).toBeTruthy();
  });

  test('writes the request to both sides of the graph', async () => {
    stubUserLookup(PEER);
    await sendFriendRequest(ME, 'Peer One');

    const mine = JSON.parse(rowFor('msg_index_user-me').text.replace('|MsgIndex:', ''));
    const theirs = JSON.parse(rowFor('msg_index_user-peer').text.replace('|MsgIndex:', ''));

    expect(mine.pendingOut).toEqual([expect.objectContaining({ userId: 'user-peer', nickname: 'Peer One' })]);
    expect(theirs.pendingIn).toEqual([expect.objectContaining({ userId: 'user-me', nickname: 'Me User' })]);
    expect(mine.requestLog).toHaveLength(1);
  });

  test('a duplicate request is refused', async () => {
    stubUserLookup(PEER);
    await sendFriendRequest(ME, 'Peer One');
    await expect(sendFriendRequest(ME, 'Peer One')).rejects.toMatchObject({ statusCode: 409 });
  });

  test('caps requests per hour', async () => {
    stubUserLookup(...Array.from({ length: 30 }, (_, i) => ({
      id: `user-${i}`,
      text: `Nickname:Person ${i}|Email:p${i}@example.com|Password:[redacted]`,
    })));
    // Seat the per-hour log directly rather than sending 10 real requests.
    const now = new Date().toISOString();
    awsLib.__rows.set(`msg_index_user-me::2000-01-01T00:00:00.000Z`, {
      id: 'msg_index_user-me',
      createdAt: '2000-01-01T00:00:00.000Z',
      kind: 'msgIndex',
      version: 1,
      text: `|MsgIndex:${JSON.stringify({
        contacts: [], pendingIn: [], pendingOut: [],
        requestLog: Array.from({ length: LIMITS.requestsPerHour }, () => now),
        cooldowns: [],
      })}`,
      updatedAt: now,
    });

    await expect(sendFriendRequest(ME, 'Person 0')).rejects.toMatchObject({ statusCode: 429 });
  });

  test('caps outstanding requests', async () => {
    stubUserLookup(PEER);
    const now = new Date().toISOString();
    awsLib.__rows.set(`msg_index_user-me::2000-01-01T00:00:00.000Z`, {
      id: 'msg_index_user-me',
      createdAt: '2000-01-01T00:00:00.000Z',
      kind: 'msgIndex',
      version: 1,
      text: `|MsgIndex:${JSON.stringify({
        contacts: [],
        pendingIn: [],
        pendingOut: Array.from({ length: LIMITS.pendingOutMax }, (_, i) => ({ userId: `x${i}`, nickname: `X${i}`, at: now })),
        requestLog: [],
        cooldowns: [],
      })}`,
      updatedAt: now,
    });

    await expect(sendFriendRequest(ME, 'Peer One')).rejects.toMatchObject({ statusCode: 429 });
  });

  test('honours the cooldown after a decline, on both sides', async () => {
    stubUserLookup(ME, PEER);
    await sendFriendRequest(ME, 'Peer One');
    await acceptFriendRequest(PEER, 'user-me'); // establish the pair first
    await removeContact(ME, 'user-peer');

    // Rebuild a *pending* request so there is something to decline.
    await sendFriendRequest(ME, 'Peer One');
    await declineFriendRequest(PEER, 'user-me');

    await expect(sendFriendRequest(ME, 'Peer One')).rejects.toMatchObject({ statusCode: 429 });
    await expect(sendFriendRequest(PEER, 'Me User')).rejects.toMatchObject({ statusCode: 429 });
  });

  test('sending to someone who already asked you accepts instead', async () => {
    stubUserLookup(ME, PEER);
    await sendFriendRequest(PEER, 'Me User');
    const result = await sendFriendRequest(ME, 'Peer One');
    expect(result.autoAccepted).toBe(true);
    expect(await areFriends('user-me', 'user-peer')).toBe(true);
  });

  test('accepting creates the friendship and both contact lists', async () => {
    stubUserLookup(PEER);
    await sendFriendRequest(ME, 'Peer One');
    await acceptFriendRequest(PEER, 'user-me');

    const mine = JSON.parse(rowFor('msg_index_user-me').text.replace('|MsgIndex:', ''));
    const theirs = JSON.parse(rowFor('msg_index_user-peer').text.replace('|MsgIndex:', ''));

    expect(mine.pendingOut).toEqual([]);
    expect(mine.contacts[0]).toMatchObject({ userId: 'user-peer', nickname: 'Peer One' });
    expect(theirs.pendingIn).toEqual([]);
    expect(theirs.contacts[0]).toMatchObject({ userId: 'user-me', nickname: 'Me User' });
    expect(rowFor(friendId('user-me', 'user-peer'))).toBeTruthy();
  });

  test('declining removes the request from both sides', async () => {
    stubUserLookup(PEER);
    await sendFriendRequest(ME, 'Peer One');
    await declineFriendRequest(PEER, 'user-me');

    expect(await areFriends('user-me', 'user-peer')).toBe(false);
    const theirs = JSON.parse(rowFor('msg_index_user-peer').text.replace('|MsgIndex:', ''));
    expect(theirs.pendingIn).toEqual([]);
    expect(theirs.cooldowns).toEqual([expect.objectContaining({ userId: 'user-me' })]);
  });

  test('withdrawing an outgoing request clears the other side too', async () => {
    stubUserLookup(PEER);
    await sendFriendRequest(ME, 'Peer One');
    await cancelFriendRequest(ME, 'user-peer');

    const mine = JSON.parse(rowFor('msg_index_user-me').text.replace('|MsgIndex:', ''));
    const theirs = JSON.parse(rowFor('msg_index_user-peer').text.replace('|MsgIndex:', ''));
    expect(mine.pendingOut).toEqual([]);
    expect(theirs.pendingIn).toEqual([]);
  });
});

/** Put the two accounts in a connected state. */
async function connect() {
  stubUserLookup(ME, PEER);
  await sendFriendRequest(ME, 'Peer One');
  await acceptFriendRequest(PEER, 'user-me');
}

describe('messaging', () => {
  test('refuses a conversation with someone you are not connected to', async () => {
    stubUserLookup(STRANGER);
    await expect(listMessages(ME, 'user-stranger')).rejects.toMatchObject({ statusCode: 403 });
    await expect(sendMessage(ME, 'user-stranger', 'hi')).rejects.toMatchObject({ statusCode: 403 });
  });

  test('refuses an empty or oversized body', async () => {
    await connect();
    await expect(sendMessage(ME, 'user-peer', '   ')).rejects.toMatchObject({ statusCode: 400 });
    await expect(sendMessage(ME, 'user-peer', 'x'.repeat(LIMITS.bodyMax + 1))).rejects.toMatchObject({ statusCode: 400 });
  });

  test('stores the body encrypted, never in the clear', async () => {
    await connect();
    await sendMessage(ME, 'user-peer', 'the eagle lands at midnight');

    const convId = convIdFor('user-me', 'user-peer');
    const rows = [...awsLib.__rows.values()].filter((r) => r.id === `msg_msg_${convId}`);
    expect(rows).toHaveLength(1);
    expect(rows[0].body).not.toContain('eagle');
    expect(rows[0].text).toBe('|Msg:'); // the text column holds a marker only
    expect(JSON.stringify(rows[0])).not.toContain('eagle');
  });

  test('round-trips message text verbatim — ampersands, angle brackets and emoji', async () => {
    await connect();
    // ⚠️ The message route deliberately does NOT run the shared `sanitizeInput`,
    // which HTML-escapes plain text ("Tom & Jerry" → "Tom &amp; Jerry"). A chat
    // that mangles what you typed is worse than useless.
    const body = 'Tom & Jerry said 5 < 6 > 4 and <b>this</b> is literal 🎉';
    await sendMessage(ME, 'user-peer', body);

    const { messages } = await listMessages(ME, 'user-peer');
    expect(messages[0].body).toBe(body);
    expect(messages[0].body).not.toContain('&amp;');
    expect(messages[0].body).not.toContain('&lt;');
  });

  test('trims surrounding whitespace but keeps the text inside it', async () => {
    await connect();
    await sendMessage(ME, 'user-peer', '  spaced  out  ');
    const { messages } = await listMessages(ME, 'user-peer');
    expect(messages[0].body).toBe('spaced  out');
  });

  test('bumps the recipient unread count and the sidebar preview on both sides', async () => {
    await connect();
    await sendMessage(ME, 'user-peer', 'ping');

    const mine = JSON.parse(rowFor('msg_index_user-me').text.replace('|MsgIndex:', ''));
    const theirs = JSON.parse(rowFor('msg_index_user-peer').text.replace('|MsgIndex:', ''));

    expect(mine.contacts[0]).toMatchObject({ userId: 'user-peer', unread: 0 });
    expect(theirs.contacts[0]).toMatchObject({ userId: 'user-me', unread: 1 });

    const directory = await getDirectory(PEER);
    expect(directory.contacts[0].lastPreview).toBe('ping'); // decrypted for display
    expect(directory.contacts[0].unread).toBe(1);
    // …and the stored form is still ciphertext.
    expect(theirs.contacts[0].lastPreview).not.toContain('ping');
  });

  test('reads a conversation oldest-first, and only what is after the cursor', async () => {
    await connect();
    const first = await sendMessage(ME, 'user-peer', 'one');
    await sendMessage(PEER, 'user-me', 'two');
    await sendMessage(ME, 'user-peer', 'three');

    const all = await listMessages(ME, 'user-peer');
    expect(all.messages.map((m) => m.body)).toEqual(['one', 'two', 'three']);
    expect(all.messages.map((m) => m.from)).toEqual(['me', 'them', 'me']);

    const since = await listMessages(ME, 'user-peer', { since: first.message.cursor });
    expect(since.messages.map((m) => m.body)).toEqual(['two', 'three']);
  });

  test('reading a conversation does not destroy the messages it marks read', async () => {
    await connect();
    await sendMessage(PEER, 'user-me', 'do not lose me');

    const convId = convIdFor('user-me', 'user-peer');
    const before = [...awsLib.__rows.values()].filter((r) => r.id === `msg_msg_${convId}`);
    expect(before).toHaveLength(1);

    await markConversationRead(ME, 'user-peer');

    const after = [...awsLib.__rows.values()].filter((r) => r.id === `msg_msg_${convId}`);
    expect(after).toHaveLength(1);
    // The regression this guards: a read receipt written as a whole-row Put left
    // `body: null`, so marking a message read erased it.
    expect(after[0].body).toBe(before[0].body);
    expect(after[0].readAt).toBeTruthy();

    const directory = await getDirectory(ME);
    expect(directory.contacts[0].unread).toBe(0);
    // Still readable afterwards.
    const { messages } = await listMessages(ME, 'user-peer');
    expect(messages.map((m) => m.body)).toEqual(['do not lose me']);
  });

  test('messages from an undecryptable row degrade to null instead of throwing', async () => {
    await connect();
    await sendMessage(ME, 'user-peer', 'fine');
    const convId = convIdFor('user-me', 'user-peer');
    const row = [...awsLib.__rows.values()].find((r) => r.id === `msg_msg_${convId}`);
    row.body = encrypt('fine', 'some-other-conversation'); // wrong AAD

    const { messages } = await listMessages(ME, 'user-peer');
    expect(messages[0].body).toBeNull();
  });
});

describe('directory', () => {
  test('reports how much of the request budget is left', async () => {
    const directory = await getDirectory(ME);
    expect(directory.me).toEqual({ userId: 'user-me', nickname: 'Me User' });
    expect(directory.remaining).toEqual({
      pendingOut: LIMITS.pendingOutMax,
      thisHour: LIMITS.requestsPerHour,
      today: LIMITS.requestsPerDay,
      contacts: LIMITS.contactsMax,
    });
  });

  test('rebuilds a lost index from the friendship rows instead of showing an empty page', async () => {
    await connect();
    awsLib.__rows.delete('msg_index_user-me::2000-01-01T00:00:00.000Z');

    // The rebuild scans by `kind`, so answer that shape.
    const friendRow = rowFor(friendId('user-me', 'user-peer'));
    paginatedScan.mockResolvedValue([friendRow]);

    const directory = await getDirectory(ME);
    expect(directory.contacts).toHaveLength(1);
    expect(directory.contacts[0]).toMatchObject({ userId: 'user-peer', nickname: 'Peer One' });
  });
});

describe('collectAvatars', () => {
  // Real, decodable images — a hand-written base64 blob is not a picture, and
  // sharp rejecting it (`src: null`) would silently make these assertions pass
  // for the wrong reason.
  const png = async (rgb = { r: 9, g: 120, b: 200 }) => {
    const buffer = await sharp({
      create: { width: 4, height: 4, channels: 3, background: rgb },
    }).png().toBuffer();
    return `data:image/png;base64,${buffer.toString('base64')}`;
  };
  let TINY_PNG;
  let OTHER_PNG;
  beforeAll(async () => {
    TINY_PNG = await png();
    OTHER_PNG = await png({ r: 220, g: 30, b: 40 });
  });

  /** Seed the account row a peer lookup will read. */
  const setPeerPicture = (user, picture) => {
    awsLib.__rows.set(`${user.id}::2020-01-01T00:00:00.000Z`, {
      id: user.id,
      text: user.text,
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
      ...(picture ? { profilePicture: picture } : {}),
    });
  };

  test('returns a friend’s picture, downscaled to an avatar', async () => {
    await connect();
    setPeerPicture(PEER, TINY_PNG);

    const result = await collectAvatars(ME, ['user-peer']);
    expect(result.avatars['user-peer'].src.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(result.avatars['user-peer'].etag).toHaveLength(16);
    expect(result.skipped).toEqual([]);
  });

  test('⚠️ refuses a picture for an account you are not connected to', async () => {
    // The rule the whole feature hangs on: typing a username does not show you
    // that person's face. Only an accepted connection does.
    setPeerPicture(STRANGER, TINY_PNG);

    const result = await collectAvatars(ME, ['user-stranger']);
    expect(result.avatars).toEqual({});
    expect(result.skipped).toEqual(['user-stranger']);
  });

  test('refuses a picture for a PENDING request, on both sides', async () => {
    stubUserLookup(ME, PEER);
    await sendFriendRequest(ME, 'Peer One');   // pending, not accepted
    setPeerPicture(PEER, TINY_PNG);

    await expect(collectAvatars(ME, ['user-peer'])).resolves.toMatchObject({ skipped: ['user-peer'] });
    await expect(collectAvatars(PEER, ['user-me'])).resolves.toMatchObject({ skipped: ['user-me'] });
  });

  test('a friend with no picture is a null src with the empty etag', async () => {
    await connect();
    setPeerPicture(PEER, null);

    const result = await collectAvatars(ME, ['user-peer']);
    // Sent (not skipped) so the client caches "no avatar" and stops asking.
    expect(result.avatars['user-peer']).toEqual({ src: null, etag: '' });
  });

  test('an unchanged etag comes back as `unchanged`, with no image', async () => {
    await connect();
    setPeerPicture(PEER, TINY_PNG);

    const first = await collectAvatars(ME, ['user-peer']);
    const second = await collectAvatars(ME, ['user-peer'], { 'user-peer': first.avatars['user-peer'].etag });

    expect(second.avatars).toEqual({});
    expect(second.unchanged).toEqual(['user-peer']);
  });

  test('a changed picture is re-sent even with a stale etag sent back', async () => {
    await connect();
    setPeerPicture(PEER, TINY_PNG);
    const first = await collectAvatars(ME, ['user-peer']);

    setPeerPicture(PEER, OTHER_PNG);
    const second = await collectAvatars(ME, ['user-peer'], { 'user-peer': first.avatars['user-peer'].etag });

    expect(second.unchanged).toEqual([]);
    expect(second.avatars['user-peer'].etag).not.toBe(first.avatars['user-peer'].etag);
    expect(second.avatars['user-peer'].src.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  test('a friend with an undecodable picture is cached as “no avatar”, not retried forever', async () => {
    await connect();
    setPeerPicture(PEER, 'data:image/jpeg;base64,bm90LWFuLWltYWdl');

    const result = await collectAvatars(ME, ['user-peer']);
    // src is null, but the etag is the REAL hash of the stored value — so the
    // client caches it and stops asking for a picture that will never decode.
    expect(result.avatars['user-peer'].src).toBeNull();
    expect(result.avatars['user-peer'].etag).toHaveLength(16);

    const again = await collectAvatars(ME, ['user-peer'], { 'user-peer': result.avatars['user-peer'].etag });
    expect(again.unchanged).toEqual(['user-peer']);
  });

  test('never asks about yourself, and de-duplicates the ids', async () => {
    const result = await collectAvatars(ME, ['user-me', 'user-me', 'user-stranger']);
    expect([...result.skipped, ...Object.keys(result.avatars)]).not.toContain('user-me');
    expect(result.skipped).toEqual(['user-stranger']);
  });

  test('caps how many accounts one call will look up', async () => {
    const ids = Array.from({ length: 30 }, (_, i) => `user-${i}`);
    const result = await collectAvatars(ME, ids);
    const handled = Object.keys(result.avatars).length + result.skipped.length;
    expect(handled).toBe(result.limit);
  });
});
