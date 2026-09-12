#!/usr/bin/env node
/**
 * Rocket sprite-sheet extractor.
 * ---------------------------------------------------------------------------
 * Turns the AI-generated "collection" sheets in
 *   frontend/src/assets/rocket/*.jpg
 * into individual, tightly-cropped, transparent PNGs in
 *   frontend/public/rocket/*.png
 * plus a manifest (rocket/manifest.json) and a labelled proof sheet
 * (rocket/_preview/) so the crops + names can be verified visually.
 *
 * Pipeline per sheet:
 *   1. decode to raw RGBA (sharp / libvips)
 *   2. classify pixels: page white AND light-grey panel fill are background
 *   3. strip long THIN runs  -> panel frames + progress bars
 *      (thin matters: a rocket body is also a long run, and stripping every
 *       long run deletes tall sprites)
 *   4. de-speckle             -> JPEG noise must not block gutter detection
 *   5. connected components, then erase everything that is furniture:
 *        tiny   - specks
 *        frame  - large, near-empty outlines (panel borders, blank panels)
 *        bar    - solid, extremely elongated rectangles (progress bars)
 *        text   - short + desaturated + sparse (captions, titles, labels)
 *      Erasing text before segmenting is what lets a caption row collapse and
 *      the icon rows above/below it merge into a clean horizontal gutter.
 *   6. XY-cut the remaining mask: split on the gutters, rows first then
 *      columns, recursively. A leaf = one sprite. This groups multi-part
 *      icons (sparkle bursts, crossed wrenches) automatically and relies only
 *      on real empty space, never on proximity chaining (which cascades and
 *      swallows whole panels).
 *   7. DFS order through the cut tree = reading order, so the hand-written
 *      name list in sheets.json lines up with rows top->bottom, left->right.
 *   8. export each leaf:
 *        - alpha ramp from RGB distance to the LOCAL background colour
 *        - un-matting (de-fringe) so anti-aliased edges keep no white halo
 *        - flood-fill from the crop border, so ENCLOSED light pixels (white
 *          rocket bodies, visor highlights) stay opaque instead of being
 *          punched into holes
 *        - trim to content, cap the longest side, write PNG
 *
 * Usage:
 *   node scripts/rocket/extract-sprites.js                    # every sheet
 *   node scripts/rocket/extract-sprites.js --sheet ui-icons
 *   node scripts/rocket/extract-sprites.js --no-preview
 *   node scripts/rocket/extract-sprites.js --dump-detected    # -> detected.json
 *   node scripts/rocket/extract-sprites.js --debug-mask       # mask PNGs
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

/** sharp lives in backend/node_modules (not hoisted to the repo root). */
function loadSharp() {
  const candidates = [
    path.join(ROOT, 'backend', 'node_modules', 'sharp'),
    path.join(ROOT, 'node_modules', 'sharp'),
  ];
  for (const c of candidates) {
    try {
      return require(c);
    } catch {
      /* try next */
    }
  }
  throw new Error('sharp not found. Install it (backend/node_modules) before running.');
}
const sharp = loadSharp();

const SRC_DIR = path.join(ROOT, 'frontend', 'src', 'assets', 'rocket');
const OUT_DIR = path.join(ROOT, 'frontend', 'public', 'rocket');
const PREVIEW_DIR = path.join(OUT_DIR, '_preview');
const SPEC_PATH = path.join(__dirname, 'sheets.json');

/**
 * Detection / export tuning. `sheets.json` may override any of these globally
 * (top-level `defaults`) or per sheet.
 */
