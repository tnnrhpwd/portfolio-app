import { useCallback, useEffect, useRef, useState } from 'react';

// Reveals an element (fade + rise) the first time it scrolls into view.
// Observes the node lazily so elements that mount later (e.g. after async
// data loads) are still revealed. Falls back to always-visible when
// IntersectionObserver is unavailable (e.g. old browsers, tests).
export default function useScrollReveal({ threshold = 0.15, rootMargin = '0px 0px -10% 0px' } = {}) {
    const ref = useRef(null);
    const [node, setNode] = useState(null);
    const [isVisible, setIsVisible] = useState(false);

    // Stable callback ref: React calls this when the element mounts/unmounts.
    // Storing the node in state re-runs the effect below once it exists.
    const setRef = useCallback((el) => {
        ref.current = el;
        setNode(el);
    }, []);

    useEffect(() => {
        if (!node) return undefined;
        if (typeof IntersectionObserver === 'undefined') {
            setIsVisible(true);
            return undefined;
        }
        const observer = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) {
                setIsVisible(true);
                observer.disconnect();
            }
        }, { threshold, rootMargin });
        observer.observe(node);
        return () => observer.disconnect();
    }, [node, threshold, rootMargin]);

    return [setRef, isVisible];
}
