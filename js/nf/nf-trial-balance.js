/**
 * NexuFinance v1 — the Trial Balance: every account with a non-zero net
 * balance, as of a date, split into its natural debit/credit column.
 * window.NfTrialBalance.mount(root, ctx)
 *
 * ctx = { api, companyId, role, displayName, companyName, settings, onBack }
 *
 * Last of the three pre-import verification instruments (Journal, Ledger
 * done). Company-wide, one date filter (an "as of", not a range — a trial
 * balance is a snapshot, not a period). Same generation-counter + `alive`
 * guard as nf-journal.js/nf-ledger.js, applied from the start this time —
 * this screen re-fetches on every date change exactly the way they do.
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
      return ctx.api.getTrialBalance(ctx.companyId, asOf || null).then(function (r) {
        if (!alive || myGen !== gen) return;
        render(root, ctx, r, asOf, load);
      }).catch(function (e) {
        if (!alive || myGen !== gen) return;
        root.innerHTML = '<div class="nf-gate"><h2>Could not open the trial balance</h2><p>' + esc(e.message || String(e)) + '</p>' +
          '<button class="btn" id="nf-tb-back" type="button">← Back to closing sheet</button></div>';
        var back = root.querySelector('#nf-tb-back');
        if (back) back.addEventListener('click', function () { ctx.onBack(); });
      });
    }

    load('');
  }

  function rows(list) {
    return (list || []).map(function (a) {
      return '<tr><td>' + esc(a.code) + '</td><td>' + esc(a.name) + '</td>' +
        '<td class="r">' + (F.n(a.debit) ? F.fmt(a.debit) : '') + '</td>' +
        '<td class="r">' + (F.n(a.credit) ? F.fmt(a.credit) : '') + '</td></tr>';
    }).join('');
  }

  function render(root, ctx, r, asOf, load) {
    var mark = esc(ctx.settings.mark || 'NF');
    var companyLine = esc(ctx.settings.company_line || ctx.companyName || '');
    var list = r ? (r.rows || []) : [];
    var totalDebit = r ? F.n(r.total_debit) : 0;
    var totalCredit = r ? F.n(r.total_credit) : 0;
    var unbalanced = r && Math.round((totalDebit - totalCredit) * 100) !== 0;

    root.innerHTML = '' +
      '<div class="sheet tsheet">' +
      '<header class="hdr">' +
      '  <div class="brand">' + F.brandMark(mark) +
      '    <div><div class="co">' + companyLine + '</div><h1>Trial Balance</h1></div></div>' +
      '  <div class="actions">' +
      '    <button class="btn" id="nf-tb-back" type="button">← Back to closing sheet</button>' +
      global.NfReportsMenu.html('tb') +
      '    <button class="btn primary" id="nf-tb-print" type="button">Print</button>' +
      '  </div>' +
      '</header>' +
      '<section class="rsec tfilter">' +
      '  <label>As of <input type="date" id="nf-tb-asof" value="' + esc(asOf) + '"></label>' +
      '  <button class="btn" id="nf-tb-apply" type="button">Apply</button>' +
      '  <button class="btn" id="nf-tb-clear" type="button">Today (all postings)</button>' +
      '</section>' +
      '<div id="nf-tb-body">' + (r ? (
        '<section class="rsec"><table class="rtab ttab"><thead><tr><th>Code</th><th>Account</th>' +
        '<th class="r">Debit</th><th class="r">Credit</th></tr></thead>' +
        '<tbody>' + (rows(list) || '<tr><td colspan="4" class="muted" style="text-align:center;padding:16px">No activity' + (asOf ? ' as of this date' : '') + '</td></tr>') + '</tbody>' +
        '<tfoot><tr><td colspan="2">Total' + (unbalanced ? ' — DOES NOT BALANCE, review immediately' : '') + '</td>' +
        '<td class="r' + (unbalanced ? ' neg' : '') + '">' + F.fmt(totalDebit) + '</td>' +
        '<td class="r' + (unbalanced ? ' neg' : '') + '">' + F.fmt(totalCredit) + '</td></tr></tfoot>' +
        '</table></section>'
      ) : '<p class="muted" style="padding:18px 0;text-align:center">Loading…</p>') + '</div>' +
      '<div class="docfoot"><span>' + esc(ctx.companyName || '') + ' · Trial Balance</span>' +
      '<span>' + (asOf ? 'As of ' + F.ddMonYyyy(asOf) : 'All postings to date') + '</span></div>' +
      '</div>';

    root.querySelector('#nf-tb-back').addEventListener('click', function () { ctx.onBack(); });
    root.querySelector('#nf-tb-print').addEventListener('click', function () { global.print(); });
    global.NfReportsMenu.wire(root, ctx);
    root.querySelector('#nf-tb-apply').addEventListener('click', function () {
      load(root.querySelector('#nf-tb-asof').value);
    });
    root.querySelector('#nf-tb-clear').addEventListener('click', function () { load(''); });
  }

  global.NfTrialBalance = { mount: mount };
})(window);
