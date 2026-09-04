// Electron 二进制下载脚本
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ELECTRON_VERSION = '28.3.3';
const BASE_URL = 'https://registry.npmmirror.com/-/binary/electron';
const DEST_DIR = path.join(__dirname, 'node_modules', 'electron', 'dist');
const ZIP_PATH = path.join(__dirname, 'node_modules', 'electron', 'dist.zip');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const protocol = url.startsWith('https') ? https : http;
    
    const request = protocol.get(url, { 
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 300000 
    }, (response) => {
      // 处理重定向
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.unlink(dest, () => {});
        console.log(`Redirecting to: ${response.headers.location}`);
        return resolve(download(response.headers.location, dest));
      }
      
      if (response.statusCode !== 200) {
        file.close();
        fs.unlink(dest, () => {});
        return reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
      }
      
      const total = parseInt(response.headers['content-length'], 10);
      let downloaded = 0;
      let lastLog = 0;
      
      response.on('data', (chunk) => {
        downloaded += chunk.length;
        const pct = total ? Math.round(downloaded / total * 100) : 0;
        if (pct - lastLog >= 5 || pct === 100) {
          lastLog = pct;
          const mb = (downloaded / 1024 / 1024).toFixed(1);
          const totalMb = total ? (total / 1024 / 1024).toFixed(1) : '?';
          process.stdout.write(`\r  ${pct}% (${mb}MB / ${totalMb}MB)`);
        }
      });
      
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log('\nDownload complete!');
        resolve();
      });
    });
    
    request.on('error', (err) => {
      file.close();
      fs.unlink(dest, () => {});
      reject(err);
    });
    
    request.on('timeout', () => {
      request.destroy();
      file.close();
      fs.unlink(dest, () => {});
      reject(new Error('Download timeout'));
    });
  });
}

async function main() {
  console.log(`Electron ${ELECTRON_VERSION} 二进制下载`);
  console.log('='.repeat(50));
  
  // 检查是否已存在
  if (fs.existsSync(path.join(DEST_DIR, 'electron.exe'))) {
    console.log('Electron 二进制已存在，跳过下载');
    return;
  }
  
  // 确保目录存在
  if (!fs.existsSync(DEST_DIR)) {
    fs.mkdirSync(DEST_DIR, { recursive: true });
  }
  
  const url = `${BASE_URL}/${ELECTRON_VERSION}/electron-v${ELECTRON_VERSION}-win32-x64.zip`;
  console.log(`下载地址: ${url}`);
  console.log('开始下载...');
  
  try {
    await download(url, ZIP_PATH);
    
    console.log('正在解压...');
    // 使用内置的扩展方式
    const { execSync } = require('child_process');
    
    // 尝试使用 PowerShell 解压
    try {
      execSync(`powershell -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${ZIP_PATH.replace(/'/g, "''")}', '${DEST_DIR.replace(/'/g, "''")}')"`, { stdio: 'inherit' });
    } catch (psErr) {
      // 回退到使用 tar/7z 或手动复制
      console.log('PowerShell 解压失败，尝试使用 tar...');
      try {
        execSync(`tar -xf "${ZIP_PATH}" -C "${DEST_DIR}"`, { stdio: 'inherit' });
      } catch (tarErr) {
        console.error('解压失败，请手动解压:', ZIP_PATH);
        console.error('目标目录:', DEST_DIR);
        throw tarErr;
      }
    }
    
    // 清理
    fs.unlinkSync(ZIP_PATH);
    console.log('解压完成!');
    
    // 验证
    if (fs.existsSync(path.join(DEST_DIR, 'electron.exe'))) {
      console.log('✓ Electron 安装成功');
    } else {
      console.log('⚠ electron.exe 未找到，请检查解压结果');
    }
  } catch (err) {
    console.error('\n下载失败:', err.message);
    console.log('\n请手动下载并解压:');
    console.log(`  1. 下载: ${url}`);
    console.log(`  2. 解压到: ${DEST_DIR}`);
    process.exit(1);
  }
}

main();