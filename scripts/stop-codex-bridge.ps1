$ErrorActionPreference = "Stop"
$configDir = Join-Path $env:USERPROFILE ".codex-bridge"
$runtimePath = Join-Path $configDir "runtime.json"
$stopSignalPath = Join-Path $configDir "stop.requested"
if (-not (Test-Path -LiteralPath $runtimePath)) {
  Write-Host "没有找到 Codex Bridge 运行记录。"
  exit 0
}

New-Item -ItemType File -Path $stopSignalPath -Force | Out-Null
$runtime = Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json
$ports = @([int]$runtime.apiPort, [int]$runtime.webPort) | Where-Object { $_ -ge 1 -and $_ -le 65535 } | Select-Object -Unique
$targets = @()
foreach ($port in $ports) {
  $targets += Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.OwningProcess }
}
$targets += @($runtime.hostLauncherPid, $runtime.webLauncherPid) | Where-Object { $_ } | ForEach-Object { [int]$_ }
$targets = $targets | Select-Object -Unique
foreach ($targetPid in $targets) {
  $process = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
  if ($process) {
    Write-Host "停止 $($process.ProcessName) ($targetPid)"
    Stop-Process -Id $targetPid -Force
  }
}
Remove-Item -LiteralPath $runtimePath -Force
Write-Host "Codex Bridge 已停止。配对令牌和排队消息仍保留。"
