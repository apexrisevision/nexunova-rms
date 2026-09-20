/**
 * NexuFinance v1 — Journal Vouchers: the entry path for everything that is
 * NOT a cash movement. window.NfJournalVoucher.mount(root, ctx)
 *
 * ctx = { api, companyId, role, displayName, companyName, settings, onBack }
 *
 * Why this screen exists (docs/PLAN.md §32.1): the daily-closing sheet can
 * only make a two-leg voucher with one Cash/Petty/Bank leg. All 64 of Awami's
 * real imported vouchers are the other shape — a cost FMH, KBH or a director
 * paid on Awami's behalf, where no Awami cash moves at all — and 7 of them
 * carry more than two legs. Part B of the blueprint calls that the very reason
 * a single-entry cash book cannot serve this business. Until this screen there
 * was no way to enter either one.
 *
 * Deliberately separate from the daily closing, not bolted onto it. A journal
 * voucher is posted with day_id NULL (enforced in nf_jv_save, not here), so it
 * never appears in a day's Money In / Money Out, never moves the cash position,
 * and never disturbs the director report — while still being fully present in
 * the Journal, the Ledger, the Trial Balance, the Balance Sheet and every
 * party statement, because those read the ledger directly.
 *
 * The party field follows the same rule as the daily sheet (Part E): it
 * SEARCHES existing parties and their aliases first, and only offers "add new"
 * once a search has visibly returned nothing.
 *
 * Nothing here decides whether a voucher is legal. Balance, ≥2 legs, one side
 * per leg, postable heads, requires_party and duplicate voucher numbers are all
 * enforced in the database; this screen's job is to make the refusal visible
 * before the round trip rather than after it.
 */
