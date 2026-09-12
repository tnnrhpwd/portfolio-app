import { useCallback, useEffect, useState } from 'react';

/**
 * Resolves the CSS colour tokens Chart.js needs, since a canvas cannot use
 * `var(--token)` and the frontend standard forbids hardcoding palette values.
 *
 * Two details matter here, and both were learned the hard way:
 *
 * 1. **Read the tokens off `document.body`.** The theme class (`light-theme` /
 *    `dark-theme`) lives on <body>, and those blocks are what redefine the
 *    palette, so body's computed value *is* the theme's value. Reading it off
 *    <html> would return the light-theme default even in dark mode.
 *
 * 2. **Never resolve during the first render.** The first render happens before
 *    the app is committed to the DOM and before the theme class is applied, so
 *    every token reads back as an empty string. A chart built from those values
 *    paints black — and because the canvas is never rebuilt, it stays black.
 *    `ready` therefore flips only after mount, and `version` changes whenever
 *    the theme does, so a chart can key itself on it and be rebuilt.
 */

export function readToken(token) {
  if (typeof document === 'undefined' || !document.body) return null;
  const value = window.getComputedStyle(document.body).getPropertyValue(token);
  const trimmed = (value || '').trim();
  // A `var()` the browser could not substitute is not a colour.
  if (!trimmed || trimmed.includes('var(')) return null;
  return trimmed;
}

const FALLBACK = '#808080';

export default function useChartTheme() {
  const [ready, setReady] = useState(false);
  const [themeVersion, setThemeVersion] = useState(0);

  useEffect(() => {
    setReady(true);

    if (typeof MutationObserver === 'undefined' || !document.body) return undefined;
    const observer = new MutationObserver(() => setThemeVersion((version) => version + 1));
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const resolve = useCallback(
    (token) => {
      // Referencing these keeps the callback fresh across mounts and theme swaps.
      void ready;
      void themeVersion;
      return readToken(token) || FALLBACK;
    },
    [ready, themeVersion],
  );

  /** Stable identity for a chart: changes once colours are readable, and again per theme swap. */
  const version = `${ready ? 'ready' : 'pending'}-${themeVersion}`;

  return { resolve, ready, version };
}

/**
 * Adds an alpha channel to a resolved colour so fills can be translucent
 * without a second hardcoded value.
 *
 * Handles `rgb()`, `rgba()`, `#rgb`, `#rrggbb` and the `color(srgb r g b)`
 * form Chrome returns for computed values derived from `color-mix()`.
 * Anything unrecognised is returned unchanged.
 */
export function withAlpha(color, alpha) {
  if (typeof color !== 'string') return color;
  const value = color.trim();

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3) digits = digits.split('').map((c) => c + c).join('');
    const numeric = parseInt(digits, 16);
    /* eslint-disable no-bitwise */
    const r = (numeric >> 16) & 255;
    const g = (numeric >> 8) & 255;
    const b = numeric & 255;
    /* eslint-enable no-bitwise */
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  const rgb = /^rgba?\(([^)]+)\)$/i.exec(value);
  if (rgb) {
    const [r, g, b] = rgb[1].split(/[,\s/]+/).map((part) => parseFloat(part));
    if ([r, g, b].every(Number.isFinite)) return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    return value;
  }

  const srgb = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i.exec(value);
  if (srgb) {
    const [r, g, b] = srgb.slice(1, 4).map((part) => Math.round(parseFloat(part) * 255));
    if ([r, g, b].every(Number.isFinite)) return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  return value;
}
