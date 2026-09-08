# QingZhu Notes - Windows build script
# This machine cannot create symbolic links (missing SeCreateSymbolicLinkPrivilege),
# which makes winCodeSign extraction fail. Therefore signAndEditExecutable must stay false.
# The app icon is written into the exe manually with rcedit after packaging.
# Flow: pack win-unpacked -> set icon via rcedit -> build NSIS installer from that dir.

$ErrorActionPreference = "Stop"

$env:ELECTRON_MIRROR = "https://registry.npmmirror.com/-/binary/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
$env:ELECTRON_CACHE = Join-Path (Get-Location) ".electron-cache"
$env:ELECTRON_BUILDER_CACHE = Join-Path (Get-Location) ".electron-builder-cache"

$appDir = Join-Path (Get-Location) "release\win-unpacked"
$icon = Join-Path (Get-Location) "icon.ico"
$rcedit = Join-Path (Get-Location) "node_modules\rcedit\bin\rcedit-x64.exe"

Write-Host "==> [1/3] pack win-unpacked"
npx electron-builder --win --dir --publish never
if ($LASTEXITCODE -ne 0) { throw "FAIL: pack step" }

# Locate the app main exe (skip Electron's own helper exes)  -- 需在打包完成后定位
$exe = Get-ChildItem $appDir -Filter "*.exe" | Where-Object { $_.Name -notmatch "^(electron|.*Helper|.*Unins.*)" } | Select-Object -First 1 -ExpandProperty FullName
if (-not $exe) { throw "FAIL: main exe not found in $appDir" }

Write-Host "==> [2/3] set icon into exe: $exe"
& $rcedit $exe --set-icon $icon
if ($LASTEXITCODE -ne 0) { throw "FAIL: rcedit icon step" }

Write-Host "==> [3/3] build NSIS installer from prepackaged dir"
npx electron-builder --win --publish never --prepackaged $appDir
if ($LASTEXITCODE -ne 0) { throw "FAIL: nsis step" }

Write-Host "==> DONE. Installer at release\" | Out-Default
Write-Host "==> Output: release\*.exe" | Out-Default