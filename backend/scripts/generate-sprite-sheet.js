#!/usr/bin/env node
/**
 * generate-sprite-sheet.js — generate a white-background sprite sheet for a 2D game.
 *
 * This is the SOURCE step of the sprite pipeline documented in
 * `docs/guides/STATIC_ASSETS_AND_IMAGE_GENERATION.md` (Part 3): it produces one
 * image containing many separated cartoon objects on a pure white background,
 * which `scripts/rocket/extract-sprites.js` then slices into named, transparent,
 * individually cropped sprites.
 *
 * It calls the app's AWS Bedrock text-to-image adapter directly — no HTTP server,
 * no JWT, no rate limit — reusing `services/bedrockImageService.js` and the AWS
 * credentials already in `backend/.env`.
 *
 * AUTHORS NOTE: image generation costs money. When a task requires a new sprite
 * sheet this has been pre-authorized by the repo owner (2026-09-12), but the
 * always-safe way to check your prompt and wiring first is `--dry-run`, which
 * never calls Bedrock.
 *
 * Usage (run from anywhere; paths resolve relative to this file):
 *
 *   # 1. See exactly what would be sent, and whether credentials resolve:
 *   node backend/scripts/generate-sprite-sheet.js \
 *     --slug rocket-pack-2 --ratio 16:9 --dry-run \
 *     --assets "four retro rockets in different sizes, six capsule modules, five engine nozzles"
 *
 *   # 2. Generate. --candidates writes several variants to pick the cleanest from:
 *   node backend/scripts/generate-sprite-sheet.js \
 *     --slug rocket-pack-2 --ratio 16:9 --candidates 3 \
 *     --assets "four retro rockets in different sizes, six capsule modules, five engine nozzles"
 *
 *   node backend/scripts/generate-sprite-sheet.js --list-models
 *
 * Output: frontend/src/assets/rocket/<slug>.png (plus <slug>-v2.png, ... for
 * extra candidates). Deliberately PNG, NOT JPEG — see the note in the script.
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const {
  generateImage,
  getDefaultImageModelId,
  isImageGenerationConfigured,
  IMAGE_MODELS,
  MAX_IMAGES_PER_REQUEST,
} = require('../services/bedrockImageService');

/** Where the extractor reads source sheets from. */
const OUT_DIR = path.join(__dirname, '..', '..', 'frontend', 'src', 'assets', 'rocket');

/**
 * The style block. The non-negotiables for a sliceable sheet are:
 *   - PURE WHITE background  -> the extractor's background classifier needs it
 *   - wide, even gaps, nothing touching -> the XY-cut needs real gutters
 *   - no text/borders/panels -> those are the things the extractor must erase anyway
 */
const BASE_STYLE = [
  'A single sprite sheet of cartoon 2D game assets on a PURE WHITE background,',
  'arranged in a neat grid with wide, even gaps between every item.',
  'Flat vector cartoon style, bold dark outlines, vivid saturated colours,',
  'even flat lighting. Every object is fully separated with generous white space',
  'around it, nothing touches or overlaps, no shadows on the background.',
  'NO text, NO labels, NO numbers, NO captions, NO borders, NO panels, NO grid lines.',
].join(' ');

const NEGATIVE_PROMPT = [
  'text', 'letters', 'words', 'numbers', 'labels', 'captions', 'watermark',
  'signature', 'border', 'frame', 'panel', 'rounded rectangle', 'grid lines',
  'progress bar', 'overlapping objects', 'drop shadows', 'grey background',
  'gradient background', 'photorealistic', '3d render', 'blurry',
].join(', ');

function usage() {
  console.log(`
Generate a white-background sprite sheet via AWS Bedrock, for slicing with
scripts/rocket/extract-sprites.js.

  --slug <name>        required. Output base name -> <slug>.png
  --assets "<list>"    required. Comma-separated objects to include
                       (or pass them as trailing positional words)
  --title <text>       human title, echoed into the sheets.json snippet
  --style <text>       optional extra look hint (e.g. "chrome and matte-red livery")
  --ratio <r>          aspect ratio, default 16:9 (landscape = more columns)
  --model <id>         Bedrock model id, default from BEDROCK_IMAGE_MODEL_ID
  --candidates <n>     generate n variants (default 1, max ${MAX_IMAGES_PER_REQUEST})
  --seed <int>         deterministic seed (Stability models only)
  --out <dir>          output directory (default frontend/src/assets/rocket)
  --dry-run            print the prompt + resolved settings; never call Bedrock
  --list-models        print available models and the ratios each supports
  -h, --help           this text
`);
}

