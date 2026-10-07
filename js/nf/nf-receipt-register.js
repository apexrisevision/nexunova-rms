/**
 * NexuFinance v1 — Receipt / Token Number Register.
 * window.NfReceiptRegister.mount(root, ctx)
 *
 * Which receipt / token numbers are used, used twice, or missing, and which
 * token receipts carry no number at all (nf_get_receipt_register, migration
 * 20261007b). A token receipt is a POSTED voucher that brings money into
 * 21100 / 21150 from outside. Its number comes from its own narration or
 * memo ("Token #126", "Receipt #158", "Token 101"), or from a later JV that
 * gives it one ("Receipt #146 — LG-56/99 (BRV-0013)"); those show "via JV".
 * Used twice = the same number on two vouchers of different buyers.
 */
(function (global) {
  'use strict';
  var F = global.NfFmt;
  function esc(s) { return F.esc(s); }

  function mount(root, ctx) {
    var gen = 0;
    var alive = true;
    var trueOnBack = ctx.onBack;
    ctx = Object.assign({}, ctx, { onBack: function () { alive = false; trueOnBack(); } });

    function load(range) {
      var myGen = ++gen;
      render(root, ctx, null, range, load);
      return ctx.api.getReceiptRegister(ctx.companyId, range.from || null, range.to || null).then(function (r) {
        if (!alive || myGen !== gen) return;
        render(root, ctx, r, range, load);
      }).catch(function (e) {
        if (!alive || myGen !== gen) return;
        root.innerHTML = '<div class="nf-gate"><h2>Could not open the receipt register</h2><p>' + esc(e.message || String(e)) + '</p>' +
          '<button class="btn" id="nf-rcr-back" type="button">' + esc(ctx.backLabel || '← Back to closing sheet') + '</button></div>';
        var back = root.querySelector('#nf-rcr-back');
        if (back) back.addEventListener('click', function () { ctx.onBack(); });
      });
    }
    load({ from: ctx.from || '', to: ctx.to || '' });
  }

  function vouchers(list) {
    return (list || []).map(function (v) {
      return '<span class="rcv" data-vno="' + esc(v.system_no || v.voucher_no) + '" data-date="' + esc(v.date) + '" title="Double-click to open this voucher">' +
        esc(v.voucher_no) + (v.via ? ' <small class="muted">via ' + esc(v.via) + '</small>' : '') + '</span>';
    }).join(', ');
  }

  function numRow(n) {
    return '<div class="rcrow' + (n.duplicate ? ' dup' : '') + '">' +
      '<span><b>#' + esc(n.no) + '</b></span>' +
      '<span>' + F.ddMonYyyy(n.first_date) + '</span>' +
      '<span class="wrap">' + vouchers(n.vouchers) + '</span>' +
      '<span class="wrap">' + esc(n.buyer || '') + '</span>' +
      '<span class="wrap">' + esc(n.units || '') + '</span>' +
      '<span class="r">' + F.fmtLakh(n.amount) + '</span>' +
      '<span>' + (n.duplicate ? '<b class="tkflag">Used twice</b>' : '') + '</span>' +
      '</div>';
  }

  function body(r) {
    var t = r.totals || {};
    var dups = (r.numbers || []).filter(function (n) { return n.duplicate; });
    var gaps = r.gaps || [];
    var none = r.no_number || [];
    var head = '<div class="rcrow tkhead"><span>Number</span><span>Date</span><span>Voucher(s)</span><span>Buyer</span><span>Units</span><span class="r">Amount</span><span></span></div>';

    return '' +
      '<section class="rsec rtiles-wrap"><div class="rtiles">' +
      '<div class="rtile"><small>Numbers used</small><b>' + F.n(t.numbers) + '</b><em class="muted">#' + esc(r.lowest || '–') + ' to #' + esc(r.highest || '–') + '</em></div>' +
      '<div class="rtile' + (dups.length ? ' tkbad' : '') + '"><small>Used twice</small><b>' + dups.length + '</b>' +
        '<em class="' + (dups.length ? 'tkflag' : 'tkok') + '">' + (dups.length ? dups.map(function (n) { return '#' + n.no; }).join(', ') : 'none') + '</em></div>' +
      '<div class="rtile' + (gaps.length ? ' tkbad' : '') + '"><small>Missing numbers</small><b>' + gaps.length + '</b>' +
        '<em class="' + (gaps.length ? 'tkflag' : 'tkok') + '">' + (gaps.length ? 'between #' + esc(r.lowest) + ' and #' + esc(r.highest) : 'none') + '</em></div>' +
      '<div class="rtile' + (none.length ? ' tkbad' : '') + '"><small>Receipts with no number</small><b>' + none.length + '</b>' +
        '<em class="' + (none.length ? 'tkflag' : 'tkok') + '">Rs ' + F.fmtLakh(t.no_number_amount) + '</em></div>' +
      '</div></section>' +

      (dups.length ? '<section class="rsec"><div class="rsh"><h2>Used twice</h2><span class="muted">The same number on vouchers of different buyers</span></div><div class="tktab">' +
        head + dups.map(numRow).join('') + '</div></section>' : '') +

      '<section class="rsec"><div class="rsh"><h2>Missing numbers</h2><span class="muted">Not on any token receipt between the lowest and the highest</span></div>' +
      (gaps.length ? '<div class="rcgaps">' + gaps.map(function (g) { return '<span>#' + esc(g) + '</span>'; }).join('') + '</div>'
        : '<p class="muted">None.</p>') + '</section>' +

      '<section class="rsec"><div class="rsh"><h2>Token receipts with no number</h2><span class="muted">' + none.length + (none.length === 1 ? ' receipt' : ' receipts') + '</span></div><div class="tktab">' +
      '<div class="rcnone tkhead"><span>Date</span><span>Voucher</span><span>Buyer</span><span>Narration</span><span class="r">Amount</span></div>' +
      (none.map(function (x) {
        return '<div class="rcnone" data-vno="' + esc(x.system_no || x.voucher_no) + '" data-date="' + esc(x.date) + '" title="Double-click to open this voucher">' +
          '<span>' + F.ddMonYyyy(x.date) + '</span><span><b>' + esc(x.voucher_no) + '</b></span><span class="wrap">' + esc(x.buyer || '') + '</span>' +
          '<span class="wrap">' + esc(x.narration || '') + '</span><span class="r">' + F.fmtLakh(x.amount) + '</span></div>';
      }).join('') || '<div class="rcnone muted"><span style="grid-column:1/-1;text-align:center;padding:12px">Every token receipt has a number</span></div>') +
      '</div></section>' +

      '<section class="rsec"><div class="rsh"><h2>All numbers</h2><span class="muted">' + F.n(t.receipts) + ' token receipts · Rs ' + F.fmtLakh(t.amount) + '</span></div><div class="tktab">' +
      head + ((r.numbers || []).map(numRow).join('') || '<div class="rcrow muted"><span style="grid-column:1/-1;text-align:center;padding:16px">No token receipts in this range</span></div>') +
      '</div></section>';
  }

  function render(root, ctx, r, range, load) {
    var mark = esc(ctx.settings.mark || 'NF');
    var companyLine = esc(ctx.settings.company_line || ctx.companyName || '');
    root.innerHTML = '' +
      '<div class="sheet tkrsheet">' +
      '<header class="hdr">' +
      '  <div class="brand">' + F.brandMark(mark) +
      '    <div><div class="co">' + companyLine + '</div><h1>Receipt Register</h1></div></div>' +
      '  <div class="actions">' +
      '    <button class="btn" id="nf-rcr-back" type="button">' + esc(ctx.backLabel || '← Back to closing sheet') + '</button>' +
      global.NfReportsMenu.html('receipts') +
      '    <button class="btn primary" id="nf-rcr-print" type="button">Save as PDF</button>' +
      '  </div>' +
      '</header>' +
      '<section class="rsec tkrfilter">' +
      '  <label>From <input type="date" id="nf-rcr-from" value="' + esc(range.from) + '"></label>' +
      '  <label>To <input type="date" id="nf-rcr-to" value="' + esc(range.to) + '"></label>' +
      '  <button class="btn" id="nf-rcr-apply" type="button">Apply</button>' +
      '  <button class="btn" id="nf-rcr-clear" type="button">All time</button>' +
      '</section>' +
      '<div>' + (r ? body(r) : '<p class="muted" style="padding:18px 0;text-align:center">Loading…</p>') + '</div>' +
      '<section class="rsec rsig"><div><span>Prepared by</span><i></i></div><div><span>Checked by</span><i></i></div><div><span>Director</span><i></i></div></section>' +
      '<div class="docfoot"><span>' + esc(ctx.companyName || '') + ' · Receipt / Token Number Register</span>' +
      '<span>' + (range.from || range.to ? (range.from || '…') + ' – ' + (range.to || '…') : 'All time') + '</span></div>' +
      '</div>';

    root.querySelector('#nf-rcr-back').addEventListener('click', function () { ctx.onBack(); });
    root.querySelector('#nf-rcr-print').addEventListener('click', function () { global.print(); });
    global.NfReportsMenu.wire(root, ctx);
    var here = { from: range.from, to: range.to };
    global.NfDrill.on(root, '[data-vno]', 'dblclick', function (el) {
      global.NfDrill.entry(root, ctx, {
        voucherNo: el.getAttribute('data-vno'), date: el.getAttribute('data-date'),
        backLabel: '← Back to Receipt Register',
        onBack: function () { global.NfReceiptRegister.mount(root, Object.assign({}, ctx, here)); },
      });
    });
    root.querySelector('#nf-rcr-apply').addEventListener('click', function () {
      load({ from: root.querySelector('#nf-rcr-from').value, to: root.querySelector('#nf-rcr-to').value });
    });
    root.querySelector('#nf-rcr-clear').addEventListener('click', function () { load({ from: '', to: '' }); });
  }

  global.NfReceiptRegister = { mount: mount };
})(window);
