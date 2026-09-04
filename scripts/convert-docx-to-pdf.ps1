param(
    [string]$InputFile,
    [string]$OutputFile
)

$ErrorActionPreference = "Stop"

try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = $false

    $doc = $word.Documents.Open($InputFile, $false, $true)
    $doc.SaveAs([ref]$OutputFile, [ref]17) # 17 = wdFormatPDF
    $doc.Close()
    $word.Quit()

    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($word) | Out-Null
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()

    Write-Output "SUCCESS"
} catch {
    Write-Output "ERROR: $_"
    try {
        $word.Quit()
    } catch {}
}