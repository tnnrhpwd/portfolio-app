/**
 * Centralized API configuration — single source of truth for the backend URL.
 *
 * In development: all requests are proxied via Vite (`/api` → localhost:5000).
 * In production on sthopwood.com: routes through Netlify's `/api/*` proxy or
 * falls back to the direct Render URL.
 */

const DEV = import.meta.env.DEV;                          // true when `vite dev`
const RENDER_URL = 'https://mern-plan-web-service.onrender.com';

/**
 * Returns the base URL for all API calls (always ends with `/api/data/`).
 */
export function getApiBase() {
  if (DEV) return '/api/data/';

  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'www.sthopwood.com' || host === 'sthopwood.com') {
      // Use Netlify proxy — avoids exposing the Render origin to the browser
      return '/api/data/';
    }
    // Deploy-previews / other domains: direct to Render
    return `${RENDER_URL}/api/data/`;
  }

  return `${RENDER_URL}/api/data/`;
}

/**
 * Full origin of the backend (no trailing path).
 * Useful when you need to build non-data URLs (e.g., /api/data/forgot-password).
 */
export function getApiOrigin() {
  if (DEV) return '';                       // relative → Vite proxy handles it
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'www.sthopwood.com' || host === 'sthopwood.com') {
      return '';                             // relative → Netlify proxy
    }
  }
  return RENDER_URL;
}

/** Direct Render health-check URL (used for warming pings, not user traffic). */
export const RENDER_HEALTH_URL = `${RENDER_URL}/health`;
