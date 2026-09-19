/**
 * NexuFinance v1 — Floor/Class Cost & Collection Summary: for each floor
 * (including "Project-wide", a real floor_code for costs not allocated
 * to a specific floor yet), the cost posted against it (Cost of Goods
 * Sold + Expense), any real recognised sales income, and token money
 * collected. window.NfFloorSummary.mount(root, ctx)
 *
 * ctx = { api, companyId, role, displayName, companyName, settings, onBack }
 *
 * Token collection is shown as its own column, never folded into
 * "income" — 21100 is a liability until a unit is formally sold, and
 * conflating the two would silently overstate recognised revenue (see
 * the migration's own header, docs/PLAN.md §22).
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
      return ctx.api.getFloorSummary(ctx.companyId, range.from || null, range.to || null).then(function (r) {
        if (!alive || myGen !== gen) return;
        render(root, ctx, r, range, load);
      }).catch(function (e) {
        if (!alive || myGen !== gen) return;
        root.innerHTML = '<div class="nf-gate"><h2>Could not open the floor summary</h2><p>' + esc(e.message || String(e)) + '</p>' +
          '<button class="btn" id="nf-flr-back" type="button">← Back to closing sheet</button></div>';
        var back = root.querySelector('#nf-flr-back');
        if (back) back.addEventListener('click', function () { ctx.onBack(); });
      });
    }

    load({ from: '', to: '' });
  }

  function rows(list) {
    return (list || []).map(function (f) {
      return '<div class="flrow"><span>' + esc(f.floor_name || f.floor_code) + '</span>' +
        '<span class="r">' + F.fmt(f.cost) + '</span>' +
        '<span class="r">' + F.fmt(f.income) + '</span>' +
        '<span class="r">' + F.fmt(f.token_collected) + '</span></div>';
    }).join('');
  }

  function render(root, ctx, r, range, load) {
    var mark = esc(ctx.settings.mark || 'NF');
    var companyLine = esc(ctx.settings.company_line || ctx.companyName || '');

    root.innerHTML = '' +
      '<div class="sheet flrsheet">' +
      '<header class="hdr">' +
      '  <div class="brand"><div class="mark" aria-hidden="true">' + mark + '</div>' +
      '    <div><div class="co">' + companyLine + '</div><h1>Floor/Class Cost &amp; Collection</h1></div></div>' +
      '  <div class="actions">' +
      '    <button class="btn" id="nf-flr-back" type="button">← Back to closing sheet</button>' +
      '    <button class="btn primary" id="nf-flr-print" type="button">Print</button>' +
      '  </div>' +
      '</header>' +
      '<section class="rsec flrfilter">' +
      '  <label>From <input type="date" id="nf-flr-from" value="' + esc(range.from) + '"></label>' +
      '  <label>To <input type="date" id="nf-flr-to" value="' + esc(range.to) + '"></label>' +
      '  <button class="btn" id="nf-flr-apply" type="button">Apply</button>' +
      '  <button class="btn" id="nf-flr-clear" type="button">All time</button>' +
      '</section>' +
      '<div id="nf-flr-body">' + (r ? (
        '<section class="rsec rtiles-wrap"><div class="rtiles">' +
        '  <div class="rtile"><small>Total Cost</small><b>Rs ' + F.fmt(r.total_cost) + '</b></div>' +
        '  <div class="rtile"><small>Total Income</small><b>Rs ' + F.fmt(r.total_income) + '</b></div>' +
        '  <div class="rtile"><small>Token Collected</small><b>Rs ' + F.fmt(r.total_token_collected) + '</b></div>' +
        '</div></section>' +
        '<section class="rsec"><div class="flrtab">' +
        '<div class="flrow flrhead"><span>Floor</span><span class="r">Cost</span><span class="r">Income</span><span class="r">Token Collected</span></div>' +
        (rows(r.floors) || '<div class="flrow muted"><span style="grid-column:1/-1;text-align:center;padding:16px">No activity in this range</span></div>') +
        '<div class="flrow flrtot"><span>Total</span>' +
        '<span class="r">' + F.fmt(r.total_cost) + '</span>' +
        '<span class="r">' + F.fmt(r.total_income) + '</span>' +
        '<span class="r">' + F.fmt(r.total_token_collected) + '</span></div>' +
        '</div></section>' +
        '<p class="rnote">"Project-wide" is cost not yet allocated to a specific floor (land purchase, ' +
        'regulatory fees, architecture, etc.) — real for this business at its current stage, not a gap. ' +
        '"Token Collected" is money received against units before a formal sale (accounted for as a liability, ' +
        'not income) and is kept separate from "Income" so nothing here overstates recognised revenue.</p>'
      ) : '<p class="muted" style="padding:18px 0;text-align:center">Loading…</p>') + '</div>' +
      '<div class="docfoot"><span>' + esc(ctx.companyName || '') + ' · Floor/Class Cost &amp; Collection</span>' +
      '<span>' + (range.from || range.to ? (range.from || '…') + ' – ' + (range.to || '…') : 'All time') + '</span></div>' +
      '</div>';

    root.querySelector('#nf-flr-back').addEventListener('click', function () { ctx.onBack(); });
    root.querySelector('#nf-flr-print').addEventListener('click', function () { global.print(); });
    root.querySelector('#nf-flr-apply').addEventListener('click', function () {
      load({ from: root.querySelector('#nf-flr-from').value, to: root.querySelector('#nf-flr-to').value });
    });
    root.querySelector('#nf-flr-clear').addEventListener('click', function () {
      load({ from: '', to: '' });
    });
  }

  global.NfFloorSummary = { mount: mount };
})(window);
