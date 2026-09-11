const { app, BrowserWindow, webContents, ipcMain, dialog, Menu, Tray, nativeTheme, globalShortcut, clipboard, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');
const { execFile } = require('child_process');
const { marked } = require('marked');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const xlsx = require('xlsx');

// ============ 全局状态 ============
let mainWindow = null;
let tray = null;
const configFile = path.join(app.getPath('userData'), 'config.json');

// ============ 笔记目录管理 ============
function getDefaultNotesDir() {
  if (app.isPackaged) {
    // 生产环境：安装目录下的 data 文件夹
    return path.join(path.dirname(process.resourcesPath), 'data');
  }
  // 开发环境：用户文档目录
  return path.join(app.getPath('documents'), 'Win11Notes');
}

function getNotesDir() {
  const config = loadConfig();
  return config.notesDir || getDefaultNotesDir();
}

function getNotesMetaFile() {
  return path.join(getNotesDir(), 'notes-meta.json');
}

function getCategoriesDir() {
  return path.join(getNotesDir(), 'categories');
}

function getAttachmentsDir() {
  return path.join(getNotesDir(), 'attachments');
}

function getRecycleBinDir() {
  return path.join(getNotesDir(), 'recycle-bin');
}

// ============ 初始化目录 ============
function initDirectories() {
  const dir = getNotesDir();
  [dir, getCategoriesDir(), getAttachmentsDir(), getRecycleBinDir()].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

// ============ 凭证目录管理 ============
function getPasswdDir() {
  if (app.isPackaged) {
    // 生产环境：安装目录同级目录下的 passwd 文件夹
    return path.join(path.dirname(path.dirname(process.resourcesPath)), 'passwd');
  }
  // 开发环境：项目目录同级目录下的 passwd 文件夹
  return path.join(path.dirname(__dirname), 'passwd');
}

function getPasswdFile() {
  return path.join(getPasswdDir(), 'credentials.json');
}

function initPasswdDir() {
  const dir = getPasswdDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ============ 数据迁移 ============
async function migrateNotesDir(oldDir, newDir) {
  if (oldDir === newDir) return { success: true, migrated: 0 };
  try {
    await fs.promises.access(oldDir);
  } catch (e) {
    // 旧目录不存在，直接初始化新目录
    initDirectories();
    return { success: true, migrated: 0 };
  }
  try {
    const fsp = fs.promises;
    // 迁移笔记 .md 文件
    const allFiles = await fsp.readdir(oldDir);
    const oldFiles = allFiles.filter(f => f.endsWith('.md'));
    let migrated = 0;
    try { await fsp.mkdir(newDir, { recursive: true }); } catch (e) { /* ignore */ }
    for (const f of oldFiles) {
      const src = path.join(oldDir, f);
      const dst = path.join(newDir, f);
      try { await fsp.access(dst); } catch (e) {
        await fsp.copyFile(src, dst);
        migrated++;
      }
    }

    // 迁移 notes-meta.json
    const oldMeta = path.join(oldDir, 'notes-meta.json');
    const newMeta = path.join(newDir, 'notes-meta.json');
    try { await fsp.access(oldMeta); await fsp.access(newMeta); } catch (e) {
      // 如果旧文件存在且新文件不存在，则复制
      try { await fsp.access(oldMeta); await fsp.copyFile(oldMeta, newMeta); } catch (e2) { /* ignore */ }
    }

    // 迁移目录
    const dirs = ['attachments', 'categories', 'recycle-bin'];
    for (const d of dirs) {
      const srcDir = path.join(oldDir, d);
      const dstDir = path.join(newDir, d);
      try {
        await fsp.access(srcDir);
        try { await fsp.mkdir(dstDir, { recursive: true }); } catch (e) { /* ignore */ }
        await copyRecursive(srcDir, dstDir);
      } catch (e) { /* ignore */ }
    }

    // 确认新目录数据完整后删除旧目录中的 .md 文件
    try {
      await fsp.access(newMeta);
      for (const f of oldFiles) {
        const src = path.join(oldDir, f);
        try { await fsp.unlink(src); } catch (e) { /* ignore */ }
      }
    } catch (e) { /* ignore */ }

    return { success: true, migrated: migrated + 1 };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function copyRecursive(src, dest) {
  const fsp = fs.promises;
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      try { await fsp.mkdir(destPath, { recursive: true }); } catch (e) { /* ignore */ }
      await copyRecursive(srcPath, destPath);
    } else {
      try { await fsp.access(destPath); } catch (e) {
        try { await fsp.copyFile(srcPath, destPath); } catch (e2) { /* ignore */ }
      }
    }
  }
}

// ============ 配置管理 ============
function loadConfig() {
  try {
    if (fs.existsSync(configFile)) return JSON.parse(fs.readFileSync(configFile, 'utf-8'));
  } catch (e) { /* ignore */ }
  return { theme: 'system', fontSize: 14, autoSave: true, autoSaveInterval: 30000, notesDir: getDefaultNotesDir() };
}

function saveConfig(config) {
  const dir = path.dirname(configFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf-8');
}

// ============ 笔记元数据管理 ============
function loadNotesMeta() {
  try {
    if (fs.existsSync(getNotesMetaFile())) return JSON.parse(fs.readFileSync(getNotesMetaFile(), 'utf-8'));
  } catch (e) { /* ignore */ }
  return { notes: [], categories: [{ id: 'default', name: '我的笔记', icon: '📝', order: 0 }], tags: [] };
}

function saveNotesMeta(meta) {
  fs.writeFileSync(getNotesMetaFile(), JSON.stringify(meta, null, 2), 'utf-8');
}

function generateId() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 5); }

// ============ 创建笔记 ============
function createNote(title, content, categoryId, template, originalFile) {
  const meta = loadNotesMeta();
  const id = generateId();
  const now = new Date().toISOString();
  const note = {
    id, title: title || '无标题笔记',
    categoryId: categoryId || 'default',
    createdAt: now, updatedAt: now,
    tags: [], isFavorite: false, isDeleted: false,
    wordCount: 0, template: template || null,
    originalFile: originalFile || null
  };
  meta.notes.push(note);
  saveNotesMeta(meta);
  const noteFile = path.join(getNotesDir(), `${id}.md`);
  fs.writeFileSync(noteFile, content || `# ${note.title}\n\n`, 'utf-8');
  return note;
}

function updateNoteContent(id, content) {
  const noteFile = path.join(getNotesDir(), `${id}.md`);
  fs.writeFileSync(noteFile, content, 'utf-8');
  const meta = loadNotesMeta();
  const note = meta.notes.find(n => n.id === id);
  if (note) {
    note.updatedAt = new Date().toISOString();
    note.wordCount = content.replace(/\s/g, '').length;
    saveNotesMeta(meta);
  }
}

function deleteNote(id, permanent = false) {
  const meta = loadNotesMeta();
  const idx = meta.notes.findIndex(n => n.id === id);
  if (idx === -1) return false;
  if (permanent) {
    meta.notes.splice(idx, 1);
    const noteFile = path.join(getNotesDir(), `${id}.md`);
    if (fs.existsSync(noteFile)) fs.unlinkSync(noteFile);
  } else {
    meta.notes[idx].isDeleted = true;
    meta.notes[idx].deletedAt = new Date().toISOString();
  }
  saveNotesMeta(meta);
  return true;
}

function restoreNote(id) {
  const meta = loadNotesMeta();
  const note = meta.notes.find(n => n.id === id);
  if (note) { note.isDeleted = false; note.deletedAt = null; saveNotesMeta(meta); return true; }
  return false;
}

function getNoteContent(id) {
  const noteFile = path.join(getNotesDir(), `${id}.md`);
  try { return fs.readFileSync(noteFile, 'utf-8'); } catch (e) { return ''; }
}

// ============ 文件导入与转换 ============
async function convertTxt(content) { return content; }

async function convertDocx(filePath) {
  try {
    const result = await mammoth.convertToMarkdown({ path: filePath });
    return result.value;
  } catch (e) { return `*[Word 转换失败: ${e.message}]*`; }
}

async function convertPdf(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    return data.text;
  } catch (e) { return `*[PDF 转换失败: ${e.message}]*`; }
}

async function convertHtml(content) {
  return content.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function convertImageToMarkdown(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.bmp', '.gif'].includes(ext)) {
    const fileName = path.basename(filePath);
    const destDir = path.join(getAttachmentsDir(), 'images');
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, fileName);
    fs.copyFileSync(filePath, dest);
    return `![${fileName}](attachments/images/${fileName})`;
  }
  return '';
}