function parseArgs(argv) {
  const opts = { ratio: '16:9', candidates: 1, dryRun: false, positional: [] };
  const takesValue = new Set([
    '--slug', '--assets', '--title', '--style', '--ratio', '--model',
    '--candidates', '--seed', '--out',
  ]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--list-models') opts.listModels = true;
    else if (takesValue.has(a)) {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${a} needs a value`);
      opts[a.replace(/^--/, '').replace(/-(\w)/g, (_, c) => c.toUpperCase())] = value;
    } else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else opts.positional.push(a);
  }
  return opts;
}

function listModels() {
  const def = getDefaultImageModelId();
  console.log('\nAvailable image models (see also GET /api/data/image/models):\n');
  for (const [id, model] of Object.entries(IMAGE_MODELS)) {
    const mark = id === def ? ' (default)' : '';
    console.log(`  ${id}${mark}\n    ${model.label} — provider: ${model.provider}`);
    console.log(`    ratios: ${model.aspectRatios.join(', ')}`);
  }
  console.log('\nNote: the Gemini model ignores aspect ratio — prefer a Stability model');
  console.log('when the sheet layout matters (it does, for sprite sheets).\n');
}

/** Fail fast with a helpful message instead of the service's bare 400. */
function resolveRatio(requested, modelId) {
  const model = IMAGE_MODELS[modelId];
  if (!model) {
    throw new Error(
      `Unsupported image model: ${modelId}\nKnown models: ${Object.keys(IMAGE_MODELS).join(', ')}`,
    );
  }
  if (!model.aspectRatios.includes(requested)) {
    throw new Error(
      `"${requested}" is not supported by ${modelId}.\nSupported: ${model.aspectRatios.join(', ')}`,
    );
  }
  return { model, ratio: requested };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return usage();
  if (opts.listModels) return listModels();

  const slug = (opts.slug || '').trim();
  const assets = (opts.assets || opts.positional.join(' ') || '').trim();
  if (!slug) {
    usage();
    throw new Error('--slug is required');
  }
  if (!assets) {
    usage();
    throw new Error('--assets is required (what should be on the sheet?)');
  }

  const modelId = opts.model || getDefaultImageModelId();
  const { model, ratio } = resolveRatio(opts.ratio, modelId);

  const candidates = Number(opts.candidates);
  if (!Number.isInteger(candidates) || candidates < 1 || candidates > MAX_IMAGES_PER_REQUEST) {
    throw new Error(`--candidates must be an integer from 1 to ${MAX_IMAGES_PER_REQUEST}`);
  }

  const seed = opts.seed === undefined ? undefined : Number(opts.seed);
  if (seed !== undefined && (!Number.isInteger(seed) || seed < 0 || seed > 4294967295)) {
    throw new Error('--seed must be an integer between 0 and 4294967295');
  }

  const prompt = `${BASE_STYLE} The sheet contains: ${assets}.${
    opts.style ? ` Overall look: ${String(opts.style).trim()}.` : ''
  }`;

  const outDir = opts.out ? path.resolve(opts.out) : OUT_DIR;

  // ---- show what will happen ------------------------------------------------
  console.log('\n📄 Prompt\n' + '-'.repeat(72));
  console.log(prompt);
  console.log('-'.repeat(72) + '\n');
  console.log(`  slug       : ${slug}`);
  console.log(`  model      : ${modelId}  (${model.label})`);
  console.log(`  ratio      : ${ratio}${model.provider === 'gemini' ? '  ⚠️ ignored by the Gemini provider' : ''}`);
  console.log(`  candidates : ${candidates}`);
  console.log(`  output     : ${path.join(outDir, `${slug}.png`)}`);
  if (seed !== undefined) console.log(`  seed       : ${seed}`);

  if (model.provider === 'gemini') {
    console.log('\n⚠️  The Gemini provider does not take an aspect ratio — the returned image');
    console.log('    shape is up to the model. Use a Stability model if you need 16:9/21:9.');
  }

  if (opts.dryRun) {
    let configured = false;
    try {
      configured = Boolean(isImageGenerationConfigured());
    } catch {
      configured = false;
    }
    console.log(`\n  credentials: ${configured ? '✅ resolve (AWS creds found)' : '❌ NOT configured — check backend/.env AWS_* / AWS_BEDROCK_* vars'}`);
    console.log('\n--dry-run: nothing was generated and nothing was spent.\n');
    return;
  }

  // ---- generate -------------------------------------------------------------
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`\n⏳ Generating ${candidates} image(s)… (this takes ~15–30s each)\n`);
  const result = await generateImage({
    prompt,
    modelId,
    aspectRatio: ratio,
    numberOfImages: candidates,
    seed,
    negativePrompt: NEGATIVE_PROMPT,
  });

  const written = [];
  result.images.forEach((img, i) => {
    // NOTE: written as PNG on purpose. The generator returns PNG and the sprite
    // extractor prefers it: JPEG conversion puts ringing artifacts around every
    // outline, and those are exactly what the extractor's de-speckle step fights.
    const file = i === 0 ? `${slug}.png` : `${slug}-v${i + 1}.png`;
    const outPath = path.join(outDir, file);
    fs.writeFileSync(outPath, Buffer.from(img.base64, 'base64'));
    const kb = (fs.statSync(outPath).size / 1024).toFixed(0);
    console.log(`  ✅ ${file} (${kb} KB)`);
    written.push(file);
  });
  console.log(`\n  model ${result.model}, seed ${result.seed}`);

  // ---- hand off to the extractor -------------------------------------------
  const first = written[0].replace(/\.png$/, '');
  const title = opts.title || slug.replace(/-/g, ' ');
  console.log(`
Next steps
──────────
1. Look at the image(s). Pick the cleanest:
     ${written.map((f) => path.relative(process.cwd(), path.join(outDir, f))).join('\n     ')}
   Delete the ones you do not want (a sheet with touching items or a tinted
   background costs hand-placed regions later).

2. Add a sheet entry to scripts/rocket/sheets.json:

  {
    "id": "${slug}",
    "title": "${title}",
    "file": "${written[0]}",
    "options": {},
    "exclude": [],
    "regions": [],
    "names": []
  }

3. Let the detector tell you what it found, then name it in reading order:

     node scripts/rocket/extract-sprites.js --sheet ${slug} --numbers --dump-detected

   Regular grid? Prefer "gridNames" (matched by cell position) over "names".

4. Re-run and review (proof sheet for names, qa-* for halos/holes):

     node scripts/rocket/extract-sprites.js
     node scripts/rocket/qa-composite.js --sheet ${slug}
     open docs/images/rocket/preview/index.html
`);
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}\n`);
  process.exit(1);
});
