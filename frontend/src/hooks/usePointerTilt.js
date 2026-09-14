import { useCallback, useEffect, useState } from 'react';
import { hasFinePointer, prefersReducedMotion } from './scrollEngine';

/**
 * Tilts an element toward the pointer and writes the angles into
 * `--tilt-x` / `--tilt-y` (degrees) for the CSS to compose into a transform.
 *
 * Listens on the element itself rather than the window, so a page full of these
 * costs nothing until one is actually hovered. Refused outright on touch devices
 * and under reduced motion — it then leaves the properties unset and the CSS
 * falls back to `0deg`, which is a flat card.
 *
 * @param {object} [options]
 * @param {number} [options.max=4.5] peak angle at the element's edge, in degrees
 */
export default function usePointerTilt({ max = 4.5 } = {}) {
  const [node, setNode] = useState(null);
  const setRef = useCallback((el) => setNode(el), []);

  useEffect(() => {
    if (!node) return undefined;
    if (!hasFinePointer() || prefersReducedMotion()) return undefined;

    let frame = null;
    let x = 0;
    let y = 0;

    const flush = () => {
      frame = null;
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      // -0.5 .. 0.5 across the element, so the centre is the resting angle.
      const px = (x - rect.left) / rect.width - 0.5;
      const py = (y - rect.top) / rect.height - 0.5;
      node.style.setProperty('--tilt-x', `${(-py * max).toFixed(2)}deg`);
      node.style.setProperty('--tilt-y', `${(px * max).toFixed(2)}deg`);
    };

    const onMove = (event) => {
      x = event.clientX;
      y = event.clientY;
      if (frame === null) frame = requestAnimationFrame(flush);
    };

    const onLeave = () => {
      node.style.setProperty('--tilt-x', '0deg');
      node.style.setProperty('--tilt-y', '0deg');
    };

    node.addEventListener('pointermove', onMove, { passive: true });
    node.addEventListener('pointerleave', onLeave, { passive: true });
    return () => {
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerleave', onLeave);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [node, max]);

  return setRef;
}
