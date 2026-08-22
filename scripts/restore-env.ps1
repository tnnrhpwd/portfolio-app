<#
.SYNOPSIS
    Restores local .env files by decrypting the latest backup from portfolio-app-secrets.
.DESCRIPTION
    Clones/pulls the private portfolio-app-secrets repo and decrypts each file listed in
    scripts/env-backup/manifest.json back into place, using a local SSH private key
    (id_ed25519 or id_rsa) that must already be listed in scripts/env-backup/recipients.txt.

    This is the one-command step for restoring secrets on a new laptop after cloning
    portfolio-app: `npm run env:restore`.
.PARAMETER Force
    Overwrite existing local files instead of skipping them.
.EXAMPLE
    npm run env:restore
.EXAMPLE
    .\scripts\restore-env.ps1 -Force
#>

param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$env:PATH += ";$env:LOCALAPPDATA\Microsoft\WinGet\Links"
if (-not (Get-Command age -ErrorAction SilentlyContinue)) {
    throw "age is not installed. Install it with: winget install --id FiloSottile.age -e --scope user"
}

$RepoRoot = (& git rev-parse --show-toplevel).Trim()
$ManifestPath = Join-Path $RepoRoot "scripts\env-backup\manifest.json"
$SecretsRepoUrl = "https://github.com/tnnrhpwd/portfolio-app-secrets.git"
$SecretsRepoDir = Join-Path $env:USERPROFILE ".portfolio-app-secrets"

if (-not (Test-Path $ManifestPath)) { throw "Manifest not found: $ManifestPath" }
$manifest = (Get-Content $ManifestPath -Raw | ConvertFrom-Json).files

if (-not (Test-Path (Join-Path $SecretsRepoDir ".git"))) {
    Write-Host "Cloning $SecretsRepoUrl into $SecretsRepoDir ..."
    git clone $SecretsRepoUrl $SecretsRepoDir
} else {
    Write-Host "Updating local secrets repo clone..."
    git -C $SecretsRepoDir pull --ff-only
}

# Find a usable SSH private key for decryption (ed25519 preferred, falls back to rsa).
$candidateKeys = @("$env:USERPROFILE\.ssh\id_ed25519", "$env:USERPROFILE\.ssh\id_rsa")
$identity = $candidateKeys | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $identity) {
    throw ("No SSH private key found in $env:USERPROFILE\.ssh (looked for id_ed25519, id_rsa). " +
           "If this is a brand-new machine/key, it must first be added to " +
           "scripts\env-backup\recipients.txt from an already-trusted machine - " +
           "see docs\guides\ENV_BACKUP_GUIDE.md ('Setting up a new laptop').")
}

$restored = 0
foreach ($entry in $manifest) {
    $encPath = Join-Path $SecretsRepoDir $entry.encrypted
    $destPath = Join-Path $RepoRoot $entry.source
    if (-not (Test-Path $encPath)) {
        Write-Warning "No backup found for $($entry.source) (expected $($entry.encrypted))"
        continue
    }
    if ((Test-Path $destPath) -and -not $Force) {
        Write-Host "Skipping $($entry.source) - already exists locally (use -Force to overwrite)"
        continue
    }
    $destDir = Split-Path $destPath -Parent
    if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null }
    Write-Host "Decrypting $($entry.encrypted) -> $($entry.source)"
    age -d -i $identity -o $destPath $encPath
    $restored++
}

if ($restored -eq 0) {
    Write-Warning ("Nothing was restored. Either the backup is empty, all files already " +
                    "exist locally, or this machine's SSH key isn't an authorized recipient yet.")
} else {
    Write-Host "Restore complete ($restored file(s))."
}
