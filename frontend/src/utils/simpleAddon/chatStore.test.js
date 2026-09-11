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

import { CHATS_STORAGE_KEY, readLocalConversations, writeLocalConversations } from './chatStore';

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
