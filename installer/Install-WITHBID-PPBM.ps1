$ErrorActionPreference = "Stop"

$sourceRoot = Join-Path $PSScriptRoot "app"
$installRoot = Join-Path $env:LOCALAPPDATA "WITHBID-PPBM"
$desktop = [Environment]::GetFolderPath("Desktop")
$startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"

function New-AppShortcut([string]$shortcutPath) {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = "powershell.exe"
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$installRoot\start-withbid-ppbm.ps1`""
  $shortcut.WorkingDirectory = $installRoot
  $shortcut.Description = "WITHBID-PPBM 조달공고 분석"
  $shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,14"
  $shortcut.Save()
}

try {
  if (-not (Test-Path -LiteralPath $sourceRoot)) { throw "설치 파일의 app 폴더를 찾을 수 없습니다." }

  $pidFile = Join-Path $installRoot "server.pid"
  if (Test-Path -LiteralPath $pidFile) {
    $serverPid = [int](Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue)
    if ($serverPid) { Stop-Process -Id $serverPid -Force -ErrorAction SilentlyContinue }
  }

  New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
  Copy-Item -Path (Join-Path $sourceRoot "*") -Destination $installRoot -Recurse -Force
  New-AppShortcut (Join-Path $desktop "WITHBID-PPBM.lnk")
  New-AppShortcut (Join-Path $startMenu "WITHBID-PPBM.lnk")

  Add-Type -AssemblyName PresentationFramework
  $answer = [System.Windows.MessageBox]::Show(
    "WITHBID-PPBM 설치가 완료되었습니다.`n`nNAS 로그인 후 앱을 지금 실행하시겠습니까?",
    "WITHBID-PPBM 설치 완료", "YesNo", "Information"
  )
  if ($answer -eq [System.Windows.MessageBoxResult]::Yes) {
    Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$installRoot\start-withbid-ppbm.ps1`""
  }
} catch {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($_.Exception.Message, "WITHBID-PPBM 설치 오류", "OK", "Error") | Out-Null
  exit 1
}
