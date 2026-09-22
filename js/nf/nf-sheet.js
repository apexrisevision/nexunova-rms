/**
 * NexuFinance v1 — the closing sheet screen. window.NfSheet.mount(root, ctx)
 *
 * ctx = { api: NfApi instance, companyId, role, displayName, companyName, settings }
 *
 * Layout, the light/dark toggle and the print CSS are the reference
 * (docs/reference/awami-daily-closing.html), ported class-for-class so
 * css/nf/nf-print.css transfers unchanged. The differences from the
 * reference are the ones the plan records (docs/PLAN.md §4B):
 *
 *   - the server is the only source of truth. Every row on the sheet is a
 *     SAVED line (came back from nf_get_day). A NEW voucher is entered in a
 *     popup per type — + CRV / + BRV / + CPV / + BPV / + JV —
 *     (js/nf/nf-voucher-popup.js, docs/PLAN.md §45), which replaced the
 *     draft rows typed straight into the sheet. A refusal (NEGATIVE_POSITION,
 *     DUPLICATE_VOUCHER, …) is shown in plain language inside the popup
 *     (js/nf/nf-messages.js), and the popup stays open with everything
 *     typed — nothing is silently discarded.
 *   - amounts carry two decimals, shown only when present (js/nf/nf-format.js).
 *   - every voucher carries two numbers: the SYSTEM number given on save,
 *     and the MANUAL (paper) number, which may wait but is required before
 *     Close day (docs/PLAN.md §44).
 *   - opening is typed only on the very first day; every later day's opening
 *     is read back from the server, never typed here.
 *   - "Start new day" needs the previous day CLOSED.
 *   - theme is the only thing kept in browser storage; everything else is
 *     read from the server on every load.
 */
