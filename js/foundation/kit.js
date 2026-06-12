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
    'plus':         '<path d="M5 12h14M12 5v14"/>'
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

  /* ── Card ─────────────────────────────────────────────────────────────
     NX.card(innerHTML, { compact, flush, class }) */
  function card(inner, o) {
    o = o || {};
    var c = 'nx-card' + (o.compact ? ' nx-card--compact' : '') + (o.flush ? ' nx-card--flush' : '') + _cls(o.class);
    return '<div class="' + c + '">' + (inner || '') + '</div>';
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
    return '<div class="nx-kpi' + _cls(o.class) + '">' +
      '<div class="nx-kpi-label">' + dot + _esc(o.label || '') + '</div>' +
      '<div class="nx-kpi-value num">' + _esc(o.value == null ? '' : o.value) + '</div>' +
      delta + '</div>';
  }

  /* ── Empty state ──────────────────────────────────────────────────────
     NX.empty({ icon, message, action }) — action is raw nx-btn markup */
  function empty(o) {
    o = o || {};
    var ic = o.icon ? '<div class="nx-empty-icon">' + icon(o.icon, 28) + '</div>' : '';
    return '<div class="nx-empty">' + ic +
      '<div class="nx-empty-msg">' + _esc(o.message || '') + '</div>' +
      (o.action || '') + '</div>';
  }

  /* ── Page header ──────────────────────────────────────────────────────
     NX.pageHeader(title, actionsHTML) */
  function pageHeader(title, actions) {
    return '<div class="nx-page-header"><h1 class="nx-page-title">' + _esc(title) + '</h1>' +
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
    esc: _esc, icon: icon, card: card, button: button, table: table, modal: modal,
    field: field, badge: badge, chip: chip, kpi: kpi, empty: empty,
    pageHeader: pageHeader, banner: banner,
    sparkline: sparkline, minibar: minibar, stackbar: stackbar, infoTip: infoTip
  };
})(window);
