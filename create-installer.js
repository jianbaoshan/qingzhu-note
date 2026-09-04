// Win11 可视化笔记 - 安装包创建脚本
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const PORTABLE_DIR = path.join(ROOT, 'release', 'win-unpacked');
const OUTPUT_DIR = path.join(ROOT, 'release');
const SEVEN_ZIP = path.join(ROOT, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');

// 创建 7z 存档
const archivePath = path.join(ROOT, 'release', 'app.7z');
console.log('Creating 7z archive...');
execSync(`"${SEVEN_ZIP}" a -t7z -mx5 -mmt=on "${archivePath}" "${PORTABLE_DIR}\\*"`, { stdio: 'inherit' });
console.log('Archive created.');

// 创建 SFX 配置文件
const sfxConfig = `;!@Install@!UTF-8!
Title="Win11 可视化笔记"
BeginPrompt="即将安装 Win11 可视化笔记到您的电脑"
CancelPrompt="确定要取消安装吗？"
ExtractPathText="选择安装目录"
ExtractTitle="Win11 可视化笔记 安装程序"
ExtractPath="%ProgramFiles%\\Win11Notes"
RunProgram="electron.exe"
RunProgram="\"%%T\\electron.exe\""
GUIMode="1"
OverwriteMode="2"
;!@InstallEnd@!`;

const sfxConfigPath = path.join(ROOT, 'release', 'sfx-config.txt');
fs.writeFileSync(sfxConfigPath, sfxConfig, 'utf-8');

// 获取 SFX 模块
// 7z.sfx 应该在 7za 同目录下，或从 7z 安装目录获取
const sfxModulePath = path.join(ROOT, 'node_modules', '7zip-bin', 'win', 'x64', '7z.sfx');
console.log('Checking for SFX module...');
console.log('SFX module exists:', fs.existsSync(sfxModulePath));

if (!fs.existsSync(sfxModulePath)) {
  console.log('SFX module not found. Creating custom installer...');
  // 使用 PowerShell 创建安装脚本
  const psScript = `# Win11 可视化笔记 安装脚本
param(
  [string]$InstallPath = "$env:ProgramFiles\\Win11Notes"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Win11 可视化笔记 - 安装程序" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查管理员权限
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")
if (-not $isAdmin) {
  Write-Host "建议使用管理员权限运行以获得最佳安装体验" -ForegroundColor Yellow
  $InstallPath = Join-Path $env:LOCALAPPDATA "Win11Notes"
}

# 创建安装目录
Write-Host "正在安装到: $InstallPath" -ForegroundColor Yellow
if (-not (Test-Path $InstallPath)) {
  New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
}

# 复制文件
Write-Host "正在复制文件..." -ForegroundColor Yellow
$source = Split-Path -Parent $MyInvocation.MyCommand.Path
Get-ChildItem -Path $source -Recurse | ForEach-Object {
  $dest = Join-Path $InstallPath $_.FullName.Substring($source.Length + 1)
  $destDir = Split-Path -Parent $dest
  if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
  if (-not $_.PSIsContainer) { Copy-Item $_.FullName $dest -Force }
}

# 创建桌面快捷方式
Write-Host "正在创建快捷方式..." -ForegroundColor Yellow
$wshell = New-Object -ComObject WScript.Shell
$shortcut = $wshell.CreateShortcut("$env:USERPROFILE\\Desktop\\Win11可视化笔记.lnk")
$shortcut.TargetPath = Join-Path $InstallPath "electron.exe"
$shortcut.WorkingDirectory = $InstallPath
$shortcut.Description = "Win11 可视化笔记"
$shortcut.Save()

# 创建开始菜单快捷方式
$startMenu = Join-Path $env:ProgramData "Microsoft\\Windows\\Start Menu\\Programs\\Win11可视化笔记.lnk"
$shortcut2 = $wshell.CreateShortcut($startMenu)
$shortcut2.TargetPath = Join-Path $InstallPath "electron.exe"
$shortcut2.WorkingDirectory = $InstallPath
$shortcut2.Description = "Win11 可视化笔记"
$shortcut2.Save()

Write-Host ""
Write-Host "安装完成！" -ForegroundColor Green
Write-Host "桌面快捷方式已创建" -ForegroundColor Green
Write-Host ""
Write-Host "按任意键启动 Win11 可视化笔记..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
Start-Process -FilePath (Join-Path $InstallPath "electron.exe")
`;

  const psScriptPath = path.join(OUTPUT_DIR, 'install.ps1');
  fs.writeFileSync(psScriptPath, psScript, 'utf-8');
  console.log('Installation script created: release/install.ps1');
  console.log('');
  console.log('Installation instructions:');
  console.log('  1. Extract release/win-unpacked/ to a folder');
  console.log('  2. Run setup.ps1 as administrator');
  console.log('');
  console.log('Or just run: release/win-unpacked/electron.exe');
}

// 清理
if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
if (fs.existsSync(sfxConfigPath)) fs.unlinkSync(sfxConfigPath);

console.log('Done!');