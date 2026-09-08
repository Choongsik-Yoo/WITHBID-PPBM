param(
  [Parameter(Mandatory=$true)][string]$InputPath,
  [Parameter(Mandatory=$true)][string]$OutputPath
)
$ErrorActionPreference='Stop'
$resolvedInput=(Resolve-Path -LiteralPath $InputPath).Path
$resolvedOutput=[IO.Path]::GetFullPath($OutputPath)
$outputDirectory=Split-Path -Parent $resolvedOutput
if(-not (Test-Path -LiteralPath $outputDirectory)){New-Item -ItemType Directory -Path $outputDirectory -Force|Out-Null}
$hwp=$null
try{
  $hwp=New-Object -ComObject HWPFrame.HwpObject
  $hwp.XHwpWindows.Item(0).Visible=$false
  # 한글 자동화 API의 메시지 상자를 기본 동작으로 처리한다. 특히 신버전
  # 문서 경고창이 백그라운드 변환을 막지 않도록 Open 옵션에도 명시한다.
  [void]$hwp.SetMessageBoxMode([int]0x00214411)
  $openOptions='lock:false;forceopen:true;versionwarning:false;suspendpassword:true;'
  $opened=$hwp.Open($resolvedInput,'',$openOptions)
  if(-not $opened){throw '한컴오피스에서 문서를 열지 못했습니다.'}
  $saved=$hwp.SaveAs($resolvedOutput,'PDF','')
  if(-not $saved -or -not (Test-Path -LiteralPath $resolvedOutput)){throw 'PDF 저장에 실패했습니다.'}

  # SaveAs가 반환된 직후에도 PDF 출력 스트림이 잠시 열려 있는 한글 버전이
  # 있으므로, 크기가 안정될 때까지 짧게 기다린 뒤 COM 객체를 종료한다.
  $lastLength=-1L
  $stableCount=0
  for($attempt=0;$attempt -lt 20;$attempt++){
    Start-Sleep -Milliseconds 100
    $currentLength=(Get-Item -LiteralPath $resolvedOutput).Length
    if($currentLength -gt 4 -and $currentLength -eq $lastLength){$stableCount++}else{$stableCount=0}
    if($stableCount -ge 2){break}
    $lastLength=$currentLength
  }
  if((Get-Item -LiteralPath $resolvedOutput).Length -le 4){throw '생성된 PDF 파일이 비어 있습니다.'}
} finally {
  if($hwp){
    try{$hwp.Clear([int]1)}catch{}
    try{$hwp.Quit()}catch{}
    try{[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($hwp)}catch{}
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
  Start-Sleep -Milliseconds 500
}
