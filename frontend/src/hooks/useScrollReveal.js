import { useEffect, useRef, useState } from 'react';

// Reveals an element (fade + rise) the first time it scrolls into view.
// Falls back to always-visible when IntersectionObserver is unavailable (e.g. old browsers, tests).
export default function useScrollReveal({ threshold = 0.15, rootMargin = '0px 0px -10% 0px' } = {}) {
    const ref = useRef(null);
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        const node = ref.current;
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
    }, [threshold, rootMargin]);

    return [ref, isVisible];
}
