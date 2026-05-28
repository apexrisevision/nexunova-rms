/* ════════════════════════════════════════════════════════════════════════════
   AURORA TOPBAR — mega menu builder + hover hysteresis
   Reads window._navGroups (set by buildSB in ui.js).
   ════════════════════════════════════════════════════════════════════════════ */

(function() {
  let _initialized = false;
  let _closeTimer  = null;

  /* ── Operational zoning ──────────────────────────────────────
     Maps each nav-group label to an accent zone. All hues live inside
     the cyan→violet aurora spectrum so the signature identity is kept.
     New/renamed groups fall back to 'cyan'. */
  const ZONE = {
    'home': 'cyan', 'main': 'cyan',
    'sales & bookings': 'teal', 'sales': 'teal',
    'clients': 'violet',
    'recovery': 'aurora', 'operations': 'aurora',   // the operational heart
    'payments': 'sky', 'finance': 'sky',
    'finance & compliance': 'purple',
    'reports & docs': 'indigo', 'reports': 'indigo',
    'system': 'slate',
    'my modules': 'cyan'
  };
  function zoneOf(label) { return ZONE[String(label || '').toLowerCase()] || 'cyan'; }

  /* ── Build the mega grid from nav groups ─────────────────────── */
  function buildMega() {
    const grid = document.getElementById('atbMegaGrid');
    if (!grid) return;
    const groups = window._navGroups || [];

    let html = '';
    groups.forEach(g => {
      const isQuick = !g.label;
      const label   = g.label || 'Quick Access';
      const zone    = isQuick ? 'violet' : zoneOf(g.label);
      html += '<div class="atb-grp zone-' + zone + (isQuick ? ' is-quick' : '') + '">';
      html += '<div class="atb-grp-lbl">'
            +   '<span class="atb-grp-lbl-tx">' + esc(label) + '</span>'
            +   '<span class="atb-grp-cnt">' + g.items.length + '</span>'
            + '</div>';
      html += '<div class="atb-grp-items">';
      g.items.forEach(it => { html += renderItem(it); });
      html += '</div>';
      html += '</div>';
    });
    grid.innerHTML = html;
    highlightCurrent();
  }

  const CHEV = '<svg class="atb-item-go" width="13" height="13" viewBox="0 0 24 24" '
             + 'fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" '
             + 'stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';

  function renderItem(it) {
    const icon = (typeof _sbi === 'function') ? _sbi(it.ic, 15) : '';
    const bdg  = it.bdg
      ? '<span class="atb-bdg' + (it.bdgType === 'alert' ? ' alert' : '') + '">'
        + esc(String(it.bdg)) + '</span>'
      : '';
    return '<a class="atb-item" data-pg="' + esc(it.id) + '" '
         + 'onclick="atbNav(\'' + esc(it.id) + '\')">'
         + '<span class="atb-item-ic">' + icon + '</span>'
         + '<span class="atb-item-lb">' + esc(it.lb) + '</span>'
         + bdg
         + CHEV
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
