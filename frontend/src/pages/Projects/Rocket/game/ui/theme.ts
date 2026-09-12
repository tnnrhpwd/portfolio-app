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

/** Design resolution. Phaser's FIT mode keeps the world at exactly this size. */
export const VIEW_WIDTH = 1280;
export const VIEW_HEIGHT = 720;
