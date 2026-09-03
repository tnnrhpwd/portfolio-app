# AI Image Generator Guide (AWS Bedrock → Repo Asset)

This guide explains how an agent (or developer) can call this app's AI image
generator, and how to take the returned image and wire it into the repo as a
usable asset.

The generator is a thin HTTP wrapper around **AWS Bedrock** text-to-image
models. It returns **base64-encoded PNG data URLs**, so there is no S3
round-trip required just to get the pixels — but you can optionally persist the
result to S3/CloudFront if the asset should be served from the CDN.

---

## 1. Overview

| Item | Value |
|------|-------|
| List models (public) | `GET /api/data/image/models` |
| Generate image (auth) | `POST /api/data/image/generate` |
| Auth | JWT — `Authorization: Bearer <token>` |
| Response | `{ success, images: [{ mimeType, base64 }], seed, model, provider }` |
| Rate limit | 10 requests / 15 min per user (`imageGenLimiter`) |
| Bedrock region | **`us-west-2`** for Stability generators (see §5) |
| IAM permission | `bedrock:InvokeModel` |

### API base URL

- **Local dev:** `http://localhost:5000/api/data` (Vite proxies `/api` → `:5000`)
- **Production (`sthopwood.com`):** `/api/data` (Netlify proxy, same-origin)
- **Deploy previews / other domains:** `https://mern-plan-web-service.onrender.com/api/data`

All paths below are relative to one of these bases.

---

## 2. Prerequisites

Server-side configuration (already handled in this repo, listed for reference):

- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (or the dedicated
  `AWS_BEDROCK_*` pair) with `bedrock:InvokeModel`.
- `BEDROCK_IMAGE_MODEL_ID` (optional) — override the default model.
- `AWS_BEDROCK_IMAGE_REGION` (optional) — override the image client region.
  Defaults to `us-west-2`.

Client-side, you only need a **valid JWT** (see §3).

---

## 3. Authenticate

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

---

## 4. Generate an image

### 4.1 List available models (public, no auth)

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

### 4.2 Request body (`POST /api/data/image/generate`)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `prompt` | string | ✅ | Max 4000 chars |
| `model` | string | — | Defaults to `BEDROCK_IMAGE_MODEL_ID` or `stability.sd3-5-large-v1:0` |
| `aspectRatio` | string | — | Default `1:1`; must be supported by the model |
| `numberOfImages` | int | — | 1–4, default 1 |
| `seed` | int | — | 0–4294967295; **Stability only** |
| `negativePrompt` | string | — | What to avoid; **Stability only** |

### 4.3 curl example

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

### 4.4 Node.js example

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

### 4.5 Response shape

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

---

## 5. Implement the image as a repo asset

There are two supported ways to turn the generated PNG into an asset the repo
uses. Pick based on size and how often it changes.

### Path A — Commit locally into `frontend/src/assets/` (bundled asset)

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

3. **Check it in** so it becomes a permanent part of the repo. Keep PNGs small
   (compress with TinyPNG/ImageOptim first) to avoid bloating the bundle.

### Path B — Upload to S3 and serve via CloudFront (CDN asset)

Best for **larger images** or assets that should not bloat the frontend bundle.
This is the pipeline documented in `STATIC_ASSETS_GUIDE.md`.

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

---

## 6. Full worked example (Node script)

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

---

## 7. Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `503 Image generation is not configured` | Bedrock credentials not present server-side. Check `AWS_*` env vars. |
| `429` / "temporarily busy" | `BEDROCK_THROTTLED` or per-user rate limit (10/15 min). Wait and retry. |
| `400 Unsupported aspect ratio` | The ratio isn't in the model's `aspectRatios` list — call `/image/models` first. |
| `400 Unsupported image model` | Pass a valid `model` id from `/image/models`. |
| `401 Not authorized` | Missing/expired JWT. Re-login and pass `Authorization: Bearer <token>`. |
| "The provided model identifier is invalid" | Model not active in the region. Stability generators need **us-west-2**, not us-east-1. |
| First call hangs / access error | New-region first invoke triggers an AWS account-verification gate (~2h). |

### Diagnostics

- `node backend/scripts/list-bedrock-models.js us-west-2` — confirm which image
  models are active in a region.
- `node backend/scripts/test-net-image.js "generate an image of …"` — end-to-end
  net-chat image test (logs in as the guest account).

### Region gotcha (important)

The **Stability** text-to-image generators (SD3.5 Large / Core / Ultra) are
**only active in `us-west-2`**. `us-east-1` only has the legacy Nova Canvas and
Stability *editing* tools. The image client already defaults to `us-west-2`
independently of the chat client region, but if you override
`AWS_BEDROCK_IMAGE_REGION`, make sure it's a region where your chosen model is
active.

---

## Related docs

- `docs/guides/STATIC_ASSETS_GUIDE.md` — S3/CloudFront asset pipeline (Path B).
- `docs/guides/SECRETS_MANAGEMENT.md` — where `BEDROCK_IMAGE_MODEL_ID` and AWS
  credentials live in production.
- `backend/services/bedrockImageService.js` — model catalog + generation logic.
- `backend/controllers/imageGenController.js` — HTTP endpoint validation.
