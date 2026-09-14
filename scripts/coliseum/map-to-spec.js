/**
 * map-to-spec.js — write a map you edited in `/uimapper` back into
 * `scripts/coliseum/sheets.json` as a `regions` array.
 *
 * This closes the loop. The detector (or a hand) proposes boxes, `/uimapper` is
 * where they get *named and nudged*, and this is how those names reach the spec
 * the extractor reads. Without it the last step is a manual
 * `x→nx, y→ny, w→nw, h→nh` conversion of every rectangle — exactly the kind of
 * arithmetic that quietly misplaces one box and costs an hour.
 *
 * A sheet given `regions` this way also gets:
 *
 *   - `exclude: [whole sheet]` — `exclude` filters only AUTO-detected leaves, never
 *     hand-placed regions, so this is how you say "export exactly these boxes and
 *     nothing else". Without it the sheet would export its 27 auto-detected blobs
 *     *as well as* your 27 named regions.
 *   - `keepLargest` dropped — it trims auto-detected leaves, of which there are now
 *     none.
 *   - `names` dropped — there are no auto-detected sprites left to name.
 *
 * (`regionPad` needs no setting: it already defaults to 2 for hand-placed regions,
 * versus the 12px `pad` used for detected ones.)
 *
 * Usage:
 *   node scripts/coliseum/map-to-spec.js                   # the only *.map.json beside the sources
 *   node scripts/coliseum/map-to-spec.js --map <file>
 *   node scripts/coliseum/map-to-spec.js --dry-run         # print, write nothing
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SPEC_PATH = path.join(__dirname, 'sheets.json');
const SOURCE_DIR = path.join(ROOT, 'frontend', 'src', 'assets', 'coliseum');

function parseArgs(argv) {
  const opts = { map: null, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--map') opts.map = argv[++i];
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--help' || a === '-h') {
      console.log('usage: node scripts/coliseum/map-to-spec.js [--map <file>] [--dry-run]');
      process.exit(0);
    }
  }
  return opts;
}

/** The map to read: an explicit path, else the single *.map.json beside the sources. */
function resolveMapPath(explicit) {
  if (explicit) return path.resolve(explicit);
  const found = fs.readdirSync(SOURCE_DIR).filter((f) => f.endsWith('.map.json'));
  if (found.length === 1) return path.join(SOURCE_DIR, found[0]);
  if (!found.length) {
    throw new Error(`no *.map.json in ${path.relative(ROOT, SOURCE_DIR)} — pass --map <file>.`);
  }
  throw new Error(
    `several maps found (${found.join(', ')}) — pass --map <file> to choose one.`,
  );
}

/**
 * A map rect as a fraction of the sheet.
 *
 * `/uimapper` always writes `nx/ny/nw/nh`, so that is preferred. A hand-written
 * map without them needs its own `width`/`height` to divide by — if those are
 * missing the rect is assumed to be fractions already, which is what the
 * extractor's own `regions` are.
 */
function toFractional(region, width, height) {
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const n = [region.nx, region.ny, region.nw, region.nh].map(num);
  if (n.every((v) => v !== null)) {
    return { x: n[0], y: n[1], w: n[2], h: n[3] };
  }
  const flat = [region.x, region.y, region.w, region.h].map(num);
  if (flat.some((v) => v === null)) return null;
  const isPixels = region.unit === 'px' || flat.some((v) => v > 1);
  if (!isPixels) return { x: flat[0], y: flat[1], w: flat[2], h: flat[3] };
  if (!width || !height) {
    throw new Error(
      'the map uses pixel coordinates but records no width/height, so they cannot be converted.',
    );
  }
  return { x: flat[0] / width, y: flat[1] / height, w: flat[2] / width, h: flat[3] / height };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const mapPath = resolveMapPath(opts.map);
  const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  if (!Array.isArray(map.regions) || !map.regions.length) {
    throw new Error(`${path.relative(ROOT, mapPath)} has no regions.`);
  }

  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));
  const sheet = (spec.sheets || []).find((s) => s.file === map.source);
  if (!sheet) {
    throw new Error(
      `no sheet in sheets.json has file "${map.source}". Known files: ` +
        (spec.sheets || []).map((s) => s.file).join(', '),
    );
  }

  const round = (v) => +v.toFixed(4);
  const regions = [];
  let skipped = 0;
  for (const region of map.regions) {
    const rect = toFractional(region, map.width, map.height);
    if (!rect) {
      skipped += 1;
      continue;
    }
    regions.push({
      name: (region.name || '').trim() || `region-${regions.length + 1}`,
      x: round(rect.x),
      y: round(rect.y),
      w: round(rect.w),
      h: round(rect.h),
    });
  }

  sheet.regions = regions;
  delete sheet.keepLargest;
  delete sheet.names;
  delete sheet.gridNames;
  sheet.exclude = [
    {
      $comment:
        'Whole-sheet exclude: `exclude` filters only AUTO-detected leaves, never hand-placed `regions`, so this says "export exactly the named regions below and nothing else".',
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    },
  ];

  if (opts.dryRun) {
    console.log(`would set ${regions.length} region(s) on sheet "${sheet.id}".`);
    console.log(JSON.stringify(regions, null, 2));
    return;
  }

  fs.writeFileSync(SPEC_PATH, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
  console.log(
    `sheet "${sheet.id}": ${regions.length} region(s) from ${path.relative(ROOT, mapPath)}${
      skipped ? ` (${skipped} unusable rect(s) skipped)` : ''
    }`,
  );
  console.log('  + exclude: whole sheet (auto-detected blobs suppressed)');
  console.log('  - keepLargest / names / gridNames removed');
  console.log('');
  console.log('Next: node scripts/rocket/extract-sprites.js --spec scripts/coliseum/sheets.json');
}

try {
  main();
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exit(1);
}
