const { ipcRenderer, contextBridge } = require('electron');

contextBridge.exposeInMainWorld('electronWindow', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close:    () => ipcRenderer.send('window-close'),
  onStateChange: (cb) => ipcRenderer.on('window-state', (_, state) => cb(state)),
});

contextBridge.exposeInMainWorld('electronPrint', {
  print: (html, title) => ipcRenderer.send('print-doc', { html, title }),
});

contextBridge.exposeInMainWorld('electronAuth', {
  onDeepLink: (cb) => ipcRenderer.on('auth-deep-link', (_, url) => cb(url)),
});

function applyTheme(isDark) {
  const tb = document.getElementById('nxn-tb');
  if (!tb) return;
  if (isDark) {
    tb.style.background    = '#08091a';
    tb.style.borderBottom  = '1px solid rgba(108,99,255,0.18)';
    document.getElementById('nxn-tb-sep').style.background  = 'rgba(255,255,255,0.1)';
    document.getElementById('nxn-tb-sub').style.color       = 'rgba(255,255,255,0.28)';
    document.querySelectorAll('.nxn-tb-btn').forEach(b => b.style.color = 'rgba(255,255,255,0.45)');
  } else {
    tb.style.background    = '#ffffff';
    tb.style.borderBottom  = '1px solid rgba(108,99,255,0.15)';
    document.getElementById('nxn-tb-sep').style.background  = 'rgba(0,0,0,0.12)';
    document.getElementById('nxn-tb-sub').style.color       = 'rgba(0,0,0,0.35)';
    document.querySelectorAll('.nxn-tb-btn').forEach(b => b.style.color = 'rgba(0,0,0,0.45)');
  }
}

