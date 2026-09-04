<div align="center">
  <img src="assets/icon.svg" alt="青竹笔记" width="100" height="100">
  <h1>青竹笔记</h1>
  <p>轻量级可视化笔记软件 · 基于 Electron 构建</p>
  <p>
    <a href="#-功能特性">功能特性</a> ·
    <a href="#-快速开始">快速开始</a> ·
    <a href="#-开发指南">开发指南</a> ·
    <a href="#-打包构建">打包构建</a> ·
    <a href="#-技术栈">技术栈</a>
  </p>
</div>

---

## 📖 简介

青竹笔记是一款轻量级的桌面笔记软件，采用 Windows 11 设计风格，支持分类管理、Markdown 编辑、文件导入预览等功能。支持在 Windows 10 和 Windows 11 系统上运行。

## ✨ 功能特性

- **笔记管理** — 支持创建、编辑、删除笔记，按分类组织管理
- **分类系统** — 支持无限层级树形分类，可拖拽整理
- **Markdown 编辑** — 支持 Markdown 语法编辑和实时预览
- **文件导入与预览** — 支持导入 PDF、Word（DOCX）、Excel（XLSX）、图片等文件，并在应用内直接预览
  - **PDF 预览** — 使用 Chromium 内置 PDF 查看器直接渲染
  - **Word 预览** — 通过 Mammoth 将 DOCX 转换为 HTML 渲染
  - **Excel 预览** — 支持多 Sheet 切换，保留合并单元格、列宽、字体颜色等样式
  - **大文件保护** — 超过 50MB 的 Excel 文件自动提示无法预览
- **文件下载** — 支持将笔记和导入文件下载到本地
- **回收站** — 删除的笔记进入回收站，支持恢复和清空
- **搜索功能** — 支持按标题和内容搜索笔记
- **深色模式** — 跟随系统主题，支持亮色/暗色模式切换
- **用户系统** — 支持多账号登录和注册，密码使用 SHA-256 加密存储
- **笔记目录自定义** — 支持自定义笔记存储路径
- **自动保存** — 编辑笔记时自动保存，防止内容丢失

## 🚀 快速开始

### 下载安装包

从 [Releases](../../releases) 页面下载最新的安装包 `青竹笔记 Setup 1.0.0.exe`，双击运行即可安装。

### 从源码运行

#### 前提条件

- [Node.js](https://nodejs.org/) >= 18
- npm >= 8

#### 安装与运行

```bash
# 克隆仓库
git clone https://github.com/your-username/qingzhu-notes.git
cd qingzhu-notes

# 安装依赖
npm install

# 下载 Electron 二进制文件（国内网络推荐使用 npmmirror 镜像）
npx electron --version

# 启动开发模式
npm start
```

## 🛠️ 开发指南

### 项目结构

```
qingzhu-notes/
├── main.js                # Electron 主进程
├── preload.js             # 预加载脚本（暴露 IPC 接口）
├── package.json           # 项目配置
├── excel-worker.js        # Excel 处理工作线程
├── installer.nsh          # NSIS 安装脚本
├── assets/                # 图标资源
│   ├── icon.png
│   └── icon.svg
├── renderer/              # 渲染进程
│   ├── index.html         # 主页面
│   ├── styles/
│   │   └── win11.css      # 样式文件
│   └── js/
│       └── app.js         # 渲染进程逻辑
├── scripts/               # 辅助脚本
│   ├── convert-docx-to-pdf.ps1
│   └── convert-xlsx-to-pdf.ps1
└── build-installer.bat    # 构建脚本
```

### 核心依赖

| 依赖 | 用途 |
|------|------|
| [Electron](https://www.electronjs.org/) | 桌面应用框架 |
| [marked](https://marked.js.org/) | Markdown 渲染 |
| [mammoth](https://github.com/mwilliamson/mammoth.js) | DOCX 转 HTML |
| [xlsx](https://sheetjs.com/) | Excel 解析与渲染 |
| [pdf-parse](https://github.com/nicklaustrup/pdf-parse) | PDF 文本提取 |
| [electron-builder](https://www.electron.build/) | 应用打包构建 |

## 📦 打包构建

```bash
# 仅打包目录（不生成安装包）
npm run pack

# 生成 Windows 安装包
npm run dist:win

# 生成全部平台安装包
npm run dist
```

构建产物位于 `release/` 目录。

> **注意**：构建过程中需要下载 Electron 二进制文件，国内网络建议配置镜像：
> ```bash
> npm config set registry https://registry.npmmirror.com
> ```

## 💡 使用说明

1. **首次使用**：启动应用后点击"注册新账号"，输入用户名和密码完成注册
2. **创建笔记**：选择分类后点击"新建笔记"，输入标题和内容
3. **导入文件**：点击"导入"按钮，选择 PDF、Word、Excel 或图片文件
4. **管理分类**：右键点击分类可新建子分类或删除分类
5. **回收站**：删除的笔记可在回收站中恢复或永久删除

## 🔧 技术栈

- **前端**：HTML5 + CSS3 + Vanilla JavaScript
- **后端**：Node.js + Electron
- **存储**：本地文件系统（JSON 元数据 + Markdown 文件）
- **认证**：SHA-256 密码哈希

## 📄 许可证

本项目基于 [MIT License](LICENSE) 开源。