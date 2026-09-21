/**
 * NexuFinance v1 — drill-down ("360") navigation. window.NfDrill
 *
 * The owner's ask (2026-09-21), in his words: like QuickBooks. Click a figure
 * or a head on the P&L / Balance Sheet and its LEDGER opens; double-click an
 * entry in a ledger and the ORIGINAL ENTRY opens, in the screen it was
 * entered on. The report's date range travels with the click, so the ledger
 * totals to exactly the figure that was clicked.
 *
 * Nothing here reads or writes the database on its own behalf — every
 * destination is an existing screen, opened through its own mount() with a
 * few optional ctx fields it now understands:
 *
 *   ctx.backLabel      the text on that screen's Back button
 *   ctx.onBack         where Back goes (the screen you drilled FROM, with the
 *                      range/account it had — not the closing sheet)
 *   ledger:  ctx.accountCode, ctx.from, ctx.to        preset the ledger
 *   sheet:   ctx.date, ctx.focusVoucher               open that day, light the line
 *   JV:      ctx.focusVoucher                         light that voucher
 *   journal: ctx.from, ctx.to, ctx.focusVoucher, ctx.importedNote
 *
 * WHERE A VOUCHER LIVES is derived, not stored:
 *   - CRV/BRV/CPV/BPV/XFR numbers can only have come from the daily closing:
 *     nf_save_line enforces those prefixes and nf_jv_save REFUSES them
 *     (NF:VOUCHER_PREFIX_IS_CASHBOOK), and transfers are XFR-BANK-/XFR-PETTY-.
 *   - anything else is a journal voucher if the Journal Vouchers screen's own
 *     list contains it (nf_jv_list, which already excludes imported history —
 *     docs/AUDIT_REPORT.md CRITICAL-3);
 *   - otherwise it is imported QuickBooks history, which has no entry screen
 *     by design, and opens read-only in the General Journal, labelled so.
 * voucher_no is unique per company (nf_vouchers_voucher_unique), so the
 * number alone identifies the voucher.
 */
(function (global) {
  'use strict';

  var CASHBOOK = /^(CRV|BRV|CPV|BPV|XFR)-/i;

  function base(ctx) {
    return { api: ctx.api, companyId: ctx.companyId, role: ctx.role, displayName: ctx.displayName,
      companyName: ctx.companyName, settings: ctx.settings };
  }

  // P&L / Balance Sheet / Trial Balance figure → that account's ledger.
  function ledger(root, ctx, o) {
    global.NfLedger.mount(root, Object.assign(base(ctx), {
      accountCode: o.accountCode, from: o.from || '', to: o.to || '',
      backLabel: o.backLabel, onBack: o.onBack,
    }));
  }

  // A ledger / journal entry → the original entry, where it was entered.
  function entry(root, ctx, o) {
    var vno = String(o.voucherNo || '').trim();
    var date = o.date;
    var common = Object.assign(base(ctx), { backLabel: o.backLabel, onBack: o.onBack, focusVoucher: vno });
    if (CASHBOOK.test(vno)) {
      global.NfSheet.mount(root, Object.assign(common, { date: date }));
      return;
    }
    return ctx.api.jvList(ctx.companyId, date, date).then(function (r) {
      var isJv = ((r && r.vouchers) || []).some(function (v) {
        return String(v.voucher_no).toUpperCase() === vno.toUpperCase();
      });
      if (isJv) global.NfJournalVoucher.mount(root, common);
      else global.NfJournal.mount(root, Object.assign(common, { from: date, to: date, importedNote: true }));
    });
  }

  // After a screen has rendered: bring the drilled item into view and light
  // it for a moment, so the eye lands on it.
  function highlight(el) {
    if (!el) return false;
    // data-drilled stays after the highlight fades, so a test can confirm the
    // RIGHT element was chosen without racing a 4-second timer.
    el.setAttribute('data-drilled', '1');
    el.classList.add('nf-drill-hit');
    try { el.scrollIntoView({ block: 'center' }); } catch (e) { el.scrollIntoView(); }
    setTimeout(function () { el.classList.remove('nf-drill-hit'); }, 4000);
    return true;
  }

  global.NfDrill = { ledger: ledger, entry: entry, highlight: highlight, isCashbook: function (v) { return CASHBOOK.test(v || ''); } };
})(window);
