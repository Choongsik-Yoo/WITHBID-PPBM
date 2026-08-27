$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$appUrl = "http://127.0.0.1:4317/"
$dataRoot = "\\Withusnas1\입찰관리"
$port = 4317
$pidFile = Join-Path $env:LOCALAPPDATA "WITHBID-PPBM\server.pid"
$logFile = Join-Path $env:LOCALAPPDATA "WITHBID-PPBM\launcher.log"

function Write-LauncherLog([string]$message) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $logFile) -Force | Out-Null
  Add-Content -LiteralPath $logFile -Value ("{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message) -Encoding UTF8
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
