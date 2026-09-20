/**
 * NexuFinance v1 — Project Cost Summary: cost rolled up by category (Land
 * Cost, Construction Cost, Project Development Cost, Selling Cost,
 * Marketing & Sales, Payroll, Administrative, Utilities, Other Operating,
 * Financial Charges) — one level coarser than the P&L's full account
 * detail, and orthogonal to the Floor Summary's floor-wise view.
 * window.NfProjectCost.mount(root, ctx)
 *
 * ctx = { api, companyId, role, displayName, companyName, settings, onBack }
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
      return ctx.api.getProjectCostSummary(ctx.companyId, range.from || null, range.to || null).then(function (r) {
        if (!alive || myGen !== gen) return;
        render(root, ctx, r, range, load);
      }).catch(function (e) {
        if (!alive || myGen !== gen) return;
        root.innerHTML = '<div class="nf-gate"><h2>Could not open the project cost summary</h2><p>' + esc(e.message || String(e)) + '</p>' +
          '<button class="btn" id="nf-pc-back" type="button">← Back to closing sheet</button></div>';
        var back = root.querySelector('#nf-pc-back');
        if (back) back.addEventListener('click', function () { ctx.onBack(); });
      });
    }

    load({ from: '', to: '' });
  }

  function rows(list, total) {
    return (list || []).map(function (c) {
      var pct = total ? (F.n(c.cost) / total * 100) : 0;
      return '<div class="pcrow"><span>' + esc(c.category_name) + '</span>' +
        '<span class="r">' + F.fmt(c.cost) + '</span>' +
        '<span class="r muted">' + pct.toFixed(1) + '%</span></div>';
    }).join('');
  }

  function render(root, ctx, r, range, load) {
    var mark = esc(ctx.settings.mark || 'NF');
    var companyLine = esc(ctx.settings.company_line || ctx.companyName || '');

    root.innerHTML = '' +
      '<div class="sheet pcsheet">' +
      '<header class="hdr">' +
      '  <div class="brand">' + F.brandMark(mark) +
      '    <div><div class="co">' + companyLine + '</div><h1>Project Cost Summary</h1></div></div>' +
      '  <div class="actions">' +
      '    <button class="btn" id="nf-pc-back" type="button">← Back to closing sheet</button>' +
      global.NfReportsMenu.html('projectcost') +
      '    <button class="btn primary" id="nf-pc-print" type="button">Print</button>' +
      '  </div>' +
      '</header>' +
      '<section class="rsec pcfilter">' +
      '  <label>From <input type="date" id="nf-pc-from" value="' + esc(range.from) + '"></label>' +
      '  <label>To <input type="date" id="nf-pc-to" value="' + esc(range.to) + '"></label>' +
      '  <button class="btn" id="nf-pc-apply" type="button">Apply</button>' +
      '  <button class="btn" id="nf-pc-clear" type="button">All time</button>' +
      '</section>' +
      '<div id="nf-pc-body">' + (r ? (
        '<section class="rsec rtiles-wrap"><div class="rtiles" style="grid-template-columns:1fr">' +
        '  <div class="rtile"><small>Total Project Cost</small><b>Rs ' + F.fmt(r.total_cost) + '</b></div>' +
        '</div></section>' +
        '<section class="rsec"><div class="pctab">' +
        '<div class="pcrow pchead"><span>Category</span><span class="r">Cost</span><span class="r">% of Total</span></div>' +
        (rows(r.categories, F.n(r.total_cost)) || '<div class="pcrow muted"><span style="grid-column:1/-1;text-align:center;padding:16px">No cost in this range</span></div>') +
        '<div class="pcrow pctot"><span>Total</span><span class="r">' + F.fmt(r.total_cost) + '</span><span class="r">100.0%</span></div>' +
        '</div></section>'
      ) : '<p class="muted" style="padding:18px 0;text-align:center">Loading…</p>') + '</div>' +
      '<div class="docfoot"><span>' + esc(ctx.companyName || '') + ' · Project Cost Summary</span>' +
      '<span>' + (range.from || range.to ? (range.from || '…') + ' – ' + (range.to || '…') : 'All time') + '</span></div>' +
      '</div>';

    root.querySelector('#nf-pc-back').addEventListener('click', function () { ctx.onBack(); });
    root.querySelector('#nf-pc-print').addEventListener('click', function () { global.print(); });
    global.NfReportsMenu.wire(root, ctx);
    root.querySelector('#nf-pc-apply').addEventListener('click', function () {
      load({ from: root.querySelector('#nf-pc-from').value, to: root.querySelector('#nf-pc-to').value });
    });
    root.querySelector('#nf-pc-clear').addEventListener('click', function () {
      load({ from: '', to: '' });
    });
  }

  global.NfProjectCost = { mount: mount };
})(window);
