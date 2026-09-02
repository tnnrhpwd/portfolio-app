/**
 * Announces a message to assistive technology via the hidden live region in
 * the React shell (see Colosseum.jsx). No-op when the bridge isn't mounted.
 */
export function announce(message: string): void {
  if (typeof window === 'undefined') return;
  const bridge = (window as unknown as { __colosseumAnnounce?: (msg: string) => void })
    .__colosseumAnnounce;
  bridge?.(message);
}
