/**
 * NexuFinance v1 — Cash & Bank Movement: opening/inflow/outflow/closing
 * for every real, postable cash or bank account (10100 Cash in Hand,
 * 10200 Petty Cash, 10300 Bank Al-Habib — the group header "10000 Cash &
 * Bank" is excluded, it is never itself posted to).
 * window.NfCashBank.mount(root, ctx)
 *
 * ctx = { api, companyId, role, displayName, companyName, settings, onBack }
 *
 * As of 2026-09-19 this correctly shows all zeros for Awami — every real
 * imported voucher flows through intercompany/token-money accounts, not
 * cash/bank directly (see the migration's own header, docs/PLAN.md §21).
 * That's the true state of the data, so the empty state says so plainly
 * instead of looking like a broken report.
 *
 * Row markup is CSS Grid divs, not a <table> — see nf-pl.js's own header
 * comment (docs/PLAN.md §16.3).
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
      return ctx.api.getCashBankMovement(ctx.companyId, range.from || null, range.to || null).then(function (r) {
        if (!alive || myGen !== gen) return;
        render(root, ctx, r, range, load);
      }).catch(function (e) {
        if (!alive || myGen !== gen) return;
        root.innerHTML = '<div class="nf-gate"><h2>Could not open cash &amp; bank movement</h2><p>' + esc(e.message || String(e)) + '</p>' +
          '<button class="btn" id="nf-cb-back" type="button">← Back to closing sheet</button></div>';
        var back = root.querySelector('#nf-cb-back');
        if (back) back.addEventListener('click', function () { ctx.onBack(); });
      });
    }

    load({ from: '', to: '' });
  }

  function rows(list) {
    return (list || []).map(function (a) {
      return '<div class="cbrow"><span>' + esc(a.code) + ' ' + esc(a.name) + '</span>' +
        '<span class="r">' + F.fmt(a.opening) + '</span>' +
        '<span class="r">' + F.fmt(a.total_in) + '</span>' +
        '<span class="r">' + F.fmt(a.total_out) + '</span>' +
        '<span class="r">' + F.fmt(a.closing) + '</span></div>';
    }).join('');
  }

  function render(root, ctx, r, range, load) {
    var mark = esc(ctx.settings.mark || 'NF');
    var companyLine = esc(ctx.settings.company_line || ctx.companyName || '');
    var allZero = r && !F.n(r.total_opening) && !F.n(r.total_in) && !F.n(r.total_out) && !F.n(r.total_closing);

    root.innerHTML = '' +
      '<div class="sheet cbsheet">' +
      '<header class="hdr">' +
      '  <div class="brand">' + F.brandMark(mark) +
      '    <div><div class="co">' + companyLine + '</div><h1>Cash &amp; Bank Movement</h1></div></div>' +
      '  <div class="actions">' +
      '    <button class="btn" id="nf-cb-back" type="button">← Back to closing sheet</button>' +
      global.NfReportsMenu.html('cashbank') +
      '    <button class="btn primary" id="nf-cb-print" type="button">Print</button>' +
      '  </div>' +
      '</header>' +
      '<section class="rsec cbfilter">' +
      '  <label>From <input type="date" id="nf-cb-from" value="' + esc(range.from) + '"></label>' +
      '  <label>To <input type="date" id="nf-cb-to" value="' + esc(range.to) + '"></label>' +
      '  <button class="btn" id="nf-cb-apply" type="button">Apply</button>' +
      '  <button class="btn" id="nf-cb-clear" type="button">All time</button>' +
      '</section>' +
      '<div id="nf-cb-body">' + (r ? (
        '<section class="rsec rtiles-wrap"><div class="rtiles">' +
        '  <div class="rtile"><small>Opening</small><b>Rs ' + F.fmt(r.total_opening) + '</b></div>' +
        '  <div class="rtile"><small>Total In</small><b>Rs ' + F.fmt(r.total_in) + '</b></div>' +
        '  <div class="rtile"><small>Total Out</small><b>Rs ' + F.fmt(r.total_out) + '</b></div>' +
        '  <div class="rtile"><small>Closing</small><b>Rs ' + F.fmt(r.total_closing) + '</b></div>' +
        '</div></section>' +
        (allZero ? '<section class="rsec"><div class="rbanner" style="background:var(--soft);color:var(--ink2)">' +
          'No cash or bank activity recorded for this company yet — every real transaction to date has flowed ' +
          'through intercompany (FMH/KBH) or token-money accounts instead of cash/bank directly. This is the ' +
          'true state of the books, not a gap in the report.</div></section>' : '') +
        '<section class="rsec"><div class="cbtab">' +
        '<div class="cbrow cbhead"><span>Account</span><span class="r">Opening</span><span class="r">Total In</span>' +
        '<span class="r">Total Out</span><span class="r">Closing</span></div>' +
        rows(r.accounts) +
        '<div class="cbrow cbtot"><span>Total</span>' +
        '<span class="r">' + F.fmt(r.total_opening) + '</span>' +
        '<span class="r">' + F.fmt(r.total_in) + '</span>' +
        '<span class="r">' + F.fmt(r.total_out) + '</span>' +
        '<span class="r">' + F.fmt(r.total_closing) + '</span></div>' +
        '</div></section>'
      ) : '<p class="muted" style="padding:18px 0;text-align:center">Loading…</p>') + '</div>' +
      '<div class="docfoot"><span>' + esc(ctx.companyName || '') + ' · Cash &amp; Bank Movement</span>' +
      '<span>' + (range.from || range.to ? (range.from || '…') + ' – ' + (range.to || '…') : 'All time') + '</span></div>' +
      '</div>';

    root.querySelector('#nf-cb-back').addEventListener('click', function () { ctx.onBack(); });
    root.querySelector('#nf-cb-print').addEventListener('click', function () { global.print(); });
    global.NfReportsMenu.wire(root, ctx);
    root.querySelector('#nf-cb-apply').addEventListener('click', function () {
      load({ from: root.querySelector('#nf-cb-from').value, to: root.querySelector('#nf-cb-to').value });
    });
    root.querySelector('#nf-cb-clear').addEventListener('click', function () {
      load({ from: '', to: '' });
    });
  }

  global.NfCashBank = { mount: mount };
})(window);
