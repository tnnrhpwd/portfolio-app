/**
 * detected-to-map.js — turn the extractor's `--dump-detected` output into a map
 * you can load into `/uimapper`.
 *
 * Why this exists: the detector reliably finds *where* the items are, but it
 * cannot know *what they are* — and on an AI poster it finds many more variants
 * than you want to keep. Naming them by editing `sheets.json` means reading a
 * numbered overlay and transcribing numbers by hand, which is the slowest and
 * most error-prone part of the pipeline. Loading the same boxes into the mapper
 * lets you see each name sitting on its box and rename it in place.
 *
 * The output is exactly the shape `/uimapper` exports, so it round-trips: load
 * it, rename the boxes, download, and convert back for `sheets.json` (the
 * `x→nx` rename documented in STATIC_ASSETS_AND_IMAGE_GENERATION.md).
 *
 * Usage:
 *   node scripts/coliseum/detected-to-map.js --sheet ui-panel
 *   node scripts/coliseum/detected-to-map.js --sheet ui-panel --out <file>
 *
 * Produce the input first, e.g.:
 *   node scripts/rocket/extract-sprites.js --spec scripts/coliseum/sheets.json \
 *     --sheet ui-panel --out docs/images/coliseum/staging --no-preview --dump-detected
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SPEC_PATH = path.join(__dirname, 'sheets.json');
const DETECTED_PATH = path.join(__dirname, 'detected.json');
const SOURCE_DIR = path.join(ROOT, 'frontend', 'src', 'assets', 'coliseum');

function parseArgs(argv) {
  const opts = { sheet: null, detected: DETECTED_PATH, out: null, prefix: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--sheet') opts.sheet = argv[++i];
    else if (a === '--detected') opts.detected = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--prefix') opts.prefix = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log(
        'usage: node scripts/coliseum/detected-to-map.js --sheet <id> [--detected <file>] [--out <file>] [--prefix <name>]',
      );
      process.exit(0);
    }
  }
  if (!opts.sheet) {
    console.error('--sheet <id> is required (the sheet id from scripts/coliseum/sheets.json).');
    process.exit(1);
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(opts.detected)) {
    throw new Error(
      `missing ${path.relative(ROOT, opts.detected)} — run the extractor with --dump-detected first.`,
    );
  }
  const detected = JSON.parse(fs.readFileSync(opts.detected, 'utf8'));
  const entry = detected.find((d) => d.id === opts.sheet);
  if (!entry) {
    throw new Error(
      `no detected entry for sheet "${opts.sheet}". Found: ${detected.map((d) => d.id).join(', ') || '(none)'}`,
    );
  }

  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));
  const sheet = (spec.sheets || []).find((s) => s.id === opts.sheet);
  if (!sheet?.file) {
    throw new Error(`sheet "${opts.sheet}" has no "file" in sheets.json.`);
  }

  const { w, h } = entry;
  const prefix = opts.prefix || opts.sheet;
  const round = (n) => +n.toFixed(4);

  // Detected boxes are already tight around each item, so they are used as-is —
  // no padding is added here. The extractor applies its own `pad` on export, and
  // the mapper's boxes are only a naming surface.
  const map = {
    source: sheet.file,
    width: w,
    height: h,
    regions: entry.detected.map((d, i) => ({
      name: `${prefix}-${d.i ?? i + 1}`,
      x: d.x,
      y: d.y,
      w: d.w,
      h: d.h,
      nx: round(d.x / w),
      ny: round(d.y / h),
      nw: round(d.w / w),
      nh: round(d.h / h),
    })),
  };

  const out =
    opts.out ||
    path.join(SOURCE_DIR, `${sheet.file.replace(/\.[^.]+$/, '')}.map.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(map, null, 2)}\n`, 'utf8');

  console.log(`wrote ${path.relative(ROOT, out)}`);
  console.log(`  ${map.regions.length} box(es) for ${sheet.file} (${w}×${h})`);
  console.log('');
  console.log('Next: open /uimapper, upload the source image, then "Load map" and pick that file.');
  console.log('Rename the boxes you want to keep, delete the rest, download, and paste back into');
  console.log('scripts/coliseum/sheets.json as `regions` (x→nx, y→ny, w→nw, h→nh).');
}

try {
  main();
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exit(1);
}
