/**
 * NexuFinance v1 — the voucher popups. window.NfVoucherPopup.open(opts)
 *
 * The owner's ask (2026-09-21), approved from the mockup in
 * D:\Claude Cowork\Voucher popup mockup\: vouchers are entered through a
 * popup per type (CRV, BRV, CPV, BPV, JV), which asks only for what that
 * type needs. It replaces typing receipts and payments into draft rows on
 * the closing sheet (docs/PLAN.md §45).
 *
 *   opts = { type: 'CRV'|'BRV'|'CPV'|'BPV'|'JV', api, companyId, day,
 *            heads, floors, vias, parties, onSaved(res) }
 *
 * - CRV / CPV: cash vouchers. The popup offers Cash or Petty cash and never
 *   asks which side, since the type decides it.
 * - BRV / BPV: bank vouchers. Via is Bank, shown, not asked.
 * - JV: any number of debit and credit lines. Save only works once they
 *   balance.
 *
 * Every voucher gets its SYSTEM number from the server on save. The MANUAL
 * number (the paper voucher's) may be left blank here and filled in before
 * Close day (docs/PLAN.md §44).
 *
 * Nothing is redrawn while a field has focus. The pickers (js/nf/nf-pick.js)
 * hold their own value in data-value, and the popup reads the values only
 * when Save is pressed: a redraw mid-typing is the bug class recorded in
 * nf_lookup_shapes_and_blur_redraw. The one redraw, the JV line list, happens
 * only on "+ Add line" / "×", after the current values have been read back
 * from the DOM.
 */
