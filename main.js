const { app, BrowserWindow, Menu, shell, ipcMain, Tray, nativeImage, session } = require('electron');
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

const PROTOCOL = 'nexunovarms';
const APP_ROOT = path.resolve(__dirname);
const REPORTS_ROOT = path.join(APP_ROOT, 'reports');
const SUPABASE_STORAGE_ORIGIN = 'https://itqxljtfbrppntgyfush.supabase.co';
const PAYMENT_SCREENSHOT_PATH_PREFIX = '/storage/v1/object/public/payment-screenshots/';

// Security control: only local packaged RMS files may be used for top-level
// navigation in the current launch build. Hosted RMS links may still open
// externally below, but must not replace the local Electron app shell.
const APPROVED_RMS_ORIGINS = new Set([
  'file://',
]);

// Security control: window.open/external-link handling is intentionally narrower
// than normal web navigation. These are the trusted business/support destinations
// currently linked by the RMS shell.
const TRUSTED_EXTERNAL_ORIGINS = new Set([
  'https://rms.nexunova.com',
  'https://www.nexunova.com',
  'https://nexunova.com',
  'https://crm.nexunova.com',
  'https://wa.me',
]);

const TRUSTED_EXTERNAL_PROTOCOLS = new Set([
  'https:',
  'mailto:',
]);

const ALLOWED_LOCAL_POPUP_FILES = new Set([
  path.join(APP_ROOT, 'terms.html'),
  path.join(APP_ROOT, 'privacy.html'),
]);

let mainWindow, splashWindow, tray;
let _pendingAuthUrl = null;
const STARTUP_LOG = path.join(app.getPath('appData'), 'nexunova-rms-startup.log');

// Startup lifecycle control: avoid fatal GPU-process exits on Windows systems
// where Chromium cannot initialize the packaged GPU stack.
app.disableHardwareAcceleration();

function logStartup(message) {
  try {
    fs.appendFileSync(STARTUP_LOG, `[${new Date().toISOString()}] ${message}\n`);
  } catch (e) {}
}

function isLocalAppFileUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:') return false;
    const resolvedPath = path.resolve(fileURLToPath(parsed));
    return resolvedPath === APP_ROOT || resolvedPath.startsWith(APP_ROOT + path.sep);
  } catch (e) {
    return false;
  }
}

function isAllowedLocalPopupUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:') return false;

    const resolvedPath = path.resolve(fileURLToPath(parsed));
    if (ALLOWED_LOCAL_POPUP_FILES.has(resolvedPath)) return true;

    // Security control: local report popups are limited to direct HTML files
    // inside APP_ROOT/reports. This restores report windows without allowing
    // arbitrary file:// popups or path traversal outside the application.
    return path.dirname(resolvedPath) === REPORTS_ROOT && path.extname(resolvedPath).toLowerCase() === '.html';
  } catch (e) {
    return false;
  }
}

function isAllowedPaymentScreenshotPreviewUrl(url) {
  try {
    const parsed = new URL(url);
    // Security control: payment screenshot previews may leave Electron only for
    // the known Supabase project and the payment-screenshots public bucket path.
    return parsed.protocol === 'https:' &&
      parsed.origin === SUPABASE_STORAGE_ORIGIN &&
      parsed.pathname.startsWith(PAYMENT_SCREENSHOT_PATH_PREFIX);
  } catch (e) {
    return false;
  }
}

function isAllowedRmsNavigationUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'file:') return APPROVED_RMS_ORIGINS.has('file://') && isLocalAppFileUrl(url);
    return APPROVED_RMS_ORIGINS.has(parsed.origin);
  } catch (e) {
    return false;
  }
}

function isTrustedExternalUrl(url) {
  try {
    const parsed = new URL(url);
    if (!TRUSTED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) return false;
    if (parsed.protocol === 'mailto:') return true;
    return TRUSTED_EXTERNAL_ORIGINS.has(parsed.origin);
  } catch (e) {
    return false;
  }
}

function installSessionSecurityControls() {
  // Security control: default-deny runtime permissions. The launcher does not
  // need camera, microphone, geolocation, notifications, MIDI, or similar APIs.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(false);
  });
}

function installNavigationProtection(win) {
  // Security control: keep the main frame on the packaged RMS files today, or
  // the approved hosted RMS origin later. Unexpected top-level navigations are
  // blocked so links cannot replace the trusted app UI with arbitrary content.
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedRmsNavigationUrl(url)) {
      event.preventDefault();
    }
  });

  // Security control: redirects can happen without a user click. Apply the same
  // allowlist before Electron commits a top-level navigation.
  win.webContents.on('will-redirect', (event, url) => {
    if (!isAllowedRmsNavigationUrl(url)) {
      event.preventDefault();
    }
  });
}

