$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$appUrl = "http://127.0.0.1:4317/"
$dataRoot = "\\Withusnas1\입찰관리"
$port = 4317
$pidFile = Join-Path $env:LOCALAPPDATA "WITHBID-PPBM\server.pid"

function Show-ErrorMessage([string]$message) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($message, "WITHBID-PPBM 실행 오류", "OK", "Error") | Out-Null
}

try {
  if (-not (Test-Path -LiteralPath $dataRoot)) {
    throw "NAS 입찰관리 공유폴더에 연결할 수 없습니다.`n`n파일 탐색기에서 \\Withusnas1\입찰관리 폴더를 먼저 열어 NAS 로그인을 완료한 뒤 다시 실행하세요."
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

  $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if ($listener) {
    try {
      $running = Invoke-RestMethod -TimeoutSec 2 "http://127.0.0.1:$port/api/app-info"
      if ($running.app -ne "WITHBID-PPBM" -or $running.dataRoot -ne $dataRoot) { throw "잘못된 서버" }
    } catch {
      throw "4317 포트를 다른 프로그램 또는 이전 WITHBID 서버가 사용 중입니다. 작업 관리자에서 기존 Node.js를 종료한 뒤 다시 실행하세요."
    }
  } else {
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
  Show-ErrorMessage $_.Exception.Message
  exit 1
}
