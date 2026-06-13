/* ════════════════════════════════════════════════════════════════════════
   NEXUNOVA RMS — FOUNDATION KIT (render helpers)  ·  Phase 2 · 2026-06-12
   ────────────────────────────────────────────────────────────────────────
   window.NX — string-returning helpers that emit the nx- markup defined in
   css/foundation/components.css. Use these in NEW code instead of bespoke
   string templates. They never touch the DOM (callers insert the HTML), and
   they HTML-escape all interpolated text.

   Pairs with: css/foundation/tokens.css, css/foundation/components.css,
               foundation/KIT.md (full catalogue + examples).
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* HTML-escape — prefer the app-wide esc() if present, else a local fallback */
  function _esc(s) {
    if (typeof global.esc === 'function') return global.esc(s == null ? '' : s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function _cls(extra) { return extra ? (' ' + String(extra)) : ''; }

  /* ── Lucide icons ─────────────────────────────────────────────────────
     Returns a Lucide SVG. Uses the global `lucide` icon set if loaded;
     otherwise falls back to a small inline set covering kit needs. NEVER
     emoji. name = lucide kebab name (e.g. 'x', 'search', 'inbox'). */
  var _ICONS = {
    'x':            '<path d="M18 6 6 18M6 6l12 12"/>',
    'search':       '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    'chevron-up':   '<path d="m18 15-6-6-6 6"/>',
    'chevron-right':'<path d="m9 18 6-6-6-6"/>',
    'check':        '<path d="M20 6 9 17l-5-5"/>',
    'alert-triangle':'<path d="m21.7 18-9-15.5a1.5 1.5 0 0 0-2.6 0L1.1 18a1.5 1.5 0 0 0 1.3 2.3h18.2a1.5 1.5 0 0 0 1.3-2.3Z"/><path d="M12 9v4M12 17h.01"/>',
    'info':         '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    'inbox':        '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.5 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.5A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.5Z"/>',
    'plus':         '<path d="M5 12h14M12 5v14"/>',
    /* WARMTH v2 — header / section icon-chip glyphs (Lucide paths, currentColor) */
    'layers':       '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>',
    'layout-dashboard':'<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
    'package':      '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73Z"/><path d="M3.3 7 12 12l8.7-5"/><path d="M12 22V12"/>',
    'bar-chart-3':  '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
    'file-text':    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
    'users':        '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    'wallet':       '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
    'calendar-clock':'<path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4.5"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/><circle cx="17.5" cy="17.5" r="4.5"/><path d="M17.5 15.5V17.5l1.2 1.2"/>',
    'building-2':   '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>',
    'tag':          '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
    'list':         '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
    'banknote':     '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
    'trending-up':  '<path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>',
    'history':      '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
    'phone':        '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
    'message-circle':'<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    'sunrise':      '<path d="M12 2v8"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m8 6 4-4 4 4"/><path d="M16 18a4 4 0 0 0-8 0"/>',
    /* ADMIN batch — settings / company / security / plan / import section chips */
    'settings':     '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    'shield':       '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
    'credit-card':  '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',
    'upload':       '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
    'key':          '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>',
    'lock':         '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    'image':         '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    /* RECOVERY batch — promise · campaign · field-visit · escalation · legal glyphs */
    'clock':         '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    'megaphone':     '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
    'map-pin':       '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    'briefcase':     '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
    'check-circle':  '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>',
    'x-circle':      '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
    'calendar':      '<rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/>',
    'hand-coins':    '<path d="M11 15h2a2 2 0 1 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 17"/><path d="m7 21 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 0 0-2.75-2.91l-4.2 3.9"/><path d="m2 16 6 6"/><circle cx="16" cy="7" r="4"/>',
    'siren':         '<path d="M7 12a5 5 0 0 1 5-5v0a5 5 0 0 1 5 5v6H7v-6Z"/><path d="M5 20a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2"/><path d="M12 2v1"/><path d="M4.2 4.8l.9.9"/><path d="M2 13h1"/><path d="M21 13h1"/><path d="M18.9 4.8l-.9.9"/>',
    /* PROJECTS batch — detail chrome glyphs */
    'arrow-left':    '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    'chevron-left':  '<path d="m15 18-6-6 6-6"/>',
    'pencil':        '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
    'trash-2':       '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
    'printer':       '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V2h12v7"/><rect width="12" height="8" x="6" y="14"/>',
    'home':          '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    'building':      '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>',
    'gem':           '<path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/>'
  };
  function icon(name, size) {
    var sz = size || 16;
    // Prefer a real Lucide build if the app ships one
    if (global.lucide && global.lucide.icons) {
      var key = String(name || '').replace(/(^|-)([a-z])/g, function (_, d, c) { return c.toUpperCase(); });
      var def = global.lucide.icons[key];
      if (def && typeof global.lucide.createElement === 'function') {
        try { return global.lucide.createElement(def).outerHTML; } catch (e) { /* fall through */ }
      }
    }
    var body = _ICONS[name] || _ICONS['info'];
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + sz + '" height="' + sz +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
  }

  /* ── Tinted icon chip (WARMTH v2 ④) ──────────────────────────────────
     NX.ichip(name, tone, { size:'sm'|'lg', class }) — Lucide glyph on a ~12%
     semantic tint. tone = ''|'info'|'success'|'warning'|'danger' (''=indigo). */
  function ichip(name, tone, o) {
    o = o || {};
    var sz = o.size ? ' nx-ichip--' + o.size : '';
    var t  = tone ? ' nx-ichip--' + tone : '';
    var isz = o.size === 'lg' ? 18 : (o.size === 'sm' ? 15 : 16);
    return '<span class="nx-ichip' + t + sz + _cls(o.class) + '">' + icon(name, isz) + '</span>';
  }

  /* ── Tabs — segmented track (WARMTH v2 ①) ─────────────────────────────
     NX.tabs({ tabs:[{k,label,count,icon}], active, onSelect, fill, class })
     onSelect is a JS expression string; '%k' is replaced with the tab key. */
  function tabs(o) {
    o = o || {};
    var items = o.tabs || [], active = o.active, onSel = o.onSelect || '';
    var html = items.map(function (t) {
      var on  = (t.k === active);
      var cnt = (t.count != null) ? '<span class="nx-chip">' + _esc(String(t.count)) + '</span>' : '';  // String() so a 0 count isn't blanked by a falsy-guard esc()
      var ic  = t.icon ? icon(t.icon, 15) : '';
      var clk = onSel ? ' onclick="' + _esc(onSel.split('%k').join(t.k)) + '"' : '';
      return '<button class="nx-tab' + (on ? ' nx-tab--on' : '') + '" type="button"' + clk + '>' +
        ic + '<span>' + _esc(t.label) + '</span>' + cnt + '</button>';
    }).join('');
    return '<div class="nx-tabs' + (o.fill ? ' nx-tabs--fill' : '') + _cls(o.class) + '">' + html + '</div>';
  }

  /* ── Card ─────────────────────────────────────────────────────────────
     NX.card(innerHTML, { compact, flush, hover, class,
                          header:{ title, icon, tone, sub, actions } }) */
  function card(inner, o) {
    o = o || {};
    var c = 'nx-card' + (o.compact ? ' nx-card--compact' : '') + (o.flush ? ' nx-card--flush' : '') +
            (o.hover ? ' nx-card--hover' : '') + _cls(o.class);
    var hd = '';
    if (o.header) {
      var h = o.header;
      var chip = h.icon ? ichip(h.icon, h.tone, {}) : '';
      var sub  = h.sub ? '<div class="nx-card-hd-sub">' + _esc(h.sub) + '</div>' : '';
      var act  = h.actions ? '<div class="nx-card-hd-a">' + h.actions + '</div>' : '';
      hd = '<div class="nx-card-hd">' + chip + '<div><div class="nx-card-hd-t">' + _esc(h.title || '') + '</div>' + sub + '</div>' + act + '</div>';
    }
    return '<div class="' + c + '">' + hd + (inner || '') + '</div>';
  }

  /* ── Button ───────────────────────────────────────────────────────────
     NX.button(label, { variant:'primary'|'secondary'|'ghost'|'danger',
                        size:'sm', icon:'plus', onclick, type, disabled,
                        attrs, class }) */
  function button(label, o) {
    o = o || {};
    var v = o.variant || 'secondary';
    var c = 'nx-btn nx-btn--' + v + (o.size === 'sm' ? ' nx-btn--sm' : '') +
            (label ? '' : ' nx-btn--icon') + _cls(o.class);
    var a = '';
    a += ' type="' + (o.type || 'button') + '"';
    if (o.onclick)  a += ' onclick="' + _esc(o.onclick) + '"';
    if (o.disabled) a += ' disabled';
    if (o.attrs)    a += ' ' + o.attrs;
    var ico = o.icon ? icon(o.icon, 15) : '';
    return '<button class="' + c + '"' + a + '>' + ico + (label ? '<span>' + _esc(label) + '</span>' : '') + '</button>';
  }

  /* ── Table ────────────────────────────────────────────────────────────
     NX.table({ cols:[{label,num,width}], rows:[[c1,c2,...]], flush, class })
     Cell values are inserted RAW (so callers may pass nx-badge markup). Escape
     plain text yourself with NX.esc when needed. Mark numeric cols num:true. */
  function table(o) {
    o = o || {};
    var cols = o.cols || [], rows = o.rows || [];
    var head = cols.map(function (col) {
      var w = col.width ? ' style="width:' + col.width + '"' : '';
      return '<th class="' + (col.num ? 'num' : '') + '"' + w + '>' + _esc(col.label) + '</th>';
    }).join('');
    var body = rows.map(function (r) {
      var tds = r.map(function (cell, i) {
        return '<td class="' + (cols[i] && cols[i].num ? 'num' : '') + '">' + (cell == null ? '' : cell) + '</td>';
      }).join('');
      return '<tr>' + tds + '</tr>';
    }).join('');
    var c = 'nx-table' + (o.flush ? ' nx-table--flush' : '') + _cls(o.class);
    return '<table class="' + c + '"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>';
  }

  /* ── Modal ────────────────────────────────────────────────────────────
     NX.modal({ title, body, footer, size:'s'|'m'|'l', onClose, id })
     Returns overlay markup; caller appends to DOM and wires buttons. */
  function modal(o) {
    o = o || {};
    var size = (o.size === 's' || o.size === 'l') ? o.size : 'm';
    var closeAttr = o.onClose ? ' onclick="' + _esc(o.onClose) + '"' : '';
    return '' +
      '<div class="nx-modal-overlay"' + (o.id ? ' id="' + _esc(o.id) + '"' : '') + '>' +
        '<div class="nx-modal nx-modal--' + size + '">' +
          '<div class="nx-modal-header">' +
            '<h3 class="nx-modal-title">' + _esc(o.title || '') + '</h3>' +
            '<button class="nx-modal-close" aria-label="Close"' + closeAttr + '>' + icon('x', 16) + '</button>' +
          '</div>' +
          '<div class="nx-modal-body">' + (o.body || '') + '</div>' +
          (o.footer ? '<div class="nx-modal-footer">' + o.footer + '</div>' : '') +
        '</div>' +
      '</div>';
  }

  /* ── Form field ───────────────────────────────────────────────────────
     NX.field({ label, name, type, value, placeholder, required, error,
                el:'input'|'select'|'textarea', options:[{value,label}],
                attrs }) */
  function field(o) {
    o = o || {};
    var el = o.el || 'input';
    var req = o.required ? '<span class="nx-req" aria-hidden="true">*</span>' : '';
    var lbl = o.label ? '<label class="nx-label"' + (o.name ? ' for="' + _esc(o.name) + '"' : '') + '>' + _esc(o.label) + req + '</label>' : '';
    var idn = o.name ? (' id="' + _esc(o.name) + '" name="' + _esc(o.name) + '"') : '';
    var ph  = o.placeholder ? ' placeholder="' + _esc(o.placeholder) + '"' : '';
    var ax  = o.attrs ? ' ' + o.attrs : '';
    var ctrl;
    if (el === 'textarea') {
      ctrl = '<textarea class="nx-textarea"' + idn + ph + ax + '>' + _esc(o.value || '') + '</textarea>';
    } else if (el === 'select') {
      var opts = (o.options || []).map(function (op) {
        var sel = (op.value == o.value) ? ' selected' : '';
        return '<option value="' + _esc(op.value) + '"' + sel + '>' + _esc(op.label) + '</option>';
      }).join('');
      ctrl = '<select class="nx-select"' + idn + ax + '>' + opts + '</select>';
    } else {
      ctrl = '<input class="nx-input" type="' + _esc(o.type || 'text') + '"' + idn +
             ' value="' + _esc(o.value || '') + '"' + ph + ax + '>';
    }
    var errCls = o.error ? ' nx-field--error' : '';
    var errEl  = '<div class="nx-error">' + (o.error ? _esc(o.error) : '') + '</div>';
    return '<div class="nx-field' + errCls + '">' + lbl + ctrl + errEl + '</div>';
  }

  /* ── Badge / chip ─────────────────────────────────────────────────────
     NX.badge(text, 'success'|'warning'|'danger'|'info'|'primary'|'', {dot}) */
  function badge(text, tone, o) {
    o = o || {};
    var c = 'nx-badge' + (tone ? ' nx-badge--' + tone : '');
    var dot = o.dot ? '<span class="nx-dot"></span>' : '';
    return '<span class="' + c + _cls(o.class) + '">' + dot + _esc(text) + '</span>';
  }
  function chip(text) { return '<span class="nx-chip">' + _esc(text) + '</span>'; }

  /* ── KPI ──────────────────────────────────────────────────────────────
     NX.kpi({ label, value, delta, deltaDir:'up'|'down', dot, class })
     dot = 'primary'|'success'|'warn'|'danger'|'info' → quiet semantic dot
           before the label (color-with-meaning, no borders/strips). */
  function kpi(o) {
    o = o || {};
    var delta = '';
    if (o.delta != null && o.delta !== '') {
      delta = '<div class="nx-kpi-delta' + (o.deltaDir ? ' nx-kpi-delta--' + o.deltaDir : '') + '">' + _esc(o.delta) + '</div>';
    }
    var dot = o.dot ? '<span class="nx-kpi-dot nx-kpi-dot--' + _esc(o.dot) + '"></span>' : '';
    var tint = o.tint ? ' nx-kpi--tint-' + o.tint : '';
    var labelVal =
      '<div class="nx-kpi-label">' + dot + _esc(o.label || '') + '</div>' +
      '<div class="nx-kpi-value num">' + _esc(o.value == null ? '' : o.value) + '</div>' + delta;
    /* icon chip variant (WARMTH v2 ⑥ — chip OR tint, never both loud) */
    var inner = o.icon
      ? '<div class="nx-kpi-hd">' + ichip(o.icon, o.tone, {}) + '<div class="nx-kpi-col">' + labelVal + '</div></div>'
      : labelVal;
    return '<div class="nx-kpi' + tint + _cls(o.class) + '">' + inner + '</div>';
  }

  /* ── Empty state ──────────────────────────────────────────────────────
     NX.empty({ icon, message, action }) — action is raw nx-btn markup */
  function empty(o) {
    o = o || {};
    /* WARMTH v2 ⑥ — even empty screens get an icon-chip pulse */
    var ic = o.icon ? ichip(o.icon, o.tone, { size: 'lg' }) : '';
    return '<div class="nx-empty">' + ic +
      '<div class="nx-empty-msg">' + _esc(o.message || '') + '</div>' +
      (o.action || '') + '</div>';
  }

  /* ── Page header ──────────────────────────────────────────────────────
     NX.pageHeader(title, actionsHTML, { icon, tone, sub }) — icon adds a
     leading tinted chip (WARMTH v2 ④). Back-compatible: omit opts → plain. */
  function pageHeader(title, actions, o) {
    o = o || {};
    var left;
    if (o.icon) {
      var sub = o.sub ? '<div class="nx-card-hd-sub">' + _esc(o.sub) + '</div>' : '';
      left = '<div class="nx-page-head-l">' + ichip(o.icon, o.tone, { size: 'lg' }) +
        '<div><h1 class="nx-page-title">' + _esc(title) + '</h1>' + sub + '</div></div>';
    } else {
      left = '<h1 class="nx-page-title">' + _esc(title) + '</h1>';
    }
    return '<div class="nx-page-header">' + left +
      '<div class="nx-page-actions">' + (actions || '') + '</div></div>';
  }

  /* ── Banner ───────────────────────────────────────────────────────────
     NX.banner(message, 'info'|'warn'|'danger') */
  function banner(message, tone) {
    var t = (tone === 'warn' || tone === 'danger') ? tone : 'info';
    var ic = t === 'warn' ? 'alert-triangle' : (t === 'danger' ? 'alert-triangle' : 'info');
    return '<div class="nx-banner nx-banner--' + t + '">' + icon(ic, 16) +
      '<span>' + _esc(message) + '</span></div>';
  }

  /* ════════════════════════════════════════════════════════════════════════
     MICRO-VISUALIZATIONS — inline SVG, single accent + muted, no gradient.
     Reusable across surfaces; the dashboard Pulse strip is the first consumer.
     ════════════════════════════════════════════════════════════════════════ */
  function _cv(tone) { return tone === 'muted' ? 'var(--fk-muted-fill)' : 'var(--fk-' + (tone || 'primary') + ')'; }
  var _nxUid = 0;
  function _fmtCompact(v) {
    v = Number(v || 0); var a = Math.abs(v), s = v < 0 ? '-' : '';
    if (a >= 1e9) return s + (a / 1e9).toFixed(1) + 'B';
    if (a >= 1e6) return s + (a / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return s + (a / 1e3).toFixed(1) + 'K';
    return s + Math.round(a);
  }

  /* NX.sparkline({ series:[[…],[…]], colors, spanMax, width, height, strokeWidth })
     Each series = array of values (e.g. cumulative). series[0] solid, rest muted
     + dashed. spanMax fixes the x-scale so a shorter series stops part-way (a
     month-to-date line overlaid on a full prior month). */
  function sparkline(o) {
    o = o || {};
    var W = o.width || 132, H = o.height || 34, pad = 3, sw = o.strokeWidth || 1.5;
    var series = o.series || [], colors = o.colors || ['var(--fk-primary)', 'var(--fk-text-muted)'];
    var span = o.spanMax || Math.max.apply(null, series.map(function (s) { return (s || []).length; }).concat([2]));
    var maxV = 0; series.forEach(function (s) { (s || []).forEach(function (v) { if (v > maxV) maxV = v; }); });
    maxV = maxV || 1;
    function pts(s) {
      return s.map(function (v, i) {
        var x = pad + (span <= 1 ? 0 : (i / (span - 1)) * (W - 2 * pad));
        var y = (H - pad) - (v / maxV) * (H - 2 * pad);
        return x.toFixed(1) + ',' + y.toFixed(1);
      }).join(' ');
    }
    var lines = series.map(function (s, idx) {
      if (!s || s.length < 2) return '';
      return '<polyline points="' + pts(s) + '" fill="none" stroke="' + (colors[idx] || 'var(--fk-text-muted)') +
        '" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round" opacity="' +
        (idx > 0 ? '0.5' : '1') + '"' + (idx > 0 ? ' stroke-dasharray="3 3"' : '') + '/>';
    }).join('');
    return '<svg class="nx-sparkline" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H +
      '" preserveAspectRatio="none" aria-hidden="true">' + lines + '</svg>';
  }

  /* NX.minibar({ a, b, toneA, toneB, width, height }) — two-segment track
     (e.g. top-10 vs rest). toneB defaults to a neutral border fill. */
  function minibar(o) {
    o = o || {};
    var W = o.width || 132, H = o.height || 8, a = Number(o.a || 0), b = Number(o.b || 0);
    var tot = a + b || 1, aw = Math.max(0, Math.min(W, a / tot * W)), r = H / 2;
    var cA = _cv(o.toneA || 'danger'), cB = o.toneB ? _cv(o.toneB) : 'var(--fk-border)';
    return '<svg class="nx-minibar" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">' +
      '<rect x="0" y="0" width="' + W + '" height="' + H + '" rx="' + r + '" fill="' + cB + '"/>' +
      '<rect x="0" y="0" width="' + aw.toFixed(1) + '" height="' + H + '" rx="' + r + '" fill="' + cA + '"/></svg>';
  }

  /* NX.stackbar({ segments:[{value,tone}], width, height }) — rounded stacked bar.
     Segments should sum to the whole (caller surfaces any remainder as a segment). */
  function stackbar(o) {
    o = o || {};
    var W = o.width || 132, H = o.height || 8, segs = o.segments || [], r = H / 2;
    var tot = segs.reduce(function (s, x) { return s + Math.max(0, Number(x.value || 0)); }, 0) || 1;
    var uid = 'nxsb' + (++_nxUid), x = 0, out = '';
    segs.forEach(function (seg) {
      var w = Math.max(0, Number(seg.value || 0) / tot * W);
      if (w <= 0) return;
      out += '<rect x="' + x.toFixed(1) + '" y="0" width="' + w.toFixed(1) + '" height="' + H + '" fill="' + _cv(seg.tone) + '"/>';
      x += w;
    });
    return '<svg class="nx-stackbar" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H +
      '" aria-hidden="true"><defs><clipPath id="' + uid + '"><rect x="0" y="0" width="' + W + '" height="' + H +
      '" rx="' + r + '"/></clipPath></defs><g clip-path="url(#' + uid + ')">' + out + '</g></svg>';
  }

  /* NX.infoTip(text) — a small ⓘ with a native tooltip ("How is this computed?"). */
  function infoTip(text) {
    return '<span class="nx-infotip" tabindex="0" title="' + _esc(text) + '" aria-label="' + _esc(text) + '">' +
      icon('info', 13) + '</span>';
  }

  /* ════════════════════════════════════════════════════════════════════════
     DASHBOARD 2.0 gadget primitives — journey bar · gauge · donut. Inline SVG,
     flat token fills (no gradients), one-shot fill motion. All reusable.
     ════════════════════════════════════════════════════════════════════════ */

  /* NX.journeybar({ segments:[{value,tone,label,amount}], height, animate, class })
     One rounded segmented bar telling a whole quantity's story + a legend row.
     tone: success|danger|warning|info|primary|muted. amount = preformatted text. */
  function journeybar(o) {
    o = o || {};
    var segs = o.segments || [], H = o.height || 14, r = Math.min(H / 2, 7);
    var tot = segs.reduce(function (s, x) { return s + Math.max(0, Number(x.value || 0)); }, 0) || 1;
    var uid = 'nxjb' + (++_nxUid), x = 0, rects = '';
    segs.forEach(function (sg) {
      var w = Math.max(0, Number(sg.value || 0) / tot * 100); if (w <= 0) return;
      rects += '<rect x="' + x.toFixed(2) + '" y="0" width="' + w.toFixed(2) + '" height="' + H + '" fill="' + _cv(sg.tone) +
        '"><title>' + _esc((sg.label || '') + (sg.amount != null ? ' · ' + sg.amount : '')) + '</title></rect>';
      x += w;
    });
    var grow = (o.animate === false) ? '' : ' nx-grow-x';
    var bar = '<svg class="nx-journeybar' + grow + '" width="100%" height="' + H + '" viewBox="0 0 100 ' + H +
      '" preserveAspectRatio="none" aria-hidden="true"><defs><clipPath id="' + uid + '"><rect x="0" y="0" width="100" height="' + H +
      '" rx="' + r + '"/></clipPath></defs><g clip-path="url(#' + uid + ')">' + rects + '</g></svg>';
    var legend = segs.map(function (sg) {
      return '<span class="nx-jl"><span class="nx-jl-dot" style="background:' + _cv(sg.tone) + '"></span>' +
        '<span class="nx-jl-t">' + _esc(sg.label || '') + '</span>' +
        (sg.amount != null ? '<span class="nx-jl-a num">' + _esc(sg.amount) + '</span>' : '') + '</span>';
    }).join('');
    return '<div class="nx-journey' + _cls(o.class) + '">' + bar + '<div class="nx-journey-legend">' + legend + '</div></div>';
  }

  /* NX.gauge({ value, max, tone, caption, size, valueText, count }) — semi-donut.
     Draws a 180° arc; value arc = value/max of it. valueText overrides the centre
     label; count:{fmt} lets the centre number animate via data-nx-count. */
  function gauge(o) {
    o = o || {};
    var W = o.size || 168, H = Math.round(W * 0.60), sw = Math.max(9, Math.round(W * 0.085));
    var cx = W / 2, cy = H - 6, R = W / 2 - sw / 2 - 2;
    var f = Math.max(0, Math.min(1, Number(o.max) ? Number(o.value) / Number(o.max) : 0));
    var tone = o.tone || 'danger';
    var ang = Math.PI * (1 - f), px = cx + R * Math.cos(ang), py = cy - R * Math.sin(ang);
    var bg = 'M ' + (cx - R) + ' ' + cy + ' A ' + R + ' ' + R + ' 0 0 1 ' + (cx + R) + ' ' + cy;
    var val = f > 0.0001 ? '<path d="M ' + (cx - R) + ' ' + cy + ' A ' + R + ' ' + R + ' 0 0 1 ' + px.toFixed(2) + ' ' + py.toFixed(2) +
      '" fill="none" stroke="' + _cv(tone) + '" stroke-width="' + sw + '" stroke-linecap="round" class="nx-arc-draw" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/>' : '';
    var centre = (o.count
      ? '<span data-nx-count="' + _esc(o.count.value) + '" data-nx-fmt="' + _esc(o.count.fmt || 'pct') + '">' + _esc(o.valueText != null ? o.valueText : '') + '</span>'
      : _esc(o.valueText != null ? o.valueText : ''));
    return '<div class="nx-gauge' + _cls(o.class) + '" style="width:' + W + 'px">' +
      '<div class="nx-gauge-wrap" style="height:' + H + 'px">' +
        '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">' +
          '<path d="' + bg + '" fill="none" stroke="var(--fk-border)" stroke-width="' + sw + '" stroke-linecap="round"/>' + val + '</svg>' +
        '<div class="nx-gauge-val" style="color:' + _cv(tone) + '">' + centre + '</div>' +
      '</div>' +
      (o.caption ? '<div class="nx-gauge-cap">' + _esc(o.caption) + '</div>' : '') + '</div>';
  }

  /* NX.donut({ segments:[{value,tone,label,amount}], size, thickness, centerLabel,
     centerSub, legend }) — full multi-segment ring with a centred total + legend. */
  function donut(o) {
    o = o || {};
    var size = o.size || 150, th = o.thickness || 16, r = (size - th) / 2, c = 2 * Math.PI * r, cx = size / 2, cy = size / 2;
    var segs = o.segments || [], tot = segs.reduce(function (s, x) { return s + Math.max(0, Number(x.value || 0)); }, 0) || 1;
    var off = 0, arcs = '';
    segs.forEach(function (sg) {
      var v = Math.max(0, Number(sg.value || 0)); if (v <= 0) return;
      var len = v / tot * c;
      arcs += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + _cv(sg.tone) +
        '" stroke-width="' + th + '" stroke-dasharray="' + len.toFixed(2) + ' ' + (c - len).toFixed(2) +
        '" stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 ' + cx + ' ' + cy + ')">' +
        '<title>' + _esc((sg.label || '') + (sg.amount != null ? ' · ' + sg.amount : '')) + '</title></circle>';
      off += len;
    });
    var ring = '<svg class="nx-pop" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true">' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="var(--fk-border)" stroke-width="' + th + '"/>' + arcs + '</svg>';
    var centre = (o.centerLabel != null)
      ? '<div class="nx-donut-center"><div class="nx-donut-c-val num">' + _esc(o.centerLabel) + '</div>' +
        (o.centerSub ? '<div class="nx-donut-c-sub">' + _esc(o.centerSub) + '</div>' : '') + '</div>' : '';
    var legend = (o.legend === false) ? '' : '<div class="nx-donut-legend">' + segs.map(function (sg) {
      return '<span class="nx-jl"><span class="nx-jl-dot" style="background:' + _cv(sg.tone) + '"></span>' +
        '<span class="nx-jl-t">' + _esc(sg.label || '') + '</span>' +
        (sg.amount != null ? '<span class="nx-jl-a num">' + _esc(sg.amount) + '</span>' : '') + '</span>';
    }).join('') + '</div>';
    return '<div class="nx-donut' + _cls(o.class) + '"><div class="nx-donut-ring" style="width:' + size + 'px;height:' + size + 'px">' +
      ring + centre + '</div>' + legend + '</div>';
  }

  /* NX.trendline({ series, tone, animate, maxWidth }) — a small area+line chart:
     single-tone line, soft flat area fill (~8%, no gradient), hollow dots with the
     LAST point emphasized (filled). Uniform scale (round dots), draws in once. */
  function trendline(o) {
    o = o || {};
    var W = 320, H = 72, padX = 8, padY = 12;
    var data = (o.series || []).map(Number), tone = o.tone || 'danger', col = _cv(tone);
    var n = data.length; if (n < 2) return '';
    var min = Math.min.apply(null, data), max = Math.max.apply(null, data), range = (max - min) || Math.abs(max) || 1;
    var lo = min - range * 0.2, hi = max + range * 0.2, span = (hi - lo) || 1;
    var X = function (i) { return padX + (n === 1 ? 0 : (i / (n - 1)) * (W - 2 * padX)); };
    var Y = function (v) { return (H - padY) - ((v - lo) / span) * (H - 2 * padY); };
    var pts = data.map(function (v, i) { return X(i).toFixed(1) + ',' + Y(v).toFixed(1); });
    var area = 'M ' + X(0).toFixed(1) + ',' + (H - padY).toFixed(1) + ' L ' + pts.join(' L ') +
      ' L ' + X(n - 1).toFixed(1) + ',' + (H - padY).toFixed(1) + ' Z';
    var dots = data.map(function (v, i) {
      var last = i === n - 1;
      return '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="' + (last ? 3.4 : 2.1) +
        '" fill="' + (last ? col : 'var(--fk-bg-card)') + '" stroke="' + col + '" stroke-width="' + (last ? 0 : 1.5) + '"/>';
    }).join('');
    var animate = o.animate !== false;
    var lineAttrs = animate ? ' class="nx-arc-draw" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"' : '';
    return '<svg class="nx-trendline" width="100%" height="' + H + '" viewBox="0 0 ' + W + ' ' + H +
      '" preserveAspectRatio="xMidYMid meet" aria-hidden="true" style="display:block;max-width:' + (o.maxWidth || 360) + 'px">' +
      '<path d="' + area + '" fill="' + col + '" fill-opacity="0.08" stroke="none"/>' +
      '<polyline' + lineAttrs + ' points="' + pts.join(' ') + '" fill="none" stroke="' + col +
      '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' + dots + '</svg>';
  }

  /* NX.animateCounts(root) — count-up every [data-nx-count] once (≤400ms, ease-out).
     data-nx-fmt = compact|exact|pct|int. Honors prefers-reduced-motion (snaps). */
  function animateCounts(root) {
    root = root || document;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var fmtFn = function (fmt) {
      if (fmt === 'compact') return _fmtCompact;
      if (fmt === 'pct') return function (v) { return Number(v).toFixed(1) + '%'; };
      if (fmt === 'exact') return function (v) { return Math.round(v).toLocaleString('en-US'); };
      return function (v) { return String(Math.round(v)); };
    };
    var els = root.querySelectorAll('[data-nx-count]');
    Array.prototype.forEach.call(els, function (el) {
      if (el.getAttribute('data-nx-done')) return;
      el.setAttribute('data-nx-done', '1');
      var target = parseFloat(el.getAttribute('data-nx-count')) || 0;
      var fn = fmtFn(el.getAttribute('data-nx-fmt') || 'int');
      if (reduce) { el.textContent = fn(target); return; }
      var dur = Math.min(400, 220 + String(Math.round(Math.abs(target))).length * 20), t0 = null;
      function step(ts) {
        if (!t0) t0 = ts; var p = Math.min(1, (ts - t0) / dur), e = 1 - Math.pow(1 - p, 3);
        el.textContent = fn(target * e);
        if (p < 1) requestAnimationFrame(step); else el.textContent = fn(target);
      }
      requestAnimationFrame(step);
    });
  }

  global.NX = {
    esc: _esc, icon: icon, ichip: ichip, tabs: tabs, card: card, button: button,
    table: table, modal: modal, field: field, badge: badge, chip: chip, kpi: kpi,
    empty: empty, pageHeader: pageHeader, banner: banner,
    sparkline: sparkline, minibar: minibar, stackbar: stackbar, infoTip: infoTip,
    journeybar: journeybar, gauge: gauge, donut: donut, trendline: trendline, animateCounts: animateCounts
  };
})(window);
