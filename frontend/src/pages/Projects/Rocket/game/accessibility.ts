/**
 * Rocket — screen-reader bridge.
 *
 * The game is a canvas, so assistive tech sees nothing inside it. React renders
 * a visually-hidden `aria-live` region next to the canvas and exposes it on
 * `window.__rocketAnnounce`; scenes call this to narrate the handful of events
 * that actually matter (wave start, boss, death, purchase).
 */

type Announcer = (message: string) => void;

declare global {
  interface Window {
    __rocketAnnounce?: Announcer;
  }
}

export function announce(message: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.__rocketAnnounce?.(message);
  } catch {
    /* announcements are best-effort */
  }
}
