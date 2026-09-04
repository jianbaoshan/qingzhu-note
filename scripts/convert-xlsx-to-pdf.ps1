param(
    [string]$InputFile,
    [string]$OutputFile
)

$ErrorActionPreference = "Stop"

try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false

    $workbook = $excel.Workbooks.Open($InputFile)
    # 将所有工作表导出为 PDF
    $workbook.ExportAsFixedFormat(0, $OutputFile, 0, $false)  # 0 = xlTypePDF, 0 = xlQualityStandard
    $workbook.Close($false)
    $excel.Quit()

    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()

    Write-Output "SUCCESS"
} catch {
    Write-Output "ERROR: $_"
    try {
        $excel.Quit()
    } catch {}
}