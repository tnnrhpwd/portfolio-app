#!/usr/bin/env node
/**
 * make-card-art.js — build the /projects card image for Rocket.
 *
 * The catalog expects a 3:2 `frontend/src/assets/art/project-*.jpg` for every
 * project (docs/guides/FRONTEND_UI_STANDARD.md §5). Rather than generating one
 * with Bedrock, this composes the card from the game's own sprite set: a nebula
 * backdrop, a hero rocket, and a scatter of asteroids and sparks. That keeps the
 * card honest (it is literally the game's art) and free to regenerate.
 *
 *   node scripts/rocket/make-card-art.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const sharp = require(path.join(ROOT, 'backend', 'node_modules', 'sharp'));

const SPRITES = path.join(ROOT, 'frontend', 'public', 'rocket');
const OUT = path.join(ROOT, 'frontend', 'src', 'assets', 'art', 'project-rocket.jpg');

/** 3:2 — the ratio the other project cards use. */
const W = 1500;
const H = 1000;

/** Deterministic scatter so re-running produces the same card. */
function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** Sprite name → buffer, or null when the file is missing. */
async function sprite(name) {
  const file = path.join(SPRITES, `${name}.png`);
  return fs.existsSync(file) ? sharp(file).png().toBuffer() : null;
}

async function fitted(name, height) {
  const buf = await sprite(name);
  if (!buf) return null;
  const meta = await sharp(buf).metadata();
  const scale = height / meta.height;
  return sharp(buf)
    .resize(Math.round(meta.width * scale), height, { fit: 'inside' })
    .png()
    .toBuffer();
}

async function main() {
  const random = rng(20260912);

  const backdropName = fs.existsSync(path.join(SPRITES, 'bg-galaxy.png'))
    ? 'bg-galaxy'
    : 'bg-nebula-blue';

  const backdrop = await sharp(path.join(SPRITES, `${backdropName}.png`))
    .resize(W, H, { fit: 'cover' })
    .modulate({ brightness: 0.62, saturation: 1.2 })
    .toBuffer();

  const layers = [];
  const place = async (buf, x, y, opts = {}) => {
    if (!buf) return;
    const meta = await sharp(buf).metadata();
    layers.push({
      input: buf,
      left: Math.round(x - meta.width / 2),
      top: Math.round(y - meta.height / 2),
      ...opts,
    });
  };

  // Background dust: asteroids and small shards, dimmed so the rocket dominates.
  const dust = ['asteroid-orange', 'asteroid-blue', 'asteroid-teal', 'debris-shards', 'moon-grey'];
  for (let i = 0; i < 9; i++) {
    const name = dust[i % dust.length];
    const buf = await fitted(name, 90 + Math.round(random() * 120));
    if (!buf) continue;
    await place(buf, 80 + random() * (W - 160), 80 + random() * (H - 160), { opacity: 0.75 });
  }

  // Sparkles for a bit of energy.
  const sparks = ['star-sparkle-blue', 'star-sparkle-gold', 'spark-burst-2', 'spark-burst-7'];
  for (let i = 0; i < 7; i++) {
    const buf = await fitted(sparks[i % sparks.length], 50 + Math.round(random() * 90));
    await place(buf, 120 + random() * (W - 240), 120 + random() * (H - 240), { opacity: 0.85 });
  }

  // Hero rocket, offset right of centre so the card reads well when cropped.
  const hero = await fitted('retro-rocket-1', 620);
  await place(hero, W * 0.63, H * 0.52);

  // Exhaust under the hero.
  const flame = await fitted('flame-burst', 220);
  await place(flame, W * 0.63, H * 0.52 + 330, { opacity: 0.9 });

  // Vignette + a cool wash, so card text over the image stays legible.
  const overlay = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <defs>
        <radialGradient id="v" cx="50%" cy="45%" r="72%">
          <stop offset="0%" stop-color="#000" stop-opacity="0"/>
          <stop offset="65%" stop-color="#040611" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="#040611" stop-opacity="0.8"/>
        </radialGradient>
        <linearGradient id="w" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#4cc9f0" stop-opacity="0.16"/>
          <stop offset="100%" stop-color="#f72585" stop-opacity="0.14"/>
        </linearGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#w)"/>
      <rect width="${W}" height="${H}" fill="url(#v)"/>
    </svg>`);

  await sharp(backdrop)
    .composite([...layers, { input: overlay, top: 0, left: 0 }])
    .jpeg({ quality: 90, mozjpeg: true })
    .toFile(OUT);

  const { size } = fs.statSync(OUT);
  console.log(`✅ ${path.relative(ROOT, OUT)} (${W}×${H}, ${(size / 1024).toFixed(0)} KB)`);
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
