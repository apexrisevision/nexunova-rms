/**
 * NexuFinance v1 — the General Journal: every posted voucher, in date
 * order, full leg detail. window.NfJournal.mount(root, ctx)
 *
 * ctx = { api, companyId, role, displayName, companyName, settings, onBack }
 *
 * First of the three pre-import verification instruments (Journal, Ledger,
 * Trial Balance) — the owner's own instruction: these are what the Awami
 * history import gets checked against, so they come before the import,
 * not after. Company-wide, not day-scoped, unlike the daily closing/
 * director report — a journal has no "day" of its own to open.
 *
 * Classic journal layout: one row per leg. The date/voucher/narration only
 * print on a voucher's FIRST leg row — the rows under it are visually its
 * legs, not separate entries. Read-only: one RPC call on mount, and again
 * whenever the date filter changes.
 */
(function (global) {
  'use strict';
  var F = global.NfFmt;
  function esc(s) { return F.esc(s); }

  function mount(root, ctx) {
    render(root, ctx, null, { from: '', to: '' });
    load(root, ctx, { from: '', to: '' });
  }

  function load(root, ctx, range) {
    var body = root.querySelector('#nf-jrn-body');
    if (body) body.innerHTML = '<tr><td colspan="8" class="muted" style="text-align:center;padding:16px">Loading…</td></tr>';
    return ctx.api.getJournal(ctx.companyId, range.from || null, range.to || null).then(function (r) {
      render(root, ctx, r, range);
    }).catch(function (e) {
      root.innerHTML = '<div class="nf-gate"><h2>Could not open the journal</h2><p>' + esc(e.message || String(e)) + '</p>' +
        '<button class="btn" id="nf-jrn-back" type="button">← Back to closing sheet</button></div>';
      var back = root.querySelector('#nf-jrn-back');
      if (back) back.addEventListener('click', function () { ctx.onBack(); });
    });
  }

  function legRows(v) {
    var legs = v.legs || [];
    return legs.map(function (l, i) {
      var first = i === 0;
      return '<tr class="' + (first ? 'jvfirst' : 'jvleg') + '">' +
        '<td>' + (first ? F.ddMonYyyy(v.voucher_date) : '') + '</td>' +
        '<td>' + (first ? esc(v.voucher_no) : '') + '</td>' +
        '<td>' + (first ? esc(v.narration || '') : '') + '</td>' +
        '<td>' + esc(l.account_code) + ' ' + esc(l.account_name) + '</td>' +
        '<td>' + esc(l.floor_name || l.floor_code || '') + '</td>' +
        '<td>' + esc(l.party || '') + '</td>' +
        '<td class="r">' + (F.n(l.debit) ? F.fmt(l.debit) : '') + '</td>' +
        '<td class="r">' + (F.n(l.credit) ? F.fmt(l.credit) : '') + '</td>' +
        '</tr>';
    }).join('');
  }

  function render(root, ctx, r, range) {
    var mark = esc(ctx.settings.mark || 'NF');
    var companyLine = esc((r && r.company_line) || ctx.settings.company_line || ctx.companyName || '');
    var vouchers = r ? (r.vouchers || []) : [];
    var rows = vouchers.map(legRows).join('');
    var totalDebit = r ? F.n(r.total_debit) : 0;
    var totalCredit = r ? F.n(r.total_credit) : 0;
    var unbalanced = r && Math.round((totalDebit - totalCredit) * 100) !== 0;

    root.innerHTML = '' +
      '<div class="sheet jsheet">' +
      '<header class="hdr">' +
      '  <div class="brand"><div class="mark" aria-hidden="true">' + mark + '</div>' +
      '    <div><div class="co">' + companyLine + '</div><h1>General Journal</h1></div></div>' +
      '  <div class="actions">' +
      '    <button class="btn" id="nf-jrn-back" type="button">← Back to closing sheet</button>' +
      '    <button class="btn primary" id="nf-jrn-print" type="button">Print</button>' +
      '  </div>' +
      '</header>' +
      '<section class="rsec jfilter">' +
      '  <label>From <input type="date" id="nf-jrn-from" value="' + esc(range.from) + '"></label>' +
      '  <label>To <input type="date" id="nf-jrn-to" value="' + esc(range.to) + '"></label>' +
      '  <button class="btn" id="nf-jrn-apply" type="button">Apply</button>' +
      '  <button class="btn" id="nf-jrn-clear" type="button">All time</button>' +
      '  <span class="muted jcount">' + vouchers.length + (vouchers.length === 1 ? ' voucher' : ' vouchers') + '</span>' +
      '</section>' +
      '<section class="rsec">' +
      '<table class="rtab jtab"><thead><tr><th>Date</th><th>Voucher</th><th>Narration</th><th>Account</th>' +
      '<th>Floor</th><th>Party</th><th class="r">Debit</th><th class="r">Credit</th></tr></thead>' +
      '<tbody id="nf-jrn-body">' + (rows || '<tr><td colspan="8" class="muted" style="text-align:center;padding:16px">No posted vouchers in this range</td></tr>') + '</tbody>' +
      '<tfoot><tr><td colspan="6">Total' + (unbalanced ? ' — DOES NOT BALANCE, review immediately' : '') + '</td>' +
      '<td class="r' + (unbalanced ? ' neg' : '') + '">' + F.fmt(totalDebit) + '</td>' +
      '<td class="r' + (unbalanced ? ' neg' : '') + '">' + F.fmt(totalCredit) + '</td></tr></tfoot>' +
      '</table></section>' +
      '<div class="docfoot"><span>' + esc(ctx.companyName || '') + ' · General Journal</span>' +
      '<span>' + (range.from || range.to ? (range.from || '…') + ' – ' + (range.to || '…') : 'All time') + '</span></div>' +
      '</div>';

    root.querySelector('#nf-jrn-back').addEventListener('click', function () { ctx.onBack(); });
    root.querySelector('#nf-jrn-print').addEventListener('click', function () { global.print(); });
    root.querySelector('#nf-jrn-apply').addEventListener('click', function () {
      load(root, ctx, { from: root.querySelector('#nf-jrn-from').value, to: root.querySelector('#nf-jrn-to').value });
    });
    root.querySelector('#nf-jrn-clear').addEventListener('click', function () {
      load(root, ctx, { from: '', to: '' });
    });
  }

  global.NfJournal = { mount: mount };
})(window);
