/**
 * NexuFinance v1 — Token Money Register: every unit that has had token
 * money moved against it (account 21100), one row per unit — not a
 * transaction log (see the migration's own header, docs/PLAN.md §20, for
 * why per-voucher detail belongs to the Party Statement / General Ledger
 * instead). window.NfTokenRegister.mount(root, ctx)
 *
 * ctx = { api, companyId, role, displayName, companyName, settings, onBack }
 *
 * Row markup is CSS Grid divs (.tkrow), not a <table> — same reasoning
 * as nf-pl.js's own header (docs/PLAN.md §16.3). Same generation-counter
 * + `alive` guard as the other report screens, even though this one has
 * no picker to change mid-flight — only the date range can, so the guard
 * still matters for a stale response racing a filter change.
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
      return ctx.api.getTokenRegister(ctx.companyId, range.from || null, range.to || null).then(function (r) {
        if (!alive || myGen !== gen) return;
        render(root, ctx, r, range, load);
      }).catch(function (e) {
        if (!alive || myGen !== gen) return;
        root.innerHTML = '<div class="nf-gate"><h2>Could not open the token register</h2><p>' + esc(e.message || String(e)) + '</p>' +
          '<button class="btn" id="nf-tkr-back" type="button">← Back to closing sheet</button></div>';
        var back = root.querySelector('#nf-tkr-back');
        if (back) back.addEventListener('click', function () { ctx.onBack(); });
      });
    }

    load({ from: '', to: '' });
  }

  function rows(list) {
    return (list || []).map(function (u) {
      return '<div class="tkrow ' + (u.status === 'Returned' ? 'returned' : '') + '">' +
        '<span>' + esc(u.unit_code) + '</span>' +
        '<span>' + esc(u.floor_name || u.floor_code || '') + '</span>' +
        '<span class="wrap">' + esc(u.parties || '') + '</span>' +
        '<span>' + esc(u.tokens || '') + '</span>' +
        '<span>' + F.ddMonYyyy(u.first_date) + '</span>' +
        '<span>' + F.ddMonYyyy(u.last_date) + '</span>' +
        '<span class="r">' + F.fmt(u.total_received) + '</span>' +
        '<span class="r">' + (F.n(u.total_returned) ? F.fmt(u.total_returned) : '') + '</span>' +
        '<span class="r">' + F.fmt(u.net) + '</span>' +
        '<span class="status ' + (u.status === 'Returned' ? 'bad' : 'ok') + '">' + esc(u.status) + '</span>' +
        '</div>';
    }).join('');
  }

  function render(root, ctx, r, range, load) {
    var mark = esc(ctx.settings.mark || 'NF');
    var companyLine = esc(ctx.settings.company_line || ctx.companyName || '');

    root.innerHTML = '' +
      '<div class="sheet tkrsheet">' +
      '<header class="hdr">' +
      '  <div class="brand"><div class="mark" aria-hidden="true">' + mark + '</div>' +
      '    <div><div class="co">' + companyLine + '</div><h1>Token Money Register</h1></div></div>' +
      '  <div class="actions">' +
      '    <button class="btn" id="nf-tkr-back" type="button">← Back to closing sheet</button>' +
      global.NfReportsMenu.html('token') +
      '    <button class="btn primary" id="nf-tkr-print" type="button">Print</button>' +
      '  </div>' +
      '</header>' +
      '<section class="rsec tkrfilter">' +
      '  <label>From <input type="date" id="nf-tkr-from" value="' + esc(range.from) + '"></label>' +
      '  <label>To <input type="date" id="nf-tkr-to" value="' + esc(range.to) + '"></label>' +
      '  <button class="btn" id="nf-tkr-apply" type="button">Apply</button>' +
      '  <button class="btn" id="nf-tkr-clear" type="button">All time</button>' +
      '</section>' +
      '<div id="nf-tkr-body">' + (r ? (
        '<section class="rsec rtiles-wrap"><div class="rtiles">' +
        '  <div class="rtile"><small>Units</small><b>' + r.total_units + '</b></div>' +
        '  <div class="rtile"><small>Total Received</small><b>Rs ' + F.fmt(r.total_received) + '</b></div>' +
        '  <div class="rtile"><small>Total Returned</small><b>Rs ' + F.fmt(r.total_returned) + '</b></div>' +
        '  <div class="rtile"><small>Net Outstanding</small><b>Rs ' + F.fmt(r.net_outstanding) + '</b></div>' +
        '</div></section>' +
        '<section class="rsec"><div class="tkrtab">' +
        '<div class="tkrow tkrhead"><span>Unit</span><span>Floor</span><span>Party</span><span>Token#</span>' +
        '<span>First</span><span>Last</span><span class="r">Received</span><span class="r">Returned</span><span class="r">Net</span><span>Status</span></div>' +
        (rows(r.units) || '<div class="tkrow muted"><span style="grid-column:1/-1;text-align:center;padding:16px">No token activity in this range</span></div>') +
        '</div></section>'
      ) : '<p class="muted" style="padding:18px 0;text-align:center">Loading…</p>') + '</div>' +
      '<div class="docfoot"><span>' + esc(ctx.companyName || '') + ' · Token Money Register</span>' +
      '<span>' + (range.from || range.to ? (range.from || '…') + ' – ' + (range.to || '…') : 'All time') + '</span></div>' +
      '</div>';

    root.querySelector('#nf-tkr-back').addEventListener('click', function () { ctx.onBack(); });
    root.querySelector('#nf-tkr-print').addEventListener('click', function () { global.print(); });
    global.NfReportsMenu.wire(root, ctx);
    root.querySelector('#nf-tkr-apply').addEventListener('click', function () {
      load({ from: root.querySelector('#nf-tkr-from').value, to: root.querySelector('#nf-tkr-to').value });
    });
    root.querySelector('#nf-tkr-clear').addEventListener('click', function () {
      load({ from: '', to: '' });
    });
  }

  global.NfTokenRegister = { mount: mount };
})(window);
