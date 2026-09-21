/**
 * NexuFinance v1 — Profit & Loss: Income, Cost of Goods Sold and Expense
 * for a date range, with Gross Profit and Net Income.
 * window.NfPL.mount(root, ctx)
 *
 * ctx = { api, companyId, role, displayName, companyName, settings, onBack }
 *
 * Row markup is CSS Grid divs, not a <table> — a real Chromium print-
 * pagination bug pushes a <table> that must span more than one printed
 * page entirely onto page 2 (see docs/PLAN.md §16.3). P&L/Balance Sheet
 * are the first two reports built after that was found, so they use the
 * known-good pattern from the start instead of adding to the same debt.
 * Same generation-counter + `alive` guard as the other report screens.
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
      return ctx.api.getPL(ctx.companyId, range.from || null, range.to || null).then(function (r) {
        if (!alive || myGen !== gen) return;
        render(root, ctx, r, range, load);
      }).catch(function (e) {
        if (!alive || myGen !== gen) return;
        root.innerHTML = '<div class="nf-gate"><h2>Could not open the profit &amp; loss</h2><p>' + esc(e.message || String(e)) + '</p>' +
          '<button class="btn" id="nf-pl-back" type="button">' + esc(ctx.backLabel || '← Back to closing sheet') + '</button></div>';
        var back = root.querySelector('#nf-pl-back');
        if (back) back.addEventListener('click', function () { ctx.onBack(); });
      });
    }

    // ctx.from/ctx.to: when Back returns here from a drilled-into ledger, the
    // P&L reopens on the range it had, not "All time".
    load({ from: ctx.from || '', to: ctx.to || '' });
  }

  // Each account row is a drill target (docs/PLAN.md §43): click it and that
  // account's ledger opens for the SAME range, so the ledger's movement ties
  // to the figure that was clicked.
  function rows(list) {
    return (list || []).map(function (a) {
      return '<div class="orow nf-drill" data-drill-acct="' + esc(a.code) + '" title="Open the ledger for this account">' +
        '<span>' + esc(a.code) + ' ' + esc(a.name) + '</span><b>' + F.fmt(a.amount) + '</b></div>';
    }).join('');
  }

  function section(title, list, total) {
    return '<section class="rsec plsec"><h2>' + esc(title) + '</h2>' +
      '<div class="oblist">' + (rows(list) || '<div class="orow muted"><span>No activity</span><b>–</b></div>') +
      '<div class="orow tot"><span>Total ' + esc(title) + '</span><b>' + F.fmt(total) + '</b></div>' +
      '</div></section>';
  }

  function render(root, ctx, r, range, load) {
    var mark = esc(ctx.settings.mark || 'NF');
    var companyLine = esc(ctx.settings.company_line || ctx.companyName || '');
    var netIncome = r ? F.n(r.net_income) : 0;
    var netClass = netIncome < 0 ? 'neg' : (netIncome > 0 ? 'pos' : '');

    root.innerHTML = '' +
      '<div class="sheet plsheet">' +
      '<header class="hdr">' +
      '  <div class="brand">' + F.brandMark(mark) +
      '    <div><div class="co">' + companyLine + '</div><h1>Profit &amp; Loss</h1></div></div>' +
      '  <div class="actions">' +
      '    <button class="btn" id="nf-pl-back" type="button">' + esc(ctx.backLabel || '← Back to closing sheet') + '</button>' +
      global.NfReportsMenu.html('pl') +
      '    <button class="btn primary" id="nf-pl-print" type="button">Print</button>' +
      '  </div>' +
      '</header>' +
      '<section class="rsec plfilter">' +
      '  <label>From <input type="date" id="nf-pl-from" value="' + esc(range.from) + '"></label>' +
      '  <label>To <input type="date" id="nf-pl-to" value="' + esc(range.to) + '"></label>' +
      '  <button class="btn" id="nf-pl-apply" type="button">Apply</button>' +
      '  <button class="btn" id="nf-pl-clear" type="button">All time</button>' +
      '</section>' +
      '<div id="nf-pl-body">' + (r ? (
        '<section class="rsec rtiles-wrap"><div class="rtiles">' +
        '  <div class="rtile"><small>Total Income</small><b>Rs ' + F.fmt(r.total_income) + '</b></div>' +
        '  <div class="rtile"><small>Gross Profit</small><b class="' + (F.n(r.gross_profit) < 0 ? 'neg' : '') + '">Rs ' + F.fmt(r.gross_profit) + '</b></div>' +
        '  <div class="rtile"><small>Total Expense</small><b>Rs ' + F.fmt(r.total_expense) + '</b></div>' +
        '  <div class="rtile"><small>Net Income</small><b class="' + netClass + '">Rs ' + F.fmt(r.net_income) + '</b></div>' +
        '</div></section>' +
        section('Income', r.income, r.total_income) +
        (r.cogs && r.cogs.length ? section('Cost of Goods Sold', r.cogs, r.total_cogs) : '') +
        section('Expense', r.expense, r.total_expense) +
        '<section class="rsec plnet"><div class="oblist"><div class="orow tot net"><span>Net Income</span>' +
        '<b class="' + netClass + '">' + F.fmt(r.net_income) + '</b></div></div></section>'
      ) : '<p class="muted" style="padding:18px 0;text-align:center">Loading…</p>') + '</div>' +
      '<div class="docfoot"><span>' + esc(ctx.companyName || '') + ' · Profit &amp; Loss</span>' +
      '<span>' + (range.from || range.to ? (range.from || '…') + ' – ' + (range.to || '…') : 'All time') + '</span></div>' +
      '</div>';

    root.querySelector('#nf-pl-back').addEventListener('click', function () { ctx.onBack(); });
    root.querySelector('#nf-pl-print').addEventListener('click', function () { global.print(); });
    global.NfReportsMenu.wire(root, ctx);
    root.querySelectorAll('[data-drill-acct]').forEach(function (row) {
      row.addEventListener('click', function () {
        var here = { from: range.from, to: range.to };
        global.NfDrill.ledger(root, ctx, {
          accountCode: row.getAttribute('data-drill-acct'), from: here.from, to: here.to,
          backLabel: '← Back to Profit & Loss',
          // Back reopens THIS P&L on THIS range, and its own Back still leads
          // to wherever the P&L was opened from.
          onBack: function () { global.NfPL.mount(root, Object.assign({}, ctx, { from: here.from, to: here.to })); },
        });
      });
    });
    root.querySelector('#nf-pl-apply').addEventListener('click', function () {
      load({ from: root.querySelector('#nf-pl-from').value, to: root.querySelector('#nf-pl-to').value });
    });
    root.querySelector('#nf-pl-clear').addEventListener('click', function () {
      load({ from: '', to: '' });
    });
  }

  global.NfPL = { mount: mount };
})(window);