function convertExcel(filePath) {
  try {
    const workbook = xlsx.readFile(filePath);
    const sheets = workbook.SheetNames;
    let result = '';
    for (const sheetName of sheets) {
      const sheet = workbook.Sheets[sheetName];
      const json = xlsx.utils.sheet_to_json(sheet, { header: 1 });
      if (json.length > 0) {
        result += `## ${sheetName}\n\n`;
        const rows = json.map(row => row.map(cell => cell !== undefined ? String(cell) : '').join(' | '));
        const header = rows[0];
        const separator = header.split('|').map(() => '---').join('|');
        result += header + '\n' + separator + '\n';
        for (let i = 1; i < rows.length; i++) {
          result += rows[i] + '\n';
        }
        result += '\n';
      }
    }
    return result || '*[Excel 为空]*';
  } catch (e) { return `*[Excel 转换失败: ${e.message}]*`; }
}

async function importFile(filePath, categoryId) {
  const ext = path.extname(filePath).toLowerCase();
  const baseName = path.basename(filePath, ext);
  let content = '';
  let title = baseName;
  let originalFile = null;

  // 二进制文件（非纯文本）保存原文件
  const binaryExts = ['.pdf', '.doc', '.docx', '.xlsx', '.xls', '.csv', '.html', '.htm', '.png', '.jpg', '.jpeg', '.bmp', '.gif'];
  const archiveExts = ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.zst'];
  if (binaryExts.includes(ext) || archiveExts.includes(ext)) {
    const importedDir = path.join(getAttachmentsDir(), 'imported');
    if (!fs.existsSync(importedDir)) fs.mkdirSync(importedDir, { recursive: true });
    const destName = path.basename(filePath);
    originalFile = path.join('attachments', 'imported', destName);
    fs.copyFileSync(filePath, path.join(getNotesDir(), originalFile));
  }

  // ===== 大文件保护：超大文件不再一次性读入内存，避免程序因 OOM 崩溃 =====
  // 仅保留原始文件为附件，正文放置占位提示。20MB 以上视为超大。
  const MAX_TEXT = 20 * 1024 * 1024;
  let readText;
  try {
    const sizeBig = fs.statSync(filePath).size;
    if (sizeBig > MAX_TEXT) {
      const importedDir = path.join(getAttachmentsDir(), 'imported');
      if (!fs.existsSync(importedDir)) fs.mkdirSync(importedDir, { recursive: true });
      const destName = path.basename(filePath);
      originalFile = path.join('attachments', 'imported', destName);
      try { fs.copyFileSync(filePath, path.join(getNotesDir(), originalFile)); } catch (e) { /* 忽略 */ }
      const gbSize = (sizeBig / (1024 * 1024 * 1024)).toFixed(2);
      content = `*[文件过大 (${gbSize}GB) - 为避免程序崩溃，未全文载入内容]*\n\n原始文件已保留在附件，可点击预览。`;
      // 超限时读取函数返回占位，避免整读大文件
      readText = () => content;
    } else {
      readText = () => fs.readFileSync(filePath, 'utf-8');
    }
  } catch (e) {
    readText = () => fs.readFileSync(filePath, 'utf-8');
  }

  try {
    switch (ext) {
      case '.txt':
      case '.rtf':
        content = readText();
        break;
      case '.html':
      case '.htm':
        content = convertHtml(readText());
        break;
      case '.md':
        content = readText();
        break;
      case '.doc':
      case '.docx':
        content = `*[Word 文档 - 支持应用内预览]*\n\n> 原始文件: ${baseName}${ext}`;
        break;
      case '.pdf':
        content = `*[PDF 文档 - 支持应用内预览]*\n\n> 原始文件: ${baseName}${ext}`;
        break;
      case '.xlsx':
      case '.xls':
      case '.csv':
        content = `*[Excel 表格 - 支持应用内预览]*\n\n> 原始文件: ${baseName}${ext}`;
        break;
      case '.png':
      case '.jpg':
      case '.jpeg':
      case '.bmp':
      case '.gif':
        content = convertImageToMarkdown(filePath);
        break;
      default:
        if (archiveExts.includes(ext)) {
          content = `*[压缩包文件 - 不支持预览]*\n\n> 原始文件: ${baseName}${ext}`;
        } else {
          content = readText();
        }
    }
  } catch (e) {
    content = `*[导入失败: ${e.message}]*\n\n原始文件: ${filePath}`;
  }

  // 检查是否已有同名导入文件，有则更新现有笔记，无则创建新笔记
  if (originalFile) {
    const meta = loadNotesMeta();
    const existing = meta.notes.find(n => n.originalFile === originalFile && !n.isDeleted);
    if (existing) {
      const noteFile = path.join(getNotesDir(), `${existing.id}.md`);
      fs.writeFileSync(noteFile, content, 'utf-8');
      existing.updatedAt = new Date().toISOString();
      saveNotesMeta(meta);
      return existing;
    }
  }

  return createNote(title, content, categoryId, null, originalFile);
}

