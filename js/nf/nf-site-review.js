/**
 * NexuFinance — Site Closing, head office's side. window.NfSiteReview.mount(root, ctx)
 * (docs/SITE_CLOSING_SPEC.md, Stage 3). Reached from the Reports menu as "Site Closing".
 *
 * ctx = { api, companyId, role, displayName, companyName, settings, onBack }
 *
 * A list of the site's days, then one day: every site line beside the HO voucher it
 * was matched to, its status, the reason in plain words and what Accept would do.
 * Conflicts first, then possible duplicates, then the rest; lines already decided last.
 *
 * Every decision is a guarded database function (nf_site_accept / _reject / _link /
 * _mark_duplicate / _accept_new / _match / nf_site_return). HO never edits a site line;
 * a head or party change at Accept lands on the HO voucher. A viewer reads only.
 */
(function (global) {
  'use strict';
  var F = global.NfFmt;
  function esc(s) { return F.esc(s); }
  var VIA = ['10100', '10200', '10300'];   // the seeded cash, site box and bank accounts
  var STATUS = {
    CONFLICT: ['Conflict', 'st-bad', 0], POSSIBLE: ['Possible duplicate', 'st-dup', 1], DUPLICATE: ['Duplicate', 'st-dup', 2],
    NEW: ['New', 'st-new', 3], LINKED: ['Linked', 'st-ok', 4], ACCEPTED: ['Accepted', 'st-ok', 5], REJECTED: ['Rejected', 'st-bad', 6],
  };
  var DAYSTATUS = { DRAFT: 'Being entered at site', SUBMITTED: 'Waiting for head office', RETURNED: 'Sent back to site', MERGED: 'Closed' };

  function message(e) {
    var c = e && e.code, d = (e && e.detail) || {};
    var M = {
      'NF:VERSION_CONFLICT': 'Someone changed this just now. The latest is shown — do it again if it is still needed.',
      'NF:SITE_LINE_NOT_ACCEPTABLE': 'A conflict or a possible duplicate cannot simply be accepted. Use Link, Mark duplicate or Reject — or fix head office’s voucher and re-run the match.',
      'NF:SITE_LINE_RESOLVED': 'This line has already been decided.',
      'NF:SITE_NOT_SUBMITTED': 'This day is not waiting for head office.',
      'NF:REASON_REQUIRED': 'Write a reason.',
      'NF:LINK_AMOUNT_DIFFERS': 'That voucher is for a different amount' + (d.ho ? ' (' + F.fmt(d.ho) + ')' : '') + '.',
      'NF:SITE_CASH_NEGATIVE': 'Rejecting this would leave the site cash box below zero' + (d.date ? ' on ' + F.ddMonYyyy(d.date) : '') + '.',
      'NF:NEGATIVE_POSITION': 'There is not enough money in ' + (d.via === 'Petty' ? 'the site cash box' : d.via === 'Cash' ? 'head office cash' : 'the bank') + ' for this. Settle the receipts and transfers first.',
      'NF:NO_OPEN_DAY': 'Open a day at head office first.',
      'NF:PARTY_REQUIRED': 'This head always tracks who it is with — give the party.',
      'NF:DUPLICATE_VOUCHER': 'That voucher number is already used in the books.',
      'NF:VOUCHER_ALREADY_EXPORTED': 'That voucher is already in QuickBooks and cannot be changed.',
      'NF:SITE_LATER_DAY_MERGED': 'A later site day is already closed.',
      'NF:NOT_ALLOWED': 'You do not have permission to do this.',
    };
    if (c && M[c]) return M[c];
    return 'Could not do that (' + (c || (e && e.message) || 'error') + ').';
  }

  function mount(root, ctx) {
    var alive = true;
    var trueOnBack = ctx.onBack;
    ctx = Object.assign({}, ctx, { onBack: function () { alive = false; trueOnBack(); } });
    var canWrite = ctx.role === 'accountant' || ctx.role === 'director';
    var S = { view: 'list', days: [], day: null, heads: [], journal: null, msg: null, dlg: null };

    function headName(code) {
      var h = S.heads.filter(function (x) { return x.code === code; })[0];
      if (h) return h.name;
      return ({ '10100': 'Head office cash', '10200': 'Site cash box', '10300': 'Bank' })[code] || code || '';
    }
    function hoHead(ho) {
      if (!ho || !ho.legs) return '';
      var l = ho.legs.filter(function (x) { return VIA.indexOf(x.account) < 0; })[0];
      if (l) return headName(l.account);
      var dr = ho.legs.filter(function (x) { return +x.debit > 0; })[0];
      return dr ? 'Transfer into ' + headName(dr.account).toLowerCase() : 'Transfer';
    }
    // the database writes head codes into its reasons; directors read names
    function plain(t) {
      return String(t || '').replace(/\b\d{5}\b/g, function (c) { var n = headName(c); return n && n !== c ? n : c; });
    }
    function hoAmount(ho) { return (ho && ho.legs || []).reduce(function (t, l) { return t + (+l.debit || 0); }, 0); }

    // ── loading ───────────────────────────────────────────────────────────
    function boot() {
      root.innerHTML = '<div class="sheet scsheet"><section class="rsec"><p class="muted">Loading…</p></section></div>';
      Promise.all([ctx.api.siteListDays(ctx.companyId, null, null), ctx.api.listHeads(ctx.companyId)])
        .then(function (r) { if (!alive) return; S.days = r[0] || []; S.heads = r[1] || []; render(); wire(); })
        .catch(fatal);
    }
    function fatal(e) {
      if (!alive) return;
      root.innerHTML = '<div class="nf-gate"><h2>Could not open Site Closing</h2><p>' + esc(message(e)) + '</p>' +
        '<button class="btn" id="nf-sr-back" type="button">← Back to closing sheet</button></div>';
      var b = root.querySelector('#nf-sr-back'); if (b) b.addEventListener('click', function () { ctx.onBack(); });
    }
    function openDay(id, note) {
      return ctx.api.siteReview(id).then(function (d) {
        if (!alive) return;
        S.view = 'day'; S.day = d; S.msg = note || null; S.dlg = null; render(); wire();
      }).catch(function (e) { S.msg = message(e); render(); wire(); });
    }
    function backToList() {
      return ctx.api.siteListDays(ctx.companyId, null, null).then(function (r) {
        S.days = r || []; S.view = 'list'; S.day = null; S.msg = null; render(); wire();
      });
    }
    function journal() {
      if (S.journal) return Promise.resolve(S.journal);
      // the journal for narration and legs; manual no and real date from the vouchers themselves
      return Promise.all([ctx.api.getJournal(ctx.companyId, null, null), ctx.api.voucherFacts(ctx.companyId)]).then(function (r) {
        var facts = {}; (r[1] || []).forEach(function (f) { facts[f.id] = f; });
        S.journal = ((r[0] && r[0].vouchers) || []).map(function (v) {
          var f = facts[v.id] || {};
          return Object.assign({}, v, { manual_no: f.manual_no || null, real_date: f.real_date || null });
        });
        return S.journal;
      });
    }

    // ── markup ────────────────────────────────────────────────────────────
    function header(title) {
      return '<header class="hdr">' +
        '  <div class="brand">' + F.brandMark(ctx.settings.mark || 'NF') +
        '    <div><div class="co">' + esc(ctx.settings.company_line || ctx.companyName || '') + '</div><h1>' + title + '</h1></div></div>' +
        '  <div class="actions">' +
        '    <button class="btn" id="nf-sr-back" type="button">← Back to closing sheet</button>' +
        global.NfReportsMenu.html('site') +
        '  </div></header>';
    }
    function listHtml() {
      var rows = S.days.map(function (d) {
        return '<tr data-open-day="' + esc(d.id) + '"><td>' + F.ddMonYyyy(d.business_date) + '</td><td>' + esc(DAYSTATUS[d.status] || d.status) + '</td>' +
          '<td class="r">' + d.lines + '</td><td class="r">' + (d.open_issues ? '<span class="scst st-bad">' + d.open_issues + ' to settle</span>' : '') + '</td>' +
          '<td class="r">' + (d.book_closing == null ? '' : F.fmt(d.book_closing)) + '</td><td class="r">' + (d.counted_cash == null ? '' : F.fmt(d.counted_cash)) + '</td>' +
          '<td class="r">' + (d.variance ? '<span class="neg">' + F.fmt(d.variance) + '</span>' : '') + '</td></tr>';
      }).join('');
      return '<section class="rsec"><p class="muted">The site accountant’s days. Open one to check it against head office’s books.</p>' +
        (S.days.length ? '<table class="srdays"><thead><tr><th>Date</th><th>Status</th><th class="r">Lines</th><th class="r">Open</th>' +
          '<th class="r">Cash box (book)</th><th class="r">Counted</th><th class="r">Difference</th></tr></thead><tbody>' + rows + '</tbody></table>'
          : '<p class="muted">No site days yet.</p>') + '</section>';
    }
    function proposalText(l) {
      var p = l.proposal || {}, a = p.action;
      if (l.resolved_at) return l.resolution || '';
      if (l.status === 'LINKED') return 'Accept confirms it — nothing new goes in the books.';
      if (a === 'post') return 'Accept puts it in the books, ' + (l.side === 'IN' ? 'received into' : 'paid from') + ' the site cash box.';
      if (a === 'reroute') return 'Accept moves head office’s voucher from head office cash to the site cash box.';
      if (a === 'transfer') return 'Accept moves ' + F.fmt(p.amount) + ' from ' + (p.from === 'Cash' ? 'head office cash to the site cash box' : 'the site cash box to head office cash') + '.';
      if (a === 'link' || a === 'pass_through') return 'Accept links it — nothing new goes in the books.';
      return 'Settle with Link, Mark duplicate or Reject — or fix head office’s voucher and re-run the match.';
    }
    function lineHtml(l) {
      var st = STATUS[l.status] || [l.status, 'st-new'];
      var ho = l.ho;
      var open = !l.resolved_at;
      var acts = '';
      if (canWrite && open && S.day.status === 'SUBMITTED') {
        if (['NEW', 'DUPLICATE', 'LINKED'].indexOf(l.status) >= 0) acts += '<button class="btn primary sm" type="button" data-act="accept" data-line="' + l.line_id + '">Accept</button>';
        acts += '<button class="btn sm" type="button" data-act="link" data-line="' + l.line_id + '">Link to…</button>';
        acts += '<button class="btn sm" type="button" data-act="dup" data-line="' + l.line_id + '">Mark duplicate</button>';
        acts += '<button class="btn danger sm" type="button" data-act="reject" data-line="' + l.line_id + '">Reject</button>';
      }
      return '<div class="srline' + (l.status === 'CONFLICT' && open ? ' conflict' : '') + (open ? '' : ' decided') + '" data-line-row="' + l.line_id + '">' +
        '<div><b>' + (l.side === 'IN' ? 'Received' : 'Paid') + (l.party ? ' · ' + esc(l.party) : '') + '</b>' +
          '<div class="amt">' + F.fmt(l.amount) + ' <span class="sub">' + (l.via === 'BANK' ? 'bank' : 'site cash') + '</span></div>' +
          '<div class="sub">' + esc(l.head === '10300' ? (l.side === 'IN' ? 'Cash drawn from bank' : 'Cash deposited in bank') : headName(l.head)) +
          (l.doc_no ? ' · no. ' + esc(l.doc_no) : '') + (l.token_no ? ' · token #' + esc(l.token_no) : '') + (l.units ? ' · ' + esc(l.units) : '') +
          (l.bank_ref ? ' · ref ' + esc(l.bank_ref) : '') + '</div>' + (l.remarks ? '<div class="sub">' + esc(l.remarks) + '</div>' : '') +
          (billOf(l.line_id) ? '<button class="scphoto has" type="button" data-bill="' + l.line_id + '">Bill photo</button>' : '') + '</div>' +
        '<div>' + (ho ? '<b>' + esc(ho.manual_no || ho.voucher_no) + '</b> <span class="sub">' + esc(ho.manual_no ? ho.voucher_no : '') + '</span>' +
            '<div class="amt">' + F.fmt(hoAmount(ho)) + '</div><div class="sub">' + (ho.real_date ? F.ddMonYyyy(ho.real_date) + ' · ' : '') + esc(hoHead(ho)) + '</div>' +
            '<div class="sub">' + esc(ho.narration || '') + '</div>'
          : '<span class="sub">No head office voucher</span>') +
          (l.posted ? '<div class="sub">Posted as ' + esc(l.posted.manual_no || l.posted.voucher_no) + '</div>' : '') + '</div>' +
        '<div><span class="scst ' + st[1] + '">' + st[0] + '</span></div>' +
        '<div><div class="reason">' + esc(plain(l.reason)) + '</div><div class="prop">' + esc(proposalText(l)) + '</div></div>' +
        '<div class="acts">' + acts + '</div>' +
        '</div>';
    }
    function dayHtml() {
      var d = S.day, lines = (d.review || []).slice().sort(function (a, b) {
        var ra = a.resolved_at ? 1 : 0, rb = b.resolved_at ? 1 : 0;
        if (ra !== rb) return ra - rb;
        return ((STATUS[a.status] || [0, 0, 9])[2] - (STATUS[b.status] || [0, 0, 9])[2]) || (a.line_no - b.line_no);
      });
      var nNew = lines.filter(function (l) { return l.status === 'NEW' && !l.resolved_at; }).length;
      var bar = '<div class="srdaybar"><button class="btn" id="nf-sr-list" type="button">← All site days</button>' +
        '<b class="grow">' + F.ddMonYyyy(d.business_date) + ' · ' + esc(DAYSTATUS[d.status] || d.status) + '</b>';
      if (canWrite && d.status === 'SUBMITTED') {
        bar += '<button class="btn" id="nf-sr-rematch" type="button">Re-run match</button>' +
          '<button class="btn primary" id="nf-sr-acceptnew" type="button"' + (nNew ? '' : ' disabled') + '>Accept all new (' + nNew + ')</button>' +
          '<button class="btn danger" id="nf-sr-return" type="button">Return day to site</button>';
      }
      bar += '</div>';
      return '<section class="rsec">' + bar +
        (S.msg ? '<div class="scbanner warn" id="nf-sr-msg">' + esc(S.msg) + '</div>' : '') +
        '<div class="sctiles"><div class="sctile"><span>Opening cash</span><b>' + F.fmt(d.opening) + '</b></div>' +
        '<div class="sctile"><span>Received</span><b class="pos">' + F.fmt(d.cash_in) + '</b></div>' +
        '<div class="sctile"><span>Paid</span><b class="neg">' + F.fmt(d.cash_out) + '</b></div>' +
        '<div class="sctile hand"><span>Should be in hand / counted</span><b>' + F.fmt(d.book_now) + ' / ' + (d.counted_cash == null ? '—' : F.fmt(d.counted_cash)) + '</b></div></div>' +
        (d.variance ? '<p class="muted">Count differs by ' + F.fmt(d.variance) + ': ' + esc(d.variance_reason || '') + '</p>' : '') +
        '</section><section class="rsec">' +
        '<div class="srline head"><div>At site</div><div>Head office voucher</div><div>Status</div><div>Why / what Accept does</div><div></div></div>' +
        lines.map(lineHtml).join('') + '</section>';
    }
    function dlgHtml() {
      var g = S.dlg; if (!g) return '';
      var body = '';
      if (g.kind === 'accept') {
        var l = g.line;
        body = '<h3>Accept</h3><p>' + esc(proposalText(l)) + '</p>' +
          (['NEW', 'DUPLICATE'].indexOf(l.status) >= 0 ?
            '<label>Head on head office’s voucher <select id="nf-sr-head"><option value="">Keep ' + esc(l.ho_head ? headName(l.ho_head) : headName(l.head)) + '</option>' +
              S.heads.map(function (h) { return '<option value="' + esc(h.code) + '">' + esc(h.name) + '</option>'; }).join('') + '</select></label>' +
            '<label>Party (leave empty to keep) <input id="nf-sr-party" value=""></label>' : '');
      } else if (g.kind === 'reject' || g.kind === 'return') {
        body = '<h3>' + (g.kind === 'reject' ? 'Reject this line' : 'Return the day to the site') + '</h3>' +
          '<p class="muted">' + (g.kind === 'reject' ? 'It leaves the site cash book. The site accountant sees “Rejected”.' : 'The site accountant reads this reason and can change the day again.') + '</p>' +
          '<label>Reason (required) <textarea id="nf-sr-reason" rows="3"></textarea></label>';
      } else if (g.kind === 'link' || g.kind === 'dup') {
        body = '<h3>' + (g.kind === 'link' ? 'Link to a head office voucher' : 'Mark as duplicate of a head office voucher') + '</h3>' +
          '<p class="muted">' + (g.kind === 'link' ? 'Nothing new goes in the books.' : 'Accept will then do what that match needs (for example move head office’s voucher to the site cash box).') + '</p>' +
          '<label>Search by date, amount, number or words <input id="nf-sr-q" value="' + esc(g.q || '') + '" placeholder="' + esc(F.fmt(g.line.amount)) + '"></label>' +
          '<div class="srpick" id="nf-sr-pick">' + pickList(g) + '</div>' +
          (g.kind === 'link' ? '<label>Note (optional) <input id="nf-sr-note"></label>' : '');
      }
      return '<div class="srdlg-bg" id="nf-sr-dlg-bg"></div><div class="srdlg" role="dialog">' + body +
        '<div class="err" id="nf-sr-dlg-err"' + (g.err ? '' : ' hidden') + '>' + esc(g.err || '') + '</div>' +
        '<div class="act"><button class="btn" type="button" id="nf-sr-dlg-cancel">Cancel</button>' +
        '<button class="btn primary" type="button" id="nf-sr-dlg-ok">' + ({ accept: 'Accept', reject: 'Reject', return: 'Return to site', link: 'Link', dup: 'Mark duplicate' })[g.kind] + '</button></div></div>';
    }
    var MON = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    function dateIn(q, ref) {
      var y = (ref || '').slice(0, 4) || String(new Date().getFullYear()), m;
      var pad = function (n) { return String(n).padStart(2, '0'); };
      var iso = null, raw = null;
      if ((m = q.match(/(\d{4})-(\d{2})-(\d{2})/))) { iso = m[0]; raw = m[0]; }
      else if ((m = q.match(/\b(\d{1,2})[-\s](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/))) { iso = y + '-' + pad(MON.indexOf(m[2]) + 1) + '-' + pad(m[1]); raw = m[0]; }
      else if ((m = q.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/))) { iso = (m[3] || y) + '-' + pad(m[2]) + '-' + pad(m[1]); raw = m[0]; }
      if (!iso) return null;
      var mi = +iso.slice(5, 7) - 1;
      return { iso: iso, ddmon: pad(+iso.slice(8, 10)) + '-' + (MON[mi] || ''), rest: q.replace(raw, ' ').trim() };
    }
    function pickList(g) {
      if (!g.list) return '<p class="muted" style="padding:8px">Loading vouchers…</p>';
      var q = String(g.q || '').toLowerCase().trim(), amt = +g.line.amount;
      // a date in the search ("16-Nov", "16 Nov", "16/11", "2026-11-16") is matched against the
      // voucher's real date; a voucher keyed before real dates existed is matched by the date
      // written in its narration. Everything else is amount / number / words, as before.
      var dq = dateIn(q, (S.day && S.day.business_date) || ''), rest = dq ? dq.rest : q;
      var hits = g.list.map(function (v) { return { v: v, a: v.legs.reduce(function (t, l) { return t + (+l.debit || 0); }, 0) }; })
        .filter(function (x) {
          if (!q) return x.a === amt;
          if (dq) {
            if (x.v.real_date) { if (x.v.real_date !== dq.iso) return false; }
            else if (String(x.v.narration || '').toLowerCase().indexOf(dq.ddmon) < 0) return false;
          }
          var hay = (x.v.voucher_no + ' ' + (x.v.manual_no || '') + ' ' + (x.v.narration || '') + ' ' + x.a).toLowerCase();
          return rest.split(/\s+/).filter(Boolean).every(function (w) { return hay.indexOf(w.replace(/,/g, '')) >= 0; });
        }).slice(0, 60);
      if (!hits.length) return '<p class="muted" style="padding:8px">No voucher matches. ' + (q ? '' : 'Showing only vouchers of the same amount — type to search all.') + '</p>';
      return hits.map(function (x) {
        return '<button type="button" data-pick-v="' + esc(x.v.id) + '"' + (g.pick === x.v.id ? ' class="on"' : '') + '><b>' + esc(x.v.manual_no || x.v.voucher_no) +
          (x.v.real_date ? '<span class="sub" style="display:block;font-weight:400">' + F.ddMonYyyy(x.v.real_date) + '</span>' : '') + '</b>' +
          '<span>' + esc((x.v.narration || '').slice(0, 90)) + '</span><span class="r">' + F.fmt(x.a) + '</span></button>';
      }).join('');
    }

    function render() {
      root.innerHTML = '<div class="sheet scsheet srsheet">' + header('Site Closing') +
        (S.view === 'list' ? listHtml() : dayHtml()) +
        '<div class="docfoot"><span>' + esc(ctx.companyName || '') + ' · Site Closing</span>' +
        '<span>' + (canWrite ? '' : 'Read only') + '</span></div></div>' + dlgHtml();
    }

    // ── wiring ────────────────────────────────────────────────────────────
    // the review rows do not carry the photo; the day's own lines do
    function billOf(id) {
      var x = ((S.day && S.day.lines) || []).filter(function (l) { return l.id === id; })[0];
      return x && x.attachment_url;
    }
    function lineOf(id) { return (S.day.review || []).filter(function (l) { return l.line_id === id; })[0]; }
    function act(promise) {
      return promise.then(function (d) { if (!alive) return; S.day = d; S.dlg = null; S.msg = null; render(); wire(); })
        .catch(function (e) {
          if (!alive) return;
          if (e && e.code === 'NF:VERSION_CONFLICT') return openDay(S.day.id, message(e));
          if (S.dlg) { S.dlg.err = message(e); render(); wire(); } else { S.msg = message(e); render(); wire(); }
        });
    }
    function wire() {
      root.querySelector('#nf-sr-back').addEventListener('click', function () { ctx.onBack(); });
      global.NfReportsMenu.wire(root, ctx);
      root.querySelectorAll('[data-open-day]').forEach(function (tr) {
        tr.addEventListener('click', function () { openDay(tr.getAttribute('data-open-day')); });
      });
      var bl = root.querySelector('#nf-sr-list'); if (bl) bl.addEventListener('click', backToList);
      var rm = root.querySelector('#nf-sr-rematch'); if (rm) rm.addEventListener('click', function () { act(ctx.api.siteMatch(S.day.id)); });
      var an = root.querySelector('#nf-sr-acceptnew'); if (an) an.addEventListener('click', function () {
        if (!global.confirm('Put every new line in the books, from the site cash box?')) return;
        act(ctx.api.siteAcceptNew(S.day.id, S.day.version));
      });
      var rt = root.querySelector('#nf-sr-return'); if (rt) rt.addEventListener('click', function () { S.dlg = { kind: 'return' }; render(); wire(); });
      root.querySelectorAll('[data-bill]').forEach(function (b) {
        b.addEventListener('click', function () {
          ctx.api.siteBillUrl(billOf(b.getAttribute('data-bill'))).then(function (u) {
            if (u) global.open(u, '_blank', 'noopener'); else { S.msg = 'The bill photo could not be opened.'; render(); wire(); }
          });
        });
      });
      root.querySelectorAll('[data-act]').forEach(function (b) {
        b.addEventListener('click', function () {
          var l = lineOf(b.getAttribute('data-line')); var k = b.getAttribute('data-act');
          S.dlg = { kind: k, line: l, q: '', list: null, pick: null };
          render(); wire();
          if (k === 'link' || k === 'dup') journal().then(function (j) { if (S.dlg && S.dlg.line === l) { S.dlg.list = j; refreshPick(); } })
            .catch(function (e) { S.dlg.err = message(e); render(); wire(); });
        });
      });
      wireDlg();
    }
    function refreshPick() {
      var host = root.querySelector('#nf-sr-pick'); if (!host || !S.dlg) return;
      host.innerHTML = pickList(S.dlg);
      host.querySelectorAll('[data-pick-v]').forEach(function (b) {
        b.addEventListener('click', function () { S.dlg.pick = b.getAttribute('data-pick-v'); refreshPick(); });
      });
    }
    function wireDlg() {
      var g = S.dlg; if (!g) return;
      var close = function () { S.dlg = null; render(); wire(); };
      root.querySelector('#nf-sr-dlg-cancel').addEventListener('click', close);
      root.querySelector('#nf-sr-dlg-bg').addEventListener('click', close);
      var q = root.querySelector('#nf-sr-q');
      if (q) { q.addEventListener('input', function () { g.q = q.value; refreshPick(); }); refreshPick(); }
      root.querySelector('#nf-sr-dlg-ok').addEventListener('click', function () {
        var errEl = root.querySelector('#nf-sr-dlg-err');
        var fail = function (t) { errEl.hidden = false; errEl.textContent = t; };
        if (g.kind === 'accept') {
          var h = root.querySelector('#nf-sr-head'), p = root.querySelector('#nf-sr-party');
          return act(ctx.api.siteAccept(g.line.line_id, g.line.version, h ? h.value : null, p ? p.value.trim() : null));
        }
        if (g.kind === 'reject' || g.kind === 'return') {
          var reason = root.querySelector('#nf-sr-reason').value.trim();
          if (!reason) return fail('Write a reason.');
          return act(g.kind === 'reject' ? ctx.api.siteReject(g.line.line_id, g.line.version, reason)
                                         : ctx.api.siteReturn(S.day.id, reason, S.day.version).then(function () { return ctx.api.siteReview(S.day.id); }));
        }
        if (!g.pick) return fail('Pick the head office voucher.');
        if (g.kind === 'link') return act(ctx.api.siteLink(g.line.line_id, g.line.version, g.pick, (root.querySelector('#nf-sr-note') || {}).value || null));
        return act(ctx.api.siteMarkDuplicate(g.line.line_id, g.line.version, g.pick));
      });
    }

    boot();
  }

  global.NfSiteReview = { mount: mount };
})(window);
