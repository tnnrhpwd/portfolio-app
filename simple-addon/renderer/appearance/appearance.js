/**
 * Appearance — the addon's colour scheme, and the mode it sits on.
 *
 * This is the addon's half of the site-wide scheme system
 * (`frontend/src/utils/scheme.js` + the derivation in `frontend/src/index.css`).
 * Two axes, deliberately independent, exactly as they are on the website:
 *
 *   SCHEME  WHICH hue plays which role — the identity pair. `data-scheme`.
 *   MODE    how light the surface under those hues is. `data-mode`.
 *
 * ⚠️ WHY THERE ARE TWO FILES AND NOT ONE. `scheme.js` cannot be shared with the
 * addon: it is an ES module that reads `localStorage`, and the addon's windows are
 * `file://` pages that load classic scripts (Chromium refuses module scripts from
 * `file://`). More importantly the two need different TOKENS — the site derives
 * `--bg-page` / `--bg-1` / `--text-color`, while the addon's pages are written
 * against `--bg` / `--panel` / `--text`. So the SCHEME LIST is mirrored here rather
 * than imported, and `appearance.test.js` asserts the two lists still agree:
 * a scheme added on one side and not the other fails the addon's test run instead
 * of quietly making the same name mean two different colours.
 *
 * ⚠️ THE HUES BELOW ARE A MIRROR OF `frontend/src/utils/scheme.js` — same ids, same
 * labels, same two hexes each. Change one, change the other (the test will tell you).
 *
 * Where a value is STORED, and why: in the addon's own `settings.json`, under the
 * `webapp` block that `GET/PUT /api/settings` already owns —
 *
 *   colorScheme   'ocean' | 'aurora' | … | 'custom'
 *   colorMode     'system' | 'light' | 'dark'
 *   customColors  { accent, primary }  — only meaningful when colorScheme is 'custom'
 *
 * That is the same block the site's chat panel already reads and writes its `theme`
 * from, so the two surfaces have ONE value to agree on rather than two. The website
 * pushes its pick here when the scheme changes (`frontend/src/utils/schemeSync.js`);
 * this module reads it, and the dashboard's Settings tab writes it.
 *
 * Exposed as `window.SimpleAppearance` in a renderer and as `module.exports` under
 * Node (for the test). Nothing in here touches the DOM unless you call a function
 * that takes an element, so it is safe to require headlessly.
 */

'use strict';

/** The identity hues, `accent` first because that is the DOMINANT one: it paints
 *  links, focus rings and the active state. `primary` is its partner — the second
 *  hue in a fill, an emphasis figure. Roles, not positions, and NOT the same words
 *  the Custom picker uses (see `customColors` below).
 *
 *  `ocean` leads because it is the default: the first thing the picker offers is
 *  what a fresh install is already looking at. */
const SCHEMES = [
  { id: 'ocean', label: '🌊 Ocean', accent: '#06b6d4', primary: '#3b82f6' },
  { id: 'aurora', label: 'Aurora', accent: '#00c1c1', primary: '#ff379b' },
  { id: 'crimson', label: '❤️ Crimson', accent: '#dc2626', primary: '#f472b6' },
  { id: 'emerald', label: '💎 Emerald', accent: '#10b981', primary: '#06b6d4' },
  { id: 'sakura', label: '🌸 Sakura', accent: '#ec4899', primary: '#a78bfa' },
  { id: 'midnight', label: '🌃 Midnight Blue', accent: '#3b82f6', primary: '#8b5cf6' },
  { id: 'sunset', label: '🌅 Sunset', accent: '#f97316', primary: '#ec4899' },
  { id: 'cyberpunk', label: '🔮 Cyberpunk', accent: '#f0e030', primary: '#e040fb' },
  { id: 'monokai', label: '🖥️ Monokai', accent: '#a6e22e', primary: '#66d9ef' },
  { id: 'usa', label: '🇺🇸 USA', accent: '#b22234', primary: '#3c3b6e' },
  { id: 'forest', label: '🌲 Forest', accent: '#4d8c57', primary: '#65a30d' },
  // The one scheme with no hue at all: its two roles are told apart by LIGHTNESS
  // instead, and `appearance.css` turns the shared chroma off for it (a grey handed
  // chroma is not a grey).
  { id: 'neutral', label: '⚫ Neutral', accent: '#808080', primary: '#808080' },
];

