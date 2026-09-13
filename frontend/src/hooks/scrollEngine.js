// ── One shared rAF scroll loop for the whole app ─────────────────────────────
//
// Scroll-linked effects need a fresh measurement every frame. One `scroll`
// listener per effect is how a page ends up with a dozen of them fighting over
// the same 16ms. Subscribers here share a single passive listener, a single
// `requestAnimationFrame`, and a single batch of geometry reads per tick.
//
// Two rules this module exists to enforce:
//
//  1. **Reduced motion means no writes at all.** A scroll-linked transform is
//     not an `animation`, so the global `@media (prefers-reduced-motion: reduce)`
//     reset in `index.css` cannot switch it off — and `!important` cannot reach
//     an inline custom property either. It has to be refused HERE, and the CSS
//     has to look finished at the property's fallback value (every effect in
//     `About/` is written so its fallback is the settled, fully-visible state).
//
//  2. **Results go into CSS custom properties, not React state.** These values
//     change up to 60×/s; a `setState` per frame would re-render the subtree and
//     become the most expensive thing on the page. Writing a custom property
//     lets the compositor do the work, and it inherits to descendants for free.
//
// Each subscriber is a `{ read, write }` pair rather than one callback, because
// interleaving reads and writes forces a synchronous layout per subscriber.
// The loop reads from every subscriber first, then writes to all of them, so a
// frame costs exactly one forced layout.

// Module-local: nothing outside this file needs the query string itself.
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** True when the visitor has asked the OS for reduced motion. */
export function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches
  );
}

/** True when the visitor is on a device with a real pointing device. */
export function hasFinePointer() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches
  );
}

const subscribers = new Set();
let frameId = null;

function tick() {
  frameId = null;
  if (typeof window === 'undefined') return;

  const state = {
    y: window.scrollY || window.pageYOffset || 0,
    vh: window.innerHeight || 0,
    vw: window.innerWidth || 0,
    docHeight: document.documentElement.scrollHeight,
  };

  const measured = [];
  for (const sub of subscribers) {
    try {
      measured.push({ sub, value: sub.read(state) });
    } catch {
      measured.push({ sub, value: null });
    }
  }
  for (const { sub, value } of measured) {
    try {
      sub.write(value, state);
    } catch {
      // One broken subscriber must never stop the loop for the others.
    }
  }
}

function schedule() {
  if (frameId !== null) return;
  frameId = requestAnimationFrame(tick);
}

function currentState() {
  return {
    y: window.scrollY || window.pageYOffset || 0,
    vh: window.innerHeight || 0,
    vw: window.innerWidth || 0,
    docHeight: document.documentElement.scrollHeight,
  };
}

/**
 * Join the shared scroll loop.
 *
 * @param {(state: {y:number, vh:number, vw:number, docHeight:number}) => *} read
 *   Called before any write this frame. Do nothing but measure here.
 * @param {(value: *, state: object) => void} write
 *   Called after every subscriber has measured. Do the style writes here.
 * @returns {() => void} unsubscribe
 */
export function subscribeToScroll(read, write) {
  if (typeof window === 'undefined') return () => {};

  const entry = { read, write };
  const isFirst = subscribers.size === 0;
  subscribers.add(entry);

  if (isFirst) {
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    schedule();
  }

  // Prime immediately so the first painted frame is already in position —
  // waiting for the first `scroll` event would show the un-transformed state.
  try {
    write(read(currentState()), currentState());
  } catch {
    // Same tolerance as the loop: a bad subscriber is not fatal.
  }

  return () => {
    subscribers.delete(entry);
    if (subscribers.size === 0) {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
    }
  };
}
