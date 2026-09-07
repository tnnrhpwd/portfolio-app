# AWS — S3, CloudFront & Asset Pipeline Guide

One-stop reference for the app's AWS asset infrastructure, in three parts:

1. **Part 1 — One-time setup** (S3 bucket + CloudFront distribution).
2. **Part 2 — Static asset management** (day-to-day S3/CloudFront workflow).
3. **Part 3 — AI image generation** (AWS Bedrock → repo asset).

---

## Part 1 — One-time setup (S3 + CloudFront)

### Step 1: Create S3 Bucket

#### 1.1 Create the Bucket
```bash
# Using AWS CLI (or use AWS Console)
aws s3 mb s3://sthopwood-portfolio-files --region us-east-1
```

**Or via AWS Console:**
1. Go to S3 in AWS Console
2. Click "Create bucket"
3. Bucket name: `sthopwood-portfolio-files`
4. Region: `US East (N. Virginia) us-east-1`
5. Block all public access: ✅ **KEEP CHECKED** (CloudFront will access privately)
6. Create bucket

#### 1.2 Configure CORS Policy
```json
[
    {
        "AllowedHeaders": ["*"],
        "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
        "AllowedOrigins": [
            "https://sthopwood.com",
            "https://www.sthopwood.com",
            "http://localhost:3000",
            "http://localhost:5000"
        ],
        "ExposeHeaders": ["ETag", "x-amz-meta-*"]
    }
]
```

**To apply CORS:**
1. Go to your S3 bucket → Permissions tab
2. Scroll to "Cross-origin resource sharing (CORS)"
3. Click Edit and paste the JSON above
4. Save changes

### Step 2: Create CloudFront Distribution

#### 2.1 Create Distribution
1. Go to CloudFront in AWS Console
2. Click "Create Distribution"
3. Configure as follows:

**Origin Settings:**
- Origin Domain: `sthopwood-portfolio-files.s3.us-east-1.amazonaws.com`
- Origin Path: (leave empty)
- Name: `sthopwood-s3-origin`
- Origin Access: **Origin Access Control (OAC)** ← IMPORTANT!
- Create new OAC if needed

**Default Cache Behavior:**
- Viewer Protocol Policy: `Redirect HTTP to HTTPS`
- Allowed HTTP Methods: `GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE`
- Cache Headers: `Cache based on selected request headers`
- Select: `Origin`
- TTL Settings: Default (86400 seconds)

**Distribution Settings:**
- Price Class: Use all edge locations (best performance)
- WAF: Do not enable WAF
- Description: "Portfolio App File Delivery"

4. **Create Distribution** (takes 10-15 minutes to deploy)

#### 2.2 Update S3 Bucket Policy
After creating CloudFront, you need to allow CloudFront access to your private S3 bucket:

1. Go back to S3 bucket → Permissions → Bucket policy
2. Add this policy (replace `E1234567890123` with your CloudFront distribution ID):

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "AllowCloudFrontServicePrincipal",
            "Effect": "Allow",
            "Principal": {
                "Service": "cloudfront.amazonaws.com"
            },
            "Action": "s3:GetObject",
            "Resource": "arn:aws:s3:::sthopwood-portfolio-files/*",
            "Condition": {
                "StringEquals": {
                    "AWS:SourceArn": "arn:aws:cloudfront::YOUR_ACCOUNT_ID:distribution/YOUR_DISTRIBUTION_ID"
                }
            }
        }
    ]
}
```

### Step 3: Update Environment Variables

Update your `.env` file with the actual CloudFront domain:

```env
# After CloudFront deploys, you'll get a domain like:
AWS_CLOUDFRONT_DOMAIN=d1234abcd5678.cloudfront.net

