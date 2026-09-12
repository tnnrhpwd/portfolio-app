#!/usr/bin/env node
/**
 * Throwaway analysis: measure the true gutters between sprites on each sheet so
 * the projection-based splitter can be tuned with numbers instead of guesses.
 *
 *   node scripts/rocket/probe-profile.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const sharp = require(path.join(ROOT, 'backend', 'node_modules', 'sharp'));

const SRC = path.join(ROOT, 'frontend', 'src', 'assets', 'rocket');
const spec = JSON.parse(fs.readFileSync(path.join(__dirname, 'sheets.json'), 'utf8'));

const opts = { bgLuma: 232, bgSat: 0.08, frameRunH: 0.28, frameRunV: 0.14, frameThin: 16 };

function buildMask(rgba, W, H, o) {
  const n = W * H;
  const mask = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    if (luma < o.bgLuma) { mask[i] = 1; continue; }
    const max = Math.max(r, g, b);
    if (!max) continue;
    if ((max - Math.min(r, g, b)) / max > o.bgSat) mask[i] = 1;
  }
  return mask;
}

function runLengths(mask, W, H, axis) {
  const out = new Int32Array(W * H);
  if (axis === 'x') {
    for (let y = 0; y < H; y++) {
      const row = y * W; let x = 0;
      while (x < W) {
        if (mask[row + x] !== 1) { x++; continue; }
        let end = x; while (end < W && mask[row + end] === 1) end++;
        for (let i = x; i < end; i++) out[row + i] = end - x;
        x = end;
      }
    }
  } else {
    for (let x = 0; x < W; x++) {
      let y = 0;
      while (y < H) {
        if (mask[y * W + x] !== 1) { y++; continue; }
        let end = y; while (end < H && mask[end * W + x] === 1) end++;
        for (let i = y; i < end; i++) out[i * W + x] = end - y;
        y = end;
      }
    }
  }
  return out;
}

function stripFrames(mask, W, H, o) {
  const minH = Math.round(o.frameRunH * W);
  const minV = Math.round(o.frameRunV * H);
  const hrun = runLengths(mask, W, H, 'x');
  const vrun = runLengths(mask, W, H, 'y');
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== 1) continue;
    if ((hrun[i] >= minH && vrun[i] <= o.frameThin) || (vrun[i] >= minV && hrun[i] <= o.frameThin)) mask[i] = 0;
  }
}

/** widths of zero-runs, as a histogram of "how many gutters are at least N px" */
function gutterStats(counts) {
  const gaps = [];
  let run = 0;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] === 0) run++;
    else { if (run > 0) gaps.push(run); run = 0; }
  }
  if (run > 0) gaps.push(run);
  gaps.sort((a, b) => a - b);
  const n = gaps.length;
  if (!n) return { n: 0 };
  const pct = (p) => gaps[Math.min(n - 1, Math.floor(n * p))];
  return { n, min: gaps[0], p25: pct(0.25), median: pct(0.5), p75: pct(0.75), max: gaps[n - 1] };
}

async function main() {
  for (const s of spec.sheets) {
    const file = path.join(SRC, s.file);
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height;
    const mask = buildMask(data, W, H, opts);
    stripFrames(mask, W, H, opts);

    const colCounts = new Int32Array(W);
    const rowCounts = new Int32Array(H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) { colCounts[x]++; rowCounts[y]++; }

    const cs = gutterStats(colCounts);
    const rs = gutterStats(rowCounts);
    const fg = mask.reduce((a, v) => a + v, 0);
    console.log(`\n=== ${s.id} (${W}x${H}) fg=${((fg / (W * H)) * 100).toFixed(1)}%`);
    console.log(`  col gutters: n=${cs.n} min=${cs.min} p25=${cs.p25} med=${cs.median} p75=${cs.p75} max=${cs.max}`);
    console.log(`  row gutters: n=${rs.n} min=${rs.min} p25=${rs.p25} med=${rs.median} p75=${rs.p75} max=${rs.max}`);

    // how many content blocks exist at a few candidate min-gutter widths
    const blocks = (counts, minGap) => {
      let blocks = 0, run = 0, inBlock = false;
      for (let i = 0; i < counts.length; i++) {
        if (counts[i] > 0) { if (!inBlock) { blocks++; inBlock = true; } run = 0; }
        else { run++; if (run >= minGap) inBlock = false; }
      }
      return blocks;
    };
    for (const g of [10, 16, 22, 30, 40, 60]) {
      console.log(`    minGutter=${String(g).padStart(2)}  ->  rows=${blocks(rowCounts, g)}  cols=${blocks(colCounts, g)}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
