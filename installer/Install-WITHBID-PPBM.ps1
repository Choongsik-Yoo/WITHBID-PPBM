$ErrorActionPreference = "Stop"

$payload = Join-Path $PSScriptRoot "WITHBID-PPBM-app.zip"
$installRoot = Join-Path $env:LOCALAPPDATA "WITHBID-PPBM"
$desktop = [Environment]::GetFolderPath("Desktop")
$startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
$stagingRoot = Join-Path $env:TEMP ("withbid-install-{0}" -f [guid]::NewGuid().ToString("N"))
$progressForm = $null

function Show-InstallProgress([string]$message) {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $script:progressForm = New-Object System.Windows.Forms.Form
  $progressForm.Text = "WITHBID-PPBM 설치"
  $progressForm.Width = 460; $progressForm.Height = 155
  $progressForm.StartPosition = "CenterScreen"; $progressForm.FormBorderStyle = "FixedDialog"; $progressForm.ControlBox = $false
  $label = New-Object System.Windows.Forms.Label
  $label.Text = $message; $label.AutoSize = $false; $label.Width = 400; $label.Height = 45; $label.Left = 25; $label.Top = 20; $label.TextAlign = "MiddleCenter"
  $bar = New-Object System.Windows.Forms.ProgressBar
  $bar.Style = "Marquee"; $bar.MarqueeAnimationSpeed = 25; $bar.Width = 400; $bar.Left = 25; $bar.Top = 72
  $progressForm.Controls.Add($label); $progressForm.Controls.Add($bar)
  $progressForm.Show(); [System.Windows.Forms.Application]::DoEvents()
}

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
  if (-not (Test-Path -LiteralPath $payload)) { throw "설치 패키지 WITHBID-PPBM-app.zip을 찾을 수 없습니다." }
  Show-InstallProgress "앱 파일을 설치하고 있습니다. 잠시만 기다려 주세요."
  $pidFile = Join-Path $installRoot "server.pid"
  if (Test-Path -LiteralPath $pidFile) {
    $serverPid = [int](Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue)
    if ($serverPid) { Stop-Process -Id $serverPid -Force -ErrorAction SilentlyContinue }
  }
  New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
  Expand-Archive -LiteralPath $payload -DestinationPath $stagingRoot -Force
  New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
  Copy-Item -Path (Join-Path $stagingRoot "*") -Destination $installRoot -Recurse -Force
  New-AppShortcut (Join-Path $desktop "WITHBID-PPBM.lnk")
  New-AppShortcut (Join-Path $startMenu "WITHBID-PPBM.lnk")
  $progressForm.Close()
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show("WITHBID-PPBM 설치가 완료되었습니다.`n`n바탕화면의 WITHBID-PPBM 아이콘으로 실행하세요.", "WITHBID-PPBM 설치 완료", "OK", "Information") | Out-Null
} catch {
  if ($progressForm) { $progressForm.Close() }
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($_.Exception.Message, "WITHBID-PPBM 설치 오류", "OK", "Error") | Out-Null
  exit 1
} finally {
  if (Test-Path -LiteralPath $stagingRoot) { Remove-Item -LiteralPath $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
