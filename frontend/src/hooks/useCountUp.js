import { useCallback, useEffect, useState } from 'react';
import { prefersReducedMotion } from './scrollEngine';

const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));

function format(value, decimals, prefix, suffix) {
  return `${prefix}${value.toFixed(decimals)}${suffix}`;
}

/**
 * Counts a number up the first time it scrolls into view.
 *
 * The initial state is the FINAL value, not zero: a counter that renders `0`
 * while waiting for its observer shows a wrong number if the observer never
 * fires, and — because `useScrollReveal` and friends reveal with a delay —
 * briefly flashes `0` in front of anyone who lands mid-page. The callback then
 * resets to zero and animates in the same task, so there is no flash either way.
 *
 * @param {number} to target value
 * @param {object} [options]
 * @param {number} [options.decimals=0]
 * @param {number} [options.duration=1500] milliseconds
 * @param {string} [options.prefix='']
 * @param {string} [options.suffix='']
 * @returns {[Function, string]} ref callback and the formatted current value
 */
export default function useCountUp(to, { decimals = 0, duration = 1500, prefix = '', suffix = '' } = {}) {
  const [node, setNode] = useState(null);
  const [value, setValue] = useState(to);
  const setRef = useCallback((el) => setNode(el), []);

  useEffect(() => {
    if (!node) return undefined;
    if (typeof IntersectionObserver === 'undefined' || prefersReducedMotion()) return undefined;
    if (typeof requestAnimationFrame === 'undefined') return undefined;

    let frame = null;
    let started = false;

    const observer = new IntersectionObserver(
      (entries) => {
        if (started || !entries.some((entry) => entry.isIntersecting)) return;
        started = true;
        observer.disconnect();

        const from = 0;
        const delta = to - from;
        const t0 = performance.now();
        const step = (now) => {
          const t = Math.min(1, (now - t0) / duration);
          setValue(from + delta * easeOutExpo(t));
          if (t < 1) frame = requestAnimationFrame(step);
          else frame = null;
        };
        setValue(from);
        frame = requestAnimationFrame(step);
      },
      // A third of the card is enough to know it is properly on screen.
      { threshold: 0.34 },
    );

    observer.observe(node);
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [node, to, duration]);

  return [setRef, format(value, decimals, prefix, suffix)];
}
