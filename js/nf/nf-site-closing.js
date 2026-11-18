/**
 * NexuFinance — Site Closing: the site accountant's own cash book.
 * window.NfSiteClosing.mount(root, ctx)   (docs/SITE_CLOSING_SPEC.md, Stage 3)
 *
 * ctx = { api, companyId, role: 'site', displayName, companyName, settings, onSignOut }
 *
 * The only screen a 'site' member ever sees. Plain words, no account codes, no
 * Dr/Cr: heads are shown by name (nf_site_list_heads), "Cash" is the site cash
 * box, "Bank" is a line the site saw go through the bank (HO owns those).
 *
 * Every line is saved on its own (nf_site_save_line), version-checked, the moment
 * the person leaves the row or presses Save. A save patches THAT row in place —
 * never a full redraw — so a row being typed into elsewhere keeps its focus and
 * caret (the rule docs/PLAN.md §33.1 learnt the hard way). A full render happens
 * only for a change of shape: another date, a submit, a reload after a conflict.
 *
 * After Submit the grid is read-only and each line shows its status only —
 * never HO's voucher, reason or proposal (the database withholds those anyway).
 */
(function (global) {
  'use strict';
  var F = global.NfFmt;
  function esc(s) { return F.esc(s); }

  // The seeded chart is the same for every NexuFinance company: the bank is 10300
  // and token money is 21100. A site user cannot read the chart itself.
  var BANK_HEAD = '10300';
  var TOKEN_HEAD = '21100';
  var NOTES = ['5000', '1000', '500', '100', '50', '20', '10'];
  var STATUS = {
    NEW: ['New', 'st-new'], DUPLICATE: ['Duplicate', 'st-dup'], POSSIBLE: ['Possible duplicate', 'st-dup'],
    LINKED: ['Linked', 'st-ok'], CONFLICT: ['Conflict', 'st-bad'], ACCEPTED: ['Accepted', 'st-ok'], REJECTED: ['Rejected', 'st-bad'],
  };

  function todayPk() {
    var p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    var g = function (t) { return p.filter(function (x) { return x.type === t; })[0].value; };
    return g('year') + '-' + g('month') + '-' + g('day');
  }
  function uid() { return 'r' + Math.random().toString(36).slice(2, 9); }

  function message(e) {
    var c = e && e.code, d = (e && e.detail) || {};
    var M = {
      'NF:VERSION_CONFLICT': 'Someone else changed this just now. The latest version is shown — your change was not saved.',
      'NF:SITE_CASH_NEGATIVE': 'The cash box cannot pay out more than it holds' + (d.date ? ' (it would go below zero on ' + F.ddMonYyyy(d.date) + ')' : '') + '.',
      'NF:DUPLICATE_DOC_NO': 'Number ' + (d.doc_no || '') + ' was already used' + (d.used_on ? ' on ' + F.ddMonYyyy(d.used_on) : '') + '.',
      'NF:SITE_TOKEN_NO_REQUIRED': 'Token money needs the token number.',
      'NF:HEAD_REQUIRED': 'Choose what this money is for.',
      'NF:AMOUNT_NOT_POSITIVE': 'Enter the amount in Cash or in Bank.',
      'NF:SITE_DAY_LOCKED': 'This day has been sent to head office and cannot be changed.',
      'NF:SITE_LINE_RESOLVED': 'Head office has already settled this line; it cannot be changed.',
      'NF:SITE_LINE_POSTED': 'Head office has already put this line in the books; it cannot be changed.',
      'NF:SITE_FUTURE_DATE': 'You cannot enter a future date.',
      'NF:SITE_BEFORE_FIRST_DAY': 'This date is before the site cash box was opened.',
      'NF:SITE_FIRST_DAY_REQUIRED': 'Head office has not opened the site cash box yet.',
      'NF:SITE_PREVIOUS_DAY_OPEN': 'Send ' + (d.date ? F.ddMonYyyy(d.date) : 'the earlier day') + ' to head office first.',
      'NF:SITE_COUNT_REQUIRED': 'Count the cash in the box first.',
      'NF:VARIANCE_REASON_REQUIRED': 'The count does not match. Write what happened.',
      'NF:BAD_COUNT': 'The cash count has a mistake — check the number of notes.',
      'NF:PHOTO_UPLOAD': 'The photo could not be saved. Photo storage may not be set up yet — keep the bill and try later.',
      'NF:NOT_ALLOWED': 'You do not have permission to do this.',
      'NF:LINE_NOT_FOUND': 'That line is no longer there. The day has been reloaded.',
    };
    if (c && M[c]) return M[c];
    return 'Could not save (' + (c || (e && e.message) || 'error') + ').';
  }

  function mount(root, ctx) {
    var alive = true;
    var S = { heads: [], units: [], days: [], date: null, day: null, rows: [], banner: null, drawer: false,
              count: {}, reason: '', busy: false, minDate: null, maxDate: null, today: todayPk() };

    function editable() { var st = S.day && S.day.status; return !S.day || !S.day.exists || st === 'DRAFT' || st === 'RETURNED'; }
    function headName(code) {
      if (code === BANK_HEAD) return 'Bank to Cash / Cash to Bank';
      var h = S.heads.filter(function (x) { return x.code === code; })[0];
      return h ? h.name : '';
    }

    // ── rows: the model behind the grid ───────────────────────────────────
    function rowFrom(l) {
      return { key: uid(), id: l.id, version: l.version, side: l.side, doc_no: l.doc_no || '', party_name: l.party_name || '',
        unit_codes: l.unit_codes || '', token_no: l.token_no == null ? '' : String(l.token_no), head_code: l.head_code,
        cash: l.via === 'SITE_CASH' ? String(+l.amount) : '', bank: l.via === 'BANK' ? String(+l.amount) : '',
        bank_ref: l.bank_ref || '', remarks: l.remarks || '', attachment_url: l.attachment_url || '',
        status: l.match_status, resolved: !!l.resolved_at, dirty: false, err: null, saving: false };
    }
    function blank(side) {
      return { key: uid(), id: null, version: null, side: side, doc_no: '', party_name: '', unit_codes: '', token_no: '',
        head_code: '', cash: '', bank: '', bank_ref: '', remarks: '', attachment_url: '', status: null, dirty: false, err: null, saving: false };
    }
    function isEmpty(r) {
      return !r.id && !r.doc_no && !r.party_name && !r.unit_codes && !r.token_no && !r.head_code && !r.cash && !r.bank && !r.bank_ref && !r.remarks;
    }
    function problem(r) {
      if (!r.head_code) return 'Choose what this money is for.';
      var c = F.n(r.cash), b = F.n(r.bank);
      if (c > 0 && b > 0) return 'Put the amount in Cash or in Bank, not both.';
      if (!(c > 0) && !(b > 0)) return 'Enter the amount in Cash or in Bank.';
      if (r.head_code === BANK_HEAD && b > 0) return 'Cash drawn from or put into the bank goes in the Cash column.';
      if (r.head_code === TOKEN_HEAD && !String(r.token_no).trim()) return 'Token money needs the token number.';
      if (/\.\d{3,}/.test(r.cash + r.bank)) return 'Amounts can have at most two decimals.';
      return null;
    }
    function rowsOf(side) { return S.rows.filter(function (r) { return r.side === side; }); }
    function rowByKey(k) { return S.rows.filter(function (r) { return r.key === k; })[0]; }
    function buildRows() {
      S.rows = [];
      ((S.day && S.day.lines) || []).forEach(function (l) { S.rows.push(rowFrom(l)); });
      if (editable()) { S.rows.push(blank('IN')); S.rows.push(blank('OUT')); }
    }
    function totals() {
      var inC = 0, outC = 0, inB = 0, outB = 0;
      S.rows.forEach(function (r) {
        if (r.status === 'REJECTED') return;
        if (r.side === 'IN') { inC += F.n(r.cash); inB += F.n(r.bank); } else { outC += F.n(r.cash); outB += F.n(r.bank); }
      });
      var opening = S.day ? F.n(S.day.opening) : 0;
      return { opening: opening, inC: inC, outC: outC, inB: inB, outB: outB, hand: opening + inC - outC };
    }

    // ── loading ───────────────────────────────────────────────────────────
    function boot() {
      root.innerHTML = '<div class="sheet scsheet"><section class="rsec"><p class="muted">Loading…</p></section></div>';
      Promise.all([ctx.api.siteListHeads(ctx.companyId), ctx.api.siteListUnits(ctx.companyId), ctx.api.siteListDays(ctx.companyId, null, null)])
        .then(function (r) {
          S.heads = r[0] || []; S.units = r[1] || []; S.days = r[2] || [];
          var dates = S.days.map(function (d) { return d.business_date; }).sort();
          S.minDate = dates[0] || null;
          var open = S.days.filter(function (d) { return d.status === 'DRAFT' || d.status === 'RETURNED'; })
                           .map(function (d) { return d.business_date; }).sort();
          // a day after one not yet sent to head office cannot be opened
          S.maxDate = open[0] && open[0] < S.today ? open[0] : S.today;
          return openDate(open[0] || S.today);
        })
        .catch(function (e) {
          if (!alive) return;
          root.innerHTML = '<div class="nf-gate"><h2>Could not open the site cash book</h2><p>' + esc(message(e)) + '</p></div>';
        });
    }
    function openDate(date) {
      S.date = date; S.banner = null; S.drawer = false;
      return ctx.api.siteGetDay(ctx.companyId, date).then(function (d) {
        if (!alive) return;
        S.day = d; buildRows(); render(); wire();
      });
    }
    function reloadDay(note) {
      return ctx.api.siteGetDay(ctx.companyId, S.date).then(function (d) {
        if (!alive) return;
        S.day = d; buildRows(); S.banner = note || null; render(); wire();
      });
    }

    // ── markup ────────────────────────────────────────────────────────────
    function headOptions(r) {
      var opts = '<option value="">Choose…</option>';
      opts += '<option value="' + BANK_HEAD + '"' + (r.head_code === BANK_HEAD ? ' selected' : '') + '>' +
        (r.side === 'IN' ? 'Cash drawn from bank' : 'Cash deposited in bank') + '</option>';
      S.heads.forEach(function (h) {
        opts += '<option value="' + esc(h.code) + '"' + (h.code === r.head_code ? ' selected' : '') + '>' + esc(h.name) + '</option>';
      });
      return opts;
    }
    function badge(st) {
      var b = STATUS[st]; if (!b) return '<span class="scst st-draft">Not sent</span>';
      return '<span class="scst ' + b[1] + '">' + b[0] + '</span>';
    }
    function rowHtml(r) {
      // a line head office has already settled stays as it is, even on a day sent back
      var ed = editable() && !r.resolved;
      var no = r.side === 'IN' ? 'Receipt no.' : 'Voucher no.';
      var who = r.side === 'IN' ? 'From' : 'Paid to';
      var f = function (k, label, extra) {
        return '<label class="scf scf-' + k + '"><span>' + label + '</span><input data-k="' + k + '" value="' + esc(r[k]) + '"' +
          (ed ? '' : ' readonly') + (extra || '') + '></label>';
      };
      var photo = r.attachment_url
        ? '<button class="scphoto has" type="button" data-photo-view="' + esc(r.key) + '">Bill ✓</button>'
        : '<span class="scphoto none">No bill</span>';
      return '<div class="scrow' + (r.id ? '' : ' new') + (r.dirty ? ' dirty' : '') + (r.err ? ' bad' : '') + '" data-row="' + r.key + '">' +
        f('doc_no', no, ' inputmode="numeric"') +
        f('party_name', who) +
        f('unit_codes', 'Unit(s)', ' list="nf-sc-units" placeholder="e.g. FF-120"') +
        f('token_no', 'Token #', ' inputmode="numeric"') +
        '<label class="scf scf-head"><span>For</span><select data-k="head_code"' + (ed ? '' : ' disabled') + '>' + headOptions(r) + '</select></label>' +
        f('cash', 'Cash', ' class="amt" inputmode="decimal" placeholder="0"') +
        f('bank', 'Bank', ' class="amt" inputmode="decimal" placeholder="0"' + (r.head_code === BANK_HEAD ? ' disabled' : '')) +
        f('bank_ref', 'Cheque / Ref') +
        f('remarks', 'Remarks') +
        '<div class="scf scf-photo"><span>Bill photo</span>' +
          (ed ? '<label class="scphoto pick">' + (r.attachment_url ? 'Replace' : 'Add photo') +
                '<input type="file" accept="image/*" capture="environment" data-photo="' + r.key + '" hidden></label>' : '') + photo + '</div>' +
        '<div class="scf scf-status"><span>Status</span>' + (r.id ? badge(S.day && S.day.status !== 'DRAFT' ? r.status : null) : '') + '</div>' +
        (ed ? '<div class="scrowact">' +
                '<button class="btn primary sm scsave" type="button" data-save="' + r.key + '"' + (r.dirty ? '' : ' hidden') + '>' + (r.saving ? 'Saving…' : 'Save') + '</button>' +
                (r.id ? '<button class="btn danger sm" type="button" data-del="' + r.key + '">Delete</button>' : '') +
              '</div>' : '') +
        '<div class="scrowerr"' + (r.err ? '' : ' hidden') + '>' + esc(r.err || '') + '</div>' +
        '</div>';
    }
    function tilesHtml() {
      var t = totals();
      return '<div class="sctiles">' +
        '<div class="sctile"><span>Opening cash</span><b data-tile="opening">' + F.fmt(t.opening) + '</b></div>' +
        '<div class="sctile"><span>Received</span><b data-tile="in" class="pos">' + F.fmt(t.inC) + '</b></div>' +
        '<div class="sctile"><span>Paid</span><b data-tile="out" class="neg">' + F.fmt(t.outC) + '</b></div>' +
        '<div class="sctile hand"><span>Should be in hand</span><b data-tile="hand">' + F.fmt(t.hand) + '</b></div>' +
        '</div>' +
        '<p class="scbank muted" data-tile="bank">Bank lines today: received ' + F.fmt(t.inB) + ' · paid ' + F.fmt(t.outB) + ' (head office checks these with the bank)</p>';
    }
    function bannerHtml() {
      var d = S.day || {};
      var out = '';
      if (d.status === 'RETURNED') out += '<div class="scbanner warn"><b>Head office sent this day back.</b> ' + esc(d.returned_reason || '') + '<br>Fix the lines and send it again.</div>';
      else if (d.status === 'SUBMITTED') out += '<div class="scbanner info">Sent to head office' + (d.submitted_at ? ' on ' + F.ddMonYyyy(d.submitted_at.slice(0, 10)) : '') + '. The lines cannot be changed now; each one shows what head office found.</div>';
      else if (d.status === 'MERGED') out += '<div class="scbanner ok">This day is closed.</div>';
      if (d.exists === false && d.has_first_day === false) out += '<div class="scbanner warn">Head office has not opened the site cash box yet. You cannot enter lines until it does.</div>';
      if (S.banner) out += '<div class="scbanner warn" id="nf-sc-banner">' + esc(S.banner) + '</div>';
      return out;
    }
    function drawerHtml() {
      if (!S.drawer) return '';
      var t = totals(), counted = countTotal(), diff = counted - t.hand;
      return '<div class="scdrawer-bg" id="nf-sc-drawer-bg"></div><div class="scdrawer" role="dialog" aria-label="Count the cash">' +
        '<h3>Count the cash in the box</h3>' +
        '<div class="scnotes">' + NOTES.map(function (n) {
          return '<label><span>Rs ' + F.fmt(+n) + ' notes</span><input data-note="' + n + '" inputmode="numeric" value="' + esc(S.count[n] || '') + '" placeholder="0">' +
                 '<em data-note-total="' + n + '">' + F.fmt((+S.count[n] || 0) * +n) + '</em></label>';
        }).join('') +
        '<label><span>Coins (total Rs)</span><input data-note="coins" inputmode="decimal" value="' + esc(S.count.coins || '') + '" placeholder="0"><em></em></label>' +
        '</div>' +
        '<div class="sccount"><div><span>Counted</span><b data-count="counted">' + F.fmt(counted) + '</b></div>' +
          '<div><span>Should be in hand</span><b>' + F.fmt(t.hand) + '</b></div>' +
          '<div><span>Difference</span><b data-count="diff" class="' + (diff ? 'neg' : 'pos') + '">' + (diff ? F.fmt(diff) : 'None') + '</b></div></div>' +
        '<label class="screason"' + (diff ? '' : ' hidden') + '><span>What happened? (required when the count does not match)</span>' +
          '<textarea id="nf-sc-reason" rows="2">' + esc(S.reason) + '</textarea></label>' +
        '<div class="scdrawer-err" id="nf-sc-drawer-err" hidden></div>' +
        '<div class="scdrawer-act"><button class="btn" type="button" id="nf-sc-drawer-close">Back</button>' +
          '<button class="btn primary" type="button" id="nf-sc-submit">Send to head office</button></div>' +
        '</div>';
    }
    function countTotal() {
      var t = 0; NOTES.forEach(function (n) { t += (Math.max(0, Math.floor(F.n(S.count[n]))) || 0) * +n; });
      return t + (F.n(S.count.coins) || 0);
    }

    function render() {
      var d = S.day || {}, ed = editable();
      var canEnter = !(d.exists === false && d.has_first_day === false);
      var dirty = S.rows.some(function (r) { return r.dirty; });
      root.innerHTML = '' +
        '<div class="sheet scsheet">' +
        '<header class="hdr">' +
        '  <div class="brand">' + F.brandMark(ctx.settings.mark || 'NF') +
        '    <div><div class="co">' + esc(ctx.settings.company_line || ctx.companyName || '') + '</div><h1>Site Cash Book</h1></div></div>' +
        '  <div class="actions"><span class="muted scwho">' + esc(ctx.displayName || '') + '</span>' +
        '    <button class="btn" id="nf-sc-signout" type="button">Sign out</button></div>' +
        '</header>' +
        '<section class="rsec sctop">' +
        '  <label class="scdate"><span>Date</span><input type="date" id="nf-sc-date" value="' + esc(S.date) + '"' +
             (S.minDate ? ' min="' + esc(S.minDate) + '"' : '') + ' max="' + esc(S.maxDate) + '"></label>' +
        '  <span class="scdaystatus">' + esc(({ DRAFT: 'Not sent yet', SUBMITTED: 'Sent to head office', RETURNED: 'Sent back to you', MERGED: 'Closed' })[d.status] || (d.exists ? '' : 'Not started')) + '</span>' +
        '</section>' +
        '<section class="rsec">' + bannerHtml() + tilesHtml() + '</section>' +
        (canEnter ? (
          section('IN', 'Money received', 'Every receipt from the receipt book — cash or bank.') +
          section('OUT', 'Money paid', 'Every voucher from the voucher book — cash or bank.')
        ) : '') +
        (ed && canEnter && d.exists ? '<section class="rsec scfoot"><button class="btn primary" id="nf-sc-count" type="button"' + (dirty ? ' disabled title="Save every line first"' : '') +
           '>Count cash &amp; send to head office</button>' + (dirty ? '<span class="muted"> Save every line first.</span>' : '') + '</section>' : '') +
        '<datalist id="nf-sc-units">' + S.units.map(function (u) { return '<option value="' + esc(u.unit) + '">'; }).join('') + '</datalist>' +
        '</div>' + drawerHtml();
    }
    function section(side, title, hint) {
      var rows = rowsOf(side);
      return '<section class="rsec scsec" data-side="' + side + '"><h2>' + title + ' <small>' + rows.filter(function (r) { return r.id; }).length + '</small></h2>' +
        '<p class="muted schint">' + hint + '</p>' +
        '<div class="scgrid" data-grid="' + side + '">' + rows.map(rowHtml).join('') + '</div></section>';
    }

    // ── the live half: tiles and one row, never the whole grid ─────────────
    function refreshTiles() {
      var t = totals();
      var set = function (k, v) { var el = root.querySelector('[data-tile="' + k + '"]'); if (el) el.textContent = v; };
      set('opening', F.fmt(t.opening)); set('in', F.fmt(t.inC)); set('out', F.fmt(t.outC)); set('hand', F.fmt(t.hand));
      set('bank', 'Bank lines today: received ' + F.fmt(t.inB) + ' · paid ' + F.fmt(t.outB) + ' (head office checks these with the bank)');
      var cnt = root.querySelector('#nf-sc-count');
      if (cnt) cnt.disabled = S.rows.some(function (r) { return r.dirty; });
    }
    function replaceRow(r) {
      var el = root.querySelector('[data-row="' + r.key + '"]');
      if (!el) return;
      var tmp = document.createElement('div'); tmp.innerHTML = rowHtml(r);
      var fresh = tmp.firstChild;
      el.parentNode.replaceChild(fresh, el);
      wireRow(fresh);
    }
    function markRow(r) {
      var el = root.querySelector('[data-row="' + r.key + '"]'); if (!el) return;
      el.classList.toggle('dirty', r.dirty); el.classList.toggle('bad', !!r.err);
      var sv = el.querySelector('[data-save]'); if (sv) { sv.hidden = !r.dirty; sv.textContent = r.saving ? 'Saving…' : 'Save'; sv.disabled = r.saving; }
      var er = el.querySelector('.scrowerr'); if (er) { er.hidden = !r.err; er.textContent = r.err || ''; }
      var bk = el.querySelector('[data-k="bank"]'); if (bk) bk.disabled = r.head_code === BANK_HEAD;
    }

    // ── saving one row ────────────────────────────────────────────────────
    function save(r) {
      if (!r.dirty || r.saving) return Promise.resolve();
      if (isEmpty(r)) { r.dirty = false; markRow(r); return Promise.resolve(); }
      var p = problem(r);
      if (p) { r.err = p; markRow(r); return Promise.resolve(); }
      r.saving = true; r.err = null; markRow(r);
      var wasNew = !r.id;
      var line = { side: r.side, doc_no: r.doc_no.trim(), party_name: r.party_name.trim(), unit_codes: r.unit_codes.trim(),
        token_no: String(r.token_no).trim(), head_code: r.head_code, via: F.n(r.bank) > 0 ? 'BANK' : 'SITE_CASH',
        amount: F.n(r.bank) > 0 ? F.n(r.bank) : F.n(r.cash), bank_ref: r.bank_ref.trim(), remarks: r.remarks.trim(), attachment_url: r.attachment_url };
      var knownIds = ((S.day && S.day.lines) || []).map(function (l) { return l.id; });
      return ctx.api.siteSaveLine(ctx.companyId, S.date, r.id, line, r.id ? r.version : null)
        .then(function (d) {
          if (!alive) return;
          var firstOfDay = !S.day || !S.day.exists;
          S.day = Object.assign({ exists: true }, d);
          var mine = r.id ? d.lines.filter(function (l) { return l.id === r.id; })[0]
                          : d.lines.filter(function (l) { return knownIds.indexOf(l.id) < 0; })[0];
          if (mine) { r.id = mine.id; r.version = mine.version; r.status = mine.match_status; }
          r.saving = false; r.dirty = false; r.err = null;
          // the day's own version moved; the others' line versions did not
          if (firstOfDay) { buildRowsKeeping(); render(); wire(); return; }
          replaceRow(r);
          if (wasNew) {
            var nb = blank(r.side); S.rows.push(nb);
            var grid = root.querySelector('[data-grid="' + r.side + '"]');
            if (grid) { var tmp = document.createElement('div'); tmp.innerHTML = rowHtml(nb); grid.appendChild(tmp.firstChild); wireRow(grid.lastChild); }
          }
          refreshTiles();
        })
        .catch(function (e) {
          if (!alive) return;
          r.saving = false;
          if (e && (e.code === 'NF:VERSION_CONFLICT' || e.code === 'NF:LINE_NOT_FOUND' || e.code === 'NF:SITE_DAY_LOCKED')) {
            return reloadDay(message(e));
          }
          r.err = message(e); markRow(r);
        });
    }
    // after the very first line of a day the day exists: keep any other unsaved rows
    function buildRowsKeeping() {
      var drafts = S.rows.filter(function (r) { return !r.id && !isEmpty(r); });
      S.rows = ((S.day && S.day.lines) || []).map(rowFrom).concat(drafts);
      ['IN', 'OUT'].forEach(function (s) { S.rows.push(blank(s)); });
    }

    // ── wiring ────────────────────────────────────────────────────────────
    function wireRow(el) {
      var r = rowByKey(el.getAttribute('data-row')); if (!r) return;
      el.querySelectorAll('[data-k]').forEach(function (inp) {
        var k = inp.getAttribute('data-k');
        var apply = function () {
          r[k] = inp.value; r.dirty = true; r.err = null;
          if (k === 'head_code' && r.head_code === BANK_HEAD && r.bank) { r.cash = r.cash || r.bank; r.bank = ''; replaceRow(r); }
          markRow(r); refreshTiles();
        };
        inp.addEventListener('input', apply);
        inp.addEventListener('change', apply);
        inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); save(r); } });
      });
      // leaving the row saves it (focus moving to another field of the SAME row does not)
      el.addEventListener('focusout', function (ev) {
        if (ev.relatedTarget && el.contains(ev.relatedTarget)) return;
        setTimeout(function () { if (alive && r.dirty && !problem(r)) save(r); }, 0);
      });
      var sv = el.querySelector('[data-save]'); if (sv) sv.addEventListener('click', function () { save(r); });
      var dl = el.querySelector('[data-del]');
      if (dl) dl.addEventListener('click', function () {
        if (!global.confirm('Delete this line? It is recorded in the audit log.')) return;
        ctx.api.siteDeleteLine(r.id, r.version)
          .then(function (d) {
            S.day = Object.assign({ exists: true }, d);
            S.rows = S.rows.filter(function (x) { return x !== r; });
            el.parentNode.removeChild(el); refreshTiles();
          })
          .catch(function (e) {
            if (e && (e.code === 'NF:VERSION_CONFLICT' || e.code === 'NF:LINE_NOT_FOUND')) return reloadDay(message(e));
            r.err = message(e); markRow(r);
          });
      });
      var ph = el.querySelector('[data-photo]');
      if (ph) ph.addEventListener('change', function () {
        var file = ph.files && ph.files[0]; if (!file) return;
        r.err = null; r.saving = true; markRow(r);
        ctx.api.uploadSiteBill(ctx.companyId, S.date, file)
          .then(function (path) { r.attachment_url = path; r.saving = false; r.dirty = true; replaceRow(r); return save(r); })
          .catch(function (e) { r.saving = false; r.err = message(e); markRow(r); });
      });
      var pv = el.querySelector('[data-photo-view]');
      if (pv) pv.addEventListener('click', function () {
        ctx.api.siteBillUrl(r.attachment_url).then(function (u) {
          if (u) global.open(u, '_blank', 'noopener'); else { r.err = 'The photo could not be opened.'; markRow(r); }
        });
      });
    }

    function wire() {
      var so = root.querySelector('#nf-sc-signout'); if (so) so.addEventListener('click', function () { if (ctx.onSignOut) ctx.onSignOut(); });
      var dt = root.querySelector('#nf-sc-date');
      if (dt) dt.addEventListener('change', function () {
        var v = dt.value;
        if (!v) return;
        if (v > S.maxDate || (S.minDate && v < S.minDate)) {
          dt.value = S.date;
          S.banner = v > S.today ? 'You cannot open a future date.' : v > S.maxDate ? 'Send ' + F.ddMonYyyy(S.maxDate) + ' to head office before opening a later day.'
                    : 'This date is before the site cash box was opened.';
          render(); wire(); return;
        }
        if (S.rows.some(function (r) { return r.dirty; }) && !global.confirm('Some lines are not saved. Leave this day anyway?')) { dt.value = S.date; return; }
        openDate(v);
      });
      root.querySelectorAll('.scrow').forEach(wireRow);
      var cnt = root.querySelector('#nf-sc-count');
      if (cnt) cnt.addEventListener('click', function () { S.drawer = true; render(); wire(); });
      wireDrawer();
    }
    function wireDrawer() {
      if (!S.drawer) return;
      var close = function () { S.drawer = false; render(); wire(); };
      root.querySelector('#nf-sc-drawer-close').addEventListener('click', close);
      root.querySelector('#nf-sc-drawer-bg').addEventListener('click', close);
      var live = function () {
        var t = totals(), c = countTotal(), diff = c - t.hand;
        NOTES.forEach(function (n) { var em = root.querySelector('[data-note-total="' + n + '"]'); if (em) em.textContent = F.fmt((Math.max(0, Math.floor(F.n(S.count[n]))) || 0) * +n); });
        root.querySelector('[data-count="counted"]').textContent = F.fmt(c);
        var d = root.querySelector('[data-count="diff"]'); d.textContent = diff ? F.fmt(diff) : 'None'; d.className = diff ? 'neg' : 'pos';
        root.querySelector('.screason').hidden = !diff;
      };
      root.querySelectorAll('[data-note]').forEach(function (inp) {
        inp.addEventListener('input', function () { S.count[inp.getAttribute('data-note')] = inp.value; live(); });
      });
      var rs = root.querySelector('#nf-sc-reason'); if (rs) rs.addEventListener('input', function () { S.reason = rs.value; });
      root.querySelector('#nf-sc-submit').addEventListener('click', function () {
        var err = root.querySelector('#nf-sc-drawer-err');
        var diff = countTotal() - totals().hand;
        if (diff && !S.reason.trim()) { err.hidden = false; err.textContent = 'The count does not match. Write what happened.'; return; }
        var den = {};
        NOTES.forEach(function (n) { den[n] = Math.max(0, Math.floor(F.n(S.count[n]))) || 0; });
        den.coins = F.n(S.count.coins) || 0;
        var btn = root.querySelector('#nf-sc-submit'); btn.disabled = true; btn.textContent = 'Sending…';
        ctx.api.siteSubmit(S.day.id, null, den, diff ? S.reason.trim() : null, S.day.version)
          .then(function () { S.count = {}; S.reason = ''; S.drawer = false; return ctx.api.siteListDays(ctx.companyId, null, null); })
          .then(function (days) {
            S.days = days || [];
            var open = S.days.filter(function (d) { return d.status === 'DRAFT' || d.status === 'RETURNED'; }).map(function (d) { return d.business_date; }).sort();
            S.maxDate = open[0] && open[0] < S.today ? open[0] : S.today;
            return reloadDay(null);
          })
          .catch(function (e) {
            btn.disabled = false; btn.textContent = 'Send to head office';
            if (e && e.code === 'NF:VERSION_CONFLICT') return reloadDay(message(e));
            err.hidden = false; err.textContent = message(e);
          });
      });
    }

    boot();
    return { destroy: function () { alive = false; } };
  }

  global.NfSiteClosing = { mount: mount };
})(window);
