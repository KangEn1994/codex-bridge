param(
  [Parameter(Mandatory = $true)][string]$PublicUrl,
  [switch]$RotateSecrets
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path $PSScriptRoot -Parent
$configDir = Join-Path $env:USERPROFILE ".codex-bridge"
$deployDir = Join-Path $projectRoot ".deploy"
$clientConfigPath = Join-Path $configDir "relay.json"
$serverEnvPath = Join-Path $configDir "relay-server.env"
$archivePath = Join-Path $deployDir "codex-bridge-relay.tar.gz"

function New-RelaySecret {
  $bytes = New-Object byte[] 48
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  return [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

New-Item -ItemType Directory -Force -Path $configDir, $deployDir | Out-Null
$existingConfig = $null
if (-not $RotateSecrets -and (Test-Path -LiteralPath $clientConfigPath)) {
  try { $existingConfig = Get-Content -LiteralPath $clientConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $existingConfig = $null }
}
$hostToken = if ($existingConfig.hostToken) { [string]$existingConfig.hostToken } else { New-RelaySecret }
$phoneToken = if ($existingConfig.phoneToken) { [string]$existingConfig.phoneToken } else { New-RelaySecret }

[ordered]@{
  publicUrl = $PublicUrl.TrimEnd("/")
  hostToken = $hostToken
  phoneToken = $phoneToken
} | ConvertTo-Json | Set-Content -LiteralPath $clientConfigPath -Encoding UTF8

@(
  "CODEX_RELAY_PUBLIC_URL=$($PublicUrl.TrimEnd('/'))"
  "CODEX_RELAY_HOST_TOKEN=$hostToken"
  "CODEX_RELAY_PHONE_TOKEN=$phoneToken"
  "PORT=43120"
  "HOST=127.0.0.1"
  "CODEX_RELAY_WEB_PORT=43121"
  "CODEX_RELAY_WEB_INTERNAL_URL=http://127.0.0.1:43121"
  "CODEX_RELAY_TRUST_PROXY=true"
) | Set-Content -LiteralPath $serverEnvPath -Encoding ASCII

Push-Location $projectRoot
try {
  & tar.exe -czf $archivePath package.json package-lock.json tsconfig.json next-env.d.ts next.config.ts postcss.config.mjs vite.config.ts app public relay deploy/relay
  if ($LASTEXITCODE -ne 0) { throw "tar failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}

Write-Host "Relay deployment package prepared."
Write-Host "Archive: $archivePath"
Write-Host "Client config: $clientConfigPath"
Write-Host "Server environment: $serverEnvPath"
