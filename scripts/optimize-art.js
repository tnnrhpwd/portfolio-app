#!/usr/bin/env node
/**
 * optimize-art.js — shrink the site's artwork to the size it is actually
 * displayed at.
 *
 * WHY THIS EXISTS
 * ---------------
 * The /projects grid renders each card at roughly 270x202 CSS px (~540x404 at
 * 2x DPR), but several `frontend/src/assets/art/*.jpg` files shipped at
 * 2400x1792 — about 20x the pixels the layout needs. Combined with a 3168x1344
 * hero, that made a first visit to /projects cost ~18.8 MB, of which ~11 MB was
 * needed just to fill the first two rows (roughly a minute on a 1.5 Mbps
 * connection). None of that is a caching bug: Netlify already serves
 * /assets/* as `immutable` and `frontend/public/sw.js` caches same-origin
 * assets cache-first, so *repeat* visits were always fast. Only first visits
 * paid, and the fix is to send fewer bytes.
 *
 * The drift has a root cause worth knowing: `backend/scripts/generate-project-art.js`
 * and `generate-simple-art.js` both write FULL-RESOLUTION PNGs into the tracked
 * art folder, and docs/guides/FRONTEND_UI_STANDARD.md §5 tells you to convert
 * them to `.jpg` — without ever mentioning a resize. Re-running either
 * generator re-introduces oversized art. So the rule this script enforces is:
 * cap the long edge, then encode.
 *
 * USAGE
 * -----
 *   node scripts/optimize-art.js                     # dry run (default) — report only
 *   node scripts/optimize-art.js --apply             # actually rewrite files
 *   node scripts/optimize-art.js --apply --max 1200 --quality 82
 *   node scripts/optimize-art.js --apply --only "project-,hero"   # scope by filename
 *   node scripts/optimize-art.js --dir frontend/public/coliseum --recursive
 *
 * NOTE: Vite only bundles assets that are actually IMPORTED, so an oversized
 * file under src/assets/ that nothing imports costs you nothing at runtime —
 * only repo weight. Use `--only` to scope a run to what really ships.
 *
 * SAFETY
 * ------
 * - Dry run by default, like the other scripts in this repo (`--apply` to write).
 * - Never upscales: a file already narrower than `--max` keeps its dimensions.
 * - A file is only replaced when the new bytes are SMALLER than the old ones,
 *   so a bad quality setting can never make the site heavier.
 * - Alpha-bearing PNGs are never CONVERTED to JPEG, because that would turn
 *   transparency black — but they can still be resized and recompressed as PNG.
 *   That matters: the site header logo is a 512x512 alpha PNG rendered at 38px
 *   CSS on every page, so it was shipping ~180x the pixels it can display.
 * - Only opaque PNGs are candidates for JPEG conversion.
 * - Every file it touches is git-tracked, so `git checkout -- <path>` is the
 *   undo. Originals are never deleted unless you pass `--prune`.
 * - `--prune` removes the superseded source after a PNG→JPEG conversion, so
 *   only use it AFTER you have updated that file's import.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// `sharp` is a backend dependency and is not hoisted to the root node_modules
// (same resolution the other asset scripts in this repo use).
const sharp = require(path.join(ROOT, 'backend', 'node_modules', 'sharp'));

const DEFAULT_DIR = path.join(ROOT, 'frontend', 'src', 'assets', 'art');

/** Long-edge cap. 1200px covers a 270px card at 3x DPR with headroom to spare. */
const DEFAULT_MAX = 1200;
/** mozjpeg q82 is visually indistinguishable from q90 at this display size. */
const DEFAULT_QUALITY = 82;
/** Below this size a file is left alone unless its dimensions are still over. */
const MIN_BYTES = 100 * 1024;

