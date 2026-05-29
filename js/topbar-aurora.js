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

  /* ── Build the mega menu from nav groups ─────────────────────────
     Command deck: a horizontal row of category tabs; hovering a tab
     reveals ONLY that category's items as an app-launcher tile grid.
     One category at a time → no long scrollbar, focused + premium. */
  function buildMega() {
    const grid = document.getElementById('atbMegaGrid');
    if (!grid) return;
    const groups = window._navGroups || [];

    let tabs  = '<div class="atb-tabs">';
    let stage = '<div class="atb-stage">';

    groups.forEach((g, i) => {
      const isQuick = !g.label;
      const label   = g.label || 'Quick Access';
      const zone    = isQuick ? 'violet' : zoneOf(g.label);
      const gIc     = (typeof _sbi === 'function') ? _sbi((g.items[0] || {}).ic, 15) : '';

      tabs += '<button class="atb-tab zone-' + zone + '" type="button" data-cat="' + i + '" '
            + 'onmouseenter="atbSetCat(' + i + ')" onfocus="atbSetCat(' + i + ')" '
            + 'onclick="atbSetCat(' + i + ')">'
            +   '<span class="atb-tab-ic">' + gIc + '</span>'
            +   '<span class="atb-tab-lb">' + esc(label) + '</span>'
            +   '<span class="atb-tab-cnt">' + g.items.length + '</span>'
            + '</button>';

      stage += '<div class="atb-deck zone-' + zone + '" data-pane="' + i + '">';
      g.items.forEach(it => { stage += renderItem(it); });
      stage += '</div>';
    });

    tabs  += '</div>';
    stage += '</div>';
    grid.innerHTML = tabs + stage;

    highlightCurrent();
    atbDefaultCat();
    attachTileRipples();
  }

  /* Water-drop ripple: spawn an expanding circle from the cursor on hover. */
  function attachTileRipples() {
    document.querySelectorAll('.atb-tile').forEach(tile => {
      tile.addEventListener('pointerenter', e => {
        const r = tile.getBoundingClientRect();
        const size = Math.max(r.width, r.height) * 1.7;
        const sp = document.createElement('span');
        sp.className = 'atb-ripple';
        sp.style.width = sp.style.height = size + 'px';
        sp.style.left = (e.clientX - r.left - size / 2) + 'px';
        sp.style.top  = (e.clientY - r.top  - size / 2) + 'px';
        tile.appendChild(sp);
        setTimeout(() => sp.remove(), 640);
      });
    });
  }

  /* Activate a category (tab hover swaps the visible tile deck).
     Re-triggers the staggered tile entrance EVERY time so the cascade
     plays on each open and each tab switch (not just the first time). */
  window.atbSetCat = function(i) {
    document.querySelectorAll('.atb-tab').forEach(el =>
      el.classList.toggle('is-active', +el.dataset.cat === i));
    document.querySelectorAll('.atb-deck').forEach(el => {
      const on = +el.dataset.pane === i;
      el.classList.toggle('is-active', on);
      if (on) {
        el.querySelectorAll('.atb-tile').forEach(t => {
          t.style.animation = 'none';
          void t.offsetWidth;          // force reflow → restart CSS animation
          t.style.animation = '';
        });
      }
    });
  };

  /* Pick the category that contains the current page (else the first). */
  function atbDefaultCat() {
    const groups = window._navGroups || [];
    if (!groups.length) return;
    const pg = document.querySelector('.pg.on')?.id?.replace('pg-', '') || '';
    let idx = 0;
    if (pg) {
      for (let i = 0; i < groups.length; i++) {
        if ((groups[i].items || []).some(it => it.id === pg)) { idx = i; break; }
      }
    }
    atbSetCat(idx);
  }

  function renderItem(it) {
    const icon = (typeof _sbi === 'function') ? _sbi(it.ic, 18) : '';
    const bdg  = it.bdg
      ? '<span class="atb-tile-bdg' + (it.bdgType === 'alert' ? ' alert' : '') + '">'
        + esc(String(it.bdg)) + '</span>'
      : '';
    return '<a class="atb-tile" data-pg="' + esc(it.id) + '" '
         + 'onclick="atbNav(\'' + esc(it.id) + '\')">'
         + '<span class="atb-tile-ic">' + icon + bdg + '</span>'
         + '<span class="atb-tile-lb">' + esc(it.lb) + '</span>'
         + '</a>';
  }

  /* ── Highlight the active page in the tile decks ─────────────── */
  function highlightCurrent(pg) {
    if (!pg) {
      pg = document.querySelector('.pg.on')?.id?.replace('pg-', '') || '';
    }
    document.querySelectorAll('.atb-tile').forEach(el => {
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

    // Inject the idle "hover me" hint as a child of the trigger (once).
    if (trigger && !trigger.querySelector('.atb-hint')) {
      const hint = document.createElement('span');
      hint.className = 'atb-hint';
      hint.textContent = 'Hover for menu';
      trigger.appendChild(hint);
    }

    const open  = () => { clearTimeout(_closeTimer); tb.classList.add('is-open'); atbDefaultCat(); };
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
