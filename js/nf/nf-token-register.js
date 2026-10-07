/**
 * NexuFinance v1 — Unit-wise Token Ledger (was the Token Money Register).
 * window.NfTokenRegister.mount(root, ctx)
 *
 * ctx = { api, companyId, role, displayName, companyName, settings, onBack }
 *
 * One row per unit: every POSTED 21100 leg, its units read from the leg
 * memo, a voucher the memo names, the narration, or the placeholder party's
 * name, split across those units (nf_get_token_register, migration
 * 20261007b). Each unit is compared with the received token on its active
 * reservation; a difference is shown in red with its reason. Click a unit
 * to see the vouchers behind it; double-click a voucher to open it.
 * Below: units the books name that are not in the unit list, money that
 * names no unit, and the 21150 Not Allocated money per party. Both totals
 * are checked against the account balances (21100 and 21150).
 *
 * Row markup is CSS Grid divs (.tkl), not a <table> (docs/PLAN.md §16.3).
 */
(function (global) {
  'use strict';
  var F = global.NfFmt;
  function esc(s) { return F.esc(s); }
  function money(v) { return F.fmt(v); }

  function mount(root, ctx) {
    var gen = 0;
    var alive = true;
    var trueOnBack = ctx.onBack;
    ctx = Object.assign({}, ctx, { onBack: function () { alive = false; trueOnBack(); } });

    function load(range) {
      var myGen = ++gen;
      render(root, ctx, null, range, load);
      return ctx.api.getTokenRegister(ctx.companyId, range.from || null, range.to || null).then(function (r) {
        if (!alive || myGen !== gen) return;
        render(root, ctx, r, range, load);
      }).catch(function (e) {
        if (!alive || myGen !== gen) return;
        root.innerHTML = '<div class="nf-gate"><h2>Could not open the token ledger</h2><p>' + esc(e.message || String(e)) + '</p>' +
          '<button class="btn" id="nf-tkr-back" type="button">' + esc(ctx.backLabel || '← Back to closing sheet') + '</button></div>';
        var back = root.querySelector('#nf-tkr-back');
        if (back) back.addEventListener('click', function () { ctx.onBack(); });
      });
    }

    // ctx.from/ctx.to: reopened by Back from a drill (js/nf/nf-drill.js)
    load({ from: ctx.from || '', to: ctx.to || '' });
  }

  function lines(list) {
    return '<div class="tklines" hidden>' + (list || []).map(function (l) {
      return '<div class="tkline" data-vno="' + esc(l.system_no || l.voucher_no) + '" data-date="' + esc(l.date) + '" title="Double-click to open this voucher">' +
        '<span>' + F.ddMonYyyy(l.date) + '</span>' +
        '<span>' + esc(l.voucher_no) + '</span>' +
        '<span class="wrap">' + esc(l.party || '') + '</span>' +
        '<span class="muted wrap">' + esc(l.how || '') + '</span>' +
        '<span class="r' + (F.n(l.amount) < 0 ? ' neg' : '') + '">' + money(l.amount) + '</span>' +
        '</div>';
    }).join('') + '</div>';
  }

  function unitRows(list, compare) {
    return (list || []).map(function (u) {
      var diff = F.n(u.difference);
      var off = compare && diff !== 0;
      return '<div class="tkunit' + (off ? ' off' : '') + '">' +
        '<div class="tkl nf-drill" data-toggle title="Show the vouchers behind this unit">' +
        '<span><b>' + esc(u.unit_code) + '</b></span>' +
        '<span>' + esc(u.floor || '') + '</span>' +
        '<span class="wrap">' + esc(u.buyer || '') + '</span>' +
        '<span class="wrap">' + esc(u.tokens || '') + '</span>' +
        '<span>' + F.ddMonYyyy(u.first_date) + '</span>' +
        '<span>' + F.ddMonYyyy(u.last_date) + '</span>' +
        '<span class="r">' + money(u.received) + '</span>' +
        '<span class="r">' + (F.n(u.returned) ? money(u.returned) : '') + '</span>' +
        '<span class="r"><b>' + money(u.net) + '</b></span>' +
        '<span class="r">' + (compare ? money(u.reservation_token) : '') + '</span>' +
        '<span class="r">' + (compare ? (off ? '<b class="tkflag">' + money(diff) + '</b>' : '<span class="tkok">0</span>') : '') + '</span>' +
        '</div>' +
        (off && u.note ? '<div class="tknote">' + esc(u.note) + '</div>' : '') +
        lines(u.lines) +
        '</div>';
    }).join('');
  }

  function head(compare) {
    return '<div class="tkl tkhead"><span>Unit</span><span>Floor</span><span>Buyer</span><span>Token / Receipt #</span>' +
      '<span>First</span><span>Last</span><span class="r">Received</span><span class="r">Returned</span><span class="r">Net</span>' +
      '<span class="r">' + (compare ? 'Reservation' : '') + '</span><span class="r">' + (compare ? 'Difference' : '') + '</span></div>';
  }

  function tie(label, figure, book, code) {
    var ok = F.n(figure) === F.n(book);
    return '<div class="rtile' + (ok ? '' : ' tkbad') + '"><small>' + esc(label) + '</small><b>Rs ' + money(figure) + '</b>' +
      '<em class="' + (ok ? 'tkok' : 'tkflag') + '">' + (ok ? '✓ equals ' + code + ' (Balance Sheet)' : '✗ ' + code + ' is Rs ' + money(book)) + '</em></div>';
  }

  function body(r, range) {
    var t = r.totals || {};
    var compare = !!r.compare_reservations;
    var nil = r.not_in_unit_list || [];
    var nu = r.no_unit || { net: 0, lines: [] };
    var na = r.not_allocated || [];

    var out = '<section class="rsec rtiles-wrap"><div class="rtiles">' +
      '<div class="rtile"><small>Units holding token money</small><b>' + F.n(t.units) + '</b></div>' +
      tie('Unit net total', t.unit_net_total, t.gl_21100, '21100') +
      tie('Not allocated', t.not_allocated_total, t.gl_21150, '21150') +
      (compare
        ? '<div class="rtile' + (F.n(t.units_off) ? ' tkbad' : '') + '"><small>Units that differ from the reservation</small><b>' + F.n(t.units_off) + '</b>' +
          '<em class="' + (F.n(t.units_off) ? 'tkflag' : 'tkok') + '">Reservations total Rs ' + money(t.reservations) + '</em></div>'
        : '<div class="rtile"><small>Reservation check</small><b>—</b><em class="muted">Only for "All time" or a range that starts at the beginning</em></div>') +
      '</div></section>';

    out += '<section class="rsec"><div class="rsh"><h2>Units</h2><span class="muted">Click a unit for its vouchers</span></div><div class="tktab">' + head(compare) +
      (unitRows(r.units, compare) || '<div class="tkl muted"><span style="grid-column:1/-1;text-align:center;padding:16px">No token money in this range</span></div>') +
      '<div class="tkl tktot"><span>Total</span><span></span><span></span><span></span><span></span><span></span>' +
      '<span class="r">' + money(t.received) + '</span><span class="r">' + money(t.returned) + '</span>' +
      '<span class="r"><b>' + money(t.units_net) + '</b></span><span class="r">' + (compare ? money(t.reservations) : '') + '</span>' +
      '<span class="r">' + (compare ? money(F.n(t.units_net) - F.n(t.reservations)) : '') + '</span></div>' +
      '</div></section>';

    if (nil.length) {
      out += '<section class="rsec"><div class="rsh"><h2>Not in unit list</h2><span class="muted">The books name these units, the RMS unit list does not have them</span></div><div class="tktab">' + head(false) +
        unitRows(nil, false) + '</div></section>';
    }
    if ((nu.lines || []).length) {
      out += '<section class="rsec"><div class="rsh"><h2>Names no unit</h2><span class="muted">Net Rs ' + money(nu.net) + '</span></div><div class="tktab">' +
        (nu.lines || []).map(function (l) {
          return '<div class="tkline" data-vno="' + esc(l.system_no || l.voucher_no) + '" data-date="' + esc(l.date) + '"><span>' + F.ddMonYyyy(l.date) + '</span><span>' + esc(l.voucher_no) + '</span>' +
            '<span class="wrap">' + esc(l.party || '') + '</span><span></span><span class="r' + (F.n(l.amount) < 0 ? ' neg' : '') + '">' + money(l.amount) + '</span></div>';
        }).join('') + '</div></section>';
    }

    out += '<section class="rsec"><div class="rsh"><h2>Not Allocated (21150)</h2><span class="muted">Token money not yet against a unit or a named buyer</span></div><div class="tktab">' +
      '<div class="tkna tkhead"><span>Party</span><span>Date</span><span>Voucher</span><span>Narration</span><span class="r">Amount</span></div>' +
      (na.map(function (p) {
        return (p.items || []).map(function (it, i) {
          return '<div class="tkna" data-vno="' + esc(it.system_no || it.voucher_no) + '" data-date="' + esc(it.date) + '" title="Double-click to open this voucher">' +
            '<span class="wrap">' + (i === 0 ? '<b>' + esc(p.party) + '</b>' : '') + '</span>' +
            '<span>' + F.ddMonYyyy(it.date) + '</span><span>' + esc(it.voucher_no) + '</span>' +
            '<span class="wrap">' + esc(it.memo ? it.memo : it.narration || '') + (it.memo && it.narration ? '<br><small class="muted">' + esc(it.narration) + '</small>' : '') + '</span>' +
            '<span class="r' + (F.n(it.amount) < 0 ? ' neg' : '') + '">' + money(it.amount) + '</span></div>';
        }).join('') + ((p.items || []).length > 1
          ? '<div class="tkna tksub"><span></span><span></span><span></span><span>' + esc(p.party) + ' total</span><span class="r"><b>' + money(p.amount) + '</b></span></div>' : '');
      }).join('') || '<div class="tkna muted"><span style="grid-column:1/-1;text-align:center;padding:12px">Nothing waiting to be allocated</span></div>') +
      '<div class="tkna tktot"><span>Total Not Allocated</span><span></span><span></span><span></span><span class="r"><b>' + money(t.not_allocated_total) + '</b></span></div>' +
      '</div></section>';

    out += '<section class="rsec tkgrand"><div><span>Token money held on units (21100)</span><b>Rs ' + money(t.unit_net_total) + '</b></div>' +
      '<div><span>Not allocated (21150)</span><b>Rs ' + money(t.not_allocated_total) + '</b></div>' +
      '<div><span>Total token money held</span><b>Rs ' + money(F.n(t.unit_net_total) + F.n(t.not_allocated_total)) + '</b></div></section>';
    return out;
  }

  function render(root, ctx, r, range, load) {
    var mark = esc(ctx.settings.mark || 'NF');
    var companyLine = esc(ctx.settings.company_line || ctx.companyName || '');

    root.innerHTML = '' +
      '<div class="sheet tkrsheet">' +
      '<header class="hdr">' +
      '  <div class="brand">' + F.brandMark(mark) +
      '    <div><div class="co">' + companyLine + '</div><h1>Unit-wise Token Ledger</h1></div></div>' +
      '  <div class="actions">' +
      '    <button class="btn" id="nf-tkr-back" type="button">' + esc(ctx.backLabel || '← Back to closing sheet') + '</button>' +
      global.NfReportsMenu.html('token') +
      '    <button class="btn primary" id="nf-tkr-print" type="button">Save as PDF</button>' +
      '  </div>' +
      '</header>' +
      '<section class="rsec tkrfilter">' +
      '  <label>From <input type="date" id="nf-tkr-from" value="' + esc(range.from) + '"></label>' +
      '  <label>To <input type="date" id="nf-tkr-to" value="' + esc(range.to) + '"></label>' +
      '  <button class="btn" id="nf-tkr-apply" type="button">Apply</button>' +
      '  <button class="btn" id="nf-tkr-clear" type="button">All time</button>' +
      '</section>' +
      '<div id="nf-tkr-body">' + (r ? body(r, range) : '<p class="muted" style="padding:18px 0;text-align:center">Loading…</p>') + '</div>' +
      '<div class="docfoot"><span>' + esc(ctx.companyName || '') + ' · Unit-wise Token Ledger</span>' +
      '<span>' + (range.from || range.to ? (range.from || '…') + ' – ' + (range.to || '…') : 'All time') + '</span></div>' +
      '</div>';

    root.querySelector('#nf-tkr-back').addEventListener('click', function () { ctx.onBack(); });
    root.querySelector('#nf-tkr-print').addEventListener('click', function () {
      // the PDF carries every unit's vouchers, opened
      [].forEach.call(root.querySelectorAll('.tklines'), function (el) { el.setAttribute('data-was', el.hidden ? '1' : ''); el.hidden = false; });
      global.print();
      [].forEach.call(root.querySelectorAll('.tklines'), function (el) { el.hidden = el.getAttribute('data-was') === '1'; });
    });
    global.NfReportsMenu.wire(root, ctx);
    [].forEach.call(root.querySelectorAll('[data-toggle]'), function (row) {
      row.addEventListener('click', function () {
        var box = row.parentNode.querySelector('.tklines');
        if (box) box.hidden = !box.hidden;
      });
    });
    var here = { from: range.from, to: range.to };
    global.NfDrill.on(root, '[data-vno]', 'dblclick', function (el) {
      global.NfDrill.entry(root, ctx, {
        voucherNo: el.getAttribute('data-vno'), date: el.getAttribute('data-date'),
        backLabel: '← Back to Token Ledger',
        onBack: function () { global.NfTokenRegister.mount(root, Object.assign({}, ctx, here)); },
      });
    });
    root.querySelector('#nf-tkr-apply').addEventListener('click', function () {
      load({ from: root.querySelector('#nf-tkr-from').value, to: root.querySelector('#nf-tkr-to').value });
    });
    root.querySelector('#nf-tkr-clear').addEventListener('click', function () {
      load({ from: '', to: '' });
    });
  }

  global.NfTokenRegister = { mount: mount };
})(window);
