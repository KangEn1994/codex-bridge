param(
  [Parameter(Mandatory = $true)][string]$PublicUrl,
  [switch]$RotateSecrets
)

$ErrorActionPreference = "Stop"

try { $parsed = [Uri]$PublicUrl } catch { throw "PublicUrl is invalid: $PublicUrl" }
if (-not $parsed.IsAbsoluteUri -or $parsed.Scheme -ne "https" -or $parsed.Query -or $parsed.Fragment -or $parsed.AbsolutePath -ne "/") {
  throw "PublicUrl must be an HTTPS site root, for example https://bridge.example.com."
}

function New-RelaySecret {
  $bytes = New-Object byte[] 48
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  return [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

$normalizedUrl = $PublicUrl.TrimEnd("/")
$clientConfigPath = Join-Path $PSScriptRoot "relay-client.json"
$serverEnvPath = Join-Path $PSScriptRoot ".env"
$existing = $null
if (-not $RotateSecrets -and (Test-Path -LiteralPath $clientConfigPath)) {
  try { $existing = Get-Content -LiteralPath $clientConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $existing = $null }
}
$hostToken = if ($existing.hostToken) { [string]$existing.hostToken } else { New-RelaySecret }
$phoneToken = if ($existing.phoneToken) { [string]$existing.phoneToken } else { New-RelaySecret }

[ordered]@{
  publicUrl = $normalizedUrl
  hostToken = $hostToken
  phoneToken = $phoneToken
} | ConvertTo-Json | Set-Content -LiteralPath $clientConfigPath -Encoding UTF8

@(
  "CODEX_RELAY_PUBLIC_URL=$normalizedUrl"
  "CODEX_RELAY_HOST_TOKEN=$hostToken"
  "CODEX_RELAY_PHONE_TOKEN=$phoneToken"
  "PORT=8080"
  "HOST=0.0.0.0"
  "CODEX_RELAY_WEB_PORT=3000"
  "CODEX_RELAY_WEB_INTERNAL_URL=http://127.0.0.1:3000"
  "CODEX_RELAY_TRUST_PROXY=true"
) | Set-Content -LiteralPath $serverEnvPath -Encoding ASCII

Write-Host "Relay configuration created:"
Write-Host "  Server environment: $serverEnvPath"
Write-Host "  Desktop connection settings: $clientConfigPath"
Write-Host "Keep both files private; they contain credentials that can control Codex Bridge."
