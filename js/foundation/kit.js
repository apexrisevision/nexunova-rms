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
    'history':      '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>'
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
  function _cv(tone) { return 'var(--fk-' + (tone || 'primary') + ')'; }
  var _nxUid = 0;

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

  global.NX = {
    esc: _esc, icon: icon, ichip: ichip, tabs: tabs, card: card, button: button,
    table: table, modal: modal, field: field, badge: badge, chip: chip, kpi: kpi,
    empty: empty, pageHeader: pageHeader, banner: banner,
    sparkline: sparkline, minibar: minibar, stackbar: stackbar, infoTip: infoTip
  };
})(window);
