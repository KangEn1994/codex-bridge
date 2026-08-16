param(
  [int]$ApiPort = 43110,
  [int]$WebPort = 3000,
  [string]$ListenAddress = "127.0.0.1",
  [string]$PublicUrl = "",
  [string]$PublicHost = "",
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$logs = Join-Path $projectRoot ".logs"
$configDir = Join-Path $env:USERPROFILE ".codex-bridge"
$runtimePath = Join-Path $configDir "runtime.json"
$launcherConfigPath = Join-Path $configDir "launcher.json"
$stopSignalPath = Join-Path $configDir "stop.requested"
New-Item -ItemType Directory -Force -Path $logs, $configDir | Out-Null
if (Test-Path -LiteralPath $stopSignalPath) { Remove-Item -LiteralPath $stopSignalPath -Force }

if (-not (Test-Path (Join-Path $projectRoot "dist\server\index.js"))) {
  Write-Host "首次运行：正在构建手机端..."
  Push-Location $projectRoot
  try { & (Get-Command npm.cmd).Source run build } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { throw "手机端构建失败" }
}

if ($PublicUrl -and $PublicHost) { throw "PublicUrl 和 PublicHost 不能同时使用。" }

$savedLauncherConfig = $null
if (Test-Path -LiteralPath $launcherConfigPath) {
  try { $savedLauncherConfig = Get-Content -LiteralPath $launcherConfigPath -Raw | ConvertFrom-Json } catch { $savedLauncherConfig = $null }
}

if ($PublicHost) { $PublicUrl = "http://${PublicHost}:$ApiPort" }
if (-not $PublicUrl -and $savedLauncherConfig.publicUrl) { $PublicUrl = [string]$savedLauncherConfig.publicUrl }
if (-not $PublicUrl) {
  $defaultHost = if ($ListenAddress -in @("127.0.0.1", "localhost", "::1")) {
    "127.0.0.1"
  } else {
    [System.Net.Dns]::GetHostName()
  }
  $PublicUrl = "http://${defaultHost}:$ApiPort"
}

try { $parsedPublicUrl = [Uri]$PublicUrl } catch { throw "PublicUrl 不是有效地址：$PublicUrl" }
if (-not $parsedPublicUrl.IsAbsoluteUri -or $parsedPublicUrl.Scheme -notin @("http", "https")) {
  throw "PublicUrl 必须是完整的 http 或 https 地址，例如 https://codex.example.com。"
}
if ($parsedPublicUrl.Query -or $parsedPublicUrl.Fragment -or ($parsedPublicUrl.AbsolutePath -and $parsedPublicUrl.AbsolutePath -ne "/")) {
  throw "PublicUrl 目前只支持站点根地址，不能包含路径、查询参数或片段。"
}

$publicApiUrl = $PublicUrl.TrimEnd("/")
$webUrl = $publicApiUrl
@{
  publicUrl = $publicApiUrl
  apiPort = $ApiPort
  webPort = $WebPort
  listenAddress = $ListenAddress
} | ConvertTo-Json | Set-Content -LiteralPath $launcherConfigPath -Encoding UTF8
$powershell = (Get-Command powershell.exe).Source
$hostRunner = Join-Path $PSScriptRoot "run-host.ps1"
$webRunner = Join-Path $PSScriptRoot "run-web.ps1"
$hostProcess = $null
$webProcess = $null

$apiListening = Get-NetTCPConnection -LocalPort $ApiPort -State Listen -ErrorAction SilentlyContinue
if (-not $apiListening) {
  $hostArguments = @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $hostRunner,
    "-ProjectRoot", $projectRoot, "-ApiPort", [string]$ApiPort,
    "-ListenAddress", $ListenAddress, "-PublicApiUrl", $publicApiUrl, "-WebUrl", $webUrl,
    "-StopSignalPath", $stopSignalPath
  )
  $hostProcess = Start-Process -FilePath $powershell -ArgumentList $hostArguments -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logs "host.out.log") `
    -RedirectStandardError (Join-Path $logs "host.err.log") -PassThru
} else {
  Write-Host "电脑端口 $ApiPort 已有服务监听，跳过重复启动。"
}

$webListening = Get-NetTCPConnection -LocalPort $WebPort -State Listen -ErrorAction SilentlyContinue
if (-not $webListening) {
  $webArguments = @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $webRunner,
    "-ProjectRoot", $projectRoot, "-WebPort", [string]$WebPort, "-ApiPort", [string]$ApiPort,
    "-StopSignalPath", $stopSignalPath
  )
  $webProcess = Start-Process -FilePath $powershell -ArgumentList $webArguments -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logs "web.out.log") `
    -RedirectStandardError (Join-Path $logs "web.err.log") -PassThru
} else {
  Write-Host "手机端口 $WebPort 已有服务监听，跳过重复启动。"
}

@{
  apiPort = $ApiPort
  webPort = $WebPort
  hostLauncherPid = if ($hostProcess) { $hostProcess.Id } else { $null }
  webLauncherPid = if ($webProcess) { $webProcess.Id } else { $null }
  startedAt = (Get-Date).ToString("o")
} | ConvertTo-Json | Set-Content -LiteralPath $runtimePath -Encoding UTF8

Start-Sleep -Seconds 2
Write-Host "Codex Bridge 已启动"
Write-Host "手机页面: $webUrl"
Write-Host "电脑配对页: http://127.0.0.1:$ApiPort/setup"
if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$ApiPort/setup" }
