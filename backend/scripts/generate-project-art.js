/**
 * generate-project-art.js — generate the /projects page card artwork.
 *
 * The projects catalog (frontend/src/constants/projects.js) points each card
 * at art in frontend/src/assets/art/. This script fills in custom art for the
 * projects that don't already have their own image by calling the app's AWS
 * Bedrock text-to-image adapter directly (no HTTP server / JWT required —
 * it reuses services/bedrockImageService.js and the AWS credentials in
 * backend/.env).
 *
 * Run from the repo root (or anywhere; paths are resolved relative to this
 * file):
 *   node backend/scripts/generate-project-art.js [slug ...]
 *
 * Passing slugs limits generation to just those projects. With no args it
 * generates art for every project listed below. Output PNGs land in
 * frontend/src/assets/art/ as project-<slug>.png.
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { generateImage, getDefaultImageModelId } = require('../services/bedrockImageService');

const ART_DIR = path.join(__dirname, '..', '..', 'frontend', 'src', 'assets', 'art');

// Each prompt leans on the site's "vibrant editorial" palette (mint/cyan,
// hot pink, orange, blue) and the glossy 3D product-render look of the
// existing project-*.jpg art. Cards crop to 4:3 via object-fit: cover, so
// the 3:2 source ratio fills the card with minimal cropping.
const PROJECT_ART = [
  {
    slug: 'annuities',
    prompt:
      'A vibrant 3D render of a glossy translucent glass piggy bank next to a rising golden bar chart and a few coins, one coin sprouting a tiny green plant, floating over a soft blurred background of pastel pink, mint, orange and blue bokeh lights, shallow depth of field, premium product photography, no text',
  },
  {
    slug: 'halfway',
    prompt:
      'A vibrant 3D render of two glowing map location pins connected by a thin luminous line that meets a glowing midpoint marker on a stylized terrain, a sun rising on the left side and setting on the right, soft blurred pastel gradient background in pink, mint, orange and blue, shallow depth of field, no text',
  },
  {
    slug: 'passgen',
    prompt:
      'A vibrant 3D render of a glossy translucent padlock with a glowing keyhole, surrounded by floating holographic key glyphs and abstract password characters, over a soft blurred background of cyan, mint, pink and orange bokeh, premium product photography, shallow depth of field, no text',
  },
  {
    slug: 'uimapper',
    prompt:
      'A vibrant 3D render of a stylized website wireframe with glowing rounded rectangle selection boxes drawn around UI components, connected by thin neon guide lines, floating over a blurred pastel background in blue, mint, pink and orange, shallow depth of field, no text',
  },
  {
    slug: 'iqtest',
    prompt:
      'A vibrant 3D render of a glossy translucent human brain made of glowing puzzle pieces, a few pieces floating apart with soft light trails, over a soft blurred background of pink, blue, mint and orange bokeh lights, shallow depth of field, premium render, no text',
  },
  {
    slug: 'wordlesolver',
    prompt:
      'A vibrant 3D render of five glossy rounded letter tiles standing in a row, one glowing green and one glowing gold while the rest stay dark under a soft spotlight, floating over a blurred pastel background of mint, pink, orange and blue bokeh, shallow depth of field, no text',
  },
  {
    slug: 'sleepassist',
    prompt:
      'A serene vibrant 3D render of a glowing crescent moon resting above soft fluffy clouds with a stylized circular sleep-cycle ring and tiny twinkling stars, soft blurred background of pastel blue, mint, pink and orange bokeh, calm and cozy, shallow depth of field, no text',
  },
  {
    slug: 'pets',
    prompt:
      'A vibrant 3D render of an adorable glossy cartoon kitten and puppy sitting together with big expressive eyes, surrounded by a floating pet food bowl, a ball and a heart, over a soft blurred pastel background of pink, mint, orange and blue bokeh, shallow depth of field, premium render, no text',
  },
];

async function generateOne(entry) {
  const modelId = getDefaultImageModelId();
  const result = await generateImage({
    prompt: entry.prompt,
    modelId,
    aspectRatio: '3:2',
    numberOfImages: 1,
  });
  const img = result.images[0];
  const outPath = path.join(ART_DIR, `project-${entry.slug}.png`);
  fs.writeFileSync(outPath, Buffer.from(img.base64, 'base64'));
  console.log(`✅ ${entry.slug.padEnd(13)} -> project-${entry.slug}.png (${result.model}, seed ${result.seed})`);
}

async function main() {
  fs.mkdirSync(ART_DIR, { recursive: true });

  const only = process.argv.slice(2).map((s) => s.toLowerCase());
  const targets = only.length
    ? PROJECT_ART.filter((e) => only.includes(e.slug))
    : PROJECT_ART;

  if (targets.length === 0) {
    console.error(`No matching projects. Known slugs: ${PROJECT_ART.map((e) => e.slug).join(', ')}`);
    process.exit(1);
  }

  const failed = [];
  for (const entry of targets) {
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
  console.log(`\nDone — generated ${targets.length} image(s).`);
}

main();
