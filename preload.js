const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 窗口控制
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  onWindowStateChanged: (callback) => ipcRenderer.on('window-state-changed', (e, isMaximized) => callback(isMaximized)),

  // 笔记操作
  getNotes: () => ipcRenderer.invoke('get-notes'),
  createNote: (data) => ipcRenderer.invoke('create-note', data),
  getNoteContent: (id) => ipcRenderer.invoke('get-note-content', id),
  updateNoteContent: (data) => ipcRenderer.invoke('update-note-content', data),
  deleteNote: (data) => ipcRenderer.invoke('delete-note', data),
  restoreNote: (id) => ipcRenderer.invoke('restore-note', id),
  renameNote: (data) => ipcRenderer.invoke('rename-note', data),
  toggleFavorite: (id) => ipcRenderer.invoke('toggle-favorite', id),
  searchNotes: (query) => ipcRenderer.invoke('search-notes', query),

  // 分类管理
  addCategory: (data) => ipcRenderer.invoke('add-category', data),
  deleteCategory: (id) => ipcRenderer.invoke('delete-category', id),
  renameCategory: (data) => ipcRenderer.invoke('rename-category', data),
  moveNoteCategory: (data) => ipcRenderer.invoke('move-note-category', data),

  // 标签管理
  updateNoteTags: (data) => ipcRenderer.invoke('update-note-tags', data),

  // 文件导入
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  scanFolderFiles: (folderPath) => ipcRenderer.invoke('scan-folder-files', folderPath),
  batchImport: (data) => ipcRenderer.invoke('batch-import', data),
  onImportProgress: (callback) => ipcRenderer.on('import-progress', (e, data) => callback(data)),

  // 导出
  exportNote: (data) => ipcRenderer.invoke('export-note', data),
  exportAllNotes: () => ipcRenderer.invoke('export-all-notes'),

  // 配置
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  setTheme: (theme) => ipcRenderer.invoke('set-theme', theme),
  getNotesDir: () => ipcRenderer.invoke('get-notes-dir'),
  changeNotesDir: (newDir) => ipcRenderer.invoke('change-notes-dir', newDir),

  // 系统
  openNoteLocation: (id) => ipcRenderer.invoke('open-note-location', id),
  emptyRecycleBin: () => ipcRenderer.invoke('empty-recycle-bin'),
  openOriginalFile: (relativePath) => ipcRenderer.invoke('open-original-file', relativePath),
  getImportedFilePath: (relativePath) => ipcRenderer.invoke('get-imported-file-path', relativePath),
  downloadImportedFile: (relativePath) => ipcRenderer.invoke('download-imported-file', relativePath),

  // 文件预览（应用内预览导入的文件）
  getFilePreview: (relativePath) => ipcRenderer.invoke('get-file-preview', relativePath),

  // 事件监听
  onNewNote: (callback) => ipcRenderer.on('new-note', () => callback()),
  onOpenImport: (callback) => ipcRenderer.on('open-import', () => callback()),
  onNotesDirChanged: (callback) => ipcRenderer.on('notes-dir-changed', (e, newDir) => callback(newDir)),

  // 登录凭证
  getLoginCredentials: () => ipcRenderer.invoke('get-login-credentials'),
  saveLoginCredentials: (data) => ipcRenderer.invoke('save-login-credentials', data),
  checkLoginCredentials: (data) => ipcRenderer.invoke('check-login-credentials', data),

  // 移除事件监听
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});