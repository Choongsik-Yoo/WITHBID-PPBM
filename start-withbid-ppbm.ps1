$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$appUrl = "http://127.0.0.1:4317/"
$dataRoot = "\\Withusnas1\입찰관리"
$port = 4317
$pidFile = Join-Path $env:LOCALAPPDATA "WITHBID-PPBM\server.pid"
$logFile = Join-Path $env:LOCALAPPDATA "WITHBID-PPBM\launcher.log"
$updateCheckFile = Join-Path $env:LOCALAPPDATA "WITHBID-PPBM\update-check.json"
$updateRepo = "Choongsik-Yoo/WITHBID-PPBM"
$updateCheckIntervalMinutes = 10

function Write-LauncherLog([string]$message) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $logFile) -Force | Out-Null
  Add-Content -LiteralPath $logFile -Value ("{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message) -Encoding UTF8
}

function Get-LocalAppVersion {
  try {
    return (Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $projectRoot "package.json") | ConvertFrom-Json).version
  } catch { return $null }
}

function Test-RemoteNewer([string]$remote, [string]$local) {
  try { return ([version]$remote) -gt ([version]$local) } catch { return $false }
}

function Test-AssetSha256([string]$path, [string]$expectedDigest) {
  $expectedHex = ($expectedDigest -replace '^sha256:', '').ToUpperInvariant()
  $stream = [IO.File]::OpenRead($path)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $actualHex = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace("-", "") }
  finally { $sha.Dispose(); $stream.Dispose() }
  return $actualHex -eq $expectedHex
}

# 실행할 때마다 GitHub에 새 버전이 있는지 확인하고, 있으면 조용히 내려받아 설치한 뒤 이어서 실행합니다.
# 오프라인이거나 GitHub 확인/설치에 실패해도 절대 앱 실행 자체를 막지 않습니다(로그만 남기고 계속 진행).
function Invoke-AutoUpdate {
  $localVersion = Get-LocalAppVersion
  if (-not $localVersion) { Write-LauncherLog "자동 업데이트: 로컬 버전을 확인하지 못해 건너뜁니다."; return }

  $lastCheck = $null
  if (Test-Path -LiteralPath $updateCheckFile) {
    try { $lastCheck = Get-Content -Raw -Encoding UTF8 -LiteralPath $updateCheckFile | ConvertFrom-Json } catch { $lastCheck = $null }
  }
  if ($lastCheck -and $lastCheck.checkedAt) {
    $elapsed = (Get-Date) - [DateTime]$lastCheck.checkedAt
    if ($elapsed.TotalMinutes -lt $updateCheckIntervalMinutes) {
      Write-LauncherLog "자동 업데이트: 최근 $([int]$elapsed.TotalMinutes)분 전에 확인했으므로 건너뜁니다."
      return
    }
  }

  try {
    $release = Invoke-RestMethod -TimeoutSec 5 -Headers @{ "User-Agent" = "WITHBID-PPBM-Launcher" } "https://api.github.com/repos/$updateRepo/releases/latest"
  } catch {
    Write-LauncherLog "자동 업데이트: GitHub 릴리스 확인 실패 ($($_.Exception.Message)). 기존 버전으로 계속 실행합니다."
    return
  }

  New-Item -ItemType Directory -Path (Split-Path -Parent $updateCheckFile) -Force | Out-Null
  Set-Content -LiteralPath $updateCheckFile -Value (@{ checkedAt = (Get-Date).ToString("o") } | ConvertTo-Json) -Encoding UTF8

  $remoteVersion = $release.tag_name -replace '^v', ''
  if (-not (Test-RemoteNewer $remoteVersion $localVersion)) {
    Write-LauncherLog "자동 업데이트: 이미 최신 버전입니다 (v$localVersion)."
    return
  }

  Write-LauncherLog "자동 업데이트: 새 버전 v$remoteVersion 발견 (현재 v$localVersion). 다운로드를 시작합니다."
  $appAsset = $release.assets | Where-Object { $_.name -eq "WITHBID-PPBM-app.zip" } | Select-Object -First 1
  $installerAsset = $release.assets | Where-Object { $_.name -eq "Install-WITHBID-PPBM.ps1" } | Select-Object -First 1
  if (-not $appAsset -or -not $installerAsset) {
    Write-LauncherLog "자동 업데이트: 릴리스에서 필요한 파일을 찾지 못해 건너뜁니다."
    return
  }

  $stagingRoot = Join-Path $env:TEMP ("withbid-update-{0}" -f [guid]::NewGuid().ToString("N"))
  try {
    New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
    $appZipPath = Join-Path $stagingRoot "WITHBID-PPBM-app.zip"
    $installerPath = Join-Path $stagingRoot "Install-WITHBID-PPBM.ps1"
    Invoke-WebRequest -UseBasicParsing -TimeoutSec 300 -Uri $appAsset.browser_download_url -OutFile $appZipPath
    Invoke-WebRequest -UseBasicParsing -TimeoutSec 60 -Uri $installerAsset.browser_download_url -OutFile $installerPath

    if (-not (Test-AssetSha256 $appZipPath $appAsset.digest)) { throw "앱 파일 무결성 검증에 실패했습니다." }
    if (-not (Test-AssetSha256 $installerPath $installerAsset.digest)) { throw "설치 스크립트 무결성 검증에 실패했습니다." }

    Write-LauncherLog "자동 업데이트: 다운로드·검증 완료. 설치를 실행합니다."
    $installProcess = Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", $installerPath) -WorkingDirectory $stagingRoot -Wait -PassThru
    if ($installProcess.ExitCode -ne 0) { throw "설치 스크립트가 종료 코드 $($installProcess.ExitCode)로 실패했습니다." }
    Write-LauncherLog "자동 업데이트: v$remoteVersion 설치를 완료했습니다."
  } catch {
    Write-LauncherLog "자동 업데이트 실패: $($_.Exception.Message). 기존 버전으로 계속 실행합니다."
  } finally {
    if (Test-Path -LiteralPath $stagingRoot) { Remove-Item -LiteralPath $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue }
  }
}