(function (global) {
  'use strict';
  var F = global.NfFmt;
  function esc(s) { return F.esc(s); }
  function uid() { return 'l' + Math.random().toString(36).slice(2, 9); }

  function mount(root, ctx) {
    var alive = true;
    var trueOnBack = ctx.onBack;
    ctx = Object.assign({}, ctx, { onBack: function () { alive = false; trueOnBack(); } });

    var canWrite = ctx.role === 'accountant' || ctx.role === 'director';
    var S = { heads: [], floors: [], parties: [], list: null, busy: false, error: null };
    var draft = blankVoucher();

    function blankLeg() { return { id: uid(), account: '', floor: '', party: '', debit: '', credit: '', memo: '' }; }
    function blankVoucher() { return { no: '', date: today(), narration: '', legs: [blankLeg(), blankLeg()] }; }
    function today() { var d = new Date(); var p = function (x) { return String(x).padStart(2, '0'); };
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }

    function headRequiresParty(code) {
      var h = S.heads.filter(function (x) { return x.code === code; })[0];
      return !!(h && h.requires_party);
    }
    function totals() {
      var d = 0, c = 0;
      draft.legs.forEach(function (l) { d += F.n(l.debit); c += F.n(l.credit); });
      return { debit: d, credit: c, diff: Math.round((d - c) * 100) / 100 };
    }
    // Every reason the database would refuse this voucher, worked out here so
    // the person sees it while typing instead of after a failed round trip.
    function issues() {
      var out = [];
      var t = totals();
      if (!draft.no.trim()) out.push('give it a voucher number');
      if (/^(CRV|BRV|CPV|BPV)-/i.test(draft.no.trim())) out.push('CRV/BRV/CPV/BPV belong to the daily closing sheet — use JV- here');
      if (!draft.date) out.push('give it a date');
      var filled = draft.legs.filter(function (l) { return l.account || F.n(l.debit) || F.n(l.credit); });
      if (filled.length < 2) out.push('a voucher needs at least two lines');
      filled.forEach(function (l, i) {
        var n = 'line ' + (i + 1) + ': ';
        if (!l.account) out.push(n + 'pick an account');
        if (!l.floor) out.push(n + 'pick a floor');
        var hasD = F.n(l.debit) > 0, hasC = F.n(l.credit) > 0;
        if (!hasD && !hasC) out.push(n + 'put an amount in Debit or Credit');
        if (hasD && hasC) out.push(n + 'a line is either a debit or a credit, not both');
        if (l.account && headRequiresParty(l.account) && !l.party.trim()) out.push(n + 'this account always tracks who it is with — name the party');
      });
      if (filled.length >= 2 && t.diff !== 0) {
        out.push('debits and credits must match — ' + (t.diff > 0 ? 'debits are over by ' : 'credits are over by ') + F.fmt(Math.abs(t.diff)));
      }
      return out;
    }

    function loadLookups() {
      return Promise.all([ctx.api.listHeads(ctx.companyId), ctx.api.listFloors(ctx.companyId), ctx.api.listAllParties(ctx.companyId)])
        .then(function (r) { S.heads = r[0] || []; S.floors = r[1] || []; S.parties = r[2] || []; });
    }
    function loadList() {
      return ctx.api.jvList(ctx.companyId, null, null).then(function (r) {
        S.list = r;
        if (!draft.no.trim() && r && r.next_voucher_no) draft.no = r.next_voucher_no;
      });
    }

    function boot() {
      root.innerHTML = '<div class="sheet jvsheet"><section class="rsec"><p class="muted">Loading…</p></section></div>';
      Promise.all([loadLookups(), loadList()])
        .then(function () { if (alive) { render(); wire(); } })
        .catch(function (e) {
          if (!alive) return;
          root.innerHTML = '<div class="nf-gate"><h2>Could not open journal vouchers</h2><p>' + esc(e.message || String(e)) + '</p>' +
            '<button class="btn" id="nf-jv-back" type="button">← Back to closing sheet</button></div>';
          var b = root.querySelector('#nf-jv-back'); if (b) b.addEventListener('click', function () { ctx.onBack(); });
        });
    }

    // ── markup ────────────────────────────────────────────────────────────
    // nf_list_floors returns a FLAT ARRAY OF CODES, not objects — unlike
    // nf_list_heads and nf_list_all_parties, which return objects. Reading
    // f.code here silently produced an option list of "undefined" values, so
    // every floor select stayed empty and the form refused to post with
    // "pick a floor" while the dropdown looked populated.
    function floorOpts(sel) {
      return '<option value="">Floor…</option>' + S.floors.map(function (f) {
        return '<option value="' + esc(f) + '"' + (f === sel ? ' selected' : '') + '>' + esc(f) + '</option>';
      }).join('');
    }
    function legRow(l, i) {
      var needsParty = l.account && headRequiresParty(l.account);
      return '<div class="jvleg" data-leg="' + l.id + '">' +
        '<span class="n">' + (i + 1) + '</span>' +
        global.NfPick.html({ key: 'jv-account', value: l.account, label: global.NfPick.accountLabel(S.heads, l.account),
          placeholder: 'Account', ariaLabel: 'Account' }) +
        '<select data-k="floor" class="sel" aria-label="Floor">' + floorOpts(l.floor) + '</select>' +
        global.NfPick.html({ key: 'jv-party', value: l.party, label: l.party,
          placeholder: needsParty ? 'Party (required)' : 'Party', ariaLabel: 'Party',
          missing: needsParty && !l.party.trim() }) +
        '<input class="amt" data-k="debit" inputmode="decimal" value="' + esc(l.debit) + '" placeholder="0" aria-label="Debit">' +
        '<input class="amt" data-k="credit" inputmode="decimal" value="' + esc(l.credit) + '" placeholder="0" aria-label="Credit">' +
        '<input data-k="memo" value="' + esc(l.memo) + '" placeholder="Memo" aria-label="Memo">' +
        '<button class="del" type="button" data-del-leg="' + l.id + '" aria-label="Remove line">×</button>' +
        '</div>';
    }
    function savedVoucher(v) {
      return '<div class="jvcard' + (v.exported ? ' exported' : '') + '">' +
        '<div class="jvhead">' +
        '  <b>' + esc(v.voucher_no) + '</b><span class="d">' + F.ddMonYyyy(v.voucher_date) + '</span>' +
        '  <span class="nar">' + esc(v.narration || '') + '</span>' +
        '  <span class="r amt">Rs ' + F.fmt(v.total) + '</span>' +
        (v.exported ? '<span class="lockpill" title="Already sent to QuickBooks — correct it with a new voucher">In QuickBooks</span>'
                    : (canWrite ? '<button class="btn danger sm" type="button" data-del-jv="' + esc(v.id) + '" data-no="' + esc(v.voucher_no) + '">Delete</button>' : '')) +
        '</div>' +
        '<div class="jvlegs">' + (v.legs || []).map(function (l) {
          return '<div class="jvlegrow">' +
            '<span>' + esc(l.account_code) + ' ' + esc(l.account_name) + '</span>' +
            '<span class="c">' + esc(l.floor_code) + '</span>' +
            '<span>' + esc(l.party || '') + '</span>' +
            '<span class="wrap">' + esc(l.memo || '') + '</span>' +
            '<span class="r">' + (F.n(l.debit) ? F.fmt(l.debit) : '') + '</span>' +
            '<span class="r">' + (F.n(l.credit) ? F.fmt(l.credit) : '') + '</span>' +
            '</div>';
        }).join('') + '</div>' +
        '</div>';
    }

    function render() {
      var mark = esc(ctx.settings.mark || 'NF');
      var companyLine = esc(ctx.settings.company_line || ctx.companyName || '');
      var t = totals(), problems = issues();
      var list = (S.list && S.list.vouchers) || [];

      root.innerHTML = '' +
        '<div class="sheet jvsheet">' +
        '<header class="hdr">' +
        '  <div class="brand">' + F.brandMark(mark) +
        '    <div><div class="co">' + companyLine + '</div><h1>Journal Vouchers</h1></div></div>' +
        '  <div class="actions">' +
        '    <button class="btn" id="nf-jv-back" type="button">← Back to closing sheet</button>' +
        global.NfReportsMenu.html('jv') +
        '    <button class="btn primary" id="nf-jv-print" type="button">Print</button>' +
        '  </div>' +
        '</header>' +

        '<section class="rsec jvintro"><p class="muted">For anything that is not a cash or bank movement — a cost FMH, KBH or a director paid on Awami’s behalf, a token split across several units, any correction. These never touch the daily closing’s cash position; they go straight to the ledger and every statement.</p></section>' +

        (canWrite ? (
          '<section class="rsec jvnew">' +
          '  <div class="jvtop">' +
          '    <label>Voucher no <input id="nf-jv-no" value="' + esc(draft.no) + '" placeholder="JV-0065"></label>' +
          '    <label>Date <input type="date" id="nf-jv-date" value="' + esc(draft.date) + '"></label>' +
          '    <label class="grow">Narration <input id="nf-jv-nar" value="' + esc(draft.narration) + '" placeholder="What this voucher is for"></label>' +
          '  </div>' +
          '  <div class="jvcols"><span></span><span>Account</span><span>Floor</span><span>Party</span><span class="r">Debit</span><span class="r">Credit</span><span>Memo</span><span></span></div>' +
          '  <div id="nf-jv-legs">' + draft.legs.map(legRow).join('') + '</div>' +
          '  <button class="add" id="nf-jv-addleg" type="button">+ Add line</button>' +
          '  <div class="jvfoot">' +
          '    <span class="lbl">Totals</span>' +
          '    <span class="r' + (t.diff ? ' neg' : '') + '">' + F.fmt(t.debit) + '</span>' +
          '    <span class="r' + (t.diff ? ' neg' : '') + '">' + F.fmt(t.credit) + '</span>' +
          '    <span class="bal ' + (t.diff === 0 ? 'ok' : 'bad') + '">' + (t.diff === 0 ? 'Balanced' : 'Out by ' + F.fmt(Math.abs(t.diff))) + '</span>' +
          '  </div>' +
          (problems.length ? '<ul class="jvissues">' + problems.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' : '') +
          (S.error ? '<div class="jverr">' + esc(S.error) + '</div>' : '') +
          '  <div class="jvactions">' +
          '    <button class="btn primary" id="nf-jv-post" type="button"' + (problems.length || S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Posting…' : 'Post voucher') + '</button>' +
          '    <button class="btn" id="nf-jv-clear" type="button">Clear</button>' +
          '  </div>' +
          '</section>'
        ) : '<section class="rsec"><p class="muted">You have read-only access, so you can see journal vouchers but not post them.</p></section>') +

        '<section class="rsec">' +
        '  <h2 class="jvh">Posted journal vouchers <small>' + list.length + '</small></h2>' +
        (list.length ? list.map(savedVoucher).join('') : '<p class="muted">None yet.</p>') +
        '</section>' +
        '<div class="docfoot"><span>' + esc(ctx.companyName || '') + ' · Journal Vouchers</span>' +
        '<span>' + list.length + (list.length === 1 ? ' voucher' : ' vouchers') + '</span></div>' +
        '</div>';
    }

    function legOf(id) { return draft.legs.filter(function (x) { return x.id === id; })[0]; }

    function wire() {
      root.querySelector('#nf-jv-back').addEventListener('click', function () { ctx.onBack(); });
      root.querySelector('#nf-jv-print').addEventListener('click', function () {
        var old = document.title;
        document.title = 'Awami_Journal_Vouchers_' + F.ddMonYyyy(today());
        function restore() { document.title = old; window.removeEventListener('afterprint', restore); }
        window.addEventListener('afterprint', restore);
        setTimeout(restore, 4000);
        global.print();
      });
      global.NfReportsMenu.wire(root, ctx);
      if (!canWrite) return;

      var no = root.querySelector('#nf-jv-no'), dt = root.querySelector('#nf-jv-date'), nar = root.querySelector('#nf-jv-nar');
      // NOTHING here triggers a full redraw. Rebuilding the form on 'blur' or
      // on a select change destroys the very field the person has just moved
      // to — they tab from Memo to Party, the redraw lands, and the input they
      // are typing into is replaced mid-keystroke. refreshLive() instead
      // patches only the three things that actually change while typing (the
      // totals row, the issues list, the Post button) and leaves every input
      // node, its focus and its caret exactly where they are. A full redraw is
      // reserved for when the shape of the form really changes: a line added
      // or removed, a party picked, a voucher posted or deleted.
      function bindLive(el, apply) {
        el.addEventListener('input', function () { apply(el.value); S.error = null; refreshLive(); });
        el.addEventListener('change', function () { apply(el.value); refreshLive(); });
      }
      bindLive(no, function (v) { draft.no = v; });
      bindLive(nar, function (v) { draft.narration = v; });
      bindLive(dt, function (v) { draft.date = v; });

      root.querySelectorAll('.jvleg').forEach(function (rowEl) {
        var l = legOf(rowEl.getAttribute('data-leg'));
        if (!l) return;
        rowEl.querySelectorAll('[data-k]').forEach(function (inp) {
          var k = inp.getAttribute('data-k');
          bindLive(inp, function (v) { l[k] = v; });
        });
      });
      root.querySelectorAll('[data-del-leg]').forEach(function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-del-leg');
          if (draft.legs.length <= 2) { var l = legOf(id); if (l) { l.account = ''; l.floor = ''; l.party = ''; l.debit = ''; l.credit = ''; l.memo = ''; } }
          else { draft.legs = draft.legs.filter(function (x) { return x.id !== id; }); }
          redraw();
        });
      });
      root.querySelector('#nf-jv-addleg').addEventListener('click', function () {
        draft.legs.push(blankLeg()); redraw();
        // redraw() is deferred, so reach for the new row's account box after it lands
        setTimeout(function () {
          var rows = root.querySelectorAll('.jvleg [data-pick="jv-account"] .nfpick-in');
          if (rows.length) rows[rows.length - 1].focus();
        }, 10);
      });

      // Account and party are the shared type-to-search picker
      // (js/nf/nf-pick.js) — the same control, and the same behaviour, as the
      // daily closing sheet. Neither triggers a full redraw: refreshLive()
      // patches the totals, the issues list and the party-required marking
      // in place, so no input the person is working in gets replaced.
      function legFor(wrap) {
        var row = wrap.closest('.jvleg');
        return row ? legOf(row.getAttribute('data-leg')) : null;
      }
      global.NfPick.wire(root, {
        key: 'jv-account',
        items: function () { return global.NfPick.accountItems(S.heads); },
        emptyText: 'No account matches that. Accounts are never created here.',
        onPick: function (wrap, code) {
          var l = legFor(wrap);
          if (l) { l.account = code; S.error = null; refreshLive(); }
        },
      });
      global.NfPick.wire(root, {
        key: 'jv-party',
        items: function () { return global.NfPick.partyItems(S.parties); },
        allowCreate: true,
        onPick: function (wrap, name) {
          var l = legFor(wrap);
          if (l) { l.party = name; S.error = null; refreshLive(); }
        },
      });

      root.querySelector('#nf-jv-clear').addEventListener('click', function () {
        var keepNo = S.list && S.list.next_voucher_no;
        draft = blankVoucher(); draft.no = keepNo || ''; S.error = null; redraw();
      });
      root.querySelector('#nf-jv-post').addEventListener('click', post);

      root.querySelectorAll('[data-del-jv]').forEach(function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-del-jv'), vno = b.getAttribute('data-no');
          if (!global.confirm('Delete ' + vno + '? Its lines go with it. This is recorded in the audit log.')) return;
          ctx.api.jvDelete(id)
            .then(function () { return loadList(); })
            .then(function () { redraw(); })
            .catch(function (e) { S.error = messageFor(e); redraw(); });
        });
      });
    }

    // A full rebuild — only for a real change of shape (a line added or
    // removed, a party picked, a voucher posted or deleted). Deferred and
    // coalesced because some of those are reached from handlers that run
    // while the browser is still mid-event: replacing root.innerHTML from
    // inside a blur throws in Chrome ("The node to be removed is no longer a
    // child of this node"), which this screen's own verify caught.
    var redrawQueued = false;
    function redraw() {
      if (!alive || redrawQueued) return;
      redrawQueued = true;
      setTimeout(function () {
        redrawQueued = false;
        if (!alive) return;
        render(); wire();
      }, 0);
    }

    // The live half: everything that changes while somebody is typing, patched
    // in place so no input node — and no caret — is ever replaced mid-keystroke.
    function refreshLive() {
      if (!alive) return;
      var t = totals(), problems = issues();

      var foot = root.querySelector('.jvfoot');
      if (foot) {
        var amts = foot.querySelectorAll('.r');
        if (amts[0]) { amts[0].textContent = F.fmt(t.debit); amts[0].classList.toggle('neg', t.diff !== 0); }
        if (amts[1]) { amts[1].textContent = F.fmt(t.credit); amts[1].classList.toggle('neg', t.diff !== 0); }
        var bal = foot.querySelector('.bal');
        if (bal) {
          bal.textContent = t.diff === 0 ? 'Balanced' : 'Out by ' + F.fmt(Math.abs(t.diff));
          bal.classList.toggle('ok', t.diff === 0);
          bal.classList.toggle('bad', t.diff !== 0);
        }
      }

      // the party field's "this account needs one" marking follows the head
      root.querySelectorAll('.jvleg').forEach(function (rowEl) {
        var l = legOf(rowEl.getAttribute('data-leg'));
        var wrap = rowEl.querySelector('[data-pick="jv-party"]');
        var inp = wrap && wrap.querySelector('.nfpick-in');
        if (!l || !wrap || !inp) return;
        var needs = l.account && headRequiresParty(l.account);
        wrap.classList.toggle('miss', !!(needs && !l.party.trim()));
        inp.placeholder = needs ? 'Party (required)' : 'Party';
      });

      var host = root.querySelector('.jvnew');
      if (host) {
        var ul = host.querySelector('.jvissues');
        if (problems.length) {
          var html = problems.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('');
          if (ul) { ul.innerHTML = html; }
          else {
            ul = document.createElement('ul');
            ul.className = 'jvissues'; ul.innerHTML = html;
            host.insertBefore(ul, host.querySelector('.jvactions'));
          }
        } else if (ul) { ul.remove(); }
      }

      var post = root.querySelector('#nf-jv-post');
      if (post) post.disabled = !!(problems.length || S.busy);
    }

    function messageFor(e) {
      var c = e && e.code;
      if (c === 'NF:VOUCHER_ALREADY_EXPORTED') {
        var d = e.detail || {};
        return 'That voucher is already in QuickBooks' + (d.voucher ? ' (' + d.voucher + ')' : '') +
          '. It cannot be changed here — QuickBooks can only be corrected with a new voucher.';
      }
      if (c === 'NF:DUPLICATE_VOUCHER') return 'That voucher number is already used.';
      if (c === 'NF:VOUCHER_UNBALANCED') return 'Debits and credits do not match.';
      if (c === 'NF:PARTY_REQUIRED') return 'One of these accounts always tracks who it is with — name the party.';
      if (c === 'NF:VOUCHER_PREFIX_IS_CASHBOOK') return 'CRV/BRV/CPV/BPV belong to the daily closing sheet. Use JV- for a journal voucher.';
      if (c === 'NF:HEAD_NOT_POSTABLE') return 'That account cannot take an entry directly.';
      if (c === 'NF:NOT_ALLOWED') return 'You do not have permission to post vouchers.';
      return (e && e.message) || String(e);
    }

    function post() {
      if (issues().length || S.busy) return;
      S.busy = true; S.error = null; redraw();
      var legs = draft.legs
        .filter(function (l) { return l.account && (F.n(l.debit) || F.n(l.credit)); })
        .map(function (l) {
          var o = { account_code: l.account, floor_code: l.floor, memo: l.memo || null };
          if (F.n(l.debit) > 0) o.debit = F.n(l.debit); else o.credit = F.n(l.credit);
          if (l.party.trim()) o.party_name = l.party.trim();
          return o;
        });
      ctx.api.jvSave(ctx.companyId, draft.no.trim(), draft.date, draft.narration, legs)
        .then(function () {
          S.busy = false;
          draft = blankVoucher();
          return Promise.all([loadList(), ctx.api.listAllParties(ctx.companyId).then(function (p) { S.parties = p || []; })]);
        })
        .then(function () { draft.no = (S.list && S.list.next_voucher_no) || ''; redraw(); })
        .catch(function (e) { S.busy = false; S.error = messageFor(e); redraw(); });
    }

    boot();
  }

  global.NfJournalVoucher = { mount: mount };
})(window);
