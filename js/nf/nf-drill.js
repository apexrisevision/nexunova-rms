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

  // The Director Report and the cash views know an account as Cash / Petty /
  // Bank, not by code; resolve it the same way the sheet does (nf_list_vias).
  function ledgerByVia(root, ctx, o) {
    return ctx.api.listVias(ctx.companyId).then(function (vias) {
      var v = (vias || []).filter(function (x) { return x.via === o.via; })[0];
      if (!v) return;
      ledger(root, ctx, Object.assign({}, o, { accountCode: v.code }));
    });
  }

  // The Balance Sheet's "current earnings" is not a posted account — it is
  // the P&L to date — so its trail is the P&L, not a ledger (as QuickBooks
  // does it).
  function pl(root, ctx, o) {
    global.NfPL.mount(root, Object.assign(base(ctx), { from: o.from || '', to: o.to || '', backLabel: o.backLabel, onBack: o.onBack }));
  }

  // A GROUPED figure (a floor's cost, a month's tokens, a project-cost
  // category, a section total) has no single ledger. Its trail is
  // "Transaction Detail": the General Journal filtered to exactly the lines
  // that make up that figure, with their total shown so it can be checked
  // against the figure that was clicked. `filter` is the same definition
  // the figure's own database function uses:
  //   { title, floor, qbTypes:[…], accounts:[…], category, memoUnit, sign:'dr'|'cr' }
  function detail(root, ctx, o) {
    global.NfJournal.mount(root, Object.assign(base(ctx), {
      from: o.from || '', to: o.to || '', detail: Object.assign({ expect: o.expect }, o.filter),
      backLabel: o.backLabel, onBack: o.onBack,
    }));
  }

  // Does one journal leg belong to a detail filter? Mirrors the SQL that
  // produced the figure (nf_get_floor_summary / _monthly_trend /
  // _project_cost_summary / _token_register), so the lines found total to it.
  function legMatches(f, leg, acct) {
    if (f.floor && leg.floor_code !== f.floor) return false;
    if (f.accounts && f.accounts.indexOf(leg.account_code) < 0) return false;
    if (f.qbTypes && (!acct || f.qbTypes.indexOf(acct.qb_type) < 0)) return false;
    // project-cost category = the account's immediate parent, or the account
    // itself when it has none: COALESCE(pa.code, a.code) in the SQL
    if (f.category && (!acct || (acct.parent_code || acct.code) !== f.category)) return false;
    if (f.memoUnit) {
      var m = /unit ([A-Za-z0-9-]+)/.exec(leg.memo || '');
      if (!m || m[1] !== f.memoUnit) return false;
    }
    return true;
  }
  function legAmount(f, leg) {
    var dr = Number(leg.debit) || 0, cr = Number(leg.credit) || 0;
    return f.sign === 'cr' ? cr - dr : dr - cr;
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

  // Wire one drill action onto every element matching `selector`: `how` is
  // 'click' (a figure) or 'dblclick' (an entry), `fn(el)` does the navigation.
  function on(root, selector, how, fn) {
    [].forEach.call(root.querySelectorAll(selector), function (el) {
      el.addEventListener(how, function () { fn(el); });
    });
  }

  global.NfDrill = {
    ledger: ledger, ledgerByVia: ledgerByVia, pl: pl, entry: entry, detail: detail,
    legMatches: legMatches, legAmount: legAmount, highlight: highlight, on: on,
    isCashbook: function (v) { return CASHBOOK.test(v || ''); },
  };
})(window);
