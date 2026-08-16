param(
  [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectRoot "outputs\relay-release" }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
$workRoot = Join-Path $OutputDirectory "work"
$payloadRoot = Join-Path $workRoot "CodexBridge-Relay"
$archive = Join-Path $OutputDirectory "CodexBridge-Relay-Deploy.zip"

if (Test-Path -LiteralPath $workRoot) { Remove-Item -LiteralPath $workRoot -Recurse -Force }
New-Item -ItemType Directory -Force -Path $payloadRoot | Out-Null

foreach ($directory in @("app", "public", "relay", "deploy\relay")) {
  $source = Join-Path $projectRoot $directory
  $destination = Join-Path $payloadRoot $directory
  New-Item -ItemType Directory -Force -Path $destination | Out-Null
  Get-ChildItem -LiteralPath $source -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $destination -Recurse -Force
  }
}

foreach ($file in @(
  "package.json", "package-lock.json", "tsconfig.json", "next-env.d.ts",
  "next.config.ts", "postcss.config.mjs", "vite.config.ts", "LICENSE", "NOTICE"
)) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination (Join-Path $payloadRoot $file) -Force
}

foreach ($privateFile in @("deploy\relay\.env", "deploy\relay\relay-client.json")) {
  $path = Join-Path $payloadRoot $privateFile
  if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
}
foreach ($localOnlyPath in @("app\_sites-preview", "public\downloads")) {
  $path = Join-Path $payloadRoot $localOnlyPath
  if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
}

if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
Compress-Archive -Path (Join-Path $payloadRoot "*") -DestinationPath $archive -CompressionLevel Optimal
Remove-Item -LiteralPath $workRoot -Recurse -Force

Get-FileHash -Algorithm SHA256 -LiteralPath $archive |
  ForEach-Object { "$($_.Hash.ToLowerInvariant())  $([IO.Path]::GetFileName($_.Path))" } |
  Set-Content -LiteralPath (Join-Path $OutputDirectory "SHA256SUMS-relay.txt") -Encoding ascii

Write-Host "Relay release built:"
Write-Host $archive
