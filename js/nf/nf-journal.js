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
 * whenever the date filter changes — which means, unlike nf-report.js's
 * single fetch-on-mount, a stale response CAN arrive after a newer one, or
 * after the user has already clicked Back. Guarded below with a generation
 * counter (an older response's render is dropped) and an `alive` flag
 * (nothing renders once onBack has fired) — found by verify-nf-general-
 * journal.js's own J-07/J-08 failing on a real race, not invented in
 * advance.
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
      var body = root.querySelector('#nf-jrn-body');
      if (body) body.innerHTML = '<tr><td colspan="8" class="muted" style="text-align:center;padding:16px">Loading…</td></tr>';
      return ctx.api.getJournal(ctx.companyId, range.from || null, range.to || null).then(function (r) {
        if (!alive || myGen !== gen) return; // a newer request, or a navigate-away, already won
        render(root, ctx, r, range, load);
      }).catch(function (e) {
        if (!alive || myGen !== gen) return;
        root.innerHTML = '<div class="nf-gate"><h2>Could not open the journal</h2><p>' + esc(e.message || String(e)) + '</p>' +
          '<button class="btn" id="nf-jrn-back" type="button">← Back to closing sheet</button></div>';
        var back = root.querySelector('#nf-jrn-back');
        if (back) back.addEventListener('click', function () { ctx.onBack(); });
      });
    }

    // §16.7's own TODO, closed here: "All time" on a journal a few years
    // deep into real daily entries means hundreds of pages loaded (and
    // printed) by default. Current month is the sensible default; "All
    // time" stays one click away via the existing button below.
    function currentMonthRange() {
      var d = new Date();
      var pad = function (x) { return String(x).padStart(2, '0'); };
      var from = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-01';
      var to = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
      return { from: from, to: to };
    }
    var initialRange = currentMonthRange();
    render(root, ctx, null, initialRange, load);
    load(initialRange);
  }

  function legRows(v) {
    var legs = v.legs || [];
    return legs.map(function (l, i) {
      var first = i === 0;
      // 'jrnleg', not 'jvleg': the Journal Voucher screen (nf-journal-voucher.css)
      // styles .jvleg as display:grid for its own entry rows, and every
      // stylesheet loads on the same page — so a <tr class="jvleg"> here
      // stopped being a table row, squashing each voucher's second line into
      // narrow grid tracks and blowing the Date column out to ~460px.
      return '<tr class="' + (first ? 'jvfirst' : 'jrnleg') + '">' +
        '<td>' + (first ? F.ddMonYyyy(v.voucher_date) : '') + '</td>' +
        '<td>' + (first ? esc(v.voucher_no) : '') + '</td>' +
        // Each leg's own memo (the real transaction description) takes
        // priority over the voucher's narration — found reviewing the
        // Awami import: every leg carries its own real memo already,
        // but this column used to show the voucher's narration on the
        // first leg only, which for an imported voucher is just the
        // import marker, not a description. Falls back to the voucher's
        // narration on the first leg when a leg has no memo of its own
        // (an ordinary, non-imported voucher, where narration IS the
        // real description and there is no separate per-leg memo).
        '<td>' + esc(l.memo || (first ? v.narration : '') || '') + '</td>' +
        '<td>' + esc(l.account_code) + ' ' + esc(l.account_name) + '</td>' +
        '<td>' + esc(l.floor_name || l.floor_code || '') + '</td>' +
        '<td>' + esc(l.party || '') + '</td>' +
        '<td class="r">' + (F.n(l.debit) ? F.fmt(l.debit) : '') + '</td>' +
        '<td class="r">' + (F.n(l.credit) ? F.fmt(l.credit) : '') + '</td>' +
        '</tr>';
    }).join('');
  }

  function render(root, ctx, r, range, load) {
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
      '  <div class="brand">' + F.brandMark(mark) +
      '    <div><div class="co">' + companyLine + '</div><h1>General Journal</h1></div></div>' +
      '  <div class="actions">' +
      '    <button class="btn" id="nf-jrn-back" type="button">← Back to closing sheet</button>' +
      global.NfReportsMenu.html('journal') +
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
    root.querySelector('#nf-jrn-print').addEventListener('click', function () {
      // §16.7: the exported PDF's own filename should carry the range too,
      // not just the on-page footer — same technique nf-sheet.js already
      // uses for the daily closing print (document.title, restored after).
      var oldTitle = document.title;
      var stamp = (range.from || range.to)
        ? (range.from ? F.ddMonYyyy(range.from) : 'Start') + '_to_' + (range.to ? F.ddMonYyyy(range.to) : 'Today')
        : 'All_Time';
      document.title = 'Awami_General_Journal_' + stamp;
      function restore() { document.title = oldTitle; window.removeEventListener('afterprint', restore); }
      window.addEventListener('afterprint', restore);
      setTimeout(restore, 4000); // afterprint doesn't fire in some headless contexts
      global.print();
    });
    global.NfReportsMenu.wire(root, ctx);
    root.querySelector('#nf-jrn-apply').addEventListener('click', function () {
      load({ from: root.querySelector('#nf-jrn-from').value, to: root.querySelector('#nf-jrn-to').value });
    });
    root.querySelector('#nf-jrn-clear').addEventListener('click', function () {
      load({ from: '', to: '' });
    });
  }

  global.NfJournal = { mount: mount };
})(window);