/**
 * Per-file long-edge overrides, keyed by filename WITHOUT its extension (so an
 * override survives the PNG→JPEG rename), for art displayed larger than a card.
 *
 * - The hero is a full-bleed background, so it legitimately wants more than a
 *   card — but nowhere near its original 3168px, especially since the page renders
 *   it at `opacity: 0.3` behind a scrim, where it reads as texture, not a subject.
 * - `feature-*` are the homepage's alternating media rows: a 2-column grid inside
 *   a 1080px wrap, which collapses to ONE full-width column under 768px. That
 *   makes the media as wide as the viewport on a tablet, so it needs ~2x the
 *   headroom of a card even though it looks similar.
 * - `about-*-art` are `.about-media-banner` frames: `width: 100%` of the page wrap
 *   at `aspect-ratio: 16 / 7`, so a ~1080px-wide render. At 1344px wide the source
 *   is ALREADY only 1.24x the display width, so downscaling would soften an image
 *   that has no resolution to spare — re-encode at native size and take the win
 *   from PNG→JPEG instead (2048 KB → ~280 KB with zero dimension loss).
 * - The Coliseum rasters are drawn `cover` across the whole Phaser canvas, so they
 *   must not be softened below the canvas' own resolution.
 * - `brand-mark` is the default-avatar face, rendered inside a frame that tops out at
 *   2.2x `--nav-size`. It is written at its final size by
 *   `scripts/generate-logo-assets.js`, so this entry exists to keep this script's
 *   hands off it — re-encoding it here would only cost the alpha channel it needs.
 */
const MAX_OVERRIDES = {
  hero: 1920,
  'Hero banner': 1920,
  'feature-games': 1600,
  'feature-engineering': 1600,
  'feature-productivity': 1600,
  'feature-surprises': 1600,
  'about-factory-art': 1344,
  'about-ascent-art': 1344,
  'brand-mark': 256,
  'map-background': 1920,
  'arena-background': 1920,
};

