param([switch]$NoLaunch)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$trayExe = Join-Path $projectRoot "CodexBridge.exe"
if (-not (Test-Path -LiteralPath $trayExe)) { $trayExe = Join-Path $projectRoot "desktop\tray\bin\CodexBridge.Tray.exe" }
if (-not (Test-Path -LiteralPath $trayExe)) { throw "Codex Bridge tray executable is missing." }

$shell = New-Object -ComObject WScript.Shell
$startup = [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
$startMenu = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::Programs)) "Codex Bridge"
New-Item -ItemType Directory -Force -Path $startMenu | Out-Null

foreach ($shortcutPath in @(
  (Join-Path $startup "Codex Bridge.lnk"),
  (Join-Path $startMenu "Codex Bridge.lnk")
)) {
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $trayExe
  $shortcut.Arguments = "--project-root `"$projectRoot`""
  $shortcut.WorkingDirectory = $projectRoot
  $shortcut.IconLocation = "$trayExe,0"
  $shortcut.Description = "Codex Bridge mobile companion"
  $shortcut.Save()
}

if (-not $NoLaunch) {
  $running = Get-Process -Name "CodexBridge.Tray" -ErrorAction SilentlyContinue
  if (-not $running) {
    Start-Process -FilePath $trayExe -ArgumentList @("--project-root", $projectRoot) -WorkingDirectory $projectRoot -WindowStyle Hidden
  }
}

Write-Host "Codex Bridge is installed for the current Windows user."