function Test-NasByCommand([string]$uncPath) {
  try {
    # 파일 탐색기와 동일한 현재 Windows 사용자로 UNC 경로를 실제 조회합니다.
    $command = 'dir "{0}" >nul 2>&1' -f $uncPath
    & $env:ComSpec /d /c $command
    $succeeded = $LASTEXITCODE -eq 0
    Write-LauncherLog "CMD NAS 조회: $uncPath / 종료코드 $LASTEXITCODE"
    return $succeeded
  } catch {
    Write-LauncherLog "CMD NAS 조회 오류: $uncPath / $($_.Exception.Message)"
    return $false
  }
}

function Show-ErrorMessage([string]$message) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($message, "WITHBID-PPBM 실행 오류", "OK", "Error") | Out-Null
}

try {
  Write-LauncherLog "실행 시작: $env:USERNAME"
  try { Invoke-AutoUpdate } catch { Write-LauncherLog "자동 업데이트 확인 중 예상치 못한 오류: $($_.Exception.Message). 기존 버전으로 계속 실행합니다." }

  if (-not (Test-NasByCommand $dataRoot)) {
    throw "NAS 공유폴더에 접근할 수 없습니다.`n`n파일 탐색기 주소창에 아래 경로를 입력하여 NAS 로그인을 완료한 후 다시 실행하세요.`n`n\\Withusnas1\입찰관리`n`n진단 로그: $logFile"
  }

  # NAS 암호는 앱에 보관하지 않습니다. 현재 Windows 사용자의 SMB 세션을 사용합니다.
  $probe = Join-Path $dataRoot (".withbid-access-{0}.tmp" -f [guid]::NewGuid().ToString("N"))
  try {
    [System.IO.File]::WriteAllText($probe, "WITHBID-PPBM access check")
    Remove-Item -LiteralPath $probe -Force
  } catch {
    if (Test-Path -LiteralPath $probe) { Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue }
    throw "NAS 폴더는 열리지만 파일 쓰기 권한이 없습니다. 공공조달 담당자 계정의 NAS 권한을 확인하세요."
  }

  $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  $needsStart = -not $listener
  if ($listener) {
    try {
      $running = Invoke-RestMethod -TimeoutSec 2 "http://127.0.0.1:$port/api/app-info"
      if ($running.app -ne "WITHBID-PPBM" -or $running.dataRoot -ne $dataRoot) { throw "잘못된 서버" }
    } catch {
      # v0.2.0 이전 WITHBID는 app-info가 없으므로 인증 설정 API로 식별한 뒤에만 교체합니다.
      try {
        $legacy = Invoke-RestMethod -TimeoutSec 2 "http://127.0.0.1:$port/api/auth/config"
        if ($null -eq $legacy.configured -or $null -eq $legacy.userCount) { throw "WITHBID가 아님" }
        Stop-Process -Id $listener.OwningProcess -Force -ErrorAction Stop
        Start-Sleep -Milliseconds 500
        $needsStart = $true
      } catch {
        throw "4317 포트를 다른 프로그램이 사용 중입니다. 해당 프로그램을 종료한 뒤 다시 실행하세요."
      }
    }
  }

  if ($needsStart) {
    $bundledNode = Join-Path $projectRoot "runtime\node.exe"
    $node = if (Test-Path -LiteralPath $bundledNode) { $bundledNode } else { (Get-Command node.exe -ErrorAction Stop).Source }
    $env:DATA_ROOT = $dataRoot
    $env:PORT = [string]$port

    $process = Start-Process -FilePath $node -ArgumentList "src/server.js" -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
    New-Item -ItemType Directory -Path (Split-Path -Parent $pidFile) -Force | Out-Null
    Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding ASCII

    $ready = $false
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
      Start-Sleep -Milliseconds 500
      try {
        $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 $appUrl
        if ($response.StatusCode -eq 200) { $ready = $true; break }
      } catch { }
    }
    if (-not $ready) { throw "앱 서버가 제한 시간 안에 시작되지 않았습니다. NAS 연결과 앱 설치 상태를 확인하세요." }
  }

  Start-Process $appUrl
} catch {
  Write-LauncherLog "실행 오류: $($_.Exception.Message)"
  Show-ErrorMessage $_.Exception.Message
  exit 1
}
