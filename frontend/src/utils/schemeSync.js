/**
 * Push the site's colour scheme to the desktop addon.
 *
 * The two surfaces are different origins, so the addon cannot read this site's
 * `localStorage` — the value has to be handed over. It is handed to the addon's own
 * `settings.json` (its `webapp` block, via the local API's `PUT /api/settings`), which
 * is the same store the addon's Settings tab writes and the same one `appearance.js`
 * reads on its next window open. One value, two surfaces.
 *
 * ⚠️ THREE DELIBERATE PROPERTIES:
 *
 *  1. **Called when the scheme CHANGES, never on load.** `initScheme()` runs on every
 *     page for every visitor; pushing from there would (a) probe the addon on every
 *     page load for the ~everyone who has not installed it, and (b) overwrite an
 *     addon-side choice with the site's stored one each time a page opens. Choosing is
 *     what syncs — reading is not choosing.
 *
 *  2. **The MODE is not pushed.** The site's light/dark is a per-device viewing
 *     preference (and "system" means "match the site's toggle"), while the addon's mode
 *     is its own setting with its own "follow Windows" default. The scheme is the
 *     *identity* both surfaces share; the mode is how each one is being looked at.
 *
 *  3. **Failure is silent and non-blocking.** The addon is optional and usually not
 *     running, so this returns a result object instead of throwing, and the caller
 *     does not await it. A site visitor with no addon must never see an error for it.
 *
 * ⚠️ The custom pair crosses a VOCABULARY boundary here, and this is the only place it
 * does. The site's picker labels its two colours Primary/Secondary, where "Primary" is
 * the DOMINANT hue; the addon's tokens are `accent` (dominant) and `primary` (partner).
 * So the site's `primary` becomes the addon's `accent`. Getting this backwards would
 * silently invert every custom scheme.
 */

import { CUSTOM_SCHEME, isScheme } from './scheme.js';

const HEX = /^#[0-9a-f]{6}$/i;

/** The addon's default scheme hues, used only to repair a half-written custom pair so a
 *  custom scheme never lands as an empty object. Mirrors the seed in the addon's own
 *  `renderer/appearance/appearance.js`. */
const DEFAULT_SCHEME_SEED = { accent: '#06b6d4', primary: '#3b82f6' };

/**
 * Map the site's appearance onto the addon's stored keys.
 * Returns `null` for a scheme the addon has no rule for — the caller then does nothing,
 * because sending an unknown id would only make the addon fall back to its default.
 */
export function toAddonAppearance(appearance) {
  const scheme = appearance && appearance.scheme;
  if (!isScheme(scheme)) return null;

  const stored = { colorScheme: scheme };
  if (scheme !== CUSTOM_SCHEME) return stored;

  // Site vocabulary → addon vocabulary (see the note above).
  const pair = (appearance && appearance.custom) || {};
  const accent = HEX.test(pair.primary) ? pair.primary.toLowerCase() : DEFAULT_SCHEME_SEED.accent;
  const primary = HEX.test(pair.secondary) ? pair.secondary.toLowerCase() : DEFAULT_SCHEME_SEED.primary;
  stored.customColors = { accent, primary };
  return stored;
}

/**
 * Send an appearance to the addon, read-modify-write.
 *
 * `PUT /api/settings` REPLACES the addon's whole `webapp` block, so the current
 * settings are read first and the three appearance keys merged onto them — posting only
 * the appearance would wipe the user's chat settings, models and agents.
 *
 * `deps.getAddonApi` is injectable so the test never touches a real addon.
 */
export async function pushSchemeToAddon(appearance, deps = {}) {
  const payload = toAddonAppearance(appearance);
  if (!payload) return { ok: false, reason: 'unknown-scheme' };

  const loadApi = deps.getAddonApi || (() => import('../services/simpleAddonApi.js'));
  try {
    const api = await loadApi();
    if (!api || typeof api.getAddonSettings !== 'function' || typeof api.saveAddonSettings !== 'function') {
      return { ok: false, reason: 'no-api' };
    }
    const current = await api.getAddonSettings();
    // A refusal to parse, or no addon at all, both land here.
    if (!current || typeof current !== 'object') return { ok: false, reason: 'addon-offline' };
    await api.saveAddonSettings({ ...current, ...payload });
    return { ok: true, sent: payload };
  } catch {
    // The addon is optional: "not running" and "refused" are the same non-event here.
    return { ok: false, reason: 'addon-offline' };
  }
}

/**
 * Fire-and-forget wrapper for a UI handler. Deliberately not awaited — a picker must
 * never wait on a local process that may not be there.
 */
export function syncSchemeToAddon(appearance, deps) {
  pushSchemeToAddon(appearance, deps).catch(() => {});
}
