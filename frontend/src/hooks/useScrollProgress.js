import { useCallback, useEffect, useState } from 'react';
import { prefersReducedMotion, subscribeToScroll } from './scrollEngine';

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Writes a scroll-linked value into a CSS custom property on the element the
 * returned ref is attached to, every frame, without re-rendering React.
 *
 * The property inherits, so descendants can read it — that is how the whole
 * effect is expressed: JS measures, CSS animates.
 *
 * @param {object}   [options]
 * @param {string}   [options.property='--sp'] custom property to write.
 * @param {string}   [options.mode='travel']
 *   `'travel'` — 0 as the element's top edge crosses the bottom of the viewport,
 *                1 as its bottom edge crosses the top. Works for any height.
 *   `'top'`    — 0 while the element's top edge sits at the viewport top, 1 once
 *                the element has scrolled its own height past it. Use for the
 *                hero and other bands that start at the top of the document,
 *                where `'travel'` would already be at ~0.5 on load.
 *   `'page'`   — 0 at the document top, 1 at the document bottom.
 * @param {number}   [options.start=0] input value that maps to 0.
 * @param {number}   [options.end=1] input value that maps to 1.
 * @returns {(el: HTMLElement|null) => void} ref callback
 */
export default function useScrollProgress({
  property = '--sp',
  mode = 'travel',
  start = 0,
  end = 1,
} = {}) {
  const [node, setNode] = useState(null);
  const setRef = useCallback((el) => setNode(el), []);

  useEffect(() => {
    if (!node) return undefined;
    // Refused, not merely shortened: the CSS fallback for every property this
    // hook writes is the finished state.
    if (prefersReducedMotion()) return undefined;

    const span = end - start || 1;

    const read = (state) => {
      if (mode === 'page') return 0; // nothing to measure; the document is the input
      const rect = node.getBoundingClientRect();
      if (mode === 'top') return -rect.top / (rect.height || state.vh || 1);
      const height = rect.height;
      const travel = state.vh + height;
      return travel > 0 ? (state.vh - rect.top) / travel : 0;
    };

    const write = (raw, state) => {
      let input;
      if (mode === 'page') {
        const max = state.docHeight - state.vh;
        input = max > 0 ? state.y / max : 0;
      } else {
        input = typeof raw === 'number' ? raw : 0;
      }
      node.style.setProperty(property, clamp01((input - start) / span).toFixed(3));
    };

    return subscribeToScroll(read, write);
  }, [node, property, mode, start, end]);

  return setRef;
}
