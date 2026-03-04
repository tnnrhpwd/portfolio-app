/**
 * Core Web Vitals reporting — lightweight, zero-dependency.
 *
 * Collects LCP, FID/INP, CLS, FCP, TTFB via the native PerformanceObserver API
 * and sends them to the backend analytics endpoint in a single beacon.
 *
 * Call `initWebVitals()` once on app mount (e.g., in index.jsx).
 */

const vitals = {};
let reported = false;

function observe(type, callback) {
  try {
    const po = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        callback(entry);
      }
    });
    po.observe({ type, buffered: true });
  } catch {
    // Browser doesn't support this metric — gracefully skip.
  }
}

function report() {
  if (reported) return;
  // Wait until at least LCP and CLS are captured
  if (!vitals.lcp && !vitals.cls) return;

  reported = true;
  const payload = {
    url: window.location.pathname,
    ...vitals,
    connection: navigator.connection?.effectiveType || 'unknown',
    deviceMemory: navigator.deviceMemory || null,
    timestamp: Date.now(),
  };

  // Fire-and-forget with sendBeacon so it survives page unload
  if (navigator.sendBeacon) {
    navigator.sendBeacon(
      '/api/data/web-vitals',
      new Blob([JSON.stringify(payload)], { type: 'application/json' })
    );
  } else {
    fetch('/api/data/web-vitals', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
    }).catch(() => {});
  }
}

export function initWebVitals() {
  if (typeof PerformanceObserver === 'undefined') return;

  // Largest Contentful Paint
  observe('largest-contentful-paint', (entry) => {
    vitals.lcp = Math.round(entry.startTime);
  });

  // First Input Delay
  observe('first-input', (entry) => {
    vitals.fid = Math.round(entry.processingStart - entry.startTime);
  });

  // Cumulative Layout Shift
  let clsValue = 0;
  let sessionEntries = [];
  observe('layout-shift', (entry) => {
    if (entry.hadRecentInput) return;
    sessionEntries.push(entry);
    clsValue += entry.value;
    vitals.cls = parseFloat(clsValue.toFixed(4));
  });

  // First Contentful Paint
  observe('paint', (entry) => {
    if (entry.name === 'first-contentful-paint') {
      vitals.fcp = Math.round(entry.startTime);
    }
  });

  // Time to First Byte (from Navigation Timing)
  observe('navigation', (entry) => {
    vitals.ttfb = Math.round(entry.responseStart);
  });

  // Report on visibility change (user navigates away / switches tab)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') report();
  });

  // Also report before unload as a fallback
  window.addEventListener('pagehide', report);
}
