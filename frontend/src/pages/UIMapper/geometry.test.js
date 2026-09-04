/**
 * geometry.test.js — unit tests for the UI Mapper resize math.
 */

import { applyResize, MIN_SIZE, HANDLES } from './geometry';

describe('geometry — applyResize', () => {
  const rect = { x: 100, y: 100, w: 200, h: 100 };

  it('grows from the bottom-right (se) corner', () => {
    expect(applyResize(rect, 'se', 50, 30)).toEqual({ x: 100, y: 100, w: 250, h: 130 });
  });

  it('moves the top-left (nw) corner', () => {
    expect(applyResize(rect, 'nw', -40, -20)).toEqual({ x: 60, y: 80, w: 240, h: 120 });
  });

  it('resizes a single edge (right)', () => {
    expect(applyResize(rect, 'e', 25, 0)).toEqual({ x: 100, y: 100, w: 225, h: 100 });
  });

  it('enforces a minimum size without moving the anchored corner', () => {
    const shrunk = applyResize(rect, 'se', -500, -500);
    expect(shrunk.w).toBe(MIN_SIZE);
    expect(shrunk.h).toBe(MIN_SIZE);
    expect(shrunk.x).toBe(100);
    expect(shrunk.y).toBe(100);
  });

  it('keeps the right edge anchored when dragging the left edge past it', () => {
    const result = applyResize(rect, 'w', 500, 0);
    expect(result.w).toBe(MIN_SIZE);
    expect(result.x).toBe(100 + 200 - MIN_SIZE);
  });

  it('exposes all 8 handle directions', () => {
    expect(HANDLES).toHaveLength(8);
  });
});
