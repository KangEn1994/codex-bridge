param(
  [string]$OutputDirectory = "",
  [string]$NodeExecutable = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectRoot "outputs\windows-release" }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
$package = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
$version = [string]$package.version
$workRoot = Join-Path $OutputDirectory "work"
$payloadRoot = Join-Path $workRoot "CodexBridge"
$portableZip = Join-Path $OutputDirectory "CodexBridge-Windows-Portable.zip"
$setupExe = Join-Path $OutputDirectory "CodexBridge-Windows-Setup.exe"

if (Test-Path -LiteralPath $workRoot) { Remove-Item -LiteralPath $workRoot -Recurse -Force }
New-Item -ItemType Directory -Force -Path $payloadRoot | Out-Null

Push-Location $projectRoot
try {
  & (Get-Command npm.cmd).Source run build
  if ($LASTEXITCODE -ne 0) { throw "Web build failed." }
} finally { Pop-Location }

function Copy-Tree([string]$Source, [string]$Destination) {
  if (-not (Test-Path -LiteralPath $Source)) { throw "Required directory is missing: $Source" }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  & robocopy.exe $Source $Destination /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -gt 7) { throw "Failed to copy $Source (robocopy exit $LASTEXITCODE)." }
}

foreach ($directory in @("dist", "scripts")) {
  Copy-Tree (Join-Path $projectRoot $directory) (Join-Path $payloadRoot $directory)
}
foreach ($file in @(
  "LICENSE", "NOTICE", "README.md"
)) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination (Join-Path $payloadRoot $file) -Force
}

$runtimeDirectory = Join-Path $payloadRoot "runtime"
New-Item -ItemType Directory -Force -Path $runtimeDirectory | Out-Null
$esbuild = Join-Path $projectRoot "node_modules\.bin\esbuild.cmd"
& $esbuild (Join-Path $projectRoot "host\server.ts") --bundle --platform=node --format=esm --target=node22 `
  --external:qrcode --external:ws --external:sharp "--outfile=$runtimeDirectory\host-server.mjs"
if ($LASTEXITCODE -ne 0) { throw "Host runtime bundle failed." }
& $esbuild (Join-Path $projectRoot "scripts\packaged-web-server.ts") --bundle --platform=node --format=esm --target=node22 --external:sharp "--outfile=$runtimeDirectory\web-server.mjs"
if ($LASTEXITCODE -ne 0) { throw "Web runtime bundle failed." }

foreach ($dependency in @(
  "qrcode", "dijkstrajs", "pngjs", "ws",
  "react", "react-dom", "scheduler", "ipaddr.js",
  "sharp", "detect-libc", "semver", "@img\colour", "@img\sharp-win32-x64"
)) {
  Copy-Tree (Join-Path $projectRoot "node_modules\$dependency") (Join-Path $payloadRoot "node_modules\$dependency")
}

$trayOutput = Join-Path $payloadRoot "desktop\tray\bin"
& (Join-Path $PSScriptRoot "build-tray.ps1") -OutputDirectory $trayOutput
if ($LASTEXITCODE -ne 0) { throw "Tray build failed." }
Copy-Item -LiteralPath (Join-Path $trayOutput "CodexBridge.Tray.exe") -Destination (Join-Path $payloadRoot "CodexBridge.exe") -Force

$windowsRoot = if ($env:WINDIR) { $env:WINDIR } else { "C:\Windows" }
$compiler = @(
  (Join-Path $windowsRoot "Microsoft.NET\Framework64\v4.0.30319\csc.exe"),
  (Join-Path $windowsRoot "Microsoft.NET\Framework\v4.0.30319\csc.exe")
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $compiler) { throw "Windows .NET Framework C# compiler was not found." }

$uninstaller = Join-Path $payloadRoot "CodexBridge.Uninstall.exe"
& $compiler /nologo /target:winexe /platform:anycpu /optimize+ /codepage:65001 `
  "/win32icon:$projectRoot\desktop\tray\assets\codex-bridge.ico" `
  "/out:$uninstaller" /reference:System.dll /reference:System.Core.dll /reference:System.Windows.Forms.dll `
  (Join-Path $projectRoot "desktop\installer\Uninstaller.cs")
if ($LASTEXITCODE -ne 0) { throw "Uninstaller compilation failed." }

if (-not $NodeExecutable) { $NodeExecutable = (Get-Command node.exe).Source }
if (-not (Test-Path -LiteralPath $NodeExecutable)) { throw "Node.js executable was not found." }
Copy-Item -LiteralPath $NodeExecutable -Destination (Join-Path $runtimeDirectory "node.exe") -Force

@{
  product = "Codex Bridge"
  version = $version
  nodeVersion = (& $NodeExecutable --version)
  builtAt = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $payloadRoot "release.json") -Encoding UTF8

if (Test-Path -LiteralPath $portableZip) { Remove-Item -LiteralPath $portableZip -Force }
Compress-Archive -Path (Join-Path $payloadRoot "*") -DestinationPath $portableZip -CompressionLevel Optimal

if (Test-Path -LiteralPath $setupExe) { Remove-Item -LiteralPath $setupExe -Force }
& $compiler /nologo /target:winexe /platform:anycpu /optimize+ /codepage:65001 `
  "/win32icon:$projectRoot\desktop\tray\assets\codex-bridge.ico" `
  "/resource:$portableZip,CodexBridge.Payload.zip" `
  "/out:$setupExe" `
  /reference:System.dll /reference:System.Core.dll /reference:System.Windows.Forms.dll `
  /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll `
  (Join-Path $projectRoot "desktop\installer\Installer.cs")
if ($LASTEXITCODE -ne 0) { throw "Setup compilation failed." }

Get-FileHash -Algorithm SHA256 -LiteralPath $portableZip, $setupExe |
  ForEach-Object { "$($_.Hash.ToLowerInvariant())  $([IO.Path]::GetFileName($_.Path))" } |
  Set-Content -LiteralPath (Join-Path $OutputDirectory "SHA256SUMS-windows.txt") -Encoding ascii

Remove-Item -LiteralPath $workRoot -Recurse -Force
Write-Host "Windows release built:"
Write-Host $setupExe
Write-Host $portableZip