// ============ 批量导入 ============
async function batchImport(filePaths, categoryId, progressCallback) {
  const results = [];
  for (let i = 0; i < filePaths.length; i++) {
    try {
      const note = await importFile(filePaths[i], categoryId);
      results.push({ file: filePaths[i], success: true, noteId: note.id, title: note.title });
    } catch (e) {
      results.push({ file: filePaths[i], success: false, error: e.message });
    }
    if (progressCallback) progressCallback(i + 1, filePaths.length);
  }
  return results;
}

// ============ docx 转 PDF（使用 Word 保持原始格式）============
function getScriptPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'scripts', 'convert-docx-to-pdf.ps1');
  }
  return path.join(__dirname, 'scripts', 'convert-docx-to-pdf.ps1');
}

function getPdfCachePath(docxPath) {
  const hash = require('crypto').createHash('md5').update(docxPath).digest('hex');
  return path.join(getAttachmentsDir(), 'docx-cache', hash + '.pdf');
}

let _wordAvailable = null;

function checkWordInstalled() {
  if (_wordAvailable !== null) return _wordAvailable;
  try {
    const result = require('child_process').execSync(
      'powershell -Command "try { $w = New-Object -ComObject Word.Application; $w.Quit(); Write-Output OK } catch { Write-Output NO }"',
      { timeout: 15000, encoding: 'utf-8' }
    );
    _wordAvailable = result.trim() === 'OK';
    return _wordAvailable;
  } catch (e) {
    _wordAvailable = false;
    return false;
  }
}

