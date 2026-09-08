$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $projectRoot "package.json") | ConvertFrom-Json).version
$distRoot = Join-Path $projectRoot "dist"
$packageRoot = Join-Path $distRoot "WITHBID-PPBM-Setup"
$appRoot = Join-Path $packageRoot "app"
$runtimeRoot = Join-Path $appRoot "runtime"

function Get-Sha256Hex([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace("-", "")
  } finally {
    $sha.Dispose()
    $stream.Dispose()
  }
}

if (Test-Path -LiteralPath $packageRoot) { Remove-Item -LiteralPath $packageRoot -Recurse -Force }
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null

$items = @("src", "public", "scripts", "samples", "package.json", "package-lock.json", "start-withbid-ppbm.ps1")
foreach ($item in $items) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $item) -Destination $appRoot -Recurse -Force
}

# 개발 폴더가 상위 node_modules를 사용하는 경우에도 설치 패키지는 완전히 독립적으로 동작해야 합니다.
& npm.cmd ci --omit=dev --ignore-scripts --prefix $appRoot
if ($LASTEXITCODE -ne 0) { throw "패키지용 Node 의존성 설치에 실패했습니다." }

$node = (Get-Command node.exe -ErrorAction Stop).Source
Copy-Item -LiteralPath $node -Destination (Join-Path $runtimeRoot "node.exe") -Force
$payload = Join-Path $packageRoot "WITHBID-PPBM-app.zip"
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($appRoot, $payload, [IO.Compression.CompressionLevel]::Optimal, $false)
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

Copy-Item -LiteralPath (Join-Path $projectRoot "installer\Install-WITHBID-PPBM-Online.cmd") -Destination $distRoot -Force
Write-Host "온라인 설치 CMD 생성 완료: $(Join-Path $distRoot 'Install-WITHBID-PPBM-Online.cmd')"

# 온라인 설치 실행 파일은 릴리스 앱 묶음과 설치 스크립트를 내려받고,
# 빌드 시 삽입한 SHA-256으로 두 파일을 검증한 후 설치한다.
$compilerCandidates = @(
  (Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"),
  (Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe")
)
$compiler = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $compiler) { throw ".NET Framework C# 컴파일러를 찾을 수 없어 온라인 설치 EXE를 만들지 못했습니다." }

$onlineTemplatePath = Join-Path $projectRoot "installer\WITHBID-PPBM-Online-Setup.cs"
$generatedSourcePath = Join-Path $distRoot ("WITHBID-PPBM-Online-Setup-{0}.generated.cs" -f $version)
$onlineExePath = Join-Path $distRoot ("WITHBID-PPBM-Online-Setup-{0}.exe" -f $version)
$appZipHash = Get-Sha256Hex $payload
$installerHash = Get-Sha256Hex (Join-Path $projectRoot "installer\Install-WITHBID-PPBM.ps1")
$assemblyVersion = "$version.0"
$onlineSource = (Get-Content -Raw -Encoding UTF8 -LiteralPath $onlineTemplatePath).
  Replace("__APP_VERSION__", $version).
  Replace("__ASSEMBLY_VERSION__", $assemblyVersion).
  Replace("__APP_ZIP_SHA256__", $appZipHash).
  Replace("__INSTALLER_SHA256__", $installerHash)
Set-Content -LiteralPath $generatedSourcePath -Value $onlineSource -Encoding UTF8

try {
  if (Test-Path -LiteralPath $onlineExePath) { Remove-Item -LiteralPath $onlineExePath -Force }
  & $compiler /nologo /target:winexe /optimize+ /platform:anycpu /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll /out:$onlineExePath $generatedSourcePath
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $onlineExePath)) { throw "온라인 설치 EXE 컴파일에 실패했습니다." }
} finally {
  Remove-Item -LiteralPath $generatedSourcePath -Force -ErrorAction SilentlyContinue
}
Write-Host "온라인 설치 EXE 생성 완료: $onlineExePath"

$zip = Join-Path $distRoot ("WITHBID-PPBM-Desktop-Setup-{0}.zip" -f $version)
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
[IO.Compression.ZipFile]::CreateFromDirectory($packageRoot, $zip, [IO.Compression.CompressionLevel]::Optimal, $true)
Write-Host "패키지 생성 완료: $zip"
