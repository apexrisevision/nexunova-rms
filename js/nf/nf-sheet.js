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
 *   - the server is the only source of truth. A line is either SAVED (came
 *     back from nf_get_day) or a DRAFT (typed here, not yet valid to send —
 *     R3/R8 refuse an incomplete line, so an incomplete row can only ever be
 *     a draft, never a saved fact with a hole in it).
 *   - a database refusal (NEGATIVE_POSITION, DUPLICATE_VOUCHER, …) is shown
 *     in plain language ON THE ROW THAT CAUSED IT (js/nf/nf-messages.js),
 *     and the row stays a draft — nothing is silently discarded.
 *   - amounts carry two decimals, shown only when present (js/nf/nf-format.js).
 *   - Submit / Close are disabled while any draft row is incomplete.
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
  function uid() { return 'd' + Math.random().toString(36).slice(2, 10); }

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
    var drafts = { IN: [], OUT: [] };       // {tmpId, v, d, h, f, m, a, saving, error:{field,message}}
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
    var busy = false;

    function blankDraft() { return { tmpId: uid(), v: '', d: '', h: '', f: '', m: '', a: '', saving: false, error: null }; }
    function ensureTrailingBlank(side) {
      var arr = drafts[side];
      var last = arr[arr.length - 1];
      if (!last || last.v || last.d || last.h || last.f || last.m || last.a) arr.push(blankDraft());
    }
    ensureTrailingBlank('IN'); ensureTrailingBlank('OUT');

    root.innerHTML =
      '<main class="sheet" id="nf-sheet"></main>' +
      '<p class="note" id="nf-note"></p>' +
      '<div id="nf-toast-host"></div>';
    var sheetEl = root.querySelector('#nf-sheet');
    var noteEl = root.querySelector('#nf-note');
    noteEl.textContent = 'Click any cell to edit. Choose a head under each description, then the floor and whether the money went ' +
      'through Cash, Petty or Bank. A line is saved automatically once its voucher, head, floor, via and amount are all filled in; ' +
      'a refused line stays on the sheet with the reason shown underneath it. "Start new day" carries today’s closing forward as ' +
      'tomorrow’s opening.';

    function toast(msg, bad) {
      var host = root.querySelector('#nf-toast-host');
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
        drafts.IN = []; drafts.OUT = [];
        ensureTrailingBlank('IN'); ensureTrailingBlank('OUT');
        return res;
      });
    }

    function loadLookups() {
      return Promise.all([api.listHeads(companyId), api.listFloors(companyId), api.listVias(companyId)])
        .then(function (r) { S.heads = r[0] || []; S.floors = r[1] || []; S.vias = r[2] || []; });
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
        '    <div class="mark" aria-hidden="true">' + mark + '</div>' +
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
      return '<option value="">–</option>' + S.vias.map(function (v) {
        return '<option value="' + esc(v.via) + '"' + (v.via === selected ? ' selected' : '') + '>' + esc(v.via) + '</option>';
      }).join('');
    };
    var headOpts = function (selected) {
      return '<option value="">Select head</option>' + S.heads.map(function (h) {
        return '<option value="' + esc(h.code) + '"' + (h.code === selected ? ' selected' : '') + '>' + esc(h.code) + '  ' + esc(h.name) + '</option>';
      }).join('');
    };
    function headName(code) { var h = S.heads.filter(function (x) { return x.code === code; })[0]; return h ? h.name : ''; }

    var canWrite = (role === 'accountant' || role === 'director') && S.day && S.day.status === 'OPEN';

    function savedRowHTML(side, l) {
      return '<div class="grid row" data-saved="1" data-id="' + l.id + '" data-version="' + l.version + '" data-side="' + side + '">' +
        '<input class="vno" data-k="v" value="' + esc(l.voucher_no) + '" ' + (canWrite ? '' : 'disabled') + ' aria-label="Voucher number">' +
        '<div class="desc"><input data-k="d" value="' + esc(l.description || '') + '" placeholder="Description" ' + (canWrite ? '' : 'disabled') + ' aria-label="Description">' +
        '<select data-k="h" ' + (canWrite ? '' : 'disabled') + ' aria-label="Account head">' + headOpts(l.head_code) + '</select></div>' +
        '<select class="sel" data-k="f" ' + (canWrite ? '' : 'disabled') + ' aria-label="Floor">' + floorOpts(l.floor_code) + '</select>' +
        '<select class="sel" data-k="m" ' + (canWrite ? '' : 'disabled') + ' aria-label="Cash, petty or bank">' + viaOpts(l.via) + '</select>' +
        '<input class="amt" data-k="a" inputmode="decimal" value="' + F.grp(l.amount) + '" ' + (canWrite ? '' : 'disabled') + ' aria-label="Amount">' +
        (canWrite ? '<button class="del" type="button" data-del-saved="' + l.id + '" data-version="' + l.version + '" aria-label="Delete line">×</button>' : '<span></span>') +
        '</div>';
    }
    function draftRowHTML(side, r) {
      var errField = r.error && r.error.field;
      return '<div class="grid row draft' + (r.error ? ' err' : '') + '" data-draft="' + r.tmpId + '" data-side="' + side + '">' +
        '<input class="vno" data-k="v" value="' + esc(r.v) + '" placeholder="' + (side === 'IN' ? 'CRV-' : 'CPV-') + '" aria-label="Voucher number">' +
        '<div class="desc"><input data-k="d" value="' + esc(r.d) + '" placeholder="Description" aria-label="Description">' +
        '<select data-k="h" aria-label="Account head" class="' + (errField === 'head' ? 'miss' : '') + '">' + headOpts(r.h) + '</select></div>' +
        '<select class="sel" data-k="f" aria-label="Floor">' + floorOpts(r.f) + '</select>' +
        '<select class="sel" data-k="m" aria-label="Cash, petty or bank">' + viaOpts(r.m) + '</select>' +
        '<input class="amt" data-k="a" inputmode="decimal" value="' + esc(r.a) + '" placeholder="0" aria-label="Amount">' +
        '<button class="del" type="button" data-del-draft="' + r.tmpId + '" aria-label="Remove line">×</button>' +
        (r.error ? '<div class="row-err">' + esc(r.error.message) + '</div>' : '') +
        '</div>';
    }

    function renderBooks() {
      if (!S.day) return '';
      var savedIn = S.lines.filter(function (l) { return l.side === 'IN'; });
      var savedOut = S.lines.filter(function (l) { return l.side === 'OUT'; });
      var rowsIn = savedIn.map(function (l) { return savedRowHTML('IN', l); }).join('') + drafts.IN.map(function (r) { return draftRowHTML('IN', r); }).join('');
      var rowsOut = savedOut.map(function (l) { return savedRowHTML('OUT', l); }).join('') + drafts.OUT.map(function (r) { return draftRowHTML('OUT', r); }).join('');

      function footer(side, saved) {
        var byVia = { Cash: 0, Petty: 0, Bank: 0 };
        var all = 0;
        saved.forEach(function (l) { byVia[l.via] = (byVia[l.via] || 0) + F.n(l.amount); all += F.n(l.amount); });
        return '<span>Cash</span><span class="r">' + F.fmt(byVia.Cash) + '</span><span>Petty cash</span><span class="r">' + F.fmt(byVia.Petty) +
          '</span><span>Bank</span><span class="r">' + F.fmt(byVia.Bank) + '</span>' +
          '<span class="grand">Total ' + (side === 'IN' ? 'received' : 'paid') + '</span><span class="r grand">' + F.fmt(all) + '</span>';
      }

      return '' +
        '<section class="sec"><div class="books">' +
        '  <div class="book in"><div class="bh"><h3><i></i>Receipts <small>CRV / BRV</small></h3><span class="cnt">' + savedIn.length + ' ' + (savedIn.length === 1 ? 'entry' : 'entries') + '</span></div>' +
        '    <div class="grid cols"><span>Voucher</span><span>Description and head</span><span class="c">Floor</span><span class="c">Via</span><span class="r">Amount</span><span></span></div>' +
        '    <div id="nf-rowsIn">' + rowsIn + '</div>' +
        (canWrite ? '    <button class="add" type="button" data-side="IN">+ Add receipt</button>' : '') +
        '    <div class="bf">' + footer('IN', savedIn) + '</div></div>' +
        '  <div class="book out"><div class="bh"><h3><i></i>Payments <small>CPV / BPV</small></h3><span class="cnt">' + savedOut.length + ' ' + (savedOut.length === 1 ? 'entry' : 'entries') + '</span></div>' +
        '    <div class="grid cols"><span>Voucher</span><span>Description and head</span><span class="c">Floor</span><span class="c">Via</span><span class="r">Amount</span><span></span></div>' +
        '    <div id="nf-rowsOut">' + rowsOut + '</div>' +
        (canWrite ? '    <button class="add" type="button" data-side="OUT">+ Add payment</button>' : '') +
        '    <div class="bf">' + footer('OUT', savedOut) + '</div></div>' +
        '</div></section>' +
        '<section class="sec"><div class="sh"><h2>Payments by head</h2></div><div class="box"><table class="heads"><colgroup><col><col style="width:96px"></colgroup><tbody>' +
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

      return '' +
        '<section class="sec"><div class="tri">' +
        '  <div><div class="sh"><h2>Cash count</h2><span>Cash in hand</span></div>' +
        '    <div class="box"><table class="den"><thead><tr><th>Note</th><th class="r">Pieces</th><th class="r">Amount</th><th class="sep">Note</th><th class="r">Pieces</th><th class="r">Amount</th></tr></thead>' +
        '    <tbody>' + denBody + '</tbody><tfoot><tr><td colspan="5">Total cash counted</td><td class="r t">' + (counted === null ? '–' : F.fmt(counted)) + '</td></tr></tfoot></table></div></div>' +
        '  <div><div class="sh"><h2>Transfers and reconciliation</h2></div>' +
        '    <div class="box"><table class="rec">' +
        '      <tr><td>Cash deposited in bank</td><td class="r"><input class="fld" id="nf-tBank" inputmode="decimal" value="' + esc(tb) + '" ' + (canWrite ? '' : 'disabled') + '></td></tr>' +
        '      <tr><td>Cash given to petty cash</td><td class="r"><input class="fld" id="nf-tPetty" inputmode="decimal" value="' + esc(tp) + '" ' + (canWrite ? '' : 'disabled') + '></td></tr>' +
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
          (canWrite ? '<div style="padding:8px 12px"><button class="add" type="button" data-pdc-add="' + (id === 'nf-pdcIn' ? 'RECEIVED' : 'ISSUED') + '">+ Add cheque</button></div>' : '') +
          '</div></div>';
      }
      return '<section class="sec"><div class="pdcs">' + table('nf-pdcIn', 'Post-dated cheques received', inn) + table('nf-pdcOut', 'Post-dated cheques issued', out) + '</div></section>';
    }

    // ── checks / sign-off ───────────────────────────────────────────────────
    function draftIssues() {
      var issues = [];
      function scan(side, list) {
        list.forEach(function (r) {
          var any = r.d || r.a;
          if (!any) return;
          if (!r.h) issues.push('has no head selected');
          if (!r.m) issues.push('is not marked Cash, Petty or Bank, so it is left out of the balances');
          if (!r.v) issues.push('has no voucher number');
          if (!r.f) issues.push('has no floor');
        });
      }
      scan('IN', drafts.IN); scan('OUT', drafts.OUT);
      // group identical messages the way the reference counts them
      var counts = {};
      issues.forEach(function (m) { counts[m] = (counts[m] || 0) + 1; });
      return Object.keys(counts).map(function (m) {
        var n = counts[m];
        return (n > 1 ? n + ' lines ' : '1 line ') + m.replace(/^is /, n > 1 ? 'are ' : 'is ') + '.';
      });
    }
    function renderChecks() {
      if (!S.day) return '';
      var extra = draftIssues();
      var serverTexts = (S.checks || []).map(function (c) { return c.text; });
      var all = serverTexts.concat(extra);
      var ok = all.length === 0;
      var listHtml = ok
        ? '<li>All checks passed. Every line has a voucher, head, floor and account; no balance is negative; counted cash matches the book.</li>'
        : all.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('');
      var canClose = canWrite;
      var mismatchOnly = (S.checks || []).length && (S.checks || []).every(function (c) { return c.key === 'count_mismatch'; }) && !extra.length;

      return '' +
        '<section class="sec"><div class="sh"><h2>Checks</h2></div>' +
        '<ul class="checks ' + (ok ? 'ok' : 'bad') + '">' + listHtml + '</ul>' +
        (mismatchOnly && role === 'director' ? varianceBoxHTML() : '') +
        '<textarea class="remarks" id="nf-remarks" placeholder="Remarks" ' + (canWrite ? '' : 'disabled') + '>' + esc(S.day.remarks || '') + '</textarea>' +
        '<div class="nf-day-actions">' + actionButtons(ok, mismatchOnly) + '</div>' +
        '</section>' +
        '<div class="signs">' +
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
        var row = el.closest('[data-draft]');
        if (row) return '[data-draft="' + row.getAttribute('data-draft') + '"] [data-k="' + k + '"]';
        row = el.closest('[data-saved]');
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
      drafts.IN = drafts.IN.filter(function (r) { return r.v || r.d || r.h || r.f || r.m || r.a; });
      drafts.OUT = drafts.OUT.filter(function (r) { return r.v || r.d || r.h || r.f || r.m || r.a; });
      ensureTrailingBlank('IN'); ensureTrailingBlank('OUT');
      render();
    }

    function trySaveDraft(side, tmpId) {
      var arr = drafts[side];
      var r = arr.filter(function (x) { return x.tmpId === tmpId; })[0];
      if (!r || r.saving) return;
      var complete = r.v.trim() && r.h && r.f && r.m && F.n(r.a) > 0;
      if (!complete) return;
      r.saving = true;
      api.saveLine(S.day.id, null, side, r.v.trim(), r.d, r.h, r.f, r.m, F.n(r.a), null)
        .then(function (res) {
          // remove THIS draft explicitly — applyDay only clears fully-blank
          // ones, and this one still has everything typed into it
          drafts[side] = drafts[side].filter(function (x) { return x.tmpId !== tmpId; });
          applyDay(res);
          toast((side === 'IN' ? 'Receipt' : 'Payment') + ' ' + r.v.trim() + ' saved.');
        })
        .catch(function (err) {
          r.saving = false;
          r.error = { field: Msg.code(err), message: Msg.forLine(err) };
          render();
        });
    }

    function saveSavedLine(side, id, version, patch) {
      var l = S.lines.filter(function (x) { return String(x.id) === String(id); })[0];
      if (!l) return;
      var merged = Object.assign({}, l, patch);
      api.saveLine(S.day.id, id, side, merged.voucher_no, merged.description, merged.head_code, merged.floor_code, merged.via, F.n(merged.amount), version)
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
        fn().catch(function () {}).then(function () {
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

      // draft rows
      root.querySelectorAll('.row.draft').forEach(function (rowEl) {
        var side = rowEl.getAttribute('data-side'), tmpId = rowEl.getAttribute('data-draft');
        var r = drafts[side].filter(function (x) { return x.tmpId === tmpId; })[0];
        if (!r) return;
        rowEl.querySelectorAll('[data-k]').forEach(function (inp) {
          // Text fields only update the in-memory draft on 'input' — NOT a
          // re-render. Rebuilding the row's DOM mid-keystroke would drop
          // focus and the caret position on every character typed; a select
          // change or leaving the field is the point where the sheet redraws.
          inp.addEventListener('input', function () {
            r[inp.getAttribute('data-k')] = inp.value;
            r.error = null;
          });
          inp.addEventListener('change', function () {
            if (inp.tagName === 'SELECT') {
              ensureTrailingBlank(side);
              render();
              trySaveDraft(side, tmpId);
            }
          });
          inp.addEventListener('blur', function () {
            ensureTrailingBlank(side);
            trySaveDraft(side, tmpId);
          });
          inp.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); ensureTrailingBlank(side); trySaveDraft(side, tmpId); }
          });
        });
      });
      root.querySelectorAll('[data-del-draft]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-del-draft'), side = btn.closest('.row').getAttribute('data-side');
          drafts[side] = drafts[side].filter(function (x) { return x.tmpId !== id; });
          ensureTrailingBlank(side);
          render();
        });
      });

      // saved rows
      root.querySelectorAll('.row[data-saved]').forEach(function (rowEl) {
        if (!canWrite) return;
        var id = rowEl.getAttribute('data-id'), version = Number(rowEl.getAttribute('data-version')), side = rowEl.getAttribute('data-side');
        rowEl.querySelectorAll('[data-k]').forEach(function (inp) {
          inp.addEventListener('change', function () {
            var k = inp.getAttribute('data-k');
            var patch = {}; patch[{ v: 'voucher_no', d: 'description', h: 'head_code', f: 'floor_code', m: 'via', a: 'amount' }[k]] = k === 'a' ? F.n(inp.value) : inp.value;
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

      // add-row buttons
      root.querySelectorAll('.add[data-side]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var side = btn.getAttribute('data-side');
          drafts[side].push(blankDraft());
          render();
          var last = root.querySelectorAll('.row.draft[data-side="' + side + '"] [data-k="d"]');
          if (last.length) last[last.length - 1].focus();
        });
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
