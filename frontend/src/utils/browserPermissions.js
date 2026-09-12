/**
 * Browser permission helpers — the one place that decides when the app is
 * allowed to trigger a browser permission popup.
 *
 * Browsers show a popup the first time a page calls `getUserMedia()`
 * (microphone) or `geolocation.getCurrentPosition()`. Calling either one
 * automatically on mount is how a visitor gets ambushed by a popup they never
 * asked for, so the app follows this rule:
 *
 *   1. Already granted by the browser → use it, no popup (the browser is quiet).
 *   2. Not granted → only the user's deliberate action may open the popup
 *      (pressing a mic button, clicking "Use my location", or flipping an
 *      opt-in toggle in Settings).
 *
 * `queryPermissionState` reads the browser's current state WITHOUT prompting.
 * The opt-in flag (`isPermissionEnabled` / `setPermissionEnabled`) is a
 * device-local preference that says "yes, Simple may ask for this here", so a
 * page may auto-request for someone who already opted in.
 *
 * The opt-in lives in `localStorage` and is intentionally NOT synced to the
 * account: a browser permission belongs to this browser on this machine, so
 * copying it to another device would be a lie — that device would still popup.
 */

export const MICROPHONE = 'microphone';
export const GEOLOCATION = 'geolocation';

const PREFS_KEY = 'csimple_permission_prefs';

/** Read the raw opt-in map. Never throws (private browsing, disabled storage). */
export function readPermissionPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Has the user opted in to being asked for this permission on this device? */
export function isPermissionEnabled(kind) {
  return readPermissionPrefs()[kind] === true;
}

/** Record (or clear) the device-local opt-in for a permission. */
export function setPermissionEnabled(kind, enabled) {
  try {
    const prefs = readPermissionPrefs();
    prefs[kind] = !!enabled;
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage unavailable — the caller still gets the value back so the UI can
    // reflect the choice for this session.
  }
  return !!enabled;
}

/**
 * Read the browser's CURRENT permission state without triggering a popup.
 * Returns 'granted' | 'denied' | 'prompt' | 'unsupported'.
 *
 * Firefox and Safari reject some descriptors (notably 'microphone'), so a
 * rejected query is reported as 'unsupported' rather than an error — callers
 * then fall back to "only prompt on an explicit user action".
 */
export async function queryPermissionState(kind) {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) {
    return 'unsupported';
  }
  try {
    const status = await navigator.permissions.query({ name: kind });
    return status?.state || 'unsupported';
  } catch {
    return 'unsupported';
  }
}

/** True when the browser will answer without showing a popup. */
export async function hasPermission(kind) {
  return (await queryPermissionState(kind)) === 'granted';
}
