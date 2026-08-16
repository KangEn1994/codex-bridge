param(
  [Parameter(Mandatory = $true)][string]$ProjectRoot
)

$ErrorActionPreference = "Stop"
$trayExecutable = Join-Path $ProjectRoot "desktop\tray\bin\CodexBridge.Tray.exe"
$configDirectory = Join-Path $env:USERPROFILE ".codex-bridge"
$stopSignalPath = Join-Path $configDirectory "tray.stop.requested"
$runnerLogPath = Join-Path $configDirectory "tray-runner.log"
New-Item -ItemType Directory -Force -Path $configDirectory | Out-Null
if (Test-Path -LiteralPath $stopSignalPath) { Remove-Item -LiteralPath $stopSignalPath -Force }

while (-not (Test-Path -LiteralPath $stopSignalPath)) {
  if (-not (Test-Path -LiteralPath $trayExecutable)) {
    Add-Content -LiteralPath $runnerLogPath -Value "$(Get-Date -Format o) tray executable missing: $trayExecutable"
    Start-Sleep -Seconds 10
    continue
  }

  $trayProcess = Start-Process -FilePath $trayExecutable `
    -ArgumentList "--project-root `"$ProjectRoot`"" `
    -WorkingDirectory $ProjectRoot `
    -WindowStyle Hidden `
    -PassThru `
    -Wait
  $exitCode = $trayProcess.ExitCode
  if (Test-Path -LiteralPath $stopSignalPath) { break }
  Add-Content -LiteralPath $runnerLogPath -Value "$(Get-Date -Format o) tray exited unexpectedly (code $exitCode); restarting in 3 seconds"
  Start-Sleep -Seconds 3
}

exit 0