/** What a fresh install gets. Deliberately the same as the website's default, so
 *  an addon that has never been told anything already agrees with the site. */
const DEFAULT_SCHEME = 'ocean';

/** The one scheme the user BUILDS. Not in `SCHEMES` because it has no fixed hues to
 *  list — its two arrive at runtime — but a scheme in every other respect. */
const CUSTOM_SCHEME = 'custom';

const DEFAULT_MODE = 'system';
const MODES = ['system', 'light', 'dark'];

const HEX = /^#[0-9a-f]{6}$/i;

/** Is `id` one of ours? Guards every read: the stored value is a string a user can
 *  edit, and an unknown id would point `data-scheme` at a selector that does not
 *  exist — i.e. no scheme at all, silently. */
function isScheme(id) {
  return id === CUSTOM_SCHEME || SCHEMES.some((s) => s.id === id);
}

function isMode(id) {
  return MODES.includes(id);
}

/** The full record for an id, for a picker that needs the label and the swatch.
 *  Falls back to the default record, so it cannot come back half-formed. */
function schemeById(id) {
  return SCHEMES.find((s) => s.id === id) || SCHEMES.find((s) => s.id === DEFAULT_SCHEME);
}

/**
 * Validate a stored custom pair.
 *
 * ⚠️ NAMING: the stored pair is `{ accent, primary }` — the CSS token names, so the
 * two spellings cannot drift. The SITE stores the same pair under its own words
 * (`schemeCustom` = `{ primary, secondary }`, where "primary" means the dominant
 * hue). That mapping is made once, at the boundary, in
 * `frontend/src/utils/schemeSync.js`. Do not reintroduce the visitor's words here.
 *
 * Anything that is not a six-digit hex falls back to the default scheme's hues, so
 * a half-written pair paints *something* rather than nothing.
 */
function normalizeCustom(value) {
  const seed = schemeById(DEFAULT_SCHEME);
  const pair = value && typeof value === 'object' ? value : {};
  return {
    accent: HEX.test(pair.accent) ? pair.accent.toLowerCase() : seed.accent,
    primary: HEX.test(pair.primary) ? pair.primary.toLowerCase() : seed.primary,
  };
}

/**
 * Resolve stored settings into what the page actually needs.
 *
 * `mode` is returned RESOLVED — never `'system'` — because the stylesheet keys off
 * `data-mode="light|dark"`, which keeps the derivation a plain attribute selector
 * instead of a second cascade of `prefers-color-scheme` blocks. The unresolved
 * choice is still returned as `choice`, for the picker to show.
 *
 * Pure, and deliberately so: `prefersDark` is passed IN rather than read, so the
 * resolver never depends on the machine it runs on. A missing `prefersDark` is
 * treated as dark (the addon's own default) rather than as a `matchMedia` call.
 */
function resolveAppearance(settings, options = {}) {
  const raw = settings && typeof settings === 'object' ? settings : {};
  const scheme = isScheme(raw.scheme) ? raw.scheme : DEFAULT_SCHEME;
  const choice = isMode(raw.mode) ? raw.mode : DEFAULT_MODE;
  const mode = choice === 'system' ? (options.prefersDark === false ? 'light' : 'dark') : choice;
  return {
    scheme,
    mode,
    choice,
    custom: scheme === CUSTOM_SCHEME ? normalizeCustom(raw.custom) : null,
  };
}

/** Turn stored settings into the SITE's settings shape (`{scheme, mode, custom}`)
 *  from the addon's stored keys (`colorScheme`, `colorMode`, `customColors`). Kept
 *  in one place so the three renderer windows and the test agree on the mapping. */
function fromStored(stored) {
  const raw = stored && typeof stored === 'object' ? stored : {};
  return { scheme: raw.colorScheme, mode: raw.colorMode, custom: raw.customColors };
}

/** The reverse: the patch a picker writes back to `PUT /api/settings`. */
function toStored(appearance) {
  const raw = appearance && typeof appearance === 'object' ? appearance : {};
  const out = {};
  if (isScheme(raw.scheme)) out.colorScheme = raw.scheme;
  if (isMode(raw.mode)) out.colorMode = raw.mode;
  if (raw.custom) out.customColors = normalizeCustom(raw.custom);
  return out;
}

