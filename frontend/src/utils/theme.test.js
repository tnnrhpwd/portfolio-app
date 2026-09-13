/**
 * `utils/theme.js` — the PREFERENCE / RESULT split.
 *
 * Three preferences, two classes: `light-theme` and `dark-theme` go on <body>,
 * while `system` is a preference that is not a class at all and resolves against
 * the OS at paint time.
 *
 * These tests exist because that split was once lost. `setSystemColorMode()` used
 * to resolve the OS and then call `setDarkMode()`/`setLightMode()`, which PERSIST —
 * so "System" was stored as a concrete light/dark. That broke two things at once:
 * a first visit snapshotted the OS and never followed it again, and no preference
 * control could ever display "System", because storage never held it. Both are
 * pinned below.
 *
 * jsdom does not evaluate media queries — `window.matchMedia` always reports
 * `matches: false` and never fires — so the OS is mocked. That is the point:
 * these tests are about WHEN the OS is consulted, not about media queries.
 */
import {
  setDarkMode,
  setLightMode,
  setSystemColorMode,
  initTheme,
  getThemePreference,
  watchSystemTheme,
} from './theme.js';

const STORAGE_KEY = 'theme';

/** A controllable stand-in for `(prefers-color-scheme: dark)`. */
function mockMatchMedia(initiallyDark) {
  const listeners = [];
  const query = {
    matches: initiallyDark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_event, handler) => listeners.push(handler),
    removeEventListener: (_event, handler) => {
      const i = listeners.indexOf(handler);
      if (i !== -1) listeners.splice(i, 1);
    },
  };
  window.matchMedia = jest.fn(() => query);
  return {
    /** Flip the OS and notify, the way a real MediaQueryList does. */
    setDark(dark) {
      query.matches = dark;
      [...listeners].forEach((handler) => handler({ matches: dark }));
    },
    listenerCount: () => listeners.length,
    query,
  };
}

const bodyClass = () =>
  document.body.classList.contains('dark-theme')
    ? 'dark-theme'
    : document.body.classList.contains('light-theme')
      ? 'light-theme'
      : null;

beforeEach(() => {
  localStorage.clear();
  document.body.className = '';
  mockMatchMedia(false);
});

describe('a first visit', () => {
  it('follows the OS preference', () => {
    mockMatchMedia(false);
    expect(initTheme().applied).toBe('light-theme');

    document.body.className = '';
    mockMatchMedia(true);
    expect(initTheme().applied).toBe('dark-theme');
  });

  it('pins NOTHING — so a later OS change is still followed', () => {
    initTheme();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('reports the preference as `system`, not as the resolved mode', () => {
    initTheme();
    expect(getThemePreference()).toBe('system');
  });
});

describe('choosing a mode', () => {
  it('stores the CLASS for an explicit light or dark', () => {
    expect(setLightMode()).toBe('light-theme');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('light-theme');

    expect(setDarkMode()).toBe('dark-theme');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark-theme');
  });

  it('stores the PREFERENCE for system, never the resolved class', () => {
    mockMatchMedia(true);
    expect(setSystemColorMode()).toBe('dark-theme');
    // The load-bearing assertion: the result is painted, the CHOICE is stored.
    expect(localStorage.getItem(STORAGE_KEY)).toBe('system');
    expect(bodyClass()).toBe('dark-theme');
  });

  it('replaces the old class rather than stacking one on the other', () => {
    setLightMode();
    setDarkMode();
    expect(bodyClass()).toBe('dark-theme');
    expect(document.body.classList.contains('light-theme')).toBe(false);
  });
});

describe('getThemePreference', () => {
  it('reports the choice, not the outcome, while on system', () => {
    mockMatchMedia(true);
    setSystemColorMode();
    // The body IS dark — but that is the answer, not the choice.
    expect(bodyClass()).toBe('dark-theme');
    expect(getThemePreference()).toBe('system');
  });

  it('falls back to `system` for storage a visitor has edited', () => {
    localStorage.setItem(STORAGE_KEY, 'chartreuse');
    expect(getThemePreference()).toBe('system');
    expect(initTheme().applied).toBe('light-theme');
  });
});

describe('initTheme', () => {
  it('does not re-persist what it read', () => {
    localStorage.setItem(STORAGE_KEY, 'system');
    initTheme();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('system');

    localStorage.removeItem(STORAGE_KEY);
    initTheme();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('reports both the preference and the resolved mode', () => {
    mockMatchMedia(true);
    localStorage.setItem(STORAGE_KEY, 'system');
    expect(initTheme()).toEqual({ preference: 'system', applied: 'dark-theme' });
  });
});

describe('watchSystemTheme', () => {
  it('repaints when the OS changes while on system', () => {
    // Capture the handle: replacing `window.matchMedia` would leave the watcher
    // listening to an orphaned query, and the test would pass for the wrong reason.
    const os = mockMatchMedia(false);
    setSystemColorMode(); // stores `system`, OS is light
    const seen = [];
    const unwatch = watchSystemTheme((mode) => seen.push(mode));

    expect(bodyClass()).toBe('light-theme');
    os.setDark(true);

    expect(bodyClass()).toBe('dark-theme');
    expect(seen).toEqual(['dark-theme']);

    unwatch();
  });

  it('does NOT repaint once an explicit mode is chosen', () => {
    const os = mockMatchMedia(false);
    setSystemColorMode();
    const seen = [];
    watchSystemTheme((mode) => seen.push(mode));

    setLightMode(); // an explicit decision
    os.setDark(true);

    expect(bodyClass()).toBe('light-theme');
    expect(seen).toEqual([]);
  });

  it('unsubscribes cleanly', () => {
    const os = mockMatchMedia(false);
    setSystemColorMode();
    const unwatch = watchSystemTheme(() => {});
    expect(os.listenerCount()).toBe(1);

    unwatch();
    expect(os.listenerCount()).toBe(0);
  });
});
