# Win11 可视化笔记 - 安装包构建脚本
# 在 PowerShell 中运行此脚本

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Win11 可视化笔记 - 安装包构建" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 设置镜像源加速
$env:ELECTRON_MIRROR = "https://registry.npmmirror.com/-/binary/electron/"
$env:ELECTRON_CACHE = Join-Path $ProjectRoot ".electron-cache"
$env:ELECTRON_BUILDER_CACHE = Join-Path $ProjectRoot ".electron-builder-cache"

# 禁用代码签名
$env:CSC_LINK = ""
$env:CSC_KEY_PASSWORD = ""
$env:WIN_CSC_LINK = ""
$env:WIN_CSC_KEY_PASSWORD = ""

# 确保缓存目录存在
if (-not (Test-Path $env:ELECTRON_CACHE)) { New-Item -ItemType Directory -Path $env:ELECTRON_CACHE -Force | Out-Null }
if (-not (Test-Path $env:ELECTRON_BUILDER_CACHE)) { New-Item -ItemType Directory -Path $env:ELECTRON_BUILDER_CACHE -Force | Out-Null }

Write-Host "[1/3] 安装依赖..." -ForegroundColor Yellow
Set-Location $ProjectRoot
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "依赖安装失败！" -ForegroundColor Red
    exit 1
}
Write-Host "依赖安装完成" -ForegroundColor Green
Write-Host ""

Write-Host "[2/3] 构建安装包..." -ForegroundColor Yellow
Write-Host "  构建 NSIS 安装程序..." -ForegroundColor Gray
npx electron-builder --win --config.win.sign=false
if ($LASTEXITCODE -ne 0) {
    Write-Host "NSIS 构建失败，尝试构建便携版..." -ForegroundColor Yellow
    npx electron-builder --win --dir --config.win.sign=false
    if ($LASTEXITCODE -eq 0) {
        Write-Host "便携版构建成功" -ForegroundColor Green
        Write-Host ""
        Write-Host "便携版位置: release\win-unpacked\" -ForegroundColor Cyan
        Write-Host "直接运行: release\win-unpacked\electron.exe" -ForegroundColor Cyan
    }
} else {
    Write-Host "安装包构建成功！" -ForegroundColor Green
    Write-Host ""
    Write-Host "安装包位置: release\Win11可视化笔记 Setup *.exe" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "[3/3] 完成！" -ForegroundColor Yellow
Write-Host ""
Write-Host "如果构建失败，请尝试以下命令：" -ForegroundColor Gray
Write-Host "  npx electron-builder --win --config.win.sign=false" -ForegroundColor Gray
Write-Host ""

Set-Location $ProjectRoot