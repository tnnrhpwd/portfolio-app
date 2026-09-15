import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import BrandMark from './BrandMark.jsx';
import {
  VIEW_BOX,
  CENTRE,
  DISC_RADIUS,
  RING_RADIUS,
  RING_STROKE,
  CHECK_PATH,
  CHECK_STROKE,
  CHECK_KEYLINE_STROKE,
} from './geometry.js';

/**
 * Two jobs, and the first one is the important one.
 *
 * 1. THE GEOMETRY EXISTS TWICE — in `geometry.js` (which the component renders) and in
 *    `assets/brand-mark.svg` (which `scripts/generate-logo-assets.js` rasterises into
 *    the favicon, the apple-touch icon and the addon's three icons). They cannot be
 *    merged: a raster surface needs a real SVG file, and the live mark needs inline
 *    elements so CSS can reach its strokes. So they are pinned together instead —
 *    retune the mark in one place and this suite refuses to let the other drift.
 *
 * 2. The colour mapping is a single, easily-inverted decision, so it is asserted
 *    rather than eyeballed: the ring takes the scheme's partner hue and the check its
 *    dominant one. Flipped, the default visitor sees the logo with its colours
 *    swapped — a bug that is invisible in a diff and obvious only to the designer.
 */

const MASTER = fs.readFileSync(
  path.join(__dirname, '..', '..', 'assets', 'brand-mark.svg'),
  'utf8',
);

const tags = (name) => MASTER.match(new RegExp(`<${name}\\b[^>]*>`, 'g')) || [];
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : null;
};
/** Numbers only, in order — so `M14.8 29.28 L…` and `M14.8,29.28 L…` compare equal
 *  and a reformat can't fail the test, but a moved point still will. */
const numbers = (value) => (value.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);

describe('BrandMark — geometry parity with the master artwork', () => {
  it('uses the same viewBox as the master', () => {
    expect(attr(tags('svg')[0], 'viewBox')).toBe(VIEW_BOX);
  });

  it('draws the field at the same place and size as the master', () => {
    const disc = tags('circle')[0];
    expect(Number(attr(disc, 'cx'))).toBe(CENTRE.x);
    expect(Number(attr(disc, 'cy'))).toBe(CENTRE.y);
    expect(Number(attr(disc, 'r'))).toBe(DISC_RADIUS);
  });

  it('draws the frame at the same place, size and weight as the master', () => {
    const ring = tags('circle')[1];
    expect(Number(attr(ring, 'cx'))).toBe(CENTRE.x);
    expect(Number(attr(ring, 'cy'))).toBe(CENTRE.y);
    expect(Number(attr(ring, 'r'))).toBe(RING_RADIUS);
    expect(Number(attr(ring, 'stroke-width'))).toBe(RING_STROKE);
  });

  it('draws the glyph along the same path, at the same weight, as the master', () => {
    const check = tags('path').find((t) => Number(attr(t, 'stroke-width')) === CHECK_STROKE);
    expect(check).toBeTruthy();
    expect(numbers(attr(check, 'd'))).toEqual(numbers(CHECK_PATH));
  });

  it('draws the keyline along the same path, wider than the glyph, as the master', () => {
    const keyline = tags('path').find(
      (t) => Number(attr(t, 'stroke-width')) === CHECK_KEYLINE_STROKE,
    );
    expect(keyline).toBeTruthy();
    expect(numbers(attr(keyline, 'd'))).toEqual(numbers(CHECK_PATH));
    // Wider on BOTH sides — 0.6 of gap per side, which is the whole point of it.
    expect(CHECK_KEYLINE_STROKE).toBeGreaterThan(CHECK_STROKE);
    expect(CHECK_KEYLINE_STROKE - CHECK_STROKE).toBeCloseTo(1.2, 5);
  });

  it('keeps the master free of a background rect — the mark is transparent', () => {
    expect(tags('rect')).toHaveLength(0);
    expect(MASTER).not.toMatch(/<svg[^>]*style="[^"]*background/);
  });
});

describe('BrandMark — the mark itself', () => {
  afterEach(cleanup);

  it('renders the elements in back-to-front order', () => {
    const { container } = render(<BrandMark />);
    const nodes = container.querySelector('.brand-mark').querySelectorAll('circle, path');

    expect(nodes).toHaveLength(4);
    expect(nodes[0].getAttribute('class')).toBe('brand-mark__disc');
    expect(nodes[1].getAttribute('class')).toBe('brand-mark__ring');
    expect(nodes[2].getAttribute('class')).toBe('brand-mark__check-keyline');
    // Last = on top, so the check crosses in front of the ring, over its own keyline.
    expect(nodes[3].getAttribute('class')).toBe('brand-mark__check');
  });

  it('maps the ring to the scheme partner hue and the glyph to the dominant one', () => {
    const styles = readCss();

    // The colours live in the stylesheet, so the assertion is on the stylesheet: a
    // swapped mapping has to fail here, not in a screenshot.
    expect(styles).toMatch(/\.brand-mark__ring\s*\{[^}]*stroke:\s*var\(--scheme-primary\)/);
    expect(styles).toMatch(/\.brand-mark__check\s*\{[^}]*stroke:\s*var\(--scheme-accent\)/);
    expect(styles).toMatch(/\.brand-mark__disc\s*\{[^}]*fill:\s*var\(--bg-1\)/);
    // The keyline must be the field's tone, never transparent and never a neutral:
    // it is what separates the glyph from the ring, whose contrast is ~1.1:1.
    expect(styles).toMatch(/stroke:\s*var\(--bg-1\)/);
    expect(styles).not.toMatch(/brand-mark__check-keyline\s*\{[^}]*transparent/);
  });

  it('carries no colour of its own in the markup', () => {
    // A fill/stroke attribute would out-rank the stylesheet and pin the mark to one
    // colourway, so the component is not allowed to have any.
    const { container } = render(<BrandMark />);
    const markup = container.querySelector('.brand-mark').outerHTML;

    expect(markup).not.toMatch(/fill="(?!none)/);
    expect(markup).not.toMatch(/stroke="#/);
    expect(markup).not.toMatch(/style="[^"]*(fill|stroke)/);
  });

  it('is announced as decorative unless it is given a name', () => {
    const { container: bare } = render(<BrandMark />);
    expect(bare.querySelector('.brand-mark').getAttribute('aria-hidden')).toBe('true');

    const { container: named } = render(<BrandMark title="Simple" />);
    const mark = named.querySelector('.brand-mark');
    expect(mark.getAttribute('aria-label')).toBe('Simple');
    expect(mark.getAttribute('aria-hidden')).toBeNull();
  });

  it('defaults to the header size and accepts an override', () => {
    const { container } = render(<BrandMark />);
    expect(container.querySelector('.brand-mark').style.width).toBe(
      'calc(var(--nav-size) * 0.8)',
    );

    const { container: sized } = render(<BrandMark size="64px" />);
    expect(sized.querySelector('.brand-mark').style.width).toBe('64px');
  });

  it('renders the plate variant as a plain raster, not as themed markup', () => {
    const { container } = render(<BrandMark variant="plate" />);
    const img = container.querySelector('img.brand-mark--plate');

    expect(img).toBeTruthy();
    // No svg at all: the plate must NOT be able to follow the scheme.
    expect(container.querySelector('svg')).toBeNull();
  });
});

function readCss() {
  return fs.readFileSync(path.join(__dirname, 'BrandMark.css'), 'utf8');
}