function parseArgs(argv) {
  const opts = {
    apply: false,
    prune: false,
    max: DEFAULT_MAX,
    quality: DEFAULT_QUALITY,
    dir: DEFAULT_DIR,
    recursive: false,
    only: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') opts.apply = true;
    else if (arg === '--prune') opts.prune = true;
    else if (arg === '--recursive') opts.recursive = true;
    else if (arg === '--max') opts.max = Number(argv[++i]);
    else if (arg === '--quality') opts.quality = Number(argv[++i]);
    else if (arg === '--dir') opts.dir = path.resolve(argv[++i]);
    else if (arg === '--only') opts.only = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*\*?/, '').trim());
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg} (try --help)`);
      process.exit(1);
    }
  }
  if (opts.prune && !opts.apply) {
    console.error('--prune only makes sense together with --apply');
    process.exit(1);
  }
  if (!Number.isFinite(opts.max) || opts.max < 64) {
    console.error(`--max must be a number >= 64 (got ${opts.max})`);
    process.exit(1);
  }
  if (!Number.isFinite(opts.quality) || opts.quality < 1 || opts.quality > 100) {
    console.error(`--quality must be 1-100 (got ${opts.quality})`);
    process.exit(1);
  }
  return opts;
}

/** Every image file directly in `dir` (plus subfolders when `recursive`). */
function collectFiles(dir, recursive) {
  if (!fs.existsSync(dir)) {
    console.error(`Directory not found: ${dir}`);
    process.exit(1);
  }
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) out.push(...collectFiles(full, recursive));
      continue;
    }
    if (/\.(jpe?g|png)$/i.test(entry.name)) out.push(full);
  }
  return out.sort();
}

/** Target dimensions: fit inside a `max` square, never enlarging. */
function fitWithin(width, height, max) {
  const longEdge = Math.max(width, height);
  if (longEdge <= max) return { width, height, changed: false };
  const scale = max / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    changed: true,
  };
}

function kb(bytes) {
  return `${Math.round(bytes / 1024)} KB`;
}

async function optimizeOne(file, opts) {
  const name = path.basename(file);
  const stem = path.basename(file, path.extname(file));
  const original = fs.readFileSync(file);
  const meta = await sharp(original).metadata();
  const { width, height, format, hasAlpha } = meta;

  if (!width || !height) {
    return { name, action: 'skipped', note: 'unreadable dimensions' };
  }

  // An alpha channel means this is a graphic, not a photo: JPEG would flatten it
  // to black, so the format conversion is off the table for these. They can still
  // be RESIZED and recompressed as PNG.
  const alphaPng = format === 'png' && hasAlpha;

  const max = MAX_OVERRIDES[stem] || opts.max;
  const target = fitWithin(width, height, max);
  const overSized = original.length > MIN_BYTES;

  if (!target.changed && !overSized) {
    return {
      name,
      action: 'skipped',
      note: 'already small',
      width,
      height,
      targetWidth: width,
      targetHeight: height,
      before: original.length,
    };
  }

  // PNG sources become JPEG — a photographic 1216x832 PNG is ~1.2 MB, and no
  // amount of PNG recompression gets near what mozjpeg does with the same
  // pixels. This DOES change the filename, so the caller must update the
  // import (the script prints the exact lines to change). Alpha PNGs keep their
  // extension and stay PNG.
  const outExt = format === 'png' && !alphaPng ? '.jpg' : path.extname(file);
  const outFile = path.join(path.dirname(file), `${stem}${outExt}`);

  let pipeline = sharp(original).resize({
    width: target.width,
    height: target.height,
    fit: 'inside',
    withoutEnlargement: true,
  });

  pipeline =
    outExt.toLowerCase() === '.png'
      ? pipeline.png({ compressionLevel: 9, palette: true, quality: 90 })
      : pipeline.jpeg({ quality: opts.quality, mozjpeg: true, progressive: true });

  const next = await pipeline.toBuffer();

  if (next.length >= original.length) {
    return {
      name,
      action: 'skipped',
      note: 're-encode was not smaller',
      width,
      height,
      targetWidth: target.width,
      targetHeight: target.height,
      before: original.length,
      after: next.length,
    };
  }

  if (opts.apply) {
    fs.writeFileSync(outFile, next);
    // Only safe once the corresponding import has been repointed at the new
    // extension, which is why this is explicit rather than automatic.
    if (opts.prune && outFile !== file) fs.unlinkSync(file);
  }

  return {
    name,
    action: outFile === file ? 'rewritten' : 'converted',
    pruned: Boolean(opts.prune && opts.apply && outFile !== file),
    width,
    height,
    targetWidth: target.width,
    targetHeight: target.height,
    before: original.length,
    after: next.length,
    outFile: outFile === file ? null : path.relative(ROOT, outFile),
    srcFile: outFile === file ? null : path.relative(ROOT, file),
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let files = collectFiles(opts.dir, opts.recursive);
  if (opts.only) {
    const needles = opts.only.split(',').map((s) => s.trim()).filter(Boolean);
    files = files.filter((f) => needles.some((n) => path.basename(f).includes(n)));
  }

  if (files.length === 0) {
    console.error(`No images matched in ${opts.dir}`);
    process.exit(1);
  }

  console.log(`\n${opts.apply ? 'OPTIMIZING' : 'DRY RUN — no files will change'}`);
  console.log(`dir: ${path.relative(ROOT, opts.dir)}${opts.recursive ? ' (recursive)' : ''}`);
  console.log(`max long edge: ${opts.max}px   jpeg quality: ${opts.quality}\n`);

  const results = [];
  for (const file of files) {
    results.push(await optimizeOne(file, opts));
  }

  let before = 0;
  let after = 0;
  const conversions = [];

  for (const r of results) {
    if (r.action === 'skipped') {
      console.log(`  ·  ${r.name.padEnd(30)} skipped — ${r.note}`);
      continue;
    }
    before += r.before;
    after += r.after;
    const resized = r.targetWidth && (r.targetWidth !== r.width || r.targetHeight !== r.height);
    const dims = `${r.width}x${r.height}${resized ? ` -> ${r.targetWidth}x${r.targetHeight}` : ''}`;
    const verb = r.outFile ? 'converted' : 'rewritten';
    console.log(
      `  ${verb === 'converted' ? '→' : '✓'}  ${r.name.padEnd(30)} ${dims.padEnd(26)} ${kb(r.before).padStart(9)} -> ${kb(r.after).padStart(8)}`,
    );
    if (r.outFile) conversions.push(r);
  }

  const saved = before - after;
  const pct = before > 0 ? Math.round((saved / before) * 100) : 0;
  console.log(`\n  ${results.filter((r) => r.action !== 'skipped').length} file(s) optimizable`);
  if (before > 0) {
    console.log(`  ${kb(before)} -> ${kb(after)}   (saved ${kb(saved)}, ${pct}%)`);
  }

  for (const c of conversions) {
    if (c.pruned) {
      console.log(`\n  ${c.srcFile}  ->  ${c.outFile}   (${path.basename(c.srcFile)} removed)`);
      continue;
    }
    console.log(`\n  ACTION REQUIRED — the extension changed:`);
    console.log(`    ${c.srcFile}  ->  ${c.outFile}`);
    console.log(`    Update its import, then delete the leftover ${path.basename(c.srcFile)}.`);
    console.log(`    Vite only bundles IMPORTED assets, so the orphan does not ship —`);
    console.log(`    it is just clutter, not extra weight.`);
  }

  if (!opts.apply && before > 0) {
    console.log(`\n  Re-run with --apply to write these changes.\n`);
  } else if (opts.apply && before > 0) {
    console.log(`\n  Done. Rebuild the frontend to pick up the new hashes.\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
