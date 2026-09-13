# Static Assets & AI Image Generation Guide

One reference for the three related asset pipelines in this app:

- **Part 1 — Static asset management** (S3 + CloudFront): serving images, videos,
  and documents from the CDN instead of the frontend bundle.
- **Part 2 — AI image generation** (AWS Bedrock → repo asset): calling the app's
  text-to-image generator and wiring the result into the repo as a usable asset.
- **Part 3 — Sprite sheets → individual sprites**: generating a white-background
  "poster" of cartoon assets and slicing it into named, transparent, individually
  cropped sprites.

Use Part 1 for "where do I put an image and how do I serve it?", Part 2 for
"how do I generate a new image for a project card and check it in?", and Part 3
for "how do I turn one AI image full of little drawings into a usable sprite set?"

---

## Part 1 — Static Assets Management (S3 + CloudFront)

### Why use S3 + CloudFront for static assets?

#### Benefits:

- **Smaller Bundle Size**: Removes large files from your frontend build.
- **Global CDN**: CloudFront delivers assets from edge locations worldwide.
- **Better Caching**: Long-term browser and CDN caching for static assets.
- **Scalability**: No server load for serving static files.
- **Cost Effective**: S3 storage + CloudFront is very cost-efficient.

#### Performance Impact:

- **Bundle Size Reduction**: Moving `simple_graphic.png` (6.4 MB) to S3 reduced the
  frontend bundle by ~6.4 MB.
- **Faster Initial Load**: Smaller bundle = faster initial page load.
- **Lazy Loading**: Images load as needed, not blocking initial render.
- **Global Performance**: CloudFront edge locations serve files closer to users.

### Current Configuration

#### S3 Bucket: `sthopwood`

- Region: `us-east-1`
- Public read access via bucket policy
- Organized folder structure

#### CloudFront Domain: `d32l7e4oaztkq2.cloudfront.net`

- Global CDN distribution
- 1-year cache TTL for static assets
- Automatic compression and optimization

### Folder Structure

```
S3 Bucket: sthopwood/
├── static/
│   ├── images/
│   │   ├── simple_graphic.png          # System overview graphic
│   │   └── [other-static-images]
│   ├── videos/
│   │   └── [promotional-videos]
│   └── documents/
│       └── [pdfs-guides-etc]
├── users/
│   └── {userId}/
│       ├── uploads/                     # User uploaded files
│       └── migrated/                    # Migrated from DynamoDB
└── temp/
    └── [temporary-files]
```

### How to Add New Static Assets

#### 1. Upload to S3

```bash
# Use the upload script
node upload-static-assets.js

# Or add to the assets array in upload-static-assets.js:
{
    localPath: '../frontend/src/assets/new-image.png',
    s3Key: 'static/images/new-image.png',
    description: 'Description of the image'
}
```

#### 2. Add to Frontend Configuration

Update `frontend/src/config/staticAssets.js`:

```javascript
export const STATIC_IMAGES = {
    SIMPLE_GRAPHIC: `${CLOUDFRONT_DOMAIN}/static/images/simple_graphic.png`,
    NEW_IMAGE: `${CLOUDFRONT_DOMAIN}/static/images/new-image.png`,
    // Add more assets here
};
```

#### 3. Use in Components

```javascript
import { STATIC_IMAGES } from '../../../config/staticAssets';

function MyComponent() {
    return (
        <img
            src={STATIC_IMAGES.NEW_IMAGE}
            alt="Description"
            loading="lazy"
            onLoad={() => console.log('Image loaded from CloudFront')}
            onError={(e) => console.error('Failed to load image')}
        />
    );
}
```

### Best Practices

#### Image Optimization

1. **Compress images** before uploading (use tools like TinyPNG, ImageOptim).
2. **Choose correct format**:
   - PNG: For graphics with transparency or text.
   - JPEG: For photos and complex images.
   - WebP: Modern format with better compression (when supported).
3. **Provide alt text** for accessibility.
4. **Use lazy loading** for images below the fold.

#### Performance

1. **Set proper cache headers**: Static assets use 1-year cache.
2. **Use responsive images**: Consider different sizes for mobile/desktop.
3. **Optimize loading**: Use `loading="lazy"` for non-critical images.
4. **Monitor bundle size**: Keep frontend bundle lightweight.

#### Security

1. **Public assets only**: Never upload sensitive files to public folders.
2. **Content validation**: Validate file types and sizes.
3. **Access control**: Use appropriate S3 bucket policies.

### Migration Checklist

When moving an asset from the frontend bundle to S3:

- [ ] Upload file to S3 using upload script
- [ ] Verify CloudFront URL is accessible
- [ ] Add URL to `staticAssets.js` configuration
- [ ] Update component to use CloudFront URL
- [ ] Test loading and error handling
- [ ] Remove local file from frontend
- [ ] Update any build scripts or references
- [ ] Document the change

### Troubleshooting (static assets)

#### Image Not Loading

1. Check CloudFront URL in browser directly.
2. Verify S3 bucket policy allows public access.
3. Check browser console for CORS errors.
4. Ensure content-type is set correctly.

#### Cache Issues

1. CloudFront has ~15 minutes propagation delay.
2. Use CloudFront invalidation for urgent updates.
3. Add cache busting for dynamic content.

#### Performance Issues

1. Optimize image sizes and formats.
2. Use lazy loading for non-critical images.
3. Consider responsive images for different screen sizes.
4. Monitor Core Web Vitals.

### Tools and Scripts (static assets)

#### Available Scripts:

- `upload-static-assets.js`: Upload static assets to S3.
- `migrate-images-to-s3.js`: Migrate existing DynamoDB images.
- `backup-dynamodb.js`: Create backups before migrations.

#### Monitoring:

- CloudWatch: Monitor S3 and CloudFront metrics.
- Browser DevTools: Check loading performance.
- Lighthouse: Monitor Core Web Vitals.

