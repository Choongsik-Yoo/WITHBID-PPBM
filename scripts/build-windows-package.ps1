$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$distRoot = Join-Path $projectRoot "dist"
$packageRoot = Join-Path $distRoot "WITHBID-PPBM-Setup"
$appRoot = Join-Path $packageRoot "app"
$runtimeRoot = Join-Path $appRoot "runtime"

if (Test-Path -LiteralPath $packageRoot) { Remove-Item -LiteralPath $packageRoot -Recurse -Force }
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null

$items = @("src", "public", "scripts", "samples", "package.json", "package-lock.json", "start-withbid-ppbm.ps1")
foreach ($item in $items) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $item) -Destination $appRoot -Recurse -Force
}

# 개발 폴더가 상위 node_modules를 사용하는 경우에도 설치 패키지는 완전히 독립적으로 동작해야 합니다.
& npm.cmd ci --omit=dev --ignore-scripts --prefix $appRoot
if ($LASTEXITCODE -ne 0) { throw "패키지용 Node 의존성 설치에 실패했습니다." }

$localUsers = Join-Path $projectRoot "config\authorized-users.local.json"
if (Test-Path -LiteralPath $localUsers) {
  New-Item -ItemType Directory -Path (Join-Path $appRoot "config") -Force | Out-Null
  Copy-Item -LiteralPath $localUsers -Destination (Join-Path $appRoot "config\authorized-users.local.json") -Force
}

$node = (Get-Command node.exe -ErrorAction Stop).Source
Copy-Item -LiteralPath $node -Destination (Join-Path $runtimeRoot "node.exe") -Force
$payload = Join-Path $packageRoot "WITHBID-PPBM-app.zip"
Compress-Archive -Path (Join-Path $appRoot "*") -DestinationPath $payload -CompressionLevel Optimal
Remove-Item -LiteralPath $appRoot -Recurse -Force
Copy-Item -LiteralPath (Join-Path $projectRoot "installer\Install-WITHBID-PPBM.ps1") -Destination $packageRoot -Force
Copy-Item -LiteralPath (Join-Path $projectRoot "installer\Install-WITHBID-PPBM.cmd") -Destination $packageRoot -Force

$readme = @"
WITHBID-PPBM 데스크탑 설치 패키지

1. 이 ZIP 파일을 PC의 로컬 폴더에 압축 해제합니다.
2. 파일 탐색기에서 \\Withusnas1\입찰관리 를 열고 NAS 로그인을 완료합니다.
3. Install-WITHBID-PPBM.cmd를 더블클릭합니다.
4. 바탕화면의 WITHBID-PPBM 아이콘으로 실행합니다.

NAS 비밀번호는 앱에 저장되지 않으며 현재 Windows 사용자의 NAS 로그인 세션을 사용합니다.
"@
Set-Content -LiteralPath (Join-Path $packageRoot "INSTALL-KO.txt") -Value $readme -Encoding UTF8

$zip = Join-Path $distRoot "WITHBID-PPBM-Desktop-Setup-0.3.3.zip"
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -LiteralPath $packageRoot -DestinationPath $zip -CompressionLevel Optimal
Write-Host "패키지 생성 완료: $zip"

# ZIP 해제나 CMD 직접 실행 없이 더블클릭 한 번으로 설치할 수 있는 단일 EXE를 만듭니다.
$iexpressRoot = Join-Path $env:TEMP "withbid-iexpress-033"
if (Test-Path -LiteralPath $iexpressRoot) { Remove-Item -LiteralPath $iexpressRoot -Recurse -Force }
New-Item -ItemType Directory -Path $iexpressRoot -Force | Out-Null
$setupFiles = @("WITHBID-PPBM-app.zip", "Install-WITHBID-PPBM.ps1", "Install-WITHBID-PPBM.cmd", "INSTALL-KO.txt")
foreach ($file in $setupFiles) { Copy-Item -LiteralPath (Join-Path $packageRoot $file) -Destination $iexpressRoot -Force }

$temporaryExe = Join-Path $iexpressRoot "WITHBID-PPBM-Desktop-Setup-0.3.3.exe"
$finalExe = Join-Path $distRoot "WITHBID-PPBM-Desktop-Setup-0.3.3.exe"
$sedPath = Join-Path $iexpressRoot "withbid-setup.sed"
$sourceWithSlash = $iexpressRoot.TrimEnd("\") + "\"
$sed = @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=1
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=$temporaryExe
FriendlyName=WITHBID-PPBM Desktop Setup 0.3.3
AppLaunched=Install-WITHBID-PPBM.cmd
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
SourceFiles=SourceFiles
[Strings]
FILE0="WITHBID-PPBM-app.zip"
FILE1="Install-WITHBID-PPBM.ps1"
FILE2="Install-WITHBID-PPBM.cmd"
FILE3="INSTALL-KO.txt"
[SourceFiles]
SourceFiles0=$sourceWithSlash
[SourceFiles0]
%FILE0%=
%FILE1%=
%FILE2%=
%FILE3%=
"@
[System.IO.File]::WriteAllText($sedPath, $sed, [System.Text.Encoding]::ASCII)
$iexpress = (Get-Command iexpress.exe -ErrorAction Stop).Source
$build = Start-Process -FilePath $iexpress -ArgumentList @("/N", "/Q", $sedPath) -Wait -PassThru -WindowStyle Hidden
if ($build.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $temporaryExe)) { throw "단일 EXE 설치 패키지 생성에 실패했습니다." }
Copy-Item -LiteralPath $temporaryExe -Destination $finalExe -Force
Remove-Item -LiteralPath $iexpressRoot -Recurse -Force
Write-Host "단일 EXE 생성 완료: $finalExe"
