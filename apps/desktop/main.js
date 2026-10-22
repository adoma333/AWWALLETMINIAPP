// Zohra Wallet for Windows and macOS: a desktop window around the web app on your server, so the interface is always
// the latest version. Links to Telegram, explorers and Google sign-in open in the system browser; the camera is only
// granted to our own pages (identity scan); a newer desktop build published by GitHub Actions is offered on start.
const { app, BrowserWindow, Menu, dialog, ipcMain, screen, session, shell } = require('electron');
const fs = require('fs');
const path = require('path');

let CFG = {};
try { CFG = require('./config.json'); } catch { /* dev run */ }
const SERVER = String(CFG.server || process.env.ZOHRA_SERVER || 'https://example.com').replace(/\/+$/, '');
const ORIGIN = new URL(SERVER).origin;
const PLATFORM = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? (process.arch === 'arm64' ? 'mac_arm' : 'mac_x64') : 'linux';

if (!app.requestSingleInstanceLock()) app.quit();
let win = null;
const stateFile = () => path.join(app.getPath('userData'), 'window.json');

function safeOpen(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || u.protocol === 'tg:' || u.protocol === 'mailto:') shell.openExternal(u.toString());
  } catch { /* ignore malformed links */ }
}

function createWindow() {
  let saved = null;
  try { saved = JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { /* first run */ }
  const area = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: saved?.width || Math.min(1280, Math.round(area.width * 0.85)),
    height: saved?.height || Math.min(860, Math.round(area.height * 0.9)),
    x: saved?.x, y: saved?.y, minWidth: 380, minHeight: 600,
    show: false, backgroundColor: '#000000', title: 'Zohra Wallet', autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.webContents.setUserAgent(`${win.webContents.getUserAgent()} ZohraApp/${process.platform === 'darwin' ? 'mac' : 'windows'} ZohraVersion/${app.getVersion()}`);
  win.once('ready-to-show', () => (saved?.maximized ? win.maximize() : win.show()));
  win.on('close', () => {
    try { fs.writeFileSync(stateFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() })); } catch { /* read-only profile */ }
  });

  // stay on our origin; everything else goes to the system browser
  win.webContents.setWindowOpenHandler(({ url }) => { safeOpen(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    if (new URL(url).origin !== ORIGIN || new URL(url).pathname.startsWith('/dl/')) { e.preventDefault(); safeOpen(url); }
  });
  win.webContents.on('did-fail-load', (_e, code, _d, url, isMain) => {
    if (isMain && code !== -3) win.loadFile(path.join(__dirname, 'offline.html'));
  });
  win.loadURL(`${SERVER}/`);
}

ipcMain.on('open-external', (_e, url) => safeOpen(url));
ipcMain.on('version', (e) => { e.returnValue = app.getVersion(); });
ipcMain.on('retry', () => win?.loadURL(`${SERVER}/`));

async function checkUpdate() {
  try {
    const r = await fetch(`${SERVER}/api/releases/latest`);
    const m = await r.json();
    const f = m.files?.[PLATFORM];
    const n = (v) => String(v || '0').split('.').reduce((a, x) => a * 1000 + (parseInt(x, 10) || 0), 0);
    if (!f || n(f.version) <= n(app.getVersion())) return;
    const { response } = await dialog.showMessageBox(win, { type: 'info', buttons: ['Download', 'Later'], defaultId: 0, cancelId: 1,
      title: 'Zohra Wallet', message: `Zohra Wallet ${f.version} is available`, detail: 'The download opens in your browser.' });
    if (response === 0) safeOpen(`${SERVER}${f.url}`);
  } catch { /* offline */ }
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
app.whenReady().then(() => {
  // camera / microphone only for our own pages (identity verification); nothing else
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) => {
    const ok = new URL(details.requestingUrl || wc.getURL()).origin === ORIGIN && ['media', 'clipboard-sanitized-write', 'notifications'].includes(perm);
    cb(ok);
  });
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]));
  } else {
    Menu.setApplicationMenu(null);
  }
  createWindow();
  setTimeout(checkUpdate, 4000);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