async function convertDocxToPdf(docxPath) {
  const pdfPath = getPdfCachePath(docxPath);
  // 检查缓存
  if (fs.existsSync(pdfPath)) return pdfPath;

  const cacheDir = path.dirname(pdfPath);
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

  const scriptPath = getScriptPath();
  return new Promise((resolve, reject) => {
    execFile('powershell', [
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      '-InputFile', docxPath,
      '-OutputFile', pdfPath
    ], { timeout: 60000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error('PowerShell 执行失败: ' + error.message));
        return;
      }
      if (stdout.trim() === 'SUCCESS' && fs.existsSync(pdfPath)) {
        resolve(pdfPath);
      } else {
        reject(new Error('Word 转换失败: ' + stdout.trim()));
      }
    });
  });
}

// ============ Excel 转 PDF（使用 Excel 保持原始格式）============
function getExcelScriptPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'scripts', 'convert-xlsx-to-pdf.ps1');
  }
  return path.join(__dirname, 'scripts', 'convert-xlsx-to-pdf.ps1');
}

function getExcelPdfCachePath(xlsxPath) {
  const hash = require('crypto').createHash('md5').update(xlsxPath).digest('hex');
  return path.join(getAttachmentsDir(), 'xlsx-cache', hash + '.pdf');
}

let _excelAvailable = null;

function checkExcelInstalled() {
  if (_excelAvailable !== null) return _excelAvailable;
  try {
    const result = require('child_process').execSync(
      'powershell -Command "try { $e = New-Object -ComObject Excel.Application; $e.Quit(); Write-Output OK } catch { Write-Output NO }"',
      { timeout: 15000, encoding: 'utf-8' }
    );
    _excelAvailable = result.trim() === 'OK';
    return _excelAvailable;
  } catch (e) {
    _excelAvailable = false;
    return false;
  }
}

async function convertXlsxToPdf(xlsxPath) {
  const pdfPath = getExcelPdfCachePath(xlsxPath);
  // 检查缓存
  if (fs.existsSync(pdfPath)) return pdfPath;

  const cacheDir = path.dirname(pdfPath);
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

  const scriptPath = getExcelScriptPath();
  return new Promise((resolve, reject) => {
    execFile('powershell', [
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      '-InputFile', xlsxPath,
      '-OutputFile', pdfPath
    ], { timeout: 60000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error('PowerShell 执行失败: ' + error.message));
        return;
      }
      if (stdout.trim() === 'SUCCESS' && fs.existsSync(pdfPath)) {
        resolve(pdfPath);
      } else {
        reject(new Error('Excel 转换失败: ' + stdout.trim()));
      }
    });
  });
}