/**
 * Put a resolved appearance on an element — the ONE place that writes `data-scheme`
 * and `data-mode`.
 *
 * Custom carries its hues as INLINE custom properties, a stylesheet having no way to
 * hold a value the user has just picked. Inline is also the only place they can live
 * without out-ranking the named schemes — so they are removed the moment a named
 * scheme is applied. That is not tidiness: an inline property beats every stylesheet
 * rule, so a stale pair would silently override whatever was picked next.
 */
function applyToElement(el, settings, options = {}) {
  const resolved = resolveAppearance(settings, {
    // Only the DOM path reads the OS — `resolveAppearance` stays pure.
    prefersDark: options.prefersDark === undefined ? systemPrefersDark() : options.prefersDark,
  });
  el.setAttribute('data-scheme', resolved.scheme);
  el.setAttribute('data-mode', resolved.mode);
  if (resolved.custom) {
    el.style.setProperty('--scheme-hue-accent', resolved.custom.accent);
    el.style.setProperty('--scheme-hue-primary', resolved.custom.primary);
  } else {
    el.style.removeProperty('--scheme-hue-accent');
    el.style.removeProperty('--scheme-hue-primary');
  }
  return resolved;
}

/**
 * Read an appearance out of a query string.
 *
 * `main.js` reads `settings.json` when it opens a window and passes the appearance
 * along in the URL, which is what lets every window paint correctly on the FIRST
 * frame — before any `fetch` to the local server could come back. Without it the
 * dashboard flashes dark-then-light (or the reverse) on every open.
 */
function fromSearch(search) {
  let params;
  try {
    params = new URLSearchParams(search || '');
  } catch {
    return {};
  }
  const out = {};
  const scheme = params.get('scheme');
  if (scheme && isScheme(scheme)) out.scheme = scheme;
  const mode = params.get('mode');
  if (mode && isMode(mode)) out.mode = mode;
  const accent = params.get('accent');
  const primary = params.get('primary');
  if (accent || primary) out.custom = { accent, primary };
  return out;
}

/** Apply the appearance carried in `location.search`. Called from a `<script>` in
 *  `<head>` so nothing is painted in the wrong colours first. Returns the resolved
 *  appearance, or null when there is no document (i.e. under Node). */
function bootstrap(options = {}) {
  if (typeof document === 'undefined' && !options.element) return null;
  const el = options.element || document.documentElement;
  const search = options.search !== undefined
    ? options.search
    : (typeof location !== 'undefined' ? location.search : '');
  return applyToElement(el, fromSearch(search), options);
}

/** Does the OS say dark? Defaults to dark when there is no `matchMedia` — the
 *  addon has always been a dark app, and `system` should not turn it white on a
 *  platform that cannot answer. */
function systemPrefersDark() {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return true;
  }
}

/** Re-resolve when the OS flips while a window is open. Returns an unsubscribe. */
function watchSystemMode(callback) {
  try {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => callback(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  } catch {
    return () => {};
  }
}

/**
 * The pair Custom starts from when the user switches TO it with nothing stored yet:
 * the identity hues of the scheme being replaced.
 *
 * ⚠️ Seeding from the CURRENT scheme rather than from the default is the difference
 * between "Custom is a starting point" and "everything jumps to cyan the moment you
 * pick it". The site seeds it the same way (`setScheme` seeds `schemeCustom` from
 * `schemeById(document.body.dataset.scheme)`), so the two surfaces behave alike.
 */
function seedCustomFrom(schemeId) {
  const scheme = schemeById(schemeId);
  return { accent: scheme.accent, primary: scheme.primary };
}

const API = {
  SCHEMES,
  MODES,
  DEFAULT_SCHEME,
  DEFAULT_MODE,
  CUSTOM_SCHEME,
  isScheme,
  isMode,
  schemeById,
  normalizeCustom,
  seedCustomFrom,
  resolveAppearance,
  fromStored,
  toStored,
  applyToElement,
  fromSearch,
  bootstrap,
  systemPrefersDark,
  watchSystemMode,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = API;
} else if (typeof window !== 'undefined') {
  window.SimpleAppearance = API;
}
