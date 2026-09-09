const { app, BrowserWindow, nativeTheme } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'light';
  const w = new BrowserWindow({ width: 900, height: 700, show: true, webPreferences: { webviewTag: true, contextIsolation: true } });
  let guest = null;
  w.webContents.on('did-attach-webview', (e, wc) => { guest = wc; guest.on('did-finish-load', () => console.log('guest did-finish-load', guest.getURL().slice(0,70))); });

  const host = 'file:///' + path.resolve('host.html').replace(/\\/g, '/');
  await w.loadURL(host);
  const absPdf = 'file:///' + path.resolve('sample.pdf').replace(/\\/g, '/');
  await w.webContents.executeJavaScript(`document.getElementById('v').setAttribute('src','${absPdf}') || true`);
  await new Promise(r => setTimeout(r, 2500));

  const readBg = async (label) => {
    if (!guest) { console.log(label, 'no guest'); return; }
    try {
      const bg = await guest.executeJavaScript('getComputedStyle(document.body).backgroundColor');
      const dark = await guest.executeJavaScript('matchMedia("(prefers-color-scheme: dark)").matches');
      console.log(label, '| prefersDark=', dark, '| bodyBg=', bg);
    } catch (e) { console.log(label, 'ERR', e.message.split('\n')[0]); }
  };

  await readBg('[light] 初始加载');
  nativeTheme.themeSource = 'dark';
  await new Promise(r => setTimeout(r, 1500));
  await readBg('[dark] 切主题(不重载)');
  if (guest) guest.reload();
  await new Promise(r => setTimeout(r, 2200));
  await readBg('[dark] reload 之后');
  app.exit(0);
}).catch(e => { console.log('FATAL', e.message); app.exit(1); });