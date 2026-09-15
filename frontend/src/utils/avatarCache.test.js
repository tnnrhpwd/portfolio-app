/**
 * avatarCache.test.js — the client's store of friends' pictures.
 *
 * The behaviour that matters is *when a request is made at all*: a contact list
 * whose pictures are cached must cost zero requests, and a picture that changed
 * must still arrive. Both are easy to get subtly wrong and impossible to notice
 * by looking at a screenshot.
 */

import {
  AVATAR_BATCH_SIZE,
  AVATAR_MAX_ENTRIES,
  AVATAR_STORAGE_KEY,
  AVATAR_TTL_MS,
  mergeAvatars,
  planAvatarRequest,
  readAvatarCache,
  resolveAvatar,
  writeAvatarCache,
} from './avatarCache';

/** A stand-in for localStorage, so no test depends on jsdom's implementation. */
function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
    _data: data,
  };
}

const entry = (src = 'data:image/jpeg;base64,AAA', etag = 'abc123', at = Date.now()) => ({ src, etag, at });

describe('read / write', () => {
  test('round-trips entries through storage', () => {
    const storage = fakeStorage();
    writeAvatarCache({ 'user-1': entry() }, storage);
    expect(readAvatarCache(storage)['user-1'].src).toBe('data:image/jpeg;base64,AAA');
  });

  test('an absent, corrupt, or wrong-version blob reads as empty rather than throwing', () => {
    expect(readAvatarCache(fakeStorage())).toEqual({});
    expect(readAvatarCache(fakeStorage({ [AVATAR_STORAGE_KEY]: 'not json' }))).toEqual({});
    expect(readAvatarCache(fakeStorage({ [AVATAR_STORAGE_KEY]: '{"v":99,"entries":{"a":1}}' }))).toEqual({});
    expect(readAvatarCache(fakeStorage({ [AVATAR_STORAGE_KEY]: 'null' }))).toEqual({});
  });

  test('an unusable storage is not an error — the cache is an optimisation', () => {
    const hostile = {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('QuotaExceededError'); },
    };
    expect(readAvatarCache(hostile)).toEqual({});
    expect(() => writeAvatarCache({ a: entry() }, hostile)).not.toThrow();
  });

  test('keeps the newest entries when over the cap', () => {
    const storage = fakeStorage();
    const many = {};
    for (let i = 0; i < AVATAR_MAX_ENTRIES + 25; i += 1) {
      many[`user-${i}`] = entry('data:image/jpeg;base64,AAA', 'e', 1000 + i);
    }
    writeAvatarCache(many, storage);

    const read = readAvatarCache(storage);
    expect(Object.keys(read)).toHaveLength(AVATAR_MAX_ENTRIES);
    expect(read[`user-${AVATAR_MAX_ENTRIES + 24}`]).toBeDefined(); // newest kept
    expect(read['user-0']).toBeUndefined();                        // oldest dropped
  });
});

describe('resolveAvatar', () => {
  const now = Date.now();

  test('knows nothing about an account it has never seen', () => {
    expect(resolveAvatar({}, 'user-1', now)).toBeNull();
  });

  test('reports a fresh entry as not stale', () => {
    expect(resolveAvatar({ 'user-1': entry('src', 'e', now) }, 'user-1', now))
      .toEqual({ src: 'src', etag: 'e', stale: false });
  });

  test('a stale entry is still returned — a face from yesterday beats initials', () => {
    const old = entry('src', 'e', now - AVATAR_TTL_MS - 1);
    expect(resolveAvatar({ 'user-1': old }, 'user-1', now)).toMatchObject({ src: 'src', stale: true });
  });

  test('“no picture” is a stored answer, not a missing one', () => {
    expect(resolveAvatar({ 'user-1': entry(null, '', now) }, 'user-1', now))
      .toEqual({ src: null, etag: '', stale: false });
  });
});

