/**
 * NexuFinance v1 — the director-facing daily closing report.
 * window.NfReport.mount(root, ctx)
 *
 * ctx = { api, companyId, dayId, role, displayName, companyName, settings, onBack }
 *
 * Built to match docs/reference/Awami_Closing_All_Entries.xlsx's "17-Sep"
 * tab — the owner-approved design, not invented here. What each part is
 * doing (docs/PLAN.md §12 has the full read-through):
 *
 *   - Four tiles (Opening / In / Out / Closing) are the day's headline
 *     numbers — the same totals the Cash & Bank table's own Total row
 *     holds, just large enough to read from across a desk.
 *   - The Cash & Bank table is plain columns (Opening, In, Out,
 *     Transfer/Adjust, Closing) — no Debit/Credit anywhere on the face of
 *     this report. A director reads a cash position, not a ledger.
 *   - Money Received / Money Paid are the day's actual entries, exactly as
 *     typed on the closing sheet — a director cross-checks a voucher
 *     number against a physical receipt, not a database row.
 *   - "Other Balances (Not Awami's Own Cash)" exists because directors
 *     kept reading inter-company and director money as if it were the
 *     company's own cash — kept visually separate on purpose, in plain
 *     sentences, never merged into the Cash & Bank table above it.
 *   - One plain-language banner, not a checks table — nf_checks() already
 *     produces human-readable text; this report shows that text, or
 *     "Everything Matches" when there is none of it.
 *   - Prepared by / Checked by / Reviewed by Director is a real signature
 *     line on the printed page, not a screen affordance.
 *
 * Read-only: this screen never writes. One RPC call (nf_get_report),
 * once, on mount.
 */
