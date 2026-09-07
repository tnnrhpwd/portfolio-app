# Repo Scripts

One-off and operational scripts that don't belong inside a specific package.

| Path | What it is | How it's run |
|------|------------|--------------|
| `health-check.js` | Pings one or more URLs and reports HTTP health | `npm run health-check` |
| `bootstrap.ps1` | First-time environment setup | `npm run bootstrap` |
| `backup-env.ps1` | Encrypts `.env` secrets to a backup | `npm run env:backup` |
| `restore-env.ps1` | Restores `.env` from the encrypted backup | `npm run env:restore` |
| `add-env-recipient.ps1` | Adds a recipient public key to the backup | `npm run env:add-recipient` |
| `env-backup/` | **Data** — the encrypted backup (`manifest.json`) + recipient keys | managed by the `.ps1` scripts |
| `coliseum/` | **Coliseum game** asset tools: `crop-coliseum-regions.js` + `blender/render_fighter_layers.py` | see `docs/archive/coliseum/` |
| `dev/` | Scratch/dev experiments — not part of any workflow | manual |

The env backup/restore workflow is documented in
[`docs/guides/SECRETS_MANAGEMENT.md`](../docs/guides/SECRETS_MANAGEMENT.md) (Part 2).
