import { useEffect, useMemo, useRef, useState } from 'react';
import { getMessengerAvatars } from '../services/messengerApi.js';
import {
  mergeAvatars,
  planAvatarRequest,
  readAvatarCache,
  resolveAvatar,
  writeAvatarCache,
} from '../utils/avatarCache.js';

/**
 * useAvatars — profile pictures for a set of account ids.
 *
 * Returns `{ [userId]: src }` where a missing key (or a `null`) means "no picture
 * — draw initials". The fetching is deliberately lazy and cache-first: if every
 * id is already cached and fresh, **no request is made at all**, so opening Talk
 * costs nothing until a picture is new or a day old.
 *
 * Pictures only ever arrive for accepted connections (the server gates on the
 * friendship row), so `useAvatars` is safe to call with any id — a stranger's id
 * simply comes back in `skipped` and is never cached.
 *
 * @param {string[]} ids - Accounts to draw (contacts, or a single DM peer).
 * @param {string} token - The signed-in user's JWT.
 */
export default function useAvatars(ids = [], token) {
  const [cache, setCache] = useState(() => readAvatarCache());

  // The effect must not depend on `cache` (it writes it), so the current value is
  // read from a ref instead.
  const cacheRef = useRef(cache);
  cacheRef.current = cache;

  // A stable primitive dep: the same set of ids in a different order is the same
  // request, and an array identity would re-run the effect on every render.
  const idKey = useMemo(() => [...new Set(ids.filter(Boolean).map(String))].sort().join(','), [ids]);

  useEffect(() => {
    if (!token || !idKey) return undefined;

    const { batches } = planAvatarRequest(idKey.split(','), cacheRef.current, Date.now());
    if (batches.length === 0) return undefined;

    let cancelled = false;

    (async () => {
      let next = cacheRef.current;
      let changed = false;

      for (const batch of batches) {
        try {
          const response = await getMessengerAvatars(token, batch);
          next = mergeAvatars(next, response, Date.now());
          changed = true;
        } catch {
          // A failed avatar request is cosmetic: the rows keep their initials and
          // the next visit tries again. Never surface it as a page error.
        }
      }

      if (!cancelled && changed) {
        writeAvatarCache(next);
        setCache(next);
      }
    })();

    return () => { cancelled = true; };
  }, [idKey, token]);

  return useMemo(() => {
    const map = {};
    for (const id of idKey ? idKey.split(',') : []) {
      const resolved = resolveAvatar(cache, id);
      // A stale picture is still returned — a face from yesterday beats initials,
      // and the effect above is already refreshing it.
      if (resolved?.src) map[id] = resolved.src;
    }
    return map;
  }, [idKey, cache]);
}