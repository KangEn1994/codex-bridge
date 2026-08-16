param(
  [Parameter(Mandatory = $true)][string]$ProjectRoot,
  [int]$WebPort = 3000,
  [int]$ApiPort = 43110,
  [Parameter(Mandatory = $true)][string]$StopSignalPath
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $ProjectRoot
$env:CODEX_BRIDGE_UPSTREAM = "http://127.0.0.1:$ApiPort"
$npm = (Get-Command npm.cmd).Source
while (-not (Test-Path -LiteralPath $StopSignalPath)) {
  & $npm run start -- --port $WebPort --hostname 0.0.0.0
  $exitCode = $LASTEXITCODE
  if (Test-Path -LiteralPath $StopSignalPath) { break }
  Write-Warning "Codex Bridge Web 已退出（代码 $exitCode），2 秒后自动重启。"
  Start-Sleep -Seconds 2
}
exit 0
