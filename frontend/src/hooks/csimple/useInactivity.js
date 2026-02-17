import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Hook that tracks user activity and flags the tab as inactive after a timeout.
 * Listens for mouse, keyboard, touch, and scroll events on the document.
 *
 * @param {number} timeoutMs - Inactivity timeout in milliseconds (default: 3 minutes)
 * @returns {{ isInactive: boolean, resume: () => void }}
 */
export function useInactivity(timeoutMs = 3 * 60 * 1000) {
  const [isInactive, setIsInactive] = useState(false);
  const timerRef = useRef(null);
  const inactiveRef = useRef(false); // avoid stale closures

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (inactiveRef.current) {
      inactiveRef.current = false;
      setIsInactive(false);
    }
    timerRef.current = setTimeout(() => {
      inactiveRef.current = true;
      setIsInactive(true);
      console.log(`[Inactivity] Tab inactive after ${timeoutMs / 1000}s of no interaction`);
    }, timeoutMs);
  }, [timeoutMs]);

  // Manual resume (e.g. clicking the overlay)
  const resume = useCallback(() => {
    console.log('[Inactivity] Resumed by user');
    resetTimer();
  }, [resetTimer]);

  useEffect(() => {
    const events = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll', 'wheel'];
    const handler = () => {
      // Only reset if currently active (avoid constant timer resets while inactive overlay is up)
      if (!inactiveRef.current) {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          inactiveRef.current = true;
          setIsInactive(true);
          console.log(`[Inactivity] Tab inactive after ${timeoutMs / 1000}s of no interaction`);
        }, timeoutMs);
      }
    };

    // Attach listeners
    events.forEach(e => document.addEventListener(e, handler, { passive: true }));

    // Start the initial timer
    resetTimer();

    // Also pause on visibility change (tab hidden)
    const onVisibility = () => {
      if (document.hidden) {
        // Tab hidden — go inactive immediately
        if (timerRef.current) clearTimeout(timerRef.current);
        inactiveRef.current = true;
        setIsInactive(true);
        console.log('[Inactivity] Tab hidden — going inactive');
      } else {
        // Tab visible again — resume
        resume();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      events.forEach(e => document.removeEventListener(e, handler));
      document.removeEventListener('visibilitychange', onVisibility);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [timeoutMs, resetTimer, resume]);

  return { isInactive, resume };
}
