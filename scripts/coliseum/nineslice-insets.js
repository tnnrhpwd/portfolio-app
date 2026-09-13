/**
 * nineslice-insets.js — measure the cap/border thickness of a chrome sprite, for
 * Phaser's `add.nineslice(...)`.
 *
 * Nine-slice needs to know how wide the ornate ends are and how thick the border
 * is, so the middle can stretch without distorting the decoration. Guessing those
 * numbers smears the gold trim; measuring them takes one command:
 *
 *   node scripts/coliseum/nineslice-insets.js frontend/public/coliseum/chrome-bar-3.png
 *
 * How it measures: a column is "full" when its opaque-pixel count reaches a
 * fraction (`--thresh`, default 0.9) of the tallest column. For a bar with angled
 * or pointed ends, the first full column from the left IS where the cap ends —
 * exactly the inset nine-slice wants. Same logic down the rows for the border.
 *
 * Usage:
 *   node scripts/coliseum/nineslice-insets.js <file.png> [--thresh 0.9] [--bar]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

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
  throw new Error('sharp not found (expected in backend/node_modules).');
}

const ALPHA_FLOOR = 8; // ignore near-transparent edge pixels

async function main() {
  const argv = process.argv.slice(2);
  const file = argv.find((a) => !a.startsWith('--'));
  let thresh = 0.9;
  let showBar = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--thresh') thresh = Number(argv[++i]);
    else if (argv[i] === '--bar') showBar = true;
  }
  if (!file) throw new Error('usage: nineslice-insets.js <file.png> [--thresh 0.9] [--bar]');

  const sharp = loadSharp();
  const abs = path.resolve(file);
  const { data, info } = await sharp(abs).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  const colCov = new Array(width).fill(0);
  const rowCov = new Array(height).fill(0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * channels + 3] > ALPHA_FLOOR) {
        colCov[x] += 1;
        rowCov[y] += 1;
      }
    }
  }

  const maxCol = Math.max(...colCov);
  const maxRow = Math.max(...rowCov);
  const fullCol = colCov.map((c) => c >= maxCol * thresh);
  const fullRow = rowCov.map((c) => c >= maxRow * thresh);

  const lastFullCol = fullCol.lastIndexOf(true);
  const lastFullRow = fullRow.lastIndexOf(true);
  const left = fullCol.indexOf(true);
  const top = fullRow.indexOf(true);
  // Mirror of each other: the inset is the distance from the far edge to the last
  // fully-covered column/row. (An earlier version folded this the wrong way round
  // and reported `lastFull` instead of the gap — always sanity-check symmetry.)
  const right = lastFullCol === -1 ? 0 : width - 1 - lastFullCol;
  const bottom = lastFullRow === -1 ? 0 : height - 1 - lastFullRow;

  const name = path.basename(abs);
  console.log(`${name}  ${width}x${height}`);
  console.log(`  max coverage: column ${maxCol}px, row ${maxRow}px`);
  console.log('');
  console.log('  add.nineslice(x, y, key, undefined, w, h, left, right, top, bottom)');
  console.log(`    left=${left}  right=${right}  top=${top}  bottom=${bottom}`);
  console.log('');
  console.log(
    left === -1 || top === -1
      ? '  WARNING: no fully-covered row/column found — the sprite may be a solid blob (no nine-slice), or --thresh is too high.'
      : '  (left/right = the ornate cap width; top/bottom = the border thickness)',
  );

  if (showBar) {
    const bar = (arr, max) =>
      arr.map((v) => ' .:-=+*#%@'[Math.min(9, Math.floor((v / (max || 1)) * 9.99))]).join('');
    console.log('');
    console.log(`  column profile: ${bar(colCov, maxCol)}`);
    console.log(`  row profile   : ${bar(rowCov, maxRow)}`);
  }
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
