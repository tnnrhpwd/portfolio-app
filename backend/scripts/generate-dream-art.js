/**
 * generate-dream-art.js — generate the Dream board's preset tile artwork.
 *
 * The dream board (/plans → 🌟 Dream board) lets someone give a goal a cover.
 * Most users will never upload a photo, so the *presets* are the images that
 * actually carry the feature — and they have to be real imagery, not emoji
 * tiles (`docs/guides/FRONTEND_UI_STANDARD.md` §5: "Imagery over emoji").
 *
 * This fills in one image per preset theme by calling the app's AWS Bedrock
 * text-to-image adapter directly — no HTTP server, no JWT. It reuses
 * services/bedrockImageService.js and the AWS credentials in backend/.env,
 * exactly like scripts/generate-project-art.js does for /projects.
 *
 * Run from anywhere (paths resolve relative to this file):
 *   node backend/scripts/generate-dream-art.js                # all themes
 *   node backend/scripts/generate-dream-art.js home money     # just these
 *
 * Output lands in frontend/src/assets/art/ as dream-<key>.jpg.
 *
 * Two deliberate choices, both learned from generate-project-art.js:
 *
 *   • The generator returns PNG, but frontend/src/assets/art/ is all .jpg. This
 *     script converts with sharp (quality 90, mozjpeg) and deletes the PNG, so
 *     nobody has to remember that step and a stray PNG can't get committed.
 *   • Prompts end with "no text". Stability garbles lettering, and every other
 *     piece of art in that folder is text-free.
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const sharp = require('sharp');
const { generateImage, getDefaultImageModelId } = require('../services/bedrockImageService');

const ART_DIR = path.join(__dirname, '..', '..', 'frontend', 'src', 'assets', 'art');

/**
 * The preset cover catalog — one theme per tile style.
 *
 * Keys are the storage values written into a goal's `cover` attribute, so they
 * must match DREAM_COVERS in
 * frontend/src/pages/Simple/Plans/dreamCovers.js. Changing a key here means
 * changing it there, or a goal silently loses its picture.
 *
 * Each prompt asks for the same visual language: a glossy 3D render or editorial
 * still life, shallow depth of field, blurred bokeh in the site palette (mint /
 * cyan, hot pink, orange, blue), no text.
 */
