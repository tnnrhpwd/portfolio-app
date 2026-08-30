# Secrets Management (Single Source of Truth)

This guide explains the recommended workflow so you never copy secrets across
local `.env`, the secrets repo, Render, and AWS by hand again.

## The source of truth (and what `.env` is for)

**AWS Secrets Manager is the single source of truth — for secrets *and* app
config.** One JSON secret, `portfolio-app/production`, holds everything except
the AWS bootstrap credentials:

```json
{
  "JWT_SECRET": "...",
  "STRIPE_KEY": "sk_live_...",
  "STRIPE_WEBHOOK_SECRET": "whsec_...",
  "DEEPSEEK_API_KEY": "...",
  "GITHUB_TOKEN": "ghp_...",
  "AWS_S3_BUCKET": "sthopwood",
  "AWS_CLOUDFRONT_DOMAIN": "....cloudfront.net",
  "USE_CLOUDFRONT": "true",
  "FROM_EMAIL": "admin@yourdomain.com",
  "ADMIN_USER_ID": "..."
}
```

The backend hydrates these into `process.env` at boot via
[`backend/utils/awsSecrets.js`](../../backend/utils/awsSecrets.js)
(`loadAllSecrets`, called from `server.js` before routes load).

### `backend/.env` is just the AWS bootstrap credentials

Exactly two lines:

```dotenv
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

It's loaded **first** (by `dotenv` at the top of `server.js`) and its values
**win over** Secrets Manager — the loader never overwrites a variable that is
already set. Add any other var here to override it locally.

### How a variable resolves

| Step | Where the value comes from |
|---|---|
| 1 | `dotenv` loads `backend/.env` into `process.env` (local) — or Render injects its env vars (production) |
| 2 | `loadAllSecrets()` fetches `portfolio-app/production` and sets any variable **not already set** |
| 3 | Result: local `.env` wins locally; on Render, Secrets Manager supplies everything except the AWS bootstrap creds |

### Where each thing lives

| Store | Contents | Role |
|---|---|---|
| AWS Secrets Manager (`portfolio-app/production`) | All secrets + app config (region, S3, email, admin id) | **Source of truth** |
| `backend/.env` (local, gitignored) | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Bootstrap creds only |
| Render environment | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `NODE_ENV`, `PORT`, `FRONTEND_URL`, publishable Stripe keys | Bootstrap + runtime config |
| [`portfolio-app-secrets`](https://github.com/tnnrhpwd/portfolio-app-secrets) | age-encrypted copy of `.env` | Optional offline backup (see [ENV_BACKUP_GUIDE.md](./ENV_BACKUP_GUIDE.md)) |

## Add or rotate a secret

One command — no Render dashboard, no local `.env` edit, no secrets-repo push:

```powershell
npm run secret:put -- -Name DEEPSEEK_API_KEY -Value "sk-..."

# or directly:
node backend/scripts/put-secret.js -Name GITHUB_TOKEN -Value "ghp_..." -Region us-east-1
```

Then **redeploy or restart the backend**. Local dev: restart `npm run dev`.

`put-secret` reads the existing secret, upserts the key, and writes it back — so
it never clobbers the other keys. To delete a key, remove it from the JSON object
in the AWS console.

## Set up a new laptop

```powershell
# 1. (one-time, before cloning) install git if missing:
winget install --id Git.Git -e

# 2. clone the repo
git clone https://github.com/tnnrhpwd/portfolio-app.git
cd portfolio-app

# 3. one-shot setup: installs Node/gh/age/VS Code, generates an SSH key if
#    needed, installs deps, and restores backend/.env from the encrypted backup
npm run bootstrap
```

On a **brand-new** machine, `bootstrap` pauses and prints the new public key.
Authorize it once from an already-trusted machine, then press Enter:

```powershell
npm run env:add-recipient -- -PublicKey "PASTE-PUBLIC-KEY"
```

After that, `bootstrap` finishes by running `npm run env:restore`.

## Backing up the local `.env` (optional)

`put-secret` writes straight to Secrets Manager, so the encrypted git backup is
no longer required for normal secret changes. If you still want the full local
`.env` mirrored to the secrets repo:

```powershell
npm run env:backup
```

## Summary

| Action | Command |
|---|---|
| New laptop setup | `npm run bootstrap` (then authorize key once) |
| Add/rotate a secret | `npm run secret:put -- -Name KEY -Value "value"` |
| Seed all secrets from `.env` | `npm run secret:seed` |
| Render variables | Only `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` (set once) |
| Encrypted backup (optional) | `npm run env:backup` |
