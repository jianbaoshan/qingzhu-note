/* =====================================================
 * PDFPreview - 基于 PDF.js 的 PDF 预览渲染模块
 * - Canvas + 文本层渲染（分页连续滚动）
 * - 搜索高亮与定位（Ctrl+F 复用应用搜索栏）
 * - 主题跟随：页面/高亮使用 ETH酒 应用 data-theme 的 CSS 变量
 * ===================================================== */
(function () {
  'use strict';

  const PDFJS = window.pdfjsLib;

  // 设置 worker（相对 index.html 的路径）
  if (PDFJS && PDFJS.GlobalWorkerOptions) {
    PDFJS.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
  }

  // ============ 分页渲染 ============
  // 在只读预览容器内创建 PDF 滚动视图，逐页渲染 canvas + 文本层
  // theme：当前应用主题（'light' / 'dark'），用于调整页面呈现宽度/外观

  // 文本层渲染（PDF.js legacy build 提供的标准工具）
  const renderTextLayer = (() => {
    // pdfjs-dist 的 legacy build 在 pdfjsLib 上暴露 renderTextLayer
    return function renderTextLayerFn(opts) {
      if (typeof PDFJS.renderTextLayer === 'function') {
        return PDFJS.renderTextLayer(opts);
      }
      // 兼容回退：手动生成 span
      const { textContent, container, viewport } = opts;
      const textDivs = [];
      const textContentItemsStr = [];
      for (const item of textContent.items) {
        const tx = viewport.transform;
        const str = item.str || '';
        const span = document.createElement('span');
        span.textContent = str;
        span.dataset.hasTextContent = String(true);
        const a = tx[0], b = tx[1], c = tx[2], d = tx[3];
        const x = tx[4] + (item.transform ? item.transform[4] : 0);
        const y = tx[5] + (item.transform ? item.transform[5] : 0);
        span.style.transform = `translate(${x}px, ${y}px)`;
        span.style.transformOrigin = '0 0';
        container.appendChild(span);
        textDivs.push(span);
        textContentItemsStr.push(str);
      }
      const update = () => {};
      const cancel = () => {};
      return { textDivs, textContentItemsStr, update, cancel };
    };
  })();

  class PDFPreview {
    constructor() {
      this.pdf = null;
      this.container = null;   // readonly-preview 宿主
      this.scrollEl = null;    // 滚动容器
      this.pages = [];         // 渲染完成的页码
      this.scale = 1;
      this._searchState = { text: '', matches: [], current: 0 };
      this._base = null;
      this._renderToken = 0;
      // 全局串行渲染链：同一时刻只允许一次 canvas 渲染，避免并发 render 同一 canvas
      this._chain = Promise.resolve();
      this._zoomAccum = 1;
      this._zoomRaf = null;
    }

    // 载入并渲染 PDF，data 为 ArrayBuffer
    async render(container, data, opts = {}) {
      if (!container) return;
      this.destroy();
      const token = ++this._renderToken;
      this.container = container;
      this._base = opts.base || 1;

      // 创建滚动容器（flex:1 由 CSS 控制填充高度）
      this.scrollEl = document.createElement('div');
      this.scrollEl.className = 'pdfjs-scroller';
      container.appendChild(this.scrollEl);

      // 判断本代次渲染是否仍有效（被新 render / destroy 取代时取消）
      const isStale = () => token !== this._renderToken;

      try {
        const loadingTask = PDFJS.getDocument({ data, cMapUrl: 'vendor/pdfjs/cmaps/', cMapPacked: true });
        // 主题时用较亮的渲染背景（canvas 页面自身保持内容）
        this.pdf = await loadingTask.promise;
        if (isStale()) return;
        const pagesEl = document.createElement('div');
        pagesEl.className = 'pdfjs-pages';
        this.scrollEl.appendChild(pagesEl);

        const numPages = this.pdf.numPages;
        // 初始scale：适配容器宽度
        const first = await this.pdf.getPage(1);
        const vp1 = first.getViewport({ scale: 1 });
        const containerWidth = container.clientWidth || 800;
        const fitScale = (containerWidth - 32) / vp1.width;
        this.scale = Math.min(2.5, Math.max(0.5, fitScale));

        // 懒加载定高：先为所有页建好 DOM 骨架并按真实尺寸定高，
        // 保证滚动区总高度正确；真正的 canvas 渲染/文本层延后到靠近视口时再做
        // （page 对象较“轻”，全量持有没问题，重的是 render + getTextContent）
        for (let i = 1; i <= numPages; i++) {
          if (isStale()) return;
          const info = this._createPageWrapper(i, pagesEl);
          try {
            const page = await this.pdf.getPage(i);
            const viewport = page.getViewport({ scale: this.scale });
            info.page = page;
            info.viewport = viewport;
            // PDF.js 3.x 的文本层用该 CSS 变量做定位/缩放，必须与 viewport.scale 一致
            info.textLayer.style.setProperty('--scale-factor', String(viewport.scale));
            info.canvas.width = Math.floor(viewport.width * (window.devicePixelRatio || 1));
            info.canvas.height = Math.floor(viewport.height * (window.devicePixelRatio || 1));
            info.canvas.style.width = viewport.width + 'px';
            info.canvas.style.height = viewport.height + 'px';
            info.wrap.style.width = viewport.width + 'px';
            info.wrap.style.height = viewport.height + 'px';
          } catch (pageErr) {
            if (isStale()) return;
            console.error(`[PDFPreview] 第 ${i} 页初始化失败:`, pageErr);
          }
        }
        first && first.cleanup && first.cleanup();

        // 滚动区底部留白
        pagesEl.style.paddingBottom = '24px';
        this.scrollEl.scrollTop = 0;

        // 滚动监听（rAF 节流）：只渲染视口附近（含上下一屏）的未渲染页
        this._rafPending = false;
        this._onScroll = () => {
          if (this._rafPending) return;
          this._rafPending = true;
          requestAnimationFrame(() => {
            this._rafPending = false;
            this._scheduleLazyRender(isStale);
          });
        };
        this.scrollEl.addEventListener('scroll', this._onScroll, { passive: true });

        // Ctrl/⌘ + 滚轮缩放
        this._onWheel = (e) => {
          if (!e.ctrlKey && !e.metaKey) return; // 普通滚动交给浏览器
          e.preventDefault();
          const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
          this.zoom(factor);
        };
        this.scrollEl.addEventListener('wheel', this._onWheel, { passive: false });

        this._scheduleLazyRender(isStale);
      } catch (err) {
        if (err && err.name === 'RenderingCancelledException') return;
        console.error('[PDFPreview] 加载失败:', err);
        this.scrollEl.innerHTML = `<div class="file-preview-error">PDF 预览失败：${(err && err.message) || err}</div>`;
      }
    }

    // 缩放：累积倍率经 rAF 合并结算，避免滚轮风暴触发过多重绘
    zoom(factor) {
      if (!this.pdf || !this.scrollEl) return;
      this._zoomAccum *= factor;
      if (this._zoomRaf) return;
      this._zoomRaf = requestAnimationFrame(() => {
        this._zoomRaf = null;
        const newScale = Math.min(4, Math.max(0.5, this.scale * this._zoomAccum));
        this._zoomAccum = 1;
        if (newScale === this.scale) return;
        // 记录缩放前的滚动比例，缩放后按比例恢复，避免位置跳动
        const sc = this.scrollEl;
        const ratio = sc.scrollHeight ? sc.scrollTop / (sc.scrollHeight - sc.clientHeight || 1) : 0;
        this.scale = newScale;
        const dpr = window.devicePixelRatio || 1;
        for (let i = 0; i < this.pages.length; i++) {
          const info = this.pages[i];
          if (!info || !info.page) continue;
          const viewport = info.page.getViewport({ scale: newScale });
          info.viewport = viewport;
          // 只更新布局尺寸（供滚动条/懒渲染定位），不触碰 canvas 的 GPU 缓冲，
          // 避免对全部页面强制重建缓冲导致 GPU 缓冲风暴/黑屏闪烁
          info.wrap.style.width = viewport.width + 'px';
          info.wrap.style.height = viewport.height + 'px';
          info.textLayer.style.setProperty('--scale-factor', String(viewport.scale));
          info.rendered = false;           // 交由懒渲染按需重绘（仅视口内页面真正 render）
        }
        sc.scrollTop = ratio * (sc.scrollHeight - sc.clientHeight || 1);
        this._scheduleLazyRender(() => this._zoomRaf !== null); // 缩放过程中不再重入
      });
    }

    // 建单个页面骨架（不渲染），并登记索引信息
    _createPageWrapper(index, pagesEl) {
      const pageWrap = document.createElement('div');
      pageWrap.className = 'pdfjs-page';
      const canvas = document.createElement('canvas');
      canvas.className = 'pdfjs-canvas';
      const textLayer = document.createElement('div');
      textLayer.className = 'pdfjs-text-layer';
      pageWrap.appendChild(canvas);
      pageWrap.appendChild(textLayer);
      pagesEl.appendChild(pageWrap);
      const info = { index, wrap: pageWrap, canvas, textLayer, page: null, viewport: null, rendered: false };
      this.pages[index - 1] = info;
      return info;
    }

    // 扫描视口附近一屏范围内尚未渲染的页面并触发按需渲染
    _scheduleLazyRender(isStale) {
      if (!this.scrollEl || !this.pages.length) return;
      const scroller = this.scrollEl;
      const top = scroller.scrollTop;
      const bottom = top + scroller.clientHeight;
      // 上下各多算一屏（约等于一页高度）作为预取窗口
      const lookahead = scroller.clientHeight || 800;
      for (let i = 0; i < this.pages.length; i++) {
        const info = this.pages[i];
        if (!info || info.rendered || !info.page || !info.viewport || !info.wrap) continue;
        const pageTop = info.wrap.offsetTop;
        const pageBottom = pageTop + info.wrap.offsetHeight;
        if ((pageBottom >= top - lookahead) && (pageTop <= bottom + lookahead)) {
          this._queuePageRender(info, isStale);
        }
      }
    }

    // 页面渲染入队：所有页面共享一条串行链，保证同一 canvas 不会被并发 render
    _queuePageRender(info, isStale) {
      info.rendered = true; // 先置位，同一页只入队一次
      this._chain = this._chain.then(() => this._renderPageOnDemand(info, isStale)).catch(() => {});
    }

    // 按需渲染单个页面：canvas + 文本层
    async _renderPageOnDemand(info, isStale) {
      // 队列执行时，若页面已随缩放代次失效则跳过
      if (isStale() || !info || !this.pages[info.index - 1]) return;
      if (!info) return;
      const page = info.page;
      // 取当前最新 viewport（缩放可能在此期间更新）
      const viewport = info.viewport;
      if (!page || !viewport) { info.rendered = false; return; }
      const canvas = info.canvas;
      const textLayer = info.textLayer;
      const dpr = window.devicePixelRatio || 1;
      // 若队列执行时尺寸已与最新 viewport 不符，则重置为本页应画的尺寸
      if (canvas.width !== Math.floor(viewport.width * dpr)) {
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = viewport.width + 'px';
        canvas.style.height = viewport.height + 'px';
        textLayer.style.setProperty('--scale-factor', String(viewport.scale));
      }
      const ctx = canvas.getContext('2d');
      try {
        await page.render({
          canvasContext: ctx,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null
        }).promise;
        if (isStale() || this.pages[info.index - 1] !== info) return;
        // 缩放期间再次变动：标记未渲染，交由懒渲染按最新 viewport 重画
        if (viewport !== info.viewport) { info.rendered = false; return; }
        // 文本层：用于搜索
        const textContent = await page.getTextContent();
        if (isStale() || this.pages[info.index - 1] !== info || viewport !== info.viewport) { info.rendered = false; return; }
        renderTextLayer({
          textContentSource: textContent,
          container: textLayer,
          viewport,
          textDivs: [],
          textContentItemsStr: [],
          isOffscreenCanvasSupported: true,
          enhanceTextSelection: true
        });
        page.cleanup && page.cleanup();
      } catch (pageErr) {
        // 取消（重入/切换）静默终止；其余单页失败仅记录，不影响整体
        if (isStale() || (pageErr && pageErr.name === 'RenderingCancelledException')) {
          info.rendered = false;
          return;
        }
        info.rendered = false;
        console.error(`[PDFPreview] 第 ${(info.index || 0) + 1} 页渲染失败:`, pageErr);
      }
    }

    // ============ 搜索 ============
    // 在整个 PDF 文本内容中查找 text，返回 { matches, current }（1-based）
    async _collectTextMap() {
      const map = []; // { page: pageObj, text }
      try {
        for (let i = 1; i <= this.pdf.numPages; i++) {
          const page = await this.pdf.getPage(i);
          const tc = await page.getTextContent();
          let text = '';
          for (const item of tc.items) text += (item.str || '') + ' ';
          map.push({ pageNum: i, text });
          page.cleanup && page.cleanup();
        }
      } catch (e) {
        console.error('[PDFPreview] 提取文本失败:', e);
      }
      return map;
    }

    // text: 搜索词；forward: true=向下 false=向上（相对当前）
    // 返回 { matches: 总数, current: 当前位置(1-based) }
    async find(text, forward = true) {
      const st = this._searchState;
      if (!text) { this.clearFind(); return { matches: 0, current: 0 }; }

      const normText = text.toLowerCase();
      // 缓存已就绪：直接在当前态上导航（方向键高频场景），无需重建索引
      if (this._textCache && this._textCache.query === normText) {
        this._navigate(forward);
        return { matches: st.matches, current: st.current };
      }

      // 缓存未建立：用互斥链串行化，避免首次构建 57 页索引被重复触发/堆积
      const op = (async () => {
        if (this._textCache && this._textCache.query === normText) {
          this._navigate(forward);
          return { matches: st.matches, current: st.current };
        }
        const pageTexts = await this._collectTextMap();
        let full = '', pageIdx = [], charToPage = [], pageLen = [];
        for (let p = 0; p < pageTexts.length; p++) {
          const t = pageTexts[p].text.toLowerCase();
          const start = full.length;
          full += t;
          for (let c = start; c < full.length; c++) charToPage.push(p);
          pageIdx.push({ name: 'PDF', text: t, start, end: full.length });
          pageLen.push(t.length);
        }
        // 找出所有匹配区间，记录每个匹配在所在页内的相对 y 位置（按字符行占比估算）
        const matches = [];
        let idx = full.indexOf(normText);
        while (idx !== -1) {
          const p = charToPage[idx];
          const rel = (idx - pageIdx[p].start) / (pageLen[p] || 1); // 0..1
          matches.push({ start: idx, end: idx + normText.length, page: p, rel });
          idx = full.indexOf(normText, idx + 1);
        }
        this._textCache = { query: normText, full, pageIdx, charToPage, pageLen, matches };
        st.matches = matches.length;
        st.current = matches.length ? (forward ? 1 : matches.length) : 0;
        this._navigate(forward);
        return { matches: st.matches, current: st.current };
      })();
      // 排队：并发调用时串行等待前一个完成
      this._findChain = (this._findChain || Promise.resolve()).then(() => op).catch(() => {});
      return this._findChain;
    }

    // 在当前匹配态上移动并定位（循环）
    _navigate(forward) {
      const st = this._searchState;
      if (st.matches) {
        if (forward) st.current = st.current < st.matches ? st.current + 1 : 1;
        else st.current = st.current > 1 ? st.current - 1 : st.matches || 1;
      } else {
        st.current = 0;
      }
      this._highlight(this._textCache, st);
    }

    // 定位到当前匹配所在页内位置并滚动（不修改文本层 DOM，避免破坏渲染）
    _highlight(cache, st) {
      if (!st.matches) { this._updateCount(0, 0); return; }

      const match = cache.matches[st.current - 1];
      const pageWraps = this.scrollEl.querySelectorAll('.pdfjs-page');
      const target = pageWraps[match.page];
      if (target) {
        // 页内偏移：按字符占比估算匹配在该页正文中的竖直位置
        const rel = match.rel || 0;
        const within = rel * target.offsetHeight;
        this.scrollEl.scrollTop = target.offsetTop + within - this.scrollEl.clientHeight / 2;
        target.classList.add('pdfjs-page--search-target');
        setTimeout(() => target.classList.remove('pdfjs-page--search-target'), 1500);
      }
      this._updateCount(st.matches, st.current);
    }

    _updateCount(matches, current) {
      const sc = document.getElementById('search-count');
      if (!sc) return;
      if (!matches) sc.textContent = '未找到';
      else sc.textContent = `${current}/${matches}`;
    }

    clearFind() {
      this._searchState = { text: '', matches: [], current: 0 };
      const sc = document.getElementById('search-count');
      if (sc) sc.textContent = '';
    }

    destroy() {
      // 递增代次，令进行中的渲染在下一个检查点自行终止
      ++this._renderToken;
      if (this.pdf && typeof this.pdf.destroy === 'function') {
        try { this.pdf.destroy(); } catch (e) { /* ignore */ }
      }
      this.pdf = null;
      if (this.scrollEl) {
        if (this._onScroll) this.scrollEl.removeEventListener('scroll', this._onScroll);
        if (this._onWheel) this.scrollEl.removeEventListener('wheel', this._onWheel);
        if (this.container && this.container.contains(this.scrollEl)) {
          this.container.removeChild(this.scrollEl);
        }
      }
      this._onScroll = null;
      this._onWheel = null;
      this.scrollEl = null;
      this.container = null;
      this.pages = [];
      this._textCache = null;
      this._findChain = null;
      this._searchState = { text: '', matches: [], current: 0 };
    }

    // 主题切换时刷新页面边界阴影/背景（内容不变，仅容器外观由 CSS 控制）
    applyTheme() {
      // 外观样式全部走 CSS 变量，此处无需额外逻辑
    }
  }

  // 单例挂在 window，供 app.js 调用
  window.PDFPreview = new PDFPreview();
})();