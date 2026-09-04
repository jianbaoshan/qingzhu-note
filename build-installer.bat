@echo off
chcp 65001 >nul
echo ========================================
echo   Win11 可视化笔记 - 安装包构建脚本
echo ========================================
echo.

:: 设置镜像源加速下载
set ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/
set ELECTRON_CACHE=%~dp0.electron-cache
set ELECTRON_BUILDER_CACHE=%~dp0.electron-builder-cache
set CSC_LINK=
set CSC_KEY_PASSWORD=
set WIN_CSC_LINK=
set WIN_CSC_KEY_PASSWORD=

:: 确保缓存目录存在
if not exist "%~dp0.electron-cache" mkdir "%~dp0.electron-cache"
if not exist "%~dp0.electron-builder-cache" mkdir "%~dp0.electron-builder-cache"

echo [1/3] 安装依赖...
call npm install
if %errorlevel% neq 0 (
    echo 依赖安装失败，请检查网络连接
    pause
    exit /b 1
)
echo 依赖安装完成
echo.

echo [2/3] 构建安装包...
call npx electron-builder --win --config.win.sign=false
if %errorlevel% neq 0 (
    echo 构建失败，请检查错误信息
    pause
    exit /b 1
)
echo 构建完成
echo.

echo [3/3] 构建成功！
echo.
echo 安装包位置: release\Win11可视化笔记 Setup *.exe
echo.
echo 按任意键退出...
pause >nul