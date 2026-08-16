param(
  [Parameter(Mandatory = $true)][string]$ProjectRoot,
  [int]$ApiPort = 43110,
  [string]$ListenAddress = "127.0.0.1",
  [Parameter(Mandatory = $true)][string]$PublicApiUrl,
  [Parameter(Mandatory = $true)][string]$WebUrl,
  [Parameter(Mandatory = $true)][string]$StopSignalPath
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $ProjectRoot
$env:CODEX_BRIDGE_PORT = [string]$ApiPort
$env:CODEX_BRIDGE_HOST = $ListenAddress
$env:CODEX_BRIDGE_PUBLIC_URL = $PublicApiUrl
$env:CODEX_BRIDGE_WEB_URL = $WebUrl
$env:CODEX_BRIDGE_WEB_INTERNAL_URL = "http://127.0.0.1:3000"

# Resolve Codex from the desktop app's managed binary cache instead of the
# ambient PATH. IDE extensions can also ship a `codex.exe`; allowing PATH to
# choose one can silently move Bridge onto a different/older app-server
# protocol after either product updates.
$codexBinRoot = Join-Path $env:LOCALAPPDATA "OpenAI\Codex\bin"
$desktopCodex = Get-ChildItem -LiteralPath $codexBinRoot -Filter "codex.exe" -File -Recurse -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if ($desktopCodex) { $env:CODEX_BRIDGE_CODEX_BIN = $desktopCodex.FullName }

$relayConfigPath = Join-Path $env:USERPROFILE ".codex-bridge\relay.json"
if (Test-Path -LiteralPath $relayConfigPath) {
  $relay = Get-Content -LiteralPath $relayConfigPath -Raw | ConvertFrom-Json
  if ($relay.publicUrl -and $relay.hostToken -and $relay.phoneToken) {
    $env:CODEX_BRIDGE_RELAY_URL = [string]$relay.publicUrl
    $env:CODEX_BRIDGE_RELAY_HOST_TOKEN = [string]$relay.hostToken
    $env:CODEX_BRIDGE_RELAY_PHONE_TOKEN = [string]$relay.phoneToken
  }
}
$npm = (Get-Command npm.cmd).Source
while (-not (Test-Path -LiteralPath $StopSignalPath)) {
  & $npm run host
  $exitCode = $LASTEXITCODE
  if (Test-Path -LiteralPath $StopSignalPath) { break }
  Write-Warning "Codex Bridge Host 已退出（代码 $exitCode），2 秒后自动重启。"
  Start-Sleep -Seconds 2
}
exit 0
