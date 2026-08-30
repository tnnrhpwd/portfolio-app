<#
.SYNOPSIS
    Set or update one secret in the AWS Secrets Manager secret that hydrates the
    backend at boot (the single source of truth for all non-AWS secrets).
.DESCRIPTION
    Reads the current JSON object from AWS Secrets Manager, sets/updates the given
    key, and writes it back. If the secret doesn't exist yet, it is created.

    The backend (backend/utils/awsSecrets.js loadAllSecrets) pulls this object into
    process.env on boot, so after this command you only need to redeploy/restart —
    no Render dashboard edits, no local .env edits, no secrets-repo push required.

.PARAMETER Name
    Env-var name to set (e.g. OPENAI_KEY, STRIPE_KEY, GITHUB_TOKEN).
.PARAMETER Value
    Secret value to store.
.PARAMETER SecretId
    Secrets Manager secret id. Defaults to "portfolio-app/production".
.PARAMETER Region
    AWS region. Defaults to us-east-1.
.PARAMETER Profile
    Optional AWS CLI profile name.

.EXAMPLE
    npm run secret:put -- -Name OPENAI_KEY -Value "sk-..."
.EXAMPLE
    .\scripts\put-secret.ps1 -Name GITHUB_TOKEN -Value "ghp_..." -Region us-east-1
#>

param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Value,
    [string]$SecretId = "portfolio-app/production",
    [string]$Region = "us-east-1",
    [string]$Profile = ""
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    throw "AWS CLI not found. Install it with: winget install --id Amazon.AWSCLI -e"
}

$awsArgs = @()
if ($Profile) { $awsArgs += "--profile"; $awsArgs += $Profile }
$awsArgs += "--region"; $awsArgs += $Region

# Fetch the existing secret (if any) as raw text.
$secretText = $null
try {
    $secretText = & aws @awsArgs secretsmanager get-secret-value --secret-id $SecretId --query SecretString --output text 2>$null
    if ($LASTEXITCODE -ne 0) { $secretText = $null }
}
catch {
    $secretText = $null
}
if ($secretText) { $secretText = $secretText.Trim() }

# Interpret the existing value as a JSON object; anything else starts fresh.
$obj = $null
if ($secretText) {
    try {
        $parsed = $secretText | ConvertFrom-Json
        if ($parsed -is [System.Management.Automation.PSCustomObject]) {
            $obj = $parsed
        }
    }
    catch {
        Write-Warning "Existing secret is not a JSON object; it will be replaced."
        $obj = $null
    }
}
if (-not $obj) { $obj = [PSCustomObject]@{} }

# Upsert the key.
if ($obj.PSObject.Properties[$Name]) {
    $obj.PSObject.Properties[$Name].Value = $Value
}
else {
    $obj | Add-Member -MemberType NoteProperty -Name $Name -Value $Value
}

$json = $obj | ConvertTo-Json -Compress

& aws @awsArgs secretsmanager put-secret-value --secret-id $SecretId --secret-string $json | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "put-secret-value failed for '$SecretId' (exit code $LASTEXITCODE)."
}

Write-Host "Updated '$Name' in secret '$SecretId' ($Region)." -ForegroundColor Green
Write-Host "Redeploy (or restart) the backend to pick it up; local dev: restart the server."
