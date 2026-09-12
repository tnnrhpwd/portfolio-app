/**
 * Rocket — in-canvas palette & type.
 *
 * The canvas is deliberately always "deep space" (dark) regardless of the
 * site's light/dark theme: a shooter is read against darkness, and flipping the
 * arena to a light background mid-run changes how every sprite reads. The page
 * *around* the canvas still follows the site theme (see `Rocket.css`), so the
 * game sits inside the site rather than fighting it.
 */

export const PALETTE = {
  /** Canvas backdrop, and the letterbox bars around it. */
  bg: 0x05070f,
  /** Panel/button fills. */
  panel: 0x121b2e,
  panelHover: 0x1b2842,
  panelEdge: 0x2c3f63,
  /** Accents: cyan reads as "yours", magenta as "theirs". */
  accent: 0x4cc9f0,
  accentSoft: 0x9ae6ff,
  enemy: 0xf72585,
  gold: 0xffd166,
  hull: 0xef476f,
  shield: 0x4cc9f0,
  good: 0x06d6a0,
  danger: 0xef476f,
} as const;

export const TEXT = {
  primary: '#e8f0ff',
  muted: '#8ea3c8',
  dim: '#5b6d90',
  gold: '#ffd166',
  accent: '#4cc9f0',
  danger: '#ff6b8a',
  good: '#06d6a0',
} as const;

/** Arcade-ish: a monospace face keeps the HUD numbers from jittering. */
export const FONT = '"Consolas", "Courier New", monospace';

export const FONT_UI = 'Arial, sans-serif';

/**
 * Two fixed design boxes — landscape and portrait — not one flexible canvas.
 *
 * The game picks ONE of these at boot from the device orientation and every
 * scene lays itself out for that box once, in `create()`. Nothing reflows after
 * that: Phaser's FIT mode scales the whole box to the screen and the page paints
 * the bars. This is the deliberate lesson from Coliseum, which used RESIZE and
 * therefore needed a resize path in every scene — and each of those paths is a
 * bug you only ever see on a device you don't own.
 *
 * Rotating the device destroys and recreates the game (the React shell owns
 * that), so the choice is made exactly once per game instance and no scene ever
 * has to rebuild itself in place.
 *
 * A shooter reads naturally tall as well as wide, and the simulation scales with
 * the box: enemy speeds are fractions of the world height and spawn lanes are
 * fractions of the width, so the two boxes are equally fair.
 */
export type LayoutMode = 'landscape' | 'portrait';

export const LANDSCAPE = { width: 1280, height: 720 } as const;
export const PORTRAIT = { width: 720, height: 1280 } as const;

/**
 * The active design box. These are live bindings: `setLayoutMode` reassigns
 * them, and every importer sees the new value. Read them, don't copy them into
 * module-level constants at import time.
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
 * `Rocket.css` switches the frame's aspect ratio on the same media query, so the
 * shape the page paints and the box the canvas draws can never disagree.
 */
export function detectLayoutMode(): LayoutMode {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'landscape';
  return window.matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape';
}

