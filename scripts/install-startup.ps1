param(
  [string]$PublicUrl = "",
  [string]$PublicHost = "",
  [string]$ListenAddress = "127.0.0.1",
  [switch]$NoStart
)

$ErrorActionPreference = "Stop"
if ($PublicUrl -and $PublicHost) { throw "PublicUrl 和 PublicHost 不能同时使用。" }
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Push-Location $projectRoot
try {
  if (-not (Get-Command codex -ErrorAction SilentlyContinue)) { throw "未找到 codex 命令，请先安装并登录 Codex 桌面版。" }
  & (Get-Command npm.cmd).Source ci
  if ($LASTEXITCODE -ne 0) { throw "npm ci 失败" }
  & (Get-Command npm.cmd).Source run typecheck
  if ($LASTEXITCODE -ne 0) { throw "类型检查失败" }
  & (Get-Command npm.cmd).Source run build
  if ($LASTEXITCODE -ne 0) { throw "构建失败" }
  & (Join-Path $PSScriptRoot "build-tray.ps1")
  if ($LASTEXITCODE -ne 0) { throw "托盘管理器构建失败" }
} finally {
  Pop-Location
}

$trayStopSignalPath = Join-Path $env:USERPROFILE ".codex-bridge\tray.stop.requested"
New-Item -ItemType File -Path $trayStopSignalPath -Force | Out-Null
$previousTask = Get-ScheduledTask -TaskName "Codex Bridge" -ErrorAction SilentlyContinue
if ($previousTask) { Stop-ScheduledTask -TaskName "Codex Bridge" -ErrorAction SilentlyContinue }
Get-Process -Name "CodexBridge.Tray" -ErrorAction SilentlyContinue | Stop-Process -Force

$trayRunner = Join-Path $PSScriptRoot "run-tray.ps1"
$arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$trayRunner`" -ProjectRoot `"$projectRoot`""
$action = New-ScheduledTaskAction -Execute (Get-Command powershell.exe).Source -Argument $arguments -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 10 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName "Codex Bridge" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "Codex Bridge 托盘管理器已安装为当前用户的登录启动项。"

if (-not $NoStart) {
  & (Join-Path $PSScriptRoot "stop-codex-bridge.ps1")
  if ($PublicUrl -or $PublicHost -or $PSBoundParameters.ContainsKey("ListenAddress")) {
    $launcherConfigPath = Join-Path $env:USERPROFILE ".codex-bridge\launcher.json"
    $existing = if (Test-Path -LiteralPath $launcherConfigPath) { Get-Content -LiteralPath $launcherConfigPath -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }
    $resolvedPublicUrl = if ($PublicUrl) {
      $PublicUrl.TrimEnd("/")
    } elseif ($PublicHost) {
      "http://${PublicHost}:43110"
    } elseif ($existing.publicUrl) {
      [string]$existing.publicUrl
    } else {
      "http://127.0.0.1:43110"
    }
    @{
      publicUrl = $resolvedPublicUrl
      apiPort = if ($existing.apiPort) { [int]$existing.apiPort } else { 43110 }
      webPort = if ($existing.webPort) { [int]$existing.webPort } else { 3000 }
      listenAddress = $ListenAddress
    } | ConvertTo-Json | Set-Content -LiteralPath $launcherConfigPath -Encoding UTF8
  }
  Start-ScheduledTask -TaskName "Codex Bridge"
  Write-Host "Codex Bridge 托盘管理器已启动。"
}
