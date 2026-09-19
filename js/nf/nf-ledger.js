/**
 * NexuFinance v1 — the General Ledger: per-account running balance.
 * window.NfLedger.mount(root, ctx)
 *
 * ctx = { api, companyId, role, displayName, companyName, settings, onBack }
 *
 * Second of the three pre-import verification instruments (Journal done,
 * Trial Balance next). Company-wide, account-scoped rather than day-scoped.
 *
 * Two fetches on mount (the account list, then nothing until one is
 * picked), and a re-fetch on every account/date change — same
 * generation-counter + `alive` guard as nf-journal.js, and for the same
 * reason: this screen can re-fetch more than once while mounted, so a
 * stale response has somewhere to go wrong if nothing stops it.
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
    var state = { accounts: [], accountCode: '', from: '', to: '', ledger: null, loading: false };

    function loadLedger() {
      if (!state.accountCode) { state.ledger = null; renderAll(); return; }
      var myGen = ++gen;
      state.loading = true;
      renderAll();
      ctx.api.getLedger(ctx.companyId, state.accountCode, state.from || null, state.to || null).then(function (r) {
        if (!alive || myGen !== gen) return;
        state.loading = false; state.ledger = r; renderAll();
      }).catch(function (e) {
        if (!alive || myGen !== gen) return;
        state.loading = false;
        root.innerHTML = '<div class="nf-gate"><h2>Could not open the ledger</h2><p>' + esc(e.message || String(e)) + '</p>' +
          '<button class="btn" id="nf-lgr-back" type="button">← Back to closing sheet</button></div>';
        var back = root.querySelector('#nf-lgr-back');
        if (back) back.addEventListener('click', function () { ctx.onBack(); });
      });
    }

    function renderAll() { render(root, ctx, state, { loadLedger: loadLedger, setState: function (patch) { Object.assign(state, patch); } }); }

    renderAll();
    ctx.api.listAllAccounts(ctx.companyId).then(function (accts) {
      if (!alive) return;
      state.accounts = accts || [];
      renderAll();
    }).catch(function (e) {
      if (!alive) return;
      root.innerHTML = '<div class="nf-gate"><h2>Could not load the chart of accounts</h2><p>' + esc(e.message || String(e)) + '</p>' +
        '<button class="btn" id="nf-lgr-back" type="button">← Back to closing sheet</button></div>';
      var back = root.querySelector('#nf-lgr-back');
      if (back) back.addEventListener('click', function () { ctx.onBack(); });
    });
  }

  function entryRows(entries) {
    return (entries || []).map(function (e) {
      // Same fix as nf-journal.js: each leg's own memo (the real
      // transaction description) takes priority over the voucher's
      // narration — needs 20260918u applied first (nf_get_ledger never
      // returned l.memo before that), harmlessly falls through to
      // narration until then since e.memo is simply undefined.
      return '<tr><td>' + F.ddMonYyyy(e.voucher_date) + '</td><td>' + esc(e.voucher_no) + '</td>' +
        '<td>' + esc(e.memo || e.narration || '') + '</td><td>' + esc(e.floor_name || e.floor_code || '') + '</td>' +
        '<td>' + esc(e.party || '') + '</td>' +
        '<td class="r">' + (F.n(e.debit) ? F.fmt(e.debit) : '') + '</td>' +
        '<td class="r">' + (F.n(e.credit) ? F.fmt(e.credit) : '') + '</td>' +
        '<td class="r">' + F.fmt(e.running_balance) + '</td></tr>';
    }).join('');
  }

  function render(root, ctx, state, actions) {
    var mark = esc(ctx.settings.mark || 'NF');
    var companyLine = esc(ctx.settings.company_line || ctx.companyName || '');
    var l = state.ledger;

    var options = '<option value="">— choose an account —</option>' + state.accounts.map(function (a) {
      return '<option value="' + esc(a.code) + '"' + (a.code === state.accountCode ? ' selected' : '') + '>' +
        esc(a.code) + ' — ' + esc(a.name) + '</option>';
    }).join('');

    var body;
    if (!state.accountCode) {
      body = '<p class="muted" style="padding:18px 0;text-align:center">Choose an account above to see its ledger.</p>';
    } else if (state.loading || !l) {
      body = '<p class="muted" style="padding:18px 0;text-align:center">Loading…</p>';
    } else {
      body = '' +
        '<section class="rsec rtiles-wrap"><div class="rtiles">' +
        '  <div class="rtile"><small>Opening Balance</small><b>Rs ' + F.fmt(l.opening) + '</b></div>' +
        '  <div class="rtile"><small>Closing Balance</small><b>Rs ' + F.fmt(l.closing) + '</b></div>' +
        '</div></section>' +
        '<section class="rsec"><table class="rtab ltab"><thead><tr><th>Date</th><th>Voucher</th><th>Narration</th>' +
        '<th>Floor</th><th>Party</th><th class="r">Debit</th><th class="r">Credit</th><th class="r">Balance</th></tr></thead>' +
        '<tbody>' + (entryRows(l.entries) || '<tr><td colspan="8" class="muted" style="text-align:center;padding:16px">No entries in this range</td></tr>') + '</tbody>' +
        '</table></section>';
    }

    root.innerHTML = '' +
      '<div class="sheet lsheet">' +
      '<header class="hdr">' +
      '  <div class="brand"><div class="mark" aria-hidden="true">' + mark + '</div>' +
      '    <div><div class="co">' + companyLine + '</div><h1>General Ledger</h1></div></div>' +
      '  <div class="actions">' +
      '    <button class="btn" id="nf-lgr-back" type="button">← Back to closing sheet</button>' +
      global.NfReportsMenu.html('ledger') +
      '    <button class="btn primary" id="nf-lgr-print" type="button">Print</button>' +
      '  </div>' +
      '</header>' +
      '<section class="rsec lfilter">' +
      '  <label>Account <select id="nf-lgr-acct">' + options + '</select></label>' +
      '  <label>From <input type="date" id="nf-lgr-from" value="' + esc(state.from) + '"></label>' +
      '  <label>To <input type="date" id="nf-lgr-to" value="' + esc(state.to) + '"></label>' +
      '  <button class="btn" id="nf-lgr-apply" type="button">Apply</button>' +
      '  <button class="btn" id="nf-lgr-clear" type="button">All time</button>' +
      '</section>' +
      '<div id="nf-lgr-body">' + body + '</div>' +
      '<div class="docfoot"><span>' + esc(ctx.companyName || '') + ' · General Ledger' + (l ? ' — ' + esc(l.account.code) + ' ' + esc(l.account.name) : '') + '</span>' +
      '<span>' + (state.from || state.to ? (state.from || '…') + ' – ' + (state.to || '…') : 'All time') + '</span></div>' +
      '</div>';

    root.querySelector('#nf-lgr-back').addEventListener('click', function () { ctx.onBack(); });
    root.querySelector('#nf-lgr-print').addEventListener('click', function () { global.print(); });
    global.NfReportsMenu.wire(root, ctx);
    root.querySelector('#nf-lgr-acct').addEventListener('change', function (e) {
      actions.setState({ accountCode: e.target.value });
      actions.loadLedger();
    });
    root.querySelector('#nf-lgr-apply').addEventListener('click', function () {
      actions.setState({ from: root.querySelector('#nf-lgr-from').value, to: root.querySelector('#nf-lgr-to').value });
      actions.loadLedger();
    });
    root.querySelector('#nf-lgr-clear').addEventListener('click', function () {
      actions.setState({ from: '', to: '' });
      actions.loadLedger();
    });
  }

  global.NfLedger = { mount: mount };
})(window);
