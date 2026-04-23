param(
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host '[Update] Stopping running CSimple processes...'
Get-Process | Where-Object { $_.ProcessName -like '*CSimple*' -or $_.ProcessName -like '*Setup*' } |
Stop-Process -Force -ErrorAction SilentlyContinue

if (-not $SkipBuild) {
    Write-Host '[Update] Building NSIS installer...'
    npx electron-builder --publish never --config.win.target=nsis --x64
}

$installer = Join-Path $root 'dist\CSimple Addon Setup 1.0.6.exe'
if (-not (Test-Path $installer)) {
    throw "Installer not found: $installer"
}

Write-Host '[Update] Installing silently...'
Start-Process -FilePath $installer -ArgumentList '/S' -Wait
Start-Sleep -Seconds 2

$exePath = 'C:\Users\tanne\AppData\Local\Programs\CSimple Addon\CSimple Addon.exe'
if (-not (Test-Path $exePath)) {
    throw "Installed executable not found: $exePath"
}

Write-Host '[Update] Launching addon...'
Start-Process -FilePath $exePath
Start-Sleep -Seconds 2

$proc = Get-Process | Where-Object { $_.ProcessName -eq 'CSimple Addon' }
if ($proc) {
    Write-Host '[Update] Success: CSimple Addon is running.'
}
else {
    throw 'CSimple Addon did not start successfully.'
}