### Cost Optimization

#### S3 Storage Classes:

- **Standard**: For frequently accessed assets.
- **IA (Infrequent Access)**: For older promotional materials.
- **Glacier**: For long-term archive of assets.

#### CloudFront:

- Monitor usage and costs in AWS Console.
- Consider geographic restrictions if needed.
- Use Origin Access Identity for better security.

### Environment Variables (static assets)

Required in `.env`:

```properties
AWS_S3_BUCKET=sthopwood
AWS_S3_REGION=us-east-1
AWS_CLOUDFRONT_DOMAIN=d32l7e4oaztkq2.cloudfront.net
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
```

### Support (static assets)

For issues with static assets:
1. Check AWS Console for S3 and CloudFront status.
2. Verify environment variables are correct.
3. Test URLs directly in browser.
4. Check browser console for errors.
5. Review this documentation for best practices.

---

## Part 2 — AI Image Generation (AWS Bedrock → Repo Asset)

This part explains how an agent (or developer) can call this app's AI image
generator, and how to take the returned image and wire it into the repo as a
usable asset.

The generator is a thin HTTP wrapper around **AWS Bedrock** text-to-image
models. It returns **base64-encoded PNG data URLs**, so there is no S3
round-trip required just to get the pixels — but you can optionally persist the
result to S3/CloudFront if the asset should be served from the CDN (see §5 Path B).

> **🤖 Agent TL;DR — generating a repo asset.** You usually do **not** need the
> HTTP API, a JWT, or a running server. A reusable script already exists:
> `backend/scripts/generate-project-art.js`. It reads `backend/.env` and calls
> `services/bedrockImageService.generateImage` directly. See §4.6 for the full
> recipe (generation, PNG→JPG conversion, and wiring into the projects catalog).

### Overview

| Item | Value |
|------|-------|
| List models (public) | `GET /api/data/image/models` |
| Generate image (auth) | `POST /api/data/image/generate` |
| Auth | JWT — `Authorization: Bearer <token>` |
| Response | `{ success, images: [{ mimeType, base64 }], seed, model, provider }` |
| Rate limit | 10 requests / 15 min per user (`imageGenLimiter`) |
| Bedrock region | **`us-west-2`** for Stability generators (see §7) |
| IAM permission | `bedrock:InvokeModel` |

#### API base URL

- **Local dev:** `http://localhost:5000/api/data` (Vite proxies `/api` → `:5000`)
- **Production (`sthopwood.com`):** `/api/data` (Netlify proxy, same-origin)
- **Deploy previews / other domains:** `https://mern-plan-web-service.onrender.com/api/data`

All paths below are relative to one of these bases.

### Prerequisites

Server-side configuration (already handled in this repo, listed for reference):

- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (or the dedicated
  `AWS_BEDROCK_*` pair) with `bedrock:InvokeModel`.
- `BEDROCK_IMAGE_MODEL_ID` (optional) — override the default model.
- `AWS_BEDROCK_IMAGE_REGION` (optional) — override the image client region.
  Defaults to `us-west-2`.

Client-side, you only need a **valid JWT** (see §3).

### Authenticate

`/image/generate` is protected by the `protect` middleware, so every request
needs a Bearer token.

**Where to get a token:**

1. **From a logged-in browser session** (fastest for one-off agent work):
   ```js
   const token = JSON.parse(localStorage.getItem('user')).token;
   ```

2. **Programmatically** via the login endpoint:
   ```js
   const res = await fetch(`${BASE}/login`, {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ email: 'you@example.com', password: '••••' }),
   });
   const { token } = await res.json();
   ```

3. **Guest demo account** — the app ships a public guest login
   (`guest@gmail.com` / `guest`, see `backend/constants/guestAccount.js`), which
   scripts like `backend/scripts/test-net-image.js` use programmatically.

### Generate an image

#### List available models (public, no auth)

```
GET /api/data/image/models
```

Response:

```json
{
  "success": true,
  "defaultModel": "stability.sd3-5-large-v1:0",
  "models": [
    { "id": "stability.sd3-5-large-v1:0", "provider": "stability", "label": "Stable Diffusion 3.5 Large", "aspectRatios": ["1:1", "16:9", "21:9", "2:3", "3:2", "4:5", "5:4", "9:16", "9:21"] },
    { "id": "stability.stable-image-core-v1:1", "provider": "stability", "label": "Stable Image Core (fast)", "aspectRatios": ["1:1", "16:9", "21:9", "2:3", "3:2", "4:5", "5:4", "9:16"] },
    { "id": "stability.stable-image-ultra-v1:1", "provider": "stability", "label": "Stable Image Ultra (photoreal)", "aspectRatios": ["1:1", "16:9", "21:9", "2:3", "3:2", "4:5", "5:4", "9:16", "9:21"] },
    { "id": "gemini-2.5-flash-image", "provider": "gemini", "label": "Gemini 2.5 Flash Image (Nano Banana)", "aspectRatios": ["1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] }
  ]
}
```

#### Request body (`POST /api/data/image/generate`)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `prompt` | string | ✅ | Max 4000 chars |
| `model` | string | — | Defaults to `BEDROCK_IMAGE_MODEL_ID` or `stability.sd3-5-large-v1:0` |
| `aspectRatio` | string | — | Default `1:1`; must be supported by the model |
| `numberOfImages` | int | — | 1–4, default 1 |
| `seed` | int | — | 0–4294967295; **Stability only** |
| `negativePrompt` | string | — | What to avoid; **Stability only** |

#### curl example

```bash
TOKEN="<your-jwt>"
BASE="http://localhost:5000/api/data"   # or the Render URL

curl -X POST "$BASE/image/generate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "prompt": "A cozy isometric illustration of a tiny red dragon reading a book by a window",
    "model": "stability.sd3-5-large-v1:0",
    "aspectRatio": "1:1",
    "numberOfImages": 1
  }'
```

#### Node.js example

