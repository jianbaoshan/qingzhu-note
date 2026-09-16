param(
    [string]$InputFile,
    [string]$OutputDir
)

$ErrorActionPreference = "Stop"

try {
    if ([System.IO.Directory]::Exists($OutputDir)) {
        Get-ChildItem $OutputDir -Filter 'slide_*.png' -ErrorAction SilentlyContinue | Remove-Item -Force
    }
    [System.IO.Directory]::CreateDirectory($OutputDir) | Out-Null

    $ppt = New-Object -ComObject PowerPoint.Application
    # Office 2007：Visible=$false 时 Slide.Export 会失败；设为可见后立即最小化，避免打扰
    $ppt.Visible = $true
    try { $ppt.WindowState = 2 } catch {} # 2 = 最小化
    $pres = $ppt.Presentations.Open($InputFile, $true, $false, $false) # ReadOnly
    $count = $pres.Slides.Count
    for ($i = 1; $i -le $count; $i++) {
        $imgPath = Join-Path $OutputDir ("slide_{0:D4}.png" -f $i)
        $pres.Slides.Item($i).Export($imgPath, 'PNG', 1280, 720)
    }
    $pres.Close()
    $ppt.Quit()

    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($ppt) | Out-Null
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()

    Write-Output "SUCCESS"
} catch {
    Write-Output "ERROR: $_"
    try { $ppt.Quit() } catch {}
}