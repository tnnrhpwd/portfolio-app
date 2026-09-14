/* ── Colour mode ───────────────────────────────────────────────────────────
 * THREE preferences, TWO classes. `light-theme` / `dark-theme` go on <body>;
 * `system` is the third PREFERENCE and it is not a class at all — it resolves to
 * one of the other two against the OS, at paint time.
 *
 * ⚠️ That distinction used to be lost, and it caused two bugs. The old
 * `setSystemColorMode()` resolved the OS preference and then called
 * `setDarkMode()` / `setLightMode()` — which PERSIST. So "System" was written to
 * storage as a concrete light/dark, which meant (a) a first visit snapshotted the
 * OS and never followed a later change, and (b) the preference controls could
 * never display "System" at all, because storage never held it.
 *
 * Store the PREFERENCE; resolve the RESULT. Never persist a resolved value.
 */
const THEME_KEY = 'theme';
const LIGHT = 'light-theme';
const DARK = 'dark-theme';
/** The preference meaning "ask the OS". Never a class. */
const SYSTEM = 'system';

function prefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Put a mode on <body>, clearing whichever one was there. Returns it. */
function paint(mode) {
  document.body.classList.remove(LIGHT, DARK);
  document.body.classList.add(mode);
  return mode;
}

/** What `stored` means right now. Anything unrecognised — including storage a
 *  visitor has edited — falls back to the OS rather than to no class at all. */
function resolve(stored) {
  if (stored === LIGHT) return LIGHT;
  if (stored === DARK) return DARK;
  return prefersDark() ? DARK : LIGHT;
}

/** The stored PREFERENCE — 'light' | 'dark' | 'system' — for a control that has
 *  to show the CHOICE rather than the outcome. Paints nothing. */
function getThemePreference() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === LIGHT) return 'light';
  if (stored === DARK) return 'dark';
  return SYSTEM;
}

function setDarkMode() {
  localStorage.setItem(THEME_KEY, DARK);
  return paint(DARK);
}

function setLightMode() {
  localStorage.setItem(THEME_KEY, LIGHT);
  return paint(LIGHT);
}

/** Follow the OS — and go on following it. */
function setSystemColorMode() {
  localStorage.setItem(THEME_KEY, SYSTEM);
  return paint(resolve(SYSTEM));
}

/** Paint whatever was chosen last, without re-persisting it: reading is not
 *  choosing. A first visit has nothing stored, which resolves to the OS. */
function initTheme() {
  return { preference: getThemePreference(), applied: paint(resolve(localStorage.getItem(THEME_KEY))) };
}

/** Follow the OS live, but only while `system` is the preference — an explicit
 *  light or dark is a decision, and the OS changing must not overrule it.
 *  Returns an unsubscribe function. */
function watchSystemTheme(onChange) {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => {
    if (getThemePreference() === SYSTEM) onChange(paint(resolve(SYSTEM)));
  };
  // `addEventListener` is the modern form; jsdom and older Safari only have the
  // deprecated `addListener`.
  if (query.addEventListener) {
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }
  query.addListener(handler);
  return () => query.removeListener(handler);
}

/* ── Font Size Scale ── */
const FONT_SCALE_KEY = 'fontSizeScale';
const FONT_SCALE_MIN = 0.8;
const FONT_SCALE_MAX = 1.4;
const FONT_SCALE_DEFAULT = 1;

function setFontSizeScale(scale) {
  const clamped = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, Number(scale) || FONT_SCALE_DEFAULT));
  document.documentElement.style.setProperty('--font-size-scale', clamped);
  localStorage.setItem(FONT_SCALE_KEY, clamped);
  return clamped;
}

function loadFontSizeScale() {
  const stored = localStorage.getItem(FONT_SCALE_KEY);
  const scale = stored !== null ? parseFloat(stored) : FONT_SCALE_DEFAULT;
  return setFontSizeScale(scale);
}

export {
  setDarkMode,
  setLightMode,
  setSystemColorMode,
  initTheme,
  getThemePreference,
  watchSystemTheme,
  setFontSizeScale,
  loadFontSizeScale,
  FONT_SCALE_MIN,
  FONT_SCALE_MAX,
  FONT_SCALE_DEFAULT,
};
