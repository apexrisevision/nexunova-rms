/* ════════════════════════════════════════════════════════════════════════
   DAILY CLOSING — S1, the Day Workspace  ·  BLUEPRINT §A12  ·  P6
   ────────────────────────────────────────────────────────────────────────
   window.DailyClosing.mount(rootEl, { rpc, projects, projectId, date, me }).

   It is written as a MOUNTABLE component, not a page, so P8 can hang it on a
   `.pg` div inside login.html without a rewrite. `rpc` is injected rather than
   reached for, which is also what lets the test drive it with scripted answers
   instead of a live database.

   THE SERVER DECIDES EVERYTHING. Every guard here is a courtesy — it saves a
   round trip and gives a better sentence than a constraint violation. Not one
   of them is the rule. There is no edit and no delete of an entry anywhere in
   this file, because invariant 1 says a saved entry is a fact; the only way to
   undo one is to void it, which writes a second row.

   Composer tab order is §A12's, exactly: Type → Mode → Direction → Voucher # →
   Amount → Payee → Unit (receipts only) → QB Head → Narration → Save, with
   Enter in Narration saving.
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var F = global.DCFmt, K = global.DCKit;

  /* §A9 → the field the message belongs under. An error with nowhere to go is
     an error the person has to guess about. */
  var FIELD_FOR = {
    DUPLICATE_VOUCHER:        'dc-voucher-no',
    OVERRIDE_REASON_REQUIRED: 'dc-qb-reason',
    UNIT_REQUIRED:            'dc-unit',
    VARIANCE_TAG_REQUIRED:    'dc-amount',
    PAYEE_INACTIVE:           'dc-payee',
    ACCOUNT_INACTIVE:         'dc-qb',
    ACCOUNT_REQUIRED:         'dc-qb'
  };

  function el(id) { return document.getElementById(id); }
  function esc(s) { return K.esc(s); }

  function mount(root, opts) {
    var S = {
      rpc: opts.rpc,
      me: opts.me || {},
      projects: opts.projects || [],
      projectId: opts.projectId || (opts.projects[0] && opts.projects[0].id),
      date: opts.date || F.todayPK(),
      day: null, entries: [], payees: [], units: [], accounts: [],
      defaults: {}, busy: false,
      form: null, idemKey: null
    };
    root.classList.add('dc');
    S.isCfo = !!S.me.isCfo;
    S.isAccountantPlus = !!(S.me.isAccountantPlus || S.me.isCfo);

    /* ── data ─────────────────────────────────────────────────────────── */
    function load() {
      render(true);
      return S.rpc('get_cash_day_summary', {
        p_company_id: S.me.companyId, p_project_id: S.projectId, p_business_date: S.date
      }).then(function (r) {
        S.day = r || {};
        if (!S.day.exists) { S.entries = []; return null; }
        return S.rpc('list_cash_entries', {
          p_company_id: S.me.companyId, p_cash_day_id: S.day.cash_day_id
        }).then(function (l) { S.entries = (l && l.entries) || []; });
      }).then(function () {
        return Promise.all([
          S.rpc('list_payees', { p_company_id: S.me.companyId, p_project_id: S.projectId })
            .then(function (r) { S.payees = (r && r.payees) || []; }),
          S.rpc('list_qb_accounts_for_project', { p_company_id: S.me.companyId, p_project_id: S.projectId })
            .then(function (r) { S.accounts = (r && r.accounts) || []; S.defaults = (r && r.defaults) || {}; })
            .catch(function () { S.accounts = []; S.defaults = {}; }),
          S.rpc('list_units_for_picker', { p_company_id: S.me.companyId, p_project_id: S.projectId })
            .then(function (r) { S.units = (r && r.units) || []; })
            .catch(function () { S.units = []; })
        ]);
      }).then(function () { render(false); })
        .catch(function (e) { S.error = e && e.message; render(false); });
    }

    /* ── render ───────────────────────────────────────────────────────── */
    function render(loading) {
      root.innerHTML = header(loading) +
        (loading ? skeletonBody()
                 : !S.day || !S.day.exists ? notOpened()
                 : S.day.status === 'CLOSED' ? closedBody()
                 : openBody()) +
        '<div class="dc-toasts"></div>';
      if (!loading) wire();
    }

    function header(loading) {
      var d = S.day || {};
      var status = !d.exists ? null : d.status;
      return '<div class="dc-band dc-row-between" style="margin-bottom:16px">' +
        '<div style="min-width:0">' +
          '<label class="dc-label" for="dc-project">Project</label>' +
          '<select class="dc-select" id="dc-project" style="max-width:280px;height:32px;font-size:13px">' +
            S.projects.map(function (p) {
              return '<option' + (p.id === S.projectId ? ' selected' : '') + ' value="' + esc(p.id) + '">' +
                esc(p.name) + '</option>';
            }).join('') + '</select>' +
          '<div class="dc-band-date" style="margin-top:8px">' + esc(F.dateLong(S.date)) + '</div>' +
        '</div>' +
        '<div class="dc-row-between" style="gap:12px">' +
          '<input class="dc-input" id="dc-date" type="date" value="' + esc(S.date) +
            '" style="width:150px;height:32px" aria-label="Business date">' +
          (status ? K.statusChip(status) : '') +
          (status === 'OPEN' && S.isCfo
            ? '<button class="dc-btn" id="dc-close" type="button">Close Day</button>' : '') +
        '</div>' +
      '</div>' +
      (loading ? '' : heroRow(d));
    }

    function heroRow(d) {
      if (!d.exists) return '';
      return '<div class="dc-card" style="margin-bottom:16px"><div class="dc-hero-row">' +
        K.heroFigure({ label: 'Closing cash', value: d.closing_cash, tone: 'in', id: 'dc-h-cash' }) +
        K.heroFigure({ label: 'Closing bank', value: d.closing_bank, id: 'dc-h-bank' }) +
        K.heroFigure({ label: 'Entries', raw: String(S.entries.length), id: 'dc-h-count' }) +
      '</div></div>';
    }

    function skeletonBody() {
      return '<div class="dc-card dc-stack">' +
        K.skeleton({ height: '40px', width: '30%' }) +
        K.skeleton({ height: '16px' }) + K.skeleton({ height: '16px', width: '70%' }) +
        K.skeleton({ height: '200px' }) + '</div>';
    }

    function notOpened() {
      return '<div class="dc-card">' + K.emptyState({
        message: 'No day open for ' + F.dateShort(S.date),
        action: 'Open day', actionId: 'dc-open'
      }) + '</div>';
    }

    /* ── composer + ledger ─────────────────────────────────────────────── */
    function openBody() {
      return '<div class="dc-2col">' +
        '<div class="dc-card">' + composer() + '</div>' +
        '<div>' + ledger() + '</div>' +
      '</div>' + stickyTotals();
    }

    function composer() {
      var f = S.form || (S.form = { type: 'CLIENT_RECEIPT', mode: 'CASH', dir: 'IN' });
      var isReceipt = f.type === 'CLIENT_RECEIPT';
      var isTransfer = f.type === 'TRANSFER';
      return '<form id="dc-form" novalidate autocomplete="off">' +
        '<label class="dc-label">Type</label>' +
        K.segmented({ id: 'dc-type', label: 'Entry type', value: f.type, items: [
          { value: 'CLIENT_RECEIPT', label: 'Receipt' }, { value: 'EXPENSE', label: 'Expense' },
          { value: 'TRANSFER', label: 'Transfer' }, { value: 'LOAN_CAPITAL', label: 'Loan/Capital' },
          { value: 'OTHER', label: 'Other' }]}) +
        '<div style="height:12px"></div>' +
        '<div class="dc-row-between" style="align-items:flex-end;gap:16px">' +
          '<div style="flex:1"><label class="dc-label">Mode</label>' +
            K.segmented({ id: 'dc-mode', label: 'Mode', value: f.mode, items: [
              { value: 'CASH', label: 'Cash' }, { value: 'BANK', label: 'Bank' }]}) + '</div>' +
          '<div style="flex:1"><label class="dc-label">Direction</label>' +
            K.segmented({ id: 'dc-dir', label: 'Direction', value: f.dir, items: [
              { value: 'IN', label: 'In' }, { value: 'OUT', label: 'Out' }]}) + '</div>' +
          '<div id="dc-chip">' + K.voucherChip(voucherFor(f)) + '</div>' +
        '</div>' +
        '<div style="height:16px"></div>' +
        '<div class="dc-field"><label class="dc-label" for="dc-voucher-no">Voucher # <span aria-hidden="true">*</span></label>' +
          '<input class="dc-input" id="dc-voucher-no" type="text" inputmode="numeric" aria-required="true">' +
          '<span class="dc-error" id="dc-voucher-no-err" hidden></span></div>' +
        K.moneyInput({ id: 'dc-amount', label: 'Amount', required: true }) +
        '<span class="dc-error" id="dc-amount-err" hidden></span>' +
        K.entitySelect({ id: 'dc-payee', label: 'Payee', required: true, placeholder: 'Type to search…' }) +
        '<span class="dc-error" id="dc-payee-err" hidden></span>' +
        (isReceipt
          ? K.entitySelect({ id: 'dc-unit', label: 'Unit', required: true, placeholder: 'Unit number…' }) +
            '<span class="dc-error" id="dc-unit-err" hidden></span>'
          : '') +
        (isTransfer ? transferFields() : '') +
        qbField() +
        '<span class="dc-error" id="dc-qb-err" hidden></span>' +
        '<div class="dc-field"><label class="dc-label" for="dc-narration">Narration</label>' +
          '<input class="dc-input" id="dc-narration" type="text" placeholder="What was this for?"></div>' +
        '<div class="dc-row-between">' +
          '<button class="dc-btn" id="dc-attach" type="button">Attach</button>' +
          '<button class="dc-btn dc-btn--primary" id="dc-save" type="submit">Save ⏎</button>' +
        '</div>' +
        '<input type="file" id="dc-file" accept="image/jpeg,image/png,application/pdf" hidden>' +
      '</form>';
    }

    function transferFields() {
      var o = S.accounts.filter(function (a) { return a.kind; });
      function sel(id, label) {
        return '<div class="dc-field"><label class="dc-label" for="' + id + '">' + label + '</label>' +
          '<select class="dc-select" id="' + id + '">' +
          o.map(function (a) { return '<option value="' + esc(a.cash_account_id) + '">' + esc(a.name) + '</option>'; }).join('') +
          '</select></div>';
      }
      return sel('dc-from', 'From account') + sel('dc-to', 'To account');
    }

    function qbField() {
      var def = S.defaults[S.form.type] || null;
      var opts = S.accounts.map(function (a) {
        return { value: a.id, label: a.number + ' · ' + a.name };
      });
      if (!opts.length) opts = [{ value: '', label: '—' }];
      return K.suggestedField({ id: 'dc-qb', label: 'QB Head', value: def || opts[0].value,
        defaultValue: def || '', options: opts });
    }

    function voucherFor(f) {
      if (f.type === 'TRANSFER') return null;
      return { 'CASH|IN': 'CRV', 'CASH|OUT': 'CPV', 'BANK|IN': 'BRV', 'BANK|OUT': 'BPV' }[f.mode + '|' + f.dir] || null;
    }

    function ledgerRows() { return rowsFor(S.entries); }
    function rowsFor(list) {
      return list.map(function (e) {
        return {
          seq: e.seq_no, voucherType: e.voucher_type, voucherNo: e.voucher_no,
          payee: e.payee_name, narration: e.narration,
          in: e.direction === 'IN' ? Number(e.amount) : 0,
          out: e.direction === 'OUT' ? Number(e.amount) : 0,
          voided: !!e.is_voided, reversalId: e.reversal_id
        };
      });
    }

    function totals() {
      var t = { in: 0, out: 0 };
      S.entries.forEach(function (e) {
        if (e.direction === 'IN') t.in += Number(e.amount);
        else if (e.direction === 'OUT') t.out += Number(e.amount);
      });
      return t;
    }

    function ledger() {
      if (!S.entries.length) {
        return '<div class="dc-card">' + K.emptyState({
          message: 'Nothing recorded yet today. The first entry goes in on the left.' }) + '</div>';
      }
      var t = totals();
      return K.ledgerTable({ rows: ledgerRows(), totals: t }) +
        (S.isAccountantPlus ? voidBar() : '');
    }

    function voidBar() {
      var live = S.entries.filter(function (e) { return !e.is_voided && !e.is_adjustment; });
      if (!live.length) return '';
      return '<div class="dc-card" style="margin-top:12px">' +
        '<label class="dc-label" for="dc-void-pick">Void an entry</label>' +
        '<div class="dc-row-between" style="gap:8px">' +
          '<select class="dc-select" id="dc-void-pick" style="flex:1">' +
            live.map(function (e) {
              return '<option value="' + esc(e.id) + '">' + esc(e.voucher_type + '-' + e.voucher_no) +
                ' · ' + esc(F.amount(e.amount)) + '</option>';
            }).join('') + '</select>' +
          '<button class="dc-btn" id="dc-void" type="button">Void…</button>' +
        '</div></div>';
    }

    function stickyTotals() {
      var t = totals();
      return '<div class="dc-sticky-totals"><span>Total</span>' +
        '<span><span class="dc-in-col dc-num">' + esc(F.amount(t.in)) + '</span>' +
        ' <span class="dc-out-col dc-num">' + esc(F.amount(t.out)) + '</span></span></div>';
    }

    /* §A12: a closed day lists "adjustments in their own group with reasons".
       An adjustment is not the same thing as an is_adjustment ROW — a void
       written while the day was still open carries that flag too, and it is
       part of the day's own story, not a post-close correction. The group is
       therefore what was written AFTER closed_at, which is exactly what the
       Director PDF's ADJUSTMENTS block means. */
    function isPostClose(e) {
      return e.is_adjustment && S.day.closed_at &&
             e.created_at && e.created_at > S.day.closed_at;
    }

    function closedBody() {
      var d = S.day;
      var adj = S.entries.filter(isPostClose);
      var duringDay = S.entries.filter(function (e) { return !isPostClose(e); });
      return '<div class="dc-card dc-stack" style="margin-bottom:16px">' +
        '<div class="dc-row-between">' + K.lockBadge({ at: F.time(d.closed_at), by: 'CFO' }) +
          '<div class="dc-row-between" style="gap:8px">' +
            (S.isCfo ? '<button class="dc-btn" id="dc-adjust" type="button">Add adjustment</button>' : '') +
            '<button class="dc-btn" id="dc-pdf" type="button" disabled title="The Director PDF arrives in P7">Director PDF</button>' +
          '</div></div>' +
        (Number(d.variance) !== 0
          ? '<div class="dc-hint">Counted ' + esc(F.money(d.counted_cash)) + ' · variance ' +
            esc(F.amount(d.variance)) + (d.variance_note ? ' — “' + esc(d.variance_note) + '”' : '') + '</div>'
          : '') +
      '</div>' +
      K.ledgerTable({ rows: rowsFor(duringDay), totals: totals() }) +
      (adj.length ? adjustmentsBlock(adj) : '');
    }

    function adjustmentsBlock(adj) {
      return '<div class="dc-card" style="margin-top:16px">' +
        '<label class="dc-label">Adjustments</label>' +
        adj.map(function (e) {
          return '<div class="dc-adj-row">' +
            K.voucherChip(e.voucher_type, { no: e.voucher_no }) +
            '<span class="dc-num ' + (e.direction === 'OUT' ? 'dc-out-col' : 'dc-in-col') + '">' +
              esc(F.amount(e.amount)) + '</span>' +
            '<span class="dc-adj-reason">' + esc(e.adjustment_reason || e.narration || '') + '</span>' +
          '</div>';
        }).join('') + '</div>';
    }

    /* ── wiring ───────────────────────────────────────────────────────── */
    function clearErrors() {
      ['dc-voucher-no', 'dc-amount', 'dc-payee', 'dc-unit', 'dc-qb'].forEach(function (id) {
        var e = el(id + '-err'); if (e) { e.hidden = true; e.textContent = ''; }
        var f = el(id); if (f && f.closest('.dc-field')) f.closest('.dc-field').classList.remove('dc-field--error');
      });
    }

    function showError(code, message) {
      var target = FIELD_FOR[code];
      var box = target && el(target + '-err');
      if (box) {
        box.textContent = message || code;
        box.hidden = false;
        var f = el(target);
        if (f && f.closest('.dc-field')) f.closest('.dc-field').classList.add('dc-field--error');
        if (f && f.focus) f.focus();
        return;
      }
      K.toast(message || code);
    }

    function wire() {
      var p = el('dc-project');
      if (p) p.addEventListener('change', function () { S.projectId = p.value; S.day = null; load(); });
      var dt = el('dc-date');
      if (dt) dt.addEventListener('change', function () { S.date = dt.value; S.day = null; load(); });

      var open = el('dc-open');
      if (open) open.addEventListener('click', openDay);

      if (!S.day || !S.day.exists || S.day.status !== 'OPEN') return wireClosed();

      K.bindSegmented(el('dc-type'), function (v) { S.form.type = v; rerenderComposer(); });
      K.bindSegmented(el('dc-mode'), function (v) { S.form.mode = v; refreshChip(); });
      K.bindSegmented(el('dc-dir'),  function (v) { S.form.dir  = v; refreshChip(); });
      K.bindMoneyInput(el('dc-amount'));
      K.bindSuggestedField(el('dc-qb'));

      K.bindEntitySelect(el('dc-payee'), {
        allowNew: S.isAccountantPlus,
        items: S.payees.map(function (x) {
          return { id: x.id, label: x.name, recent: !!x.last_used_at };
        }),
        onPick: function (it) { S.form.payeeId = it.id; },
        onNew: newPayee
      });
      if (el('dc-unit')) {
        K.bindEntitySelect(el('dc-unit'), {
          items: S.units.map(function (u) { return { id: u.id, label: u.unit_no }; }),
          onPick: function (it) { S.form.unitId = it.id; }
        });
      }

      var form = el('dc-form');
      form.addEventListener('submit', function (e) { e.preventDefault(); save(); });
      // §A12: Enter in Narration saves.
      el('dc-narration').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); save(); }
      });
      el('dc-attach').addEventListener('click', function () { el('dc-file').click(); });
      el('dc-file').addEventListener('change', queueAttachment);

      var v = el('dc-void');
      if (v) v.addEventListener('click', voidEntry);
      var c = el('dc-close');
      if (c) c.addEventListener('click', function () {
        K.toast('Close Day is P7 — the panel and the Director PDF arrive together.');
      });
    }

    function wireClosed() {
      var a = el('dc-adjust');
      if (a) a.addEventListener('click', function () {
        K.toast('Adjustments use the same panel as Close Day — P7.');
      });
    }

    function rerenderComposer() {
      var host = el('dc-form').parentNode;
      host.innerHTML = composer();
      wire();
    }
    function refreshChip() {
      el('dc-chip').innerHTML = K.voucherChip(voucherFor(S.form));
    }

    /* ── actions ──────────────────────────────────────────────────────── */
    function openDay() {
      return S.rpc('open_cash_day', {
        p_company_id: S.me.companyId, p_project_id: S.projectId, p_business_date: S.date
      }).then(function (r) {
        if (r && r.success) { K.toast('Day opened'); return load(); }
        if (r && r.error === 'SETUP_OPENING_REQUIRED') return setupOpeningDialog();
        K.toast((r && r.message) || (r && r.error) || 'Could not open the day');
      });
    }

    function setupOpeningDialog() {
      if (!S.isCfo) {
        return K.toast('This project has no opening balance yet. Only the CFO can set it.');
      }
      return K.dialog({
        title: 'Opening balance for this project',
        message: 'Set once, before the first day. Every later day carries forward from the one before it.',
        confirm: 'Set opening balance',
        fields: [
          { name: 'cash', label: 'Cash in hand', type: 'money', required: true },
          { name: 'bank', label: 'Bank balance', type: 'money', required: true }
        ]
      }).then(function (v) {
        if (!v) return;
        return S.rpc('setup_cash_opening', {
          p_company_id: S.me.companyId, p_project_id: S.projectId,
          p_cash: v.cash, p_bank: v.bank, p_effective_date: S.date
        });
      }).then(function (r) {
        if (!r) return;
        if (r && r.success) { K.toast('Opening balance set'); return openDay(); }
        K.toast((r && r.message) || (r && r.error) || 'Could not set the opening balance');
      });
    }

    function newPayee(name) {
      if (!S.isAccountantPlus) return K.toast('Only Accounts and the CFO may add a payee.');
      return K.dialog({
        title: 'New payee',
        message: 'Payees are chosen from a list, never typed onto an entry — so this name will be the one everybody sees from now on.',
        confirm: 'Add payee',
        fields: [
          { name: 'name', label: 'Name', required: true, value: name },
          { name: 'kind', label: 'Kind', type: 'select', options: [
            { value: 'VENDOR', label: 'Vendor' }, { value: 'STAFF', label: 'Staff' },
            { value: 'CUSTOMER', label: 'Customer' }, { value: 'DEALER', label: 'Dealer' },
            { value: 'OTHER', label: 'Other' }] }
        ]
      }).then(function (v) {
        if (!v) return;
        name = v.name;
        return S.rpc('create_payee', {
          p_company_id: S.me.companyId, p_name: v.name, p_kind: v.kind,
          p_project_id: S.projectId
        });
      }).then(function (r) {
        if (!r) return;
        if (r && r.success) {
          S.payees.push({ id: r.payee_id, name: name });
          S.form.payeeId = r.payee_id;
          el('dc-payee').value = name;
          K.toast(name + ' added');
          return;
        }
        showError('PAYEE_INACTIVE', (r && r.message) || (r && r.error));
      });
    }

    function queueAttachment(e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      if (f.size > 10485760) return showError('x', 'That file is larger than 10 MB.');
      S.form.pendingFile = f;
      K.toast(f.name + ' will be attached when the entry saves');
    }

    function save() {
      if (S.busy) return;
      var btn = el('dc-save');
      clearErrors();

      // §A7: one key per form submission, REUSED on retry, so a second press
      // after a lost response returns the first entry rather than a second one.
      if (!S.idemKey) S.idemKey = uuid();

      var payload = {
        entry_type: S.form.type, voucher_no: el('dc-voucher-no').value.trim(),
        amount: F.parseMoney(el('dc-amount').value),
        payee_id: S.form.payeeId || null,
        narration: el('dc-narration').value.trim() || null,
        qb_account_id: el('dc-qb') ? el('dc-qb').value : null
      };
      if (S.form.type !== 'TRANSFER') { payload.mode = S.form.mode; payload.direction = S.form.dir; }
      if (S.form.type === 'CLIENT_RECEIPT') payload.unit_id = S.form.unitId || null;
      if (S.form.type === 'TRANSFER') {
        payload.from_cash_account_id = el('dc-from') && el('dc-from').value;
        payload.to_cash_account_id = el('dc-to') && el('dc-to').value;
      }
      var reason = el('dc-qb-reason');
      if (reason && reason.value.trim()) payload.qb_override_reason = reason.value.trim();

      S.busy = true; btn.classList.add('dc-btn--loading');
      return S.rpc('record_cash_entry', {
        p_company_id: S.me.companyId, p_cash_day_id: S.day.cash_day_id,
        p_idempotency_key: S.idemKey, p_payload: payload
      }).then(function (r) {
        S.busy = false; btn.classList.remove('dc-btn--loading');
        if (!r || !r.success) {
          return showError(r && r.error, r && r.message);
        }
        S.idemKey = null;                       // this submission is done
        var label = (r.voucher_type || '') + '-' + (r.voucher_no || payload.voucher_no);
        K.toast(label + ' · ' + F.money(payload.amount) + ' recorded', {
          collapse: 'entry',
          plural: function (n) { return n + ' entries recorded'; }
        });
        return load().then(keepComposerFocus);
      }).catch(function (e) {
        S.busy = false; btn.classList.remove('dc-btn--loading');
        K.toast('Could not reach the server. Press Save again — the entry cannot double up.');
      });
    }

    /* §A12: the form resets keeping Type/Mode/Direction, focus → Voucher #. */
    function keepComposerFocus() {
      var v = el('dc-voucher-no'); if (v) { v.value = ''; v.focus(); }
    }

    function voidEntry() {
      var id = el('dc-void-pick').value;
      return K.dialog({
        title: 'Void this entry',
        message: 'The entry is not deleted — it never can be. A reversing entry is written beside it and both stay on the day.',
        confirm: 'Void it',
        fields: [{ name: 'why', label: 'Why', required: true,
                   placeholder: 'Entered twice, wrong unit, cheque bounced…' }]
      }).then(function (v) {
        if (!v) return;
        return S.rpc('void_cash_entry', {
          p_company_id: S.me.companyId, p_entry_id: id, p_reason: v.why
        });
      }).then(function (r) {
        if (!r) return;
        if (r && r.success) { K.toast('Voided — a reversing entry was written'); return load(); }
        K.toast((r && r.message) || (r && r.error) || 'Could not void that entry');
      });
    }

    function uuid() {
      if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
    }

    load();
    return { reload: load, state: S };
  }

  global.DailyClosing = { mount: mount };
})(window);
