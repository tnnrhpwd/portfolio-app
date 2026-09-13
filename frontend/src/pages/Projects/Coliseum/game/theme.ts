/**
 * Theme palette for the Coliseum game (dark + light modes).
 *
 * Scenes and shared UI helpers read colors from here instead of hardcoding
 * hex values, so a single resolved palette drives every screen. The `system`
 * mode follows the site's light/dark theme (the `light-theme` / `dark-theme`
 * class on `document.body`, set by the existing site header).
 */

import { getSettings, type ThemeMode } from './settings';

export interface ThemeColors {
  isLight: boolean;
  /** Default scene background. */
  bg: string;
  /** Battle-scene background (slightly different). */
  bgAlt: string;
  /** Default body text. */
  text: string;
  /** Section headings / accent gold. */
  heading: string;
  /** Bright gold labels. */
  goldText: string;
  /** Secondary / muted text. */
  muted: string;
  /** Faint helper text. */
  dim: string;
  /** Destructive / destroyed-zone red. */
  danger: string;
  /** Disabled or un-done text. */
  disabled: string;
  /** Confirm-modal panel fill (Phaser number). */
  panel: number;
  /** Confirm-modal panel stroke (Phaser number). */
  panelStroke: number;
  /** Keyboard focus-ring stroke (Phaser number). */
  focusStroke: number;
}

const DARK: ThemeColors = {
  isLight: false,
  bg: '#120e0a',
  bgAlt: '#1a1410',
  text: '#e8dcc8',
  heading: '#e8b84b',
  goldText: '#f2d98c',
  muted: '#b8aa94',
  dim: '#6a6258',
  danger: '#c0392b',
  disabled: '#55504a',
  panel: 0x1c1610,
  panelStroke: 0xe8b84b,
  focusStroke: 0xffffff,
};

const LIGHT: ThemeColors = {
  isLight: true,
  bg: '#f4ecdc',
  bgAlt: '#e9ddc6',
  text: '#3a2f24',
  heading: '#8a6d1a',
  goldText: '#7a5f16',
  muted: '#6b5d4a',
  dim: '#9a8d79',
  danger: '#a93226',
  disabled: '#b3a894',
  panel: 0xf0e7d2,
  panelStroke: 0xa8841f,
  focusStroke: 0x222222,
};

/** Resolve a mode ('system' consults the site theme, then the OS preference). */
export function resolveTheme(mode: ThemeMode): 'dark' | 'light' {
  if (mode === 'dark' || mode === 'light') return mode;
  if (typeof document !== 'undefined') {
    if (document.body?.classList.contains('light-theme')) return 'light';
    if (document.body?.classList.contains('dark-theme')) return 'dark';
    try {
      const stored = window.localStorage.getItem('theme');
      if (stored === 'light-theme') return 'light';
      if (stored === 'dark-theme') return 'dark';
    } catch {
      // Storage unavailable — fall through to the OS preference.
    }
  }
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}

/** The resolved palette for the current game setting + site/OS theme. */
export function getThemeColors(): ThemeColors {
  return resolveTheme(getSettings().theme) === 'light' ? LIGHT : DARK;
}

/* ────────────────────────────── design boxes ────────────────────────────── */

/**
 * Two FIXED design boxes — landscape and portrait — instead of one flexible
 * canvas.
 *
 * The game picks ONE of these at boot from the device orientation and every
 * scene lays itself out for that box once, in `create()`. Nothing reflows after
 * that: Phaser's FIT mode scales the whole box to the screen and the page paints
 * the letterbox bars.
 *
 * This replaces the earlier `Scale.RESIZE` model, which made the canvas *be* the
 * viewport and therefore needed a resize path in every scene — and each of those
 * paths is a bug you only ever see on a device you don't own. RESIZE also
 * silently changes the game: how much room there is to manoeuvre is a difficulty
 * knob, so a wider window quietly made battles easier.
 *
 * Rotating the device destroys and recreates the game (the React shell owns
 * that), so the choice is made exactly once per game instance and no scene ever
 * has to rebuild itself in place.
 */
export type LayoutMode = 'landscape' | 'portrait';

export const LANDSCAPE = { width: 1280, height: 720 } as const;
export const PORTRAIT = { width: 720, height: 1280 } as const;

/**
 * The active design box. These are live bindings: `setLayoutMode` reassigns
 * them and every importer sees the new value. Read them at call time — never
 * copy them into a module-level constant, which would freeze the boot-time box.
 */
export let VIEW_WIDTH: number = LANDSCAPE.width;
export let VIEW_HEIGHT: number = LANDSCAPE.height;

let mode: LayoutMode = 'landscape';

export function layoutMode(): LayoutMode {
  return mode;
}

export function isPortrait(): boolean {
  return mode === 'portrait';
}

/** Choose the design box. MUST run before the Phaser game is constructed. */
export function setLayoutMode(next: LayoutMode): void {
  mode = next;
  const box = next === 'portrait' ? PORTRAIT : LANDSCAPE;
  VIEW_WIDTH = box.width;
  VIEW_HEIGHT = box.height;
}

/**
 * Portrait when the viewport is taller than it is wide.
 *
 * `Coliseum.css` switches the frame's aspect ratio on the same media query, so
 * the shape the page paints and the box the canvas draws can never disagree.
 */
export function detectLayoutMode(): LayoutMode {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'landscape';
  return window.matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape';
}
