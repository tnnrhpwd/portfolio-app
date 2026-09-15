#!/usr/bin/env node
/* Throwaway: the monochrome badge at real icon sizes, on BOTH a light and a dark
   surface — which for a black/white mark is the whole question. Writes
   scripts/dev/ico-sizes.png. */
const fs = require('fs');
const path = require('path');
const sharp = require(path.join(__dirname, '..', '..', 'backend', 'node_modules', 'sharp'));

const BADGE = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'assets', 'brand-mark-compact.svg'),
);

const TILES = [
  { size: 16, scale: 10 },
  { size: 24, scale: 8 },
  { size: 32, scale: 7 },
  { size: 48, scale: 5 },
];

const LIGHT = { r: 242, g: 242, b: 244, alpha: 1 };
const DARK = { r: 43, g: 43, b: 48, alpha: 1 };

(async () => {
  const magnified = [];
  for (const { size, scale } of TILES) {
    const buf = await sharp(BADGE, { density: 288 })
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    // Nearest-neighbour upscale = exactly the pixels the browser/OS get.
    magnified.push(
      await sharp(buf)
        .resize(size * scale, size * scale, { kernel: 'nearest' })
        .png()
        .toBuffer({ resolveWithObject: true }),
    );
  }

  const pad = 24;
  const colW = Math.max(...magnified.map((m) => m.info.width)) + pad;
  const rowH = Math.max(...magnified.map((m) => m.info.height)) + pad;
  const stripH = rowH + pad;
  const width = colW * magnified.length + pad;
  const height = stripH * 2;

  // Two strips: light chrome on top, dark chrome below.
  const darkStrip = await sharp({
    create: { width, height: stripH, channels: 4, background: DARK },
  })
    .png()
    .toBuffer();

  await sharp({ create: { width, height, channels: 4, background: LIGHT } })
    .composite([
      { input: darkStrip, left: 0, top: stripH },
      ...magnified.map((m, i) => ({ input: m.data, left: pad + i * colW, top: pad })),
      ...magnified.map((m, i) => ({
        input: m.data,
        left: pad + i * colW,
        top: stripH + pad,
      })),
    ])
    .png()
    .toFile(path.join(__dirname, 'ico-sizes.png'));

  console.log(`wrote scripts/dev/ico-sizes.png (${width}x${height})`);
  console.log('top strip = light chrome, bottom strip = dark chrome');
  console.log('sizes: ' + TILES.map((t) => `${t.size}px`).join(' / '));
})();
