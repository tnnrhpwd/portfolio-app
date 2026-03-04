/**
 * Backend warm-up ping — fires a single GET /health to the Render backend
 * as early as possible so the instance is awake by the time the user
 * actually interacts with the app.
 *
 * Call `warmBackend()` once on app mount (fire-and-forget).
 */

import { RENDER_HEALTH_URL } from '../config/api.js';

let warmed = false;

export function warmBackend() {
  if (warmed) return;
  warmed = true;

  // Don't warm in development — the backend is already running locally
  if (import.meta.env.DEV) return;

  // Use a low-priority fetch so it doesn't compete with critical resources
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout

  fetch(RENDER_HEALTH_URL, {
    method: 'GET',
    signal: controller.signal,
    // 'no-cors' avoids CORS errors since we only care about waking the server
    mode: 'no-cors',
    priority: 'low',
  })
    .catch(() => {}) // swallow errors — this is best-effort
    .finally(() => clearTimeout(timeout));
}