// ── Check if launched via deep link when app was NOT already running ──
// On Windows/Linux the OS passes the URL as a command-line argument.
const _startupUrl = process.argv.slice(1).find(a => a.startsWith(PROTOCOL + '://'));
if (_startupUrl) _pendingAuthUrl = _startupUrl;
logStartup(`process start argv=${JSON.stringify(process.argv)} userData=${app.getPath('userData')}`);

// ── Single-instance lock — required so deep-link clicks route to the ──
// existing window via second-instance, not a second app instance.
const gotLock = app.requestSingleInstanceLock();
logStartup(`single instance lock=${gotLock}`);
if (!gotLock) {
  logStartup('quitting: single instance lock unavailable');
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
  logStartup('createSplash');
  splashWindow = new BrowserWindow({
    width: 280,
    height: 310,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    center: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Security control: sandbox this simple splash renderer because it does
      // not require Node.js or privileged Electron renderer capabilities.
      sandbox: true,
    },
  });
  splashWindow.on('closed', () => logStartup('splash closed'));
  splashWindow.webContents.on('did-fail-load', (event, code, desc, url) => logStartup(`splash did-fail-load code=${code} desc=${desc} url=${url}`));
  splashWindow.webContents.on('render-process-gone', (event, details) => logStartup(`splash render-process-gone ${JSON.stringify(details)}`));
  splashWindow.loadFile('splash.html').then(() => logStartup('splash load ok')).catch(e => logStartup(`splash load error ${e.message}`));
}

function createMain() {
  logStartup('createMain');
  const iconPath = path.join(__dirname, 'build', 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Security control: keep Chromium web security enabled so same-origin,
      // mixed-content, and other browser protections remain active.
      webSecurity: true,
      // Security control: run the RMS renderer in Chromium's sandbox while the
      // preload exposes only the existing narrow contextBridge APIs.
      sandbox: true,
      preload: path.join(__dirname, 'electron', 'preload-titlebar.js'),
    },
    show: false,
    title: 'Nexunova RMS',
    backgroundColor: '#08091a',
  });

  mainWindow.on('closed', () => logStartup('main closed'));
  mainWindow.webContents.on('did-fail-load', (event, code, desc, url) => logStartup(`main did-fail-load code=${code} desc=${desc} url=${url}`));
  mainWindow.webContents.on('render-process-gone', (event, details) => logStartup(`main render-process-gone ${JSON.stringify(details)}`));
  mainWindow.loadFile('login.html').then(() => logStartup('main load ok')).catch(e => logStartup(`main load error ${e.message}`));
  installNavigationProtection(mainWindow);
  Menu.setApplicationMenu(null);

  mainWindow.once('ready-to-show', () => {
    logStartup('main ready-to-show');
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
    // about:blank is used by print popup windows - let Electron handle it.
    if (!url || url === 'about:blank') return { action: 'allow' };
    // Security control: allow only the local popup documents the RMS already
    // depends on: direct report HTML files plus terms/privacy.
    if (isAllowedLocalPopupUrl(url)) return { action: 'allow' };
    // Security control: external links leave Electron only when the protocol
    // and destination origin are explicitly trusted.
    if (isTrustedExternalUrl(url) || isAllowedPaymentScreenshotPreviewUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('maximize', () => mainWindow.webContents.send('window-state', 'maximized'));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-state', 'normal'));
  mainWindow.on('enter-full-screen', () => mainWindow.webContents.send('window-state', 'maximized'));
  mainWindow.on('leave-full-screen', () => mainWindow.webContents.send('window-state', 'normal'));
}

function createTray() {
  try {
    // Use full resolution — Windows scales tray icons itself; don't force 16x16
    const trayIconPath = path.join(__dirname, 'build', 'tray-icon.png');
    if (!fs.existsSync(trayIconPath)) return;
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
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Security control: printed documents do not need Node.js or privileged
      // renderer capabilities, so keep this temporary window sandboxed too.
      sandbox: true,
    },
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
  logStartup('app ready');
  // Register nexunovarms:// as a handled URL scheme.
  // IMPORTANT: also add nexunovarms://auth/callback to Supabase dashboard →
  //   Authentication → URL Configuration → Redirect URLs
  app.setAsDefaultProtocolClient(PROTOCOL);

  // Clear disk cache so updated CSS/JS files are always read fresh (file:// ignores query-string busters)
  await session.defaultSession.clearCache();
  logStartup('cache cleared');
  installSessionSecurityControls();

  createSplash();
  createMain();
  createTray();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMain();
  });
});

app.on('window-all-closed', () => {
  logStartup('window-all-closed');
  if (process.platform !== 'darwin') app.quit();
});