```js
const BASE = 'http://localhost:5000/api/data';

async function generate(prompt, token, { model, aspectRatio = '1:1', numberOfImages = 1 } = {}) {
  const res = await fetch(`${BASE}/image/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ prompt, model, aspectRatio, numberOfImages }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Image generation failed (${res.status}): ${err.error || res.statusText}`);
  }

  return res.json();
}
```

#### Response shape

```json
{
  "success": true,
  "images": [
    { "mimeType": "image/png", "base64": "iVBORw0KGgoAAAANSUhEUg…" }
  ],
  "seed": 3982716521,
  "model": "stability.sd3-5-large-v1:0",
  "provider": "stability"
}
```

The `base64` field is the raw PNG. Decode it with
`Buffer.from(img.base64, 'base64')` (Node) or `atob(img.base64)` (browser).

#### Generate directly from a Node script (recommended for repo assets)

For wiring an image into the repo, skip the HTTP API entirely — no server, no
JWT, no rate limit. Require the service directly; it reads the AWS credentials
from `backend/.env` (gitignored, and already carries `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY` in this repo).

```js
// save-art.js — run from the repo root:  node save-art.js "prompt" out-name
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'backend', '.env') });
const { generateImage, getDefaultImageModelId } = require('./backend/services/bedrockImageService');

(async () => {
  const { images, model, seed } = await generateImage({
    prompt: process.argv[2],
    modelId: getDefaultImageModelId(), // stability.sd3-5-large-v1:0 by default
    aspectRatio: '3:2',                // see the 4:3 card-crop note below
    numberOfImages: 1,
  });
  const out = path.resolve('frontend', 'src', 'assets', 'art', `${process.argv[3]}.png`);
  fs.writeFileSync(out, Buffer.from(images[0].base64, 'base64'));
  console.log(`✅ ${out} (${model}, seed ${seed})`);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
```

A ready-made version ships in the repo: `backend/scripts/generate-project-art.js`.
It holds one prompt per project card and accepts optional slugs to limit the run:

```bash
node backend/scripts/generate-project-art.js               # regenerate all
node backend/scripts/generate-project-art.js pets iqtest   # just these
```

**Prompt & style tips** (matches the site's "vibrant editorial" look — see
`docs/guides/FRONTEND_UI_STANDARD.md`):

- Ask for a *glossy 3D render* / product mockup, shallow depth of field, with a
  blurred bokeh background in the site palette: **mint/cyan, hot pink, orange, blue**.
- End every prompt with `no text` — Stability garbles words, and the existing
  art is text-free (or a single clean glyph).
- Project cards render at **4:3** with `object-fit: cover`, so a source at
  **3:2** (the closest supported landscape ratio for SD3.5 Large) fills the card
  with minimal cropping.
- The default model (`stability.sd3-5-large-v1:0`) gives the best quality; one
  image takes ~15–30 s, so a batch of ~8 is a couple of minutes.

### Implement the image as a repo asset

There are two supported ways to turn the generated PNG into an asset the repo
uses. Pick based on size and how often it changes.

#### Path A — Commit locally into `frontend/src/assets/` (bundled asset)

Best for **small, stable, app-owned assets** (icons, illustrations, section
graphics) that should ship with the frontend bundle. Vite imports these
directly and fingerprints them at build time.

1. **Decode and write the PNG** to `frontend/src/assets/`:
   ```js
   const fs = require('fs');
   const path = require('path');
   const { images } = await generate(prompt, token);
   const buf = Buffer.from(images[0].base64, 'base64');
   fs.writeFileSync(
     path.resolve('frontend/src/assets/my-generated-image.png'),
     buf,
   );
   ```

2. **Import it in a component:**
   ```jsx
   import myImage from '../../assets/my-generated-image.png';

   function MyComponent() {
     return <img src={myImage} alt="Description" loading="lazy" />;
   }
   ```

3. **Convert PNG → JPG, then check it in.** The generator always returns PNG,
   but the repo's art directory is all `.jpg`. Convert with `sharp` (already in
   `backend/node_modules`) at quality ~90 and delete the PNG:

   ```js
   // run from backend/ so `require('sharp')` resolves
   const sharp = require('sharp');
   await sharp('../frontend/src/assets/art/foo.png')
     .jpeg({ quality: 90, mozjpeg: true })
     .toFile('../frontend/src/assets/art/foo.jpg');
   fs.unlinkSync('../frontend/src/assets/art/foo.png');
   ```

   Raw SD3.5 PNGs land around **1.2–1.8 MB**; the existing art JPGs are 2–4 MB,
   so this is in line with what's already committed. JPG quality 90 shrinks each
   file to a few hundred KB.

4. **Wire it into the catalog.** Project cards aren't hardcoded in a page — they
   come from `frontend/src/constants/projects.js` (the `PROJECTS` array). Add an
   import and set `art` on the entry:

   ```js
   import artFoo from '../assets/art/project-foo.jpg';
   // …
   { name: "Foo", path: "/foo", art: artFoo, category: "Tools", description: "…" },
   ```

   - The same `PROJECTS` array drives the `/projects` page **and** the homepage
     "Start with a tool" carousel, so new art propagates to both automatically.
   - Keep each project's `path` in sync with the routes in `App.js`.
   - The homepage's `FEATURED_PROJECTS` curated tiles use the `feature-*.jpg`
     category images (imported directly in `Home.jsx`). Don't delete those when
     deduplicating project cards — they're intentional.

#### Path B — Upload to S3 and serve via CloudFront (CDN asset)

Best for **larger images** or assets that should not bloat the frontend bundle.
This is the pipeline documented in Part 1 of this guide.

