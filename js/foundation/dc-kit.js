/* ════════════════════════════════════════════════════════════════════════
   DAILY CLOSING — COMPONENT KIT  ·  BLUEPRINT §A11  ·  P5
   ────────────────────────────────────────────────────────────────────────
   window.DCKit. String-returning renderers plus the small amount of
   behaviour that cannot be expressed in markup — exactly the shape of the
   RMS foundation kit (js/foundation/kit.js), because a second component
   idiom in one codebase is a tax every later screen pays.

   Icons are Lucide inline SVG, the same source RMS already uses, and only
   where an icon CARRIES MEANING: the lock on a closed day, the warning on a
   variance, the empty-state mark. §A11 principle 4 forbids decorative ones.
   Colour is never the only signal — every tone is paired with a word.

   Everything renders inside `.dc`; nothing here writes a global style.
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var F = global.DCFmt;

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
  }
  function attr(o) {
    var out = '';
    for (var k in o) if (o[k] !== null && o[k] !== undefined && o[k] !== false) {
      out += ' ' + k + '="' + esc(o[k]) + '"';
    }
    return out;
  }
  var _uid = 0;
  function uid(p) { _uid += 1; return (p || 'dc') + '-' + _uid; }

  /* ── icons (Lucide paths, 24-box, currentColor) ─────────────────────── */
  var ICON = {
    lock:  '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    link:  '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    more:  '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
    down:  '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" x2="12" y1="2" y2="15"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    file:  '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h5"/>',
    // P9 — the dashboard tile's own mark, and the sidebar item's.
    wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>'
  };
  function icon(name, size) {
    var d = ICON[name]; if (!d) return '';
    var s = size || 16;
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true" focusable="false">' + d + '</svg>';
  }

  /* ── HeroFigure ──────────────────────────────────────────────────────
     Label over value. aria-live so a screen reader hears the closing
     figure change when an entry lands, without the page being re-read. */
  function heroFigure(o) {
    o = o || {};
    var tone = o.tone === 'in' ? ' dc-hero--in' : o.tone === 'out' ? ' dc-hero--out'
           : o.tone === 'warn' ? ' dc-hero--warn' : '';
    var v = o.raw !== undefined ? o.raw : F.money(o.value);
    return '<div class="dc-hero' + tone + '">' +
      '<span class="dc-label">' + esc(o.label || '') + '</span>' +
      '<span class="dc-hero-value" aria-live="polite" aria-atomic="true"' +
        attr({ id: o.id }) + '>' + esc(v) + '</span>' +
    '</div>';
  }

  /* ── StatusChip ──────────────────────────────────────────────────────
     24px pill. CLOSED carries a lock so the state is never colour alone. */
  var CHIP = {
    OPEN:      { cls: 'open',      label: 'Open' },
    CLOSED:    { cls: 'closed',    label: 'Closed', icon: 'lock' },
    PENDING:   { cls: 'pending',   label: 'Pending' },
    POSTED:    { cls: 'posted',    label: 'Posted' },
    UNAPPLIED: { cls: 'unapplied', label: 'Unapplied' },
    REFUNDED:  { cls: 'closed',    label: 'Refunded' },
    NA:        { cls: 'closed',    label: '—' }
  };
  function statusChip(status, o) {
    o = o || {};
    var c = CHIP[String(status || '').toUpperCase()] || { cls: 'closed', label: String(status || '') };
    return '<span class="dc-chip dc-chip--' + c.cls + '"' +
      attr({ title: o.title }) + '>' +
      (c.icon ? icon(c.icon, 12) : '') + esc(o.label || c.label) + '</span>';
  }

  /* ── VoucherChip — the derived CRV/CPV/BRV/BPV ───────────────────── */
  function voucherChip(type, o) {
    o = o || {};
    if (!type) return '<span class="dc-voucher dc-voucher--empty"' + attr({ id: o.id }) +
      ' aria-live="polite">' + esc(o.placeholder || '—') + '</span>';
    return '<span class="dc-voucher"' + attr({ id: o.id }) + ' aria-live="polite">' +
      esc(type) + (o.no ? '-' + esc(o.no) : '') + '</span>';
  }

  /* ── SegmentedControl — a real tablist, ←/→ per §A11 ─────────────── */
  function segmented(o) {
    o = o || {};
    var id = o.id || uid('seg');
    var html = '<div class="dc-seg" role="tablist"' + attr({ id: id, 'aria-label': o.label }) + '>';
    (o.items || []).forEach(function (it, i) {
      var sel = (o.value !== undefined ? o.value === it.value : i === 0);
      html += '<button type="button" role="tab"' +
        attr({ 'aria-selected': sel ? 'true' : 'false', 'data-value': it.value,
               tabindex: sel ? '0' : '-1', disabled: it.disabled }) +
        '>' + esc(it.label) + '</button>';
    });
    return html + '</div>';
  }

  /* Wire one segmented control. onChange(value). */
  function bindSegmented(el, onChange) {
    if (!el) return;
    var btns = function () { return [].slice.call(el.querySelectorAll('button')); };
    function select(b) {
      btns().forEach(function (x) {
        var on = x === b;
        x.setAttribute('aria-selected', on ? 'true' : 'false');
        x.tabIndex = on ? 0 : -1;
      });
      b.focus();
      if (onChange) onChange(b.getAttribute('data-value'));
    }
    el.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (b && !b.disabled) select(b);
    });
    el.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      var list = btns().filter(function (b) { return !b.disabled; });
      var i = list.indexOf(document.activeElement);
      if (i < 0) return;
      select(list[(i + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length]);
    });
  }

  /* ── MoneyInput ─────────────────────────────────────────────────────
     inputmode="decimal" gives the numeric keypad on a phone without
     type="number", which would fight the thousands separators. */
  function moneyInput(o) {
    o = o || {};
    var id = o.id || uid('money');
    return '<div class="dc-field' + (o.error ? ' dc-field--error' : '') + '">' +
      '<label class="dc-label"' + attr({ for: id }) + '>' + esc(o.label || 'Amount') +
        (o.required ? ' <span aria-hidden="true">*</span>' : '') + '</label>' +
      '<div class="dc-money-input">' +
        '<span class="dc-rs" aria-hidden="true">Rs</span>' +
        '<input' + attr({
          id: id, name: o.name || id, type: 'text', inputmode: 'decimal',
          autocomplete: 'off', value: o.value === undefined ? '' : F.maskMoney(o.value),
          placeholder: o.placeholder || '0', disabled: o.disabled,
          'aria-describedby': o.error ? id + '-err' : (o.hint ? id + '-hint' : null),
          'aria-invalid': o.error ? 'true' : null, 'aria-required': o.required ? 'true' : null
        }) + '></div>' +
      (o.error ? '<span class="dc-error" id="' + id + '-err">' + esc(o.error) + '</span>' : '') +
      (o.hint && !o.error ? '<span class="dc-hint" id="' + id + '-hint">' + esc(o.hint) + '</span>' : '') +
    '</div>';
  }

  /* Live masking. Letters never reach the value — they are refused at the
     keystroke, so "12a3" cannot silently become 123. */
  function bindMoneyInput(input, onChange) {
    if (!input) return;
    input.addEventListener('beforeinput', function (e) {
      if (e.data && /[^0-9.]/.test(e.data)) e.preventDefault();
    });
    input.addEventListener('input', function () {
      var caretFromEnd = input.value.length - (input.selectionStart || 0);
      input.value = F.maskMoney(input.value);
      var pos = Math.max(0, input.value.length - caretFromEnd);
      try { input.setSelectionRange(pos, pos); } catch (_) {}
      if (onChange) onChange(F.parseMoney(input.value));
    });
    input.addEventListener('blur', function () {
      var v = F.parseMoney(input.value);
      input.value = v === null ? '' : F.maskMoney(v.toFixed(2).replace(/\.00$/, ''));
    });
  }

  /* ── EntitySelect — typeahead, never free text (invariant 6) ──────── */
  function entitySelect(o) {
    o = o || {};
    var id = o.id || uid('ent');
    return '<div class="dc-field' + (o.error ? ' dc-field--error' : '') + '">' +
      '<label class="dc-label"' + attr({ for: id }) + '>' + esc(o.label || '') +
        (o.required ? ' <span aria-hidden="true">*</span>' : '') + '</label>' +
      '<div class="dc-entity">' +
        '<input class="dc-input"' + attr({
          id: id, type: 'text', role: 'combobox', autocomplete: 'off',
          'aria-expanded': 'false', 'aria-controls': id + '-menu', 'aria-autocomplete': 'list',
          placeholder: o.placeholder || 'Type to search…', disabled: o.disabled,
          value: o.text || ''
        }) + '>' +
        '<div class="dc-entity-menu" role="listbox" hidden' + attr({ id: id + '-menu' }) + '></div>' +
      '</div>' +
      (o.error ? '<span class="dc-error">' + esc(o.error) + '</span>' : '') +
    '</div>';
  }

  /* opts: {items:[{id,label,recent}], allowNew:bool, onPick(item), onNew(text)} */
  function bindEntitySelect(input, opts) {
    if (!input) return;
    opts = opts || {};
    var menu = document.getElementById(input.id + '-menu');
    var active = -1, shown = [];

    function render(q) {
      var all = (opts.items || []).slice();
      var recents = all.filter(function (x) { return x.recent; }).slice(0, 5);
      var rest = all.filter(function (x) { return !x.recent; });
      var list = recents.concat(rest);
      if (q) list = list.filter(function (x) { return x.label.toLowerCase().indexOf(q.toLowerCase()) >= 0; });
      shown = list;
      var html = list.map(function (x, i) {
        return '<div class="dc-entity-opt" role="option" data-i="' + i + '"' +
          ' id="' + input.id + '-o' + i + '" aria-selected="' + (i === active) + '">' +
          '<span>' + esc(x.label) + '</span>' +
          (x.recent ? '<span class="dc-recent">recent</span>' : '') + '</div>';
      }).join('');
      if (!list.length) html = '<div class="dc-entity-empty">Nothing matches “' + esc(q) + '”</div>';
      if (opts.allowNew) {
        html += '<div class="dc-entity-opt dc-entity-opt--new" role="option" data-new="1"' +
          ' id="' + input.id + '-onew" aria-selected="' + (active === list.length) + '">+ New payee</div>';
      }
      menu.innerHTML = html;
    }
    function open() { render(input.value); menu.hidden = false; input.setAttribute('aria-expanded', 'true'); }
    function close() { menu.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1;
                       input.removeAttribute('aria-activedescendant'); }
    function move(d) {
      var max = shown.length - 1 + (opts.allowNew ? 1 : 0);
      active = Math.min(max, Math.max(0, active + d));
      render(input.value);
      var el = menu.querySelector('[aria-selected="true"]');
      if (el) { el.scrollIntoView({ block: 'nearest' }); input.setAttribute('aria-activedescendant', el.id); }
    }
    function commit() {
      if (opts.allowNew && active === shown.length) { close(); if (opts.onNew) opts.onNew(input.value); return; }
      var it = shown[active < 0 ? 0 : active];
      if (!it) return;
      input.value = it.label; close();
      if (opts.onPick) opts.onPick(it);
    }
    input.addEventListener('focus', open);
    input.addEventListener('input', function () { active = -1; open(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (menu.hidden) open(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { if (!menu.hidden) { e.preventDefault(); commit(); } }
      else if (e.key === 'Escape') { if (!menu.hidden) { e.preventDefault(); close(); } }
    });
    input.addEventListener('blur', function () { setTimeout(close, 120); });
    menu.addEventListener('mousedown', function (e) {
      var o = e.target.closest('.dc-entity-opt'); if (!o) return;
      e.preventDefault();
      active = o.hasAttribute('data-new') ? shown.length : +o.getAttribute('data-i');
      commit();
    });
  }

  /* ── SuggestedField — a select that asks why when you leave the default */
  function suggestedField(o) {
    o = o || {};
    var id = o.id || uid('sug');
    var opts = (o.options || []).map(function (op) {
      return '<option' + attr({ value: op.value, selected: op.value === o.value }) + '>' +
        esc(op.label) + '</option>';
    }).join('');
    return '<div class="dc-field">' +
      '<label class="dc-label"' + attr({ for: id }) + '>' + esc(o.label || '') +
        '<span class="dc-suggested-tag">Suggested</span></label>' +
      '<select class="dc-select"' + attr({ id: id, disabled: o.disabled, 'data-default': o.defaultValue }) + '>' +
        opts + '</select>' +
      '<div class="dc-override' + (o.overrideOpen ? ' dc-open' : '') + '" id="' + id + '-ovr">' +
        '<label class="dc-label"' + attr({ for: id + '-reason' }) + '>Reason for override <span aria-hidden="true">*</span></label>' +
        '<input class="dc-input"' + attr({ id: id + '-reason', type: 'text',
          placeholder: 'Why this account and not the usual one?' }) + '>' +
      '</div>' +
    '</div>';
  }

  function bindSuggestedField(select) {
    if (!select) return;
    var box = document.getElementById(select.id + '-ovr');
    var def = select.getAttribute('data-default');
    select.addEventListener('change', function () {
      var off = select.value !== def;
      box.classList.toggle('dc-open', off);
      var r = box.querySelector('input');
      if (r) { r.required = off; if (off) r.focus(); else r.value = ''; }
    });
  }

  /* ── LedgerTable ─────────────────────────────────────────────────────
     Sticky header and sticky totals. A voided row is struck through AND
     linked to its reversal — the strike alone would say "gone", and the
     row is not gone, it is answered. */
  /* ── RowMenu ─────────────────────────────────────────────────────────
     An ADDITION to §A11, agreed in P7 — not a deviation from it. §A12 asks
     for row actions on the ledger and P6 shipped a picker plus a button
     instead, because the kit had no popover. A picker is fine with eight
     entries and unusable with forty: you cannot see which row you are about
     to void. This is the missing piece.

     It is a real menu: `aria-haspopup`, `role="menu"`, roving focus, ↑ ↓
     Home End, Esc closes and returns focus to the trigger, Tab closes,
     clicking anywhere else closes. Exactly one menu is open at a time. */
  function rowMenu(o) {
    o = o || {};
    var id = o.id || uid('menu');
    return '<div class="dc-menu">' +
      '<button type="button" class="dc-menu-btn" id="' + id + '-b" data-menu-btn' +
        ' aria-haspopup="menu" aria-expanded="false" aria-controls="' + id + '"' +
        attr({ 'aria-label': o.label || 'Row actions' }) + '>' + icon('more', 16) + '</button>' +
      '<div class="dc-menu-pop" id="' + id + '" role="menu" hidden' +
        attr({ 'aria-labelledby': id + '-b' }) + '>' +
        (o.items || []).map(function (it) {
          return '<button type="button" role="menuitem" tabindex="-1" class="dc-menu-item' +
            (it.danger ? ' dc-menu-item--danger' : '') + '"' +
            attr({ 'data-action': it.code, 'data-row': o.row }) + '>' + esc(it.label) + '</button>';
        }).join('') +
      '</div></div>';
  }

  /* One delegated listener for every menu under `root`. onPick(code, rowId). */
  function bindRowMenus(root, onPick) {
    if (!root || root.__dcMenus) return;
    root.__dcMenus = true;

    function pop(btn) { return document.getElementById(btn.getAttribute('aria-controls')); }
    function items(p) { return Array.prototype.slice.call(p.querySelectorAll('[role="menuitem"]')); }

    function closeAll(except) {
      Array.prototype.forEach.call(root.querySelectorAll('[data-menu-btn]'), function (b) {
        if (b === except) return;
        b.setAttribute('aria-expanded', 'false');
        var p = pop(b); if (p) p.hidden = true;
      });
    }
    function open(btn, focusLast) {
      closeAll(btn);
      var p = pop(btn); if (!p) return;
      btn.setAttribute('aria-expanded', 'true');
      p.hidden = false;
      var list = items(p);
      if (list.length) list[focusLast ? list.length - 1 : 0].focus();
    }
    function close(btn, refocus) {
      btn.setAttribute('aria-expanded', 'false');
      var p = pop(btn); if (p) p.hidden = true;
      if (refocus) btn.focus();
    }

    root.addEventListener('click', function (ev) {
      var btn = ev.target.closest && ev.target.closest('[data-menu-btn]');
      if (btn) {
        ev.stopPropagation();
        return btn.getAttribute('aria-expanded') === 'true' ? close(btn, true) : open(btn);
      }
      var item = ev.target.closest && ev.target.closest('[role="menuitem"]');
      if (item) {
        ev.stopPropagation();
        var owner = document.getElementById(item.parentNode.getAttribute('aria-labelledby'));
        close(owner, false);
        if (onPick) onPick(item.getAttribute('data-action'), item.getAttribute('data-row'));
        return;
      }
      closeAll(null);
    });

    root.addEventListener('keydown', function (ev) {
      var btn = ev.target.closest && ev.target.closest('[data-menu-btn]');
      if (btn) {
        if (ev.key === 'ArrowDown' || ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault(); return open(btn);
        }
        if (ev.key === 'ArrowUp') { ev.preventDefault(); return open(btn, true); }
        if (ev.key === 'Escape') return close(btn, true);
        return;
      }
      var item = ev.target.closest && ev.target.closest('[role="menuitem"]');
      if (!item) return;
      var p = item.parentNode, list = items(p), i = list.indexOf(item);
      var owner = document.getElementById(p.getAttribute('aria-labelledby'));
      if (ev.key === 'ArrowDown') { ev.preventDefault(); list[(i + 1) % list.length].focus(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
      else if (ev.key === 'Home') { ev.preventDefault(); list[0].focus(); }
      else if (ev.key === 'End') { ev.preventDefault(); list[list.length - 1].focus(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); close(owner, true); }
      else if (ev.key === 'Tab') { close(owner, false); }
    });

    // A menu left open behind a click elsewhere on the page is a menu the
    // keyboard can still reach but the eye has lost.
    document.addEventListener('click', function (ev) {
      if (!root.contains(ev.target)) closeAll(null);
    });
  }

  function ledgerTable(o) {
    o = o || {};
    var rows = (o.rows || []).map(function (r) {
      return '<tr' + attr({ class: r.voided ? 'dc-voided' : null }) + '>' +
        '<td class="dc-num">' + esc(r.seq) + '</td>' +
        '<td>' + voucherChip(r.voucherType, { no: r.voucherNo }) + '</td>' +
        '<td>' + esc(r.payee || '—') + '</td>' +
        '<td>' + esc(r.narration || '') + '</td>' +
        '<td class="dc-num dc-in-col">'  + (r.in  ? esc(F.amount(r.in))  : '') + '</td>' +
        '<td class="dc-num dc-out-col">' + (r.out ? esc(F.amount(r.out)) : '') + '</td>' +
        '<td class="dc-linkcell">' + (r.voided
          ? '<a class="dc-link" href="#' + esc(r.reversalId || '') + '" title="Go to its reversal" aria-label="Go to the reversal of voucher ' + esc(r.voucherNo) + '">' + icon('link', 14) + '</a>'
          : (r.actions && r.actions.length
              ? rowMenu({ row: r.id, items: r.actions,
                          label: 'Actions for voucher ' + (r.voucherType || '') + '-' + (r.voucherNo || '') })
              : '')) + '</td>' +
      '</tr>';
    }).join('');
    var t = o.totals || {};
    return '<div class="dc-ledger-wrap"><table class="dc-ledger">' +
      '<thead><tr><th class="dc-num">#</th><th>Voucher</th><th>Payee</th><th>Narration</th>' +
      '<th class="dc-num">In</th><th class="dc-num">Out</th><th></th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '<tfoot><tr><td></td><td>Total</td><td></td><td></td>' +
        '<td class="dc-num dc-in-col" aria-live="polite">'  + esc(F.amount(t.in || 0))  + '</td>' +
        '<td class="dc-num dc-out-col" aria-live="polite">' + esc(F.amount(t.out || 0)) + '</td>' +
        '<td></td></tr></tfoot>' +
    '</table></div>';
  }

  /* ── VarianceBanner ─────────────────────────────────────────────────── */
  function varianceBanner(o) {
    o = o || {};
    var id = o.id || uid('var');
    var short = (o.variance || 0) < 0;
    return '<div class="dc-variance" role="group"' + attr({ 'aria-labelledby': id + '-t' }) + '>' +
      icon('alert', 18) +
      '<div class="dc-variance-body">' +
        '<div class="dc-variance-title" id="' + id + '-t">Variance ' + esc(F.amount(o.variance)) +
          ' — the drawer is ' + (short ? 'short' : 'over') + '</div>' +
        '<label class="dc-label" for="' + id + '-r" style="margin-top:8px">Reason for variance <span aria-hidden="true">*</span></label>' +
        '<input class="dc-input" id="' + id + '-r" type="text" required' +
          ' placeholder="Say what happened" aria-required="true">' +
      '</div></div>';
  }

  /* ── DenominationCounter ────────────────────────────────────────────── */
  var FACES = [5000, 1000, 500, 100, 50, 20, 10];
  function denominationCounter(o) {
    o = o || {};
    var id = o.id || uid('den');
    var counts = o.counts || {};
    var rows = FACES.map(function (f) {
      var n = counts[f] || 0;
      return '<label class="dc-den-face" for="' + id + '-' + f + '">' + F.amount(f) + ' ×</label>' +
        '<input' + attr({ id: id + '-' + f, type: 'text', inputmode: 'numeric',
          'data-face': f, value: n || '', 'aria-label': F.amount(f) + ' rupee notes' }) + '>' +
        '<span class="dc-den-line dc-num" data-line="' + f + '">' + F.amount(f * n) + '</span>';
    }).join('');
    return '<div class="dc-den"' + attr({ id: id }) + '>' + rows +
      '<div class="dc-den-total"><span>Counted</span>' +
        '<span class="dc-num" data-total aria-live="polite">' + F.amount(o.total || 0) + '</span></div>' +
    '</div>';
  }

  function bindDenominationCounter(root, onTotal) {
    if (!root) return;
    function recalc() {
      var total = 0;
      FACES.forEach(function (f) {
        var i = root.querySelector('[data-face="' + f + '"]');
        var n = parseInt(String(i.value).replace(/[^0-9]/g, ''), 10) || 0;
        i.value = n ? String(n) : '';
        total += f * n;
        root.querySelector('[data-line="' + f + '"]').textContent = F.amount(f * n);
      });
      root.querySelector('[data-total]').textContent = F.amount(total);
      if (onTotal) onTotal(total);
    }
    root.addEventListener('input', recalc);
    recalc();
  }

  /* ── LockBadge · EmptyState · Skeleton · Toast ───────────────────────── */
  function lockBadge(o) {
    o = o || {};
    return '<span class="dc-lockbadge">' + icon('lock', 14) +
      'Closed ' + esc(o.at || '') + (o.by ? ' · ' + esc(o.by) : '') + '</span>';
  }

  function emptyState(o) {
    o = o || {};
    return '<div class="dc-empty">' + icon(o.icon || 'inbox', 48) +
      '<p>' + esc(o.message || '') + '</p>' +
      (o.action ? '<button type="button" class="dc-btn dc-btn--primary"' +
        attr({ id: o.actionId }) + '>' + esc(o.action) + '</button>' : '') +
    '</div>';
  }

  function skeleton(o) {
    o = o || {};
    return '<div class="dc-skel" role="status" aria-label="Loading"' +
      attr({ style: 'width:' + (o.width || '100%') + ';height:' + (o.height || '16px') }) + '></div>';
  }

  /* Bottom-centre, 3 s, never more than two stacked (§A11).
     ── BURST COLLAPSING ──────────────────────────────────────────────────
     Saving four entries in a row used to raise four near-identical toasts
     that pushed each other off the screen, so the cashier read none of them.
     A toast raised with a `collapse` key inside 2.5 s of another with the
     same key REPLACES it and counts up: "CRV-0041 recorded" becomes
     "2 entries recorded", then "3 entries recorded". Distinct messages —
     an error, a void — keep their own line. */
  var _burst = {};   // key → { el, n, timer }

  function _host() {
    var h = document.querySelector('.dc .dc-toasts');
    if (!h) {
      h = document.createElement('div');
      h.className = 'dc-toasts';
      (document.querySelector('.dc') || document.body).appendChild(h);
    }
    return h;
  }

  function toast(message, opts) {
    opts = opts || {};
    var host = _host();
    var key = opts.collapse;

    if (key && _burst[key] && _burst[key].el.parentNode) {
      var b = _burst[key];
      b.n += 1;
      b.el.textContent = opts.plural ? opts.plural(b.n) : (b.n + ' × ' + message);
      clearTimeout(b.timer);
      b.timer = setTimeout(function () { _dismiss(key, b.el); }, 3000);
      return b.el;
    }

    while (host.children.length >= 2) host.removeChild(host.firstChild);
    var el = document.createElement('div');
    el.className = 'dc-toast';
    el.setAttribute('role', 'status');
    el.textContent = message;
    host.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('dc-in'); });

    var t = setTimeout(function () { _dismiss(key, el); }, 3000);
    if (key) _burst[key] = { el: el, n: 1, timer: t };
    return el;
  }

  function _dismiss(key, el) {
    if (key && _burst[key] && _burst[key].el === el) delete _burst[key];
    el.classList.remove('dc-in');
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 200);
  }

  /* ── Dialog ──────────────────────────────────────────────────────────
     A real modal, because window.prompt() cannot be styled, cannot hold two
     fields, cannot mark one required, and looks like 1998 in the middle of a
     screen that does not. Returns a promise: an object of values, or null if
     the person backed out.

     Focus moves in on open and returns to whatever had it on close; Esc
     cancels; the backdrop is inert to clicks so a half-typed reason cannot be
     lost by a stray one. */
  function dialog(o) {
    o = o || {};
    return new Promise(function (resolve) {
      var prev = document.activeElement;
      var host = document.querySelector('.dc') || document.body;
      var wrap = document.createElement('div');
      wrap.className = 'dc-modal-back';
      var id = uid('dlg');
      wrap.innerHTML =
        '<div class="dc-modal" role="dialog" aria-modal="true" aria-labelledby="' + id + '-t">' +
          '<div class="dc-modal-t" id="' + id + '-t">' + esc(o.title || '') + '</div>' +
          (o.message ? '<p class="dc-hint" style="margin:0 0 12px">' + esc(o.message) + '</p>' : '') +
          '<form>' +
          (o.fields || []).map(function (f, i) {
            var fid = id + '-f' + i;
            if (f.type === 'money') {
              return moneyInput({ id: fid, label: f.label, required: f.required, value: f.value });
            }
            if (f.type === 'select') {
              return '<div class="dc-field"><label class="dc-label" for="' + fid + '">' + esc(f.label) + '</label>' +
                '<select class="dc-select" id="' + fid + '">' +
                (f.options || []).map(function (op) {
                  return '<option value="' + esc(op.value) + '">' + esc(op.label) + '</option>';
                }).join('') + '</select></div>';
            }
            return '<div class="dc-field"><label class="dc-label" for="' + fid + '">' + esc(f.label) +
              (f.required ? ' <span aria-hidden="true">*</span>' : '') + '</label>' +
              '<input class="dc-input" id="' + fid + '" type="text"' +
              attr({ placeholder: f.placeholder, value: f.value,
                     'aria-required': f.required ? 'true' : null }) + '></div>';
          }).join('') +
          '<span class="dc-error" id="' + id + '-err" hidden></span>' +
          '<div class="dc-row-between" style="justify-content:flex-end;margin-top:8px">' +
            '<button type="button" class="dc-btn" data-cancel>Cancel</button>' +
            '<button type="submit" class="dc-btn dc-btn--primary">' + esc(o.confirm || 'Save') + '</button>' +
          '</div></form>' +
        '</div>';
      host.appendChild(wrap);

      var form = wrap.querySelector('form');
      (o.fields || []).forEach(function (f, i) {
        if (f.type === 'money') bindMoneyInput(document.getElementById(id + '-f' + i));
      });
      var first = wrap.querySelector('input, select');
      if (first) first.focus();

      function close(val) {
        wrap.remove();
        if (prev && prev.focus) prev.focus();
        resolve(val);
      }
      wrap.querySelector('[data-cancel]').addEventListener('click', function () { close(null); });
      wrap.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.preventDefault(); close(null); }
      });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var out = {}, missing = null;
        (o.fields || []).forEach(function (f, i) {
          var node = document.getElementById(id + '-f' + i);
          var v = node.value.trim();
          if (f.type === 'money') v = global.DCFmt.parseMoney(v);
          if (f.required && (v === '' || v === null)) missing = missing || f;
          out[f.name || ('f' + i)] = v;
        });
        if (missing) {
          var err = document.getElementById(id + '-err');
          err.textContent = missing.label + ' is required.';
          err.hidden = false;
          return;
        }
        close(out);
      });
    });
  }

  /* ── SidePanel ───────────────────────────────────────────────────────
     §A12's close panel is 480 px on the right, not a modal in the middle:
     the cashier counts notes with the day's ledger still visible beside the
     count. It is still a dialog to a screen reader — `aria-modal`, focus
     moves in, Esc and the backdrop close it, and focus returns to whatever
     opened it. Below 640 px it becomes a full-height sheet, because 480 px
     of panel on a 375 px phone is a modal wearing a disguise.

     open() returns a handle: { el, setBody, close }. The caller owns the
     content — this only owns the shell and the focus. */
  function sidePanel(o) {
    o = o || {};
    var prev = document.activeElement;
    var id = uid('panel');

    /* IT LIVES OUTSIDE THE SCREEN'S ROOT, DELIBERATELY. The panel stays open
       across a reload of the day underneath it — a VERSION_CONFLICT reloads,
       and so does a successful close before the sheet is offered — and the
       screen reloads by rewriting root.innerHTML. A panel parented inside
       that root would simply vanish mid-flow. It carries its own `.dc` so
       the module's styles still reach it. */
    var host = document.createElement('div');
    host.className = 'dc';
    document.body.appendChild(host);
    var wrap = document.createElement('div');
    wrap.className = 'dc-panel-back';
    wrap.innerHTML =
      '<aside class="dc-panel" role="dialog" aria-modal="true" aria-labelledby="' + id + '-t">' +
        '<div class="dc-panel-head">' +
          '<div>' +
            '<div class="dc-panel-t" id="' + id + '-t">' + esc(o.title || '') + '</div>' +
            (o.subtitle ? '<div class="dc-panel-sub">' + esc(o.subtitle) + '</div>' : '') +
          '</div>' +
          '<button type="button" class="dc-icon-btn" data-panel-close aria-label="Close this panel">' +
            icon('close', 18) + '</button>' +
        '</div>' +
        '<div class="dc-panel-body" data-panel-body></div>' +
      '</aside>';
    host.appendChild(wrap);

    var panel = wrap.querySelector('.dc-panel');
    var body = wrap.querySelector('[data-panel-body]');
    var closed = false;

    function close() {
      if (closed) return;
      closed = true;
      host.remove();
      if (prev && prev.focus) prev.focus();
      if (o.onClose) o.onClose();
    }
    function focusFirst() {
      var f = panel.querySelector('input, select, textarea, button:not([data-panel-close])');
      (f || panel.querySelector('[data-panel-close]')).focus();
    }

    wrap.querySelector('[data-panel-close]').addEventListener('click', close);
    wrap.addEventListener('mousedown', function (e) { if (e.target === wrap) close(); });
    wrap.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); return close(); }
      if (e.key !== 'Tab') return;
      var f = Array.prototype.filter.call(
        panel.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'),
        function (n) { return !n.disabled && n.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    return {
      el: panel, body: body, close: close, focusFirst: focusFirst,
      setBody: function (html) { body.innerHTML = html; }
    };
  }

  global.DCKit = {
    dialog: dialog, sidePanel: sidePanel,
    rowMenu: rowMenu, bindRowMenus: bindRowMenus,
    esc: esc, icon: icon, FACES: FACES,
    heroFigure: heroFigure, statusChip: statusChip, voucherChip: voucherChip,
    segmented: segmented, bindSegmented: bindSegmented,
    moneyInput: moneyInput, bindMoneyInput: bindMoneyInput,
    entitySelect: entitySelect, bindEntitySelect: bindEntitySelect,
    suggestedField: suggestedField, bindSuggestedField: bindSuggestedField,
    ledgerTable: ledgerTable, varianceBanner: varianceBanner,
    denominationCounter: denominationCounter, bindDenominationCounter: bindDenominationCounter,
    lockBadge: lockBadge, emptyState: emptyState, skeleton: skeleton, toast: toast
  };
})(window);
