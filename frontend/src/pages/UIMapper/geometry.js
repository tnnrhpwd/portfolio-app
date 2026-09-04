/**
 * geometry.js — pure geometry helpers for the UI Mapper box editor.
 * Kept in a separate module so the resize math is unit-testable.
 */

export const MIN_SIZE = 4;

// Resize handle identifiers (8 directions: corners + edges).
export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/**
 * Apply a resize delta to an original rect for a given handle. The edge(s)
 * opposite the handle stay anchored so resizing feels natural.
 *
 * @param {{x:number,y:number,w:number,h:number}} orig
 * @param {string} handle - one of HANDLES ('nw','n','ne','e','se','s','sw','w')
 * @param {number} dx - pointer delta in x (image px)
 * @param {number} dy - pointer delta in y (image px)
 * @returns {{x:number,y:number,w:number,h:number}}
 */
export function applyResize(orig, handle, dx, dy) {
  let { x, y, w, h } = orig;
  if (handle.includes('e')) w += dx;
  if (handle.includes('s')) h += dy;
  if (handle.includes('w')) { x += dx; w -= dx; }
  if (handle.includes('n')) { y += dy; h -= dy; }

  if (w < MIN_SIZE) {
    if (handle.includes('w')) x = orig.x + orig.w - MIN_SIZE;
    w = MIN_SIZE;
  }
  if (h < MIN_SIZE) {
    if (handle.includes('n')) y = orig.y + orig.h - MIN_SIZE;
    h = MIN_SIZE;
  }
  return { x, y, w, h };
}
