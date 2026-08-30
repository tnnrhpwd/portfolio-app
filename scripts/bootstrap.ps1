<#
.SYNOPSIS
    One-shot setup for a new laptop / fresh checkout of portfolio-app.
.DESCRIPTION
    Run from the portfolio-app repo root AFTER cloning. It:
      1. Installs missing tooling via winget (git, Node LTS, gh, age, VS Code)
      2. Ensures an SSH key exists for decrypting the env backup
      3. Installs npm dependencies (root + frontend + backend)
      4. Restores backend/.env from the encrypted portfolio-app-secrets backup

    First-time-only note: if this machine has a brand-new SSH key, it must be
    authorized from an already-trusted machine (npm run env:add-recipient) before
    env restore can decrypt anything.

.PARAMETER SkipVsCode
    Do not install VS Code.
.PARAMETER SkipInstall
    Skip `npm run install-all` (tool setup + env restore only).

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap.ps1
.EXAMPLE
    npm run bootstrap
#>

param(
    [switch]$SkipVsCode,
    [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$env:PATH += ";$env:LOCALAPPDATA\Microsoft\WinGet\Links"

function Test-Command([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Install-Tool([string]$Id, [string]$Label) {
    if (Test-Command $Label) {
        Write-Host "[ok] $Label already installed"
        return
    }
    if (-not (Test-Command winget)) {
        throw "winget not found. Install 'App Installer' from the Microsoft Store, then re-run."
    }
    Write-Host "[..] Installing $Label ($Id) via winget..."
    winget install --id $Id -e --silent --accept-source-agreements --accept-package-agreements
}

Write-Host "==> Step 1/4: tooling"
Install-Tool "Git.Git" "git"
Install-Tool "OpenJS.NodeJS.LTS" "node"
Install-Tool "GitHub.cli" "gh"
Install-Tool "FiloSottile.age" "age"
if (-not $SkipVsCode) { Install-Tool "Microsoft.VisualStudioCode" "code" }

Write-Host "==> Step 2/4: SSH key for env restore"
$sshDir = Join-Path $env:USERPROFILE ".ssh"
$keyPath = Join-Path $sshDir "id_ed25519"
if (-not (Test-Path $keyPath)) {
    if (-not (Test-Path $sshDir)) { New-Item -ItemType Directory -Path $sshDir | Out-Null }
    # Feed two empty lines so ssh-keygen stores an empty passphrase.
    "`n`n" | ssh-keygen -t ed25519 -C "portfolio-app" -f $keyPath | Out-Null
    if (-not (Test-Path $keyPath)) {
        Write-Warning "Automatic key generation failed. Run manually: ssh-keygen -t ed25519 -C 'portfolio-app'"
    } else {
        Write-Host ""
        Write-Host "Generated a new SSH key: $keyPath" -ForegroundColor Yellow
        Write-Host "If this is a brand-new device, authorize it BEFORE env restore:" -ForegroundColor Yellow
        Write-Host "  1. Add it to GitHub so it can pull repos:"
        Write-Host "       gh auth login"
        Write-Host "       gh ssh-key add $keyPath.pub"
        Write-Host "  2. From an ALREADY-TRUSTED machine, authorize it for env decryption:"
        Write-Host "       npm run env:add-recipient -- -PublicKey 'PASTE-THE-LINE-BELOW'"
        Write-Host ""
        Write-Host "  Public key:"
        Get-Content "$keyPath.pub" | ForEach-Object { Write-Host "    $_" -ForegroundColor Cyan }
        Write-Host ""
        Write-Host "Press Enter once the key is authorized (or Ctrl+C to stop)."
        Read-Host | Out-Null
    }
}

$RepoRoot = (& git rev-parse --show-toplevel).Trim()
if (-not $RepoRoot) { throw "Run this script from inside the portfolio-app repo (after cloning)." }

Write-Host "==> Step 3/4: npm dependencies (root + frontend + backend)"
if (-not $SkipInstall) {
    npm run install-all
    if ($LASTEXITCODE -ne 0) { throw "npm run install-all failed." }
} else {
    Write-Host "[skip] npm install"
}

Write-Host "==> Step 4/4: restore backend/.env from encrypted backup"
npm run env:restore

Write-Host ""
Write-Host "Bootstrap complete." -ForegroundColor Green
Write-Host "  Start dev servers : npm run dev"
Write-Host "  Set/rotate a secret: npm run secret:put -- -Name KEY -Value 'value'"
Write-Host "  Back up local .env: npm run env:backup"
