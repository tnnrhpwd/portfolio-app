/**
 * @jest-environment jsdom
 */

/**
 * The two-design-box switch — and the tripwire that keeps it that way.
 *
 * Coliseum used to run Phaser in `Scale.RESIZE`, which made the canvas *be* the
 * viewport and therefore required a resize path in every scene. Each of those
 * paths was a bug you only ever saw on a device you don't own, and RESIZE also
 * quietly changed the game (how much room there is to manoeuvre is a difficulty
 * knob, so a wider window made battles easier).
 *
 * The first block covers the live bindings. The second block fails if the
 * dynamic model is reintroduced, because that regression is the whole reason
 * this rewrite exists.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  LANDSCAPE,
  PORTRAIT,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  detectLayoutMode,
  isPortrait,
  setLayoutMode,
} from './theme';

const withMatchMedia = (matches: boolean, run: () => void): void => {
  const original = window.matchMedia;
  (window as unknown as Record<string, unknown>).matchMedia = (query: string) => ({
    matches: query.includes('portrait') ? matches : !matches,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
  try {
    run();
  } finally {
    (window as unknown as Record<string, unknown>).matchMedia = original;
  }
};

afterEach(() => setLayoutMode('landscape'));

describe('layout selection', () => {
  it('swaps the design box and tells importers about it', () => {
    setLayoutMode('portrait');
    expect(isPortrait()).toBe(true);
    expect([VIEW_WIDTH, VIEW_HEIGHT]).toEqual([PORTRAIT.width, PORTRAIT.height]);

    setLayoutMode('landscape');
    expect(isPortrait()).toBe(false);
    expect([VIEW_WIDTH, VIEW_HEIGHT]).toEqual([LANDSCAPE.width, LANDSCAPE.height]);
  });

  it('picks portrait for a tall viewport and landscape for a wide one', () => {
    withMatchMedia(true, () => expect(detectLayoutMode()).toBe('portrait'));
    withMatchMedia(false, () => expect(detectLayoutMode()).toBe('landscape'));
  });

  it('falls back to landscape where matchMedia does not exist', () => {
    const original = window.matchMedia;
    delete (window as unknown as Record<string, unknown>).matchMedia;
    try {
      expect(detectLayoutMode()).toBe('landscape');
    } finally {
      (window as unknown as Record<string, unknown>).matchMedia = original;
    }
  });
});

describe('the fixed-box contract', () => {
  const gameDir = __dirname;
  const sceneDir = join(gameDir, 'scenes');

  const read = (file: string): string => readFileSync(file, 'utf8');

  it('keeps Phaser in FIT mode, never RESIZE', () => {
    const config = read(join(gameDir, 'config.ts'));
    expect(config).toContain('Phaser.Scale.FIT');
    expect(config).not.toContain('Phaser.Scale.RESIZE');
  });

  it('leaves no per-scene resize path behind', () => {
    // If any of these come back, the game is dynamic again — and with it comes a
    // class of bug that only shows up on hardware we do not test on.
    const files = readdirSync(sceneDir).filter((name) => name.endsWith('.ts'));
    // Guard the guard: a scan that finds no files would "pass" while proving
    // nothing, which is exactly how a tripwire rots.
    expect(files.length).toBeGreaterThan(10);

    const offenders: string[] = [];
    for (const file of files) {
      const src = read(join(sceneDir, file));
      if (/\bonResize\b/.test(src)) offenders.push(`${file} still declares onResize`);
      if (/Scale\.Events\.RESIZE/.test(src)) offenders.push(`${file} still listens for RESIZE`);
      if (/\bthis\.compact\b/.test(src)) offenders.push(`${file} still branches on this.compact`);
      if (/uiScale/.test(src)) offenders.push(`${file} still scales by canvas size`);
      if (/\bthis\.scale\.(width|height)\b/.test(src)) {
        offenders.push(`${file} reads the live canvas size instead of the design box`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('picks the box in main.ts before Phaser is constructed', () => {
    const src = read(join(gameDir, 'main.ts'));
    const pick = src.indexOf('setLayoutMode(detectLayoutMode())');
    const construct = src.indexOf('new Phaser.Game');
    expect(pick).toBeGreaterThan(-1);
    expect(construct).toBeGreaterThan(-1);
    // Order matters: scenes read the box while laying out during boot.
    expect(pick).toBeLessThan(construct);
  });
});