(function (global) {
  'use strict';
  var F = global.NfFmt;
  function esc(s) { return F.esc(s); }

  function mount(root, ctx) {
    root.innerHTML = '<div class="nf-gate"><h2>Loading…</h2><p>Building the report.</p></div>';

    return ctx.api.getReport(ctx.dayId).then(function (r) {
      render(root, ctx, r);
    }).catch(function (e) {
      root.innerHTML = '<div class="nf-gate"><h2>Could not open the report</h2><p>' + esc(e.message || String(e)) + '</p>' +
        '<button class="btn" id="nf-rep-back" type="button">← Back to closing sheet</button></div>';
      var back = root.querySelector('#nf-rep-back');
      if (back) back.addEventListener('click', function () { ctx.onBack(); });
    });
  }

  function tile(label, amount, cls) {
    return '<div class="rtile' + (cls ? ' ' + cls : '') + '"><small>' + esc(label) + '</small><b>Rs ' + F.fmt(amount) + '</b></div>';
  }

  function cashBankTable(accounts) {
    var rows = (accounts || []).map(function (a) {
      var cl = F.n(a.closing);
      return '<tr><td>' + esc(a.label) + '</td>' +
        '<td class="r">' + F.fmt(a.opening) + '</td>' +
        '<td class="r">' + F.fmt(a.received) + '</td>' +
        '<td class="r">' + F.fmt(a.paid) + '</td>' +
        '<td class="r">' + F.fmt(a.transfers) + '</td>' +
        '<td class="r' + (cl < 0 ? ' neg' : '') + '">' + F.fmt(a.closing) + '</td></tr>';
    }).join('');
    var t = { opening: 0, received: 0, paid: 0, transfers: 0, closing: 0 };
    (accounts || []).forEach(function (a) {
      t.opening += F.n(a.opening); t.received += F.n(a.received); t.paid += F.n(a.paid);
      t.transfers += F.n(a.transfers); t.closing += F.n(a.closing);
    });
    rows += '<tr class="tot"><td>Total</td><td class="r">' + F.fmt(t.opening) + '</td><td class="r">' + F.fmt(t.received) +
      '</td><td class="r">' + F.fmt(t.paid) + '</td><td class="r">' + F.fmt(t.transfers) +
      '</td><td class="r' + (t.closing < 0 ? ' neg' : '') + '">' + F.fmt(t.closing) + '</td></tr>';
    return '' +
      '<section class="rsec"><h2>Cash &amp; Bank</h2>' +
      '<table class="rtab"><thead><tr><th>Account</th><th class="r">Opening Balance</th><th class="r">Money In</th>' +
      '<th class="r">Money Out</th><th class="r">Transfer/Adjust</th><th class="r">Closing Balance</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' + transferNote(accounts) + '</section>';
  }

  // A plain-language line explaining the Transfer/Adjust column — a
  // director otherwise sees cash drop with no matching payment. Every
  // transfer voucher in this app moves money OUT of exactly one via
  // account and INTO one or more others (Cash -> Bank / Cash -> Petty,
  // in either direction) — never sourced from more than one account at
  // once — so pairing the lone negative row against every positive row
  // is exact, not a guess, for every shape this app can actually produce.
  function transferNote(accounts) {
    var moves = (accounts || []).map(function (a) { return { label: a.label, t: F.n(a.transfers) }; })
      .filter(function (m) { return m.t !== 0; });
    if (!moves.length) return '';
    var sources = moves.filter(function (m) { return m.t < 0; });
    var dests = moves.filter(function (m) { return m.t > 0; });
    var sentence;
    if (sources.length === 1) {
      var src = sources[0];
      sentence = dests.map(function (d) {
        return 'Rs ' + F.fmt(d.t) + ' moved from ' + esc(src.label) + ' to ' + esc(d.label);
      }).join('; ') + '.';
    } else {
      sentence = moves.map(function (m) {
        return esc(m.label) + ' ' + (m.t < 0 ? '−' : '+') + 'Rs ' + F.fmt(Math.abs(m.t));
      }).join(', ') + '.';
    }
    return '<p class="rnote">' + sentence + '</p>';
  }

  function entriesTable(title, sub, side, lines) {
    var rows = lines.filter(function (l) { return l.side === side; });
    var body = rows.map(function (l) {
      return '<tr><td>' + esc(l.voucher_no) + '</td><td>' + esc(l.description || '') + '</td>' +
        '<td>' + esc(l.head_name) + '</td><td>' + esc(l.floor_name || l.floor_code || '') + '</td>' +
        '<td>' + esc(l.via) + '</td><td class="r">' + F.fmt(l.amount) + '</td></tr>';
    }).join('');
    var total = rows.reduce(function (s, l) { return s + F.n(l.amount); }, 0);
    return '' +
      '<section class="rsec"><div class="rsh"><h2>' + esc(title) + '</h2><span class="muted">' + rows.length + (rows.length === 1 ? ' entry' : ' entries') + '</span></div>' +
      '<table class="rtab"><thead><tr><th>Voucher</th><th>Description</th><th>Head</th><th>Floor</th><th>Cash/Bank</th><th class="r">Amount ' + esc(sub) + '</th></tr></thead>' +
      '<tbody>' + (body || '<tr><td colspan="6" class="muted" style="text-align:center;padding:10px">No entries</td></tr>') + '</tbody>' +
      '<tfoot><tr><td colspan="5">Total ' + esc(sub)  + '</td><td class="r">' + F.fmt(total) + '</td></tr></tfoot></table></section>';
  }

  function otherBalances(rows) {
    if (!rows || !rows.length) {
      return '<section class="rsec otherbal"><h2>Other Balances <small>(Not Awami&rsquo;s Own Cash)</small></h2>' +
        '<p class="muted" style="margin:6px 0 2px">Nothing owed, nothing held, nothing due — no inter-company, director or token-money balance right now.</p></section>';
    }
    var items = rows.map(function (r) {
      return '<li><span>' + esc(r.label) + '</span><b>Rs ' + F.fmt(r.amount) + '</b></li>';
    }).join('');
    return '<section class="rsec otherbal"><h2>Other Balances <small>(Not Awami&rsquo;s Own Cash)</small></h2><ul class="obl">' + items + '</ul></section>';
  }

  function banner(balanced, checks) {
    if (balanced) {
      return '<div class="rbanner ok">✓ Everything Matches — Closing is Correct</div>';
    }
    var reasons = (checks || []).map(function (c) { return c.text; }).filter(Boolean).join('  ·  ');
    return '<div class="rbanner bad">⚠ Please Review' + (reasons ? ': ' + esc(reasons) : '') + '</div>';
  }

  function render(root, ctx, r) {
    var mark = esc(ctx.settings.mark || 'NF');
    var companyLine = esc(r.company_line || ctx.companyName || '');
    var lines = r.lines || [];

    root.innerHTML = '' +
      '<div class="sheet rsheet">' +
      '<header class="hdr">' +
      '  <div class="brand"><div class="mark" aria-hidden="true">' + mark + '</div>' +
      '    <div><div class="co">' + companyLine + '</div><h1>' + esc(r.report_title || 'Daily Closing') + '</h1></div></div>' +
      '  <div class="actions">' +
      '    <button class="btn" id="nf-rep-back" type="button">← Back to closing sheet</button>' +
      '    <button class="btn primary" id="nf-rep-print" type="button">Print</button>' +
      '  </div>' +
      '</header>' +
      '<div class="docmeta">' +
      '  <div><label>Closing date</label><span class="v">' + F.longDate(r.business_date) + '</span></div>' +
      '  <div><label>Day</label><span class="v">' + F.weekday(r.business_date) + '</span></div>' +
      '  <div><label>Closing no.</label><span class="v">' + esc(r.closing_no || '') + '</span></div>' +
      '  <div><label>Prepared by</label><span class="v">' + esc(r.prepared_by_name || (r.status === 'OPEN' ? 'Not yet submitted' : '—')) + '</span></div>' +
      '  <div></div>' +
      '</div>' +
      '<section class="rsec rtiles-wrap">' +
      '  <div class="rtiles">' +
      tile('Opening Balance', r.total_open) +
      tile('Money In', r.total_in, 'in') +
      tile('Money Out', r.total_out, 'out') +
      tile('Closing Balance', r.total_close) +
      '  </div>' +
      banner(r.balanced, r.checks) +
      '</section>' +
      cashBankTable(r.accounts) +
      entriesTable('Money Received', 'Received', 'IN', lines) +
      entriesTable('Money Paid', 'Paid', 'OUT', lines) +
      otherBalances(r.other_balances) +
      '<section class="rsec rsig">' +
      '  <div><span>Prepared by (Accountant)</span><i></i></div>' +
      '  <div><span>Checked by</span><i></i></div>' +
      '  <div><span>Reviewed by Director</span><i></i></div>' +
      '</section>' +
      '<div class="docfoot"><span>' + esc(ctx.companyName || '') + ' · Daily Cash &amp; Bank Closing — Director Report</span>' +
      '<span>' + esc(r.closing_no || '') + ' · ' + F.ddMonYyyy(r.business_date) + '</span></div>' +
      '</div>';

    root.querySelector('#nf-rep-back').addEventListener('click', function () { ctx.onBack(); });
    root.querySelector('#nf-rep-print').addEventListener('click', function () { global.print(); });
  }

  global.NfReport = { mount: mount };
})(window);