function injectTitlebar() {
  const TB_H = 44;

  const style = document.createElement('style');
  style.id = 'nxn-titlebar-css';
  style.textContent = `
    /* ── Titlebar shell ── */
    #nxn-tb {
      position: fixed; top: 0; left: 0; right: 0; height: ${TB_H}px;
      background: transparent;
      border-bottom: none;
      z-index: 2147483647;
      display: flex; align-items: center; justify-content: space-between;
      user-select: none; -webkit-user-select: none;
    }

    /* ── Draggable region (logo + title) ── */
    #nxn-tb-drag {
      display: flex; align-items: center; gap: 9px;
      padding: 0 14px; flex: 1; height: 100%;
      -webkit-app-region: drag;
    }
    #nxn-tb-icon {
      width: 34px !important; height: 34px !important;
      border-radius: 8px;
      flex-shrink: 0;
    }
    #nxn-tb-name {
      font-family: 'Plus Jakarta Sans', 'Inter', 'Segoe UI', sans-serif;
      font-size: 12px; font-weight: 800; letter-spacing: 0.8px;
      background: linear-gradient(135deg, #a78bfa 0%, #6C63FF 60%, #00D4AA 100%);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    #nxn-tb-sep {
      width: 1px; height: 14px;
      background: rgba(255,255,255,0.1);
      flex-shrink: 0;
      transition: background 0.2s;
    }
    #nxn-tb-sub {
      font-family: 'Inter', 'Segoe UI', sans-serif;
      font-size: 10px; font-weight: 400; letter-spacing: 0.3px;
      color: rgba(255,255,255,0.28);
      transition: color 0.2s;
    }

    /* ── Window control buttons ── */
    #nxn-tb-controls {
      display: flex; align-items: center; height: 100%;
      -webkit-app-region: no-drag;
    }
    .nxn-tb-btn {
      width: 46px; height: ${TB_H}px;
      border: none; background: transparent;
      color: rgba(255,255,255,0.45);
      cursor: pointer; outline: none;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.12s, color 0.12s;
      pointer-events: all;
      -webkit-app-region: no-drag;
    }
    .nxn-tb-btn:hover {
      background: rgba(128,128,128,0.12);
      color: inherit;
      filter: brightness(1.4);
    }
    #nxn-tb-close:hover {
      background: #c42b1c !important;
      color: #fff !important;
      filter: none !important;
    }

    /* ── Push all page content below titlebar ── */
    body {
      padding-top: ${TB_H}px !important;
    }

    /* ── Fix full-height screens ── */
    .scr {
      min-height: calc(100vh - ${TB_H}px) !important;
    }
    #s-login, #s-signup, #s-payment-wall, #s-onboarding {
      height: calc(100vh - ${TB_H}px) !important;
      min-height: calc(100vh - ${TB_H}px) !important;
    }

    /* ── Fix app shell height ── */
    .app, #s-app {
      height: calc(100vh - ${TB_H}px) !important;
      max-height: calc(100vh - ${TB_H}px) !important;
      overflow: hidden !important;
    }
    .main {
      height: calc(100vh - ${TB_H}px) !important;
      max-height: calc(100vh - ${TB_H}px) !important;
    }
    .sb {
      height: calc(100vh - ${TB_H}px) !important;
    }
  `;
  document.head.appendChild(style);

  const bar = document.createElement('div');
  bar.id = 'nxn-tb';
  bar.innerHTML = `
    <div id="nxn-tb-drag">
      <img id="nxn-tb-icon" src="build/icon.png" alt="">
      <span id="nxn-tb-name">NEXUNOVA RMS</span>
      <div id="nxn-tb-sep"></div>
      <span id="nxn-tb-sub">Recovery Management System</span>
    </div>
    <div id="nxn-tb-controls">
      <button class="nxn-tb-btn" id="nxn-tb-min" title="Minimize">
        <svg width="11" height="1" viewBox="0 0 11 1"><rect width="11" height="1" rx="0.5" fill="currentColor"/></svg>
      </button>
      <button class="nxn-tb-btn" id="nxn-tb-max" title="Maximize">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <rect x="0.5" y="0.5" width="9" height="9" rx="1" stroke="currentColor"/>
        </svg>
      </button>
      <button class="nxn-tb-btn" id="nxn-tb-close" title="Close">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <line x1="0.5" y1="0.5" x2="9.5" y2="9.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          <line x1="9.5" y1="0.5" x2="0.5" y2="9.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
  `;

  document.body.insertBefore(bar, document.body.firstChild);

  // Force icon size via JS — cannot be overridden by any stylesheet
  const tbIcon = document.getElementById('nxn-tb-icon');
  tbIcon.style.cssText = 'width:32px !important; height:32px !important; min-width:32px !important; min-height:32px !important; border-radius:8px; flex-shrink:0; display:block;';

  // Apply theme immediately, then watch for changes
  const isDark = () => document.documentElement.getAttribute('data-theme') !== 'light';
  applyTheme(isDark());
  new MutationObserver(() => applyTheme(isDark())).observe(
    document.documentElement,
    { attributes: true, attributeFilter: ['data-theme'] }
  );

  // Call ipcRenderer directly — contextBridge only exposes to renderer, not preload itself
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.nxn-tb-btn');
    if (!btn) return;
    e.stopPropagation();
    if (btn.id === 'nxn-tb-min')   ipcRenderer.send('window-minimize');
    if (btn.id === 'nxn-tb-max')   ipcRenderer.send('window-maximize');
    if (btn.id === 'nxn-tb-close') ipcRenderer.send('window-close');
  }, true); // capture phase — fires before any app listener

  const iconRestore  = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="2.5" y="0.5" width="7" height="7" rx="1" stroke="currentColor"/><rect x="0.5" y="2.5" width="7" height="7" rx="1" stroke="currentColor" fill="#08091a"/></svg>`;
  const iconMaximize = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="0.5" y="0.5" width="9" height="9" rx="1" stroke="currentColor"/></svg>`;

  ipcRenderer.on('window-state', (_, state) => {
    const maxBtn = document.getElementById('nxn-tb-max');
    if (!maxBtn) return;
    maxBtn.innerHTML = state === 'maximized' ? iconRestore : iconMaximize;
    maxBtn.title     = state === 'maximized' ? 'Restore' : 'Maximize';
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectTitlebar);
} else {
  injectTitlebar();
}
