/**
 * NexuFinance v1 — Month-wise Expense Trend: cost, income and token money
 * collected per calendar month, so spending shows as a trend over time
 * rather than only a point-in-time or all-time total.
 * window.NfMonthlyTrend.mount(root, ctx)
 *
 * ctx = { api, companyId, role, displayName, companyName, settings, onBack }
 *
 * Row markup is CSS Grid divs, not a <table> — see nf-pl.js's own header
 * comment (docs/PLAN.md §16.3). The cost bar is a plain CSS width
 * proportional to the month with the highest cost — no charting library,
 * consistent with every other report in this pass.
 */
(function (global) {
  'use strict';
  var F = global.NfFmt;
  function esc(s) { return F.esc(s); }

  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function ymLabel(ym) {
    var parts = ym.split('-');
    return MON[parseInt(parts[1], 10) - 1] + ' ' + parts[0];
  }

  function mount(root, ctx) {
    var gen = 0;
    var alive = true;
    var trueOnBack = ctx.onBack;
    ctx = Object.assign({}, ctx, { onBack: function () { alive = false; trueOnBack(); } });

    function load(range) {
      var myGen = ++gen;
      render(root, ctx, null, range, load);
      return ctx.api.getMonthlyTrend(ctx.companyId, range.from || null, range.to || null).then(function (r) {
        if (!alive || myGen !== gen) return;
        render(root, ctx, r, range, load);
      }).catch(function (e) {
        if (!alive || myGen !== gen) return;
        root.innerHTML = '<div class="nf-gate"><h2>Could not open the monthly trend</h2><p>' + esc(e.message || String(e)) + '</p>' +
          '<button class="btn" id="nf-mt-back" type="button">' + esc(ctx.backLabel || '← Back to closing sheet') + '</button></div>';
        var back = root.querySelector('#nf-mt-back');
        if (back) back.addEventListener('click', function () { ctx.onBack(); });
      });
    }

    // ctx.from/ctx.to: reopened by Back from a drill (js/nf/nf-drill.js)
    load({ from: ctx.from || '', to: ctx.to || '' });
  }

  function rows(list) {
    var maxCost = (list || []).reduce(function (m, r) { return Math.max(m, F.n(r.cost)); }, 0) || 1;
    return (list || []).map(function (m) {
      var pct = Math.max(1, Math.round(F.n(m.cost) / maxCost * 100));
      return '<div class="mtrow">' +
        '<span class="mtym">' + esc(ymLabel(m.ym)) + '</span>' +
        '<span class="mtbarwrap"><span class="mtbar" style="width:' + pct + '%"></span></span>' +
        '<span class="r"><span class="nf-drill-fig" data-drill-ym="' + esc(m.ym) + '" data-drill-kind="cost" data-drill-expect="' + F.n(m.cost) + '" title="Show the transactions in this figure">' + F.fmt(m.cost) + '</span></span>' +
        '<span class="r muted"><span class="nf-drill-fig" data-drill-ym="' + esc(m.ym) + '" data-drill-kind="token" data-drill-expect="' + F.n(m.token_collected) + '" title="Show the transactions in this figure">' + F.fmt(m.token_collected) + '</span></span>' +
        '</div>';
    }).join('');
  }

  function render(root, ctx, r, range, load) {
    var mark = esc(ctx.settings.mark || 'NF');
    var companyLine = esc(ctx.settings.company_line || ctx.companyName || '');

    root.innerHTML = '' +
      '<div class="sheet mtsheet">' +
      '<header class="hdr">' +
      '  <div class="brand">' + F.brandMark(mark) +
      '    <div><div class="co">' + companyLine + '</div><h1>Month-wise Expense Trend</h1></div></div>' +
      '  <div class="actions">' +
      '    <button class="btn" id="nf-mt-back" type="button">' + esc(ctx.backLabel || '← Back to closing sheet') + '</button>' +
      global.NfReportsMenu.html('trend') +
      '    <button class="btn primary" id="nf-mt-print" type="button">Print</button>' +
      '  </div>' +
      '</header>' +
      '<section class="rsec mtfilter">' +
      '  <label>From <input type="date" id="nf-mt-from" value="' + esc(range.from) + '"></label>' +
      '  <label>To <input type="date" id="nf-mt-to" value="' + esc(range.to) + '"></label>' +
      '  <button class="btn" id="nf-mt-apply" type="button">Apply</button>' +
      '  <button class="btn" id="nf-mt-clear" type="button">All time</button>' +
      '</section>' +
      '<div id="nf-mt-body">' + (r ? (
        '<section class="rsec rtiles-wrap"><div class="rtiles">' +
        '  <div class="rtile"><small>Total Cost</small><b>Rs ' + F.fmt(r.total_cost) + '</b></div>' +
        '  <div class="rtile"><small>Total Income</small><b>Rs ' + F.fmt(r.total_income) + '</b></div>' +
        '  <div class="rtile"><small>Token Collected</small><b>Rs ' + F.fmt(r.total_token_collected) + '</b></div>' +
        '</div></section>' +
        '<section class="rsec"><div class="mttab">' +
        '<div class="mtrow mthead"><span>Month</span><span></span><span class="r">Cost</span><span class="r">Token Collected</span></div>' +
        (rows(r.months) || '<div class="mtrow muted"><span style="grid-column:1/-1;text-align:center;padding:16px">No activity in this range</span></div>') +
        '</div></section>'
      ) : '<p class="muted" style="padding:18px 0;text-align:center">Loading…</p>') + '</div>' +
      '<div class="docfoot"><span>' + esc(ctx.companyName || '') + ' · Month-wise Expense Trend</span>' +
      '<span>' + (range.from || range.to ? (range.from || '…') + ' – ' + (range.to || '…') : 'All time') + '</span></div>' +
      '</div>';

    root.querySelector('#nf-mt-back').addEventListener('click', function () { ctx.onBack(); });
    root.querySelector('#nf-mt-print').addEventListener('click', function () { global.print(); });
    root.querySelectorAll('[data-drill-ym]').forEach(function (el) {
      el.addEventListener('click', function () {
        var here = { from: range.from, to: range.to };
        var ym = el.getAttribute('data-drill-ym'), kind = el.getAttribute('data-drill-kind');
        var y = Number(ym.slice(0, 4)), mo = Number(ym.slice(5, 7));
        var first = ym + '-01';
        var last = ym + '-' + String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0');
        var from = here.from && here.from > first ? here.from : first;
        var to = here.to && here.to < last ? here.to : last;
        global.NfDrill.detail(root, ctx, {
          from: from, to: to, expect: Number(el.getAttribute('data-drill-expect')),
          filter: kind === 'cost' ? { title: ymLabel(ym) + ' — Cost', qbTypes: ['Cost of Goods Sold', 'Expense'], sign: 'dr' }
                                  : { title: ymLabel(ym) + ' — Token Collected', accounts: ['21100'], sign: 'cr' },
          backLabel: '← Back to Monthly Trend',
          onBack: function () { global.NfMonthlyTrend.mount(root, Object.assign({}, ctx, here)); },
        });
      });
    });
    root.querySelector('#nf-mt-apply').addEventListener('click', function () {
      load({ from: root.querySelector('#nf-mt-from').value, to: root.querySelector('#nf-mt-to').value });
    });
    root.querySelector('#nf-mt-clear').addEventListener('click', function () {
      load({ from: '', to: '' });
    });
    global.NfReportsMenu.wire(root, ctx);
  }

  global.NfMonthlyTrend = { mount: mount };
})(window);
