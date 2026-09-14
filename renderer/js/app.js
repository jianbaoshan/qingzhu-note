// ============ 青竹笔记 - 主应用逻辑 ============

// 显式挂载到 window，确保 onclick 属性能访问
const App = window.App = {
  state: {
    notes: [],
    categories: [],
    tags: [],
    currentNoteId: null,
    currentCategory: 'all',
    currentView: 'list',
    currentSort: 'updated',
    searchQuery: '',
    config: { theme: 'system', fontSize: 14, autoSave: true, autoSaveInterval: 30000 },
    isDirty: false,
    autoSaveTimer: null,
    expandedCategories: new Set()
  },

  // 批量选择状态
  _batchSelected: new Set(),
  _currentPreviewType: '', // 当前预览文件类型：pdf, html_file, html 等
  _currentSearchText: '',  // 当前搜索文本

  // ============ 初始化 ============
  async init() {
    try {
      // 绑定事件和设置事件委托必须最先执行，确保所有按钮都能响应
      // 如果事件绑定在异步加载之后，异步加载卡住会导致所有按钮都失效
      // 因此必须最先绑定事件！
      try { this.bindEvents(); } catch (e) { console.error('Bind events error:', e); }
      try { this.setupEventDelegation(); } catch (e) { console.error('Event delegation error:', e); }

      // 加载配置
      if (window.electronAPI) {
        try {
          this.state.config = await window.electronAPI.getConfig();
          this.applyConfig();
        } catch (e) {
          console.error('Config load error:', e);
        }
      }

      // 加载笔记数据
      try {
        await this.loadNotes();
      } catch (e) {
        console.error('Notes load error:', e);
      }

      // 渲染界面
      try { this.renderSidebar(); } catch (e) { console.error('Sidebar render error:', e); }
      try { this.renderNoteList(); } catch (e) { console.error('NoteList render error:', e); }
      try { this.hideReadonlyView(); } catch (e) { console.error('Hide readonly error:', e); }

      // 初始化可拖拽分割线
      try { this.initResizeDivider(); } catch (e) { console.error('Resize divider error:', e); }

      // 监听来自主进程的事件
      try { this.listenToMainProcess(); } catch (e) { console.error('Listen error:', e); }

      // 显示登录界面
      try { this.showLogin(); } catch (e) { console.error('Login show error:', e); }

      console.log('App initialized successfully');
    } catch (e) {
      console.error('App initialization error:', e);
    }
  },

  // ============ 登录界面 ============
  async showLogin() {
    const overlay = document.getElementById('login-overlay');
    if (!overlay) return;

    // 重置为登录模式
    this.loginMode = 'login';

    // 显示登录界面
    overlay.classList.remove('login-overlay--hidden');

    // 更新 UI 为登录模式
    this.updateLoginUI('login');
  },

  // ============ 切换登录/注册模式 ============
  switchLoginMode() {
    const nextMode = this.loginMode === 'login' ? 'register' : 'login';
    this.updateLoginUI(nextMode);
  },

  // ============ 更新登录 UI ============
  updateLoginUI(mode) {
    const title = document.getElementById('login-title');
    const subtitle = document.getElementById('login-subtitle');
    const submitBtn = document.getElementById('btn-login-submit');
    const switchBtn = document.getElementById('btn-login-switch');
    const usernameInput = document.getElementById('login-username');
    const passwordInput = document.getElementById('login-password');
    const confirmField = document.getElementById('login-confirm-field');
    const confirmInput = document.getElementById('login-confirm-password');
    const errorEl = document.getElementById('login-error');

    if (errorEl) {
      errorEl.textContent = '';
      errorEl.style.color = '';
    }
    if (usernameInput) usernameInput.value = '';
    if (passwordInput) passwordInput.value = '';
    if (confirmInput) confirmInput.value = '';

    if (mode === 'register') {
      if (title) title.textContent = '注册';
      if (subtitle) subtitle.textContent = '创建您的账号';
      if (submitBtn) submitBtn.textContent = '注册';
      if (switchBtn) {
        switchBtn.style.display = 'block';
        switchBtn.textContent = '返回登录';
      }
      if (confirmField) confirmField.style.display = 'block';
      setTimeout(() => { if (usernameInput) usernameInput.focus(); }, 100);
    } else {
      if (title) title.textContent = '登录';
      if (subtitle) subtitle.textContent = '请输入账号密码继续';
      if (submitBtn) submitBtn.textContent = '登录';
      if (switchBtn) {
        switchBtn.style.display = 'block';
        switchBtn.textContent = '注册新账号';
      }
      if (confirmField) confirmField.style.display = 'none';
      setTimeout(() => { if (usernameInput) usernameInput.focus(); }, 100);
    }
    this.loginMode = mode;
  },

  // ============ 处理提交（登录/注册） ============
  async handleLoginSubmit() {
    const overlay = document.getElementById('login-overlay');
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const confirmPassword = document.getElementById('login-confirm-password')?.value || '';
    const errEl = document.getElementById('login-error');

    // 重置错误样式
    if (errEl) errEl.style.color = '';

    if (!username) { if (errEl) errEl.textContent = '请输入账号'; return; }
    if (!password) { if (errEl) errEl.textContent = '请输入密码'; return; }

    if (!window.electronAPI) {
      if (errEl) errEl.textContent = '需要 Electron 环境';
      return;
    }

    if (this.loginMode === 'register') {
      // 注册模式：验证两次密码一致
      if (!confirmPassword) {
        if (errEl) errEl.textContent = '请再次输入密码';
        return;
      }
      if (password !== confirmPassword) {
        if (errEl) errEl.textContent = '两次输入的密码不一致';
        return;
      }

      try {
        const hash = await this.hashPassword(password);
        const result = await window.electronAPI.saveLoginCredentials({ username, passwordHash: hash });
        if (result) {
          // 注册成功，切换到登录模式
          this.updateLoginUI('login');
          if (errEl) {
            errEl.textContent = '注册成功，请登录';
            errEl.style.color = '#107c10';
          }
        } else {
          if (errEl) errEl.textContent = '注册失败，请重试';
        }
      } catch (e) {
        if (errEl) errEl.textContent = '注册失败：' + e.message;
      }
    } else {
      // 登录模式：验证凭证
      try {
        const hash = await this.hashPassword(password);
        const valid = await window.electronAPI.checkLoginCredentials({ username, passwordHash: hash });
        if (valid) {
          overlay.classList.add('login-overlay--hidden');
          if (errEl) errEl.textContent = '';
        } else {
          if (errEl) errEl.textContent = '账号或密码错误';
        }
      } catch (e) {
        if (errEl) errEl.textContent = '登录失败：' + e.message;
      }
    }
  },

  // ============ 密码哈希（SHA-256） ============
  async hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  },

  // ============ 数据加载 ============
  async loadNotes() {
    if (!window.electronAPI) return;
    const data = await window.electronAPI.getNotes();
    this.state.notes = data.notes || [];
    this.state.categories = data.categories || [{ id: 'default', name: '我的笔记', icon: '📝', order: 0 }];
    this.state.tags = data.tags || [];
  },

  // ============ 配置应用 ============
  applyConfig() {
    const config = this.state.config;
    // 主题
    if (config.theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else if (config.theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      // 跟随系统 - 通过 prefers-color-scheme 检测
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    }
    // 字体大小
    document.documentElement.style.setProperty('--editor-font-size', config.fontSize + 'px');
  },

  // ============ 获取当前分类下的笔记 ============
  getFilteredNotes() {
    let notes = this.state.notes;

    // 分类过滤
    if (this.state.currentCategory === 'favorites') {
      notes = notes.filter(n => n.isFavorite && !n.isDeleted);
    } else if (this.state.currentCategory === 'trash') {
      notes = notes.filter(n => n.isDeleted);
    } else if (this.state.currentCategory === 'recent') {
      notes = notes.filter(n => !n.isDeleted)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .slice(0, 20);
    } else if (this.state.currentCategory && this.state.currentCategory !== 'all') {
      notes = notes.filter(n => n.categoryId === this.state.currentCategory && !n.isDeleted);
    } else {
      notes = notes.filter(n => !n.isDeleted);
    }

    // 搜索过滤
    if (this.state.searchQuery) {
      const q = this.state.searchQuery.toLowerCase();
      notes = notes.filter(n => {
        // 标题匹配
        if (n.title.toLowerCase().includes(q)) return true;
        // 标签匹配
        if (n.tags && n.tags.some(t => t.toLowerCase().includes(q))) return true;
        return false;
      });
    }

    // 排序
    switch (this.state.currentSort) {
      case 'updated':
        notes.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        break;
      case 'created':
        notes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        break;
      case 'title':
        notes.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
        break;
    }

    return notes;
  },

  // ============ 渲染侧边栏 ============
  renderSidebar() {
    const navList = document.querySelector('.nav-list');
    if (!navList) return;

    // 更新分类计数
    const allCount = this.state.notes.filter(n => !n.isDeleted).length;
    const favCount = this.state.notes.filter(n => n.isFavorite && !n.isDeleted).length;
    const trashCount = this.state.notes.filter(n => n.isDeleted).length;

    const badgeAll = document.getElementById('badge-all');
    const badgeFav = document.getElementById('badge-favorites');
    const badgeTrash = document.getElementById('badge-trash');

    if (badgeAll) badgeAll.textContent = allCount;
    if (badgeFav) badgeFav.textContent = favCount;
    if (badgeTrash) badgeTrash.textContent = trashCount;

    // 更新自定义分类（树形结构）
    const existingItems = navList.querySelectorAll('.nav-list__item--custom');
    existingItems.forEach(el => el.remove());

    // 获取子分类
    const getChildren = (parentId) => this.state.categories.filter(c => c.parentId === parentId && c.id !== 'default');
    const hasChildren = (catId) => this.state.categories.some(c => c.parentId === catId && c.id !== 'default');

    // 递归渲染分类树
    const renderTree = (parentId, depth) => {
      const children = getChildren(parentId);
      children.forEach(cat => {
        const count = this.state.notes.filter(n => n.categoryId === cat.id && !n.isDeleted).length;
        const isExpanded = this.state.expandedCategories.has(cat.id);
        const hasChild = hasChildren(cat.id);

        const li = document.createElement('li');
        li.className = `nav-list__item nav-list__item--custom${this.state.currentCategory === cat.id ? ' nav-list__item--active' : ''}`;
        li.dataset.category = cat.id;
        li.style.paddingLeft = (depth * 16 + 8) + 'px';

        li.innerHTML = `
          <span class="nav-list__toggle${hasChild ? '' : ' nav-list__toggle--hidden'}" data-cat-id="${cat.id}">
            <svg width="10" height="10" viewBox="0 0 10 10" style="transform:${isExpanded ? 'rotate(90deg)' : 'rotate(0deg)'};transition:transform 0.15s">
              <path d="M3 2l4 3-4 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </span>
          <span class="nav-list__icon">${cat.icon || '📁'}</span>
          <span class="nav-list__label">${this.escapeHtml(cat.name)}</span>
          <span class="nav-list__badge">${count}</span>
        `;

        // 点击展开/折叠
        const toggle = li.querySelector('.nav-list__toggle');
        if (toggle && hasChild) {
          toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.state.expandedCategories.has(cat.id)) {
              this.state.expandedCategories.delete(cat.id);
            } else {
              this.state.expandedCategories.add(cat.id);
            }
            this.renderSidebar();
          });
        }

        li.addEventListener('click', (e) => {
          // 检查是否点击了展开按钮（已由上面的独立事件处理）
          if (e.target.closest('.nav-list__toggle')) return;
          if (hasChild) {
            // 有子分类：切换展开/折叠
            if (this.state.expandedCategories.has(cat.id)) {
              this.state.expandedCategories.delete(cat.id);
            } else {
              this.state.expandedCategories.add(cat.id);
            }
            this.renderSidebar();
          } else {
            // 无子分类：显示该分类下的笔记
            this.selectCategory(cat.id);
          }
        });
        li.addEventListener('contextmenu', (e) => this.showCategoryContextMenu(e, cat));

        if (parentId === null) {
          navList.insertBefore(li, navList.lastElementChild);
        } else {
          // 插入到父分类后面
          const ref = navList.querySelector(`[data-category="${parentId}"]`);
          if (ref && ref.nextSibling) {
            navList.insertBefore(li, ref.nextSibling);
          } else {
            navList.insertBefore(li, navList.lastElementChild);
          }
        }

        // 如果展开，递归渲染子分类
        if (isExpanded) {
          renderTree(cat.id, depth + 1);
        }
      });
    };

    // 从根分类开始渲染
    renderTree(null, 0);
  },

  // ============ 渲染笔记列表 ============
  renderNoteList() {
    const container = document.getElementById('cards-container');
    if (!container) return;

    const notes = this.getFilteredNotes();

    if (notes.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon">
            <svg width="48" height="48" viewBox="0 0 48 48">
              <rect x="8" y="6" width="32" height="36" rx="4" fill="none" stroke="currentColor" stroke-width="2"/>
              <line x1="14" y1="16" x2="34" y2="16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <line x1="14" y1="22" x2="34" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <line x1="14" y1="28" x2="28" y2="28" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </div>
          <p class="empty-state__text">${this.state.currentCategory === 'trash' ? '回收站为空' : this.state.searchQuery ? '未找到匹配的笔记' : '暂无笔记，点击"新建笔记"开始'}</p>
        </div>
      `;
      return;
    }

    container.innerHTML = '';
    container.className = `note-list__cards note-list__cards--${this.state.currentView}`;

    notes.forEach(note => {
      const card = document.createElement('article');
      card.className = `note-card${this.state.currentNoteId === note.id ? ' note-card--selected' : ''}${this._batchSelected.has(note.id) ? ' note-card--batch' : ''}`;
      card.dataset.id = note.id;

      const date = new Date(note.updatedAt);
      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const wordCount = note.wordCount || 0;
      const wordStr = wordCount > 1000 ? `${(wordCount / 1000).toFixed(1)}k 字` : `${wordCount} 字`;

      const tagsHtml = (note.tags || []).map(tag =>
        `<span class="tag tag--blue">${this.escapeHtml(tag)}</span>`
      ).join('');

      const isChecked = this._batchSelected.has(note.id);

      card.innerHTML = `
        <input type="checkbox" class="note-card__checkbox" data-batch-id="${note.id}" ${isChecked ? 'checked' : ''}>
        <div class="note-card__header">
          <h3 class="note-card__title" title="${this.escapeHtml(this._displayTitle(note))}">${this.escapeHtml(this._displayTitle(note))}</h3>
          <span class="note-card__favorite${note.isFavorite ? ' note-card__favorite--active' : ''}" data-action="favorite" aria-label="收藏">
            <svg width="14" height="14" viewBox="0 0 16 16">
              <path d="M8 1.5l1.76 3.57 3.94.57-2.85 2.78.67 3.93L8 10.75l-3.52 1.85.67-3.93L2.3 5.64l3.94-.57L8 1.5z" fill="${note.isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
            </svg>
          </span>
        </div>
        ${tagsHtml ? `<div class="note-card__tags">${tagsHtml}</div>` : ''}
        <div class="note-card__meta">
          <span class="note-card__date">${dateStr}</span>
          <span class="note-card__words">${wordStr}</span>
        </div>
      `;

      // 复选框点击（批量选择）
      const checkbox = card.querySelector('.note-card__checkbox');
      checkbox.addEventListener('change', (e) => {
        e.stopPropagation();
        if (e.target.checked) {
          this._batchSelected.add(note.id);
        } else {
          this._batchSelected.delete(note.id);
        }
        this._updateBatchUI();
        this.renderNoteList();
      });

      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="favorite"]')) return;
        if (e.target.closest('.note-card__checkbox')) return;
        // 如果批量模式有选中项，则切换当前卡的选中状态
        if (this._batchSelected.size > 0) {
          if (this._batchSelected.has(note.id)) {
            this._batchSelected.delete(note.id);
          } else {
            this._batchSelected.add(note.id);
          }
          this._updateBatchUI();
          this.renderNoteList();
          return;
        }
        this.openNote(note.id);
      });

      // 收藏按钮
      card.querySelector('[data-action="favorite"]').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (window.electronAPI) {
          const isFav = await window.electronAPI.toggleFavorite(note.id);
          note.isFavorite = isFav;
          this.renderNoteList();
          this.renderSidebar();
        }
      });

      // 右键菜单
      card.addEventListener('contextmenu', (e) => this.showNoteContextMenu(e, note));

      container.appendChild(card);
    });
  },

  // ============ 打开笔记 ============
  async openNote(noteId) {
    this.state.currentNoteId = noteId;
    this.renderNoteList();

    if (!window.electronAPI) return;

    const content = await window.electronAPI.getNoteContent(noteId);
    const note = this.state.notes.find(n => n.id === noteId);
    if (!note) return;

    // 内容过大时（>100KB），跳过 markdown 渲染，防止卡死
    const MAX_CONTENT_SIZE = 100 * 1024;
    if (content && content.length > MAX_CONTENT_SIZE) {
      this.hideReadonlyView();
      const editor = document.getElementById('markdown-editor');
      const preview = document.getElementById('markdown-preview');
      if (editor) {
        editor.value = '';
        this.state.isDirty = false;
        this.updateStatusBar();
      }
      if (preview) {
        preview.innerHTML = `<div class="file-preview-error">该笔记内容过大（${(content.length / 1024).toFixed(1)}KB），无法正常显示</div>`;
      }
      return;
    }

    if (note.originalFile) {
      this.showReadonlyView(note);
    } else {
      this.hideReadonlyView();
      // 更新编辑器
      const editor = document.getElementById('markdown-editor');
      const preview = document.getElementById('markdown-preview');
      if (editor) {
        editor.value = content;
        this.state.isDirty = false;
        this.updateStatusBar();
        this.renderMarkdown(content);
      }
      // 默认切换到预览模式
      this.switchToPane('preview');
    }
  },

  // ============ 导入文件只读视图 ============
  async showReadonlyView(note) {
    // 重置缩放级别
    this._currentZoom = 100;

    const readonly = document.getElementById('editor-readonly');
    const editorPanes = document.getElementById('editor-panes');
    if (!readonly) return;

    // 导入的非 Markdown 文件只读预览：隐藏编辑器顶部的 编辑/预览/分栏 三个标签
    this._setTabsVisibility(false);

    // 隐藏编辑区域，显示只读视图
    readonly.style.display = 'flex';
    if (editorPanes) {
      const panes = editorPanes.querySelectorAll('.editor__pane, .editor__divider');
      panes.forEach(el => el.style.display = 'none');
    }
    // 通知主进程只读视图已显示（用于拦截 Ctrl+F）
    if (window.electronAPI?.setReadonlyVisible) window.electronAPI.setReadonlyVisible(true);

    const fileNameEl = document.getElementById('readonly-file-name');
    const iconEl = document.getElementById('readonly-file-icon');
    const previewEl = document.getElementById('readonly-preview');
    const fileInfo = document.getElementById('readonly-file-info');
    if (!fileNameEl || !iconEl) return;

    const relativePath = note.originalFile;
    if (!relativePath) {
      // 没有原始文件路径（如旧版本导入的压缩包），显示提示
      readonly.style.display = 'flex';
      if (previewEl) {
        previewEl.innerHTML = `<div class="file-preview-error">该笔记的原始文件不存在，无法预览</div>`;
        previewEl.style.display = 'block';
      }
      if (fileInfo) fileInfo.style.display = 'none';
      return;
    }

    const ext = relativePath.split('.').pop()?.toLowerCase() || '';
    const fileName = relativePath.split('/').pop() || relativePath;

    fileNameEl.textContent = fileName;

    // 更新 banner 提示文字
    const bannerRow = readonly.querySelector('.readonly__banner');
    const banner = bannerRow ? bannerRow.querySelector('span') : null;
    if (bannerRow) bannerRow.style.display = 'block';
    if (banner) {
      if (['doc', 'docx'].includes(ext)) {
        banner.textContent = '此笔记为导入文件，已通过 Word 转换为 PDF 预览，保留原始格式';
      } else if (['xlsx', 'xls'].includes(ext)) {
        // Excel 以原始表格格式交互预览，不显示导入提示
        if (bannerRow) bannerRow.style.display = 'none';
        banner.textContent = '';
      } else if (['html', 'htm'].includes(ext)) {
        banner.textContent = '此笔记为导入文件，通过 iframe 直接渲染 HTML 预览';
      } else {
        banner.textContent = '此笔记为导入文件，仅支持查看';
      }
    }

    // 设置文件图标
    const imageExts = ['png', 'jpg', 'jpeg', 'bmp', 'gif'];
    if (imageExts.includes(ext)) {
      iconEl.innerHTML = `<svg width="48" height="48" viewBox="0 0 48 48"><rect x="4" y="6" width="40" height="36" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="18" cy="18" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 34l10-10 8 8 6-6 16 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`;
    } else if (ext === 'pdf') {
      iconEl.innerHTML = `<svg width="48" height="48" viewBox="0 0 48 48"><rect x="8" y="4" width="32" height="40" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><text x="24" y="30" text-anchor="middle" font-size="14" font-weight="bold" fill="currentColor" font-family="sans-serif">PDF</text></svg>`;
    } else if (['xlsx', 'xls', 'csv'].includes(ext)) {
      iconEl.innerHTML = `<svg width="48" height="48" viewBox="0 0 48 48"><rect x="8" y="4" width="32" height="40" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><text x="24" y="30" text-anchor="middle" font-size="14" font-weight="bold" fill="currentColor" font-family="sans-serif">XL</text></svg>`;
    } else if (['doc', 'docx'].includes(ext)) {
      iconEl.innerHTML = `<svg width="48" height="48" viewBox="0 0 48 48"><rect x="8" y="4" width="32" height="40" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><text x="24" y="30" text-anchor="middle" font-size="14" font-weight="bold" fill="currentColor" font-family="sans-serif">W</text></svg>`;
    } else if (['html', 'htm'].includes(ext)) {
      iconEl.innerHTML = `<svg width="48" height="48" viewBox="0 0 48 48"><rect x="8" y="4" width="32" height="40" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><text x="24" y="30" text-anchor="middle" font-size="12" font-weight="bold" fill="currentColor" font-family="sans-serif">HTML</text></svg>`;
    } else {
      iconEl.innerHTML = `<svg width="48" height="48" viewBox="0 0 48 48"><rect x="8" y="4" width="32" height="40" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M18 28h12M18 33h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
    }

    // 调用主进程获取预览内容
    if (window.electronAPI) {
      const result = await window.electronAPI.getFilePreview(relativePath);
      if (result) {
        if (result.type === 'image') {
          // 图片：直接显示
          previewEl.innerHTML = `<img src="file:///${result.content}" alt="${fileName}">`;
          previewEl.style.display = 'block';
          if (fileInfo) fileInfo.style.display = 'none';
        } else if (result.type === 'pdf') {
          // PDF：用 PDF.js 渲染（支持主题跟随 + 文本搜索）
          previewEl.innerHTML = '';
          previewEl.style.display = 'flex';
          if (fileInfo) fileInfo.style.display = 'none';
          try {
            await window.PDFPreview.render(previewEl, result.data);
          } catch (err) {
            console.error('[PDF] PDF.js 渲染失败:', err);
            previewEl.innerHTML = `<div class="file-preview-error">PDF 预览失败：${(err && err.message) || err}</div>`;
          }
        } else if (result.type === 'excel_data') {
          // Excel：用 x-spreadsheet 交互表格组件展示（应用内 Excel 格式）
          const ROWS = 2000;
          const COLS = 60;
          // 固定画布尺寸：数据之外保留大片空白缓冲，可一直向下/向右拖动（类似完整 Excel 画布）
          previewEl.innerHTML = `
            <div class="excel-jump-bar">
              <span>行</span><input id="jump-row" type="number" min="1" max="${ROWS}" value="1">
              <span>列</span><input id="jump-col" type="number" min="1" max="${COLS}" value="1">
              <button id="jump-go" type="button">跳转</button>
            </div>
            <div class="xspreadsheet-host" id="xspreadsheet-host"></div>`;
          previewEl.style.display = 'block';
          if (fileInfo) fileInfo.style.display = 'none';
          const host = document.getElementById('xspreadsheet-host');
          if (host && window.x_spreadsheet) {
            let sheet = new window.x_spreadsheet(host, {
              mode: 'read',
              showToolbar: true,
              showGrid: true,
              showContextmenu: true,
              row: { len: ROWS, height: 25 },
              col: { len: COLS, width: 90 },
            });
            sheet.loadData(result.sheets || []);
            // 行/列快速跳转：直接滚动到底部/右侧滚动容器（与鼠标滚轮滚动的容器一致）
            const jump = () => {
              const r = ((parseInt(document.getElementById('jump-row').value, 10) || 1) - 1);
              const c = ((parseInt(document.getElementById('jump-col').value, 10) || 1) - 1);
              const top = Math.max(0, r) * 25;
              const left = Math.max(0, c) * 90;
              const hostEl = document.getElementById('xspreadsheet-host');
              if (hostEl) {
                const v = hostEl.querySelector('.x-spreadsheet-scrollbar.vertical');
                if (v && 'scrollTop' in v) v.scrollTop = top;
                const h = hostEl.querySelector('.x-spreadsheet-scrollbar.horizontal');
                if (h && 'scrollLeft' in h) h.scrollLeft = left;
              }
            };
            document.getElementById('jump-go').onclick = jump;
            ['jump-row', 'jump-col'].forEach((id) => {
              document.getElementById(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') jump(); });
            });
          } else if (host) {
            host.innerHTML = '<div style="padding:40px;text-align:center;color:#888">表格组件加载失败</div>';
          }
        } else if (result.type === 'html_file') {
          // HTML：用 srcdoc 嵌入（确保同源，可访问 contentDocument），带缩放工具栏
          const zoomLevel = this._currentZoom || 100;
          const srcdocContent = `<base href="file:///${result.baseDir}/">${result.content}`;
          previewEl.innerHTML = `
            <div class="readonly__zoom-toolbar" style="margin-bottom:8px">
              <button class="readonly__zoom-btn" data-zoom-action="out" title="缩小">−</button>
              <span class="readonly__zoom-label" id="html-zoom-label">${zoomLevel}%</span>
              <button class="readonly__zoom-btn" data-zoom-action="in" title="放大">+</button>
              <button class="readonly__zoom-btn readonly__zoom-reset" data-zoom-action="reset" title="重置缩放">100%</button>
            </div>
            <iframe srcdoc="${srcdocContent.replace(/"/g, '&quot;').replace(/'/g, '&#39;')}" class="pdf-viewer" id="html-preview-iframe" style="zoom:${zoomLevel / 100}"></iframe>`;
          previewEl.style.display = 'block';
          if (fileInfo) fileInfo.style.display = 'none';
          const iframe = previewEl.querySelector('#html-preview-iframe');
          // 绑定缩放事件（鼠标滚轮 + 工具栏按钮）
          const zoomLabel = document.getElementById('html-zoom-label');
          if (zoomLabel) {
            const updateZoom = (level) => {
              this._currentZoom = Math.max(50, Math.min(200, level));
              if (zoomLabel) zoomLabel.textContent = this._currentZoom + '%';
              if (iframe) iframe.style.zoom = this._currentZoom / 100;
            };
            // 工具栏按钮缩放
            previewEl.addEventListener('click', (e) => {
              const btn = e.target.closest('[data-zoom-action]');
              if (!btn) return;
              const action = btn.dataset.zoomAction;
              if (action === 'in') updateZoom(this._currentZoom + 10);
              else if (action === 'out') updateZoom(this._currentZoom - 10);
              else if (action === 'reset') updateZoom(100);
            });
            // 鼠标滚轮缩放：iframe 加载后直接绑定到其 contentDocument（同源）
            if (iframe) {
              iframe.addEventListener('load', () => {
                try {
                  const iDoc = iframe.contentDocument || iframe.contentWindow?.document;
                  if (!iDoc) return;
                  iDoc.addEventListener('wheel', (e) => {
                    if (!e.ctrlKey) return;
                    e.preventDefault();
                    const delta = e.deltaY > 0 ? -10 : 10;
                    updateZoom(this._currentZoom + delta);
                  }, { passive: false });
                  // 暗色主题注入
                  this._applyThemeToHtmlPreview();
                } catch (_) { /* 同源不应抛异常，静默忽略 */ }
              }, { once: true });
            }
          }
        } else if (result.type === 'html') {
          // Word/Excel：显示转换后的 HTML，带缩放工具栏
          const zoomLevel = this._currentZoom || 100;
          const fallbackNotice = result.fallback
            ? `<div class="file-preview-note">当前系统未检测到 Microsoft Word，使用简化版预览，如需查看完整格式请点击下方按钮</div>`
            : '';
          previewEl.innerHTML = `
            <div class="readonly__zoom-toolbar" style="margin-bottom:8px">
              <button class="readonly__zoom-btn" data-zoom-action="out" title="缩小">−</button>
              <span class="readonly__zoom-label" id="zoom-label">${zoomLevel}%</span>
              <button class="readonly__zoom-btn" data-zoom-action="in" title="放大">+</button>
              <button class="readonly__zoom-btn readonly__zoom-reset" data-zoom-action="reset" title="重置缩放">100%</button>
            </div>
            <div class="readonly__zoom-toolbar" style="padding:4px 12px;margin-bottom:8px">
              <button class="readonly__open-btn" id="btn-open-original-html" style="font-size:12px;padding:4px 12px">
                <svg width="12" height="12" viewBox="0 0 14 14" style="vertical-align:middle;margin-right:4px">
                  <path d="M5 1H2a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1V9" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                  <path d="M9 1h4v4M13 1L7.5 6.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                在外部程序打开
              </button>
            </div>
            ${fallbackNotice}
            <div class="file-preview-html" id="file-preview-html" style="font-size:${zoomLevel}%">${result.content}</div>`;
          previewEl.style.display = 'block';
          if (fileInfo) fileInfo.style.display = 'none';
          // 绑定缩放按钮事件
          this._bindZoomControls(previewEl);
          // 绑定外部打开按钮
          const openBtn = previewEl.querySelector('#btn-open-original-html');
          if (openBtn) {
            openBtn._originalFile = relativePath;
          }
        } else if (result.type === 'text') {
          // 文本文件：显示为预格式化文本
          previewEl.innerHTML = `<pre class="file-preview-text">${this.escapeHtml(result.content)}</pre>`;
          previewEl.style.display = 'block';
          if (fileInfo) fileInfo.style.display = 'none';
        } else if (result.type === 'error') {
          previewEl.innerHTML = `<div class="file-preview-error">${this.escapeHtml(result.content)}</div>`;
          previewEl.style.display = 'block';
          if (fileInfo) fileInfo.style.display = 'none';
        } else if (result.type === 'archive') {
          // 压缩包：显示提示，不提供打开按钮
          previewEl.innerHTML = `<div class="file-preview-unsupported">${this.escapeHtml(result.content)}</div>`;
          previewEl.style.display = 'block';
          if (fileInfo) fileInfo.style.display = 'none';
        } else {
          // 不支持的格式：显示文件信息，提供打开按钮
          previewEl.innerHTML = `<div class="file-preview-unsupported">${this.escapeHtml(result.content)}</div>`;
          previewEl.style.display = 'block';
          if (fileInfo) fileInfo.style.display = 'none';
        }
      } else {
        previewEl.style.display = 'none';
        if (fileInfo) fileInfo.style.display = 'flex';
      }
    } else {
      previewEl.style.display = 'none';
      if (fileInfo) fileInfo.style.display = 'flex';
    }

    // 绑定打开按钮
    const openBtn = document.getElementById('btn-open-original');
    if (openBtn) {
      openBtn._originalFile = relativePath;
    }

    // 绑定下载按钮
    const downloadBtn = document.getElementById('btn-download-file');
    if (downloadBtn) {
      downloadBtn._originalFile = relativePath;
    }

    // 记录当前预览文件类型（用于搜索功能）
    this._currentPreviewType = ext === 'pdf' ? 'pdf' : 'html';

    // 切换文件时清除之前的页面内搜索高亮和会话
    if (window.electronAPI?.stopFindInPage) window.electronAPI.stopFindInPage();

    // 搜索栏默认隐藏，由 Ctrl+F 召唤（事件绑定在 init 中已完成）
  },

  hideReadonlyView() {
    // 返回 Markdown 编辑器：恢复显示 编辑/预览/分栏 三个标签
    this._setTabsVisibility(true);
    const readonly = document.getElementById('editor-readonly');
    const editorPanes = document.getElementById('editor-panes');
    if (readonly) readonly.style.display = 'none';
    if (editorPanes) {
      const panes = editorPanes.querySelectorAll('.editor__pane, .editor__divider');
      panes.forEach(el => el.style.display = '');
    }
    // 隐藏搜索栏
    const searchBar = document.getElementById('readonly-search-bar');
    if (searchBar) searchBar.style.display = 'none';
    // 停止页面内搜索
    if (window.electronAPI?.stopFindInPage) window.electronAPI.stopFindInPage();
    this._currentSearchText = '';
    // 通知主进程只读视图已隐藏
    if (window.electronAPI?.setReadonlyVisible) window.electronAPI.setReadonlyVisible(false);
  },

  // ============ 编辑区顶部标签显示控制 ============
  // 编辑/预览/分栏 三个标签（.editor__tabs 内的 .editor__tab）
  // 仅在普通 Markdown 笔记下显示；预览导入的非 Markdown 文件时隐藏
  _setTabsVisibility(visible) {
    const tabs = document.querySelector('.editor__tabs');
    if (tabs) tabs.style.display = visible ? 'flex' : 'none';
  },

  // ============ 文件预览缩放控制 ============
  _bindZoomControls(container) {
    const htmlEl = container.querySelector('#file-preview-html');
    const label = container.querySelector('#zoom-label');
    if (!htmlEl || !label) return;

    const updateZoom = (level) => {
      this._currentZoom = Math.max(50, Math.min(200, level));
      htmlEl.style.fontSize = this._currentZoom + '%';
      label.textContent = this._currentZoom + '%';
    };

    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-zoom-action]');
      if (!btn) return;
      const action = btn.dataset.zoomAction;
      if (action === 'in') updateZoom(this._currentZoom + 10);
      else if (action === 'out') updateZoom(this._currentZoom - 10);
      else if (action === 'reset') updateZoom(100);
    });
  },

  // ============ Markdown 渲染 ============
  async renderMarkdown(content) {
    const preview = document.getElementById('markdown-preview');
    if (!preview) return;

    if (!content) {
      preview.innerHTML = '<p style="color: var(--text-tertiary);">预览区域</p>';
      return;
    }

    try {
      // 使用 marked 渲染，需要从主进程获取
      const rendered = await this.renderMarkdownWithMarked(content);
      preview.innerHTML = rendered;
    } catch (e) {
      preview.innerHTML = `<pre>${this.escapeHtml(content)}</pre>`;
    }
  },

  async renderMarkdownWithMarked(content) {
    if (window.marked) {
      return window.marked.parse(content);
    }
    // 简单渲染
    return content
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  },

  // ============ 新建笔记 ============
  async createNewNote() {
    this.hideReadonlyView();
    try {
      if (!window.electronAPI) {
        // 演示模式
        const demoId = 'demo-' + Date.now();
        this.state.notes.push({
          id: demoId, title: '新笔记', categoryId: 'default',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          tags: [], isFavorite: false, isDeleted: false, wordCount: 0
        });
        this.state.currentNoteId = demoId;
        this.renderNoteList();
        this.renderSidebar();
        const editor = document.getElementById('markdown-editor');
        if (editor) {
          editor.value = '# 新笔记\n\n';
          this.state.isDirty = false;
          this.updateStatusBar();
          this.renderMarkdown('# 新笔记\n\n');
        }
        return;
      }

      const title = await this.showPromptDialog('输入笔记标题：');
      if (title === null) return; // 用户取消
      const finalTitle = title || '无标题笔记';

      const note = await window.electronAPI.createNote({
        title: finalTitle,
        content: '',
        categoryId: this.state.currentCategory === 'all' || this.state.currentCategory === 'favorites' || this.state.currentCategory === 'recent' || this.state.currentCategory === 'trash' ? 'default' : this.state.currentCategory,
        template: null
      });

      this.state.notes.push(note);
      this.state.currentNoteId = note.id;
      this.renderNoteList();
      this.renderSidebar();
      const editor = document.getElementById('markdown-editor');
      if (editor) {
        editor.value = `# ${note.title}\n\n`;
        editor.focus();
        this.state.isDirty = false;
        this.updateStatusBar();
        this.renderMarkdown(`# ${note.title}\n\n`);
      }
    } catch (e) {
      console.error('Create note error:', e);
      this.showToast('创建笔记失败：' + e.message, 'error');
    }
  },

  // ============ 保存笔记 ============
  async saveNote() {
    if (!this.state.currentNoteId) return;
    const editor = document.getElementById('markdown-editor');
    if (!editor) return;

    const content = editor.value;
    if (window.electronAPI) {
      await window.electronAPI.updateNoteContent({ id: this.state.currentNoteId, content });
    }
    this.state.isDirty = false;
    this.updateStatusBar();
  },

  // ============ 分类选择 ============
  selectCategory(categoryId) {
    this.state.currentCategory = categoryId;
    this.state.currentNoteId = null;

    // 隐藏只读视图
    this.hideReadonlyView();

    // 清除批量选择
    this._batchSelected.clear();
    this._updateBatchUI();

    // 更新侧边栏高亮
    document.querySelectorAll('.nav-list__item').forEach(el => {
      el.classList.toggle('nav-list__item--active', el.dataset.category === categoryId);
    });

    // 显示/隐藏回收站清空按钮
    const emptyBtn = document.getElementById('btn-empty-recycle-bin');
    if (emptyBtn) {
      emptyBtn.style.display = categoryId === 'trash' ? 'inline-flex' : 'none';
    }

    this.renderNoteList();
  },

  // ============ 导入文件 ============
  async openImportDialog() {
    if (!window.electronAPI) {
      alert('导入功能需要启动 Electron 环境');
      return;
    }

    const result = await window.electronAPI.openFileDialog();
    if (result.canceled || !result.filePaths.length) return;

    // 将所选路径（单个文件 / 多个文件）展开为统一导入目标列表
    const items = await window.electronAPI.prepareImportTargets(result.filePaths);

    await this.performImport(items);
  },

  // 导入整个文件夹：先创建「文件夹名」分类（含子文件夹逐层建子分类），再把文件导入到对应分类
  async openImportFolderDialog() {
    if (!window.electronAPI) {
      alert('导入功能需要启动 Electron 环境');
      return;
    }
    const result = await window.electronAPI.openFolderDialog();
    if (result.canceled || !result.filePaths.length) return;

    const folderPath = result.filePaths[0];

    // 在「当前分类」下新建文件夹；若处于特殊视图则建在 default 下
    const parentCategoryId = this.state.currentCategory === 'all' || this.state.currentCategory === 'favorites' || this.state.currentCategory === 'recent' || this.state.currentCategory === 'trash' ? 'default' : this.state.currentCategory;

    // 显示导入进度（总数为扫描后由主进程回传）
    this.showImportProgress(null);

    const importResponse = await window.electronAPI.importFolder({ folderPath, parentCategoryId });

    this.hideImportProgress();

    // 刷新笔记列表与侧边栏（含新建的分类）
    await this.loadNotes();
    this.renderNoteList();
    this.renderSidebar();

    // 显示导入结果
    const results = (importResponse && importResponse.results) || [];
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    if (failCount > 0) {
      this.showToast(`导入完成：${successCount} 成功，${failCount} 失败`, 'warning');
    } else if (results.length > 0) {
      this.showToast(`成功导入 ${successCount} 个文件`, 'success');
    } else {
      this.showToast('该文件夹中没有可导入的文件（已创建文件夹）', 'success');
    }
  },

  // 共享的批量导入执行
  async performImport(items) {
    if (!window.electronAPI || !items || !items.length) {
      this.showToast('所选内容中没有可导入的文件', 'warning');
      return;
    }

    const categoryId = this.state.currentCategory === 'all' || this.state.currentCategory === 'favorites' || this.state.currentCategory === 'recent' || this.state.currentCategory === 'trash' ? 'default' : this.state.currentCategory;

    // 显示导入进度
    this.showImportProgress(items);

    const importResults = await window.electronAPI.batchImport({
      filePaths: items,
      categoryId: categoryId
    });

    this.hideImportProgress();

    // 刷新笔记列表
    await this.loadNotes();
    this.renderNoteList();
    this.renderSidebar();

    // 显示导入结果
    const successCount = importResults.filter(r => r.success).length;
    const failCount = importResults.filter(r => !r.success).length;
    if (failCount > 0) {
      this.showToast(`导入完成：${successCount} 成功，${failCount} 失败`, 'warning');
    } else {
      this.showToast(`成功导入 ${successCount} 个文件`, 'success');
    }
  },

  showImportProgress(files) {
    // 移除旧的进度条
    const old = document.getElementById('import-progress');
    if (old) old.remove();

    // files 传入 null（文件夹导入时总数为未知，由主进程扫描后回传）
    const knownTotal = files && typeof files.length === 'number';
    const total = knownTotal ? files.length : null;

    const div = document.createElement('div');
    div.id = 'import-progress';
    div.className = 'import-progress';
    div.innerHTML = `
      <div class="import-progress__content">
        <div class="import-progress__title">${total != null ? `正在导入 ${total} 个文件...` : '正在导入，请稍候...'}</div>
        <div class="import-progress__bar">
          <div class="import-progress__fill" id="import-progress-fill"></div>
        </div>
        <div class="import-progress__text" id="import-progress-text">${total != null ? `0 / ${total}` : '扫描中...'}</div>
      </div>
    `;
    document.body.appendChild(div);

    // 监听进度
    if (window.electronAPI) {
      window.electronAPI.onImportProgress((data) => {
        const fill = document.getElementById('import-progress-fill');
        const text = document.getElementById('import-progress-text');
        if (fill) fill.style.width = `${data.total > 0 ? (data.current / data.total) * 100 : 0}%`;
        if (text) text.textContent = `${data.current} / ${data.total}`;
      });
    }
  },

  hideImportProgress() {
    const div = document.getElementById('import-progress');
    if (div) {
      div.classList.add('import-progress--done');
      setTimeout(() => div.remove(), 500);
    }
  },

  // ============ Toast 提示 ============
  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('toast--show');
    }, 10);
    setTimeout(() => {
      toast.classList.remove('toast--show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  },

  // ============ 更新状态栏 ============
  updateStatusBar() {
    const editor = document.getElementById('markdown-editor');
    if (!editor) return;

    const content = editor.value;
    const words = content.replace(/\s/g, '').length;
    const lines = content.split('\n').length;
    const status = this.state.isDirty ? '未保存' : '已保存';

    const wordsEl = document.getElementById('status-words');
    const linesEl = document.getElementById('status-lines');
    const saveEl = document.getElementById('status-save');

    if (wordsEl) wordsEl.textContent = `字数：${words}`;
    if (linesEl) linesEl.textContent = `行数：${lines}`;
    if (saveEl) saveEl.textContent = status;
  },

  // ============ 事件绑定 ============
  bindEvents() {
    // === 方法1: 直接绑定（每个元素单独绑定） ===

    // 新建笔记按钮（stopPropagation 防止事件冒泡触发事件委托，避免重复创建弹窗）
    const newBtn = document.getElementById('btn-new-note');
    if (newBtn) newBtn.addEventListener('click', (e) => { e.stopPropagation(); this.createNewNote(); });

    // 搜索框
    const searchInput = document.getElementById('search-notes');
    if (searchInput) {
      let searchTimer;
      searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          this.state.searchQuery = searchInput.value;
          this.renderNoteList();
        }, 300);
      });
    }

    // 排序
    const sortSelect = document.getElementById('sort-select');
    if (sortSelect) {
      sortSelect.addEventListener('change', () => {
        this.state.currentSort = sortSelect.value;
        this.renderNoteList();
      });
    }

    // 编辑器输入
    const editor = document.getElementById('markdown-editor');
    if (editor) {
      editor.addEventListener('input', () => {
        this.state.isDirty = true;
        this.updateStatusBar();
        this.renderMarkdown(editor.value);
        this.startAutoSave();
      });
    }

    // 全局引用，供 HTML onkeydown 绑定使用
    window.__app = this;

    // 初始化搜索栏事件（一次绑定，无需重复）
    this._initFileSearch();

    // 监听主进程发来的搜索栏召唤命令（用于 PDF 等 iframe 内文件）
    if (window.electronAPI?.onShowSearchBar) {
      window.electronAPI.onShowSearchBar(() => {
        const readonly = document.getElementById('editor-readonly');
        if (readonly && readonly.style.display !== 'none') {
          const searchBar = document.getElementById('readonly-search-bar');
          const input = document.getElementById('search-input');
          if (searchBar && input) {
            searchBar.style.display = 'flex';
            input.value = '';
            input.focus();
            const count = document.getElementById('search-count');
            if (count) count.textContent = '';
            this._currentSearchText = '';
          }
        }
      });
    }

    // 保存按钮
    const saveBtn = document.getElementById('btn-save');
    if (saveBtn) saveBtn.addEventListener('click', () => this.saveNote());

    // 键盘快捷键 (Ctrl+S / Ctrl+N)
    // 注：Ctrl+F 由主进程 before-input-event 拦截后发 IPC 处理
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        e.stopPropagation();
        this.saveNote();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        e.stopPropagation();
        this.createNewNote();
        return;
      }
    }, true);

    // 视图切换按钮
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.view-btn').forEach(el => el.classList.remove('view-btn--active'));
        btn.classList.add('view-btn--active');
        this.state.currentView = btn.dataset.view;
        this.renderNoteList();
      });
    });

    // 编辑器Tab切换
    document.querySelectorAll('.editor__tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.editor__tab').forEach(el => el.classList.remove('editor__tab--active'));
        tab.classList.add('editor__tab--active');
        const pane = tab.dataset.pane;
        const editPane = document.getElementById('pane-edit');
        const previewPane = document.getElementById('pane-preview');
        const divider = document.getElementById('editor-divider');
        if (pane === 'edit') {
          editPane.style.flex = '1';
          previewPane.style.display = 'none';
          if (divider) divider.style.display = 'none';
        } else if (pane === 'preview') {
          editPane.style.display = 'none';
          previewPane.style.flex = '1';
          previewPane.style.display = 'flex';
          if (divider) divider.style.display = 'none';
        } else {
          editPane.style.display = 'flex';
          previewPane.style.display = 'flex';
          editPane.style.flex = '1';
          previewPane.style.flex = '1';
          if (divider) divider.style.display = 'block';
        }
      });
    });

    // 切换到指定面板（编辑/预览/分栏）
    this.switchToPane = function(pane) {
      const editPane = document.getElementById('pane-edit');
      const previewPane = document.getElementById('pane-preview');
      const divider = document.getElementById('editor-divider');
      const tabs = document.querySelectorAll('.editor__tab');
      if (!editPane || !previewPane) return;
      tabs.forEach(el => el.classList.remove('editor__tab--active'));
      tabs.forEach(el => {
        if (el.dataset.pane === pane) el.classList.add('editor__tab--active');
      });
      if (pane === 'edit') {
        editPane.style.display = 'flex';
        editPane.style.flex = '1';
        previewPane.style.display = 'none';
        if (divider) divider.style.display = 'none';
      } else if (pane === 'preview') {
        editPane.style.display = 'none';
        previewPane.style.flex = '1';
        previewPane.style.display = 'flex';
        if (divider) divider.style.display = 'none';
      } else {
        editPane.style.display = 'flex';
        editPane.style.flex = '1';
        previewPane.style.display = 'flex';
        previewPane.style.flex = '1';
        if (divider) divider.style.display = 'block';
      }
    };

    // 注：登录按钮事件已在 index.html 中通过内联脚本直接绑定，此处不再重复绑定

    // 浏览按钮（直接绑定，避免事件委托二次弹窗）
    const browseBtn = document.getElementById('btn-browse-notes-dir');
    if (browseBtn) {
      browseBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.browseNotesDir();
      });
    }

    // 设置弹窗关闭按钮（直接绑定，修复需要多次点击才关闭的问题）
    const settingsCloseBtn = document.getElementById('btn-settings-close');
    if (settingsCloseBtn) {
      settingsCloseBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.closeSettings();
      });
    }
    const settingsDoneBtn = document.getElementById('btn-settings-done');
    if (settingsDoneBtn) {
      settingsDoneBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.closeSettings();
      });
    }
  },

  // ============ 事件委托（兜底方案） ============
  setupEventDelegation() {
    // 幂等守卫：防止 init 被多次触发导致事件重复绑定
    // （重复绑定会让最大化按钮一次点击触发两次 maximize(un)maximize 相互抵消）
    if (App._delegationBound) return;
    App._delegationBound = true;

    // 侧边栏事件委托
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
      sidebar.addEventListener('click', (e) => {
        const target = e.target.closest('[id]');
        if (!target) return;
        const id = target.id;

        // 新建笔记
        if (id === 'btn-new-note') {
          e.preventDefault();
          this.createNewNote();
          return;
        }

        // 新建分类 - 如果当前选中有效分类则创建子分类
        if (id === 'btn-add-category') {
          e.preventDefault();
          const parentId = this.state.currentCategory;
          const isValidCategory = this.state.categories.some(c => c.id === parentId);
          this.createCategory(isValidCategory ? parentId : null);
          return;
        }

        // 导入文件
        if (id === 'btn-import') {
          e.preventDefault();
          this.openImportDialog();
          return;
        }

        // 导入文件夹（整体导入，含子文件夹，保留层级）
        if (id === 'btn-import-folder') {
          e.preventDefault();
          this.openImportFolderDialog();
          return;
        }

        // 切换主题
        if (id === 'theme-toggle') {
          e.preventDefault();
          const html = document.documentElement;
          const current = html.getAttribute('data-theme');
          const next = current === 'dark' ? 'light' : 'dark';
          html.setAttribute('data-theme', next);
          if (window.electronAPI) window.electronAPI.setTheme(next);
          this.state.config.theme = next;
          if (window.electronAPI) window.electronAPI.saveConfig(this.state.config);
          // 切换后更新 HTML 预览 iframe 的主题
          this._applyThemeToHtmlPreview();
          return;
        }

        // 设置
        if (id === 'btn-settings') {
          e.preventDefault();
          this.openSettings();
          return;
        }
      });
    }

    // 左侧导航栏事件委托（静态分类：我的笔记、收藏、最近打开、回收站）
    const navList = document.querySelector('.nav-list');
    if (navList) {
      navList.addEventListener('click', (e) => {
        const item = e.target.closest('.nav-list__item');
        if (!item) return;
        const category = item.dataset.category;
        if (category) {
          e.preventDefault();
          this.selectCategory(category);
        }
      });
    }

    // 窗口控制按钮事件委托
    const titlebar = document.querySelector('.titlebar');
    if (titlebar) {
      titlebar.addEventListener('click', (e) => {
        const target = e.target.closest('[id]');
        if (!target) return;
        const id = target.id;
        if (id === 'btn-minimize') { e.preventDefault(); window.electronAPI?.minimize(); }
        else if (id === 'btn-maximize') { e.preventDefault(); window.electronAPI?.maximize(); }
        else if (id === 'btn-close') { e.preventDefault(); window.electronAPI?.close(); }
        else if (id === 'btn-devtools') { e.preventDefault(); window.electronAPI?.toggleDevTools(); }
      });
    }

    // 设置弹窗事件委托
    const settingsModal = document.getElementById('settings-modal');
    if (settingsModal) {
      settingsModal.addEventListener('click', (e) => {
        const target = e.target.closest('[id]');
        if (!target) return;
        const id = target.id;
        if (id === 'btn-settings-close' || id === 'btn-settings-done') {
          e.preventDefault();
          this.closeSettings();
        } else if (id === 'btn-browse-notes-dir') {
          e.preventDefault();
          this.browseNotesDir();
        } else if (id === 'btn-save-notes-dir') {
          e.preventDefault();
          this.saveNotesDir();
        }
      });
    }

    // 编辑器区域事件委托
    const editor = document.getElementById('editor');
    if (editor) {
      editor.addEventListener('click', (e) => {
        const target = e.target.closest('[id]');
        if (!target) return;
        const id = target.id;
        if (id === 'btn-save') {
          e.preventDefault();
          this.saveNote();
        } else if (id === 'btn-open-original') {
          e.preventDefault();
          const btn = document.getElementById('btn-open-original');
          if (btn && btn._originalFile && window.electronAPI) {
            window.electronAPI.openOriginalFile(btn._originalFile);
          }
        } else if (id === 'btn-open-original-html') {
          e.preventDefault();
          const btn = document.getElementById('btn-open-original-html');
          if (btn && btn._originalFile && window.electronAPI) {
            window.electronAPI.openOriginalFile(btn._originalFile);
          }
        } else if (id === 'btn-download-file') {
          e.preventDefault();
          const btn = document.getElementById('btn-download-file');
          if (btn && btn._originalFile && window.electronAPI) {
            window.electronAPI.downloadImportedFile(btn._originalFile).then(result => {
              if (result && result.success) {
                this.showToast('文件下载成功', 'success');
              } else if (result && result.error && result.error !== '已取消') {
                this.showToast('下载失败：' + result.error, 'error');
              }
            });
          }
        }
      });
    }

    // 工具栏事件委托（清空回收站、批量删除、全选）
    const toolbar = document.getElementById('toolbar-actions');
    if (toolbar) {
      toolbar.addEventListener('click', (e) => {
        const target = e.target.closest('[id]');
        if (!target) return;
        if (target.id === 'btn-empty-recycle-bin') {
          e.preventDefault();
          this.clearRecycleBin();
        } else if (target.id === 'btn-batch-delete') {
          e.preventDefault();
          this.batchDelete();
        }
      });

      // 全选复选框
      const selectAll = document.getElementById('select-all-checkbox');
      if (selectAll) {
        selectAll.addEventListener('change', (e) => {
          const notes = this.getFilteredNotes();
          if (e.target.checked) {
            notes.forEach(n => this._batchSelected.add(n.id));
          } else {
            this._batchSelected.clear();
          }
          this._updateBatchUI();
          this.renderNoteList();
        });
      }
    }
  },

  // ============ 可拖拽分割线 ============
  initResizeDivider() {
    const divider = document.getElementById('resize-divider');
    const noteList = document.getElementById('note-list');
    if (!divider || !noteList) return;

    let isDragging = false;

    divider.addEventListener('mousedown', (e) => {
      isDragging = true;
      divider.classList.add('resize-divider--active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const layout = document.querySelector('.layout');
      if (!layout) return;
      const layoutRect = layout.getBoundingClientRect();
      let newWidth = e.clientX - layoutRect.left;
      // 限制在 min/max 范围内
      newWidth = Math.max(200, Math.min(500, newWidth));
      noteList.style.width = newWidth + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        divider.classList.remove('resize-divider--active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });

    // 编辑器分栏分割线拖拽
    this.initEditorDivider();
  },

  initEditorDivider() {
    const divider = document.getElementById('editor-divider');
    const editPane = document.getElementById('pane-edit');
    const previewPane = document.getElementById('pane-preview');
    if (!divider || !editPane || !previewPane) return;

    let isDragging = false;
    let startX = 0;
    let startEditFlex = 0;
    let startPreviewFlex = 0;

    divider.addEventListener('mousedown', (e) => {
      if (divider.style.display === 'none') return;
      isDragging = true;
      startX = e.clientX;
      // 记录当前 flex 值
      startEditFlex = parseFloat(editPane.style.flex) || 1;
      startPreviewFlex = parseFloat(previewPane.style.flex) || 1;
      divider.classList.add('editor__divider--active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const editor = document.querySelector('.editor__panes');
      if (!editor) return;
      const editorRect = editor.getBoundingClientRect();
      const totalWidth = editorRect.width;
      if (totalWidth <= 0) return;

      const offset = e.clientX - startX;
      // 通过 flex 比例调整，offset 相对于总宽度
      const flexDelta = offset / totalWidth * (startEditFlex + startPreviewFlex);

      let newEditFlex = Math.max(0.2, Math.min(5, startEditFlex + flexDelta));
      let newPreviewFlex = Math.max(0.2, Math.min(5, startPreviewFlex - flexDelta));

      editPane.style.flex = newEditFlex;
      previewPane.style.flex = newPreviewFlex;
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        divider.classList.remove('editor__divider--active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });
  },

  // ============ 设置弹窗 ============
  openSettings() {
    const modal = document.getElementById('settings-modal');
    if (!modal) return;
    modal.classList.add('modal-overlay--open');
    this.loadSettingsInfo();
  },

  closeSettings() {
    const modal = document.getElementById('settings-modal');
    if (modal) modal.classList.remove('modal-overlay--open');
  },

  async loadSettingsInfo() {
    if (!window.electronAPI) return;
    const dir = await window.electronAPI.getNotesDir();
    const inputEl = document.getElementById('settings-notes-dir-input');
    const pathEl = document.getElementById('settings-notes-dir');
    if (inputEl) inputEl.value = dir;
    if (pathEl) pathEl.textContent = dir;
  },

  async browseNotesDir() {
    // 防止重复调用
    if (this._browsing) return;
    this._browsing = true;
    try {
      if (!window.electronAPI) return;
      const result = await window.electronAPI.openFolderDialog();
      if (result.canceled || !result.filePaths.length) return;
      const newDir = result.filePaths[0];
      if (!newDir) return;

      const inputEl = document.getElementById('settings-notes-dir-input');
      if (inputEl) inputEl.value = newDir;

      const btn = document.getElementById('btn-save-notes-dir');
      if (btn) { btn.textContent = '保存中...'; btn.disabled = true; }
      try {
        const migrateResult = await window.electronAPI.changeNotesDir(newDir);
        if (migrateResult.success) {
          this.showToast('笔记目录已更改', 'success');
          await this.loadSettingsInfo();
          await this.loadNotes();
          this.renderNoteList();
          this.renderSidebar();
        } else {
          this.showToast('更改失败：' + (migrateResult.error || '未知错误'), 'error');
        }
      } catch (e) {
        this.showToast('更改失败：' + e.message, 'error');
      } finally {
        if (btn) { btn.textContent = '保存'; btn.disabled = false; }
      }
    } finally {
      this._browsing = false;
    }
  },

  async saveNotesDir() {
    if (!window.electronAPI) return;
    const inputEl = document.getElementById('settings-notes-dir-input');
    if (!inputEl) return;
    const newDir = inputEl.value.trim();
    if (!newDir) {
      this.showToast('请输入有效的路径', 'error');
      return;
    }

    const btn = document.getElementById('btn-save-notes-dir');
    if (btn) { btn.textContent = '保存中...'; btn.disabled = true; }

    try {
      const migrateResult = await window.electronAPI.changeNotesDir(newDir);
      if (migrateResult.success) {
        this.showToast(`笔记目录已更改`, 'success');
        await this.loadSettingsInfo();
        await this.loadNotes();
        this.renderNoteList();
        this.renderSidebar();
      } else {
        this.showToast(`更改失败：${migrateResult.error || '未知错误'}`, 'error');
      }
    } catch (e) {
      this.showToast(`更改失败：${e.message}`, 'error');
    } finally {
      if (btn) { btn.textContent = '保存'; btn.disabled = false; }
    }
  },

  // ============ 清空回收站 ============
  async clearRecycleBin() {
    if (!window.electronAPI) return;
    if (!confirm('确定要清空回收站吗？\n\n回收站中的所有笔记将被永久删除，此操作不可恢复。')) return;

    try {
      await window.electronAPI.emptyRecycleBin();
      await this.loadNotes();
      this.renderNoteList();
      this.renderSidebar();
      this.showToast('回收站已清空', 'success');
    } catch (e) {
      this.showToast(`清空失败：${e.message}`, 'error');
    }
  },

  // ============ 批量删除 ============
  async batchDelete() {
    if (this._batchSelected.size === 0) return;
    const count = this._batchSelected.size;
    const isTrash = this.state.currentCategory === 'trash';
    const msg = isTrash
      ? `确定要永久删除选中的 ${count} 条笔记吗？\n\n此操作不可恢复。`
      : `确定要将选中的 ${count} 条笔记移到回收站吗？`;
    if (!confirm(msg)) return;

    if (!window.electronAPI) return;
    const ids = Array.from(this._batchSelected);
    try {
      if (isTrash) {
        for (const id of ids) {
          await window.electronAPI.deleteNote({ id, permanent: true });
        }
      } else {
        for (const id of ids) {
          await window.electronAPI.deleteNote({ id, permanent: false });
        }
      }
      this._batchSelected.clear();
      this._updateBatchUI();
      await this.loadNotes();
      this.renderNoteList();
      this.renderSidebar();
      this.showToast(`已${isTrash ? '永久删除' : '删除'} ${count} 条笔记`, 'success');
    } catch (e) {
      this.showToast(`批量删除失败：${e.message}`, 'error');
    }
  },

  // ============ 更新批量操作 UI ============
  _updateBatchUI() {
    const count = this._batchSelected.size;
    const batchDeleteBtn = document.getElementById('btn-batch-delete');
    const selectAllLabel = document.getElementById('batch-select-label');
    const selectAllCheckbox = document.getElementById('select-all-checkbox');
    const container = document.getElementById('cards-container');

    if (count > 0) {
      if (batchDeleteBtn) {
        batchDeleteBtn.style.display = 'inline-flex';
        batchDeleteBtn.querySelector('span').textContent = `删除选中 (${count})`;
      }
      if (selectAllLabel) selectAllLabel.style.display = 'inline-flex';
      if (container) container.classList.add('note-list--batch-mode');
    } else {
      if (batchDeleteBtn) batchDeleteBtn.style.display = 'none';
      if (selectAllLabel) {
        selectAllLabel.style.display = 'none';
        if (selectAllCheckbox) selectAllCheckbox.checked = false;
      }
      if (container) container.classList.remove('note-list--batch-mode');
    }

    // 点击非批量区域时清除选择
    if (count === 0 && selectAllLabel) selectAllLabel.style.display = 'none';
  },

  // ============ 更新 HTML 预览 iframe 主题 ============
  _applyThemeToHtmlPreview() {
    const iframe = document.getElementById('html-preview-iframe');
    if (!iframe) return;
    try {
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      if (!doc) return;
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      // 移除旧样式
      const oldStyle = doc.getElementById('html-preview-theme');
      if (oldStyle) oldStyle.remove();
      if (isDark) {
        const style = doc.createElement('style');
        style.id = 'html-preview-theme';
        style.textContent = `
          body {
            background: #1e1e1e !important;
            color: #d4d4d4 !important;
          }
          a { color: #60cdff !important; }
          a:visited { color: #c58aff !important; }
          code, pre {
            background: #2d2d2d !important;
            color: #d4d4d4 !important;
          }
          th, td {
            border-color: #555 !important;
          }
        `;
        doc.head.appendChild(style);
      }
    } catch (e) {
      // 跨域或其它异常，静默忽略
    }
  },

  // ============ 文件搜索（查找/跳转） ============
  _searchInFile(text, backward = false, findNext = false) {
    if (!text) return;
    this._currentSearchText = text;

    // PDF：使用 PDF.js 文本层搜索（应用内自绘渲染）
    if (this._currentPreviewType === 'pdf') {
      console.log('[PDF搜索] _searchInFile called:', { text, backward, findNext, time: Date.now() });
      const sc = document.getElementById('search-count');
      if (sc) sc.textContent = '搜索中...';
      if (window.PDFPreview && text) {
        window.PDFPreview.find(text, !backward).then((r) => {
          if (!r || !r.matches) {
            if (sc) sc.textContent = '未找到';
            return;
          }
          if (sc) sc.textContent = `${r.current}/${r.matches}`;
        });
      } else {
        if (sc) sc.textContent = '未找到';
      }
      return;
    }

    // HTML / Word / Excel：使用 iframe.contentWindow.find() 或 window.find()
    const previewEl = document.getElementById('readonly-preview');
    if (!previewEl) return;
    const iframe = previewEl.querySelector('iframe');
    if (iframe) {
      try {
        const win = iframe.contentWindow;
        if (win && typeof win.find === 'function') {
          win.find(text, false, backward, true, false, true, false);
          return;
        }
      } catch (_) { /* 忽略 */ }
    }
    // 搜索父文档（Word/Excel HTML 预览）
    try {
      window.find(text, false, backward, true, false, true, false);
    } catch (_) { /* 忽略 */ }
  },

  _initFileSearch() {
    const searchInput = document.getElementById('search-input');
    const searchPrev = document.getElementById('search-prev');
    const searchNext = document.getElementById('search-next');
    const searchClose = document.getElementById('search-close');
    const searchCount = document.getElementById('search-count');

    if (!searchInput) return;

    // 注册 found-in-page IPC 回调（用于 PDF 搜索结果显示）
    if (window.electronAPI?.onFoundInPage) {
      window.electronAPI.removeFoundInPage();
      window.electronAPI.onFoundInPage((result) => {
        console.log('[PDF搜索] found-in-page received:', { matches: result.matches, activeMatchOrdinal: result.activeMatchOrdinal, finalUpdate: result.finalUpdate, time: Date.now() });
        const sc = document.getElementById('search-count');
        if (!sc) return;
        // 仅在 finalUpdate=true 时清理进度计时器
        if (result.finalUpdate) {
          if (this._searchTimeout) {
            clearTimeout(this._searchTimeout);
            this._searchTimeout = null;
          }
          if (this._searchProgressTimer) {
            clearInterval(this._searchProgressTimer);
            this._searchProgressTimer = null;
          }
        }
        if (result.matches === 0) {
          sc.textContent = '未找到';
        } else if (result.matches > 0) {
          sc.textContent = `${result.activeMatchOrdinal}/${result.matches}`;
        }
      });
    }

    // 输入时实时搜索（仅非 PDF 文件）
    searchInput.addEventListener('input', () => {
      this._currentSearchText = searchInput.value;
      if (!searchInput.value) {
        if (searchCount) searchCount.textContent = '';
        if (window.electronAPI?.stopFindInPage) window.electronAPI.stopFindInPage();
        return;
      }
      if (this._currentPreviewType === 'pdf') {
        // PDF 文件仅在按下 Enter 后搜索，避免输入过程中频繁调用 findInPage
        searchCount.textContent = '';
        return;
      }
      this._searchInFile(searchInput.value, false, false);
      searchCount.textContent = '已定位';
    });

    // 全局函数供 HTML onkeydown 调用（解决事件绑定失效问题）
    window.__searchKeydown = (e) => {
      const app = window.__app;
      const searchInput = document.getElementById('search-input');
      const searchBar = document.getElementById('readonly-search-bar');
      if (!app || !searchInput || !searchBar || searchBar.style.display === 'none') return;
      if (e.key === 'Enter') {
        e.preventDefault();
        console.log('[PDF搜索] Enter pressed, _currentPreviewType:', app._currentPreviewType, 'text:', searchInput.value);
        // 防抖：防止快速连续按 Enter 导致 PDF 查看器卡死
        const now = Date.now();
        if (app._lastSearchTime && now - app._lastSearchTime < 800) return false;
        app._lastSearchTime = now;
        // 显示搜索状态，确认 Enter 被触发
        const sc = document.getElementById('search-count');
        if (sc) sc.textContent = '搜索中...';
        // 首次搜索使用 findNext:true（PDF 查看器需要 findNext:true 才能正确建立搜索会话）
        app._searchInFile(searchInput.value, e.shiftKey, true);
        return false;
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        // 搜索框内上下键：在匹配结果中跳转（PDF 与普通查看器共用 _searchInFile）
        if (app._currentPreviewType === 'pdf' && window.PDFPreview) {
          e.preventDefault();
          if (!app._currentSearchText) return false;
          app._searchInFile(app._currentSearchText, e.key === 'ArrowUp', true);
          return false;
        }
      } else if (e.key === 'Escape') {
        searchInput.value = '';
        app._currentSearchText = '';
        const sc = document.getElementById('search-count');
        if (sc) sc.textContent = '';
        searchInput.blur();
        if (app._searchProgressTimer) {
          clearInterval(app._searchProgressTimer);
          app._searchProgressTimer = null;
        }
        if (app._searchTimeout) {
          clearTimeout(app._searchTimeout);
          app._searchTimeout = null;
        }
        app._lastSearchTime = 0;
        if (window.electronAPI?.stopFindInPage) window.electronAPI.stopFindInPage();
        return false;
      }
    };

    // 单独处理上一个下一个按钮（PDF 也走 findInPage）
    // 上一个 / 下一个（导航使用 findNext:true 在已有搜索会话中跳转）
    if (searchPrev) {
      searchPrev.addEventListener('click', () => {
        // 防抖：防止快速连续点击导致 PDF 查看器卡死
        const now = Date.now();
        if (this._lastSearchTime && now - this._lastSearchTime < 800) return;
        this._lastSearchTime = now;
        this._searchInFile(searchInput.value, true, true);
      });
    }
    if (searchNext) {
      searchNext.addEventListener('click', () => {
        // 防抖：防止快速连续点击导致 PDF 查看器卡死
        const now = Date.now();
        if (this._lastSearchTime && now - this._lastSearchTime < 800) return;
        this._lastSearchTime = now;
        this._searchInFile(searchInput.value, false, true);
      });
    }

    // 关闭
    if (searchClose) {
      searchClose.addEventListener('click', () => {
        searchInput.value = '';
        this._currentSearchText = '';
        if (searchCount) searchCount.textContent = '';
        searchInput.blur();
        if (this._searchProgressTimer) {
          clearInterval(this._searchProgressTimer);
          this._searchProgressTimer = null;
        }
        if (this._searchTimeout) {
          clearTimeout(this._searchTimeout);
          this._searchTimeout = null;
        }
        this._lastSearchTime = 0;
        if (window.electronAPI?.stopFindInPage) window.electronAPI.stopFindInPage();
        const searchBar = document.getElementById('readonly-search-bar');
        if (searchBar) searchBar.style.display = 'none';
      });
    }
  },

  // ============ 新建分类 ============
  async createCategory(parentId = null) {
    const name = await this.showPromptDialog('输入分类名称：');
    if (!name || !name.trim()) return;
    try {
      if (window.electronAPI) {
        const cat = await window.electronAPI.addCategory({ name: name.trim(), parentId });
        this.state.categories.push(cat);
        // 自动展开父分类
        if (parentId) this.state.expandedCategories.add(parentId);
        this.renderSidebar();
        this.selectCategory(cat.id);
        this.showToast(`分类「${name}」已创建`, 'success');
      }
    } catch (e) {
      this.showToast(`创建失败：${e.message}`, 'error');
    }
  },

  // ============ 监听主进程事件 ============
  listenToMainProcess() {
    if (!window.electronAPI) return;

    window.electronAPI.onNewNote(() => {
      this.createNewNote();
    });

    window.electronAPI.onOpenImport(() => {
      this.openImportDialog();
    });

    window.electronAPI.onWindowStateChanged((isMaximized) => {
      const btn = document.getElementById('btn-maximize');
      if (btn) {
        btn.innerHTML = isMaximized
          ? '<svg width="10" height="10" viewBox="0 0 10 10"><rect x="2" y="2" width="6" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>'
          : '<svg width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';
      }
    });

    window.electronAPI.onNotesDirChanged((newDir) => {
      // 笔记目录已更改，刷新数据
      this.loadNotes();
      this.renderNoteList();
      this.renderSidebar();
      this.showToast(`笔记目录已更新：${newDir}`, 'info');
    });
  },

  // ============ 自动保存 ============
  startAutoSave() {
    if (this.state.autoSaveTimer) clearTimeout(this.state.autoSaveTimer);
    this.state.autoSaveTimer = setTimeout(() => {
      if (this.state.isDirty) this.saveNote();
    }, this.state.config.autoSaveInterval || 30000);
  },

  // ============ 笔记本右键菜单 ============
  showNoteContextMenu(e, note) {
    e.preventDefault();
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';

    const items = [
      { label: '打开', icon: '📖', action: () => this.openNote(note.id) },
      { label: note.isFavorite ? '取消收藏' : '收藏', icon: note.isFavorite ? '⭐' : '☆', action: async () => {
        if (window.electronAPI) {
          note.isFavorite = await window.electronAPI.toggleFavorite(note.id);
          this.renderNoteList();
          this.renderSidebar();
        }
      }},
      { type: 'separator' },
      { label: '下载', icon: '⬇️', action: () => this.downloadNote(note) },
      { label: '重命名', icon: '✏️', action: () => this.renameNote(note) },
      { label: '移动至', icon: '📂', action: () => this.moveNote(note) },
      { type: 'separator' },
      { label: note.isDeleted ? '恢复' : '删除', icon: note.isDeleted ? '♻️' : '🗑️', action: async () => {
        if (note.isDeleted) {
          if (window.electronAPI) await window.electronAPI.restoreNote(note.id);
        } else {
          if (window.electronAPI) await window.electronAPI.deleteNote({ id: note.id, permanent: false });
        }
        await this.loadNotes();
        this.renderNoteList();
        this.renderSidebar();
      }}
    ];

    items.forEach(item => {
      if (item.type === 'separator') {
        const hr = document.createElement('div');
        hr.className = 'context-menu__separator';
        menu.appendChild(hr);
      } else {
        const div = document.createElement('div');
        div.className = 'context-menu__item';
        div.innerHTML = `<span>${item.icon}</span> ${item.label}`;
        div.addEventListener('click', () => {
          item.action();
          menu.remove();
        });
        menu.appendChild(div);
      }
    });

    document.body.appendChild(menu);

    // 点击其他地方关闭
    const closeMenu = (e2) => {
      if (!menu.contains(e2.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  },

  // ============ 下载笔记 ============
  async downloadNote(note) {
    if (!window.electronAPI) return;
    try {
      if (note.originalFile) {
        // 导入的文件
        const result = await window.electronAPI.downloadImportedFile(note.originalFile);
        if (result && result.success) {
          this.showToast('文件下载成功', 'success');
        } else if (result && result.error && result.error !== '已取消') {
          this.showToast('下载失败：' + result.error, 'error');
        }
      } else {
        // 普通 markdown 笔记
        const result = await window.electronAPI.exportNote({ id: note.id });
        if (result && result.success) {
          this.showToast('笔记下载成功', 'success');
        } else if (result && result.error && result.error !== '已取消') {
          this.showToast('下载失败：' + result.error, 'error');
        }
      }
    } catch (e) {
      this.showToast('下载失败：' + e.message, 'error');
    }
  },

  showCategoryContextMenu(e, category) {
    e.preventDefault();
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';

    const items = [
      { label: '新建子分类', icon: '📂', action: () => this.createCategory(category.id) },
      { label: '重命名', icon: '✏️', action: () => this.renameCategory(category) },
      { label: '删除分类', icon: '🗑️', action: async () => {
        if (window.electronAPI) {
          await window.electronAPI.deleteCategory(category.id);
          await this.loadNotes();
          this.renderSidebar();
          this.selectCategory('all');
        }
      }}
    ];

    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'context-menu__item';
      div.innerHTML = `<span>${item.icon}</span> ${item.label}`;
      div.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        item.action();
        menu.remove();
      });
      menu.appendChild(div);
    });

    document.body.appendChild(menu);
    setTimeout(() => {
      const closeMenu = (e2) => {
        if (!menu.contains(e2.target)) {
          menu.remove();
          document.removeEventListener('click', closeMenu);
        }
      };
      document.addEventListener('click', closeMenu);
    }, 0);
  },

  async renameNote(note) {
    const newTitle = await this.showPromptDialog('输入新标题：', note.title);
    if (newTitle && newTitle !== note.title) {
      note.title = newTitle;
      if (window.electronAPI) {
        // 持久化标题到元数据
        await window.electronAPI.renameNote({ id: note.id, title: newTitle });
        const content = await window.electronAPI.getNoteContent(note.id);
        // 更新标题在第一行
        const lines = content.split('\n');
        if (lines[0].startsWith('# ')) {
          lines[0] = `# ${newTitle}`;
          await window.electronAPI.updateNoteContent({ id: note.id, content: lines.join('\n') });
        }
      }
      this.renderNoteList();
    }
  },

  async renameCategory(category) {
    const newName = await this.showPromptDialog('输入新名称：', category.name);
    if (newName && newName !== category.name) {
      if (window.electronAPI) {
        await window.electronAPI.renameCategory({ id: category.id, name: newName });
        await this.loadNotes();
        this.renderSidebar();
      }
    }
  },

  async moveNote(note) {
    const categories = this.state.categories;
    const catNames = categories.map(c => c.name).join('\n');
    const choice = await this.showPromptDialog(`选择目标分类（输入分类名称）：\n${catNames}`, categories.find(c => c.id === note.categoryId)?.name || '');
    if (choice) {
      const target = categories.find(c => c.name === choice);
      if (target && window.electronAPI) {
        await window.electronAPI.moveNoteCategory({ noteId: note.id, categoryId: target.id });
        note.categoryId = target.id;
        this.renderNoteList();
      }
    }
  },

  // ============ 工具函数 ============
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  // 返回展示用标题：无原始文件的 Markdown 笔记后缀 .md，导入文件保留其真实扩展名
  _displayTitle(note) {
    if (!note.originalFile && note.title && !/\.(md|[A-Za-z0-9]{1,6})$/i.test(note.title.trim())) {
      return note.title + '.md';
    }
    return note.title;
  },

  // ============ 自定义输入弹窗（替代 prompt） ============
  showPromptDialog(title, defaultValue = '') {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'prompt-overlay';

      const dialog = document.createElement('div');
      dialog.className = 'prompt-dialog';

      dialog.innerHTML = `
        <div class="prompt-dialog__header">${this.escapeHtml(title)}</div>
        <div class="prompt-dialog__body">
          <input class="prompt-dialog__input" type="text" value="${this.escapeHtml(defaultValue)}" autofocus>
        </div>
        <div class="prompt-dialog__footer">
          <button class="prompt-dialog__btn prompt-dialog__btn--cancel">取消</button>
          <button class="prompt-dialog__btn prompt-dialog__btn--confirm">确定</button>
        </div>
      `;

      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      const input = dialog.querySelector('.prompt-dialog__input');
      const confirmBtn = dialog.querySelector('.prompt-dialog__btn--confirm');
      const cancelBtn = dialog.querySelector('.prompt-dialog__btn--cancel');

      // 选中全部文字
      input.select();

      function close(result) {
        overlay.remove();
        resolve(result);
      }

      confirmBtn.addEventListener('click', () => close(input.value));
      cancelBtn.addEventListener('click', () => close(null));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') close(input.value); if (e.key === 'Escape') close(null); });
    });
  }
};

// ============ 启动应用 ============
// 直接调用 init()，不依赖 DOMContentLoaded 事件
// 因为 app.js 加载在 HTML 末尾，DOM 已就绪
App.init();
