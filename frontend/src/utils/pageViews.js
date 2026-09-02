/**
 * Page-view tracking — fires a lightweight beacon on every route change so
 * the backend can rank pages by visit count. Fire-and-forget: never blocks
 * navigation and never throws.
 *
 * Mirrors the existing web-vitals beacon pattern (relative `/api/data/...`
 * URL so it works through the Vite dev proxy and the Netlify production
 * proxy alike).
 */

const PAGEVIEW_ENDPOINT = '/api/data/analytics/pageview';

export function trackPageView(path = window.location.pathname) {
  try {
    if (!path) return;

    const payload = JSON.stringify({ path, timestamp: Date.now() });

    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        PAGEVIEW_ENDPOINT,
        new Blob([payload], { type: 'application/json' })
      );
    } else {
      fetch(PAGEVIEW_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // Tracking must never break the app.
  }
}
