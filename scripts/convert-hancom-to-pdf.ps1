param(
  [Parameter(Mandatory=$true)][string]$InputPath,
  [Parameter(Mandatory=$true)][string]$OutputPath
)
$ErrorActionPreference='Stop'
$resolvedInput=(Resolve-Path -LiteralPath $InputPath).Path
$outputDirectory=Split-Path -Parent $OutputPath
if(-not (Test-Path -LiteralPath $outputDirectory)){New-Item -ItemType Directory -Path $outputDirectory -Force|Out-Null}
$hwp=$null
try{
  $hwp=New-Object -ComObject HWPFrame.HwpObject
  $hwp.XHwpWindows.Item(0).Visible=$false
  $opened=$hwp.Open($resolvedInput,'','forceopen:true')
  if(-not $opened){throw '한컴오피스에서 문서를 열지 못했습니다.'}
  $saved=$hwp.SaveAs($OutputPath,'PDF','')
  if(-not $saved -or -not (Test-Path -LiteralPath $OutputPath)){throw 'PDF 저장에 실패했습니다.'}
} finally {
  if($hwp){try{$hwp.Clear(1)}catch{};try{$hwp.Quit()}catch{};[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($hwp)}
}
