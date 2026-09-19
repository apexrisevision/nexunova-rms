/**
 * NexuFinance v1 — Balance Sheet: Assets, Liabilities and Equity as of a
 * date, with a computed "Current Earnings" line (see docs/PLAN.md §16 /
 * the migration's own header — Awami has never run a formal period-end
 * close, so this stands in for accumulated net income to date, the same
 * way QuickBooks itself does before a close). window.NfBalanceSheet.mount
 *
 * ctx = { api, companyId, role, displayName, companyName, settings, onBack }
 *
 * CSS Grid row markup, not a <table> — see nf-pl.js's own header for why.
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

    function load(asOf) {
      var myGen = ++gen;
      render(root, ctx, null, asOf, load);
      return ctx.api.getBalanceSheet(ctx.companyId, asOf || null).then(function (r) {
        if (!alive || myGen !== gen) return;
        render(root, ctx, r, asOf, load);
      }).catch(function (e) {
        if (!alive || myGen !== gen) return;
        root.innerHTML = '<div class="nf-gate"><h2>Could not open the balance sheet</h2><p>' + esc(e.message || String(e)) + '</p>' +
          '<button class="btn" id="nf-bs-back" type="button">← Back to closing sheet</button></div>';
        var back = root.querySelector('#nf-bs-back');
        if (back) back.addEventListener('click', function () { ctx.onBack(); });
      });
    }

    load('');
  }

  function rows(list) {
    return (list || []).map(function (a) {
      return '<div class="orow"><span>' + esc(a.code) + ' ' + esc(a.name) + '</span><b>' + F.fmt(a.amount) + '</b></div>';
    }).join('');
  }

  function section(title, list, total) {
    return '<section class="rsec bssec"><h2>' + esc(title) + '</h2>' +
      '<div class="oblist">' + (rows(list) || '<div class="orow muted"><span>No activity</span><b>–</b></div>') +
      '<div class="orow tot"><span>Total ' + esc(title) + '</span><b>' + F.fmt(total) + '</b></div>' +
      '</div></section>';
  }

  function render(root, ctx, r, asOf, load) {
    var mark = esc(ctx.settings.mark || 'NF');
    var companyLine = esc(ctx.settings.company_line || ctx.companyName || '');
    var balanced = r && Math.round((F.n(r.total_assets) - F.n(r.total_liabilities_and_equity)) * 100) === 0;

    // A large negative figure here is arithmetically correct for a
    // pre-revenue project (all land/development cost expensed, nothing
    // sold yet) but "Retained Earnings" reads as if something went
    // wrong. Label it for what it actually is instead of a generic
    // accounting term the reader has to decode — see docs/PLAN.md §16.8
    // for the open policy question this doesn't decide (whether project
    // costs should eventually be capitalised to inventory instead of
    // expensed — that's the owner's and his auditor's call, not this
    // report's).
    var earningsAmt = r ? F.n(r.current_earnings.amount) : 0;
    var earningsLabel = earningsAmt < 0
      ? 'Accumulated deficit — project costs expensed, no sales recognised yet'
      : 'Current Earnings';
    var earningsNote = earningsAmt < 0
      ? 'computed, not a posted account — accumulated net income to date; see docs/PLAN.md §16.8 on the open accounting-policy question this reflects'
      : 'computed, not a posted account — accumulated net income to date; Awami has never run a formal period-end close';
    var equityBody = r ? (
      rows(r.equity) +
      '<div class="orow computed"><span>' + esc(earningsLabel) + ' <i>(' + esc(earningsNote) + ')</i></span><b>' + F.fmt(r.current_earnings.amount) + '</b></div>' +
      '<div class="orow tot"><span>Total Equity</span><b>' + F.fmt(r.total_equity) + '</b></div>'
    ) : '';

    root.innerHTML = '' +
      '<div class="sheet bssheet">' +
      '<header class="hdr">' +
      '  <div class="brand"><div class="mark" aria-hidden="true">' + mark + '</div>' +
      '    <div><div class="co">' + companyLine + '</div><h1>Balance Sheet</h1></div></div>' +
      '  <div class="actions">' +
      '    <button class="btn" id="nf-bs-back" type="button">← Back to closing sheet</button>' +
      '    <button class="btn primary" id="nf-bs-print" type="button">Print</button>' +
      '  </div>' +
      '</header>' +
      '<section class="rsec bsfilter">' +
      '  <label>As of <input type="date" id="nf-bs-asof" value="' + esc(asOf) + '"></label>' +
      '  <button class="btn" id="nf-bs-apply" type="button">Apply</button>' +
      '  <button class="btn" id="nf-bs-clear" type="button">Today (all postings)</button>' +
      '</section>' +
      '<div id="nf-bs-body">' + (r ? (
        '<section class="rsec rtiles-wrap"><div class="rtiles">' +
        '  <div class="rtile"><small>Total Assets</small><b>Rs ' + F.fmt(r.total_assets) + '</b></div>' +
        '  <div class="rtile"><small>Total Liabilities</small><b>Rs ' + F.fmt(r.total_liabilities) + '</b></div>' +
        '  <div class="rtile"><small>Total Equity</small><b>Rs ' + F.fmt(r.total_equity) + '</b></div>' +
        '</div></section>' +
        (!balanced ? '<section class="rsec"><div class="rbanner bad">Assets do not equal Liabilities + Equity — review immediately</div></section>' : '') +
        section('Assets', r.assets, r.total_assets) +
        '<section class="rsec bssec"><h2>Liabilities &amp; Equity</h2>' +
        '<div class="oblist">' +
        rows(r.liabilities) +
        '<div class="orow tot"><span>Total Liabilities</span><b>' + F.fmt(r.total_liabilities) + '</b></div>' +
        equityBody +
        '<div class="orow tot net"><span>Total Liabilities &amp; Equity</span><b>' + F.fmt(r.total_liabilities_and_equity) + '</b></div>' +
        '</div></section>'
      ) : '<p class="muted" style="padding:18px 0;text-align:center">Loading…</p>') + '</div>' +
      '<div class="docfoot"><span>' + esc(ctx.companyName || '') + ' · Balance Sheet</span>' +
      '<span>' + (asOf ? 'As of ' + F.ddMonYyyy(asOf) : 'All postings to date') + '</span></div>' +
      '</div>';

    root.querySelector('#nf-bs-back').addEventListener('click', function () { ctx.onBack(); });
    root.querySelector('#nf-bs-print').addEventListener('click', function () { global.print(); });
    root.querySelector('#nf-bs-apply').addEventListener('click', function () {
      load(root.querySelector('#nf-bs-asof').value);
    });
    root.querySelector('#nf-bs-clear').addEventListener('click', function () { load(''); });
  }

  global.NfBalanceSheet = { mount: mount };
})(window);