// ============ 创建窗口 ============
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    transparent: false,
    backgroundColor: '#f0f0f0',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true
    },
    titleBarStyle: 'hidden',
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 添加菜单栏（包含开发者工具入口）
  const menuTemplate = [
    {
      label: '文件',
      submenu: [
        {
          label: '查找',
          accelerator: 'CmdOrCtrl+F',
          click: () => {
            if (readonlyVisible && mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('show-search-bar');
            }
          }
        },
        { type: 'separator' },
        { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { type: 'separator' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // 注册 F12 快捷键打开开发者工具（frameless 窗口可能不显示菜单栏）
  globalShortcut.register('F12', () => {
    if (mainWindow) mainWindow.webContents.toggleDevTools();
  });
  globalShortcut.register('Ctrl+Shift+I', () => {
    if (mainWindow) mainWindow.webContents.toggleDevTools();
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // 窗口控制 IPC
  ipcMain.on('window-minimize', () => mainWindow?.minimize());
  ipcMain.on('window-maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.on('window-close', () => mainWindow?.close());
  ipcMain.on('toggle-devtools', () => mainWindow?.webContents.toggleDevTools());

  mainWindow.on('maximize', () => mainWindow?.webContents.send('window-state-changed', true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window-state-changed', false));

  // 拦截 Ctrl+F 以支持 PDF 等 iframe 内文件的搜索
  let readonlyVisible = false;
  ipcMain.on('readonly-visible', (e, visible) => { readonlyVisible = visible; });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (readonlyVisible && input.control && !input.alt && !input.shift && !input.meta && input.key.toLowerCase() === 'f') {
      mainWindow.webContents.send('show-search-bar');
      event.preventDefault();
    }
  });

  // 查找 PDF 查看器的 webContents（webview 加载 PDF 时是独立 webContents）
  function findPdfWebContents() {
    const allWc = webContents.getAllWebContents();
    for (const wc of allWc) {
      try {
        const url = wc.getURL();
        if (url && url.endsWith('.pdf') && wc !== mainWindow.webContents && !url.startsWith('devtools://')) {
          return wc;
        }
      } catch (e) { /* ignore */ }
    }
    return null;
  }

  // 文件内搜索（PDF 等使用 webContents.findInPage）
  ipcMain.on('find-in-page', (e, { text, forward, findNext, matchCase }) => {
    console.log('[MAIN find-in-page]', { text, forward, findNext, matchCase });
    if (!text) {
      mainWindow.webContents.stopFindInPage('clearSelection');
      const pdfWc = findPdfWebContents();
      if (pdfWc) pdfWc.stopFindInPage('clearSelection');
      return;
    }
    const options = {
      forward: forward !== false,
      findNext: findNext !== false
    };
    if (matchCase !== undefined) {
      options.matchCase = matchCase === true;
    }
    // 优先在 PDF webview 的 webContents 上搜索（PDF viewer 顶层加载时 findInPage 导航正常）
    const pdfWc = findPdfWebContents();
    if (pdfWc) {
      console.log('[MAIN] Using PDF webContents for findInPage');
      pdfWc.findInPage(text, options);
    } else {
      mainWindow.webContents.findInPage(text, options);
    }
  });
  ipcMain.on('stop-find-in-page', (e, action) => {
    mainWindow.webContents.stopFindInPage(action === 'keepSelection' ? 'keepSelection' : 'clearSelection');
    const pdfWc = findPdfWebContents();
    if (pdfWc) pdfWc.stopFindInPage(action === 'keepSelection' ? 'keepSelection' : 'clearSelection');
  });
  mainWindow.webContents.on('found-in-page', (event, result) => {
    console.log('[MAIN found-in-page]', JSON.stringify(result));
    mainWindow.webContents.send('found-in-page', result);
  });

  // 监听子 webContents（webview）的事件
  app.on('web-contents-created', (event, wc) => {
    // 当焦点在 PDF webview 内部时，主窗口的 before-input-event 收不到按键，
    // 需要在这里拦截 Ctrl+F 以召唤搜索框
    wc.on('before-input-event', (event, input) => {
      if (readonlyVisible && input.control && !input.alt && !input.shift && !input.meta && input.key.toLowerCase() === 'f') {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('show-search-bar');
        }
        event.preventDefault();
      }
    });
    wc.on('did-finish-load', () => {
      try {
        const url = wc.getURL();
        if (url && url.endsWith('.pdf') && wc !== mainWindow.webContents && !url.startsWith('devtools://')) {
          console.log('[MAIN] PDF webview loaded:', url);
        }
      } catch (e) { /* ignore */ }
    });
    wc.on('found-in-page', (event, result) => {
      console.log('[CHILD found-in-page]', JSON.stringify(result));
      if (mainWindow) {
        mainWindow.webContents.send('found-in-page', result);
      }
    });
  });
}

// ============ 系统托盘 ============
function createTray() {
  const iconPath = path.join(__dirname, 'icon.ico');
  try {
    tray = new Tray(iconPath);
    tray.setToolTip('青竹笔记');
    const contextMenu = Menu.buildFromTemplate([
      { label: '新建笔记', click: () => { showWindow(); mainWindow?.webContents.send('new-note'); } },
      { label: '导入文件', click: () => { showWindow(); mainWindow?.webContents.send('open-import'); } },
      { type: 'separator' },
      { label: '显示主窗口', click: () => showWindow() },
      { type: 'separator' },
      { label: '退出', click: () => { app.isQuitting = true; app.quit(); } }
    ]);
    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => showWindow());
  } catch (e) { console.error('Tray error:', e); }
}

function showWindow() {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  else createWindow();
}

// ============ 快捷键 ============
function registerShortcuts() {
  globalShortcut.register('CommandOrControl+N', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.webContents.send('new-note'); }
  });
}

// ============ IPC 处理 ============
function setupIPC() {
  // 笔记操作
  ipcMain.handle('get-notes', () => loadNotesMeta());
  ipcMain.handle('get-notes-dir', () => getNotesDir());
  ipcMain.handle('change-notes-dir', async (e, newDir) => {
    const oldDir = getNotesDir();
    if (oldDir === newDir) return { success: true, migrated: 0, path: newDir };
    // 先保存新路径到配置，确保即使迁移失败下次也能用新路径
    const config = loadConfig();
    config.notesDir = newDir;
    saveConfig(config);
    // 异步迁移数据（不阻塞主进程）
    const result = await migrateNotesDir(oldDir, newDir);
    if (result.success) {
      mainWindow?.webContents.send('notes-dir-changed', newDir);
    }
    return { ...result, path: newDir };
  });
  ipcMain.handle('create-note', (e, { title, content, categoryId, template, originalFile }) => createNote(title, content, categoryId, template, originalFile));
  ipcMain.handle('get-note-content', (e, id) => getNoteContent(id));
  ipcMain.handle('update-note-content', (e, { id, content }) => { updateNoteContent(id, content); return true; });
  ipcMain.handle('delete-note', (e, { id, permanent }) => deleteNote(id, permanent));
  ipcMain.handle('restore-note', (e, id) => restoreNote(id));
  ipcMain.handle('rename-note', (e, { id, title }) => {
    const meta = loadNotesMeta();
    const note = meta.notes.find(n => n.id === id);
    if (note) { note.title = title; saveNotesMeta(meta); return true; }
    return false;
  });
  ipcMain.handle('get-config', () => loadConfig());
  ipcMain.handle('save-config', (e, config) => { saveConfig(config); return true; });

  // 打开导入的原文件
  ipcMain.handle('open-original-file', (e, relativePath) => {
    const fullPath = path.join(getNotesDir(), relativePath);
    if (fs.existsSync(fullPath)) {
      shell.openPath(fullPath);
      return true;
    }
    return false;
  });

  // 获取导入文件完整路径
  ipcMain.handle('get-imported-file-path', (e, relativePath) => {
    const fullPath = path.join(getNotesDir(), relativePath);
    if (fs.existsSync(fullPath)) return fullPath;
    return null;
  });

  // 下载导入的文件（弹出另存为对话框）
  ipcMain.handle('download-imported-file', async (e, relativePath) => {
    const srcPath = path.join(getNotesDir(), relativePath);
    if (!fs.existsSync(srcPath)) return { success: false, error: '文件不存在' };
    const fileName = path.basename(relativePath);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '下载文件',
      defaultPath: fileName,
      filters: [{ name: '所有文件', extensions: ['*'] }]
    });
    if (result.canceled) return { success: false, error: '已取消' };
    try {
      fs.copyFileSync(srcPath, result.filePath);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 使用工作线程处理 Excel，避免阻塞主进程
  function getWorkerPath() {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'excel-worker.js');
    }
    return path.join(__dirname, 'excel-worker.js');
  }

  function processExcelInWorker(filePath, maxRows = 2000, timeout = 20000, format = 'html') {
    return new Promise((resolve, reject) => {
      let worker = null;
      const timer = setTimeout(() => {
        if (worker) {
          worker.terminate();
        }
        reject(new Error('处理超时，文件过大'));
      }, timeout);
      try {
        worker = new Worker(getWorkerPath(), { workerData: { filePath, maxRows, format } });
        worker.on('message', (result) => {
          clearTimeout(timer);
          resolve(result);
        });
        worker.on('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        worker.on('exit', (code) => {
          clearTimeout(timer);
          if (code !== 0) {
            reject(new Error(`工作线程异常退出（退出码: ${code}）`));
          }
        });
      } catch (e) {
        clearTimeout(timer);
        if (worker) worker.terminate();
        reject(new Error('创建工作线程失败: ' + e.message));
      }
    });
  }

  // 获取导入文件预览内容（用于应用内预览，不打开外部程序）
  ipcMain.handle('get-file-preview', async (e, relativePath) => {
    const fullPath = path.join(getNotesDir(), relativePath);
    if (!fs.existsSync(fullPath)) return { type: 'error', content: '文件不存在' };

    const ext = path.extname(fullPath).toLowerCase();
    const imageExts = ['.png', '.jpg', '.jpeg', '.bmp', '.gif'];

    if (imageExts.includes(ext)) {
      // 图片 - 返回文件路径，由渲染进程显示
      return { type: 'image', content: fullPath.replace(/\\/g, '/') };
    } else if (ext === '.pdf') {
      // PDF - 返回文件路径与二进制数据，由渲染进程用 PDF.js 渲染（支持主题跟随）
      try {
        const buf = fs.readFileSync(fullPath);
        return { type: 'pdf', content: fullPath.replace(/\\/g, '/'), data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
      } catch (e) {
        return { type: 'error', content: 'PDF 文件读取失败：' + e.message };
      }
    } else if (['.html', '.htm'].includes(ext)) {
      // HTML - 读取文件内容，由渲染进程用 srcdoc 嵌入（确保同源可访问 contentDocument）
      try {
        const htmlContent = fs.readFileSync(fullPath, 'utf-8');
        const dir = path.dirname(fullPath).replace(/\\/g, '/');
        return { type: 'html_file', content: htmlContent, baseDir: dir };
      } catch (e) {
        return { type: 'error', content: 'HTML 文件读取失败：' + e.message };
      }
    } else if (['.doc', '.docx'].includes(ext)) {
      // Word - 优先使用 PDF 预览（保持原始格式），回退到 mammoth HTML
      try {
        const pdfPath = await convertDocxToPdf(fullPath);
        const buf = fs.readFileSync(pdfPath);
        return { type: 'pdf', content: pdfPath.replace(/\\/g, '/'), data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
      } catch (pdfError) {
        console.warn('Word PDF 转换失败，回退到 mammoth:', pdfError.message);
        // 回退到 mammoth
        try {
          const result = await mammoth.convertToHtml(
            { path: fullPath },
            {
              includeDefaultStyleMap: true,
              styleMap: [
                "p[style-name='Title'] => h1:fresh",
                "p[style-name='Subtitle'] => h2:fresh",
                "p[style-name='Heading 1'] => h1:fresh",
                "p[style-name='Heading 2'] => h2:fresh",
                "p[style-name='Heading 3'] => h3:fresh",
                "p[style-name='Heading 4'] => h4:fresh",
                "p[style-name='Heading 5'] => h5:fresh",
                "p[style-name='Heading 6'] => h6:fresh",
                "r[style-name='Strong'] => strong",
                "r[style-name='Emphasis'] => em"
              ]
            }
          );
          // 后处理：让图片自适应宽度
          let html = result.value;
          html = html.replace(/<img([^>]*)>/gi, (match, attrs) => {
            attrs = attrs.replace(/\s+width="[^"]*"/gi, '');
            attrs = attrs.replace(/\s+height="[^"]*"/gi, '');
            attrs = attrs.replace(/\s+style="[^"]*"/gi, '');
            return `<img${attrs} style="max-width:100%;height:auto;display:block;margin:10px auto;">`;
          });
          return { type: 'html', content: html, fallback: true };
        } catch (e) {
          return { type: 'error', content: 'Word 文件预览失败：' + e.message };
        }
      }
    } else if (['.xlsx', '.xls'].includes(ext)) {
      // Excel - 使用工作线程解析为结构化数据，应用内用 Excel 交互表格组件展示
      try {
        const stat = fs.statSync(fullPath);
        if (stat.size > 50 * 1024 * 1024) {
          return { type: 'error', content: '文件过大（超过 50MB），无法预览，请使用外部程序打开' };
        }
        const result = await processExcelInWorker(fullPath, 2000, 20000, 'data');
        return result;
      } catch (e) {
        return { type: 'error', content: 'Excel 文件预览失败：' + e.message };
      }
    } else if (ext === '.csv') {
      // CSV - 使用工作线程处理（CSV 不支持 PDF 转换）
      try {
        const result = await processExcelInWorker(fullPath);
        return result;
      } catch (e) {
        return { type: 'error', content: 'CSV 文件预览失败：' + e.message };
      }
    } else if (ext === '.txt') {
      // 文本文件 - 直接显示内容
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        return { type: 'text', content };
      } catch (e) {
        return { type: 'error', content: '文本文件读取失败：' + e.message };
      }
    } else if (['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.zst'].includes(ext)) {
      return { type: 'archive', content: '压缩包文件不支持预览' };
    } else {
      return { type: 'unsupported', content: '该文件类型暂不支持应用内预览' };
    }
  });

  // 收藏
  ipcMain.handle('toggle-favorite', (e, id) => {
    const meta = loadNotesMeta();
    const note = meta.notes.find(n => n.id === id);
    if (note) { note.isFavorite = !note.isFavorite; saveNotesMeta(meta); return note.isFavorite; }
    return false;
  });

  // 分类管理
  ipcMain.handle('add-category', (e, { name, parentId }) => {
    const meta = loadNotesMeta();
    const cat = { id: generateId(), name, icon: '📁', order: meta.categories.length, parentId: parentId || null };
    meta.categories.push(cat);
    saveNotesMeta(meta);
    return cat;
  });
  ipcMain.handle('delete-category', (e, id) => {
    const meta = loadNotesMeta();
    // 删除分类及其所有子分类
    const idsToDelete = [id];
    const findChildren = (parentId) => {
      meta.categories.filter(c => c.parentId === parentId).forEach(child => {
        idsToDelete.push(child.id);
        findChildren(child.id);
      });
    };
    findChildren(id);
    meta.categories = meta.categories.filter(c => !idsToDelete.includes(c.id));
    // 将被删除分类下的笔记移到 default
    meta.notes.forEach(n => { if (idsToDelete.includes(n.categoryId)) n.categoryId = 'default'; });
    saveNotesMeta(meta);
    return true;
  });
  ipcMain.handle('rename-category', (e, { id, name }) => {
    const meta = loadNotesMeta();
    const cat = meta.categories.find(c => c.id === id);
    if (cat) { cat.name = name; saveNotesMeta(meta); return true; }
    return false;
  });
  ipcMain.handle('move-note-category', (e, { noteId, categoryId }) => {
    const meta = loadNotesMeta();
    const note = meta.notes.find(n => n.id === noteId);
    if (note) { note.categoryId = categoryId; saveNotesMeta(meta); return true; }
    return false;
  });

  // 搜索
  ipcMain.handle('search-notes', (e, query) => {
    const meta = loadNotesMeta();
    const results = [];
    for (const note of meta.notes) {
      if (note.isDeleted) continue;
      const content = getNoteContent(note.id);
      if (note.title.toLowerCase().includes(query.toLowerCase()) ||
          content.toLowerCase().includes(query.toLowerCase()) ||
          note.tags.some(t => t.toLowerCase().includes(query.toLowerCase()))) {
        results.push({ ...note, snippet: content.substring(0, 200) });
      }
    }
    return results;
  });

  // 标签管理
  ipcMain.handle('update-note-tags', (e, { noteId, tags }) => {
    const meta = loadNotesMeta();
    const note = meta.notes.find(n => n.id === noteId);
    if (note) { note.tags = tags; saveNotesMeta(meta); return true; }
    return false;
  });

  // 文件导入对话框
  ipcMain.handle('open-file-dialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '所有支持的格式', extensions: ['txt', 'rtf', 'html', 'htm', 'md', 'doc', 'docx', 'pdf', 'xlsx', 'xls', 'csv', 'png', 'jpg', 'jpeg', 'bmp', 'gif'] },
        { name: '文本文档', extensions: ['txt', 'rtf', 'md'] },
        { name: 'Word文档', extensions: ['doc', 'docx'] },
        { name: 'PDF文档', extensions: ['pdf'] },
        { name: 'Excel表格', extensions: ['xlsx', 'xls', 'csv'] },
        { name: 'HTML文档', extensions: ['html', 'htm'] },
        { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });
    return result;
  });

  ipcMain.handle('open-folder-dialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      defaultPath: getNotesDir(),
      properties: ['openDirectory']
    });
    return result;
  });

  ipcMain.handle('scan-folder-files', (e, folderPath) => {
    const supportedExts = ['.txt', '.rtf', '.html', '.htm', '.md', '.doc', '.docx', '.pdf', '.xlsx', '.xls', '.csv', '.png', '.jpg', '.jpeg', '.bmp', '.gif'];
    const files = [];
    try {
      const items = fs.readdirSync(folderPath);
      for (const item of items) {
        const fullPath = path.join(folderPath, item);
        if (fs.statSync(fullPath).isFile() && supportedExts.includes(path.extname(item).toLowerCase())) {
          files.push(fullPath);
        }
      }
    } catch (e) { /* ignore */ }
    return files;
  });

  ipcMain.handle('batch-import', async (e, { filePaths, categoryId }) => {
    const results = await batchImport(filePaths, categoryId, (current, total) => {
      mainWindow?.webContents.send('import-progress', { current, total });
    });
    return results;
  });

  // 导出笔记
  ipcMain.handle('export-note', async (e, { id, format }) => {
    const meta = loadNotesMeta();
    const note = meta.notes.find(n => n.id === id);
    if (!note) return { success: false, error: '笔记不存在' };
    const content = getNoteContent(id);
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: path.join(app.getPath('desktop'), `${note.title}.md`),
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    });
    if (!result.canceled && result.filePath) {
      fs.writeFileSync(result.filePath, content, 'utf-8');
      return { success: true, path: result.filePath };
    }
    return { success: false, error: '已取消' };
  });

  // 导出所有笔记
  ipcMain.handle('export-all-notes', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    });
    if (!result.canceled && result.filePaths[0]) {
      const exportDir = result.filePaths[0];
      const meta = loadNotesMeta();
      let count = 0;
      for (const note of meta.notes) {
        if (note.isDeleted) continue;
        const content = getNoteContent(note.id);
        const safeName = note.title.replace(/[<>:"/\\|?*]/g, '_');
        fs.writeFileSync(path.join(exportDir, `${safeName}.md`), content, 'utf-8');
        count++;
      }
      return { success: true, count };
    }
    return { success: false };
  });

  // 主题切换
  ipcMain.handle('set-theme', (e, theme) => {
    const config = loadConfig();
    config.theme = theme;
    saveConfig(config);
    nativeTheme.themeSource = theme === 'system' ? 'system' : theme;
    return true;
  });

  // 打开文件位置
  ipcMain.handle('open-note-location', (e, id) => {
    const noteFile = path.join(getNotesDir(), `${id}.md`);
    if (fs.existsSync(noteFile)) shell.showItemInFolder(noteFile);
  });

  // 登录凭证管理（保存到安装目录同级目录下的 passwd 文件夹）
  ipcMain.handle('get-login-credentials', () => {
    try {
      const passwdFile = getPasswdFile();
      if (fs.existsSync(passwdFile)) {
        return JSON.parse(fs.readFileSync(passwdFile, 'utf-8'));
      }
    } catch (e) { /* ignore */ }
    return { username: null, passwordHash: null };
  });

  ipcMain.handle('save-login-credentials', (e, { username, passwordHash }) => {
    try {
      initPasswdDir();
      fs.writeFileSync(getPasswdFile(), JSON.stringify({ username, passwordHash }, null, 2), 'utf-8');
      return true;
    } catch (e) {
      return false;
    }
  });

  ipcMain.handle('check-login-credentials', (e, { username, passwordHash }) => {
    try {
      const passwdFile = getPasswdFile();
      if (fs.existsSync(passwdFile)) {
        const creds = JSON.parse(fs.readFileSync(passwdFile, 'utf-8'));
        return creds.username === username && creds.passwordHash === passwordHash;
      }
    } catch (e) { /* ignore */ }
    return false;
  });

  // 清空回收站
  ipcMain.handle('empty-recycle-bin', () => {
    const meta = loadNotesMeta();
    const deleted = meta.notes.filter(n => n.isDeleted);
    deleted.forEach(n => {
      const noteFile = path.join(getNotesDir(), `${n.id}.md`);
      if (fs.existsSync(noteFile)) fs.unlinkSync(noteFile);
    });
    meta.notes = meta.notes.filter(n => !n.isDeleted);
    saveNotesMeta(meta);
    return true;
  });
}

// ============ 应用生命周期 ============
app.whenReady().then(() => {
  initDirectories();
  initPasswdDir();
  setupIPC();
  createWindow();
  createTray();
  registerShortcuts();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  globalShortcut.unregisterAll();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});