const BASE_OPTS = {
  // --- background classification -----------------------------------------
  bgLuma: 228, // >= this luma ...
  bgSat: 0.075, // ... AND <= this saturation  =>  background
  // --- furniture removal --------------------------------------------------
  frameRunH: 0.28, // a horizontal run >= this * sheetWidth ...
  frameRunV: 0.14, // ... or a vertical run >= this * sheetHeight ...
  frameThin: 18, // ... that is also <= this thick  =>  a line, drop it
  despeckleMin: 3, // foreground pixels needed among the 8 neighbours
  frameMaxFill: 0.045, // fill ratio below this (when big enough) => outline
  frameMinDim: 130,
  barMaxAspect: 7, // solid rectangles this elongated => progress bar
  barMinFill: 0.72,
  // --- sprite filtering ---------------------------------------------------
  minSize: 30, // px: a sprite must be at least this on BOTH axes
  textMaxH: 96, // a component this short (or shorter) ...
  textMaxSat: 0.17, // ... this desaturated ...
  textMaxFill: 0.8, // ... and this sparse => text
  // --- segmentation -------------------------------------------------------
  minGutterRow: 22, // px of empty row needed to split vertically
  minGutterCol: 22, // px of empty column needed to split horizontally
  // --- alpha / export -----------------------------------------------------
  pad: 12, // context kept around an AUTO-detected sprite when cropping
  regionPad: 2, // hand-placed regions are authored precisely, so a wide pad
  //               would only pull in whatever sits on the other side of the
  //               gutter (e.g. the neighbouring planet's ring).
  alphaLo: 14, // rgb distance where alpha starts to ramp up
  alphaHi: 62, // rgb distance where alpha reaches fully opaque
  defringe: true, // un-matte partially transparent edge pixels
  maxDim: 512, // cap the longest side of an exported asset
  minExport: 16, // drop anything that exports smaller than this on both axes
  png: { compressionLevel: 9 },
};

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function sanitizeName(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function pointInRect(px, py, r) {
  return px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h;
}

/** Convert a spec rect (fractions of the sheet) to absolute pixels. */
function resolveRect(r, W, H) {
  const frac = r.unit !== 'px';
  return {
    x: clamp(Math.round(frac ? r.x * W : r.x), 0, W),
    y: clamp(Math.round(frac ? r.y * H : r.y), 0, H),
    w: clamp(Math.round(frac ? r.w * W : r.w), 1, W),
    h: clamp(Math.round(frac ? r.h * H : r.h), 1, H),
  };
}

// ---------------------------------------------------------------------------
// 1-4. mask, furniture line removal, de-speckle
// ---------------------------------------------------------------------------

/**
 * Mask of "not obviously background" pixels.
 * Background = light AND unsaturated, which covers both the page white and the
 * light-grey panel fill inside these sheets.
 */
function buildMask(rgba, W, H, opts) {
  const n = W * H;
  const mask = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = rgba[p];
    const g = rgba[p + 1];
    const b = rgba[p + 2];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    if (luma < opts.bgLuma) {
      mask[i] = 1;
      continue;
    }
    const max = r > g ? (r > b ? r : b) : g > b ? g : b;
    if (max === 0) continue;
    const min = r < g ? (r < b ? r : b) : g < b ? g : b;
    if ((max - min) / max > opts.bgSat) mask[i] = 1;
  }
  return mask;
}

/** Run length of the horizontal or vertical foreground run containing each pixel. */
function runLengths(mask, W, H, axis) {
  const out = new Int32Array(W * H);
  if (axis === 'x') {
    for (let y = 0; y < H; y++) {
      const row = y * W;
      let x = 0;
      while (x < W) {
        if (mask[row + x] !== 1) {
          x++;
          continue;
        }
        let end = x;
        while (end < W && mask[row + end] === 1) end++;
        const len = end - x;
        for (let i = x; i < end; i++) out[row + i] = len;
        x = end;
      }
    }
  } else {
    for (let x = 0; x < W; x++) {
      let y = 0;
      while (y < H) {
        if (mask[y * W + x] !== 1) {
          y++;
          continue;
        }
        let end = y;
        while (end < H && mask[end * W + x] === 1) end++;
        const len = end - y;
        for (let i = y; i < end; i++) out[i * W + x] = len;
        y = end;
      }
    }
  }
  return out;
}

/**
 * Remove long straight runs of foreground, but ONLY where they are also thin.
 * The rounded panel frames are long 4-6px lines, so they go. A rocket body is
 * a long run that is ~100px thick, so it stays — stripping every long run
 * indiscriminately deletes tall sprites (rockets, probes, loot chests).
 */
function stripFrameLines(mask, W, H, opts) {
  const minH = Math.max(24, Math.round(opts.frameRunH * W));
  const minV = Math.max(24, Math.round(opts.frameRunV * H));
  const thin = opts.frameThin;
  const hrun = runLengths(mask, W, H, 'x');
  const vrun = runLengths(mask, W, H, 'y');
  let removed = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== 1) continue;
    if ((hrun[i] >= minH && vrun[i] <= thin) || (vrun[i] >= minV && hrun[i] <= thin)) {
      mask[i] = 0;
      removed++;
    }
  }
  return removed;
}

/**
 * Remove isolated specks. JPEG ringing pushes a few percent of the light-grey
 * panel fill under the background threshold; left alone, those pixels bridge
 * every gutter and the segmentation collapses into one giant blob.
 */
function despeckle(mask, W, H, minNeighbors) {
  const out = mask.slice();
  let removed = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (mask[i] !== 1) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          if (mask[yy * W + xx] === 1) n++;
        }
      }
      if (n < minNeighbors) {
        out[i] = 0;
        removed++;
      }
    }
  }
  return { mask: out, removed };
}

// ---------------------------------------------------------------------------
// 2. connected components
// ---------------------------------------------------------------------------

