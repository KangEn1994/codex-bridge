param(
  [Parameter(Mandatory = $true)][string]$ProjectRoot,
  [int]$WebPort = 3000,
  [int]$ApiPort = 43110,
  [string]$ListenAddress = "127.0.0.1",
  [Parameter(Mandatory = $true)][string]$StopSignalPath
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $ProjectRoot
$env:CODEX_BRIDGE_UPSTREAM = "http://127.0.0.1:$ApiPort"
$webHostname = if ($ListenAddress -in @("127.0.0.1", "localhost", "::1")) { "127.0.0.1" } else { "0.0.0.0" }
$bundledNode = Join-Path $ProjectRoot "runtime\node.exe"
$bundledWeb = Join-Path $ProjectRoot "runtime\web-server.mjs"
$vinextCli = Join-Path $ProjectRoot "node_modules\vinext\dist\cli.js"
$npm = if (Test-Path -LiteralPath $bundledNode) { $null } else { (Get-Command npm.cmd).Source }
while (-not (Test-Path -LiteralPath $StopSignalPath)) {
  if ($npm) { & $npm run start -- --port $WebPort --hostname $webHostname }
  elseif (Test-Path -LiteralPath $bundledWeb) { & $bundledNode $bundledWeb $WebPort $webHostname }
  else { & $bundledNode $vinextCli start --port $WebPort --hostname $webHostname }
  $exitCode = $LASTEXITCODE
  if (Test-Path -LiteralPath $StopSignalPath) { break }
  Write-Warning "Codex Bridge Web 已退出（代码 $exitCode），2 秒后自动重启。"
  Start-Sleep -Seconds 2
}
exit 0