1. **Upload the decoded buffer to S3** under `static/images/`. Either:
   - Use the existing script: `node backend/scripts/upload-static-assets.js`
     (add the file to its `assets` array), or
   - Call the backend helper directly:
     ```js
     const { uploadImageBuffer } = require('./backend/services/s3Service');
     const buf = Buffer.from(images[0].base64, 'base64');
     const uploaded = await uploadImageBuffer('system', buf, 'image/png', 'static');
     // uploaded.url → https://d32l7e4oaztkq2.cloudfront.net/.../image-....png
     ```
     (For a stable filename, pass an explicit `filename` argument.)

2. **Register the URL** in `frontend/src/config/staticAssets.js`:
   ```js
   export const STATIC_IMAGES = {
     SIMPLE_GRAPHIC: `${CLOUDFRONT_DOMAIN}/static/images/simple_graphic.png`,
     MY_GENERATED_IMAGE: `${CLOUDFRONT_DOMAIN}/static/images/my-generated-image.png`,
   };
   ```

3. **Use it in a component:**
   ```jsx
   import { STATIC_IMAGES } from '../../../config/staticAssets';

   <img src={STATIC_IMAGES.MY_GENERATED_IMAGE} alt="Description" loading="lazy" />;
   ```

> **Which path?** Prefer **Path A** for assets under ~100 KB that are intrinsic
> to the app's UI. Prefer **Path B** for large or user-content images — it keeps
> the bundle small and leverages CloudFront caching.

### Full worked example (Node script)

Generates an image, then saves it locally as a bundled asset:

```js
// generate-and-save.js — run from the repo root:
//   node generate-and-save.js "a tiny red dragon reading a book"
const fs = require('fs');
const path = require('path');

const BASE = process.env.API_BASE || 'http://localhost:5000/api/data';
const EMAIL = process.env.APP_EMAIL;
const PASSWORD = process.env.APP_PASSWORD;
const prompt = process.argv[2] || 'a cozy isometric tiny red dragon reading a book';

async function main() {
  // 1. Log in to get a JWT
  const login = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  }).then((r) => r.json());
  if (!login.token) throw new Error(`Login failed: ${JSON.stringify(login).slice(0, 200)}`);

  // 2. Generate the image
  const res = await fetch(`${BASE}/image/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${login.token}`,
    },
    body: JSON.stringify({ prompt, aspectRatio: '1:1', numberOfImages: 1 }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(`Generation failed: ${data.error}`);

  // 3. Save as a bundled asset
  const out = path.resolve('frontend/src/assets/generated-image.png');
  fs.writeFileSync(out, Buffer.from(data.images[0].base64, 'base64'));
  console.log(`✅ Saved ${out} (${data.images[0].base64.length} b64 chars, seed ${data.seed})`);
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
```

Run it with credentials in the environment:

```bash
APP_EMAIL=you@example.com APP_PASSWORD='••••' node generate-and-save.js "your prompt"
```

### Troubleshooting (image generation)

| Symptom | Cause / fix |
|---------|-------------|
| `503 Image generation is not configured` | Bedrock credentials not present server-side. Check `AWS_*` env vars. |
| `429` / "temporarily busy" | `BEDROCK_THROTTLED` or per-user rate limit (10/15 min). Wait and retry. |
| `400 Unsupported aspect ratio` | The ratio isn't in the model's `aspectRatios` list — call `/image/models` first. |
| `400 Unsupported image model` | Pass a valid `model` id from `/image/models`. |
| `401 Not authorized` | Missing/expired JWT. Re-login and pass `Authorization: Bearer <token>`. |
| "The provided model identifier is invalid" | Two different causes, and the region is only one. (a) The **Stability** generators need **us-west-2**, not us-east-1. (b) A model listed in `IMAGE_MODELS` may not be **invocable at all** — as of 2026-09 `gemini-2.5-flash-image` rejects every id variant (`gemini-2.5-flash-image`, `google.gemini-2.5-flash-image`, `…-v1:0`) in BOTH `us-west-2` and `us-east-1`, so the registry entry advertises something the account cannot call. Verify with `backend/scripts/list-bedrock-models.js <region>` before assuming it is a region problem. |
| First call hangs / access error | New-region first invoke triggers an AWS account-verification gate (~2h). |
| Terminal "returns" after only one image | The script is still running in the background. Confirm with `Get-Process node` and re-list the art directory before assuming it failed. |

#### Diagnostics

- `node backend/scripts/list-bedrock-models.js us-west-2` — confirm which image
  models are active in a region.
- `node backend/scripts/test-net-image.js "generate an image of …"` — end-to-end
  net-chat image test (logs in as the guest account).
- `npx vite build` (from `frontend/`) — verify the new imports bundle. PowerShell
  may print a `node.exe` `NativeCommandError` at the end; that's just Vite's
  chunk-size warning on stderr, not a build failure.

#### Region gotcha (important)

The **Stability** text-to-image generators (SD3.5 Large / Core / Ultra) are
**only active in `us-west-2`**. `us-east-1` only has the legacy Nova Canvas and
Stability *editing* tools. The image client already defaults to `us-west-2`
independently of the chat client region, but if you override
`AWS_BEDROCK_IMAGE_REGION`, make sure it's a region where your chosen model is
active.

---

## Part 3 — Sprite Sheets → Individual Transparent Sprites

This part documents the pipeline that produced the `/rocket` game's art:
**8 AI-generated white-background "posters" → 282 named, transparent, tightly
cropped PNGs (~4 MB)**. It is source-agnostic: as long as the source is a white
background covered in separated cartoon drawings, the extractor handles it.

