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
 * REDESIGNED 2026-09-21 (docs/PLAN.md §42) — UI only. Not one RPC, argument,
 * validation rule or NF:* error changed; every mandatory field is still
 * mandatory. What changed is the screen: a day bar with the opening balances
 * as KPI figures, Money In / Money Out / Transfers as sections, a closing
 * summary as the page's anchor, the cash count moved out of the main flow
 * into a collapsed drawer, and — the real complaint — a proper ENTRY PANEL in
 * place of the cramped inline add-row and, for cheques, in place of a chain
 * of browser prompt() boxes. The PRINTED document is deliberately unchanged:
 * the DOM still carries every element and class css/nf/nf-print.css targets,
 * and the whole redesign lives inside @media screen.
 *
 *   - the server is the only source of truth. A line is either SAVED (came
 *     back from nf_get_day) or still in the entry panel, which will not send
 *     until it is complete — so an incomplete line can never become a saved
 *     fact with a hole in it.
 *   - a database refusal (NEGATIVE_POSITION, DUPLICATE_VOUCHER, …) is shown
 *     in plain language ON THE FIELD THAT CAUSED IT (js/nf/nf-messages.js),
 *     and the panel stays open with everything typed still in it — nothing is
 *     silently discarded.
 *   - amounts carry two decimals, shown only when present (js/nf/nf-format.js).
 *   - Submit / Close are gated by the SERVER's checks, nothing else.
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
      day: null, latest: null, position: null, lines: [], pdcs: [], checks: [], balanced: true,
      settings: ctx.settings || {},
    };
    // The entry panel is now the only place a NEW line, transfer or cheque is
    // typed (docs/PLAN.md §42): one focused form instead of a seven-column
    // strip squeezed into a table row. Its values live HERE rather than in the
    // DOM, for exactly the reason countDraft/transferDraft do — a render()
    // triggered by an unrelated save landing mid-typing must have something
    // true to redraw from. SAVED lines stay inline-editable rows, unchanged.
    var panel = null;   // {mode:'line'|'transfer'|'pdc', side, dir, v:{…}, error, saving}
    // Cash count and transfers live only in the DOM once typed, same as a
    // draft line — but unlike a draft line they have nowhere else to be kept.
    // Without an overlay, a render() triggered by an UNRELATED save landing
    // late (the transfer save, still in flight while the person has already
    // moved on to typing the cash count) rebuilds these fields from the last
    // server state and silently erases whatever had just been typed. null
    // means "show the server's own value"; once set, it's shown instead,
    // until its own save clears it back to null.
    var countDraft = null;      // {"5000": "50", "1000": "60", ...} | null
    var transferDraft = null;   // {tBank, tPetty} | null
    // R6/(f): counting the physical cash is optional and never blocks a close,
    // so it is collapsed by default and out of the main flow. Kept in local
    // state (not the DOM) so a render() mid-session does not slam it shut.
    var countOpen = false;
    var busy = false;

    // Cash and Petty take a C-prefixed voucher, Bank a B-prefixed one — the
    // pairing nf_save_line enforces as NF:VOUCHER_VIA_MISMATCH. The panel
    // shows that prefix as a fixed affix next to the field and the person
    // types only the number, so the shape is right by construction. The RULE
    // is untouched; this only stops people tripping over it.
    function voucherAffix(side, via) {
      return (via === 'Bank' ? 'B' : 'C') + (side === 'IN' ? 'RV-' : 'PV-');
    }
    function blankLinePanel(side) {
      return { mode: 'line', side: side, error: null, saving: false,
        v: { amt: '', via: '', head: '', floor: '', party: '', vno: '', desc: '' } };
    }
    function openPanel(p) { panel = p; render(); focusPanel(); }
    function closePanel() { panel = null; render(); }
    function focusPanel() {
      var first = sheetEl.querySelector('#nf-p-amt') || sheetEl.querySelector('#nf-p-cheque') || sheetEl.querySelector('#nf-tBank');
      if (first) { try { first.focus(); first.select && first.select(); } catch (e) {} }
    }

    root.innerHTML =
      '<main class="sheet" id="nf-sheet"></main>' +
      '<p class="note" id="nf-note"></p>' +
      '<div id="nf-toast-host"></div>';
    var sheetEl = root.querySelector('#nf-sheet');
    var noteEl = root.querySelector('#nf-note');
    noteEl.textContent = 'Record a receipt or a payment from the button in each section. A refused entry keeps everything you typed ' +
      'and shows the reason on the field that caused it. Saved lines can still be corrected in place. Counting the physical cash is ' +
      'optional and sits at the bottom. "Start new day" carries today’s closing forward as tomorrow’s opening.';

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
    // requires_party comes back per head from nf_list_heads (20260919i) —
    // look it up by code rather than re-deriving it, the same way headName()
    // already does.
    function headRequiresParty(code) {
      var h = S.heads.filter(function (x) { return x.code === code; })[0];
      return !!(h && h.requires_party);
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
        (d ? '    <button class="btn" id="nf-toDir" type="button">Director report</button>' : '') +
        global.NfReportsMenu.html('closing') +
        (d && d.status === 'CLOSED' && d.is_latest ? '    <button class="btn" id="nf-startNext" type="button">Start new day</button>' : '') +
        '    <button class="btn primary" id="nf-print" type="button">' +
        '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="7"/></svg>Print</button>' +
        '  </div>' +
        '</header>' +
        // The screen's day bar. It carries the SAME .status element the print
        // strip below does and sits BEFORE it in the DOM on purpose, so
        // querySelector('.status span') always resolves to the one a person
        // can actually see. The .docmeta strip underneath is the printed
        // document's own header and is hidden on screen (docs/PLAN.md §42, R4).
        (d ? '<div class="nf-daybar nf-screen-only">' +
        '  <div class="nf-daybar-id">' +
        '    <span class="nf-date">' + F.longDate(dateVal) + '</span>' +
        '    <span class="nf-dot">·</span><span class="nf-cno">' + esc(closingNo) + '</span>' +
        '  </div>' +
        '  <div class="nf-daybar-state">' +
        '    <span class="status ' + (statusOk ? 'ok' : 'bad') + '"><i></i><span>' + esc(statusText) + '</span></span>' +
        statePill +
        '  </div>' +
        '</div>' + openingKpisHTML() : '') +
        '<div class="docmeta nf-print-only">' +
        '  <div><label>Closing date</label><span class="v">' + (d ? F.longDate(dateVal) : '–') + '</span></div>' +
        '  <div><label>Day</label><span class="v">' + (d ? F.weekday(dateVal) : '–') + '</span></div>' +
        '  <div><label>Closing no.</label><span class="v">' + esc(closingNo) + '</span></div>' +
        '  <div><label>Prepared by</label><span class="v">' + esc((d && d.prepared_by_name) || ctx.displayName || '') + '</span></div>' +
        '  <div>' + (d ? '<span class="status ' + (statusOk ? 'ok' : 'bad') + '"><i></i><span>' + esc(statusText) + '</span></span>' + statePill : '') + '</div>' +
        '</div>';
    }

    // ── KPI figures ────────────────────────────────────────────────────────
    // One renderer for both KPI rows. `F.fmt` is untouched: it already groups
    // thousands, shows paisa only when they exist, renders zero as – and
    // negatives in parentheses. What changes is only that the figure is now
    // set at 32px in tabular numerals with room around it.
    function kpiTile(label, value, tone) {
      var cls = 'nf-kpi' + (tone ? ' ' + tone : '');
      return '<div class="' + cls + '"><span class="nf-kpi-l">' + esc(label) + '</span>' +
        '<span class="nf-kpi-v t">' + F.fmt(value) + '</span></div>';
    }
    function byVia(which) {
      var rows = (S.position && S.position.rows) || [];
      var r = rows.filter(function (x) { return x.via === which; })[0];
      return r || {};
    }
    function openingKpisHTML() {
      if (!S.position) return '';
      return '<div class="nf-kpirow nf-screen-only">' +
        kpiTile('Opening cash', byVia('Cash').opening) +
        kpiTile('Opening petty cash', byVia('Petty').opening) +
        kpiTile('Opening bank', byVia('Bank').opening) +
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
      // The screen's anchor: the day's headline, set large, above the
      // per-account detail. It reuses the .kpis/.kpi/b classes deliberately —
      // it is the same fact the printed summary box states, and it sits
      // EARLIER in the DOM so querySelector('.kpis b') resolves to the figure
      // a person can actually see rather than the print-only one below.
      var anchor = '<div class="nf-anchor nf-screen-only">' +
        '  <div class="sh"><h2>Closing</h2><span>Amounts in PKR</span></div>' +
        '  <div class="nf-kpirow nf-kpirow-4">' +
        kpiTile('Cash in hand', byVia('Cash').closing) +
        kpiTile('Petty cash', byVia('Petty').closing) +
        kpiTile('Bank', byVia('Bank').closing) +
        '    <div class="nf-kpi nf-kpi-total kpis"><div class="kpi"><span class="nf-kpi-l">Total closing</span>' +
        '      <b class="nf-kpi-v t">Rs ' + F.fmt(t.closing) + '</b></div></div>' +
        '  </div>' +
        '  <div class="nf-flow">' +
        '    <span class="nf-flow-i">Received <b class="t">' + F.fmt(t.received) + '</b></span>' +
        '    <span class="nf-flow-o">Paid <b class="t">' + F.fmt(t.paid) + '</b></span>' +
        '    <span class="nf-flow-n">Net <b class="t" style="color:' + (net < 0 ? 'var(--neg)' : 'var(--pos)') + '">' +
        (net < 0 ? '−' : '+') + ' ' + F.fmt(Math.abs(net)) + '</b></span>' +
        '    <span class="nf-flow-c">' + receipts + ' receipt' + (receipts === 1 ? '' : 's') + ' · ' +
        payments + ' payment' + (payments === 1 ? '' : 's') + '</span>' +
        '  </div>' +
        '</div>';

      return '' +
        '<section class="sec sec-pos">' + anchor +
        '<div class="sh nf-print-only"><h2>Cash and bank position</h2><span>Amounts in PKR</span></div>' +
        '<div class="pos-grid">' +
        '  <div class="box"><table class="pos"><thead><tr><th>Account</th><th class="r">Opening</th><th class="r">Received</th><th class="r">Paid</th><th class="r">Transfers</th><th class="r">Closing</th></tr></thead><tbody>' + body + '</tbody></table></div>' +
        '  <div class="kpis">' +
        '    <div class="kpi"><small>Total closing, cash and bank</small><b>Rs ' + F.fmt(t.closing) + '</b></div>' +
        '    <div class="kpi"><small>Net movement today</small><span class="sub t" style="color:' + (net < 0 ? 'var(--neg)' : 'var(--pos)') + '">' + (net < 0 ? '−' : '+') + ' Rs ' + F.fmt(Math.abs(net)) + '</span> <span class="muted">received less paid</span></div>' +
        '    <div class="kpi"><small>Entries</small><span class="sub">' + receipts + ' receipt' + (receipts === 1 ? '' : 's') + ', ' + payments + ' payment' + (payments === 1 ? '' : 's') + '</span></div>' +
        // R3 (owner-approved): amount-in-words is a paper convention; on
        // screen it restates a figure already set at 32px. Kept for print.
        '    <div class="words nf-print-only">Rupees ' + F.words(t.closing) + ' only' + (totClose < 0 ? ' (negative)' : '') + '</div>' +
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
      return '<option value="">–</option>' + S.vias.map(function (v) {
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
        placeholder: '', ariaLabel: 'Party', missing: missing,
      });
    }
    function savedRowHTML(side, l) {
      return '<div class="grid row" data-saved="1" data-id="' + l.id + '" data-version="' + l.version + '" data-side="' + side + '">' +
        '<input class="vno" data-k="v" value="' + esc(l.voucher_no) + '" ' + (canWrite ? '' : 'disabled') + ' aria-label="Voucher number">' +
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
      var emptyIn = '<div class="nf-empty nf-screen-only">No receipts yet today.</div>';
      var emptyOut = '<div class="nf-empty nf-screen-only">No payments yet today.</div>';
      var rowsIn = savedIn.length ? savedIn.map(function (l) { return savedRowHTML('IN', l); }).join('') : emptyIn;
      var rowsOut = savedOut.length ? savedOut.map(function (l) { return savedRowHTML('OUT', l); }).join('') : emptyOut;

      function footer(side, saved) {
        var byVia = { Cash: 0, Petty: 0, Bank: 0 };
        var all = 0;
        saved.forEach(function (l) { byVia[l.via] = (byVia[l.via] || 0) + F.n(l.amount); all += F.n(l.amount); });
        return '<span>Cash</span><span class="r">' + F.fmt(byVia.Cash) + '</span><span>Petty cash</span><span class="r">' + F.fmt(byVia.Petty) +
          '</span><span>Bank</span><span class="r">' + F.fmt(byVia.Bank) + '</span>' +
          '<span class="grand">Total ' + (side === 'IN' ? 'received' : 'paid') + '</span><span class="r grand">' + F.fmt(all) + '</span>';
      }

      function book(side, title, vouchers, saved, rows) {
        var n = saved.length;
        return '<div class="book ' + (side === 'IN' ? 'in' : 'out') + '">' +
          '<div class="bh"><h3><i></i>' + title + ' <small>' + vouchers + '</small></h3>' +
          '<span class="cnt">' + n + ' ' + (n === 1 ? 'entry' : 'entries') + '</span>' +
          (canWrite ? '<button class="nf-record nf-screen-only" type="button" data-side="' + side + '">+ Record ' +
            (side === 'IN' ? 'receipt' : 'payment') + '</button>' : '') + '</div>' +
          '<div class="grid cols"><span>Voucher</span><span>Description and head</span><span>Party</span>' +
          '<span class="c">Floor</span><span class="c">Via</span><span class="r">Amount</span><span></span></div>' +
          '<div id="nf-rows' + (side === 'IN' ? 'In' : 'Out') + '">' + rows + '</div>' +
          '<div class="bf">' + footer(side, saved) + '</div></div>';
      }

      return '' +
        '<section class="sec sec-books"><div class="books">' +
        book('IN', 'Money In', 'CRV / BRV', savedIn, rowsIn) +
        book('OUT', 'Money Out', 'CPV / BPV', savedOut, rowsOut) +
        '</div></section>' +
        // R2 (owner-approved): the payments-by-head breakdown is the Director
        // Report's and the Floor Summary's job on screen — both one click away
        // in the Reports menu. It stays in the DOM because the PRINTED closing
        // still carries it, and print is deliberately unchanged.
        '<section class="sec sec-heads nf-print-only"><div class="sh"><h2>Payments by head</h2></div><div class="box"><table class="heads"><colgroup><col><col style="width:96px"></colgroup><tbody>' +
        headsTable(savedOut) + '</tbody><tfoot><tr><td>Total</td><td class="r t">' + F.fmt(savedOut.reduce(function (t, l) { return t + F.n(l.amount); }, 0)) + '</td></tr></tfoot></table></div></section>';
    }
    function headsTable(savedOut) {
      var by = {};
      savedOut.forEach(function (l) { by[l.head_code] = (by[l.head_code] || 0) + F.n(l.amount); });
      var codes = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; });
      if (!codes.length) return '<tr><td class="empty-note" colspan="2">No payments yet.</td></tr>';
      return codes.map(function (c) { return '<tr><td><span class="code">' + esc(c) + '</span>' + esc(headName(c)) + '</td><td class="r t">' + F.fmt(by[c]) + '</td></tr>'; }).join('');
    }

    // ── cash count / transfers ─────────────────────────────────────────────
    var DENOMS = [5000, 1000, 500, 100, 75, 50, 20, 10];
    function renderTri() {
      if (!S.day) return '';
      var d = S.day;
      // countDraft holds what is on screen while it's being typed; its keys
      // are raw input strings (possibly grouped, possibly mid-edit), so read
      // amounts through F.n() same as a denominations value from the server.
      var den = countDraft || d.denominations || {};
      var cells = DENOMS.map(function (v) { return { k: String(v), lab: 'Rs ' + v.toLocaleString('en-US') }; }).concat([{ k: 'coins', lab: 'Coins (Rs)' }]);
      function cell(c, first) {
        if (!c) return '<td class="sep"></td><td></td><td></td>';
        var v = den[c.k];
        var blank = v === undefined || v === null || String(v).trim() === '';
        var amt = c.k === 'coins' ? F.n(v) : F.n(v) * Number(c.k);
        return '<td class="' + (first ? '' : 'sep') + '">' + c.lab + '</td><td class="r"><input class="fld" data-den="' + c.k + '" inputmode="decimal" value="' + (blank ? '' : (countDraft ? esc(v) : F.grp(v))) + '" aria-label="' + c.lab + '" ' + (canWrite ? '' : 'disabled') + '></td><td class="r t">' + (blank ? '–' : F.fmt(amt)) + '</td>';
      }
      var denBody = '';
      for (var i = 0; i < 5; i++) denBody += '<tr>' + cell(cells[i], true) + cell(cells[i + 5], false) + '</tr>';

      var cashRow = ((S.position && S.position.rows) || []).filter(function (r) { return r.via === 'Cash'; })[0];
      var book = cashRow ? F.n(cashRow.closing) : 0;
      // Computed from what's on screen (den), not from the server's stored
      // counted_cash — so the total updates live as the person types, exactly
      // like the reference, and never shows a figure that doesn't match what
      // the fields say right now.
      var anyCount = Object.keys(den).some(function (k) { return den[k] !== undefined && den[k] !== null && String(den[k]).trim() !== ''; });
      var counted = anyCount ? Object.keys(den).reduce(function (t, k) {
        var v = den[k]; if (v === undefined || v === null || String(v).trim() === '') return t;
        return t + (k === 'coins' ? F.n(v) : F.n(v) * Number(k));
      }, 0) : null;
      var diff = counted === null ? null : book - counted;

      var tb = transferDraft ? transferDraft.tBank : F.grp(d.transfer_to_bank);
      var tp = transferDraft ? transferDraft.tPetty : F.grp(d.transfer_to_petty);
      var countState = counted === null ? 'Not counted'
        : diff === 0 ? 'Counted · matches the book'
        : diff > 0 ? 'Counted · short ' + F.fmt(Math.abs(diff))
        : 'Counted · over ' + F.fmt(Math.abs(diff));

      return '' +
        // The screen's Transfers section. The editable fields themselves live
        // in the entry panel; this shows the figures and opens it. The .rec
        // table below keeps them as static text for the printed document.
        '<section class="sec sec-xfer nf-screen-only"><div class="sh"><h2>Transfers</h2>' +
        (canWrite ? '<button class="nf-record" type="button" data-xfer="1">+ Record transfer</button>' : '') +
        '</div><div class="nf-kpirow nf-kpirow-2">' +
        kpiTile('Cash → Bank', d.transfer_to_bank) +
        kpiTile('Cash → Petty cash', d.transfer_to_petty) +
        '</div></section>' +
        '<section class="sec sec-tri"><div class="tri">' +
        '  <div class="tri-count"><div class="sh"><h2>Cash count</h2><span>Cash in hand</span>' +
        '    <button class="nf-drawer-toggle nf-screen-only" type="button" id="nf-count-toggle" aria-expanded="' + (countOpen ? 'true' : 'false') + '">' +
        '      <span class="nf-drawer-state">' + esc(countState) + '</span><span class="nf-drawer-caret">' + (countOpen ? '▴' : '▾') + '</span></button>' +
        '    </div>' +
        '    <div class="nf-drawer-body' + (countOpen ? '' : ' is-collapsed') + '" id="nf-count-body">' +
        '    <div class="box"><table class="den"><thead><tr><th>Note</th><th class="r">Pieces</th><th class="r">Amount</th><th class="sep">Note</th><th class="r">Pieces</th><th class="r">Amount</th></tr></thead>' +
        // …</table> closes the table, </div> the .box, </div> the
        // .nf-drawer-body, and the last </div> the .tri-count itself. Getting
        // that last one wrong nests .tri-xfer INSIDE .tri-count, which stacks
        // the two tables instead of setting them side by side and pushes the
        // printed closing onto a second page (caught by UI-06, 2026-09-21).
        '    <tbody>' + denBody + '</tbody><tfoot><tr><td colspan="5">Total cash counted</td><td class="r t">' + (counted === null ? '–' : F.fmt(counted)) + '</td></tr></tfoot></table></div></div></div>' +
        '  <div class="tri-xfer"><div class="sh"><h2>Transfers and reconciliation</h2></div>' +
        '    <div class="box"><table class="rec">' +
        // The two transfer figures are static here now: the editable fields
        // moved into the entry panel. Print is unaffected — it stripped the
        // input borders anyway and only ever showed the value.
        '      <tr><td>Cash deposited in bank</td><td class="r t">' + F.fmt(d.transfer_to_bank) + '</td></tr>' +
        '      <tr><td>Cash given to petty cash</td><td class="r t">' + F.fmt(d.transfer_to_petty) + '</td></tr>' +
        '      <tr><td>Cash in hand as per book</td><td class="r t">' + F.fmt(book) + '</td></tr>' +
        '      <tr><td>Cash in hand as counted</td><td class="r t">' + (counted === null ? 'Not counted' : F.fmt(counted)) + '</td></tr>' +
        '      <tr class="hl"><td>' + (diff === null ? 'Difference' : diff === 0 ? 'Difference, cash matches' : diff > 0 ? 'Cash short' : 'Cash over') + '</td>' +
        '          <td class="r t" style="color:' + (diff === null ? '' : diff === 0 ? 'var(--pos)' : 'var(--neg)') + '">' + (diff === null ? '–' : F.fmt(Math.abs(diff))) + '</td></tr>' +
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
          (canWrite ? '<div class="nf-pdc-add"><button class="add" type="button" data-pdc-add="' + (id === 'nf-pdcIn' ? 'RECEIVED' : 'ISSUED') + '">+ Add cheque</button></div>' : '') +
          '</div></div>';
      }
      return '<section class="sec sec-pdcs"><div class="pdcs">' + table('nf-pdcIn', 'Post-dated cheques received', inn) + table('nf-pdcOut', 'Post-dated cheques issued', out) + '</div></section>';
    }

    // ── checks / sign-off ───────────────────────────────────────────────────
    function renderChecks() {
      if (!S.day) return '';
      // The client-side "this draft row is incomplete" warnings are gone with
      // the draft rows themselves: the entry panel will not save until the
      // same fields are filled, so an incomplete line can no longer reach the
      // sheet to be warned about. Every SERVER check is untouched and still
      // the only thing that gates Submit/Close.
      var extra = [];
      var serverTexts = (S.checks || []).map(function (c) { return c.text; });
      var all = serverTexts.concat(extra);
      var ok = all.length === 0;
      var listHtml = ok
        ? '<li>All checks passed. Every line has a voucher, head, floor and account; no balance is negative; counted cash matches the book.</li>'
        : all.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('');
      var canClose = canWrite;
      var mismatchOnly = (S.checks || []).length && (S.checks || []).every(function (c) { return c.key === 'count_mismatch'; }) && !extra.length;

      return '' +
        '<section class="sec sec-checks"><div class="sh"><h2>Checks</h2></div>' +
        '<ul class="checks ' + (ok ? 'ok' : 'bad') + '">' + listHtml + '</ul>' +
        (mismatchOnly && role === 'director' ? varianceBoxHTML() : '') +
        '<textarea class="remarks" id="nf-remarks" placeholder="Remarks" ' + (canWrite ? '' : 'disabled') + '>' + esc(S.day.remarks || '') + '</textarea>' +
        '<div class="nf-day-actions">' + actionButtons(ok, mismatchOnly) + '</div>' +
        '</section>' +
        // R1 (owner-approved): the three signature blocks are a paper
        // convention and dead pixels on screen. Kept in the DOM because the
        // PRINTED closing is a signed document.
        '<div class="signs nf-print-only">' +
        '  <div><span>Prepared by (Accountant)</span><span>Date</span></div>' +
        '  <div><span>Checked by</span><span>Date</span></div>' +
        '  <div><span>Approved by (Director)</span><span>Date</span></div>' +
        '</div>' +
        '<div class="docfoot"><span>' + esc(ctx.companyName || '') + ' · Daily Cash &amp; Bank Closing</span><span id="nf-stamp">' + esc(S.day.closing_no || '') + ' · ' + F.ddMonYyyy(S.day.business_date) + '</span></div>';
    }
    function varianceBoxHTML() {
      return '<div class="variance-box show" id="nf-variance-box"><b>Cash count does not match the books.</b> Only a director may close ' +
        'with a variance, and only with a written reason.<textarea id="nf-variance-reason" placeholder="What actually happened…"></textarea></div>';
    }
    function actionButtons(ok, mismatchOnly) {
      if (!S.day) return '';
      var btns = [];
      if (S.day.status === 'OPEN' && (role === 'accountant' || role === 'director')) {
        btns.push('<button class="btn" id="nf-submit" type="button"' + (ok ? '' : ' disabled') + '>Submit</button>');
      }
      if ((S.day.status === 'OPEN' || S.day.status === 'SUBMITTED') && (role === 'accountant' || role === 'director')) {
        var closeDisabled = !ok && !(mismatchOnly && role === 'director');
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

    // ── the entry panel ────────────────────────────────────────────────────
    // One focused form for everything that used to be typed into a cramped
    // row or, worse, a chain of browser prompt() boxes (PDCs). It is the only
    // place a NEW record is created; saved rows stay inline-editable.
    //
    // Error behaviour is deliberately unchanged in substance: the same NF:*
    // code comes back from the same RPC and is rendered by the same
    // Msg.forLine/Msg.forDay. What changed is only WHERE it appears — on the
    // field that caused it, in a panel that stays open with every value the
    // person typed still in it.
    function fieldErr(p, field) {
      return (p.error && p.error.field === field) ? '<div class="nf-fe">' + esc(p.error.message) + '</div>' : '';
    }
    function panelHTML() {
      if (!panel) return '';
      var p = panel, body = '', title = '', save = 'Save';
      if (p.mode === 'line') {
        var needParty = p.v.head && headRequiresParty(p.v.head);
        title = p.side === 'IN' ? 'Record receipt' : 'Record payment';
        body =
          '<label class="nf-f nf-f-amt"><span>Amount</span>' +
          '  <input id="nf-p-amt" class="nf-in nf-in-amt t" inputmode="decimal" value="' + esc(p.v.amt) + '" placeholder="0" aria-label="Amount">' +
          fieldErr(p, 'amount') + '</label>' +
          '<div class="nf-f"><span>Through</span><div class="nf-seg" role="group" aria-label="Cash, petty or bank">' +
          S.vias.map(function (x) {
            return '<button type="button" class="nf-seg-b' + (p.v.via === x.via ? ' on' : '') + '" data-p-via="' + esc(x.via) + '">' + esc(x.via) + '</button>';
          }).join('') + '</div>' + fieldErr(p, 'via') + '</div>' +
          '<div class="nf-f"><span>Head</span>' + global.NfPick.html({
            key: 'pane-head', value: p.v.head || '', label: global.NfPick.accountLabel(S.heads, p.v.head),
            placeholder: 'Search by code or name', ariaLabel: 'Account head', missing: p.error && p.error.field === 'head',
          }) + fieldErr(p, 'head') + '</div>' +
          '<div class="nf-f nf-f-half"><span>Floor</span>' +
          '  <select id="nf-p-floor" class="nf-in" aria-label="Floor">' + floorOpts(p.v.floor) + '</select>' +
          fieldErr(p, 'floor') + '</div>' +
          (needParty ? '<div class="nf-f"><span>Party</span>' + global.NfPick.html({
            key: 'pane-party', value: p.v.party || '', label: p.v.party || '',
            placeholder: 'Search, or add a new one', ariaLabel: 'Party', missing: p.error && p.error.field === 'party',
          }) + fieldErr(p, 'party') + '</div>' : '') +
          '<div class="nf-f nf-f-half"><span>Voucher no.</span>' +
          '  <div class="nf-affixed"><span class="nf-affix t">' + esc(voucherAffix(p.side, p.v.via)) + '</span>' +
          '  <input id="nf-p-vno" class="nf-in t" value="' + esc(p.v.vno) + '" placeholder="001" aria-label="Voucher number"></div>' +
          fieldErr(p, 'voucher') + '</div>' +
          '<label class="nf-f"><span>Narration</span>' +
          '  <input id="nf-p-desc" class="nf-in" value="' + esc(p.v.desc) + '" placeholder="What this was for" aria-label="Description"></label>';
      } else if (p.mode === 'transfer') {
        title = 'Record transfer';
        // These two inputs keep their ids, their overlay and their debounced
        // save path exactly as before — only their location changed. The
        // serialDebounce that owns them is untouched.
        body =
          '<label class="nf-f nf-f-amt"><span>Cash → Bank</span>' +
          '  <input id="nf-tBank" class="nf-in nf-in-amt t" inputmode="decimal" value="' + esc(p.v.tBank) + '" aria-label="Cash deposited in bank"></label>' +
          '<label class="nf-f nf-f-amt"><span>Cash → Petty cash</span>' +
          '  <input id="nf-tPetty" class="nf-in nf-in-amt t" inputmode="decimal" value="' + esc(p.v.tPetty) + '" aria-label="Cash given to petty cash"></label>' +
          '<p class="nf-hint">Saved as you type. Close when you are done.</p>';
        save = 'Done';
      } else {
        title = p.dir === 'RECEIVED' ? 'Add cheque received' : 'Add cheque issued';
        body =
          '<label class="nf-f nf-f-amt"><span>Amount</span>' +
          '  <input id="nf-p-amt" class="nf-in nf-in-amt t" inputmode="decimal" value="' + esc(p.v.amt) + '" placeholder="0" aria-label="Amount"></label>' +
          '<label class="nf-f nf-f-half"><span>Cheque no.</span>' +
          '  <input id="nf-p-cheque" class="nf-in t" value="' + esc(p.v.cheque) + '" aria-label="Cheque number"></label>' +
          '<label class="nf-f nf-f-half"><span>Due date</span>' +
          '  <input id="nf-p-due" class="nf-in" type="date" value="' + esc(p.v.due) + '" aria-label="Due date"></label>' +
          '<label class="nf-f"><span>Party</span>' +
          '  <input id="nf-p-party" class="nf-in" value="' + esc(p.v.party) + '" aria-label="Party"></label>' +
          '<label class="nf-f"><span>Bank</span>' +
          '  <input id="nf-p-bank" class="nf-in" value="' + esc(p.v.bank) + '" aria-label="Bank"></label>';
      }
      return '<div class="nf-panel-wrap nf-screen-only" id="nf-panel">' +
        '<div class="nf-panel-scrim" data-p-close="1"></div>' +
        '<form class="nf-panel" role="dialog" aria-label="' + esc(title) + '">' +
        '  <div class="nf-panel-h"><h3>' + esc(title) + '</h3>' +
        '    <button type="button" class="nf-panel-x" data-p-close="1" aria-label="Close">✕</button></div>' +
        '  <div class="nf-panel-b">' + body +
        (p.error && !p.error.field ? '<div class="nf-fe nf-fe-top" id="nf-p-err">' + esc(p.error.message) + '</div>' : '') +
        '  </div>' +
        '  <div class="nf-panel-f"><button type="button" class="btn" data-p-close="1">Cancel</button>' +
        '    <button type="button" class="btn primary" id="nf-p-save"' + (p.saving ? ' disabled' : '') + '>' + esc(save) + '</button></div>' +
        '</form></div>';
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
    // redraw: an id, a data-den key, or a data-k field within the same
    // draft/saved row (identified by its tmpId/line id, not by DOM position).
    function focusSelector() {
      var el = document.activeElement;
      if (!el || !sheetEl.contains(el)) return null;
      if (el.id) return '#' + el.id;
      var den = el.getAttribute('data-den');
      if (den) return '[data-den="' + den + '"]';
      var k = el.getAttribute('data-k');
      if (k) {
        var row = el.closest('[data-saved]');
        if (row) return '[data-id="' + row.getAttribute('data-id') + '"] [data-k="' + k + '"]';
      }
      return null;
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
      html += panelHTML();
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
      S.pdcs = res.pdcs || [];
      S.checks = res.checks || [];
      S.balanced = !!res.balanced;
      render();
    }

    // Which field a refusal belongs to. The message itself is still whatever
    // js/nf/nf-messages.js says for that NF:* code — this only decides where
    // to hang it, and falls back to the top of the panel when a code does not
    // name one field.
    var ERR_FIELD = {
      'NF:PARTY_REQUIRED': 'party',
      'NF:HEAD_REQUIRED': 'head', 'NF:HEAD_NOT_POSTABLE': 'head',
      'NF:FLOOR_REQUIRED': 'floor',
      'NF:VIA_REQUIRED': 'via', 'NF:VIA_UNKNOWN': 'via', 'NF:VIA_NOT_CONFIGURED': 'via',
      'NF:VOUCHER_REQUIRED': 'voucher', 'NF:VOUCHER_PREFIX': 'voucher',
      'NF:VOUCHER_VIA_MISMATCH': 'voucher', 'NF:DUPLICATE_VOUCHER': 'voucher',
      'NF:AMOUNT_NOT_POSITIVE': 'amount', 'NF:AMOUNT_SCALE': 'amount',
      'NF:AMOUNT_TOO_LARGE': 'amount', 'NF:NEGATIVE_POSITION': 'amount',
    };
    function panelComplete() {
      if (!panel || panel.mode !== 'line') return false;
      var v = panel.v;
      var partyOk = !headRequiresParty(v.head) || (v.party || '').trim();
      return !!((v.vno || '').trim() && v.head && v.floor && v.via && F.n(v.amt) > 0 && partyOk);
    }
    function savePanelLine() {
      if (!panel || panel.mode !== 'line' || panel.saving) return;
      var p = panel, v = p.v;
      // Exactly the completeness rule the draft row used, now visible as a
      // disabled Save rather than a row that quietly never sent.
      if (!panelComplete()) {
        p.error = { field: null, message: 'Fill in the amount, how it moved, the head, the floor'
          + (headRequiresParty(v.head) ? ', the party' : '') + ' and the voucher number.' };
        render(); return;
      }
      var voucher = voucherAffix(p.side, v.via) + v.vno.trim();
      p.saving = true; p.error = null; render();
      api.saveLine(S.day.id, null, p.side, voucher, v.desc, v.head, v.floor, v.via, F.n(v.amt), null, v.party)
        .then(function (res) {
          panel = null;
          applyDay(res);
          toast((p.side === 'IN' ? 'Receipt' : 'Payment') + ' ' + voucher + ' saved.');
        })
        .catch(function (err) {
          // The panel stays open with every value still in it — that is the
          // whole point of moving entry here.
          p.saving = false;
          p.error = { field: ERR_FIELD[Msg.code(err)] || null, message: Msg.forLine(err) };
          render();
        });
    }
    function savePanelPdc() {
      if (!panel || panel.mode !== 'pdc' || panel.saving) return;
      var p = panel, v = p.v;
      if (!(v.cheque || '').trim() || !v.due || F.n(v.amt) <= 0) {
        p.error = { field: null, message: 'A cheque needs a number, a due date and an amount.' };
        render(); return;
      }
      p.saving = true; p.error = null; render();
      api.savePdc(S.day.id, null, p.dir, v.cheque.trim(), v.party, v.bank, v.due, F.n(v.amt), null)
        .then(function (res) { panel = null; applyDay(res); toast('Cheque ' + v.cheque.trim() + ' added.'); })
        .catch(function (err) {
          p.saving = false;
          p.error = { field: null, message: Msg.forLine(err) };
          render();
        });
    }

    function saveSavedLine(side, id, version, patch) {
      var l = S.lines.filter(function (x) { return String(x.id) === String(id); })[0];
      if (!l) return;
      var merged = Object.assign({}, l, patch);
      api.saveLine(S.day.id, id, side, merged.voucher_no, merged.description, merged.head_code, merged.floor_code, merged.via, F.n(merged.amount), version, merged.party_name)
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
    var saveCount = serialDebounce(function () {
      var denoms = {};
      Object.keys(countDraft || {}).forEach(function (k) {
        var v = countDraft[k];
        if (v !== undefined && v !== null && String(v).trim() !== '') denoms[k] = F.n(v);
      });
      return api.saveCount(S.day.id, denoms, S.day.version)
        .then(function (res) { countDraft = null; applyDay(res); })
        .catch(function (err) { toast(Msg.forDay(err), true); countDraft = null; return refresh(); });
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

      // ── the entry panel ──────────────────────────────────────────────────
      // Text fields write to the panel's own values on 'input' and do NOT
      // re-render — rebuilding mid-keystroke would drop focus and the caret,
      // exactly as it would have on the old draft row. A redraw happens only
      // where the FORM changes shape: picking a via (the voucher affix) or a
      // head (whether a party is required).
      root.querySelectorAll('.nf-record[data-side]').forEach(function (btn) {
        btn.addEventListener('click', function () { openPanel(blankLinePanel(btn.getAttribute('data-side'))); });
      });
      var xferBtn = root.querySelector('[data-xfer]');
      if (xferBtn) xferBtn.addEventListener('click', function () {
        openPanel({ mode: 'transfer', error: null, saving: false,
          v: { tBank: F.grp(S.day.transfer_to_bank), tPetty: F.grp(S.day.transfer_to_petty) } });
      });
      root.querySelectorAll('[data-pdc-add]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          openPanel({ mode: 'pdc', dir: btn.getAttribute('data-pdc-add'), error: null, saving: false,
            v: { cheque: '', party: '', bank: '', due: '', amt: '' } });
        });
      });

      if (panel) {
        var panelEl = root.querySelector('#nf-panel');
        root.querySelectorAll('[data-p-close]').forEach(function (b) {
          b.addEventListener('click', function () { closePanel(); });
        });
        // No field re-renders the panel on its own input: rebuilding the DOM
        // from inside an event still being dispatched on it is the hazard this
        // file already documents twice (the journal-voucher blur crash, the
        // head picker's deferred redraw). A <select> needs `change` as well as
        // `input` because a keyboard-driven selection only fires `change`.
        var bind = function (id, key) {
          var el = root.querySelector(id);
          if (!el) return;
          var take = function () { panel.v[key] = el.value; panel.error = null; };
          el.addEventListener('input', take);
          if (el.tagName === 'SELECT') el.addEventListener('change', take);
        };
        bind('#nf-p-amt', 'amt'); bind('#nf-p-desc', 'desc'); bind('#nf-p-vno', 'vno');
        bind('#nf-p-floor', 'floor');
        bind('#nf-p-cheque', 'cheque'); bind('#nf-p-party', 'party'); bind('#nf-p-bank', 'bank');
        bind('#nf-p-due', 'due');
        // Via changes exactly two visible things — which segment is lit and
        // the voucher affix — so it patches them IN PLACE instead of
        // redrawing. A full render here would throw away whatever the person
        // was in the middle of doing (and, during the redesign, raced a test
        // that had already started typing into the head picker). Only the
        // HEAD redraws, because whether a party is required really does
        // change the shape of the form.
        root.querySelectorAll('[data-p-via]').forEach(function (b) {
          b.addEventListener('click', function () {
            panel.v.via = b.getAttribute('data-p-via'); panel.error = null;
            root.querySelectorAll('[data-p-via]').forEach(function (o) {
              o.classList.toggle('on', o === b);
            });
            var af = root.querySelector('#nf-panel .nf-affix');
            if (af) af.textContent = voucherAffix(panel.side, panel.v.via);
          });
        });
        var saveBtn = root.querySelector('#nf-p-save');
        if (saveBtn) saveBtn.addEventListener('click', function () {
          if (panel.mode === 'line') savePanelLine();
          else if (panel.mode === 'pdc') savePanelPdc();
          else closePanel();
        });
        if (panelEl) {
          panelEl.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { e.preventDefault(); closePanel(); return; }
            // Enter saves from anywhere except the picker inputs, which use it
            // to choose the highlighted option.
            if (e.key === 'Enter' && !e.target.classList.contains('nfpick-in')) {
              e.preventDefault();
              if (panel.mode === 'line') savePanelLine();
              else if (panel.mode === 'pdc') savePanelPdc();
              else closePanel();
            }
          });
        }
        // Transfers keep their original overlay + debounced save path,
        // untouched: the inputs simply live in the panel now.
        var tB = root.querySelector('#nf-tBank'), tP = root.querySelector('#nf-tPetty');
        if (tB) tB.addEventListener('input', function () { touchTransferDraft(); transferDraft.tBank = tB.value; saveTransfers(); });
        if (tP) tP.addEventListener('input', function () { touchTransferDraft(); transferDraft.tPetty = tP.value; saveTransfers(); });
      }

      var countToggle = root.querySelector('#nf-count-toggle');
      if (countToggle) countToggle.addEventListener('click', function () { countOpen = !countOpen; render(); });

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

      // The head and the party are both the shared type-to-search picker
      // (js/nf/nf-pick.js). Each one routes its choice into the same path
      // the old <select>'s change handler used for that row type: a draft
      // row updates its own draft and tries to save, a saved row goes
      // straight through saveSavedLine. The head redraws afterwards because
      // whether the party is REQUIRED depends on which head was picked.
      function rowOf(wrap) {
        var sv = wrap.closest('.row[data-saved]');
        if (sv && canWrite) {
          return { draft: false, side: sv.getAttribute('data-side'), id: sv.getAttribute('data-id'),
                   version: Number(sv.getAttribute('data-version')) };
        }
        return null;
      }
      global.NfPick.wire(root, {
        key: 'head',
        items: function () { return global.NfPick.accountItems(S.heads); },
        emptyText: 'No head matches that. Heads are never created here.',
        onPick: function (wrap, code) {
          var at = rowOf(wrap);
          if (!at) return;
          saveSavedLine(at.side, at.id, at.version, { head_code: code });
        },
      });
      // The panel's own head picker. Deferred redraw: onPick runs inside the
      // picker's own mousedown, and rebuilding the DOM from inside the event
      // still being dispatched on it is the hazard the journal-voucher screen
      // hit on blur. A redraw IS needed — whether a party is required depends
      // on the head just chosen — so it happens on the next tick instead.
      global.NfPick.wire(root, {
        key: 'pane-head',
        items: function () { return global.NfPick.accountItems(S.heads); },
        emptyText: 'No head matches that. Heads are never created here.',
        onPick: function (wrap, code) {
          if (!panel || panel.mode !== 'line') return;
          panel.v.head = code; panel.error = null;
          setTimeout(render, 0);
        },
      });
      global.NfPick.wire(root, {
        key: 'pane-party',
        items: function () { return global.NfPick.partyItems(S.parties); },
        allowCreate: true,
        onPick: function (wrap, name) {
          if (!panel || panel.mode !== 'line') return;
          panel.v.party = name; panel.error = null;
          setTimeout(render, 0);
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

      // cash count / transfers — every keystroke updates the overlay first
      // (so a render() mid-typing has something true to redraw from), then
      // asks for a save; the debounce decides when that actually goes out.
      root.querySelectorAll('[data-den]').forEach(function (inp) {
        inp.addEventListener('input', function () {
          if (!countDraft) countDraft = Object.assign({}, (S.day && S.day.denominations) || {});
          countDraft[inp.getAttribute('data-den')] = inp.value;
          saveCount();
        });
      });
      function touchTransferDraft() {
        if (!transferDraft) transferDraft = { tBank: F.grp(S.day.transfer_to_bank), tPetty: F.grp(S.day.transfer_to_petty) };
      }

      // PDCs — the three chained prompt() boxes are gone (owner, D4); adding a
      // cheque uses the same entry panel as everything else, wired above.
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
        var reasonEl = root.querySelector('#nf-variance-reason');
        var reason = reasonEl ? reasonEl.value.trim() : null;
        api.closeDay(S.day.id, S.day.version, reason || null)
          .then(function (res) { applyDay(res); toast('Day closed.'); })
          .catch(function (err) { toast(Msg.forDay(err), true); refresh(); });
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

    return Promise.all([loadLookups(), loadDay(null)]).then(render).catch(function (err) {
      sheetEl.innerHTML = '<div class="nf-gate"><h2>The cash book could not load</h2><p>' + esc(err && err.message) + '</p></div>';
      throw err;
    });
  }

  global.NfSheet = { mount: mount };
})(window);
