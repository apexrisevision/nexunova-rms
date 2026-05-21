// ══ TOAST NOTIFICATION SYSTEM ══════════════════════
// Usage: toast.error('msg'), toast.success('msg'), toast.warning('msg'), toast.info('msg')
// Optional: toast.error('msg', { detail: 'extra line', duration: 5000 })

(function(){
  // Inject styles once
  if(!document.getElementById('nx-toast-styles')){
    const style = document.createElement('style');
    style.id = 'nx-toast-styles';
    style.textContent = `
      .nx-toast-container {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 99999;
        display: flex;
        flex-direction: column;
        gap: 10px;
        pointer-events: none;
        max-width: 380px;
      }
      .nx-toast {
        pointer-events: auto;
        background: #1e293b;
        color: #f1f5f9;
        padding: 14px 16px;
        border-radius: 10px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.25), 0 0 0 1px rgba(255,255,255,0.05);
        display: flex;
        align-items: flex-start;
        gap: 12px;
        min-width: 280px;
        max-width: 380px;
        font-family: 'Plus Jakarta Sans', 'Inter', system-ui, sans-serif;
        font-size: 14px;
        line-height: 1.4;
        animation: nx-toast-in 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        border-left: 3px solid transparent;
      }
      .nx-toast.nx-toast-out {
        animation: nx-toast-out 0.25s ease-in forwards;
      }
      .nx-toast-error   { border-left-color: #ef4444; }
      .nx-toast-success { border-left-color: #10b981; }
      .nx-toast-warning { border-left-color: #f59e0b; }
      .nx-toast-info    { border-left-color: #6366f1; }

      .nx-toast-icon {
        font-size: 18px;
        line-height: 1;
        flex-shrink: 0;
        margin-top: 1px;
      }
      .nx-toast-body {
        flex: 1;
        min-width: 0;
      }
      .nx-toast-title {
        font-weight: 600;
        margin-bottom: 2px;
      }
      .nx-toast-detail {
        font-size: 12.5px;
        color: #94a3b8;
        margin-top: 4px;
      }
      .nx-toast-detail a {
        color: #818cf8;
        text-decoration: none;
      }
      .nx-toast-detail a:hover {
        text-decoration: underline;
      }
      .nx-toast-close {
        background: transparent;
        border: 0;
        color: #64748b;
        cursor: pointer;
        font-size: 18px;
        line-height: 1;
        padding: 0;
        margin-left: 4px;
        flex-shrink: 0;
      }
      .nx-toast-close:hover { color: #f1f5f9; }

      @keyframes nx-toast-in {
        from { opacity: 0; transform: translateX(20px); }
        to   { opacity: 1; transform: translateX(0); }
      }
      @keyframes nx-toast-out {
        from { opacity: 1; transform: translateX(0); }
        to   { opacity: 0; transform: translateX(20px); }
      }

      @media (max-width: 480px) {
        .nx-toast-container {
          left: 10px;
          right: 10px;
          top: 10px;
          max-width: none;
        }
        .nx-toast { min-width: 0; max-width: none; }
      }
    `;
    document.head.appendChild(style);
  }

  // Get or create container
  function getContainer(){
    let c = document.getElementById('nx-toast-container');
    if(!c){
      c = document.createElement('div');
      c.id = 'nx-toast-container';
      c.className = 'nx-toast-container';
      document.body.appendChild(c);
    }
    return c;
  }

  // Escape HTML to prevent XSS
  function esc(s){
    return String(s).replace(/[&<>"']/g, m => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[m]));
  }

  // Auto-link emails in detail text
  function linkEmails(s){
    return esc(s).replace(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g,
      '<a href="mailto:$1">$1</a>');
  }

  function show(type, title, opts){
    opts = opts || {};
    const duration = opts.duration != null ? opts.duration : 4000;
    const detail = opts.detail || '';

    const icons = { error:'❌', success:'✅', warning:'⚠️', info:'ℹ️' };
    const icon = icons[type] || icons.info;

    const container = getContainer();
    const toast = document.createElement('div');
    toast.className = `nx-toast nx-toast-${type}`;
    toast.innerHTML = `
      <div class="nx-toast-icon">${icon}</div>
      <div class="nx-toast-body">
        <div class="nx-toast-title">${esc(title)}</div>
        ${detail ? `<div class="nx-toast-detail">${linkEmails(detail)}</div>` : ''}
      </div>
      <button class="nx-toast-close" aria-label="Close">×</button>
    `;
    container.appendChild(toast);

    const remove = () => {
      toast.classList.add('nx-toast-out');
      setTimeout(() => toast.remove(), 250);
    };

    toast.querySelector('.nx-toast-close').addEventListener('click', remove);

    if(duration > 0){
      setTimeout(remove, duration);
    }

    return remove;
  }

  // Public API
  window.toast = {
    error:   (title, opts) => show('error',   title, opts),
    success: (title, opts) => show('success', title, opts),
    warning: (title, opts) => show('warning', title, opts),
    info:    (title, opts) => show('info',    title, opts),
  };
})();
