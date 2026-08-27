$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$appUrl = "http://127.0.0.1:4317/"
$dataRoot = "\\WITHUSNAS1\입찰관리"
$port = 4317

function Show-ErrorMessage([string]$message) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show(
    $message,
    "WITHBID-PPBM 실행 오류",
    [System.Windows.MessageBoxButton]::OK,
    [System.Windows.MessageBoxImage]::Error
  ) | Out-Null
}

try {
  if (-not (Test-Path -LiteralPath $dataRoot)) {
    throw "WITHUSNAS1의 입찰관리 공유폴더에 연결할 수 없습니다. 사내 네트워크와 NAS 로그인 상태를 확인하세요."
  }
  $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue

  if (-not $listener) {
    $npm = Get-Command npm.cmd -ErrorAction Stop
    $env:DATA_ROOT = $dataRoot
    $env:PORT = [string]$port

    Start-Process `
      -FilePath $npm.Source `
      -ArgumentList "start" `
      -WorkingDirectory $projectRoot `
      -WindowStyle Hidden

    $ready = $false
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
      Start-Sleep -Milliseconds 500
      try {
        $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 $appUrl
        if ($response.StatusCode -eq 200) {
          $ready = $true
          break
        }
      } catch {
        # 서버가 준비될 때까지 다시 확인합니다.
      }
    }

    if (-not $ready) {
      throw "앱 서버가 제한 시간 안에 시작되지 않았습니다. Node.js 설치 여부와 프로젝트 상태를 확인하세요."
    }
  }

  Start-Process $appUrl
} catch {
  Show-ErrorMessage $_.Exception.Message
  exit 1
}