describe('planAvatarRequest', () => {
  const now = Date.now();

  test('asks for nothing when everything is cached and fresh', () => {
    const cache = { a: entry('s', 'e', now), b: entry(null, '', now) };
    expect(planAvatarRequest(['a', 'b'], cache, now).batches).toEqual([]);
  });

  test('asks for an account it has never seen, with no `have` to send', () => {
    const { batches } = planAvatarRequest(['a'], {}, now);
    expect(batches).toEqual([{ ids: ['a'], have: '' }]);
  });

  test('re-asks for a stale entry, and sends the etag it holds', () => {
    const cache = { a: entry('s', 'etag-a', now - AVATAR_TTL_MS - 1) };
    const { batches } = planAvatarRequest(['a'], cache, now);
    expect(batches).toEqual([{ ids: ['a'], have: 'a:etag-a' }]);
  });

  test('chunks long lists and only sends `have` for ids in that chunk', () => {
    const ids = Array.from({ length: AVATAR_BATCH_SIZE + 3 }, (_, i) => `u${i}`);
    const cache = Object.fromEntries(ids.map((id) => [id, entry('s', `e-${id}`, now - AVATAR_TTL_MS - 1)]));

    const { batches } = planAvatarRequest(ids, cache, now);
    expect(batches).toHaveLength(2);
    expect(batches[0].ids).toHaveLength(AVATAR_BATCH_SIZE);
    expect(batches[1].ids).toHaveLength(3);
    expect(batches[1].have).toBe(`u${AVATAR_BATCH_SIZE}:e-u${AVATAR_BATCH_SIZE},u${AVATAR_BATCH_SIZE + 1}:e-u${AVATAR_BATCH_SIZE + 1},u${AVATAR_BATCH_SIZE + 2}:e-u${AVATAR_BATCH_SIZE + 2}`);
  });

  test('de-duplicates ids and drops empty ones', () => {
    const { batches } = planAvatarRequest(['a', 'a', '', null, undefined, 'b'], {}, now);
    expect(batches[0].ids).toEqual(['a', 'b']);
  });

  test('reports what it skipped, so a caller can tell "asked for nothing" from "asked for everything"', () => {
    const cache = { a: entry('s', 'e', now) };
    const { batches, skipped } = planAvatarRequest(['a', 'b'], cache, now);
    expect(skipped).toEqual(['a']);
    expect(batches[0].ids).toEqual(['b']);
  });
});

describe('mergeAvatars', () => {
  const now = Date.now();

  test('stores a new picture with its etag', () => {
    const next = mergeAvatars({}, { avatars: { a: { src: 'data:image/jpeg;base64,QQ', etag: 'e1' } } }, now);
    expect(next.a).toEqual({ src: 'data:image/jpeg;base64,QQ', etag: 'e1', at: now });
  });

  test('stores “no picture” as a real entry so we stop asking', () => {
    const next = mergeAvatars({}, { avatars: { a: { src: null, etag: '' } } }, now);
    expect(next.a).toEqual({ src: null, etag: '', at: now });
  });

  test('`unchanged` refreshes the timestamp and keeps the picture we already have', () => {
    const cache = { a: entry('keep-me', 'e1', now - AVATAR_TTL_MS * 2) };
    const next = mergeAvatars(cache, { unchanged: ['a'] }, now);
    expect(next.a).toEqual({ src: 'keep-me', etag: 'e1', at: now });
  });

  test('`unchanged` for an account we have nothing for does not invent an entry', () => {
    expect(mergeAvatars({}, { unchanged: ['a'] }, now)).toEqual({});
  });

  test('⚠️ prunes a skipped account, because skipped means “not connected anymore”', () => {
    // Keeping the picture would keep showing the face of someone we just removed.
    const cache = { a: entry('their-face', 'e1', now), b: entry('mine', 'e2', now) };
    const next = mergeAvatars(cache, { skipped: ['a'] }, now);
    expect(next.a).toBeUndefined();
    expect(next.b).toBeDefined();
  });

  test('does not mutate the cache it was given', () => {
    const cache = { a: entry('old', 'e1', now) };
    mergeAvatars(cache, { avatars: { a: { src: 'new', etag: 'e2' } } }, now);
    expect(cache.a.src).toBe('old');
  });

  test('an empty response changes nothing', () => {
    const cache = { a: entry('s', 'e', now) };
    expect(mergeAvatars(cache, {}, now)).toEqual(cache);
  });
});