(function (global) {
  'use strict';
  var F = global.NfFmt, Msg = global.NfMsg;
  function esc(s) { return F.esc(s); }
  function uid() { return 'j' + Math.random().toString(36).slice(2, 9); }

  var TYPES = {
    CRV: { title: 'Cash Receipt Voucher',  side: 'IN',  cash: true,  tag: 'in',  head: 'Account head (credit)', party: 'Received from' },
    BRV: { title: 'Bank Receipt Voucher',  side: 'IN',  cash: false, tag: 'in',  head: 'Account head (credit)', party: 'Received from' },
    CPV: { title: 'Cash Payment Voucher',  side: 'OUT', cash: true,  tag: 'out', head: 'Account head (debit)',  party: 'Paid to' },
    BPV: { title: 'Bank Payment Voucher',  side: 'OUT', cash: false, tag: 'out', head: 'Account head (debit)',  party: 'Paid to' },
    JV:  { title: 'Journal Voucher', tag: 'jv' },
  };

  function headRequiresParty(heads, code) {
    var h = (heads || []).filter(function (x) { return x.code === code; })[0];
    return !!(h && h.requires_party);
  }
  function floorOptions(floors, sel) {
    return '<option value="">Floor…</option>' + (floors || []).map(function (f) {
      return '<option value="' + esc(f) + '"' + (f === sel ? ' selected' : '') + '>' + esc(f) + '</option>';
    }).join('');
  }

  function open(o) {
    var t = TYPES[o.type];
    if (!t) return;
    var old = document.getElementById('nf-vpop');
    if (old) old.remove();

    var host = document.createElement('div');
    host.className = 'nf-dialog-backdrop nf-vpop-back';
    host.id = 'nf-vpop';
    host.setAttribute('data-vtype', o.type);
    document.body.appendChild(host);

    var busy = false;
    var jvLines = null;
    function close() { host.remove(); if (o.onClose) o.onClose(); }

    // ── the frame, common to every type ──────────────────────────────────
    function frame(body, wide) {
      return '<div class="nf-vpop' + (wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-labelledby="nf-vpop-title">' +
        '<div class="vp-h"><span class="vp-tag ' + t.tag + '">' + esc(o.type) + '</span><h3 id="nf-vpop-title">' + esc(t.title) + '</h3>' +
        '<button type="button" class="vp-x" id="nfv-x" aria-label="Close">×</button></div>' +
        '<div class="vp-b">' + body + '</div>' +
        '<div class="vp-err" id="nfv-err" hidden></div>' +
        '<div class="vp-f"><span class="vp-hint">Esc to close</span>' +
        '<button class="btn" type="button" id="nfv-cancel">Cancel</button>' +
        (o.type === 'JV' ? '' : '<button class="btn" type="button" id="nfv-savenew">Save &amp; new ' + esc(o.type) + '</button>') +
        '<button class="btn primary" type="button" id="nfv-save">Save</button></div>' +
        '</div>';
    }
    function manualField() {
      return '<div class="vp-fld"><label for="nfv-manual">Manual voucher no.</label>' +
        '<input id="nfv-manual" autocomplete="off" placeholder="' + esc(o.type) + '-  (leave blank if not written yet)">' +
        '<small class="warn">Can be added later. The day cannot be closed until it is in.</small></div>';
    }
    function dateField() {
      return '<div class="vp-fld"><label>Date</label><div class="vp-ro">' + esc(F.longDate(o.day.business_date)) +
        ' · ' + esc(o.day.closing_no || '') + '</div></div>';
    }

    // ── CRV / BRV / CPV / BPV ─────────────────────────────────────────────
    function cashBankBody() {
      var viaChoice = t.cash
        ? '<div class="vp-seg" role="radiogroup" aria-label="' + (t.side === 'IN' ? 'Received into' : 'Paid from') + '">' +
          (o.vias || []).filter(function (v) { return v.via === 'Cash' || v.via === 'Petty'; }).map(function (v, i) {
            return '<button type="button" class="' + (i === 0 ? 'on' : '') + '" data-via="' + esc(v.via) + '" role="radio" aria-checked="' + (i === 0) + '">' +
              (v.via === 'Petty' ? 'Petty cash' : 'Cash') + '</button>';
          }).join('') + '</div>'
        : '<div class="vp-ro" data-via-fixed="Bank">Bank</div>';
      return '<div class="vp-grid">' +
        manualField() + dateField() +
        '<div class="vp-fld"><label>' + (t.side === 'IN' ? 'Received into' : 'Paid from') + '</label>' + viaChoice + '</div>' +
        '<div class="vp-fld"><label for="nfv-floor">Floor / class</label><select id="nfv-floor">' + floorOptions(o.floors, '') + '</select></div>' +
        '<div class="vp-fld full"><label>' + esc(t.head) + '</label>' +
        global.NfPick.html({ key: 'nfv-head', value: '', label: '', placeholder: 'Search a head by name or code…', ariaLabel: 'Account head' }) + '</div>' +
        '<div class="vp-fld full"><label>' + esc(t.party) + ' <span class="opt" id="nfv-party-req">(optional)</span></label>' +
        global.NfPick.html({ key: 'nfv-party', value: '', label: '', placeholder: 'Search a party, or type a new name', ariaLabel: 'Party' }) + '</div>' +
        '<div class="vp-fld full"><label for="nfv-desc">Description</label><input id="nfv-desc" autocomplete="off"></div>' +
        '<div class="vp-fld full"><label for="nfv-amt">Amount (Rs)</label><input id="nfv-amt" class="vp-amt" inputmode="decimal" autocomplete="off"></div>' +
        '<div class="vp-words" id="nfv-words"></div>' +
        '</div>';
    }

    function viaNow() {
      if (!t.cash) return 'Bank';
      var on = host.querySelector('.vp-seg .on');
      return on ? on.getAttribute('data-via') : '';
    }
    function pickVal(key) { var w = host.querySelector('[data-pick="' + key + '"]'); return w ? (w.getAttribute('data-value') || '').trim() : ''; }
    function showErr(msg) { var e = host.querySelector('#nfv-err'); e.textContent = msg; e.hidden = !msg; }

    function saveCashBank(andNew) {
      var head = pickVal('nfv-head'), floor = host.querySelector('#nfv-floor').value, via = viaNow();
      var party = pickVal('nfv-party') || host.querySelector('[data-pick="nfv-party"] .nfpick-in').value.trim();
      var amt = F.n(host.querySelector('#nfv-amt').value);
      var desc = host.querySelector('#nfv-desc').value.trim();
      var manual = host.querySelector('#nfv-manual').value.trim();
      var missing = [];
      if (!head) missing.push('an account head');
      if (!floor) missing.push('a floor');
      if (!via) missing.push(t.side === 'IN' ? 'where it was received' : 'where it was paid from');
      if (!(amt > 0)) missing.push('an amount');
      if (head && headRequiresParty(o.heads, head) && !party) missing.push('a party — this head always tracks who it is with');
      if (missing.length) { showErr('Still needed: ' + missing.join(', ') + '.'); return; }
      busy = true; showErr('');
      o.api.saveLine(o.day.id, null, t.side, manual, desc, head, floor, via, amt, null, party || null)
        .then(function (res) {
          busy = false;
          var mine = (res.lines || []).filter(function (l) { return l.side === t.side; })
            .sort(function (a, b) { return b.sort - a.sort; })[0];
          if (o.onSaved) o.onSaved(res, mine || null);
          if (andNew) { resetCashBank(); } else { close(); }
        })
        .catch(function (err) { busy = false; showErr(Msg.forLine(err)); });
    }
    function resetCashBank() {
      // keep the via and the floor: a run of payments is usually from the
      // same drawer, for the same floor
      ['#nfv-manual', '#nfv-desc', '#nfv-amt'].forEach(function (s) { host.querySelector(s).value = ''; });
      host.querySelector('#nfv-words').textContent = '';
      ['nfv-head', 'nfv-party'].forEach(function (k) {
        var w = host.querySelector('[data-pick="' + k + '"]');
        w.setAttribute('data-value', ''); w.querySelector('.nfpick-in').value = '';
      });
      host.querySelector('#nfv-manual').focus();
    }

    // ── JV ────────────────────────────────────────────────────────────────
    function blankLine() { return { id: uid(), account: '', party: '', floor: '', debit: '', credit: '' }; }
    function jvBody() {
      return '<div class="vp-grid">' + manualField() + dateField() +
        '<div class="vp-fld full"><label for="nfv-nar">Narration</label><input id="nfv-nar" autocomplete="off"></div></div>' +
        '<table class="vp-jv"><thead><tr><th>Account head</th><th>Party</th><th>Floor</th><th class="r">Debit</th><th class="r">Credit</th><th></th></tr></thead>' +
        '<tbody id="nfv-lines"></tbody></table>' +
        '<div class="vp-jvfoot"><button type="button" class="btn sm" id="nfv-addline">+ Add line</button>' +
        '<span class="vp-tie" id="nfv-tie"></span></div>';
    }
    function lineHTML(l) {
      return '<tr data-line="' + l.id + '">' +
        '<td>' + global.NfPick.html({ key: 'nfv-acct-' + l.id, value: l.account, label: global.NfPick.accountLabel(o.heads, l.account), placeholder: 'Head…', ariaLabel: 'Account head' }) + '</td>' +
        '<td>' + global.NfPick.html({ key: 'nfv-pty-' + l.id, value: l.party, label: l.party, placeholder: 'Party', ariaLabel: 'Party' }) + '</td>' +
        '<td><select data-f="floor" aria-label="Floor">' + floorOptions(o.floors, l.floor) + '</select></td>' +
        '<td><input data-f="debit" class="vp-num" inputmode="decimal" value="' + esc(l.debit) + '" aria-label="Debit"></td>' +
        '<td><input data-f="credit" class="vp-num" inputmode="decimal" value="' + esc(l.credit) + '" aria-label="Credit"></td>' +
        '<td><button type="button" class="vp-del" data-del-line="' + l.id + '" aria-label="Remove line">×</button></td></tr>';
    }
    // read what is on screen back into jvLines before any redraw or save
    function readLines() {
      jvLines.forEach(function (l) {
        var tr = host.querySelector('tr[data-line="' + l.id + '"]');
        if (!tr) return;
        var a = tr.querySelector('[data-pick="nfv-acct-' + l.id + '"]'), p = tr.querySelector('[data-pick="nfv-pty-' + l.id + '"]');
        l.account = a.getAttribute('data-value') || '';
        l.party = (p.getAttribute('data-value') || p.querySelector('.nfpick-in').value || '').trim();
        l.floor = tr.querySelector('[data-f="floor"]').value;
        l.debit = tr.querySelector('[data-f="debit"]').value;
        l.credit = tr.querySelector('[data-f="credit"]').value;
      });
    }
    function drawLines() {
      host.querySelector('#nfv-lines').innerHTML = jvLines.map(lineHTML).join('');
      jvLines.forEach(function (l) {
        global.NfPick.wire(host, { key: 'nfv-acct-' + l.id, items: function () { return global.NfPick.accountItems(o.heads); },
          emptyText: 'No head matches that.', onPick: function () { tie(); } });
        global.NfPick.wire(host, { key: 'nfv-pty-' + l.id, items: function () { return global.NfPick.partyItems(o.parties); }, allowCreate: true });
      });
      host.querySelectorAll('[data-del-line]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (jvLines.length <= 2) return;
          readLines();
          jvLines = jvLines.filter(function (x) { return x.id !== b.getAttribute('data-del-line'); });
          drawLines();
        });
      });
      host.querySelectorAll('.vp-num').forEach(function (i) { i.addEventListener('input', tie); });
      tie();
    }
    function tie() {
      var d = 0, c = 0;
      host.querySelectorAll('#nfv-lines tr').forEach(function (tr) {
        d += F.n(tr.querySelector('[data-f="debit"]').value); c += F.n(tr.querySelector('[data-f="credit"]').value);
      });
      var el = host.querySelector('#nfv-tie');
      var ok = d > 0 && Math.round(d * 100) === Math.round(c * 100);
      el.innerHTML = 'Debit <b>' + F.fmt(d) + '</b> · Credit <b>' + F.fmt(c) + '</b> · ' +
        (ok ? '<span class="ok">Balanced ✓</span>' : '<span class="neg">Difference ' + F.fmt(Math.abs(d - c)) + '</span>');
      return ok;
    }
    function saveJv() {
      readLines();
      var used = jvLines.filter(function (l) { return l.account || F.n(l.debit) || F.n(l.credit); });
      var problems = [];
      if (used.length < 2) problems.push('at least two lines');
      used.forEach(function (l, i) {
        var n = 'line ' + (i + 1);
        if (!l.account) problems.push(n + ' needs a head');
        if (!l.floor) problems.push(n + ' needs a floor');
        if ((F.n(l.debit) > 0) === (F.n(l.credit) > 0)) problems.push(n + ' needs a debit OR a credit');
        if (l.account && headRequiresParty(o.heads, l.account) && !l.party) problems.push(n + ' needs a party');
      });
      if (!tie()) problems.push('debits and credits that balance');
      if (problems.length) { showErr('Still needed: ' + problems.join('; ') + '.'); return; }
      busy = true; showErr('');
      var legs = used.map(function (l) {
        var leg = { account_code: l.account, floor_code: l.floor };
        if (F.n(l.debit) > 0) leg.debit = F.n(l.debit); else leg.credit = F.n(l.credit);
        if (l.party) leg.party_name = l.party;
        return leg;
      });
      o.api.jvSave(o.companyId, host.querySelector('#nfv-manual').value.trim(), o.day.business_date,
          host.querySelector('#nfv-nar').value.trim(), legs)
        .then(function (res) { busy = false; if (o.onSaved) o.onSaved(null, res); close(); })
        .catch(function (err) { busy = false; showErr(Msg.forLine(err)); });
    }

    // ── mount ─────────────────────────────────────────────────────────────
    host.innerHTML = frame(o.type === 'JV' ? jvBody() : cashBankBody(), o.type === 'JV');
    if (o.type === 'JV') {
      jvLines = [blankLine(), blankLine()];
      drawLines();
      host.querySelector('#nfv-addline').addEventListener('click', function () { readLines(); jvLines.push(blankLine()); drawLines(); });
    } else {
      global.NfPick.wire(host, {
        key: 'nfv-head', items: function () { return global.NfPick.accountItems(o.heads); },
        emptyText: 'No head matches that.',
        onPick: function (wrap, code) {
          // whether the party is required depends on the head — say so
          // beside the label; nothing else redraws
          host.querySelector('#nfv-party-req').textContent = headRequiresParty(o.heads, code) ? '(required for this head)' : '(optional)';
        },
      });
      global.NfPick.wire(host, { key: 'nfv-party', items: function () { return global.NfPick.partyItems(o.parties); }, allowCreate: true });
      host.querySelectorAll('.vp-seg button').forEach(function (b) {
        b.addEventListener('click', function () {
          host.querySelectorAll('.vp-seg button').forEach(function (x) { x.classList.remove('on'); x.setAttribute('aria-checked', 'false'); });
          b.classList.add('on'); b.setAttribute('aria-checked', 'true');
        });
      });
      var amt = host.querySelector('#nfv-amt');
      amt.addEventListener('input', function () {
        var n = F.n(amt.value);
        host.querySelector('#nfv-words').textContent = n > 0 ? 'Rupees ' + F.words(n) + ' only' : '';
      });
      amt.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); if (!busy) saveCashBank(false); } });
      host.querySelector('#nfv-savenew').addEventListener('click', function () { if (!busy) saveCashBank(true); });
    }
    host.querySelector('#nfv-save').addEventListener('click', function () {
      if (busy) return;
      if (o.type === 'JV') saveJv(); else saveCashBank(false);
    });
    host.querySelector('#nfv-cancel').addEventListener('click', close);
    host.querySelector('#nfv-x').addEventListener('click', close);
    // Escape closes the popup — unless a picker's own list used it first
    host.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !e.defaultPrevented) close(); });
    host.querySelector('#nfv-manual').focus();
    return host;
  }

  global.NfVoucherPopup = { open: open, TYPES: TYPES };
})(window);
