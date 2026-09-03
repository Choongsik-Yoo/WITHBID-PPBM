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

$zip = Join-Path $distRoot "WITHBID-PPBM-Desktop-Setup-0.4.0.zip"
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -LiteralPath $packageRoot -DestinationPath $zip -CompressionLevel Optimal
Write-Host "패키지 생성 완료: $zip"

Copy-Item -LiteralPath (Join-Path $projectRoot "installer\Install-WITHBID-PPBM-Online.cmd") -Destination $distRoot -Force
Write-Host "온라인 설치 CMD 생성 완료: $(Join-Path $distRoot 'Install-WITHBID-PPBM-Online.cmd')"
