/**
 * The two-layout switch, and the promise that goes with it: a run started in one
 * design box survives being recreated in the other.
 *
 * The live bindings matter here. `VIEW_WIDTH`/`VIEW_HEIGHT` are reassigned by
 * `setLayoutMode`, so a module that copies them into a constant at import time
 * would lay out for the wrong box — the tests below read them through the import
 * for exactly that reason.
 */

import {
  LANDSCAPE,
  PORTRAIT,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  detectLayoutMode,
  isPortrait,
  setLayoutMode,
} from './ui/theme';
import { currentWorld, finishRun, fitRunToView, startRun } from './session';

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

describe('a run across a layout change', () => {
  it('is built in the active design box', () => {
    setLayoutMode('portrait');
    const world = startRun(7);
    expect([world.width, world.height]).toEqual([PORTRAIT.width, PORTRAIT.height]);

    setLayoutMode('landscape');
    const wide = startRun(7);
    expect([wide.width, wide.height]).toEqual([LANDSCAPE.width, LANDSCAPE.height]);
  });

  it('is reshaped into the new box, keeping its progress', () => {
    setLayoutMode('portrait');
    const world = startRun(99);
    world.score = 1234;
    world.player.hull = 2;

    setLayoutMode('landscape');
    expect(fitRunToView()).toBe(world);
    expect([world.width, world.height]).toEqual([LANDSCAPE.width, LANDSCAPE.height]);
    // Same run: reshaping an arena is not a new attempt.
    expect(world.score).toBe(1234);
    expect(world.player.hull).toBe(2);
    expect(currentWorld()).toBe(world);
  });

  it('leaves an already-fitting run alone', () => {
    setLayoutMode('landscape');
    const world = startRun(1);
    const snapshot = world.player.x;
    expect(fitRunToView()).toBe(world);
    expect(world.player.x).toBe(snapshot);
  });

  it('refuses to resurrect a run the player finished', () => {
    // Quitting to the menu or ending a run from the shop records it and ends the
    // world; rotating the device must not drop the player back into it.
    setLayoutMode('portrait');
    startRun(3);
    finishRun();

    setLayoutMode('landscape');
    expect(fitRunToView()).toBeNull();
    // And the next run is a genuinely new one.
    expect(startRun(4).score).toBe(0);
  });
});
