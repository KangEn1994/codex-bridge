param(
  [string]$OutputDir = (Join-Path (Split-Path $PSScriptRoot -Parent) ".tmp-appserver-schema")
)

$ErrorActionPreference = "Stop"
$codex = Get-Command codex -ErrorAction SilentlyContinue
if (-not $codex) { throw "Codex CLI was not found in PATH." }

$outputRoot = [IO.Path]::GetFullPath($OutputDir)
$typescriptOutput = Join-Path $outputRoot "typescript"
$schemaOutput = Join-Path $outputRoot "json-schema"
New-Item -ItemType Directory -Force -Path $typescriptOutput, $schemaOutput | Out-Null

& $codex.Source app-server generate-ts --out $typescriptOutput
if ($LASTEXITCODE -ne 0) { throw "TypeScript protocol generation failed with exit code $LASTEXITCODE" }

& $codex.Source app-server generate-json-schema --out $schemaOutput
if ($LASTEXITCODE -ne 0) { throw "JSON Schema generation failed with exit code $LASTEXITCODE" }

Write-Host "Protocol snapshot generated outside Git tracking: $outputRoot"