function connectedComponents(mask, W, H) {
  const labels = new Int32Array(W * H).fill(-1);
  const blobs = [];
  const stack = new Int32Array(W * H);

  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== 1 || labels[start] !== -1) continue;
    const id = blobs.length;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = id;

    let minX = W;
    let minY = H;
    let maxX = 0;
    let maxY = 0;
    let area = 0;
    let satSum = 0;

    while (sp > 0) {
      const idx = stack[--sp];
      const x = idx % W;
      const y = (idx / W) | 0;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      // 4-connected: keeps visually separate icons from fusing through corners
      if (x > 0 && mask[idx - 1] === 1 && labels[idx - 1] === -1) {
        labels[idx - 1] = id;
        stack[sp++] = idx - 1;
      }
      if (x < W - 1 && mask[idx + 1] === 1 && labels[idx + 1] === -1) {
        labels[idx + 1] = id;
        stack[sp++] = idx + 1;
      }
      if (y > 0 && mask[idx - W] === 1 && labels[idx - W] === -1) {
        labels[idx - W] = id;
        stack[sp++] = idx - W;
      }
      if (y < H - 1 && mask[idx + W] === 1 && labels[idx + W] === -1) {
        labels[idx + W] = id;
        stack[sp++] = idx + W;
      }
    }

    blobs.push({
      id,
      x: minX,
      y: minY,
      w: maxX - minX + 1,
      h: maxY - minY + 1,
      area,
      satSum,
    });
  }
  return { blobs, labels };
}

// ---------------------------------------------------------------------------
// 3. furniture classification (what must be erased before segmenting)
// ---------------------------------------------------------------------------

function meanSaturation(rgba, W, box) {
  let sum = 0;
  let count = 0;
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      const p = (y * W + x) * 4;
      const r = rgba[p];
      const g = rgba[p + 1];
      const b = rgba[p + 2];
      const max = Math.max(r, g, b);
      if (max === 0) continue;
      const min = Math.min(r, g, b);
      sum += (max - min) / max;
      count++;
    }
  }
  return count ? sum / count : 0;
}

/**
 * Decide whether a connected component is a sprite or furniture.
 * `saturationOf` is lazy: it is expensive and only needed for short blobs.
 *   tiny  - speck (also covers anti-aliasing slivers)
 *   frame - big and nearly empty inside its own box (outline, blank panel)
 *   bar   - solid and extremely elongated (progress bar)
 *   text  - short, desaturated and sparse (caption glyph, panel title)
 */
function classifyBlob(blob, opts, saturationOf) {
  if (blob.w < opts.minSize || blob.h < opts.minSize) return 'tiny';

  const fill = blob.area / (blob.w * blob.h);
  const maxDim = Math.max(blob.w, blob.h);
  if (maxDim >= opts.frameMinDim && fill < opts.frameMaxFill) return 'frame';

  const aspect = Math.max(blob.w / blob.h, blob.h / blob.w);
  if (aspect >= opts.barMaxAspect && fill > opts.barMinFill) return 'bar';

  if (blob.h <= opts.textMaxH && blob.w <= opts.textMaxH * 14 && fill <= opts.textMaxFill) {
    if (saturationOf() <= opts.textMaxSat) return 'text';
  }
  return null;
}

/** Erase every pixel belonging to the given blob ids. */
function eraseBlobs(mask, labels, ids) {
  if (!ids.size) return;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 1 && ids.has(labels[i])) mask[i] = 0;
  }
}

// ---------------------------------------------------------------------------
// 4. XY-cut segmentation (recursive gutter split)
// ---------------------------------------------------------------------------

function profileCounts(mask, W, region, axis) {
  const { x, y, w, h } = region;
  if (axis === 'row') {
    const counts = new Int32Array(h);
    for (let yy = 0; yy < h; yy++) {
      const base = (y + yy) * W + x;
      let n = 0;
      for (let xx = 0; xx < w; xx++) if (mask[base + xx] === 1) n++;
      counts[yy] = n;
    }
    return counts;
  }
  const counts = new Int32Array(w);
  for (let xx = 0; xx < w; xx++) {
    let n = 0;
    for (let yy = 0; yy < h; yy++) if (mask[(y + yy) * W + x + xx] === 1) n++;
    counts[xx] = n;
  }
  return counts;
}

/** Content blocks = stretches of non-zero counts, split on gutters >= minGap. */
function contentBlocks(counts, minGap) {
  const blocks = [];
  let run = 0;
  let start = -1;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > 0) {
      if (start < 0) start = i;
      run = 0;
    } else {
      run++;
      if (start >= 0 && run >= minGap) {
        blocks.push({ start, end: i - run + 1 });
        start = -1;
      }
    }
  }
  if (start >= 0) blocks.push({ start, end: counts.length });
  return blocks.filter((b) => b.end > b.start);
}