# Verify these are correct:
AWS_S3_BUCKET=sthopwood-portfolio-files
AWS_S3_REGION=us-east-1
USE_CLOUDFRONT=true
```

### Step 4: Test the Setup

#### 4.1 Test File Upload
1. Start your backend server
2. Log into your app
3. Go to any InfoData page
4. Click "Show Upload" and try uploading an image
5. Verify the file appears with cloud storage indicator

#### 4.2 Test CloudFront Delivery
1. After uploading, check the Network tab in browser dev tools
2. Image requests should come from your CloudFront domain
3. First load may be slow (cache miss), subsequent loads should be fast

#### 4.3 Test OCR Processing
1. Upload an image file
2. Use the OCR extraction feature
3. Verify it works with S3 URLs (no more connection resets!)

### The Complete Workflow (As Implemented)

#### File Upload Process:
1. **Frontend** → Requests pre-signed URL from backend
2. **Backend** → Generates pre-signed S3 URL (15-minute expiration)
3. **Frontend** → Uploads file directly to S3 using pre-signed URL
4. **Backend** → Confirms upload and stores metadata in DynamoDB
5. **Frontend** → Updates UI with file information

#### File Display Process:
1. **Frontend** → Requests data from backend
2. **Backend** → Queries DynamoDB for file metadata (including S3 keys)
3. **Frontend** → Constructs CloudFront URLs using S3 keys
4. **Browser** → Requests files from CloudFront
5. **CloudFront** → Serves from cache or fetches from S3

#### OCR Processing:
1. **Frontend** → Sends S3 CloudFront URL to backend OCR service
2. **Backend** → XAI Vision API processes image from URL (no base64!)
3. **Result** → No more connection resets, fast processing

### Security Features Implemented

✅ **Private S3 Bucket** - Only CloudFront can access files
✅ **Pre-signed URLs** - Temporary upload permissions (15 minutes)
✅ **File Validation** - Type, size, and name sanitization
✅ **User Isolation** - Files organized by user ID

---

## Part 2 — Static asset management

### Why Use S3 + CloudFront for Static Assets?

#### Benefits:
- **Smaller Bundle Size**: Removes large files from your frontend build
- **Global CDN**: CloudFront delivers assets from edge locations worldwide
- **Better Caching**: Long-term browser and CDN caching for static assets
- **Scalability**: No server load for serving static files
- **Cost Effective**: S3 storage + CloudFront is very cost-efficient

#### Performance Impact:
- **Bundle Size Reduction**: Moving `simple_graphic.png` (6.4MB) to S3 reduced frontend bundle by ~6.4MB
- **Faster Initial Load**: Smaller bundle = faster initial page load
- **Lazy Loading**: Images load as needed, not blocking initial render
- **Global Performance**: CloudFront edge locations serve files closer to users

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
1. **Compress images** before uploading (use tools like TinyPNG, ImageOptim)
2. **Choose correct format**:
   - PNG: For graphics with transparency or text
   - JPEG: For photos and complex images
   - WebP: Modern format with better compression (when supported)
3. **Provide alt text** for accessibility
4. **Use lazy loading** for images below the fold

#### Performance
1. **Set proper cache headers**: Static assets use 1-year cache
2. **Use responsive images**: Consider different sizes for mobile/desktop
3. **Optimize loading**: Use `loading="lazy"` for non-critical images
4. **Monitor bundle size**: Keep frontend bundle lightweight

#### Security
1. **Public assets only**: Never upload sensitive files to public folders
2. **Content validation**: Validate file types and sizes
3. **Access control**: Use appropriate S3 bucket policies

### Migration Checklist

When moving an asset from frontend bundle to S3:

- [ ] Upload file to S3 using upload script
- [ ] Verify CloudFront URL is accessible
- [ ] Add URL to `staticAssets.js` configuration
- [ ] Update component to use CloudFront URL
- [ ] Test loading and error handling
- [ ] Remove local file from frontend
- [ ] Update any build scripts or references
- [ ] Document the change

### Troubleshooting

#### Image Not Loading
1. Check CloudFront URL in browser directly
2. Verify S3 bucket policy allows public access
3. Check browser console for CORS errors
4. Ensure content-type is set correctly

#### Cache Issues
1. CloudFront has ~15 minutes propagation delay
2. Use CloudFront invalidation for urgent updates
3. Add cache busting for dynamic content

#### Performance Issues
1. Optimize image sizes and formats
2. Use lazy loading for non-critical images
3. Consider responsive images for different screen sizes
4. Monitor Core Web Vitals

### Tools and Scripts

#### Available Scripts:
- `upload-static-assets.js`: Upload static assets to S3
- `migrate-images-to-s3.js`: Migrate existing DynamoDB images
- `backup-dynamodb.js`: Create backups before migrations

---

## Part 3 — AI image generation (AWS Bedrock → repo asset)

This section explains how an agent (or developer) can call this app's AI image
generator, and how to take the returned image and wire it into the repo as a
usable asset.

The generator is a thin HTTP wrapper around **AWS Bedrock** text-to-image
models. It returns **base64-encoded PNG data URLs**, so there is no S3
round-trip required just to get the pixels — but you can optionally persist the
result to S3/CloudFront (Part 2) if the asset should be served from the CDN.

> **🤖 Agent TL;DR — generating a repo asset.** You usually do **not** need the
> HTTP API, a JWT, or a running server. A reusable script already exists:
> `backend/scripts/generate-project-art.js`. It reads `backend/.env` and calls
> `services/bedrockImageService.generateImage` directly. See §3.6 for the full
> recipe (generation, PNG→JPG conversion, and wiring into the projects catalog).

### 3.1 Overview

| Item | Value |
|------|-------|
| List models (public) | `GET /api/data/image/models` |
| Generate image (auth) | `POST /api/data/image/generate` |
| Auth | JWT — `Authorization: Bearer <token>` |
| Response | `{ success, images: [{ mimeType, base64 }], seed, model, provider }` |
| Rate limit | 10 requests / 15 min per user (`imageGenLimiter`) |
| Bedrock region | **`us-west-2`** for Stability generators (see §3.7) |
| IAM permission | `bedrock:InvokeModel` |

#### API base URL

- **Local dev:** `http://localhost:5000/api/data` (Vite proxies `/api` → `:5000`)
- **Production (`sthopwood.com`):** `/api/data` (Netlify proxy, same-origin)
- **Deploy previews / other domains:** `https://mern-plan-web-service.onrender.com/api/data`

