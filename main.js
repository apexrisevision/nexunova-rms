const { app, BrowserWindow, Menu, shell, ipcMain, Tray, nativeImage, session } = require('electron');
const path = require('path');

const PROTOCOL = 'nexunovarms';

let mainWindow, splashWindow, tray;
let _pendingAuthUrl = null;

// ── Check if launched via deep link when app was NOT already running ──
// On Windows/Linux the OS passes the URL as a command-line argument.
const _startupUrl = process.argv.slice(1).find(a => a.startsWith(PROTOCOL + '://'));
if (_startupUrl) _pendingAuthUrl = _startupUrl;

// ── Single-instance lock — required so deep-link clicks route to the ──
// existing window via second-instance, not a second app instance.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

// Windows/Linux: second instance launched (e.g. user clicked deep link
// while app was already open) — focus existing window and dispatch URL.
app.on('second-instance', (event, argv) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
  const url = argv.find(a => a.startsWith(PROTOCOL + '://'));
  if (url) dispatchAuthUrl(url);
});

// macOS: system delivers the URL via this event instead of argv.
app.on('open-url', (event, url) => {
  event.preventDefault();
  dispatchAuthUrl(url);
});

// ── Send auth URL to renderer (queues if window not ready yet) ────────
function dispatchAuthUrl(url) {
  if (!url) return;
  if (!mainWindow || mainWindow.isDestroyed()) {
    _pendingAuthUrl = url;
    return;
  }
  mainWindow.webContents.send('auth-deep-link', url);
  _pendingAuthUrl = null;
}

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 280,
    height: 310,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    center: true,
    skipTaskbar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  splashWindow.loadFile('splash.html');
}

function createMain() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    icon: path.join(__dirname, 'build', 'icon.png'),
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      preload: path.join(__dirname, 'electron', 'preload-titlebar.js'),
    },
    show: false,
    title: 'Nexunova RMS',
    backgroundColor: '#08091a',
  });

  mainWindow.loadFile('login.html');
  Menu.setApplicationMenu(null);

  mainWindow.once('ready-to-show', () => {
    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
        splashWindow = null;
      }
      mainWindow.maximize();
      mainWindow.show();
    }, 1400);
  });

  // After page scripts load, dispatch any pending deep-link auth URL.
  // 800ms buffer ensures forgot-password.js has registered its listener.
  mainWindow.webContents.once('did-finish-load', () => {
    if (_pendingAuthUrl) {
      const url = _pendingAuthUrl;
      _pendingAuthUrl = null;
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('auth-deep-link', url);
        }
      }, 800);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // about:blank is used by print popup windows — let Electron handle it
    if (!url || url === 'about:blank') return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('maximize', () => mainWindow.webContents.send('window-state', 'maximized'));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-state', 'normal'));
  mainWindow.on('enter-full-screen', () => mainWindow.webContents.send('window-state', 'maximized'));
  mainWindow.on('leave-full-screen', () => mainWindow.webContents.send('window-state', 'normal'));
}

function createTray() {
  try {
    const iconPath = path.join(__dirname, 'build', 'icon.png');
    // Use full resolution — Windows scales tray icons itself; don't force 16x16
    const trayIconPath = path.join(__dirname, 'build', 'tray-icon.png');
    const icon = nativeImage.createFromPath(trayIconPath);
    tray = new Tray(icon);
    tray.setToolTip('Nexunova RMS');
    tray.on('click', () => {
      if (mainWindow) {
        mainWindow.isVisible() ? mainWindow.focus() : mainWindow.show();
      }
    });
  } catch (e) {}
}

ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.restore() : mainWindow.maximize();
});
ipcMain.on('window-close', () => mainWindow?.close());

ipcMain.on('print-doc', (event, { html, title }) => {
  const printWin = new BrowserWindow({
    width: 900, height: 950,
    title: title || 'Document',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  const encoded = Buffer.from(html, 'utf8').toString('base64');
  printWin.loadURL('data:text/html;base64,' + encoded);
  printWin.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      printWin.webContents.print({ silent: false, printBackground: true }, (success) => {
        if (success) setTimeout(() => printWin.close(), 300);
      });
    }, 600);
  });
});

app.whenReady().then(async () => {
  // Register nexunovarms:// as a handled URL scheme.
  // IMPORTANT: also add nexunovarms://auth/callback to Supabase dashboard →
  //   Authentication → URL Configuration → Redirect URLs
  app.setAsDefaultProtocolClient(PROTOCOL);

  // Clear disk cache so updated CSS/JS files are always read fresh (file:// ignores query-string busters)
  await session.defaultSession.clearCache();

  createSplash();
  createMain();
  createTray();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMain();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
