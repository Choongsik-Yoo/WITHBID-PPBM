param(
  [Parameter(Mandatory=$true)][string]$InputPath,
  [Parameter(Mandatory=$true)][string]$OutputPath
)
$ErrorActionPreference = 'Stop'
$resolvedInput = (Resolve-Path -LiteralPath $InputPath).Path
$outputDirectory = Split-Path -Parent $OutputPath
if (-not (Test-Path -LiteralPath $outputDirectory)) { New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null }
$excel = $null
$workbook = $null
try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.AskToUpdateLinks = $false
  $workbook = $excel.Workbooks.Open($resolvedInput, 0, $true)
  foreach ($worksheet in $workbook.Worksheets) {
    if ($worksheet.Visible -eq -1) {
      try {
        $worksheet.PageSetup.Zoom = $false
        $worksheet.PageSetup.FitToPagesWide = 1
        $worksheet.PageSetup.FitToPagesTall = 0
        $worksheet.PageSetup.CenterHorizontally = $true
      } catch { }
    }
  }
  $workbook.ExportAsFixedFormat(0, $OutputPath, 0, $true, $false)
  if (-not (Test-Path -LiteralPath $OutputPath)) { throw 'Excel PDF 저장에 실패했습니다.' }
} finally {
  if ($workbook) { try { $workbook.Close($false) } catch { }; [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($workbook) }
  if ($excel) { try { $excel.Quit() } catch { }; [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel) }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
