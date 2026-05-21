/* ════════════════════════════════════════════════════════════════════════════
   AURORA TOPBAR — mega menu builder + hover hysteresis
   Reads window._navGroups (set by buildSB in ui.js).
   ════════════════════════════════════════════════════════════════════════════ */

(function() {
  let _initialized = false;
  let _closeTimer  = null;

  /* ── Build the mega grid from nav groups ─────────────────────── */
  function buildMega() {
    const grid = document.getElementById('atbMegaGrid');
    if (!grid) return;
    const groups = window._navGroups || [];

    let html = '';
    groups.forEach(g => {
      const isQuick = !g.label;
      const label   = g.label || 'Quick Access';
      html += '<div class="atb-grp' + (isQuick ? ' is-quick' : '') + '">';
      html += '<div class="atb-grp-lbl">' + esc(label) + '</div>';
      g.items.forEach(it => { html += renderItem(it); });
      html += '</div>';
    });
    grid.innerHTML = html;
    highlightCurrent();
  }

  function renderItem(it) {
    const icon = (typeof _sbi === 'function') ? _sbi(it.ic, 15) : '';
    const bdg  = it.bdg
      ? '<span class="atb-bdg">' + esc(String(it.bdg)) + '</span>'
      : '';
    return '<a class="atb-item" data-pg="' + esc(it.id) + '" '
         + 'onclick="atbNav(\'' + esc(it.id) + '\')">'
         + icon
         + '<span>' + esc(it.lb) + '</span>'
         + bdg
         + '</a>';
  }

  /* ── Highlight the active page in the mega grid ──────────────── */
  function highlightCurrent(pg) {
    if (!pg) {
      pg = document.querySelector('.pg.on')?.id?.replace('pg-', '') || '';
    }
    document.querySelectorAll('.atb-item').forEach(el => {
      el.classList.toggle('is-current', el.dataset.pg === pg);
    });
  }

  /* ── Hover hysteresis (no flicker) ───────────────────────────── */
  function init() {
    if (_initialized) return;
    const tb = document.getElementById('auroraTopbar');
    if (!tb) return;
    _initialized = true;

    const trigger = document.getElementById('atbTrigger');
    const mega    = document.getElementById('atbMega');

    const open  = () => { clearTimeout(_closeTimer); tb.classList.add('is-open'); };
    const close = () => { _closeTimer = setTimeout(() => tb.classList.remove('is-open'), 240); };

    if (trigger) {
      trigger.addEventListener('mouseenter', open);
      trigger.addEventListener('mouseleave', close);
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (tb.classList.contains('is-open')) tb.classList.remove('is-open');
        else open();
      });
    }
    if (mega) {
      mega.addEventListener('mouseenter', open);
      mega.addEventListener('mouseleave', close);
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') tb.classList.remove('is-open');
    });
  }

  /* ── Tiny esc helper (in case global esc isn't loaded yet) ──── */
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, m => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[m]));
  }

  /* ── Public hooks ─────────────────────────────────────────────── */
  window.buildTopbarMega = function() {
    init();
    buildMega();
  };

  // Called from nav() in ui.js whenever the page changes
  window.atbSyncCurrent = function(pg) {
    highlightCurrent(pg);
    // Close the menu if open after navigation
    document.getElementById('auroraTopbar')?.classList.remove('is-open');
  };

  // Click handler — navigate + close
  window.atbNav = function(pg) {
    document.getElementById('auroraTopbar')?.classList.remove('is-open');
    if (typeof nav === 'function') nav(pg);
  };

  // Auto-init on DOM ready (sidebar render will call buildTopbarMega afterwards)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
