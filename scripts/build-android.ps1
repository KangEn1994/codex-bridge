param(
  [string]$BridgeUrl = "",
  [ValidateSet("Debug", "Release")][string]$Variant = "Debug",
  [switch]$SkipWebBuild
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path $PSScriptRoot -Parent
$toolsRoot = Join-Path $projectRoot ".tools"
$jdkRoot = Join-Path $toolsRoot "jdk"
$sdkRoot = Join-Path $env:LOCALAPPDATA "Android\Sdk"
$gradle = Join-Path $projectRoot "android\gradlew.bat"

if (-not (Test-Path (Join-Path $jdkRoot "bin\java.exe")) -or -not (Test-Path (Join-Path $sdkRoot "platforms\android-35\android.jar"))) {
  & (Join-Path $PSScriptRoot "setup-android-toolchain.ps1")
}
if (-not (Test-Path $gradle)) { throw "Gradle wrapper is missing. Generate it once with Gradle 8.9." }

$env:JAVA_HOME = $jdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
Set-Content -LiteralPath (Join-Path $projectRoot "android\local.properties") -Value ("sdk.dir=" + $sdkRoot.Replace("\", "\\")) -Encoding ascii

if ($Variant -eq "Release") {
  $requiredSigningVariables = @(
    "CODEX_BRIDGE_KEYSTORE_PATH",
    "CODEX_BRIDGE_KEYSTORE_PASSWORD",
    "CODEX_BRIDGE_KEY_ALIAS",
    "CODEX_BRIDGE_KEY_PASSWORD"
  )
  $missingSigningVariables = $requiredSigningVariables | Where-Object { -not [Environment]::GetEnvironmentVariable($_) }
  if ($missingSigningVariables) {
    throw "Release signing is not configured. Missing: $($missingSigningVariables -join ', ')"
  }
}

$gradleTask = if ($Variant -eq "Release") { "assembleRelease" } else { "assembleDebug" }
& $gradle -p (Join-Path $projectRoot "android") clean $gradleTask "-PbridgeUrl=$BridgeUrl"
if ($LASTEXITCODE -ne 0) { throw "Android build failed with exit code $LASTEXITCODE" }

$variantLower = $Variant.ToLowerInvariant()
$sourceApk = Join-Path $projectRoot "android\app\build\outputs\apk\$variantLower\app-$variantLower.apk"
$outputs = Join-Path $projectRoot "outputs\android"
$outputApk = Join-Path $outputs "CodexBridge-$variantLower.apk"
New-Item -ItemType Directory -Force -Path $outputs | Out-Null
Copy-Item -LiteralPath $sourceApk -Destination $outputApk -Force

if (-not $SkipWebBuild) {
  Push-Location $projectRoot
  try { npm run build } finally { Pop-Location }
}

$sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $outputApk).Hash
Write-Host "APK ready: $outputApk"
Write-Host "SHA-256: $sha256"