(function (global) {
  'use strict';
  var F = global.NfFmt, Msg = global.NfMsg;

  function esc(s) { return F.esc(s); }

  function mount(root, ctx) {
    var api = ctx.api;
    var companyId = ctx.companyId;
    var role = ctx.role;

    // ── state ──────────────────────────────────────────────────────────────
    var S = {
      heads: [], floors: [], vias: [],
      day: null, latest: null, position: null, lines: [], jvs: [], pdcs: [], checks: [], balanced: true,
      settings: ctx.settings || {},
    };
    // The transfers live only in the DOM once typed, and have nowhere else
    // to be kept until their save lands. Without an overlay, a render() triggered by an UNRELATED save landing late
    // rebuilds these fields from the last server state and silently erases
    // whatever had just been typed. null means "show the server's own value";
    // once set, it's shown instead, until its own save clears it back to null.
    // (The cash count that used to share this overlay was removed on
    // 2026-09-21, docs/PLAN.md §44.)
    var transferDraft = null;   // {tBank, tPetty} | null
    var busy = false;


    root.innerHTML =
      '<main class="sheet" id="nf-sheet"></main>' +
      '<p class="note" id="nf-note"></p>' +
      '<div id="nf-toast-host"></div>';
    var sheetEl = root.querySelector('#nf-sheet');
    var noteEl = root.querySelector('#nf-note');
    noteEl.textContent = 'Add a voucher with the + CRV / + BRV / + CPV / + BPV / + JV buttons. A saved line can still be corrected ' +
      'in place. The manual voucher number can wait until the paper voucher is written, but the day cannot close without it. ' +
      '"Start new day" carries today’s closing forward as tomorrow’s opening.';

    // AUDIT_REPORT.md R-4. #nf-toast-host lives in the shell this module
    // renders, and the shell is replaced wholesale when the person opens the
    // Director Report or the Journal Vouchers screen (see the #nf-toDir
    // handler). A debounced save still in flight at that moment used to reach
    // `host.appendChild` with host === null and throw — which both lost the
    // message and, because the throw happened inside a .catch handler, wedged
    // serialDebounce's queue. Re-create the host if it is gone rather than
    // giving up on the message: the toast is the only signal the person gets.
    function toast(msg, bad) {
      var host = root.querySelector('#nf-toast-host');
      if (!host) {
        try {
          host = document.createElement('div');
          host.id = 'nf-toast-host';
          root.appendChild(host);
        } catch (e) {
          if (window.console && console.error) console.error('[nf-sheet] toast host unavailable:', msg);
          return;
        }
      }
      var el = document.createElement('div');
      el.className = 'nf-toast' + (bad ? ' bad' : '');
      el.textContent = msg;
      host.appendChild(el);
      setTimeout(function () { el.remove(); }, 5000);
    }

    // ── loading ────────────────────────────────────────────────────────────
    function loadDay(date) {
      return api.getDay(companyId, date || null).then(function (res) {
        S.day = res.day || null;
        S.latest = res.latest || null;
        S.position = res.day ? (res.position || (res.day && null)) : null;
        S.lines = (res.lines || []);
        S.jvs = (res.jvs || []);
        S.pdcs = (res.pdcs || []);
        S.checks = (res.checks || []);
        S.balanced = !!res.balanced;
        // position comes back nested under day payload for nf_day_json; nf_get_day
        // for an existing day returns the same shape as nf_day_json directly.
        if (res.position) S.position = res.position;
        return res;
      });
    }

    function loadLookups() {
      return Promise.all([api.listHeads(companyId), api.listFloors(companyId), api.listVias(companyId), api.listAllParties(companyId)])
        .then(function (r) { S.heads = r[0] || []; S.floors = r[1] || []; S.vias = r[2] || []; S.parties = r[3] || []; });
    }
    // ── header / docmeta ──────────────────────────────────────────────────
    function renderHeader() {
      var mark = esc((S.settings.mark || 'NF'));
      var companyLine = esc(S.settings.company_line || ctx.companyName || '');
      var title = 'Daily Cash & Bank Closing';
      var d = S.day;
      var dateVal = d ? d.business_date : '';
      var closingNo = d ? d.closing_no : (S.latest ? S.latest.closing_no : '–');
      var statusOk = d ? S.balanced : true;
      var statusText = !d ? '' : (S.balanced ? 'Balanced' : ((S.checks || []).length + (S.checks.length === 1 ? ' item' : ' items') + ' to check'));
      var statePill = d ? '<span class="state-pill' + (d.status === 'CLOSED' ? ' closed' : d.status === 'SUBMITTED' ? ' submitted' : '') + '">' + esc(d.status) + (d.status === 'CLOSED' && !d.is_latest ? '' : '') + '</span>' : '';

      return '' +
        '<header class="hdr">' +
        '  <div class="brand">' +
        '    ' + F.brandMark(mark) +
        '    <div><div class="co">' + companyLine + '</div><h1>' + title + '</h1></div>' +
        '  </div>' +
        '  <div class="actions">' +
        '    <button class="btn icon theme" id="nf-theme" type="button" aria-label="Switch light or dark mode" title="Light / dark">' +
        '      <svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>' +
        '      <svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>' +
        '    </button>' +
        (ctx.onBack ? '    <button class="btn" id="nf-sheet-back" type="button">' + esc(ctx.backLabel || '← Back') + '</button>' : '') +
        (d ? '    <button class="btn" id="nf-toDir" type="button">Director report</button>' : '') +
        global.NfReportsMenu.html('closing') +
        (d && d.status === 'CLOSED' && d.is_latest ? '    <button class="btn" id="nf-startNext" type="button">Start new day</button>' : '') +
        '    <button class="btn primary" id="nf-print" type="button">' +
        '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="7"/></svg>Print</button>' +
        '  </div>' +
        '</header>' +
        '<div class="docmeta">' +
        '  <div><label>Closing date</label><span class="v">' + (d ? F.longDate(dateVal) : '–') + '</span></div>' +
        '  <div><label>Day</label><span class="v">' + (d ? F.weekday(dateVal) : '–') + '</span></div>' +
        '  <div><label>Closing no.</label><span class="v">' + esc(closingNo) + '</span></div>' +
        '  <div><label>Prepared by</label><span class="v">' + esc((d && d.prepared_by_name) || ctx.displayName || '') + '</span></div>' +
        '  <div>' + (d ? '<span class="status ' + (statusOk ? 'ok' : 'bad') + '"><i></i><span>' + esc(statusText) + '</span></span>' + statePill : '') + '</div>' +
        '</div>';
    }

    // ── position ───────────────────────────────────────────────────────────
    function renderPosition() {
      if (!S.day || !S.position) return '';
      var rows = S.position.rows || [];
      var body = rows.map(function (r) {
        var cl = F.n(r.closing);
        return '<tr><td><span class="code">' + esc(r.code) + '</span>' + esc(r.label) + '</td>' +
          '<td class="r t">' + F.fmt(r.opening) + '</td>' +
          '<td class="r t">' + F.fmt(r.received) + '</td>' +
          '<td class="r t">' + F.fmt(r.paid) + '</td>' +
          '<td class="r t">' + F.fmt(r.transfers) + '</td>' +
          '<td class="r t cl' + (cl < 0 ? ' neg' : '') + '">' + F.fmt(r.closing) + '</td></tr>';
      }).join('');
      var t = S.position.total || {};
      var totClose = F.n(t.closing);
      body += '<tr class="tot"><td>Total</td><td class="r t">' + F.fmt(t.opening) + '</td><td class="r t">' + F.fmt(t.received) +
        '</td><td class="r t">' + F.fmt(t.paid) + '</td><td class="r t">' + F.fmt(t.transfers) +
        '</td><td class="r t' + (totClose < 0 ? ' neg' : '') + '">' + F.fmt(t.closing) + '</td></tr>';

      var net = F.n(S.position.net);
      var receipts = S.position.receipts || 0, payments = S.position.payments || 0;
      return '' +
        '<section class="sec"><div class="sh"><h2>Cash and bank position</h2><span>Amounts in PKR</span></div>' +
        '<div class="pos-grid">' +
        '  <div class="box"><table class="pos"><thead><tr><th>Account</th><th class="r">Opening</th><th class="r">Received</th><th class="r">Paid</th><th class="r">Transfers</th><th class="r">Closing</th></tr></thead><tbody>' + body + '</tbody></table></div>' +
        '  <div class="kpis">' +
        '    <div class="kpi"><small>Total closing, cash and bank</small><b>Rs ' + F.fmt(t.closing) + '</b></div>' +
        '    <div class="kpi"><small>Net movement today</small><span class="sub t" style="color:' + (net < 0 ? 'var(--neg)' : 'var(--pos)') + '">' + (net < 0 ? '−' : '+') + ' Rs ' + F.fmt(Math.abs(net)) + '</span> <span class="muted">received less paid</span></div>' +
        '    <div class="kpi"><small>Entries</small><span class="sub">' + receipts + ' receipt' + (receipts === 1 ? '' : 's') + ', ' + payments + ' payment' + (payments === 1 ? '' : 's') + '</span></div>' +
        '    <div class="words">Rupees ' + F.words(t.closing) + ' only' + (totClose < 0 ? ' (negative)' : '') + '</div>' +
        '  </div>' +
        '</div></section>';
    }

    // ── books ──────────────────────────────────────────────────────────────
    var floorOpts = function (selected) {
      return '<option value="">–</option>' + S.floors.map(function (f) {
        return '<option value="' + esc(f) + '"' + (f === selected ? ' selected' : '') + '>' + esc(f) + '</option>';
      }).join('');
    };
    var viaOpts = function (selected) {
      // a saved voucher keeps its type (docs/PLAN.md §44): a cash line may
      // move between Cash and Petty; a bank line stays Bank
      return S.vias.filter(function (v) { return (v.via === 'Bank') === (selected === 'Bank'); }).map(function (v) {
        return '<option value="' + esc(v.via) + '"' + (v.via === selected ? ' selected' : '') + '>' + esc(v.via) + '</option>';
      }).join('');
    };
    // The head used to be a <select> of 82 accounts. A native select only
    // jumps to options that START with what you type, so reaching
    // "12610 Syed Yousaf Shah" meant typing the digits or scrolling. It is
    // now the shared type-to-search picker (js/nf/nf-pick.js), which matches
    // anywhere in the code OR the name — owner, 2026-09-20: type Y and
    // Yousaf should come up.
    var headPick = function (selected, missing) {
      return global.NfPick.html({
        key: 'head', value: selected || '', label: global.NfPick.accountLabel(S.heads, selected),
        placeholder: 'Select head', ariaLabel: 'Account head', missing: missing, disabled: !canWrite,
      });
    };
    function headName(code) { var h = S.heads.filter(function (x) { return x.code === code; })[0]; return h ? h.name : ''; }

    var canWrite = (role === 'accountant' || role === 'director') && S.day && S.day.status === 'OPEN';

    // Search-first party field, owner's own design requirement (2026-09-19):
    // an existing match is always shown and picked from; "add new" only
    // ever appears once a search has visibly returned nothing, never as
    // the easy first action — otherwise the party master fractures into
    // "Abdullah"/"Abdullah LG-03"/"abdullah" within a week and every
    // party-wise report silently splits one customer's balance three ways.
    // The dropdown itself is populated/filtered by wirePartyField() below,
    // not re-rendered from render() — same reasoning as every other text
    // field in this file: rebuilding the row mid-keystroke drops focus.
    function partyFieldHTML(value, missing) {
      return global.NfPick.html({
        key: 'party', value: value || '', label: value || '',
        placeholder: 'Party', ariaLabel: 'Party', missing: missing,
      });
    }
    function savedRowHTML(side, l) {
      // Two numbers per voucher (owner, 2026-09-21, docs/PLAN.md §44): the
      // field is the MANUAL (paper) number, which may still be blank; under
      // it, the SYSTEM number NexuFinance gave the voucher when it was saved,
      // which never changes. data-vno carries the system number so a
      // drill-down finds the row whatever the manual number says.
      var pend = !!l.number_pending;
      return '<div class="grid row' + (pend ? ' vno-pending' : '') + '" data-saved="1" data-id="' + l.id + '" data-version="' + l.version + '" data-side="' + side + '" data-vno="' + esc(l.voucher_no) + '">' +
        '<div class="vnocell"><input class="vno" data-k="v" value="' + esc(l.manual_no || '') + '" placeholder="' + (pend ? 'Manual no.' : '') + '" ' + (canWrite ? '' : 'disabled') + ' aria-label="Manual voucher number"' + (pend ? ' title="Manual voucher number not entered yet — needed before Close day"' : '') + '>' +
        '<span class="vno-sys" title="System number, given by NexuFinance">' + esc(l.voucher_no) + '</span></div>' +
        '<div class="desc"><input data-k="d" value="' + esc(l.description || '') + '" placeholder="Description" ' + (canWrite ? '' : 'disabled') + ' aria-label="Description">' +
        headPick(l.head_code, false) + '</div>' +
        (canWrite ? partyFieldHTML(l.party_name, false) : '<div class="nfpick ro">' + esc(l.party_name || '') + '</div>') +
        '<select class="sel" data-k="f" ' + (canWrite ? '' : 'disabled') + ' aria-label="Floor">' + floorOpts(l.floor_code) + '</select>' +
        '<select class="sel" data-k="m" ' + (canWrite ? '' : 'disabled') + ' aria-label="Cash, petty or bank">' + viaOpts(l.via) + '</select>' +
        '<input class="amt" data-k="a" inputmode="decimal" value="' + F.grp(l.amount) + '" ' + (canWrite ? '' : 'disabled') + ' aria-label="Amount">' +
        (canWrite ? '<button class="del" type="button" data-del-saved="' + l.id + '" data-version="' + l.version + '" aria-label="Delete line">×</button>' : '<span></span>') +
        '</div>';
    }
    function renderBooks() {
      if (!S.day) return '';
      var savedIn = S.lines.filter(function (l) { return l.side === 'IN'; });
      var savedOut = S.lines.filter(function (l) { return l.side === 'OUT'; });
      function none(what, types) {
        return '<p class="empty-note nf-book-empty">No ' + what + ' yet' + (canWrite ? ' — press ' + types + ' above.' : '.') + '</p>';
      }
      var rowsIn = savedIn.map(function (l) { return savedRowHTML('IN', l); }).join('') || none('receipts', '+ CRV or + BRV');
      var rowsOut = savedOut.map(function (l) { return savedRowHTML('OUT', l); }).join('') || none('payments', '+ CPV or + BPV');

      function footer(side, saved) {
        var byVia = { Cash: 0, Petty: 0, Bank: 0 };
        var all = 0;
        saved.forEach(function (l) { byVia[l.via] = (byVia[l.via] || 0) + F.n(l.amount); all += F.n(l.amount); });
        return '<span>Cash</span><span class="r">' + F.fmt(byVia.Cash) + '</span><span>Petty cash</span><span class="r">' + F.fmt(byVia.Petty) +
          '</span><span>Bank</span><span class="r">' + F.fmt(byVia.Bank) + '</span>' +
          '<span class="grand">Total ' + (side === 'IN' ? 'received' : 'paid') + '</span><span class="r grand">' + F.fmt(all) + '</span>';
      }

      // one button per voucher type, each opening its own popup (owner,
      // 2026-09-21; mockup approved) — js/nf/nf-voucher-popup.js
      var typeBar = canWrite
        ? '<section class="sec nf-vtypes" aria-label="Add a voucher">' +
          [['CRV', 'Cash receipt'], ['BRV', 'Bank receipt'], ['CPV', 'Cash payment'], ['BPV', 'Bank payment'], ['JV', 'Journal voucher']].map(function (x) {
            return '<button class="btn nf-vt" type="button" data-vtype="' + x[0] + '"><b>+ ' + x[0] + '</b>&nbsp;' + x[1] + '</button>';
          }).join('') + '</section>'
        : '';
      return typeBar +
        '<section class="sec"><div class="books">' +
        '  <div class="book in"><div class="bh"><h3><i></i>Receipts <small>CRV / BRV</small></h3><span class="cnt">' + savedIn.length + ' ' + (savedIn.length === 1 ? 'entry' : 'entries') + '</span></div>' +
        '    <div class="grid cols"><span>Voucher</span><span>Description and head</span><span>Party</span><span class="c">Floor</span><span class="c">Via</span><span class="r">Amount</span><span></span></div>' +
        '    <div id="nf-rowsIn">' + rowsIn + '</div>' +
        '    <div class="bf">' + footer('IN', savedIn) + '</div></div>' +
        '  <div class="book out"><div class="bh"><h3><i></i>Payments <small>CPV / BPV</small></h3><span class="cnt">' + savedOut.length + ' ' + (savedOut.length === 1 ? 'entry' : 'entries') + '</span></div>' +
        '    <div class="grid cols"><span>Voucher</span><span>Description and head</span><span>Party</span><span class="c">Floor</span><span class="c">Via</span><span class="r">Amount</span><span></span></div>' +
        '    <div id="nf-rowsOut">' + rowsOut + '</div>' +
        '    <div class="bf">' + footer('OUT', savedOut) + '</div></div>' +
        '</div></section>' +
        jvSection() +
        '<section class="sec"><div class="sh"><h2>Payments by head</h2></div><div class="box"><table class="heads"><colgroup><col><col style="width:96px"></colgroup><tbody>' +
        headsTable(savedOut) + '</tbody><tfoot><tr><td>Total</td><td class="r t">' + F.fmt(savedOut.reduce(function (t, l) { return t + F.n(l.amount); }, 0)) + '</td></tr></tfoot></table></div></section>';
    }
    // Journal vouchers dated this day — entered from + JV here or from the
    // Journal Vouchers screen. Shown so the day's full set of vouchers is on
    // one page, and so a missing manual number is visible before Close day.
    function jvSection() {
      var list = S.jvs || [];
      if (!list.length) return '';
      return '<section class="sec"><div class="sh"><h2>Journal vouchers dated today</h2><span>' + list.length + (list.length === 1 ? ' voucher' : ' vouchers') + '</span></div>' +
        '<div class="box"><table class="nf-dayjv"><thead><tr><th>Voucher <small class="muted">manual / system</small></th><th>Narration</th><th class="r">Amount</th></tr></thead><tbody>' +
        list.map(function (v) {
          return '<tr data-jv-no="' + esc(v.voucher_no) + '"' + (v.number_pending ? ' class="vno-pending"' : '') + '><td>' +
            (v.manual_no ? esc(v.manual_no) : '<span class="nf-pend-tag">manual no. pending</span>') +
            '<span class="vno-sys" style="display:block">' + esc(v.voucher_no) + '</span></td>' +
            '<td>' + esc(v.narration || '') + '</td><td class="r t">' + F.fmt(v.total) + '</td></tr>';
        }).join('') + '</tbody></table></div></section>';
    }
    function headsTable(savedOut) {
      var by = {};
      savedOut.forEach(function (l) { by[l.head_code] = (by[l.head_code] || 0) + F.n(l.amount); });
      var codes = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; });
      if (!codes.length) return '<tr><td class="empty-note" colspan="2">No payments yet.</td></tr>';
      return codes.map(function (c) { return '<tr><td><span class="code">' + esc(c) + '</span>' + esc(headName(c)) + '</td><td class="r t">' + F.fmt(by[c]) + '</td></tr>'; }).join('');
    }

    // ── transfers ──────────────────────────────────────────────────────────
    // The cash count (notes × pieces, "as counted", short/over) was removed on
    // the owner's instruction, 2026-09-21 (docs/PLAN.md §44). The transfers
    // are real entries and stay.
    function renderTri() {
      if (!S.day) return '';
      var d = S.day;
      var cashRow = ((S.position && S.position.rows) || []).filter(function (r) { return r.via === 'Cash'; })[0];
      var book = cashRow ? F.n(cashRow.closing) : 0;
      var tb = transferDraft ? transferDraft.tBank : F.grp(d.transfer_to_bank);
      var tp = transferDraft ? transferDraft.tPetty : F.grp(d.transfer_to_petty);

      return '' +
        '<section class="sec"><div class="tri">' +
        '  <div><div class="sh"><h2>Transfers and reconciliation</h2></div>' +
        '    <div class="box"><table class="rec">' +
        '      <tr><td>Cash deposited in bank</td><td class="r"><input class="fld" id="nf-tBank" inputmode="decimal" value="' + esc(tb) + '" ' + (canWrite ? '' : 'disabled') + '></td></tr>' +
        '      <tr><td>Cash given to petty cash</td><td class="r"><input class="fld" id="nf-tPetty" inputmode="decimal" value="' + esc(tp) + '" ' + (canWrite ? '' : 'disabled') + '></td></tr>' +
        '      <tr><td>Cash in hand as per book</td><td class="r t">' + F.fmt(book) + '</td></tr>' +
        '    </table></div></div>' +
        '</div></section>';
    }

    // ── PDCs ───────────────────────────────────────────────────────────────
    function pdcRow(p) {
      var due = p.due_date;
      return '<tr data-pdc="' + p.id + '" data-version="' + p.version + '" class="' + (p.entered_here ? '' : 'resolved') + '">' +
        '<td>' + esc(p.cheque_no) + '</td><td>' + esc(p.party || '') + '</td><td>' + esc(p.bank || '') + '</td>' +
        '<td>' + esc(due) + '</td><td class="r t">' + F.fmt(p.amount) + '</td>' +
        (canWrite ? '<td><button class="del" type="button" data-resolve="' + p.id + '" data-version="' + p.version + '" title="Mark cleared">✓</button></td>' : '<td></td>') + '</tr>';
    }
    function renderPdcs() {
      if (!S.day) return '';
      var inn = S.pdcs.filter(function (p) { return p.direction === 'RECEIVED'; });
      var out = S.pdcs.filter(function (p) { return p.direction === 'ISSUED'; });
      function table(id, title, rows) {
        var totalAmt = rows.reduce(function (t, p) { return t + F.n(p.amount); }, 0);
        return '<div><div class="sh"><h2>' + title + '</h2><span>Pending</span></div><div class="box"><table class="pdc" id="' + id + '">' +
          '<colgroup><col style="width:16%"><col style="width:26%"><col style="width:13%"><col style="width:16%"><col style="width:17%"><col style="width:12%"></colgroup>' +
          '<thead><tr><th>Cheque no.</th><th>Party</th><th>Bank</th><th>Due date</th><th class="r">Amount</th><th></th></tr></thead>' +
          '<tbody>' + rows.map(pdcRow).join('') + '</tbody>' +
          '<tfoot><tr><td colspan="4">Total</td><td class="r t">' + F.fmt(totalAmt) + '</td><td></td></tr></tfoot></table>' +
          (canWrite ? '<div style="padding:8px 12px"><button class="add" type="button" data-pdc-add="' + (id === 'nf-pdcIn' ? 'RECEIVED' : 'ISSUED') + '">+ Add cheque</button></div>' : '') +
          '</div></div>';
      }
      return '<section class="sec"><div class="pdcs">' + table('nf-pdcIn', 'Post-dated cheques received', inn) + table('nf-pdcOut', 'Post-dated cheques issued', out) + '</div></section>';
    }

    // ── checks / sign-off ───────────────────────────────────────────────────
    function renderChecks() {
      if (!S.day) return '';
      var all = (S.checks || []).map(function (c) { return c.text; });
      var ok = all.length === 0;
      var listHtml = ok
        ? '<li>All checks passed. Every line has a head, floor and account; no balance is negative.</li>'
        : all.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('');
      // Not a failed check — a voucher may be saved before its paper voucher
      // is written — but the day cannot close until it has its number
      // (docs/PLAN.md §44), so say so where the Close day button is.
      var pending = pendingLines();
      var pendingNote = pending.length && S.day.status !== 'CLOSED'
        ? '<p class="nf-pending-note" id="nf-pending-note">' + pending.length + (pending.length === 1 ? ' voucher is' : ' vouchers are') +
          ' waiting for the manual voucher number. You can save now; the numbers are needed before Close day.</p>'
        : '';

      return '' +
        '<section class="sec"><div class="sh"><h2>Checks</h2></div>' +
        '<ul class="checks ' + (ok ? 'ok' : 'bad') + '">' + listHtml + '</ul>' + pendingNote +
        '<textarea class="remarks" id="nf-remarks" placeholder="Remarks" ' + (canWrite ? '' : 'disabled') + '>' + esc(S.day.remarks || '') + '</textarea>' +
        '<div class="nf-day-actions">' + actionButtons(ok) + '</div>' +
        '</section>' +
        '<div class="signs">' +
        '  <div><span>Prepared by (Accountant)</span><span>Date</span></div>' +
        '  <div><span>Checked by</span><span>Date</span></div>' +
        '  <div><span>Approved by (Director)</span><span>Date</span></div>' +
        '</div>' +
        '<div class="docfoot"><span>' + esc(ctx.companyName || '') + ' · Daily Cash &amp; Bank Closing</span><span id="nf-stamp">' + esc(S.day.closing_no || '') + ' · ' + F.ddMonYyyy(S.day.business_date) + '</span></div>';
    }
    // every voucher of the day still owed its manual number: the cash book's
    // lines and the JVs dated today (docs/PLAN.md §44/§45)
    function pendingLines() {
      return (S.lines || []).filter(function (l) { return l.number_pending; }).map(function (l) {
        return { voucher_id: l.voucher_id, voucher_no: l.voucher_no, version: l.version, text: l.description || headName(l.head_code) || '', amount: l.amount };
      }).concat((S.jvs || []).filter(function (v) { return v.number_pending; }).map(function (v) {
        return { voucher_id: v.id, voucher_no: v.voucher_no, version: v.version, text: v.narration || '', amount: v.total };
      }));
    }
    function actionButtons(ok) {
      if (!S.day) return '';
      var btns = [];
      if (S.day.status === 'OPEN' && (role === 'accountant' || role === 'director')) {
        btns.push('<button class="btn" id="nf-submit" type="button"' + (ok ? '' : ' disabled') + '>Submit</button>');
      }
      if ((S.day.status === 'OPEN' || S.day.status === 'SUBMITTED') && (role === 'accountant' || role === 'director')) {
        var closeDisabled = !ok;
        btns.push('<button class="btn primary" id="nf-close" type="button"' + (closeDisabled ? ' disabled' : '') + '>Close day</button>');
      }
      if (S.day.status === 'SUBMITTED' && role === 'director') {
        btns.push('<button class="btn" id="nf-return" type="button">Return to accountant</button>');
      }
      if (S.day.status === 'CLOSED' && S.day.is_latest && role === 'director') {
        btns.push('<button class="btn" id="nf-reopen" type="button">Reopen day</button>');
      }
      return btns.join('');
    }

    // ── no-day states ─────────────────────────────────────────────────────
    function renderNoDay() {
      if (S.latest === null) {
        if (role !== 'director') {
          return '<section class="sec"><div class="nf-gate"><h2>No day has been opened yet</h2>' +
            '<p>A director needs to set the opening cash, petty cash and bank balances for the very first day before anyone else can record anything.</p></div></section>';
        }
        return '<section class="sec"><div class="nf-gate"><h2>Set up the first day</h2>' +
          '<p>This is the only day whose opening balances are typed. Every day after this one carries its opening forward automatically.</p>' +
          '<div class="nf-dialog" style="margin:0 auto;max-width:420px;text-align:left">' +
          '  <div class="fld-row" style="grid-template-columns:1fr 1fr">' +
          '    <div><label>Date</label><input type="date" id="nf-fd-date"></div>' +
          '    <div><label>Closing no.</label><input id="nf-fd-cno" value="DC-001" style="text-align:left"></div>' +
          '  </div>' +
          '  <div class="fld-row">' +
          '    <div><label>Cash</label><input id="nf-fd-cash" inputmode="decimal" value="0"></div>' +
          '    <div><label>Petty</label><input id="nf-fd-petty" inputmode="decimal" value="0"></div>' +
          '    <div><label>Bank</label><input id="nf-fd-bank" inputmode="decimal" value="0"></div>' +
          '  </div>' +
          '  <div class="actions"><button class="btn primary" id="nf-fd-go" type="button">Start the first day</button></div>' +
          '</div></div></section>';
      }
      // there is history, but not a day to show right now (shouldn't happen once
      // the sheet always asks for the latest day; kept for completeness)
      return '<section class="sec"><div class="nf-gate"><h2>No day open</h2>' +
        '<p>The last closing was ' + esc(S.latest.closing_no) + ' on ' + F.ddMonYyyy(S.latest.business_date) + ' (' + esc(S.latest.status) + ').</p>' +
        (S.latest.status === 'CLOSED' && (role === 'accountant' || role === 'director') ? '<button class="btn primary" id="nf-startNext2" type="button">Start new day</button>' : '') +
        '</div></section>';
    }

    // ── full render ──────────────────────────────────────────────────────
    // A save can complete (and call refresh() → render()) while the person
    // has already moved on to a different field — cash count and transfers
    // save on their own timer, independent of what has focus. A rebuild that
    // silently drops focus and the caret position mid-keystroke is worse than
    // the bug it replaced (see serialDebounce above), so every render() finds
    // its way back to whatever was focused, by a selector stable across a
    // redraw: an id, or a data-k field within the same
    // saved row (identified by its line id, not by DOM position).
    function focusSelector() {
      var el = document.activeElement;
      if (!el || !sheetEl.contains(el)) return null;
      if (el.id) return '#' + el.id;
      var k = el.getAttribute('data-k');
      if (k) {
        var row = el.closest('[data-saved]');
        if (row) return '[data-id="' + row.getAttribute('data-id') + '"] [data-k="' + k + '"]';
      }
      return null;
    }
    // Light the drilled-into line. A receipt/payment is a saved row whose
    // voucher field holds that number; a transfer (XFR-…) has no row of its
    // own — it is the transfers table, so that is what gets lit.
    function focusDrilled(vno) {
      var want = String(vno).toUpperCase();
      var row = [].filter.call(sheetEl.querySelectorAll('.row[data-saved]'), function (r) {
        return String(r.getAttribute('data-vno') || '').toUpperCase() === want;
      })[0];
      if (!row && /^XFR-/.test(want)) row = sheetEl.querySelector('.rec');
      global.NfDrill.highlight(row);
    }

    function render() {
      var sel = focusSelector();
      var range = null;
      if (sel && document.activeElement && document.activeElement.selectionStart != null) {
        range = [document.activeElement.selectionStart, document.activeElement.selectionEnd];
      }
      canWrite = (role === 'accountant' || role === 'director') && S.day && S.day.status === 'OPEN';
      var html = renderHeader();
      if (S.day) {
        html += renderPosition() + renderBooks() + renderTri() + renderPdcs() + renderChecks();
      } else {
        html += renderNoDay();
      }
      sheetEl.innerHTML = html;
      wire();
      if (sel) {
        var again = sheetEl.querySelector(sel);
        if (again) {
          again.focus();
          if (range && again.setSelectionRange) { try { again.setSelectionRange(range[0], range[1]); } catch (e) {} }
        }
      }
    }

    // ── save helpers ───────────────────────────────────────────────────────
    function refresh() { return loadDay(S.day ? S.day.business_date : null).then(render); }

    // Every mutating RPC (nf_save_line, nf_set_transfers, nf_save_count, …)
    // already RETURNS the fresh day — the same nf_day_json shape loadDay()
    // fetches separately. Applying it directly, instead of following a
    // success with its own refresh()/nf_get_day round trip, is not just
    // fewer requests: it closes a real race. Two saves close enough together
    // (the transfer, then the cash count, typed within the same second) both
    // read S.day.version before either's OWN refresh() had come back with the
    // other's new number, so the second sent a version already one behind and
    // lost to NF:VERSION_CONFLICT — a person's count silently not saved,
    // reproducible with nothing more than ordinary typing speed. Since the
    // response IS the fresh day, there is no window left for that race.
    function applyDay(res) {
      S.day = res.day || null;
      S.position = res.position || null;
      S.lines = res.lines || [];
      S.jvs = res.jvs || [];
      S.pdcs = res.pdcs || [];
      S.checks = res.checks || [];
      S.balanced = !!res.balanced;
      render();
    }

    // ── the voucher popups (js/nf/nf-voucher-popup.js) ─────────────────────
    function openVoucher(type) {
      global.NfVoucherPopup.open({
        type: type, api: api, companyId: companyId, day: S.day,
        heads: S.heads, floors: S.floors, vias: S.vias, parties: S.parties,
        onSaved: function (res, saved) {
          if (type === 'JV') {
            toast('Journal voucher ' + saved.voucher_no + (saved.manual_no ? ' saved (manual ' + saved.manual_no + ').' : ' saved — manual voucher number pending.'));
            refresh();
            return;
          }
          applyDay(res);
          toast((type.charAt(1) === 'R' ? 'Receipt ' : 'Payment ') + (saved ? saved.voucher_no : '') +
            (saved && saved.manual_no ? ' saved (manual ' + saved.manual_no + ').' : ' saved — manual voucher number pending.'));
          // a payee typed new in the popup is a party now — pick it up for the next one
          api.listAllParties(companyId).then(function (list) { S.parties = list || S.parties; }).catch(function () {});
        },
      });
    }

    function saveSavedLine(side, id, version, patch) {
      var l = S.lines.filter(function (x) { return String(x.id) === String(id); })[0];
      if (!l) return;
      var merged = Object.assign({}, l, patch);
      // nf_save_line's voucher argument is the MANUAL number (docs/PLAN.md
      // §44); the system number is the server's and is never sent. An edit
      // that isn't to the voucher field sends the manual number unchanged.
      var manual = Object.prototype.hasOwnProperty.call(patch, 'voucher_no') ? patch.voucher_no : (l.manual_no || '');
      api.saveLine(S.day.id, id, side, manual, merged.description, merged.head_code, merged.floor_code, merged.via, F.n(merged.amount), version, merged.party_name)
        .then(applyDay)
        .catch(function (err) {
          toast(Msg.forLine(err), true);
          refresh();
        });
    }

    // A plain debounce let two edits typed more than `ms` apart (a normal
    // pause between two denomination fields) fire as two SEPARATE requests.
    // Both read S.day.version before either had resolved, both sent the same
    // version, the second lost the optimistic-lock race with
    // NF:VERSION_CONFLICT, and its half of the count was silently dropped —
    // reproducible with nothing more than an ordinary typing pace. This
    // serialises: a trailing edit that arrives while a save is still in
    // flight is queued, not fired, and the queued run re-reads the LIVE
    // field values (and the now-current S.day.version) instead of stale ones.
    function serialDebounce(fn, ms) {
      var timer = null, running = false, pending = false;
      function runNow() {
        running = true;
        // AUDIT_REPORT.md MEDIUM-3. This used to be `.catch(function () {})`.
        // Every fn() below already catches its OWN save error, toasts it and
        // returns refresh() to re-sync the screen — so anything still
        // rejecting here is that recovery itself failing. Swallowing it left
        // the person looking at a sheet that had silently stopped matching
        // the database, with no sign anything was wrong. The one thing they
        // can actually do about it is reload, so say that.
        // The queue must still drain either way: .then() below runs whether
        // this rejected or not, so a failed run never wedges `running` true
        // and never strands a pending edit.
        // The catch body is itself wrapped (AUDIT_REPORT.md R-4): anything
        // thrown HERE would reject the promise `.then()` is chained to, so
        // `running` would never be cleared and every later edit in this
        // session would be silently queued and never sent. The handler must
        // be incapable of throwing, whatever it is asked to report.
        fn().catch(function (err) {
          try {
            toast('Screen refresh failed — reload.', true);
            if (window.console && console.error) console.error('[nf-sheet] background save/refresh failed', err);
          } catch (e) {
            if (window.console && console.error) console.error('[nf-sheet] could not report a failed save', e, err);
          }
        }).then(function () {
          running = false;
          if (pending) { pending = false; runNow(); }
        });
      }
      return function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          if (running) { pending = true; return; }
          runNow();
        }, ms);
      };
    }
    // Both read from the OVERLAY, not the DOM — the DOM node a render() left
    // behind seconds ago may already belong to a different day's worth of
    // markup by the time this debounce fires; the overlay is the one thing
    // guaranteed to still mean what the person typed.
    var saveTransfers = serialDebounce(function () {
      var tb = transferDraft ? F.n(transferDraft.tBank) : F.n(S.day.transfer_to_bank);
      var tp = transferDraft ? F.n(transferDraft.tPetty) : F.n(S.day.transfer_to_petty);
      return api.setTransfers(S.day.id, tb || null, tp || null, S.day.version)
        .then(function (res) { transferDraft = null; applyDay(res); })
        .catch(function (err) { toast(Msg.forDay(err), true); transferDraft = null; return refresh(); });
    }, 500);
    var saveRemarks = serialDebounce(function () {
      var el = root.querySelector('#nf-remarks');
      var v = el ? el.value : '';
      return api.setRemarks(S.day.id, v, S.day.version)
        .then(function (res) { S.day.version = res.day.version; })
        .catch(function (err) { toast(Msg.forDay(err), true); return refresh(); });
    }, 700);

    // ── wiring ─────────────────────────────────────────────────────────────
    function wire() {
      var sheetBack = root.querySelector('#nf-sheet-back');
      if (sheetBack) sheetBack.addEventListener('click', function () { ctx.onBack(); });
      var themeBtn = root.querySelector('#nf-theme');
      if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
      var printBtn = root.querySelector('#nf-print');
      if (printBtn) printBtn.addEventListener('click', doPrint);
      var toDir = root.querySelector('#nf-toDir');
      if (toDir) toDir.addEventListener('click', function () {
        // NfReport.mount replaces root.innerHTML wholesale — #nf-sheet (the
        // node render()/wire() above operate on) goes with it. "Back" is
        // therefore a full fresh mount() of this screen again, exactly as
        // nexufinance.html's own first entry does, not a call into this
        // closure's own render()/wire(), which would write into a detached
        // node once #nf-sheet is gone. Found before it could ship, not
        // after — reasoned through the DOM structure, not assumed safe.
        global.NfReport.mount(root, {
          api: api, companyId: companyId, dayId: S.day.id, role: role,
          displayName: ctx.displayName, companyName: ctx.companyName, settings: S.settings,
          onBack: function () { global.NfSheet.mount(root, ctx); },
        });
      });
      // Replaces the ten individual report buttons this header used to
      // carry (docs/PLAN.md §23) — one shared dropdown, same
      // { api, companyId, role, displayName, companyName, settings,
      // onBack } shape every report screen's own mount() already
      // expects, built fresh here the same way each of the old
      // individual handlers above did.
      global.NfReportsMenu.wire(root, {
        api: api, companyId: companyId, role: role,
        displayName: ctx.displayName, companyName: ctx.companyName, settings: S.settings,
        onBack: function () { global.NfSheet.mount(root, ctx); },
      });
      var startNext = root.querySelector('#nf-startNext') || root.querySelector('#nf-startNext2');
      if (startNext) startNext.addEventListener('click', function () {
        api.startNextDay(companyId, null).then(applyDay).catch(function (err) { toast(Msg.forDay(err), true); });
      });
      var fdGo = root.querySelector('#nf-fd-go');
      if (fdGo) fdGo.addEventListener('click', function () {
        var date = root.querySelector('#nf-fd-date').value;
        var cno = root.querySelector('#nf-fd-cno').value;
        if (!date) { toast('Pick a date.', true); return; }
        api.startFirstDay(companyId, date, cno, F.n(root.querySelector('#nf-fd-cash').value),
            F.n(root.querySelector('#nf-fd-petty').value), F.n(root.querySelector('#nf-fd-bank').value))
          .then(applyDay)
          .catch(function (err) { toast(Msg.forDay(err), true); });
      });

      if (!S.day) return;

      // saved rows
      root.querySelectorAll('.row[data-saved]').forEach(function (rowEl) {
        if (!canWrite) return;
        var id = rowEl.getAttribute('data-id'), version = Number(rowEl.getAttribute('data-version')), side = rowEl.getAttribute('data-side');
        rowEl.querySelectorAll('[data-k]').forEach(function (inp) {
          // head and party are no longer data-k fields — they are pickers and
          // route through NfPick.wire below. Only voucher, description, floor,
          // via and amount still live as plain inputs/selects here.
          inp.addEventListener('change', function () {
            var k = inp.getAttribute('data-k');
            var patch = {}; patch[{ v: 'voucher_no', d: 'description', f: 'floor_code', m: 'via', a: 'amount' }[k]] = k === 'a' ? F.n(inp.value) : inp.value;
            saveSavedLine(side, id, version, patch);
          });
        });
      });
      root.querySelectorAll('[data-del-saved]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          api.deleteLine(btn.getAttribute('data-del-saved'), Number(btn.getAttribute('data-version')))
            .then(applyDay)
            .catch(function (err) { toast(Msg.forLine(err), true); refresh(); });
        });
      });

      // The head and the party on a SAVED row are the shared type-to-search
      // picker (js/nf/nf-pick.js); a choice goes straight through
      // saveSavedLine. (New vouchers are entered in the popups.)
      function rowOf(wrap) {
        var sv = wrap.closest('.row[data-saved]');
        if (sv && canWrite) {
          return { side: sv.getAttribute('data-side'), id: sv.getAttribute('data-id'),
                   version: Number(sv.getAttribute('data-version')) };
        }
        return null;
      }
      global.NfPick.wire(root, {
        key: 'head',
        items: function () { return global.NfPick.accountItems(S.heads); },
        emptyText: 'No head matches that.',
        onPick: function (wrap, code) {
          var at = rowOf(wrap);
          if (!at) return;
          saveSavedLine(at.side, at.id, at.version, { head_code: code });
        },
      });
      global.NfPick.wire(root, {
        key: 'party',
        items: function () { return global.NfPick.partyItems(S.parties); },
        allowCreate: true,
        onPick: function (wrap, name) {
          var at = rowOf(wrap);
          if (!at) return;
          saveSavedLine(at.side, at.id, at.version, { party_name: name });
        },
      });

      // + CRV / + BRV / + CPV / + BPV / + JV
      root.querySelectorAll('[data-vtype]').forEach(function (btn) {
        btn.addEventListener('click', function () { openVoucher(btn.getAttribute('data-vtype')); });
      });

      // transfers — every keystroke updates the overlay first (so a render()
      // mid-typing has something true to redraw from), then asks for a save;
      // the debounce decides when that actually goes out.
      var tBank = root.querySelector('#nf-tBank'), tPetty = root.querySelector('#nf-tPetty');
      function touchTransferDraft() {
        if (!transferDraft) transferDraft = { tBank: F.grp(S.day.transfer_to_bank), tPetty: F.grp(S.day.transfer_to_petty) };
      }
      if (tBank) tBank.addEventListener('input', function () { touchTransferDraft(); transferDraft.tBank = tBank.value; saveTransfers(); });
      if (tPetty) tPetty.addEventListener('input', function () { touchTransferDraft(); transferDraft.tPetty = tPetty.value; saveTransfers(); });

      // PDCs
      root.querySelectorAll('[data-pdc-add]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var direction = btn.getAttribute('data-pdc-add');
          var chequeNo = prompt('Cheque number:'); if (!chequeNo) return;
          var party = prompt('Party:') || '';
          var bank = prompt('Bank:') || '';
          var due = prompt('Due date (YYYY-MM-DD):'); if (!due) return;
          var amount = F.n(prompt('Amount:'));
          api.savePdc(S.day.id, null, direction, chequeNo, party, bank, due, amount, null)
            .then(applyDay)
            .catch(function (err) { toast(Msg.forLine(err), true); });
        });
      });
      root.querySelectorAll('[data-resolve]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          api.resolvePdc(S.day.id, btn.getAttribute('data-resolve'), 'CLEARED', Number(btn.getAttribute('data-version')))
            .then(applyDay)
            .catch(function (err) { toast(Msg.forDay(err), true); });
        });
      });

      // remarks
      var remarksEl = root.querySelector('#nf-remarks');
      if (remarksEl) remarksEl.addEventListener('input', function () { saveRemarks(); });

      // actions
      var submitBtn = root.querySelector('#nf-submit');
      if (submitBtn) submitBtn.addEventListener('click', function () {
        api.submitDay(S.day.id, S.day.version).then(applyDay).catch(function (err) { toast(Msg.forDay(err), true); refresh(); });
      });
      var closeBtn = root.querySelector('#nf-close');
      if (closeBtn) closeBtn.addEventListener('click', function () {
        // The owner's rule (docs/PLAN.md §44): a voucher may be saved before
        // its paper voucher is written, but the day does not close until
        // every one has its number — so they come up here, to be filled in
        // on the spot. The server enforces the same rule on its own
        // (NF:VOUCHER_NUMBERS_PENDING); this is where a person meets it.
        if (pendingLines().length) { openNumbersDialog(); return; }
        closeNow();
      });
      var returnBtn = root.querySelector('#nf-return');
      if (returnBtn) returnBtn.addEventListener('click', function () {
        var reason = prompt('Why is this day being sent back?'); if (!reason) return;
        api.returnDay(S.day.id, reason, S.day.version).then(applyDay).catch(function (err) { toast(Msg.forDay(err), true); });
      });
      var reopenBtn = root.querySelector('#nf-reopen');
      if (reopenBtn) reopenBtn.addEventListener('click', function () {
        var reason = prompt('Why is this closed day being reopened?'); if (!reason) return;
        api.reopenDay(S.day.id, reason, S.day.version).then(applyDay).catch(function (err) { toast(Msg.forDay(err), true); });
      });
    }

    function closeNow() {
      return api.closeDay(S.day.id, S.day.version, null)
        .then(function (res) { applyDay(res); toast('Day closed.'); })
        .catch(function (err) {
          if (Msg.code(err) === 'NF:VOUCHER_NUMBERS_PENDING') { return refresh().then(openNumbersDialog); }
          toast(Msg.forDay(err), true); refresh();
        });
    }

    // ── Close day: the vouchers still waiting for their manual number ──────
    function openNumbersDialog() {
      var list = pendingLines();
      if (!list.length) return;
      var old = root.querySelector('#nf-numbers-dialog');
      if (old) old.remove();
      var host = document.createElement('div');
      host.className = 'nf-dialog-backdrop';
      host.id = 'nf-numbers-dialog';
      host.innerHTML =
        '<div class="nf-dialog nf-numbers" role="dialog" aria-modal="true" aria-labelledby="nf-numbers-title">' +
        '  <h3 id="nf-numbers-title">' + list.length + (list.length === 1 ? ' voucher needs its' : ' vouchers need their') + ' manual number before the day can close</h3>' +
        '  <p>Type the number written on each paper voucher. A number is never accepted twice for the same voucher type.</p>' +
        '  <div class="nfn-list">' +
        list.map(function (l) {
          var type = String(l.voucher_no || '').split('-')[0];
          return '<div class="nfn-row" data-voucher="' + esc(l.voucher_id) + '" data-ver="' + esc(l.version) + '">' +
            '<span class="nfn-type" title="System number">' + esc(l.voucher_no) + '</span>' +
            '<span class="nfn-desc">' + esc(l.text) + '</span>' +
            '<span class="nfn-amt">' + F.fmt(l.amount) + '</span>' +
            '<input class="nfn-in" data-prefix="' + esc(type + '-') + '" value="" placeholder="' + esc(type) + ' manual no." aria-label="Manual voucher number for ' + esc(l.voucher_no) + '">' +
            '<span class="nfn-err" hidden></span></div>';
        }).join('') +
        '  </div>' +
        '  <div class="actions"><button class="btn" type="button" id="nf-numbers-later">Later</button>' +
        '  <button class="btn primary" type="button" id="nf-numbers-go">Save numbers &amp; close day</button></div>' +
        '</div>';
      root.appendChild(host);
      var first = host.querySelector('.nfn-in');
      if (first) { first.focus(); first.setSelectionRange(first.value.length, first.value.length); }
      host.querySelector('#nf-numbers-later').addEventListener('click', function () { host.remove(); });
      host.addEventListener('keydown', function (e) { if (e.key === 'Escape') host.remove(); });
      host.querySelector('#nf-numbers-go').addEventListener('click', function () {
        var go = host.querySelector('#nf-numbers-go');
        go.disabled = true;
        var rows = [].slice.call(host.querySelectorAll('.nfn-row'));
        // One at a time: each save returns the fresh day, and the next reads
        // its line's own version from that — never a stale one.
        var chain = Promise.resolve(), failed = 0;
        rows.forEach(function (rowEl) {
          chain = chain.then(function () {
            var inp = rowEl.querySelector('.nfn-in'), errEl = rowEl.querySelector('.nfn-err');
            var v = inp.value.trim();
            errEl.hidden = true;
            if (!v || v.toUpperCase() === inp.getAttribute('data-prefix').toUpperCase()) { failed++; errEl.textContent = 'Number still missing.'; errEl.hidden = false; return; }
            // nf_set_manual_no sets ONLY the manual number — the same call for
            // a cash-book line and a JV (docs/PLAN.md §45)
            return api.setManualNo(rowEl.getAttribute('data-voucher'), v, Number(rowEl.getAttribute('data-ver')))
              .then(function () { rowEl.classList.add('done'); inp.disabled = true; })
              .catch(function (err) { failed++; errEl.textContent = Msg.forLine(err); errEl.hidden = false; });
          });
        });
        chain.then(refresh).then(function () {
          if (failed || pendingLines().length) { go.disabled = false; return; }
          host.remove();
          return closeNow();
        });
      });
    }

    // ── theme ──────────────────────────────────────────────────────────────
    function toggleTheme() {
      var root2 = document.documentElement;
      var cur = root2.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      var nx = cur === 'dark' ? 'light' : 'dark';
      root2.dataset.theme = nx;
      try { localStorage.setItem('nf-theme', nx); } catch (e) {}
    }

    // ── print ──────────────────────────────────────────────────────────────
    function doPrint() {
      if (!S.day) { window.print(); return; }
      var oldTitle = document.title;
      document.title = 'Awami_Daily_Closing_' + F.ddMonYyyy(S.day.business_date);
      function restore() { document.title = oldTitle; window.removeEventListener('afterprint', restore); }
      window.addEventListener('afterprint', restore);
      setTimeout(restore, 4000); // afterprint doesn't fire in some headless contexts
      window.print();
    }

    // ── boot ───────────────────────────────────────────────────────────────
    try {
      var saved = localStorage.getItem('nf-theme');
      if (saved) document.documentElement.dataset.theme = saved;
    } catch (e) {}

    // ctx.date / ctx.focusVoucher: opened by a drill from a ledger
    // (js/nf/nf-drill.js, docs/PLAN.md §43) on the day that voucher belongs
    // to, with its line lit. Without them — every normal open — this is
    // exactly the old boot: the latest day, nothing highlighted.
    return Promise.all([loadLookups(), loadDay(ctx.date || null)]).then(function () {
      render();
      if (ctx.focusVoucher) focusDrilled(ctx.focusVoucher);
    }).catch(function (err) {
      sheetEl.innerHTML = '<div class="nf-gate"><h2>The cash book could not load</h2><p>' + esc(err && err.message) + '</p></div>';
      throw err;
    });
  }

  global.NfSheet = { mount: mount };
})(window);
