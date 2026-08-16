param(
  [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$sourceRoot = Join-Path $projectRoot "desktop\tray"
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectRoot "desktop\tray\bin" }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

$windowsRoot = if ($env:WINDIR) { $env:WINDIR } elseif ($env:SystemRoot) { $env:SystemRoot } else { "C:\Windows" }
$compilerCandidates = @(
  (Join-Path $windowsRoot "Microsoft.NET\Framework64\v4.0.30319\csc.exe"),
  (Join-Path $windowsRoot "Microsoft.NET\Framework\v4.0.30319\csc.exe")
)
$compiler = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $compiler) { throw "Windows .NET Framework C# compiler was not found." }

$output = Join-Path $OutputDirectory "CodexBridge.Tray.exe"
$sources = Get-ChildItem -LiteralPath $sourceRoot -Filter "*.cs" | ForEach-Object { $_.FullName }
if (-not $sources) { throw "Tray source files were not found: $sourceRoot" }

$arguments = @(
  "/nologo",
  "/target:winexe",
  "/platform:anycpu",
  "/optimize+",
  "/codepage:65001",
  "/win32manifest:$sourceRoot\app.manifest",
  "/win32icon:$sourceRoot\assets\codex-bridge.ico",
  "/resource:$sourceRoot\assets\tray-icon.png,CodexBridge.TrayIcon.png",
  "/out:$output",
  "/reference:System.dll",
  "/reference:System.Core.dll",
  "/reference:System.Drawing.dll",
  "/reference:System.Windows.Forms.dll",
  "/reference:System.Web.Extensions.dll"
) + $sources

& $compiler $arguments
if ($LASTEXITCODE -ne 0) { throw "Tray compilation failed." }
Write-Host "Tray executable built: $output"