All paths below are relative to one of these bases.

### 3.2 Prerequisites

Server-side configuration (already handled in this repo, listed for reference):

- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (or the dedicated
  `AWS_BEDROCK_*` pair) with `bedrock:InvokeModel`.
- `BEDROCK_IMAGE_MODEL_ID` (optional) — override the default model.
- `AWS_BEDROCK_IMAGE_REGION` (optional) — override the image client region.
  Defaults to `us-west-2`.

Client-side, you only need a **valid JWT** (see §3.3).

### 3.3 Authenticate

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

### 3.4 Generate an image

#### 3.4.1 List available models (public, no auth)

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

#### 3.4.2 Request body (`POST /api/data/image/generate`)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `prompt` | string | ✅ | Max 4000 chars |
| `model` | string | — | Defaults to `BEDROCK_IMAGE_MODEL_ID` or `stability.sd3-5-large-v1:0` |
| `aspectRatio` | string | — | Default `1:1`; must be supported by the model |
| `numberOfImages` | int | — | 1–4, default 1 |
| `seed` | int | — | 0–4294967295; **Stability only** |
| `negativePrompt` | string | — | What to avoid; **Stability only** |

#### 3.4.3 curl example

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

#### 3.4.4 Node.js example

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

#### 3.4.5 Response shape

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

#### 3.4.6 Generate directly from a Node script (recommended for repo assets)

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

### 3.5 Implement the image as a repo asset

There are two supported ways to turn the generated PNG into an asset the repo
uses. Pick based on size and how often it changes.

#### Path A — Commit locally into `frontend/src/assets/` (bundled asset)

Best for **small, stable, app-owned assets** (icons, illustrations, section
graphics) that should ship with the frontend bundle. Vite imports these
directly and fingerprinted them at build time.

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
This is the pipeline documented in Part 2 of this guide.

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

### 3.6 Full worked example (Node script)

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

### 3.7 Troubleshooting

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

#### Related docs

- `docs/guides/SECRETS_MANAGEMENT.md` — where `BEDROCK_IMAGE_MODEL_ID` and AWS
  credentials live in production.
- `backend/services/bedrockImageService.js` — model catalog + generation logic.
- `backend/controllers/imageGenController.js` — HTTP endpoint validation.
- `backend/scripts/generate-project-art.js` — reusable repo-asset generator (§3.4.6).
- `docs/guides/FRONTEND_UI_STANDARD.md` — the visual style prompts should match.
