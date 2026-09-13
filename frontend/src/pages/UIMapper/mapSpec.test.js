/**
 * mapSpec.test.js — importing a saved map back into `/uimapper`.
 *
 * The thing worth guarding is the `x/y/w/h` ambiguity: the UIMapper export means
 * pixels by those keys and the sprite extractor means fractions, so a regression
 * here silently misplaces every box rather than throwing.
 */

import { parseMapSpec, aspectWarning, toRegions, MIN_BOX_PX } from './mapSpec';

const dims = { w: 1344, h: 768 };

describe('parseMapSpec — accepted shapes', () => {
  it('reads this tool\'s own export (normalized keys)', () => {
    const spec = parseMapSpec({
      source: 'panel.png',
      width: 1344,
      height: 768,
      regions: [{ name: 'ui-panel', x: 359, y: 116, w: 83, h: 64, nx: 0.267, ny: 0.151, nw: 0.0614, nh: 0.0833 }],
    });
    expect(spec.source).toBe('panel.png');
    expect(spec.boxes).toEqual([
      { name: 'ui-panel', nx: 0.267, ny: 0.151, nw: 0.0614, nh: 0.0833 },
    ]);
  });

  it('reads the sprite extractor\'s bare array of fractions', () => {
    // scripts/<pack>/sheets.json "regions" — no wrapper object, values are 0..1
    const spec = parseMapSpec([{ name: 'ui-ribbon', x: 0.1, y: 0.2, w: 0.5, h: 0.25 }]);
    expect(spec.boxes).toEqual([{ name: 'ui-ribbon', nx: 0.1, ny: 0.2, nw: 0.5, nh: 0.25 }]);
  });

  it('converts explicit pixel rects against the spec\'s own size', () => {
    const spec = parseMapSpec({
      width: 1000,
      height: 500,
      regions: [{ name: 'a', x: 100, y: 50, w: 250, h: 100, unit: 'px' }],
    });
    expect(spec.boxes[0]).toEqual({ name: 'a', nx: 0.1, ny: 0.1, nw: 0.25, nh: 0.2 });
  });

  it('treats x/y/w/h over 1 as pixels without needing unit', () => {
    const spec = parseMapSpec({ width: 1000, height: 500, regions: [{ x: 100, y: 50, w: 250, h: 100 }] });
    expect(spec.boxes[0]).toEqual({ name: null, nx: 0.1, ny: 0.1, nw: 0.25, nh: 0.2 });
  });

  it('falls back to the loaded image size when the spec has none', () => {
    const spec = parseMapSpec([{ x: 672, y: 384, w: 336, h: 192, unit: 'px' }], dims);
    expect(spec.boxes[0]).toEqual({ name: null, nx: 0.5, ny: 0.5, nw: 0.25, nh: 0.25 });
  });
});

describe('parseMapSpec — rejection and tolerance', () => {
  it('throws when there is no regions array', () => {
    expect(() => parseMapSpec({ foo: 1 })).toThrow(/no `regions` array/);
    expect(() => parseMapSpec(null)).toThrow(/no `regions` array/);
  });

  it('throws for pixel rects with no size to resolve them against', () => {
    expect(() => parseMapSpec([{ x: 100, y: 50, w: 20, h: 20, unit: 'px' }])).toThrow(
      /pixel coordinates but records no image size/,
    );
  });

  it('skips entries that are not rectangles instead of failing the whole map', () => {
    const spec = parseMapSpec({
      width: 100,
      height: 100,
      regions: [null, 'nope', { name: 'no numbers' }, { name: 'ok', x: 0.1, y: 0.1, w: 0.2, h: 0.2 }],
    });
    expect(spec.boxes).toHaveLength(1);
    expect(spec.boxes[0].name).toBe('ok');
  });

  it('leaves a blank name null so the caller can default it', () => {
    const spec = parseMapSpec([{ name: '   ', x: 0.1, y: 0.1, w: 0.2, h: 0.2 }]);
    expect(spec.boxes[0].name).toBeNull();
  });
});

describe('aspectWarning', () => {
  it('is silent when the shapes agree, including at a different scale', () => {
    expect(aspectWarning({ width: 1344, height: 768 }, dims)).toBe('');
    expect(aspectWarning({ width: 672, height: 384 }, dims)).toBe('');
  });

  it('warns when the map was measured against a differently-shaped image', () => {
    expect(aspectWarning({ width: 768, height: 1344 }, dims)).toMatch(/may not land on the same subjects/);
  });

  it('is silent when either side does not know its size', () => {
    expect(aspectWarning({ width: null, height: null }, dims)).toBe('');
    expect(aspectWarning({ width: 100, height: 100 }, null)).toBe('');
  });
});

describe('toRegions', () => {
  const spec = parseMapSpec({
    width: 100,
    height: 100,
    regions: [
      { name: 'panel', x: 0.1, y: 0.2, w: 0.5, h: 0.25 },
      { name: 'sliver', x: 0.1, y: 0.9, w: 0.001, h: 0.5 },
      { x: 0.9, y: 0.9, w: 0.5, h: 0.5 },
    ],
  });

  it('scales to the image and clamps boxes that overhang the edge', () => {
    const regions = toRegions(spec, dims, (i) => `id${i}`);
    const overflowing = regions[regions.length - 1];
    expect(overflowing.x + overflowing.w).toBeLessThanOrEqual(dims.w);
    expect(overflowing.y + overflowing.h).toBeLessThanOrEqual(dims.h);
  });

  it('drops slivers and gives every box an id and a name', () => {
    const regions = toRegions(spec, dims, (i) => `id${i}`);
    expect(regions.map((r) => r.name)).toEqual(['panel', 'Region 3']);
    expect(regions.map((r) => r.id)).toEqual(['id0', 'id1']);
    expect(regions.every((r) => r.w > MIN_BOX_PX && r.h > MIN_BOX_PX)).toBe(true);
  });

  it('returns nothing for an empty spec', () => {
    expect(toRegions({ boxes: [] }, dims, (i) => `id${i}`)).toEqual([]);
    expect(toRegions(undefined, dims, (i) => `id${i}`)).toEqual([]);
  });
});
