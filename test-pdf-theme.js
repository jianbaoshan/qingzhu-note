const { app, BrowserWindow, nativeTheme } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark';
  console.log('themeSource=dark, nativeTheme.shouldUseDarkColors=', nativeTheme.shouldUseDarkColors);

  const w = new BrowserWindow({ width: 900, height: 700, show: true });
  const url = 'file:///' + path.resolve('sample.pdf').replace(/\\/g, '/');
  await w.loadURL(url);

  await new Promise(r => setTimeout(r, 1500));

  // 尝试在 PDF viewer 页面上下文读取配色，即使 document 是 embed 渲染，执行受限也要看结果
  let res1, res2;
  try {
    res1 = await w.webContents.executeJavaScript('matchMedia("(prefers-color-scheme: dark)").matches');
  } catch (e) { res1 = 'ERR:' + e.message.split('\n')[0]; }

  try {
    res2 = await w.webContents.executeJavaScript('({bodyBg: document.body ? getComputedStyle(document.body).backgroundColor : "no-body", loc: location.href.slice(0,60)})');
  } catch (e) { res2 = 'ERR:' + e.message.split('\n')[0]; }

  console.log('PDF page prefers-color-scheme:dark =', res1);
  console.log('PDF page info =', JSON.stringify(res2));
  console.log('PDF webContents URL =', w.webContents.getURL().slice(0, 80));
  app.exit(0);
}).catch(e => { console.log('FATAL', e.message); app.exit(1); });