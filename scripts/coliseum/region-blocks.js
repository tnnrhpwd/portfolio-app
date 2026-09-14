#!/usr/bin/env node
/**
 * region-blocks.js — measure the content blocks inside a strip of a sprite sheet.
 *
 * Auto-detection merges neighbouring items when they touch, which produces one wide
 * leaf spanning several sprites (weapons-2 has one spanning x626..1155). This prints
 * the real gutters in a strip so hand-placed `regions` can be authored from
 * measurements instead of eyeballed guesses.
 *
 *   node scripts/coliseum/region-blocks.js <file.png> [--x0 N] [--x1 N]
 *                                        [--y0 N] [--y1 N] [--axis x|y] [--min-gap N]
 *
 * Content = a pixel that is neither transparent nor near-white, matching the
 * extractor's background rule. For every block found along `axis`, the perpendicular
 * extent is reported too, so the output is a ready-to-paste bounding box.
 */
const path = require('path');

/** sharp lives in backend/node_modules (not hoisted to the repo root). */
function loadSharp() {
  const ROOT = path.resolve(__dirname, '..', '..');
  for (const c of [
    path.join(ROOT, 'backend', 'node_modules', 'sharp'),
    path.join(ROOT, 'node_modules', 'sharp'),
  ]) {
    try {
      return require(c);
    } catch {
      /* try next */
    }
  }
  throw new Error('sharp not found. Install it (backend/node_modules) before running.');
}
const sharp = loadSharp();

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : Number(process.argv[i + 1]);
}

function str(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
}

(async () => {
  const file = process.argv[2];
  if (!file) {
    throw new Error(
      'usage: region-blocks.js <file.png> [--x0 N --x1 N --y0 N --y1 N --axis x|y --min-gap N]'
    );
  }

  const { data, info } = await sharp(file)
    .raw()
    .ensureAlpha()
    .toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;

  const x0 = Math.max(0, arg('x0', 0));
  const x1 = Math.min(W, arg('x1', W));
  const y0 = Math.max(0, arg('y0', 0));
  const y1 = Math.min(H, arg('y1', H));
  const axis = str('axis', 'x');
  const minGap = arg('min-gap', 6);

  const isContent = (x, y) => {
    const i = (y * W + x) * 4;
    if (data[i + 3] < 16) return false;
    return !(data[i] > 245 && data[i + 1] > 245 && data[i + 2] > 245);
  };

  const across = axis === 'x' ? [x0, x1] : [y0, y1];
  const n = across[1] - across[0];
  const offset = across[0];
  const counts = new Array(n).fill(0);

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (!isContent(x, y)) continue;
      counts[axis === 'x' ? x - offset : y - offset]++;
    }
  }

  // Split on gutters >= minGap.
  const spans = [];
  let s = -1;
  for (let i = 0; i < n; i++) {
    if (counts[i] > 0) {
      if (s < 0) s = i;
      continue;
    }
    if (s < 0) continue;
    let g = i;
    while (g < n && counts[g] === 0) g++;
    if (g - i >= minGap || g >= n) {
      spans.push([s, i - 1]);
      s = -1;
    }
    i = g - 1;
  }
  if (s >= 0) spans.push([s, n - 1]);

  const label = axis === 'x' ? 'x' : 'y';
  console.log(
    `${file}  ${W}x${H}  axis=${axis}  strip=${label} ${offset}..${offset + n}`
  );

  spans.forEach(([a, b], idx) => {
    // Perpendicular extent, so each line is a full bounding box.
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = a; i <= b; i++) {
      for (let j = 0; j < (axis === 'x' ? y1 - y0 : x1 - x0); j++) {
        const x = axis === 'x' ? i + offset : j + (axis === 'x' ? 0 : x0);
        const y = axis === 'x' ? j + y0 : i + offset;
        if (!isContent(x, y)) continue;
        if (j < lo) lo = j;
        if (j > hi) hi = j;
      }
    }
    const other = axis === 'x' ? y0 : x0;
    const x = axis === 'x' ? a + offset : other + lo;
    const y = axis === 'x' ? other + lo : a + offset;
    const w = axis === 'x' ? b - a + 1 : hi - lo + 1;
    const h = axis === 'x' ? hi - lo + 1 : b - a + 1;
    console.log(
      `  #${String(idx + 1).padStart(2)}  ${label}=${String(a + offset).padStart(4)}..${String(b + offset).padStart(4)}` +
        `  box x=${String(x).padStart(4)} y=${String(y).padStart(4)} w=${String(w).padStart(4)} h=${String(h).padStart(4)}`
    );
  });

  console.log(`  ${spans.length} block(s), min-gap=${minGap}`);
})();
