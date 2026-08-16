param(
  [string]$ToolsDir = (Join-Path (Split-Path $PSScriptRoot -Parent) ".tools")
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path $PSScriptRoot -Parent
$toolsRoot = [IO.Path]::GetFullPath($ToolsDir)
$jdkZip = Join-Path $toolsRoot "jdk21.zip"
$androidZip = Join-Path $toolsRoot "android-commandline.zip"
$jdkRoot = Join-Path $toolsRoot "jdk"
$commandLineRoot = Join-Path $toolsRoot "android-sdk"
$sdkRoot = Join-Path $env:LOCALAPPDATA "Android\Sdk"
$androidCli = Join-Path $commandLineRoot "cmdline-tools\latest\bin\android.exe"
$jdkUrl = "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12%2B8/OpenJDK21U-jdk_x64_windows_hotspot_21.0.12_8.zip"
$jdkSha256 = "9BA963EE2371874A74185D18BC7BB2AB9407DF7683300855ED7606E0662321D0"

New-Item -ItemType Directory -Force -Path $toolsRoot | Out-Null

if (-not (Test-Path (Join-Path $jdkRoot "bin\java.exe"))) {
  if (-not (Test-Path $jdkZip)) {
    Invoke-WebRequest $jdkUrl -OutFile $jdkZip
  }
  $actualJdkHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $jdkZip).Hash
  if ($actualJdkHash -ne $jdkSha256) { throw "JDK checksum mismatch: $actualJdkHash" }
  $jdkExtract = Join-Path $toolsRoot "jdk-extract"
  New-Item -ItemType Directory -Force -Path $jdkExtract, $jdkRoot | Out-Null
  Expand-Archive -LiteralPath $jdkZip -DestinationPath $jdkExtract -Force
  $jdkTop = Get-ChildItem -LiteralPath $jdkExtract -Directory | Select-Object -First 1
  Copy-Item -Path (Join-Path $jdkTop.FullName "*") -Destination $jdkRoot -Recurse -Force
}

if (-not (Test-Path $androidCli)) {
  if (-not (Test-Path $androidZip)) {
    Invoke-WebRequest "https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip" -OutFile $androidZip
  }
  $expectedHash = "90AE805D20434428BFFCB699C290860F19BB5F66A67E6B330067E3DE801FB04A"
  $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $androidZip).Hash
  if ($actualHash -ne $expectedHash) { throw "Android command-line tools checksum mismatch: $actualHash" }
  $androidExtract = Join-Path $toolsRoot "android-extract"
  $latest = Join-Path $commandLineRoot "cmdline-tools\latest"
  New-Item -ItemType Directory -Force -Path $androidExtract, $latest | Out-Null
  Expand-Archive -LiteralPath $androidZip -DestinationPath $androidExtract -Force
  Copy-Item -Path (Join-Path $androidExtract "cmdline-tools\*") -Destination $latest -Recurse -Force
}

$env:JAVA_HOME = $jdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
if (-not (Test-Path (Join-Path $sdkRoot "platforms\android-35\android.jar")) -or
    -not (Test-Path (Join-Path $sdkRoot "build-tools\35.0.0\aapt2.exe")) -or
    -not (Test-Path (Join-Path $sdkRoot "platform-tools\adb.exe"))) {
  "y" | & $androidCli --no-metrics sdk install platform-tools "platforms;android-35" "build-tools;35.0.0"
  if ($LASTEXITCODE -ne 0 -and -not (Test-Path (Join-Path $sdkRoot "platforms\android-35\android.jar"))) {
    throw "Android SDK installation failed with exit code $LASTEXITCODE"
  }
}

Set-Content -LiteralPath (Join-Path $projectRoot "android\local.properties") -Value ("sdk.dir=" + $sdkRoot.Replace("\", "\\")) -Encoding ascii
Write-Host "Android toolchain ready: $sdkRoot"
