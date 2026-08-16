param(
  [Parameter(Mandatory = $true)][string]$PublicUrl,
  [switch]$NoRestart,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$startScript = Join-Path $PSScriptRoot "start-codex-bridge.ps1"
$stopScript = Join-Path $PSScriptRoot "stop-codex-bridge.ps1"
$configDir = Join-Path $env:USERPROFILE ".codex-bridge"
$launcherConfigPath = Join-Path $configDir "launcher.json"

try { $parsedPublicUrl = [Uri]$PublicUrl } catch { throw "PublicUrl is invalid: $PublicUrl" }
if (-not $parsedPublicUrl.IsAbsoluteUri -or $parsedPublicUrl.Scheme -notin @("http", "https")) {
  throw "PublicUrl must be an absolute HTTP or HTTPS URL, for example https://codex.example.com."
}
if ($parsedPublicUrl.Query -or $parsedPublicUrl.Fragment -or ($parsedPublicUrl.AbsolutePath -and $parsedPublicUrl.AbsolutePath -ne "/")) {
  throw "PublicUrl must be a site root URL without a path, query, or fragment."
}

$normalizedPublicUrl = $PublicUrl.TrimEnd("/")
$existing = $null
if (Test-Path -LiteralPath $launcherConfigPath) {
  try { $existing = Get-Content -LiteralPath $launcherConfigPath -Raw | ConvertFrom-Json } catch { $existing = $null }
}

New-Item -ItemType Directory -Force -Path $configDir | Out-Null
@{
  publicUrl = $normalizedPublicUrl
  apiPort = if ($existing.apiPort) { [int]$existing.apiPort } else { 43110 }
  webPort = if ($existing.webPort) { [int]$existing.webPort } else { 3000 }
  listenAddress = if ($existing.listenAddress) { [string]$existing.listenAddress } else { "127.0.0.1" }
} | ConvertTo-Json | Set-Content -LiteralPath $launcherConfigPath -Encoding UTF8

Write-Host "Codex Bridge public URL saved: $normalizedPublicUrl"

$startupTask = Get-ScheduledTask -TaskName "Codex Bridge" -ErrorAction SilentlyContinue
if ($startupTask) {
  $powershell = (Get-Command powershell.exe).Source
  $startupArguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$startScript`" -NoBrowser"
  $startupAction = New-ScheduledTaskAction -Execute $powershell -Argument $startupArguments
  Set-ScheduledTask -TaskName "Codex Bridge" -Action $startupAction | Out-Null
  Write-Host "Codex Bridge startup task now reads the saved public URL."
}

if (-not $NoRestart) {
  & $stopScript
  & $startScript -PublicUrl $normalizedPublicUrl -NoBrowser:$NoBrowser
}
