/**
 * Global fetch interceptor — detects expired/invalid JWTs on any API response
 * and clears the persisted user so the app reverts to a logged-out state.
 *
 * Many call sites (UsageMeter, csimpleApi, addon polling) use raw `fetch` and
 * therefore bypass the axios `handleTokenExpiration` helper. This patch makes
 * the behavior uniform for both.
 */

import { store } from '../app/store';
import { logout } from '../features/data/dataSlice';
import axios from 'axios';

let installed = false;
let loggingOut = false;

const AUTH_EXPIRED_MESSAGES = [
  'Not authorized, token expired',
  'Not authorized, invalid token',
  'Not authorized, invalid token format',
  'Not authorized, no token',
  'Not authorized',
  'User not found',
];

function shouldForceLogout(bodyText) {
  if (!bodyText) return true; // 401 with empty body — treat as auth failure
  try {
    const data = JSON.parse(bodyText);
    const msg = data?.dataMessage || data?.message || '';
    if (AUTH_EXPIRED_MESSAGES.some((m) => msg.includes(m))) return true;
    if (typeof msg === 'string' && msg.toLowerCase().includes('expired')) return true;
  } catch {
    if (AUTH_EXPIRED_MESSAGES.some((m) => bodyText.includes(m))) return true;
  }
  return false;
}

function forceLogout() {
  if (loggingOut) return;
  // Only force-logout if we actually have a stored user; otherwise the 401
  // is just an anonymous request hitting a protected route.
  if (!localStorage.getItem('user')) return;
  loggingOut = true;
  try {
    store.dispatch(logout());
  } catch {
    localStorage.removeItem('user');
  }

  // Redirect to /login unless the user is already on a public auth page
  try {
    const path = window.location.pathname || '';
    const publicAuthPaths = ['/login', '/register', '/forgot-password', '/reset-password'];
    const isOnAuthPage = publicAuthPaths.some((p) => path.startsWith(p));
    if (!isOnAuthPage) {
      const returnTo = encodeURIComponent(path + (window.location.search || ''));
      window.location.assign(`/login?sessionExpired=1&returnTo=${returnTo}`);
    }
  } catch {
    // Ignore navigation errors (e.g. non-browser env)
  }

  // Reset the guard shortly after so future sessions can be invalidated too
  setTimeout(() => { loggingOut = false; }, 1000);
}

export function installAuthInterceptor() {
  if (installed || typeof window === 'undefined' || !window.fetch) return;
  installed = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const response = await originalFetch(input, init);

    if (response.status === 401) {
      const url = typeof input === 'string' ? input : input?.url || '';
      // Only react to our own API; ignore third-party 401s
      if (url.includes('/api/data/') || url.includes('mern-plan-web-service')) {
        try {
          const clone = response.clone();
          const text = await clone.text();
          if (shouldForceLogout(text)) {
            forceLogout();
          }
        } catch {
          forceLogout();
        }
      }
    }

    return response;

  // Also install a global axios response interceptor for the same behavior
  axios.interceptors.response.use(
    (resp) => resp,
    (error) => {
      if (error?.response?.status === 401) {
        const url = error.config?.url || '';
        if (url.includes('/api/data/') || url.includes('mern-plan-web-service')) {
          const data = error.response.data;
          const text = typeof data === 'string' ? data : JSON.stringify(data || {});
          if (shouldForceLogout(text)) forceLogout();
        }
      }
      return Promise.reject(error);
    }
  );
  };
}
