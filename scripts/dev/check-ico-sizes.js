#!/usr/bin/env node
/* Throwaway: magnify the 16/24/32px compact mark so the small sizes can be judged.
   Writes scripts/dev/ico-sizes.png. Delete after looking at it. */
const fs = require('fs');
const path = require('path');
const sharp = require(path.join(__dirname, '..', '..', 'backend', 'node_modules', 'sharp'));

const MASTER = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'assets', 'brand-mark-compact.svg'),
);
const FULL = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'assets', 'brand-mark.svg'),
);

const TILES = [16, 24, 32, 48];

(async () => {
  const cells = [];
  for (const size of TILES) {
    const big = Math.round((size / 16) * 256);
    for (const [label, master] of [['compact', MASTER], ['full', FULL]]) {
      const buf = await sharp(master, { density: 288 }).resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      }).png().toBuffer();
      // Nearest-neighbour upscale = exactly the pixels the browser gets.
      const up = await sharp(buf).resize(big, big, { kernel: 'nearest' }).png().toBuffer();
      cells.push({ label, size, buf: up, side: big });
    }
  }

  const side = Math.max(...cells.map((c) => c.side));
  const pad = 24;
  const cols = TILES.length * 2;
  const width = cols * (side + pad) + pad;
  const height = side + pad * 2;

  const composites = cells.map((c, i) => ({
    input: c.buf,
    left: pad + i * (side + pad),
    top: pad + Math.round((side - c.side) / 2),
  }));

  await sharp({
    create: { width, height, channels: 4, background: { r: 96, g: 96, b: 96, alpha: 1 } },
  })
    .composite(composites)
    .png()
    .toFile(path.join(__dirname, 'ico-sizes.png'));

  console.log(`wrote scripts/dev/ico-sizes.png (${width}x${height})`);
  console.log(`order: ${cells.map((c) => `${c.label}@${c.size}`).join(', ')}`);
})();
