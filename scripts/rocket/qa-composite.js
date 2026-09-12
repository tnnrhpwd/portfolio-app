#!/usr/bin/env node
/**
 * Visual QA for the extracted rocket sprites.
 * ---------------------------------------------------------------------------
 * The proof sheet (extract-sprites.js) shows crops on a checkerboard, which is
 * good for spotting gross errors. This composite is stricter: every sprite is
 * re-drawn on a SATURATED background with a hard 1px outline box, so
 *   - a leftover white halo / fringe around an edge, and
 *   - a hole punched through a white area (rocket body, visor highlight)
 * both stand out immediately.
 *
 *   node scripts/rocket/qa-composite.js              # every sheet
 *   node scripts/rocket/qa-composite.js --sheet effects
 *
 * Output: frontend/public/rocket/_preview/qa-<sheet>.png
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const sharp = require(path.join(ROOT, 'backend', 'node_modules', 'sharp'));

const OUT_DIR = path.join(ROOT, 'frontend', 'public', 'rocket');
const PREVIEW_DIR = path.join(OUT_DIR, '_preview');
const SPEC_PATH = path.join(__dirname, 'sheets.json');

const CELL = 168; // cell edge in the composite
const COLS = 12;
const BG = { r: 255, g: 0, b: 255 }; // magenta: nothing in the art is this colour

const escapeXml = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]);

async function buildSheet(sheet, assets) {
  if (!assets.length) return null;
  const rows = Math.ceil(assets.length / COLS);
  const W = COLS * CELL;
  const H = rows * CELL;

  const base = await sharp({
    create: { width: W, height: H, channels: 3, background: BG },
  })
    .png()
    .toBuffer();

  const composites = [];
  const labels = [];

  for (let i = 0; i < assets.length; i++) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const ox = col * CELL;
    const oy = row * CELL;

    // fit inside the cell with a margin
    const inner = CELL - 22;
    const buf = await sharp(path.join(OUT_DIR, assets[i].file))
      .resize(inner, inner, { fit: 'inside', withoutEnlargement: false })
      .png()
      .toBuffer();
    const meta = await sharp(buf).metadata();
    composites.push({
      input: buf,
      left: ox + Math.round((CELL - meta.width) / 2),
      top: oy + 4 + Math.round((inner - meta.height) / 2),
    });

    const label = escapeXml(assets[i].name);
    labels.push(
      `<rect x="${ox + 1}" y="${oy + 1}" width="${CELL - 2}" height="${CELL - 2}" fill="none" stroke="#000" stroke-opacity="0.35" stroke-width="2"/>` +
        `<text x="${ox + 6}" y="${oy + CELL - 6}" font-family="Segoe UI, Arial, sans-serif" font-size="12" fill="#000" fill-opacity="0.85">${label.slice(0, 24)}</text>`,
    );
  }

  labels.push(
    `<text x="8" y="16" font-family="Segoe UI, Arial, sans-serif" font-size="25" fill="#fff" stroke="#000" stroke-width="4" paint-order="stroke">${escapeXml(sheet.title)} — ${assets.length} sprites on magenta (any white fringe = halo bug)</text>`,
  );

  const out = path.join(PREVIEW_DIR, `qa-${sheet.id}.png`);
  await sharp(base)
    .composite([
      ...composites,
      { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${labels.join('')}</svg>`), top: 0, left: 0 },
    ])
    .png()
    .toFile(out);
  return out;
}

async function main() {
  const args = { sheet: null };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sheet') args.sheet = argv[++i];
  }

  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'manifest.json'), 'utf8'));

  for (const s of spec.sheets) {
    if (args.sheet && s.id !== args.sheet) continue;
    const assets = manifest.assets.filter((a) => a.sheet === s.id);
    const out = await buildSheet(s, assets);
    if (out) console.log(`wrote ${path.relative(ROOT, out)} (${assets.length} sprites)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
