/* Minimal offline-capable service worker.
 *
 * Navigations are network-first so a bad deploy can never brick the site;
 * same-origin static assets are cache-first (populating the cache on first
 * load) so repeat visits work offline.
 *
 * ⚠️ BUMP THE VERSION whenever a static file under `public/` changes, because
 * cache-first is exactly as sticky as it sounds. v2 -> v3 carried the reworked brand
 * mark (the tab icon and the apple-touch icon); v3 -> v4 carried the follow-up that
 * restyled the tab and addon icons as a badge. Either bump alone would have left every
 * returning visitor on the previous logo indefinitely, because their service worker had
 * already cached it under the current version. `/assets/*` is hashed and self-busting;
 * `public/` is not.
 */
const CACHE = 'sthopwood-v4';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept API requests. They are dynamic and auth-aware — e.g.
  // /api/data/home-title resolves a different title per visitor, and
  // /api/data/admin/home-title must always reflect the latest saved rules.
  // Caching them (even cache-first) would serve stale admin data and could
  // leak one user's personalized response to another.
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/index.html'))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        }),
    ),
  );
});
