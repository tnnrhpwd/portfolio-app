# Secrets Management (Single Source of Truth)

This guide explains the recommended workflow so you never copy secrets across
local `.env`, the secrets repo, Render, and AWS by hand again.

## The model

- **AWS Secrets Manager** holds one JSON secret, `portfolio-app/production`,
  whose keys are env-var names:

  ```json
  {
    "JWT_SECRET": "...",
    "STRIPE_KEY": "sk_live_...",
    "OPENAI_KEY": "sk-...",
    "XAI_API_KEY": "...",
    "GITHUB_TOKEN": "ghp_...",
    "FROM_EMAIL": "..."
  }
  ```

- The backend hydrates these into `process.env` at boot via
  [`backend/utils/awsSecrets.js`](../../backend/utils/awsSecrets.js)
  (`loadAllSecrets`, called from `server.js` before routes load).
- **Local `.env` values win.** The loader never overwrites a variable that is
  already set, so local dev keeps working offline and you can override anything
  locally without touching the cloud.
- **Render only needs 3 vars**, set once, so the service can reach Secrets
  Manager: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`.
- The [`portfolio-app-secrets`](https://github.com/tnnrhpwd/portfolio-app-secrets)
  repo remains an optional, age-encrypted **backup** of `backend/.env` (see
  [ENV_BACKUP_GUIDE.md](./ENV_BACKUP_GUIDE.md)). It is no longer a required step
  in the secret-change workflow.

## Add or rotate a secret

One command — no Render dashboard, no local `.env` edit, no secrets-repo push:

```powershell
npm run secret:put -- -Name OPENAI_KEY -Value "sk-..."

# or directly:
.\scripts\put-secret.ps1 -Name GITHUB_TOKEN -Value "ghp_..." -Region us-east-1
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
| Render variables | Only `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` (set once) |
| Encrypted backup (optional) | `npm run env:backup` |
