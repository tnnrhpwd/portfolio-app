# Secrets Management (Single Source of Truth)

This guide explains the recommended workflow so you never copy secrets across
local `.env`, the secrets repo, Render, and AWS by hand again.

## The source of truth (and what `.env` is for)

**AWS Secrets Manager is the single source of truth for non-AWS secrets.** One
JSON secret, `portfolio-app/production`, holds everything that isn't AWS config:

```json
{
  "JWT_SECRET": "...",
  "STRIPE_KEY": "sk_live_...",
  "STRIPE_WEBHOOK_SECRET": "whsec_...",
  "OPENAI_KEY": "sk-...",
  "XAI_API_KEY": "...",
  "GITHUB_TOKEN": "ghp_..."
}
```

The backend hydrates these into `process.env` at boot via
[`backend/utils/awsSecrets.js`](../../backend/utils/awsSecrets.js)
(`loadAllSecrets`, called from `server.js` before routes load).

### Is `backend/.env` still used? Yes.

It's loaded **first** (by `dotenv` at the top of `server.js`) and its values
**win over** Secrets Manager — the loader never overwrites a variable that is
already set. `.env` has two jobs:

1. **Bootstrap credentials** — it holds the `AWS_ACCESS_KEY_ID` /
   `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` needed to *reach* Secrets Manager in
   the first place.
2. **Local overrides** — while developing, whatever you put in `.env` is used
   as-is; Secrets Manager only fills in the gaps. This lets you work offline or
   override a value locally without touching the cloud.

### How a variable resolves

| Step | Where the value comes from |
|---|---|
| 1 | `dotenv` loads `backend/.env` into `process.env` (local) — or Render injects its env vars (production) |
| 2 | `loadAllSecrets()` fetches `portfolio-app/production` and sets any variable **not already set** |
| 3 | Result: local `.env` wins locally; on Render, Secrets Manager supplies everything except the AWS bootstrap creds |

### Where each thing lives

| Store | Contents | Role |
|---|---|---|
| AWS Secrets Manager (`portfolio-app/production`) | All non-AWS secrets | **Source of truth** in production |
| `backend/.env` (local, gitignored) | AWS bootstrap creds + local dev values | Loaded first, wins locally, restored from backup |
| Render environment | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` + non-secret config | Bootstrap creds + config only |
| [`portfolio-app-secrets`](https://github.com/tnnrhpwd/portfolio-app-secrets) | age-encrypted copy of `.env` | Optional offline backup (see [ENV_BACKUP_GUIDE.md](./ENV_BACKUP_GUIDE.md)) |

## Add or rotate a secret

One command — no Render dashboard, no local `.env` edit, no secrets-repo push:

```powershell
npm run secret:put -- -Name OPENAI_KEY -Value "sk-..."

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
