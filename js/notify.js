// ══ NOTIFY — TOAST + DIALOG SYSTEM (refined) ══════════════════════
// Toasts (auto-dismiss):  notify.success('msg'), notify.info('msg')
// Dialogs (require OK):   notify.error('title', { detail: '...' })
//                         notify.warning('title', { detail: '...' })
// Generic:                notify.alert({ title, detail, type, okText, onOk })

(function(){
  if(!document.getElementById('nx-notify-keyframes')){
    const style = document.createElement('style');
    style.id = 'nx-notify-keyframes';
    style.textContent = `
      @keyframes nxNotifyIn  { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
      @keyframes nxNotifyOut { from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(20px); } }
      @keyframes nxDialogIn  { from { opacity: 0; transform: scale(0.96) translateY(4px); } to { opacity: 1; transform: scale(1) translateY(0); } }
      @keyframes nxOverlayIn { from { opacity: 0; } to { opacity: 1; } }
    `;
    document.head.appendChild(style);
  }

  // Subtle accent colors
  const ACCENTS = {
    error:   { color: '#f87171', bg: 'rgba(248, 113, 113, 0.08)', ring: 'rgba(248, 113, 113, 0.2)' },
    success: { color: '#34d399', bg: 'rgba(52, 211, 153, 0.08)',  ring: 'rgba(52, 211, 153, 0.2)' },
    warning: { color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.08)',  ring: 'rgba(251, 191, 36, 0.2)' },
    info:    { color: '#818cf8', bg: 'rgba(129, 140, 248, 0.08)', ring: 'rgba(129, 140, 248, 0.2)' }
  };

  // Refined SVG icons (no emoji)
  const ICONS = {
    error:   `<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="8"/><path d="M10 6v5"/><circle cx="10" cy="14" r="0.5" fill="currentColor"/></svg>`,
    success: `<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="8"/><path d="M6.5 10.5l2.5 2.5 4.5-5"/></svg>`,
    warning: `<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2.5L18 16H2L10 2.5z"/><path d="M10 8v4"/><circle cx="10" cy="14.5" r="0.5" fill="currentColor"/></svg>`,
    info:    `<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="8"/><path d="M10 9v5"/><circle cx="10" cy="6" r="0.5" fill="currentColor"/></svg>`
  };

  function esc(s){
    return String(s).replace(/[&<>"']/g, m => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[m]));
  }

  function linkEmails(s){
    return esc(s)
      .replace(/&lt;br\s*\/?&gt;/gi, '<br>')
      .replace(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g,
        '<a href="mailto:$1" style="color:#a5b4fc !important;text-decoration:none !important;border-bottom:1px solid rgba(165,180,252,0.3) !important;">$1</a>');
  }

  // ══════════════════════════════════════════════════════════
  // TOAST (top-right, auto-dismiss)
  // ══════════════════════════════════════════════════════════
  function getToastContainer(){
    let c = document.getElementById('nx-notify-container');
    if(!c){
      c = document.createElement('div');
      c.id = 'nx-notify-container';
      c.style.cssText = `
        position: fixed !important;
        top: 20px !important;
        right: 20px !important;
        z-index: 2147483647 !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 8px !important;
        pointer-events: none !important;
        max-width: 360px !important;
        margin: 0 !important;
        padding: 0 !important;
      `;
      document.body.appendChild(c);
    }
    return c;
  }

  function showToast(type, title, opts){
    opts = opts || {};
    const duration = opts.duration != null ? opts.duration : 3500;
    const detail = opts.detail || '';
    const accent = ACCENTS[type] || ACCENTS.info;
    const icon = ICONS[type] || ICONS.info;

    const container = getToastContainer();
    const el = document.createElement('div');
    el.style.cssText = `
      pointer-events: auto !important;
      background: #0f172a !important;
      color: #e2e8f0 !important;
      padding: 12px 14px !important;
      border-radius: 8px !important;
      box-shadow: 0 8px 24px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06) !important;
      display: flex !important;
      align-items: flex-start !important;
      gap: 10px !important;
      min-width: 280px !important;
      max-width: 360px !important;
      font-family: 'Plus Jakarta Sans', 'Inter', system-ui, -apple-system, sans-serif !important;
      font-size: 13px !important;
      line-height: 1.45 !important;
      animation: nxNotifyIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards !important;
      margin: 0 !important;
    `;
    el.innerHTML = `
      <div style="color:${accent.color} !important;flex-shrink:0 !important;margin-top:1px !important;display:flex !important;">${icon}</div>
      <div style="flex:1 !important;min-width:0 !important;">
        <div style="font-weight:600 !important;color:#f1f5f9 !important;">${esc(title)}</div>
        ${detail ? `<div style="font-size:12px !important;color:#94a3b8 !important;margin-top:3px !important;">${linkEmails(detail)}</div>` : ''}
      </div>
      <button class="nx-toast-close" aria-label="Close" style="background:transparent !important;border:0 !important;color:#475569 !important;cursor:pointer !important;font-size:16px !important;line-height:1 !important;padding:0 !important;margin:0 0 0 4px !important;flex-shrink:0 !important;">×</button>
    `;
    container.appendChild(el);

    const remove = () => {
      el.style.animation = 'nxNotifyOut 0.2s ease-in forwards';
      setTimeout(() => el.remove(), 200);
    };

    el.querySelector('.nx-toast-close').addEventListener('click', remove);
    if(duration > 0) setTimeout(remove, duration);
    return remove;
  }

  // ══════════════════════════════════════════════════════════
  // DIALOG (centered modal, requires OK)
  // ══════════════════════════════════════════════════════════
  function showDialog(opts){
    opts = opts || {};
    const type = opts.type || 'info';
    const title = opts.title || '';
    const detail = opts.detail || '';
    const okText = opts.okText || 'OK';
    const onOk = opts.onOk || null;
    const onMount = opts.onMount || null;
    const accent = ACCENTS[type] || ACCENTS.info;
    const icon = ICONS[type] || ICONS.info;

    // Subtle overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed !important;
      inset: 0 !important;
      background: rgba(20, 20, 22, 0.5) !important;
      backdrop-filter: blur(2px) !important;
      -webkit-backdrop-filter: blur(2px) !important;
      z-index: 2147483646 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      animation: nxOverlayIn 0.18s ease-out forwards !important;
      padding: 20px !important;
      margin: 0 !important;
      font-family: 'Plus Jakarta Sans', 'Inter', system-ui, -apple-system, sans-serif !important;
    `;

    // Refined dialog
    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: #0f172a !important;
      color: #e2e8f0 !important;
      border-radius: 10px !important;
      box-shadow: 0 20px 50px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.06) !important;
      max-width: 360px !important;
      width: 100% !important;
      padding: 18px 18px 14px !important;
      animation: nxDialogIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards !important;
      margin: 0 !important;
    `;
    dialog.innerHTML = `
      <div style="display:flex !important;align-items:flex-start !important;gap:11px !important;margin-bottom:16px !important;">
        <div style="width:28px !important;height:28px !important;border-radius:7px !important;background:${accent.bg} !important;color:${accent.color} !important;display:flex !important;align-items:center !important;justify-content:center !important;flex-shrink:0 !important;">${icon}</div>
        <div style="flex:1 !important;min-width:0 !important;padding-top:2px !important;">
          <div style="font-weight:600 !important;font-size:14px !important;color:#f1f5f9 !important;margin-bottom:3px !important;line-height:1.3 !important;">${esc(title)}</div>
          ${detail ? `<div style="font-size:13px !important;color:#94a3b8 !important;line-height:1.5 !important;">${linkEmails(detail)}</div>` : ''}
        </div>
      </div>
      <div style="display:flex !important;justify-content:flex-end !important;gap:8px !important;">
        <button class="nx-dialog-ok" style="background:#1e293b !important;color:#f1f5f9 !important;border:1px solid rgba(255,255,255,0.08) !important;padding:6px 16px !important;border-radius:6px !important;font-weight:500 !important;font-size:13px !important;cursor:pointer !important;font-family:inherit !important;min-width:64px !important;transition:background 0.15s, border-color 0.15s !important;">${esc(okText)}</button>
      </div>
    `;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const okBtn = dialog.querySelector('.nx-dialog-ok');
    okBtn.addEventListener('mouseenter', () => {
      okBtn.style.background = '#334155';
      okBtn.style.borderColor = 'rgba(255,255,255,0.12)';
    });
    okBtn.addEventListener('mouseleave', () => {
      okBtn.style.background = '#1e293b';
      okBtn.style.borderColor = 'rgba(255,255,255,0.08)';
    });

    const close = () => {
      overlay.style.animation = 'nxOverlayIn 0.12s ease-in reverse forwards';
      setTimeout(() => overlay.remove(), 120);
      document.removeEventListener('keydown', keyHandler);
    };

    const doOk = () => {
      close();
      if(typeof onOk === 'function') onOk();
    };

    okBtn.addEventListener('click', doOk);

    overlay.addEventListener('click', (e) => {
      if(e.target === overlay) close();
    });

    const keyHandler = (e) => {
      if(e.key === 'Enter' || e.key === 'Escape'){
        e.preventDefault();
        doOk();
      }
    };
    document.addEventListener('keydown', keyHandler);

    setTimeout(() => okBtn.focus(), 50);

    if (typeof onMount === 'function') { try { onMount(dialog, close); } catch(_) {} }

    return close;
  }

  // ══════════════════════════════════════════════════════════
  // Public API
  // ══════════════════════════════════════════════════════════
  window.notify = {
    // Toasts (auto-dismiss, top-right)
    success: (title, opts) => showToast('success', title, opts),
    info:    (title, opts) => showToast('info',    title, opts),
    toast:   (title, opts) => showToast((opts && opts.type) || 'info', title, opts),

    // Dialogs (centered, require OK click)
    error:   (title, opts) => showDialog({ ...(opts||{}), type:'error',   title }),
    warning: (title, opts) => showDialog({ ...(opts||{}), type:'warning', title }),
    alert:   (opts) => showDialog(opts || {}),
  };
})();
