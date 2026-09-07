/**
 * generate-simple-art.js — generate marketing artwork for the /simple page.
 *
 * Calls the app's AWS Bedrock text-to-image adapter directly (no HTTP server /
 * JWT required) and writes PNGs into frontend/src/assets/art/ as:
 *   simple-hero.png       — the hero image
 *   simple-perceive.png   — "perceives what you do"
 *   simple-act.png         — "acts on your behalf"
 *   simple-repeat.png      — "repeats the task when you ask"
 *
 *   node backend/scripts/generate-simple-art.js
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { generateImage, getDefaultImageModelId } = require('../services/bedrockImageService');

const ART_DIR = path.join(__dirname, '..', '..', 'frontend', 'src', 'assets', 'art');

const IMAGES = [
  {
    slug: 'hero',
    prompt:
      'A vibrant 3D render of a friendly desktop computer monitor with a soft glowing AI assistant orb floating beside it, a small task checklist and a play button hovering in front, over a soft blurred background of pastel pink, mint, orange and blue bokeh lights, shallow depth of field, premium product photography, no text',
  },
  {
    slug: 'perceive',
    prompt:
      'A vibrant 3D render of a stylized eye made of translucent glass with glowing rings scanning a desktop screen filled with small windows, thin neon gaze lines, over a soft blurred background of pastel blue, mint, pink and orange bokeh, shallow depth of field, premium render, no text',
  },
  {
    slug: 'act',
    prompt:
      'A vibrant 3D render of a glossy translucent robotic hand clicking a glowing rounded button on a stylized screen, small light trails from a cursor arrow, over a soft blurred background of pastel pink, orange, blue and mint bokeh, shallow depth of field, premium render, no text',
  },
  {
    slug: 'repeat',
    prompt:
      'A vibrant 3D render of two looping curved arrows forming a circular cycle around a glowing hourglass, a tiny calendar and a checkmark floating inside, over a soft blurred background of pastel mint, pink, blue and orange bokeh, shallow depth of field, premium render, no text',
  },
];

async function generateOne(entry) {
  const result = await generateImage({
    prompt: entry.prompt,
    modelId: getDefaultImageModelId(),
    aspectRatio: '3:2',
    numberOfImages: 1,
  });
  const img = result.images[0];
  const outPath = path.join(ART_DIR, `simple-${entry.slug}.png`);
  fs.writeFileSync(outPath, Buffer.from(img.base64, 'base64'));
  console.log(`✅ simple-${entry.slug}.png (${result.model}, seed ${result.seed})`);
}

async function main() {
  fs.mkdirSync(ART_DIR, { recursive: true });
  const failed = [];
  for (const entry of IMAGES) {
    try {
      await generateOne(entry);
    } catch (err) {
      failed.push(entry.slug);
      console.error(`❌ ${entry.slug}: ${err.message}`);
    }
  }
  if (failed.length) {
    console.error(`\n${failed.length} image(s) failed: ${failed.join(', ')}`);
    process.exit(1);
  }
  console.log(`\nDone — generated ${IMAGES.length} image(s) into ${ART_DIR}`);
}

main();
