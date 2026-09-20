/**
 * NexuFinance v1 — Party-wise Statement: every voucher leg for one party
 * (FMH, KBH, a director, a token-money customer, etc.), across ALL
 * accounts — unlike the General Ledger, which is scoped to one account,
 * this follows the party. window.NfPartyStatement.mount(root, ctx)
 *
 * ctx = { api, companyId, role, displayName, companyName, settings, onBack }
 *
 * Row markup is CSS Grid divs (.pgrow), not a <table> — same reasoning as
 * nf-pl.js's own header comment (a real Chromium print-pagination bug,
 * docs/PLAN.md §16.3). Column widths are explicit and Date/Voucher/Floor/
 * Debit/Credit/Balance are nowrap from the start — the Journal print fix
 * (docs/PLAN.md §16, 2026-09-19) found the hard way that narrow auto-
 * sized columns overflow into their neighbour, so this report starts
 * with the known-good widths instead of re-discovering that bug.
 * Same generation-counter + `alive` guard as nf-ledger.js.
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
    var state = { parties: [], partyId: '', from: '', to: '', stmt: null, loading: false };

    function loadStatement() {
      if (!state.partyId) { state.stmt = null; renderAll(); return; }
      var myGen = ++gen;
      state.loading = true;
      renderAll();
      ctx.api.getPartyStatement(ctx.companyId, state.partyId, state.from || null, state.to || null).then(function (r) {
        if (!alive || myGen !== gen) return;
        state.loading = false; state.stmt = r; renderAll();
      }).catch(function (e) {
        if (!alive || myGen !== gen) return;
        state.loading = false;
        root.innerHTML = '<div class="nf-gate"><h2>Could not open the party statement</h2><p>' + esc(e.message || String(e)) + '</p>' +
          '<button class="btn" id="nf-pty-back" type="button">← Back to closing sheet</button></div>';
        var back = root.querySelector('#nf-pty-back');
        if (back) back.addEventListener('click', function () { ctx.onBack(); });
      });
    }

    function renderAll() { render(root, ctx, state, { loadStatement: loadStatement, setState: function (patch) { Object.assign(state, patch); } }); }

    renderAll();
    ctx.api.listAllParties(ctx.companyId).then(function (parties) {
      if (!alive) return;
      state.parties = parties || [];
      renderAll();
    }).catch(function (e) {
      if (!alive) return;
      root.innerHTML = '<div class="nf-gate"><h2>Could not load the party list</h2><p>' + esc(e.message || String(e)) + '</p>' +
        '<button class="btn" id="nf-pty-back" type="button">← Back to closing sheet</button></div>';
      var back = root.querySelector('#nf-pty-back');
      if (back) back.addEventListener('click', function () { ctx.onBack(); });
    });
  }

  function entryRows(entries) {
    return (entries || []).map(function (e) {
      return '<div class="pgrow">' +
        '<span>' + F.ddMonYyyy(e.voucher_date) + '</span>' +
        '<span>' + esc(e.voucher_no) + '</span>' +
        '<span class="wrap">' + esc(e.memo || e.narration || '') + '</span>' +
        '<span class="wrap">' + esc(e.account_code) + ' ' + esc(e.account_name) + '</span>' +
        '<span>' + esc(e.floor_name || e.floor_code || '') + '</span>' +
        '<span class="r">' + (F.n(e.debit) ? F.fmt(e.debit) : '') + '</span>' +
        '<span class="r">' + (F.n(e.credit) ? F.fmt(e.credit) : '') + '</span>' +
        '<span class="r">' + F.fmt(e.running_balance) + '</span>' +
        '</div>';
    }).join('');
  }

  function render(root, ctx, state, actions) {
    var mark = esc(ctx.settings.mark || 'NF');
    var companyLine = esc(ctx.settings.company_line || ctx.companyName || '');
    var s = state.stmt;

    var options = '<option value="">— choose a party —</option>' + state.parties.map(function (p) {
      return '<option value="' + esc(p.id) + '"' + (p.id === state.partyId ? ' selected' : '') + '>' +
        esc(p.name) + (p.kind ? ' (' + esc(p.kind.replace('_', ' ')) + ')' : '') + '</option>';
    }).join('');

    var body;
    if (!state.partyId) {
      body = '<p class="muted" style="padding:18px 0;text-align:center">Choose a party above to see their statement.</p>';
    } else if (state.loading || !s) {
      body = '<p class="muted" style="padding:18px 0;text-align:center">Loading…</p>';
    } else {
      body = '' +
        '<section class="rsec rtiles-wrap"><div class="rtiles">' +
        '  <div class="rtile"><small>Opening Balance</small><b>Rs ' + F.fmt(s.opening) + '</b></div>' +
        '  <div class="rtile"><small>Closing Balance</small><b>Rs ' + F.fmt(s.closing) + '</b></div>' +
        '</div></section>' +
        '<section class="rsec"><div class="pgtab">' +
        '<div class="pgrow pghead"><span>Date</span><span>Voucher</span><span>Narration</span><span>Account</span>' +
        '<span>Floor</span><span class="r">Debit</span><span class="r">Credit</span><span class="r">Balance</span></div>' +
        (entryRows(s.entries) || '<div class="pgrow muted"><span colspan="8" style="grid-column:1/-1;text-align:center;padding:16px">No entries in this range</span></div>') +
        '</div></section>';
    }

    root.innerHTML = '' +
      '<div class="sheet pgsheet">' +
      '<header class="hdr">' +
      '  <div class="brand">' + F.brandMark(mark) +
      '    <div><div class="co">' + companyLine + '</div><h1>Party Statement</h1></div></div>' +
      '  <div class="actions">' +
      '    <button class="btn" id="nf-pty-back" type="button">← Back to closing sheet</button>' +
      global.NfReportsMenu.html('party') +
      '    <button class="btn primary" id="nf-pty-print" type="button">Print</button>' +
      '  </div>' +
      '</header>' +
      '<section class="rsec pgfilter">' +
      '  <label>Party <select id="nf-pty-sel">' + options + '</select></label>' +
      '  <label>From <input type="date" id="nf-pty-from" value="' + esc(state.from) + '"></label>' +
      '  <label>To <input type="date" id="nf-pty-to" value="' + esc(state.to) + '"></label>' +
      '  <button class="btn" id="nf-pty-apply" type="button">Apply</button>' +
      '  <button class="btn" id="nf-pty-clear" type="button">All time</button>' +
      '</section>' +
      '<div id="nf-pty-body">' + body + '</div>' +
      '<div class="docfoot"><span>' + esc(ctx.companyName || '') + ' · Party Statement' + (s ? ' — ' + esc(s.party.name) : '') + '</span>' +
      '<span>' + (state.from || state.to ? (state.from || '…') + ' – ' + (state.to || '…') : 'All time') + '</span></div>' +
      '</div>';

    root.querySelector('#nf-pty-back').addEventListener('click', function () { ctx.onBack(); });
    root.querySelector('#nf-pty-print').addEventListener('click', function () { global.print(); });
    global.NfReportsMenu.wire(root, ctx);
    root.querySelector('#nf-pty-sel').addEventListener('change', function (e) {
      actions.setState({ partyId: e.target.value });
      actions.loadStatement();
    });
    root.querySelector('#nf-pty-apply').addEventListener('click', function () {
      actions.setState({ from: root.querySelector('#nf-pty-from').value, to: root.querySelector('#nf-pty-to').value });
      actions.loadStatement();
    });
    root.querySelector('#nf-pty-clear').addEventListener('click', function () {
      actions.setState({ from: '', to: '' });
      actions.loadStatement();
    });
  }

  global.NfPartyStatement = { mount: mount };
})(window);
