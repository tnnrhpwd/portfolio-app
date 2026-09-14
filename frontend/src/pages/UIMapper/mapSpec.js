/**
 * mapSpec.js — read a saved UI map back into the mapper.
 *
 * `/uimapper` could always EXPORT a spec; this is the reverse. It exists so a map
 * produced elsewhere — by an agent, by an earlier session, or by the sprite
 * extractor's `sheets.json` — can be loaded and then renamed/adjusted by hand
 * instead of being re-drawn from scratch.
 *
 * Two shapes exist in this repo:
 *
 *   - the **UIMapper export**: `{ source, width, height, regions: [...] }`
 *   - the **sprite extractor's `regions`**: a bare `[{ name, x, y, w, h }]`
 *
 * A box may carry normalized keys (`nx/ny/nw/nh`, what this tool exports) or
 * `x/y/w/h`. Those are genuinely ambiguous: this tool means **pixels** by
 * `x/y/w/h`, while `scripts/rocket/extract-sprites.js` means **fractions of the
 * sheet** by the same four names. It is resolved the extractor's way — pixels
 * when the rect says `"unit": "px"` or any value exceeds 1, fractions otherwise —
 * because that covers both producers without needing a flag.
 *
 * The result is always normalized (0..1), so it can be applied to an image of any
 * size. Pixel-sourced boxes need to know what image they were measured against,
 * which is why `dims` exists as a fallback for a spec that does not record its own
 * `width`/`height`.
 */

/** A box is dropped if it is thinner than this on either axis (as at draw time). */
export const MIN_BOX_PX = 2;

/**
 * @param {unknown} json - The parsed map JSON (object or bare array).
 * @param {{w:number,h:number}|null} [dims] - Size of the loaded image, used only
 *   when a pixel-coordinate box has no `width`/`height` to convert against.
 * @returns {{source:string|null,width:number|null,height:number|null,
 *   boxes:Array<{name:string|null,nx:number,ny:number,nw:number,nh:number}>}}
 * @throws {Error} when there is nothing to read, or pixels cannot be resolved.
 */
export function parseMapSpec(json, dims = null) {
  const list = Array.isArray(json) ? json : json?.regions;
  if (!Array.isArray(list)) {
    throw new Error('That JSON has no `regions` array.');
  }

  const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  const specW = num(json?.width) ?? num(dims?.w);
  const specH = num(json?.height) ?? num(dims?.h);

  const boxes = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;

    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : null;

    const normalized = [raw.nx, raw.ny, raw.nw, raw.nh].map(num);
    if (normalized.every((v) => v !== null)) {
      boxes.push({ name, nx: normalized[0], ny: normalized[1], nw: normalized[2], nh: normalized[3] });
      continue;
    }

    const flat = [raw.x, raw.y, raw.w, raw.h].map(num);
    if (flat.every((v) => v === null)) continue; // not a rectangle at all

    const isPixels = raw.unit === 'px' || flat.some((v) => v !== null && v > 1);
    if (!isPixels) {
      boxes.push({ name, nx: flat[0], ny: flat[1], nw: flat[2], nh: flat[3] });
      continue;
    }

    if (!specW || !specH) {
      throw new Error(
        'That map uses pixel coordinates but records no image size, so the boxes cannot be placed.',
      );
    }
    boxes.push({
      name,
      nx: flat[0] / specW,
      ny: flat[1] / specH,
      nw: flat[2] / specW,
      nh: flat[3] / specH,
    });
  }

  return {
    source: typeof json?.source === 'string' ? json.source : null,
    width: num(json?.width),
    height: num(json?.height),
    boxes,
  };
}

/**
 * Was this map measured against a differently-shaped image?
 *
 * Normalized boxes are proportional, so a map made for a 1344×768 sheet still
 * loads onto a 672×384 one — but onto a 768×1344 one the boxes stretch to the
 * wrong places. Returns a warning string, or `''` when the shapes agree.
 */
export function aspectWarning(spec, dims, tolerance = 0.02) {
  if (!spec?.width || !spec?.height || !dims?.w || !dims?.h) return '';
  const specAspect = spec.width / spec.height;
  const imageAspect = dims.w / dims.h;
  if (Math.abs(specAspect - imageAspect) / imageAspect <= tolerance) return '';
  return (
    `That map was measured against a ${spec.width}×${spec.height} image, and this one is ` +
    `${dims.w}×${dims.h}. The boxes are proportional, so they may not land on the same subjects.`
  );
}

/**
 * Turn a parsed spec into the mapper's region objects, clamped to the image.
 *
 * @param {{boxes:Array}} spec - Output of `parseMapSpec`.
 * @param {{w:number,h:number}} dims - Size of the loaded image.
 * @param {(i:number)=>string} makeId - Id factory (kept injected so this stays pure).
 */
export function toRegions(spec, dims, makeId) {
  return (spec?.boxes ?? [])
    .map((box, i) => {
      const x = Math.max(0, Math.min(box.nx * dims.w, dims.w));
      const y = Math.max(0, Math.min(box.ny * dims.h, dims.h));
      const w = Math.max(0, Math.min(box.nw * dims.w, dims.w - x));
      const h = Math.max(0, Math.min(box.nh * dims.h, dims.h - y));
      return { name: box.name || `Region ${i + 1}`, x, y, w, h };
    })
    .filter((r) => r.w > MIN_BOX_PX && r.h > MIN_BOX_PX)
    .map((r, i) => ({ ...r, id: makeId(i) }));
}
