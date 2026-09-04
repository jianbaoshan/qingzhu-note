# Win11 可视化笔记 - 设置与运行脚本
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Win11 可视化笔记 - 安装与运行" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 设置镜像源
$env:ELECTRON_MIRROR = "https://registry.npmmirror.com/-/binary/electron/"

Write-Host "[1/3] 安装依赖..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "依赖安装失败！" -ForegroundColor Red
    pause
    exit 1
}
Write-Host "依赖安装完成" -ForegroundColor Green

# 下载 Electron 二进制文件
$electronVersion = "28.3.3"
$electronDir = Join-Path $PSScriptRoot "node_modules\electron\dist"
$zipPath = Join-Path $PSScriptRoot "node_modules\electron\dist.zip"

if (-not (Test-Path "$electronDir\electron.exe")) {
    Write-Host "[2/3] 下载 Electron 二进制文件..." -ForegroundColor Yellow
    $url = "https://registry.npmmirror.com/-/binary/electron/$electronVersion/electron-v$electronVersion-win32-x64.zip"
    
    try {
        $wc = New-Object System.Net.WebClient
        Write-Host "下载中: $url" -ForegroundColor Gray
        $wc.DownloadFile($url, $zipPath)
        Write-Host "下载完成，正在解压..." -ForegroundColor Yellow
        
        # 解压
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $electronDir)
        Remove-Item $zipPath
        Write-Host "解压完成" -ForegroundColor Green
    }
    catch {
        Write-Host "下载失败: $_" -ForegroundColor Red
        Write-Host "请手动下载 Electron 并解压到: $electronDir" -ForegroundColor Yellow
        Write-Host "下载地址: $url" -ForegroundColor Yellow
        pause
        exit 1
    }
}

Write-Host "[3/3] 启动应用..." -ForegroundColor Yellow
Write-Host "正在启动 Win11 可视化笔记..." -ForegroundColor Green
npx electron .