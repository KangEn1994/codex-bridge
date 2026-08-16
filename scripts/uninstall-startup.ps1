$ErrorActionPreference = "Stop"
$trayStopSignalPath = Join-Path $env:USERPROFILE ".codex-bridge\tray.stop.requested"
New-Item -ItemType File -Path $trayStopSignalPath -Force | Out-Null
$task = Get-ScheduledTask -TaskName "Codex Bridge" -ErrorAction SilentlyContinue
if ($task) { Stop-ScheduledTask -TaskName "Codex Bridge" -ErrorAction SilentlyContinue }
$trayProcesses = Get-Process -Name "CodexBridge.Tray" -ErrorAction SilentlyContinue
if ($trayProcesses) { $trayProcesses | Stop-Process -Force }
if ($task) { Unregister-ScheduledTask -TaskName "Codex Bridge" -Confirm:$false }
& (Join-Path $PSScriptRoot "stop-codex-bridge.ps1")
Write-Host "托盘管理器和开机启动已移除。项目文件、Codex 历史和配对令牌没有删除。"
