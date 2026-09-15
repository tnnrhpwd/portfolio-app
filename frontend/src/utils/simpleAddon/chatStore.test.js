/**
 * The module only touches `localStorage` at call time, so a minimal in-memory
 * stub lets us drive every path deterministically — including the "storage
 * unavailable / blocked" one, which is just a stub that throws.
 *
 * The stub MUST be installed with `Object.defineProperty`, not plain assignment:
 * under jest-environment-jsdom (the root `package.json` config) `localStorage`
 * is already an accessor on the global, so `global.localStorage = stub` is
 * silently ignored and the tests silently share jsdom's real, per-file store —
 * which leaks writes between tests.
 */
const makeStorage = () => {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    clear: () => map.clear(),
  };
};

const stubStorage = (storage) => {
  Object.defineProperty(global, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
};

import {
  CHATS_STORAGE_KEY,
  readLocalConversations,
  writeLocalConversations,
  hasMessages,
  mergeMessageLists,
  adoptSyncedConversations,
} from './chatStore';

beforeEach(() => { stubStorage(makeStorage()); });
afterAll(() => { delete global.localStorage; });

describe('chatStore', () => {
  test('reads back what it wrote', () => {
    const list = [{ id: '1', title: 'New Chat', messages: [] }];
    expect(writeLocalConversations(list)).toBe(true);
    expect(readLocalConversations()).toEqual(list);
  });

  test('a missing store reads as an empty list, not an error', () => {
    expect(readLocalConversations()).toEqual([]);
  });

  test('corrupt JSON reads as an empty list instead of throwing', () => {
    localStorage.setItem(CHATS_STORAGE_KEY, '{not json');
    expect(readLocalConversations()).toEqual([]);
  });

  test('a non-array payload is ignored', () => {
    localStorage.setItem(CHATS_STORAGE_KEY, JSON.stringify({ id: '1' }));
    expect(readLocalConversations()).toEqual([]);
  });

  test('never wipes the store with an empty list', () => {
    localStorage.setItem(CHATS_STORAGE_KEY, JSON.stringify([{ id: '1', messages: [] }]));
    expect(writeLocalConversations([])).toBe(false);
    expect(readLocalConversations()).toHaveLength(1);
    expect(writeLocalConversations(null)).toBe(false);
    expect(readLocalConversations()).toHaveLength(1);
  });

  test('storage that throws degrades to no local copy', () => {
    stubStorage({
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    });
    expect(readLocalConversations()).toEqual([]);
    expect(writeLocalConversations([{ id: '1', messages: [] }])).toBe(false);
  });
});

/**
 * The adoption path is where a just-sent message could disappear: the cloud sync
 * polls while a turn is running, and until the backend saves the finished turn a
 * conversation's user message exists only locally. Replacing local state with
 * that (stale) snapshot lost the message AND made the active conversation
 * vanish, which dropped the user into an unrelated older chat.
 */
describe('chatStore.adoptSyncedConversations', () => {
  const conv = (id, messages = [], extra = {}) => ({ id, title: `chat ${id}`, messages, createdAt: '2026-01-01T00:00:00.000Z', ...extra });
  const msg = (id, content, ts) => ({ id, role: 'user', content, timestamp: ts });

  test('keeps a local message the server has not saved yet', () => {
    const local = [conv('1', [msg('m1', 'hi', '2026-01-01T00:00:00.000Z'), msg('m2', 'just sent', '2026-01-01T00:00:05.000Z')])];
    const server = [conv('1', [msg('m1', 'hi', '2026-01-01T00:00:00.000Z')])];

    const next = adoptSyncedConversations(local, server);

    expect(next[0].messages.map((m) => m.content)).toEqual(['hi', 'just sent']);
  });

  test('keeps a locally-created conversation that is not on the server yet', () => {
    const local = [conv('new-1', [msg('m1', 'brand new', '2026-01-01T00:00:00.000Z')])];
    const server = [conv('old-1', [msg('m9', 'older', '2025-12-31T00:00:00.000Z')])];

    const next = adoptSyncedConversations(local, server);

    expect(next.map((c) => c.id)).toEqual(['new-1', 'old-1']);
    expect(next[0].messages[0].content).toBe('brand new');
  });

  test('drops a conversation the tombstone set says was deleted', () => {
    const local = [conv('gone', [msg('m1', 'deleted elsewhere', '2026-01-01T00:00:00.000Z')]), conv('keep', [])];
    const next = adoptSyncedConversations(local, [], ['gone']);

    expect(next.map((c) => c.id)).toEqual(['keep']);
  });

  test('takes conversations other devices added', () => {
    const local = [conv('1', [])];
    const server = [conv('1', []), conv('2', [msg('m3', 'from my phone', '2026-01-02T00:00:00.000Z')])];

    const next = adoptSyncedConversations(local, server);

    expect(next.map((c) => c.id)).toEqual(['1', '2']);
  });

  test('returns the same array when nothing changed, so the debounced save does not retrigger', () => {
    const local = [conv('1', [msg('m1', 'hi', '2026-01-01T00:00:00.000Z')])];
    const server = [conv('1', [msg('m1', 'hi', '2026-01-01T00:00:00.000Z')])];
    local[0].updatedAt = '2026-01-01T00:00:00.000Z';
    server[0].updatedAt = '2026-01-01T00:00:00.000Z';

    expect(adoptSyncedConversations(local, server)).toBe(local);
  });

  test('never returns an empty list', () => {
    const next = adoptSyncedConversations([conv('1', [], { }), conv('2', [])], [], ['1', '2']);

    expect(next).toHaveLength(1);
    expect(next[0].title).toBe('New Chat');
    expect(hasMessages(next[0])).toBe(false);
  });

  test('a vanished active conversation is the case this prevents', () => {
    // Regression: with the old adopt(), this returned only the server's copy, so
    // the active id ('1') disappeared from the list and the caller jumped the
    // user to conversations[0] — an unrelated older chat.
    const local = [conv('1', [msg('m1', 'the message I just typed', '2026-01-01T00:00:09.000Z')])];
    const next = adoptSyncedConversations(local, [], []);

    expect(next.find((c) => String(c.id) === '1')).toBeDefined();
    expect(next.find((c) => String(c.id) === '1').messages[0].content).toBe('the message I just typed');
  });
});

describe('chatStore.mergeMessageLists', () => {
  test('unions by id, oldest first, and keeps the longer body', () => {
    const merged = mergeMessageLists(
      [{ id: 'b', content: 'grow', timestamp: '2026-01-01T00:00:02.000Z' }, { id: 'a', content: 'first', timestamp: '2026-01-01T00:00:00.000Z' }],
      [{ id: 'b', content: 'growing longer', timestamp: '2026-01-01T00:00:02.000Z' }]
    );

    expect(merged.map((m) => m.id)).toEqual(['a', 'b']);
    expect(merged[1].content).toBe('growing longer');
  });

  test('handles missing lists', () => {
    expect(mergeMessageLists(undefined, undefined)).toEqual([]);
    expect(mergeMessageLists([{ id: 'x', content: 'x' }], null)).toHaveLength(1);
  });
});