function tightBox(mask, W, region) {
  const { x, y, w, h } = region;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  for (let yy = 0; yy < h; yy++) {
    const base = (y + yy) * W + x;
    for (let xx = 0; xx < w; xx++) {
      if (mask[base + xx] !== 1) continue;
      const ax = x + xx;
      const ay = y + yy;
      if (ax < minX) minX = ax;
      if (ax > maxX) maxX = ax;
      if (ay < minY) minY = ay;
      if (ay > maxY) maxY = ay;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Overall bounding box of a list of boxes (used to calibrate a name grid). */
function boundsOf(boxes) {
  if (!boxes.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Recursive XY-cut. Rows are tried before columns so the DFS visit order is
 * row-major — that is the order the hand-written name list expects.
 */
function xyCut(mask, W, region, opts, out, depth = 0) {
  if (region.w <= 2 || region.h <= 2 || depth > 40) {
    const box = tightBox(mask, W, region);
    if (box) out.push(box);
    return;
  }

  const rowSegs = contentBlocks(profileCounts(mask, W, region, 'row'), opts.minGutterRow);
  if (rowSegs.length > 1) {
    for (const seg of rowSegs) {
      xyCut(mask, W, { x: region.x, y: region.y + seg.start, w: region.w, h: seg.end - seg.start }, opts, out, depth + 1);
    }
    return;
  }

  const colSegs = contentBlocks(profileCounts(mask, W, region, 'col'), opts.minGutterCol);
  if (colSegs.length > 1) {
    for (const seg of colSegs) {
      xyCut(mask, W, { x: region.x + seg.start, y: region.y, w: seg.end - seg.start, h: region.h }, opts, out, depth + 1);
    }
    return;
  }

  const box = tightBox(mask, W, region);
  if (box) out.push(box);
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 5. alpha extraction (white -> transparent, de-fringed, hole-safe)
// ---------------------------------------------------------------------------

/** Median colour of the crop's 2px border ring = the local background. */
function estimateBackground(rgba, W, H, box) {
  const rs = [];
  const gs = [];
  const bs = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const p = (y * W + x) * 4;
    rs.push(rgba[p]);
    gs.push(rgba[p + 1]);
    bs.push(rgba[p + 2]);
  };
  for (let d = 0; d < 2; d++) {
    for (let x = box.x - d; x < box.x + box.w + d; x++) {
      push(x, box.y - d);
      push(x, box.y + box.h - 1 + d);
    }
    for (let y = box.y - d; y < box.y + box.h + d; y++) {
      push(box.x - d, y);
      push(box.x + box.w - 1 + d, y);
    }
  }
  const med = (arr) => {
    if (!arr.length) return 255;
    const s = [...arr].sort((a, b) => a - b);
    return s[(s.length - 1) >> 1];
  };
  return { r: med(rs), g: med(gs), b: med(bs) };
}

/**
 * Crop `box` out of the sheet and return RGBA with a proper alpha channel.
 */
function cutOut(rgba, W, H, box, opts) {
  const bg = estimateBackground(rgba, W, H, box);
  const cw = box.w;
  const ch = box.h;
  const out = Buffer.alloc(cw * ch * 4);
  const alpha = new Uint8Array(cw * ch);
  const lo = opts.alphaLo;
  const hi = opts.alphaHi;
  const span = Math.max(1, hi - lo);

  for (let y = 0; y < ch; y++) {
    const sy = box.y + y;
    for (let x = 0; x < cw; x++) {
      const sx = box.x + x;
      const sp = (sy * W + sx) * 4;
      const dp = (y * cw + x) * 4;

      const r = rgba[sp];
      const g = rgba[sp + 1];
      const b = rgba[sp + 2];

      // Chebyshev distance from the local background: cheap + hue agnostic
      const d = Math.max(
        Math.abs(r - bg.r),
        Math.abs(g - bg.g),
        Math.abs(b - bg.b),
      );

      let a;
      if (d <= lo) a = 0;
      else if (d >= hi) a = 255;
      else a = Math.round((255 * (d - lo)) / span);

      let or = r;
      let og = g;
      let ob = b;

      if (a > 0 && a < 255 && opts.defringe) {
        // un-matte: recover the pure colour from blend = c*alpha + bg*(1-alpha)
        const k = 255 / a;
        or = clamp(Math.round(bg.r + (r - bg.r) * k), 0, 255);
        og = clamp(Math.round(bg.g + (g - bg.g) * k), 0, 255);
        ob = clamp(Math.round(bg.b + (b - bg.b) * k), 0, 255);
      }

      out[dp] = or;
      out[dp + 1] = og;
      out[dp + 2] = ob;
      out[dp + 3] = a;
      alpha[y * cw + x] = a;
    }
  }

  // Flood-fill transparent pixels reachable from the border. Anything left
  // transparent is ENCLOSED, i.e. genuinely part of the sprite (white rocket
  // body, visor highlight) and must stay opaque.
  const stack = new Int32Array(cw * ch);
  let sp = 0;
  const seen = new Uint8Array(cw * ch);
  const pushIf = (idx) => {
    if (idx < 0 || idx >= cw * ch) return;
    if (seen[idx] || alpha[idx] !== 0) return;
    seen[idx] = 1;
    stack[sp++] = idx;
  };
  for (let x = 0; x < cw; x++) {
    pushIf(x);
    pushIf((ch - 1) * cw + x);
  }
  for (let y = 0; y < ch; y++) {
    pushIf(y * cw);
    pushIf(y * cw + cw - 1);
  }
  const outside = new Uint8Array(cw * ch);
  while (sp > 0) {
    const idx = stack[--sp];
    outside[idx] = 1;
    const x = idx % cw;
    if (x > 0) pushIf(idx - 1);
    if (x < cw - 1) pushIf(idx + 1);
    if (idx >= cw) pushIf(idx - cw);
    if (idx < cw * (ch - 1)) pushIf(idx + cw);
  }
  for (let i = 0; i < cw * ch; i++) {
    if (alpha[i] === 0 && !outside[i]) out[i * 4 + 3] = 255;
  }

  return { data: out, width: cw, height: ch };
}

/** Trim fully transparent margins down to the visible content. */
function trimAlpha(data, w, h) {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 4) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

// ---------------------------------------------------------------------------
// 6. preview (labelled proof sheet)
// ---------------------------------------------------------------------------

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&apos;',
  })[c]);
}

/** Source sheet, downscaled, with every detected box outlined and labelled. */
async function writeOverlay(sheetPath, items, outFile, numbers = false) {
  const meta = await sharp(sheetPath).metadata();
  const maxW = 1800;
  const scale = Math.min(1, maxW / meta.width);
  const w = Math.round(meta.width * scale);
  const h = Math.round(meta.height * scale);
  const base = await sharp(sheetPath).resize(w, h).modulate({ brightness: 1.06 }).toBuffer();

  const parts = [];
  items.forEach((it, i) => {
    const x = it.box.x * scale;
    const y = it.box.y * scale;
    const bw = it.box.w * scale;
    const bh = it.box.h * scale;
    const color = it.kind === 'manual' ? '#ff9f1c' : '#00e5ff';
    parts.push(
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="none" stroke="${color}" stroke-width="2"/>`,
    );
    // --numbers keeps the label to just #index so a crowded sheet stays
    // readable while names are being written down in sheets.json
    const label = numbers ? `#${i + 1}` : escapeXml(it.name);
    const fs = numbers ? 20 : clamp(Math.round(Math.min(bw, bh) * 0.34), 11, 26);
    const tw = label.length * fs * (numbers ? 0.7 : 0.56) + 8;
    const lx = clamp(x, 0, Math.max(0, w - tw));
    const ly = y - fs - 6 < 0 ? y + bh + 4 : y - 6;
    parts.push(
      `<rect x="${lx.toFixed(1)}" y="${(ly - fs).toFixed(1)}" width="${tw.toFixed(1)}" height="${(fs + 5).toFixed(1)}" fill="#000" fill-opacity="0.8" rx="3"/>` +
        `<text x="${(lx + 4).toFixed(1)}" y="${(ly - 3).toFixed(1)}" font-family="Segoe UI, Arial, sans-serif" font-size="${fs}" fill="#fff">${label}</text>`,
    );
  });

  const overlay = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${parts.join('')}</svg>`,
  );
  await sharp(base)
    .composite([{ input: overlay, top: 0, left: 0 }])
    .png()
    .toFile(outFile);
  return { w, h };
}

function writePreviewHtml(sheetsReport) {
  const rows = sheetsReport
    .map(
      (s) => `
  <section class="sheet">
    <h2>${escapeXml(s.title || s.id)} <span class="muted">— ${escapeXml(path.basename(s.file))} · ${s.items.length} assets</span></h2>
    <a class="overlay" href="${escapeXml(path.basename(s.overlay))}" target="_blank">
      <img src="${escapeXml(path.basename(s.overlay))}" alt="${escapeXml(s.id)} detected regions" loading="lazy">
    </a>
    <div class="grid">
      ${s.items
        .map(
          (it) => `<figure class="cell">
        <div class="thumb"><img src="../${escapeXml(it.file)}" alt="${escapeXml(it.name)}" loading="lazy"></div>
        <figcaption><code>${escapeXml(it.name)}</code><span class="muted">${it.w}×${it.h}</span></figcaption>
      </figure>`,
        )
        .join('\n      ')}
    </div>
  </section>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rocket sprites — extraction proof sheet</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 28px; background:#111318; color:#e8eaf0;
         font: 14px/1.5 "Segoe UI", Arial, sans-serif; }
  h1 { margin:0 0 6px; font-size: 24px; }
  h2 { margin:0 0 12px; font-size: 16px; font-weight:600; }
  .muted { color:#8b93a7; font-weight:400; }
  .sheet { margin: 0 0 44px; padding: 20px; background:#191c23; border:1px solid #262a34; border-radius:12px; }
  .overlay { display:block; margin-bottom:16px; }
  .overlay img { max-width:100%; height:auto; border-radius:8px; border:1px solid #2c313c; }
  .grid { display:grid; gap:12px; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); }
  .cell { margin:0; background:#12141a; border:1px solid #262a34; border-radius:10px; padding:8px; }
  .thumb { height:104px; display:flex; align-items:center; justify-content:center;
           border-radius:6px; margin-bottom:6px;
           background-color:#20242e;
           background-image:
             linear-gradient(45deg,#2b3040 25%,transparent 25%,transparent 75%,#2b3040 75%),
             linear-gradient(45deg,#2b3040 25%,transparent 25%,transparent 75%,#2b3040 75%);
           background-size:16px 16px; background-position:0 0,8px 8px; }
  .thumb img { max-width:100%; max-height:96px; image-rendering:auto; }
  figcaption { display:flex; justify-content:space-between; gap:6px; align-items:baseline; }
  code { font-size:11.5px; color:#9fd7ff; word-break:break-all; }
  figcaption .muted { font-size:10.5px; white-space:nowrap; }
</style>
</head>
<body>
  <h1>Rocket sprite extraction</h1>
  <p class="muted">Each box below is one cropped, de-fringed PNG. Cyan = auto-detected, orange = hand-placed region.
  Checkerboard shows transparency. Rename anything wrong in <code>scripts/rocket/sheets.json</code> and re-run.</p>
${rows}
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// 7. main
// ---------------------------------------------------------------------------

async function processSheet(spec, defaults, args, detectedOut) {
  const sheetPath = path.join(SRC_DIR, spec.file);
  if (!fs.existsSync(sheetPath)) throw new Error(`missing sheet: ${spec.file}`);

  const opts = { ...BASE_OPTS, ...defaults, ...(spec.options || {}) };
  const { data: rgba, info } = await sharp(sheetPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;

  const mask = buildMask(rgba, W, H, opts);
  const { mask: work, removed: speckPx } = despeckle(mask, W, H, opts.despeckleMin);

  // Classify components and ERASE the furniture. Order matters: a panel
  // outline has to be judged as a WHOLE outline. If its long straight edges
  // are stripped first, all that is left of a blank panel is four corner arcs
  // — which look exactly like four small sprites.
  const { blobs, labels } = connectedComponents(work, W, H);
  const erase = new Set();
  const dropped = { tiny: 0, frame: 0, bar: 0, text: 0, excluded: 0 };
  for (const b of blobs) {
    const kind = classifyBlob(b, opts, () => meanSaturation(rgba, W, b));
    if (!kind) continue;
    dropped[kind]++;
    erase.add(b.id);
  }
  eraseBlobs(work, labels, erase);

  // Safety net for any long thin line the blob pass did not judge as furniture.
  const linePx = stripFrameLines(work, W, H, opts);

  if (args.debugMask) {
    const png = Buffer.alloc(W * H);
    for (let i = 0; i < work.length; i++) png[i] = work[i] ? 255 : 0;
    await sharp(png, { raw: { width: W, height: H, channels: 1 } })
      .png()
      .toFile(path.join(PREVIEW_DIR, `${spec.id}-mask.png`));
  }

  const excludePx = (spec.exclude || []).map((r) => resolveRect(r, W, H));

  const leaves = [];
  xyCut(work, W, { x: 0, y: 0, w: W, h: H }, opts, leaves);

  const kept = [];
  for (const leaf of leaves) {
    if (excludePx.some((r) => pointInRect(leaf.x + leaf.w / 2, leaf.y + leaf.h / 2, r))) {
      dropped.excluded++;
      continue;
    }
    if (leaf.w < opts.minSize || leaf.h < opts.minSize) {
      dropped.tiny++;
      continue;
    }
    // a leaf that is almost the whole sheet means the cut never found a gutter
    if (leaf.w > W * 0.9 && leaf.h > H * 0.9) {
      dropped.frame++;
      continue;
    }
    kept.push(leaf);
  }

  // hand-placed regions for content the detector cannot judge by itself
  // (grey rating stars look exactly like caption glyphs, so they get erased)
  const manual = (spec.regions || []).map((r) => ({
    name: r.name,
    kind: 'manual',
    box: resolveRect(r, W, H),
  }));

  const items = [];

  if (spec.gridNames) {
    // Position-based naming for the regular r x c sheets. Matching by cell
    // centre (instead of by detection order) keeps every name attached to the
    // right sprite even if one cell merges two items or one item is missed.
    const g = spec.gridNames;
    const region = g.w
      ? resolveRect({ x: g.x || 0, y: g.y || 0, w: g.w, h: g.h, unit: g.unit }, W, H)
      : boundsOf(kept);
    if (!region) {
      console.log(`${C.yellow}  ! ${spec.id}: gridNames given but nothing was detected${C.reset}`);
    } else {
      const cellW = region.w / g.cols;
      const cellH = region.h / g.rows;
      const cells = new Map();
      const extra = [];
      for (const leaf of kept) {
        const col = Math.floor((leaf.x + leaf.w / 2 - region.x) / cellW);
        const row = Math.floor((leaf.y + leaf.h / 2 - region.y) / cellH);
        if (row < 0 || col < 0 || row >= g.rows || col >= g.cols) {
          extra.push(leaf);
          continue;
        }
        const key = `${row},${col}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(leaf);
      }

      let missing = 0;
      let shared = 0;
      const names = g.names || [];
      for (let r = 0; r < g.rows; r++) {
        for (let c = 0; c < g.cols; c++) {
          const list = cells.get(`${r},${c}`) || [];
          const base = sanitizeName(names[r * g.cols + c] || `${spec.id}-r${r + 1}c${c + 1}`);
          if (!list.length) {
            missing++;
            continue;
          }
          if (list.length > 1) {
            shared++;
            // the biggest blob keeps the cell name; the rest are suffixed
            list.sort((a, b) => b.w * b.h - a.w * a.h);
            list.forEach((leaf, i) => {
              items.push({ name: i ? `${base}-${i + 1}` : base, kind: 'auto', box: leaf });
            });
          } else {
            items.push({ name: base, kind: 'auto', box: list[0] });
          }
        }
      }
      extra.forEach((leaf, i) => {
        items.push({ name: `${spec.id}-extra-${String(i + 1).padStart(2, '0')}`, kind: 'auto', box: leaf });
      });
      if (missing || shared || extra.length) {
        console.log(
          `${C.yellow}  ! ${spec.id}: grid ${g.rows}×${g.cols} — ${missing} empty cell(s), ${shared} shared cell(s), ${extra.length} outside${C.reset}`,
        );
      }
    }
  } else {
    const names = spec.names || [];
    if (kept.length !== names.length) {
      console.log(
        `${C.yellow}  ! ${spec.id}: ${kept.length} detected vs ${names.length} name(s) in sheets.json${C.reset}`,
      );
    }
    kept.forEach((leaf, i) => {
      items.push({
        name: sanitizeName(names[i] || `${spec.id}-unnamed-${String(i + 1).padStart(2, '0')}`),
        kind: 'auto',
        box: leaf,
      });
    });
  }

  manual.forEach((m) => items.push({ name: sanitizeName(m.name), kind: 'manual', box: m.box }));

  // De-duplicate names BEFORE writing files, so a filename always matches the
  // manifest entry (never rename after the PNG is on disk).
  const seenNames = new Set();
  const dupeNames = new Set();
  for (const it of items) {
    if (!seenNames.has(it.name)) {
      seenNames.add(it.name);
      continue;
    }
    dupeNames.add(it.name);
    let n = 2;
    while (seenNames.has(`${it.name}-${n}`)) n++;
    it.name = `${it.name}-${n}`;
    seenNames.add(it.name);
  }
  if (dupeNames.size) {
    console.log(`${C.yellow}  ! ${spec.id}: duplicate names auto-suffixed: ${[...dupeNames].join(', ')}${C.reset}`);
  }

  const exportItems = [];
  for (const it of items) {
    const pad = it.kind === 'manual' ? opts.regionPad : opts.pad;
    const box = {
      x: clamp(it.box.x - pad, 0, W - 1),
      y: clamp(it.box.y - pad, 0, H - 1),
      w: clamp(it.box.w + pad * 2, 1, W),
      h: clamp(it.box.h + pad * 2, 1, H),
    };
    box.w = Math.min(box.w, W - box.x);
    box.h = Math.min(box.h, H - box.y);

    const cut = cutOut(rgba, W, H, box, opts);
    const trim = trimAlpha(cut.data, cut.width, cut.height);
    if (!trim) continue;

    let img = sharp(cut.data, {
      raw: { width: cut.width, height: cut.height, channels: 4 },
    }).extract(trim);

    let outW = trim.width;
    let outH = trim.height;
    const longest = Math.max(outW, outH);
    if (longest > opts.maxDim) {
      const k = opts.maxDim / longest;
      outW = Math.max(1, Math.round(outW * k));
      outH = Math.max(1, Math.round(outH * k));
      img = img.resize(outW, outH, { fit: 'fill', kernel: 'lanczos3' });
    }
    if (outW < opts.minExport && outH < opts.minExport) continue;

    const file = `${it.name}.png`;
    await img.png(opts.png).toFile(path.join(OUT_DIR, file));
    exportItems.push({
      name: it.name,
      file,
      sheet: spec.id,
      kind: it.kind,
      w: outW,
      h: outH,
      source: { x: box.x, y: box.y, w: box.w, h: box.h },
      box, // not written to the manifest; kept for the proof-sheet overlay
    });
  }

  console.log(
    `${C.green}  ✓ ${spec.id}${C.reset} ${C.dim}(${W}×${H})${C.reset}  ` +
      `${C.bold}${exportItems.length}${C.reset} assets  ` +
      `${C.dim}erased: ${dropped.tiny} tiny, ${dropped.frame} frame, ${dropped.bar} bar, ${dropped.text} text, ${dropped.excluded} excluded` +
      `${linePx || speckPx ? ` · ${linePx.toLocaleString()} line px, ${speckPx.toLocaleString()} speck px` : ''}${C.reset}`,
  );

  if (detectedOut) {
    detectedOut.push({
      id: spec.id,
      w: W,
      h: H,
      count: exportItems.length,
      detected: exportItems.map((e, i) => ({
        i: i + 1,
        name: e.name,
        x: e.box.x,
        y: e.box.y,
        w: e.box.w,
        h: e.box.h,
      })),
    });
  }

  return {
    id: spec.id,
    title: spec.title,
    file: sheetPath,
    sheetW: W,
    sheetH: H,
    overlay: `${spec.id}-regions.png`,
    items: exportItems,
  };
}

async function main() {
  const args = {
    sheet: null,
    preview: true,
    debugMask: false,
    dumpDetected: false,
    numbers: false,
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sheet') args.sheet = argv[++i];
    else if (a === '--no-preview') args.preview = false;
    else if (a === '--debug-mask') args.debugMask = true;
    else if (a === '--dump-detected') args.dumpDetected = true;
    else if (a === '--numbers') args.numbers = true;
    else if (a === '--help' || a === '-h') {
      console.log(
        'usage: node scripts/rocket/extract-sprites.js [--sheet <id>] [--no-preview] [--debug-mask] [--dump-detected] [--numbers]',
      );
      return;
    }
  }

  if (!fs.existsSync(SPEC_PATH)) throw new Error(`missing spec: ${SPEC_PATH}`);
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));
  const defaults = spec.defaults || {};

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(PREVIEW_DIR, { recursive: true });

  const sheets = spec.sheets.filter((s) => !args.sheet || s.id === args.sheet);
  if (!sheets.length) throw new Error(`no sheet matches --sheet ${args.sheet}`);

  console.log(`${C.cyan}Rocket sprite extraction${C.reset} ${C.dim}(${sheets.length} sheet(s))${C.reset}`);

  const detected = args.dumpDetected ? [] : null;
  const report = [];
  for (const s of sheets) report.push(await processSheet(s, defaults, args, detected));

  if (detected) {
    const p = path.join(__dirname, 'detected.json');
    fs.writeFileSync(p, `${JSON.stringify(detected, null, 2)}\n`, 'utf8');
    console.log(`${C.dim}  detected: ${path.relative(ROOT, p)}${C.reset}`);
  }

  // ---- manifest ----------------------------------------------------------
  const manifestPath = path.join(OUT_DIR, 'manifest.json');
  const prevManifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : { assets: [] };
  const untouched = (prevManifest.assets || []).filter(
    (a) => !sheets.some((s) => s.id === a.sheet),
  );
  const assets = [...untouched, ...report.flatMap((r) => r.items)]
    .sort((a, b) => `${a.sheet}/${a.name}`.localeCompare(`${b.sheet}/${b.name}`))
    .map(({ box, ...rest }) => rest);
  const manifest = {
    generatedAt: new Date().toISOString(),
    note: 'Generated by scripts/rocket/extract-sprites.js — do not edit by hand.',
    counts: {
      assets: assets.length,
      sheets: new Set(assets.map((a) => a.sheet)).size,
    },
    sheets: [...new Set(assets.map((a) => a.sheet))].map((id) => {
      const meta = spec.sheets.find((s) => s.id === id);
      return { id, title: meta?.title || id, file: meta?.file };
    }),
    assets,
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`${C.dim}  manifest: ${path.relative(ROOT, manifestPath)} (${assets.length} assets)${C.reset}`);

  // ---- prune stale exports ----------------------------------------------
  // Renaming an asset in sheets.json leaves the old PNG behind, which would
  // otherwise accumulate and ship to production.
  const expected = new Set(assets.map((a) => a.file));
  let pruned = 0;
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (!f.endsWith('.png') || expected.has(f)) continue;
    fs.unlinkSync(path.join(OUT_DIR, f));
    pruned++;
  }
  if (pruned) console.log(`${C.dim}  pruned ${pruned} stale PNG(s)${C.reset}`);

  // ---- preview -----------------------------------------------------------
  if (args.preview) {
    for (const r of report) {
      await writeOverlay(r.file, r.items, path.join(PREVIEW_DIR, r.overlay), args.numbers);
    }
    fs.writeFileSync(path.join(PREVIEW_DIR, 'index.html'), writePreviewHtml(report), 'utf8');
    console.log(`${C.dim}  proof sheet: ${path.relative(ROOT, path.join(PREVIEW_DIR, 'index.html'))}${C.reset}`);
  }
}

main().catch((e) => {
  console.error(`${C.red}${e.stack || e.message}${C.reset}`);
  process.exit(1);
});
