/**
 * Announces a message to assistive technology via the hidden live region in
 * the React shell (see Coliseum.jsx). No-op when the bridge isn't mounted.
 */
export function announce(message: string): void {
  if (typeof window === 'undefined') return;
  const bridge = (window as unknown as { __coliseumAnnounce?: (msg: string) => void })
    .__coliseumAnnounce;
  bridge?.(message);
}
