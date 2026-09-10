# Static Assets & AI Image Generation Guide

One reference for the two related asset pipelines in this app:

- **Part 1 — Static asset management** (S3 + CloudFront): serving images, videos,
  and documents from the CDN instead of the frontend bundle.
- **Part 2 — AI image generation** (AWS Bedrock → repo asset): calling the app's
  text-to-image generator and wiring the result into the repo as a usable asset.

Use Part 1 for "where do I put an image and how do I serve it?" and Part 2 for
"how do I generate a new image for a project card and check it in?"

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
| "The provided model identifier is invalid" | Model not active in the region. Stability generators need **us-west-2**, not us-east-1. |
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

## Related docs

- `docs/guides/AWS_SETUP_GUIDE.md` — one-time S3/CloudFront setup.
- `docs/guides/SECRETS_MANAGEMENT.md` — where `BEDROCK_IMAGE_MODEL_ID` and AWS
  credentials live in production.
- `backend/services/bedrockImageService.js` — model catalog + generation logic.
- `backend/controllers/imageGenController.js` — HTTP endpoint validation.
- `backend/scripts/generate-project-art.js` — reusable repo-asset generator (§4.6).
- `docs/guides/FRONTEND_UI_STANDARD.md` — the visual style prompts should match.