const DREAM_ART = [
  {
    key: 'home',
    prompt:
      'A vibrant 3D render of a cozy modern house sitting on a small floating island of green lawn, a tiny tree and a warm glowing window, soft sunrise light, floating over a blurred pastel background of mint, pink, orange and blue bokeh, shallow depth of field, premium editorial render, no text',
  },
  {
    key: 'work',
    prompt:
      'A vibrant 3D render of a sleek open laptop beside a glowing upward arrow made of translucent glass and a small tidy stack of colorful paper cards, a modern desk from above, floating over a blurred pastel background of blue, mint, orange and pink bokeh, shallow depth of field, premium product photography, no text',
  },
  {
    key: 'money',
    prompt:
      'A vibrant 3D render of a glossy translucent glass jar filling with glowing golden coins, a few coins mid-air with soft light trails and a small ascending sparkline of glass bars behind it, over a blurred pastel background of pink, mint, orange and blue bokeh, shallow depth of field, premium product render, no text, no numbers, no lettering',
  },
  {
    key: 'health',
    prompt:
      'A vibrant 3D render of a glossy pair of running shoes mid-stride beside a translucent water bottle and a small glowing heart, fresh green leaves swirling, over a blurred pastel background of mint, cyan, orange and pink bokeh, shallow depth of field, premium product photography, no text',
  },
  {
    key: 'travel',
    prompt:
      'A vibrant 3D render of a small glossy airplane arcing over a stylized globe with a dotted flight path and two tiny luggage tags catching the light, over a blurred pastel background of blue, mint, orange and pink bokeh, shallow depth of field, premium editorial render, no text',
  },
  {
    key: 'learning',
    prompt:
      'A vibrant 3D render of a small stack of glossy books with a translucent graduation cap resting on top, a few glowing sparks and pages lifting into the air, over a blurred pastel background of pink, blue, mint and orange bokeh, shallow depth of field, premium editorial render, no text',
  },
  {
    key: 'people',
    prompt:
      'A vibrant 3D render of three glossy abstract rounded figures standing close together with a soft glowing ring encircling them, a couple of small hearts floating up, over a blurred pastel background of orange, pink, mint and blue bokeh, shallow depth of field, premium render, no text',
  },
  {
    key: 'creative',
    prompt:
      'A vibrant 3D render of a paintbrush sweeping a vivid ribbon of mint, pink and orange paint through empty air beside a small glowing artist palette and a curled sheet of music, over a blurred pastel background bokeh, shallow depth of field, premium editorial render, no text, no writing',
  },
  {
    key: 'play',
    prompt:
      'A vibrant 3D render of a glossy game controller, a pair of round headphones and a small glowing dice arranged as a playful still life, confetti sparks in the air, over a blurred pastel background of blue, pink, mint and orange bokeh, shallow depth of field, premium product photography, no text',
  },
  {
    key: 'calm',
    prompt:
      'A serene vibrant 3D render of a smooth balanced stack of glossy zen stones beside a single green leaf and a translucent candle with a soft glow, gentle rings rippling on a reflective surface, over a blurred pastel background of mint, blue, pink and orange bokeh, calm and minimal, shallow depth of field, no text',
  },
  {
    key: 'adventure',
    prompt:
      'A vibrant 3D render of a stylized mountain peak with a tiny glossy flag on top, a bedroll and a compass resting on a rock in the foreground, sunrise glow behind, over a blurred pastel background of orange, pink, blue and mint bokeh, shallow depth of field, premium editorial render, no text',
  },
  {
    key: 'milestone',
    prompt:
      'A vibrant 3D render of a translucent glass trophy with small golden sparks rising from it, a few glossy confetti pieces falling and a ribbon curling around the base, over a blurred pastel background of pink, mint, orange and blue bokeh, shallow depth of field, premium render, no text, no numbers, no lettering',
  },
];

/**
 * Generate one preset cover: PNG from Bedrock → JPG on disk.
 *
 * @param {{key: string, prompt: string}} entry Catalog entry
 */
async function generateOne(entry) {
  const modelId = getDefaultImageModelId();
  const result = await generateImage({
    prompt: entry.prompt,
    modelId,
    // 3:2 is the closest supported landscape ratio; the board crops to 4:3
    // with `object-fit: cover`, so the card loses very little.
    aspectRatio: '3:2',
    numberOfImages: 1,
  });

  const img = result.images[0];
  const outPath = path.join(ART_DIR, `dream-${entry.key}.jpg`);

  await sharp(Buffer.from(img.base64, 'base64'))
    .jpeg({ quality: 90, mozjpeg: true })
    .toFile(outPath);

  console.log(`✅ ${entry.key.padEnd(11)} -> dream-${entry.key}.jpg (${result.model}, seed ${result.seed})`);
}

async function main() {
  if (!fs.existsSync(ART_DIR)) fs.mkdirSync(ART_DIR, { recursive: true });

  const only = process.argv.slice(2).map((s) => s.toLowerCase());
  const targets = only.length
    ? DREAM_ART.filter((e) => only.includes(e.key))
    : DREAM_ART;

  if (targets.length === 0) {
    console.error(`No matching themes. Known keys: ${DREAM_ART.map((e) => e.key).join(', ')}`);
    process.exit(1);
  }

  const failed = [];
  for (const entry of targets) {
    try {
      await generateOne(entry);
    } catch (err) {
      failed.push(entry.key);
      console.error(`❌ ${entry.key}: ${err.message}`);
    }
  }

  if (failed.length) {
    console.error(`\n${failed.length} image(s) failed: ${failed.join(', ')}`);
    process.exit(1);
  }
  console.log(`\nDone — generated ${targets.length} cover(s).`);
}

main();