> **🤖 Agent TL;DR — slicing a sheet.**
> 0. Need a sheet in the first place? Generate one (§ "Generating the source
>    sheet" below) — `backend/scripts/generate-sprite-sheet.js --dry-run` first.
> 1. Drop the image in `frontend/src/assets/rocket/`.
> 2. Add an entry to `scripts/rocket/sheets.json` (`id`, `title`, `file`).
> 3. `node scripts/rocket/extract-sprites.js --sheet <id> --numbers --dump-detected`
> 4. Read the numbered overlay, write the `names` array in reading order (or a
>    `gridNames` table for a regular grid), then re-run until the counts line up.
>    If a poster has several equally-sized variants you want to *choose* between, or
>    an item the detector cannot isolate, measure those boxes in
>    **`/uimapper`** and paste them as `regions` — see
>    "Mapping `regions` with the UIMapper" below.
> 5. Review `docs/images/rocket/preview/index.html` (names) and
>    `qa-<sheet>.png` (halo/hole check). Fix the **spec**, never the script.
>
> Deep reference: `docs/guides/Rocket-Asset-Pipeline.md`.

### What was actually built

| Item | Value |
|------|-------|
| Source | 8 JPEG "posters", **2816×1536**, ~2.1–2.5 MB each |
| Source origin | Google Gemini. User prompt: *"the prompt will be describing a white background image with cartoon assets to be used in a 2D rocket game"* — see "Generating the source sheet" below to do this with Bedrock instead |
| Extractor | `scripts/rocket/extract-sprites.js` (Node + `sharp`) |
| Spec | `scripts/rocket/sheets.json` |
| QA | `scripts/rocket/qa-composite.js` |
| Output | `frontend/public/rocket/*.png` (282 files) + `manifest.json` |
| Review artefacts | `docs/images/rocket/preview/` (**not** shipped) |
| Total weight | **4.0 MB** (was 22 MB before sizing + quantisation) |

Notes that matter:

- `sharp` is loaded from `backend/node_modules/sharp` — it is **not** hoisted to
  the repo root, so a new script must resolve it the same way:
  `require(path.join(ROOT, 'backend', 'node_modules', 'sharp'))`.
- Output goes to `frontend/public/`, **not** `frontend/src/assets/` — this is the
  Coliseum raster convention: the sprites are fetched by URL at runtime and stay
  out of the JS bundle. See Part 1 for when to prefer the CDN instead.
- Review images go under `docs/` deliberately. Anything in `frontend/public/`
  ships to production, and the proof sheets are ~22 MB.

### Generating the source sheet (Bedrock instead of Gemini)

Gemini produced the original eight sheets, but the same thing is one Bedrock call.
A ready-made script ships in the repo — it calls `services/bedrockImageService.js`
directly (no server, no JWT, no rate limit), so it only needs the AWS credentials
already in `backend/.env`:

```bash
# What would be sent, and do credentials resolve? Costs nothing:
node backend/scripts/generate-sprite-sheet.js \
  --slug rocket-pack-2 --ratio 16:9 --candidates 3 --dry-run \
  --assets "four retro rockets in different sizes, six capsule modules, five engine nozzles"

# Generate it:
node backend/scripts/generate-sprite-sheet.js \
  --slug rocket-pack-2 --ratio 16:9 --candidates 3 \
  --assets "four retro rockets in different sizes, six capsule modules, five engine nozzles"

node backend/scripts/generate-sprite-sheet.js --list-models
```

| Flag | Purpose |
| --- | --- |
| `--slug <name>` | required; output base name → `<slug>.png` |
| `--assets "<list>"` | required; the objects to put on the sheet |
| `--title <text>` | echoed into the printed `sheets.json` snippet |
| `--style <text>` | optional look hint ("chrome and matte-red livery") |
| `--ratio <r>` | default `16:9`; landscape gives more columns |
| `--model <id>` | default from `BEDROCK_IMAGE_MODEL_ID`, else SD3.5 Large |
| `--candidates <n>` | variants → `<slug>.png`, `<slug>-v2.png`, … (max 4) |
| `--seed <int>` | deterministic seed (Stability models only) |
| `--out <dir>` | default `frontend/src/assets/rocket` |
| `--dry-run` | print the prompt + resolved settings; never call Bedrock |
| `--list-models` | print each model and the ratios it supports |

It writes straight into `frontend/src/assets/rocket/` (where the extractor looks)
and finishes by printing the exact `sheets.json` entry plus the extractor commands
to run next, so the hand-off from generation to slicing is one command.
`--dry-run` also reports whether AWS credentials resolve — the fastest way to tell
"my prompt is wrong" apart from "my env is wrong", and it validates the ratio
against the chosen model before you spend anything.

> **ℹ️ Image generation is pre-authorized** by the repo owner (2026-09-12) when a
> task genuinely requires a new sprite sheet. Running `--dry-run` first is still
> the rule — it catches prompt and credential mistakes for free.

#### Prompt template that produces a *sliceable* sheet

The prompt matters more than the pipeline. This is the shape to use — the
critical parts are **pure white background**, **wide even gaps**, and **no text**:

```
A single sprite sheet of cartoon 2D game assets on a PURE WHITE background,
arranged in a neat grid with wide, even gaps between every item. Flat vector
cartoon style, bold dark outlines, vivid saturated colours, even flat lighting.
Every object is fully separated with generous white space around it, nothing
touches or overlaps, no shadows on the background. NO text, NO labels, NO
numbers, NO captions, NO borders, NO panels, NO grid lines. The sheet contains:
<comma-separated list of the assets you want>.
```

Practical tips:

- **List the assets explicitly** ("four retro rockets in different sizes, six
  capsule modules, five engine nozzles…"). Vague lists produce a pretty poster,
  not a sheet.
- **16:9 or 21:9** gives the most columns. SD3.5 Large supports both; 21:9 needs
  `stability.stable-image-ultra-v1:1` or `sd3-5-large-v1:0` (check
  `GET /api/data/image/models`, and remember the **us-west-2** gotcha in Part 2).
- **The Gemini model ignores aspect ratio.** `gemini-2.5-flash-image` accepts an
  `aspectRatio` argument and then does not use it — the returned shape is up to
  the model. For a sprite sheet, where the layout is the whole point, use a
  Stability model. The script warns when you pick Gemini.
- **Keep the source as PNG.** This is the one place where Part 2's usual
  "PNG → JPG at quality 90" step is **skipped**. JPEG puts ringing artifacts
  around every outline, and those are exactly what the extractor's de-speckle
  step has to fight. The original `/rocket` sheets were JPEGs and still worked,
  but a PNG source extracts measurably more cleanly.
- **One theme per sheet.** Mixing rockets, planets and UI icons on one image
  makes the detector's job much harder.
- **Avoid anything the extractor must drop anyway**: progress bars, percentage
  badges, star-rating demo rows, rounded panel frames — that is all UI chrome
  better drawn in code.
- Generate 2–4 candidates and pick the cleanest. Sheets with touching items or a
  grey-tinted background cost manual `regions` work later.

#### What makes a sheet easy vs painful

| Source trait | Effect on extraction |
| --- | --- |
| Pure white background | ✅ cleanly classified as background |
| Light **grey / tinted** background or panels | ⚠️ survives as a solid shape (see "Gotchas" below) |
| Wide even gutters | ✅ XY-cut separates cleanly and reading order is obvious |
| Items touching / overlapping | ❌ fuse into one sprite — needs hand-placed `regions` |
| Dark, low-saturation captions | ✅ auto-removed by the text filter |
| Bright/coloured text, digits, badges | ⚠️ survives as sprites — `exclude` them |
| Neat rows/columns | ✅ `gridNames` can name the whole sheet by cell position |

### How the extractor works

The full walkthrough is in `docs/guides/Rocket-Asset-Pipeline.md`. The short
version, because knowing *why* is what lets you debug a new sheet:

1. **Classify pixels.** "Light **and** unsaturated" = background. That covers the
   page white *and* the light-grey panel fill in one rule.
2. **De-speckle.** JPEG ringing pushes a few percent of a flat light area under
   the threshold. Left alone, those stray pixels bridge every gutter and the
   whole sheet collapses into one blob.
3. **Erase the furniture before segmenting.** Connected components are dropped as
   `tiny` (speck), `frame` (big but nearly empty = an outline), `bar` (solid and
   extremely elongated = a progress bar) or `text` (short + desaturated + sparse
   = a caption). Erasing text *first* is what lets a caption row collapse so the
   icon rows above and below it merge into one clean gutter.
4. **XY-cut.** Recursively split the remaining mask on its empty gutters — rows
   first, then columns. A leaf is one sprite. Depth-first order *is* reading
   order (top→bottom, left→right), which is the order `names` applies in.
5. **Export each leaf.** Alpha ramps from the RGB distance to the crop's **local**
   background colour (estimated from its border ring), then partially transparent
   edge pixels are un-matted (de-fringed) so there is no white halo, then a flood
   fill from the crop border makes sure **enclosed** light pixels — a white rocket
   body, a visor highlight — stay opaque instead of being punched into holes.
   Finally: trim to content, cap the longest side, write PNG.

### The spec (`scripts/rocket/sheets.json`)

```jsonc
{
  "defaults": { "pad": 12, "minSize": 30, "maxDim": 160, "png": { "palette": true } },
  "sheets": [
    {
      "id": "effects",                 // used for output names + --sheet
      "title": "Explosions, shield hits, sparks, plasma",
      "file": "Gemini_Generated_Image_9981k79981k79981.jpg",
      "options": { "minGutterRow": 14 }, // per-sheet detector/export overrides
      "exclude": [{ "x": 0.58, "y": 0.02, "w": 0.41, "h": 0.58 }],
      "regions": [{ "name": "ui-star-gold", "x": 0.0366, "y": 0.6719, "w": 0.0348, "h": 0.0677 }],
      "names": ["explosion-small-red", "explosion-small-red-2"],
      "gridNames": { "rows": 5, "cols": 9, "names": ["planet-saturn-tan"] }
    }
  ]
}
```

- **`names`** — for auto-detected sprites, in reading order. A count mismatch
  prints exactly how many were found versus supplied, which is the signal to
  re-read the numbered overlay.
- **`gridNames`** — for regular r×c sheets. Names are matched **by cell centre,
  not by detection order**, so a merged pair or a missed item can never shift
  every later name by one. Add `expectGaps` (a string reason) to downgrade the
  "empty cell" report to an informational note when the gaps are deliberate.
- **`exclude`** — rectangles whose contents must never become assets.
- **`regions`** — hand-placed crops for anything the detector cannot judge.
- Rects are **fractions of the sheet** unless `"unit": "px"` is set.

### Mapping `regions` with the UIMapper (`/uimapper`)

The detector is good at finding items that are already separated by white space. It
**cannot** judge *which* of a poster's many variants you want, and it cannot split two
drawings that physically touch. That is what `regions` is for — and the tool for
authoring them already ships in this app.

**`https://sthopwood.com/uimapper`** (route `/uimapper`) is a visual spec editor:

| Control | What it does |
| --- | --- |
| **Upload** an image | Loads any screenshot or poster as the drawing surface |
| **Drag** on the image | Draws a box; boxes can be moved/resized by their handles |
| Name field (per box) | Sets the region name — this becomes the **texture key** |
| **Auto map (AI)** | Asks the backend to propose boxes + names (requires a signed-in user; server-paid Bedrock vision) |
| **Load map** | Loads a saved map JSON — this tool's export, or a sprite-extractor `regions` array — so boxes can be **renamed and nudged instead of redrawn** |
| **Download JSON** / **Copy JSON** | Exports the spec |

Its export is *almost* the extractor's format already — it emits **both** pixel and
normalized coordinates, and `regions` wants normalized:

```jsonc
// ui-map.json — what UIMapper downloads
{
  "source": "coliseum-ui-panel.png",
  "width": 1344,
  "height": 768,
  "regions": [
    { "name": "ui-panel", "x": 359, "y": 116, "w": 83, "h": 64,
      "nx": 0.2670, "ny": 0.1515, "nw": 0.0614, "nh": 0.0833 }
  ]
}

// scripts/coliseum/sheets.json — the same box, renamed fields
"regions": [
  { "name": "ui-panel", "x": 0.2670, "y": 0.1515, "w": 0.0614, "h": 0.0833 }
]
```

**The conversion is just `x→nx, y→ny, w→nw, h→nh`.** Paste a UIMapper export into
the browser console to do it mechanically:

```js
const map = JSON.parse(uiMapperJson);
console.log(JSON.stringify(
  map.regions.map((r) => ({ name: r.name, x: r.nx, y: r.ny, w: r.nw, h: r.nh })),
  null, 2,
));
```

Prefer the **normalized** form: it survives re-generating the sheet at a different
size or ratio. If you would rather keep pixels, add `"unit": "px"` to each rect —
but that is only safe when the image you uploaded is exactly the file the extractor
reads, since percentages are resolved against the real image.

Two more things the same boxes give you:

- **`exclude`** takes the same rectangle shape (it ignores `name`), so a box drawn
  over a banner, badge or demo grid pastes straight into `exclude`.
- **`regionPad`** — set it to `2` on a sheet that uses `regions`. Hand-placed crops
  are authored precisely, so the default `pad: 12` would only pull in whatever sits
  on the other side of the gutter.

**Round trip:** upload → draw → **Copy JSON** → convert → paste into the pack's
`sheets.json` → re-run the extractor → check `docs/images/<pack>/preview/index.html`
and `<sheet>-regions.png` to confirm every box landed where you meant. **Only ever
edit the spec, never the script.**

**Coming back the other way — the agent→human handoff.** A map can be produced by an
agent (or recovered from an earlier session) and then *reviewed by hand*:

1. The agent writes a map JSON — the same shape this tool exports.
2. Open `/uimapper`, **upload the poster**, then **Load map** and pick that file.
3. Every box appears, already named and coloured. **Rename them in the table**,
   drag the ones that are off, delete the ones you do not want.
4. **Download JSON** → paste back into `sheets.json` (the `x→nx` conversion above).

`Load map` resolves the `x/y/w/h` ambiguity the same way the extractor does — pixel
rects when a rect says `"unit": "px"` or any value exceeds 1, fractions otherwise —
so a hand-written map and a tool export are both accepted without a flag. If the map
was measured against a differently-**shaped** image than the one you uploaded, it says
so rather than silently placing boxes in the wrong spots.

**Seeding a map from the detector** — so you are *renaming* rather than drawing. The
detector already knows where the items are; it just cannot know what they are called:

```bash
# 1. ask the extractor what it found (a staging --out keeps this out of frontend/public)
node scripts/rocket/extract-sprites.js --spec scripts/coliseum/sheets.json \
  --sheet ui-panel --out docs/images/coliseum/staging --no-preview --dump-detected

# 2. turn those boxes into a loadable map, written beside the source image
node scripts/coliseum/detected-to-map.js --sheet ui-panel
```

That writes `frontend/src/assets/coliseum/coliseum-ui-panel.map.json` — 27 boxes for
the panel poster, each named `ui-panel-N`. Upload the poster, **Load map**, rename the
handful you want, delete the rest, download, paste back as `regions`.

> `--dump-detected` deliberately **ignores `keepLargest`**. The dump exists to show you
everything the detector saw so you can choose between the variants; trimming it to
the exported count would hide exactly the options you are trying to pick between.
> (Verified on the panel poster: 27 boxes load and land tight on each plaque.)

> Names become texture keys and must be unique **across the whole pack** — every
> sheet exports into one flat folder, so a clash between two sheets would overwrite
> silently. The extractor suffixes the loser and warns rather than losing a file.

> **Worked example — the Coliseum chrome.** `coliseum-ui-panel.png` is a poster of
> ~30 red/gold Roman plaques. Auto-detection found 27 separate blobs and `keepLargest`
> picked an arbitrary one (a shield-shaped plaque, 194×237). Drawing three boxes in
> UIMapper instead — a wide horizontal panel, a framed medallion, a banner — gives
> exactly those three, named, in one pass. This is the case `regions` exists for.

### CLI

**Sheets are grouped into a _pack_**, named after the folder holding its
`sheets.json`. The extractor derives all three of its directories from that name, so
one script serves every pack:

| Spec | Sources read from | PNGs exported to | Review artefacts |
| --- | --- | --- | --- |
| `scripts/rocket/sheets.json` (default) | `frontend/src/assets/rocket` | `frontend/public/rocket` | `docs/images/rocket/preview` |
| `scripts/coliseum/sheets.json` | `frontend/src/assets/coliseum` | `frontend/public/coliseum` | `docs/images/coliseum/preview` |

```bash
# the rocket pack (no flags — unchanged default behaviour)
node scripts/rocket/extract-sprites.js
node scripts/rocket/extract-sprites.js --sheet effects    # one sheet
node scripts/rocket/extract-sprites.js --numbers          # overlay labels are #index
node scripts/rocket/extract-sprites.js --dump-detected    # -> scripts/<pack>/detected.json
node scripts/rocket/extract-sprites.js --debug-mask       # foreground mask PNGs

# another pack: point at its spec, or override any directory explicitly
node scripts/rocket/extract-sprites.js --spec scripts/coliseum/sheets.json
node scripts/rocket/extract-sprites.js --spec scripts/coliseum/sheets.json --src <dir> --out <dir> --preview-dir <dir>

node scripts/rocket/qa-composite.js [--sheet <id>]        # sprites on magenta
```

**Sheet option worth knowing: `keepLargest: N`.** AI sheets tend to add unrequested
filler beneath the briefed items (bonus small helms, gems, shields). `keepLargest`
keeps the N biggest sprites and drops the rest, filtering **in place** so reading
order — and therefore `names` — survives. It is the right tool when the briefed items
are reliably the largest and the naming is positional. It is the **wrong** tool when
the sheet is a poster of equally-sized variants (an area ranking then picks
arbitrarily) or when the subject is thin and wide (a divider rule has a small area, so
it loses to any blob) — use `regions` for those.

Verification behaviour worth knowing: the run **prunes stale PNGs** (renaming an
asset cannot leave an orphan behind) and **enforces names unique across all
sheets**, because every sheet exports into one flat folder — otherwise two sheets
with a `debris-panel.png` would silently overwrite each other.

### Recipe: add another sheet

1. Put the image in `frontend/src/assets/rocket/`.
2. Add `{ "id", "title", "file" }` to `scripts/rocket/sheets.json`.
3. `node scripts/rocket/extract-sprites.js --sheet <id> --numbers --dump-detected`.
   The overlay (and `detected.json`) now tell you what was found, in order.
4. Write the names:
   - regular grid → `gridNames` (measure the cell geometry if it is uneven;
     column/row profiles are the reliable way, not eyeballing);
   - irregular → `names` in the numbered-overlay order;
   - add `exclude` for baked-in text/badges you do not want, and `regions` for
     anything the detector misjudges — **measure `regions` (and any `exclude` boxes)
     in `/uimapper`** rather than by eye; see "Mapping `regions` with the UIMapper".
5. Re-run, then review `docs/images/rocket/preview/index.html` and
   `qa-<sheet>.png`. **Only ever edit the spec** — the script's defaults are
   tuned for white-background sheets and should not need changing per sheet.

### Sizing & weight

Cartoon art with soft glows is expensive as 32-bit PNG — roughly **80 KB for a
256px sprite**, which put the first full export at **22 MB**. What brought the
282-sprite set to **4 MB**:

- **`maxDim: 160`** by default (sprites are drawn small on a 1280×720 canvas),
  raised per sheet where it matters: **320** for the two grids, **384** for the
  rockets, **512** for the backdrops.
- **PNG palette quantisation** (`png.palette` + `quality: 92`) — the single
  biggest win and visually lossless on this art.
- Pruning stale exports.

If a smaller payload is ever needed, switching `png` to WebP is a one-line spec
change. Prefer **Path A** in Part 2 for anything under ~100 KB that is intrinsic
to the UI, and Part 1's S3/CloudFront path for large or rarely-changing sheets.

### Gotchas (each of these cost real debugging time)

1. **Strip long runs only when they are also thin.** "Remove every long run"
   deletes tall sprites — a rocket body is a long run. Panel frames and progress
   bars are long *and* thin.
2. **Erase furniture before stripping lines.** Judge a panel outline as a *whole*
   outline. Strip its straight edges first and a blank panel is reduced to four
   corner arcs that look exactly like four small sprites.
3. **Do not merge blobs by proximity.** It cascades: merging two neighbours grows
   the box, which reaches the next one, and whole panels get swallowed. XY-cut
   only ever cuts on genuinely empty space.
4. **Hand-placed regions need a smaller pad** (`regionPad: 2`, not `pad: 12`).
   They are authored precisely, so a wide pad only pulls in whatever sits on the
   other side of the gutter — e.g. the neighbouring planet's ring.
5. **Grey/tinted backgrounds beat the background classifier.** A light panel that
   is *lower* than the background threshold becomes a solid shape and exports as a
   border with a ghost fill. Fix by `exclude`-ing that area, not by raising the
   luminance threshold (which would start eating pale sprites).
6. **Fused items cannot be split by any gutter setting.** If two drawings are
   physically connected in the pixels (an overlapping ring, a shadow, a touch),
   `exclude` the fusion and re-take each sprite as a `regions` crop. Get the
   geometry by measuring the column/row profile, not by eye.
7. **Near-white sprites can be eaten by the text filter.** Very faint spark/debris
   frames fail "short + desaturated + sparse" and are erased. Check the QA sheet
   for missing animation frames before assuming the art is complete.
8. **`frontend/public/` ships.** Never let a review artefact land there.
9. **Extracting a sprite is only half the job — it also has to be *loaded*.**
   The game fetches exactly what `requiredSprites()` returns
   (`frontend/src/pages/Projects/Rocket/game/core/tables.ts`) and nothing else, so
   a sprite that is drawn but missing from that list is silently never requested
   and Phaser renders its own green "missing texture" box. The trap is that the
   affected screen is never the one being worked on: ships appear on the menu and
   shop icons between waves. Add the name to the relevant table (enemies, pickups,
   effects, bullets, thrusters, backgrounds, stars, `SHIPS`, `UPGRADES`) rather
   than sprinkling the literal into a scene, and let
   `game/core/sprites.test.ts` catch the rest.
10. **Windows shell flakiness** in this workspace: `node`/`npx` intermittently
    vanish from `PATH` and a leading `&` can be rejected. Reliable forms:
    `$env:Path += ';C:\Program Files\nodejs'; node <script>` or
    `& 'C:\Program Files\nodejs\node.exe' '<abs script>'`.

---

## Related docs

- `backend/scripts/generate-sprite-sheet.js` — generates a white-background sprite
  sheet via Bedrock (Part 3's source step).
- `docs/guides/Rocket-Asset-Pipeline.md` — the sprite-extraction pipeline in full
  (Part 3's deep reference).
- `scripts/rocket/extract-sprites.js`, `scripts/rocket/sheets.json`,
  `scripts/rocket/qa-composite.js` — the pipeline itself.
- `docs/guides/AWS_SETUP_GUIDE.md` — one-time S3/CloudFront setup.
- `docs/guides/SECRETS_MANAGEMENT.md` — where `BEDROCK_IMAGE_MODEL_ID` and AWS
  credentials live in production.
- `backend/services/bedrockImageService.js` — model catalog + generation logic.
- `backend/controllers/imageGenController.js` — HTTP endpoint validation.
- `backend/scripts/generate-project-art.js` — reusable repo-asset generator (§4.6).
- `docs/guides/FRONTEND_UI_STANDARD.md` — the visual style prompts should match.
