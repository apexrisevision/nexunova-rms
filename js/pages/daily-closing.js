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
      form: null, idemKey: null,
      view: ['days','audit'].indexOf(opts.view) >= 0 ? opts.view : 'day',  // S1, S3 or the audit tab
      days: null, audit: null, panel: null,
      // The Director PDF is rendered by an edge function, not an RPC, so the
      // host injects a caller the same way it injects `rpc`. In stub mode the
      // stub provides one; nothing here knows what a Supabase URL looks like.
      fn: opts.fn || null
    };
    root.classList.add('dc');

    /* ── WHAT THIS USER MAY DO IS THE SERVER'S ANSWER, NOT A GUESS ────────
       P6 read a role string out of the session and worked the rest out here.
       That is the wrong direction: §A10 says "UI hides, server enforces", and
       a UI that decides for itself drifts from the thing enforcing. The screen
       now ASKS — get_my_daily_closing_access — and every one of these flags is
       re-checked server-side on the call it guards anyway. They exist to draw
       the right buttons, not to be the rule. */
    S.access = null;
    S.dcRole = null;
    S.mayRecord = false;
    S.mayAudit = false;
    S.isCfo = false;
    S.isAccountantPlus = false;

    function applyAccess(a) {
      S.access = a || {};
      S.dcRole = S.access.role || null;
      S.mayRecord = !!S.access.may_record;
      S.mayAudit = !!S.access.may_audit;
      S.isCfo = !!S.access.may_close;
      S.isAccountantPlus = !!S.access.may_void;
    }

    /* ── data ─────────────────────────────────────────────────────────── */
    function loadDays() {
      render(true);
      return S.rpc('list_cash_days', {
        p_company_id: S.me.companyId, p_project_id: S.projectId, p_limit: 60
      }).then(function (r) {
        S.days = (r && r.days) || [];
        if (r && r.success === false) S.error = r.message || r.error;
        render(false);
      }).catch(function (e) { S.error = e && e.message; S.days = []; render(false); });
    }

    /* Access is re-read on every load, because it depends on the project and
       the project can change under the picker. */
    function loadAccess() {
      return S.rpc('get_my_daily_closing_access', {
        p_company_id: S.me.companyId, p_project_id: S.projectId
      }).then(applyAccess).catch(function () { applyAccess(null); });
    }

    function loadAudit() {
      render(true);
      return loadAccess().then(function () {
        if (!S.mayAudit) { S.audit = []; return render(false); }
        return S.rpc('get_cash_day_summary', {
          p_company_id: S.me.companyId, p_project_id: S.projectId, p_business_date: S.date
        }).then(function (r) {
          S.day = r || {};
          if (!S.day.exists) { S.audit = []; return; }
          return S.rpc('list_cash_day_audit', {
            p_company_id: S.me.companyId, p_cash_day_id: S.day.cash_day_id, p_limit: 200
          }).then(function (a) { S.audit = (a && a.events) || []; });
        }).then(function () { render(false); });
      }).catch(function (e) { S.error = e && e.message; S.audit = []; render(false); });
    }

    function load() {
      if (S.view === 'days') return loadDays();
      if (S.view === 'audit') return loadAudit();
      render(true);
      return loadAccess().then(function () {
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
      });
      }).then(function () { render(false); })
        .catch(function (e) { S.error = e && e.message; render(false); });
    }

    /* ── render ───────────────────────────────────────────────────────── */
    function render(loading) {
      root.innerHTML = header(loading) +
        (loading ? skeletonBody()
                 : (S.access && S.dcRole === null) ? noAccessBody()
                 : S.view === 'audit' ? auditBody()
                 : S.view === 'days' ? daysBody()
                 : !S.day || !S.day.exists ? notOpened()
                 : S.day.status === 'CLOSED' ? closedBody()
                 : openBody()) +
        '<div class="dc-toasts"></div>';
      if (!loading) wire();
    }

    /* The server said this person has no Daily Closing role at all. Saying so
       is better than an empty screen that looks broken. */
    function noAccessBody() {
      return '<div class="dc-card">' + K.emptyState({
        icon: 'lock',
        message: 'You do not have access to the cash book for this project. ' +
                 'Ask the CFO to grant it in Users & Roles.'
      }) + '</div>';
    }

    /* ── the audit tab (§A10) ──────────────────────────────────────────
       Reverse-chronological, for the CFO and the Directors. The before/after
       is whitelisted server-side — narration, payee and unit never come back,
       because the audit panel must not become the place where the client
       detail the Director PDF withholds turns up instead. */
    var AUDIT_LABEL = {
      cash_days: 'Day', cash_entries: 'Entry', day_documents: 'Sheet',
      cash_entry_attachments: 'Attachment', payees: 'Payee', qb_accounts: 'Account'
    };
    var AUDIT_VERB = { INSERT: 'created', UPDATE: 'changed', DELETE: 'deleted' };

    /* The whitelist is a list of column names, and a Director reading
       "counted_cash" is reading the database rather than the day. */
    var AUDIT_FIELD = {
      status: 'Status', closing_cash: 'Closing cash', closing_bank: 'Closing bank',
      counted_cash: 'Counted cash', variance: 'Variance', variance_note: 'Variance note',
      version: 'Version', closed_at: 'Closed at',
      opening_cash: 'Opening cash', opening_bank: 'Opening bank',
      is_voided: 'Voided', reversal_id: 'Reversal', rms_status: 'Allocation',
      qb_account_id: 'QB head', is_adjustment: 'Adjustment',
      is_active: 'Active', name: 'Name', kind: 'Kind',
      mime: 'File type', size_bytes: 'File size', number: 'Number'
    };
    function auditField(f) { return AUDIT_FIELD[f] || String(f).replace(/_/g, ' '); }

    function auditBody() {
      if (!S.mayAudit) {
        return '<div class="dc-card">' + K.emptyState({
          icon: 'lock',
          message: 'The audit trail is for the CFO and the Directors.' }) + '</div>';
      }
      if (!S.day || !S.day.exists) {
        return '<div class="dc-card">' + K.emptyState({
          message: 'No day on ' + F.dateShort(S.date) + ', so there is nothing to audit.' }) + '</div>';
      }
      if (!S.audit || !S.audit.length) {
        return '<div class="dc-card">' + K.emptyState({
          message: 'Nothing has happened on this day yet.' }) + '</div>';
      }
      return '<div class="dc-card"><ol class="dc-audit">' +
        S.audit.map(function (e) {
          var diff = e.diff || [];
          return '<li class="dc-audit-row">' +
            '<div class="dc-audit-when"><time datetime="' + esc(e.changed_at) + '">' +
              esc(F.time(e.changed_at)) + '</time>' +
              '<span class="dc-audit-date">' + esc(F.dateShort(e.changed_at)) + '</span></div>' +
            '<div class="dc-audit-what">' +
              '<div class="dc-audit-head">' +
                '<strong>' + esc(e.changed_by_name || 'Unknown') + '</strong>' +
                '<span class="dc-audit-role">' + esc(e.changed_by_role || '') + '</span>' +
                '<span>' + esc(AUDIT_VERB[e.action] || String(e.action).toLowerCase()) + ' ' +
                  esc((AUDIT_LABEL[e.table_name] || e.table_name).toLowerCase()) + '</span>' +
                (e.is_sensitive ? '<span class="dc-chip dc-chip--unapplied">sensitive</span>' : '') +
              '</div>' +
              (e.reason ? '<div class="dc-audit-reason">“' + esc(e.reason) + '”</div>' : '') +
              (diff.length ? '<div class="dc-audit-diff">' + diff.map(function (d) {
                return '<span class="dc-audit-field">' + esc(auditField(d.field)) + '</span>' +
                  '<span class="dc-audit-before">' + esc(auditVal(d.before)) + '</span>' +
                  '<span class="dc-audit-arrow" aria-hidden="true">→</span>' +
                  '<span class="dc-audit-after">' + esc(auditVal(d.after)) + '</span>';
              }).join('') + '</div>' : '') +
            '</div></li>';
        }).join('') + '</ol></div>';
    }

    function auditVal(v) {
      if (v === null || v === undefined) return '—';
      if (typeof v === 'boolean') return v ? 'yes' : 'no';
      if (typeof v === 'number') return F.amount(v);
      var s = String(v);
      // A money-shaped string reads better grouped; anything else stays as it is.
      return /^-?\d+(\.\d+)?$/.test(s) && s.length > 3 ? F.amount(Number(s)) : s;
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
          '<div class="dc-band-date" style="margin-top:8px">' +
            esc(S.view === 'days' ? 'The last 60 days' : F.dateLong(S.date)) + '</div>' +
        '</div>' +
        '<div class="dc-row-between" style="gap:12px">' +
          '<div class="dc-views" role="group" aria-label="View">' +
            '<button class="dc-btn" id="dc-view-day" type="button"' +
              (S.view === 'day' ? ' aria-current="true"' : '') + '>Day</button>' +
            '<button class="dc-btn" id="dc-view-days" type="button"' +
              (S.view === 'days' ? ' aria-current="true"' : '') + '>Days</button>' +
            // §A10 gives the audit to the CFO and the Directors. The tab is
            // simply not drawn for anybody else — and list_cash_day_audit
            // refuses them anyway, which is the part that counts.
            (S.mayAudit
              ? '<button class="dc-btn" id="dc-view-audit" type="button"' +
                (S.view === 'audit' ? ' aria-current="true"' : '') + '>Audit</button>' : '') +
          '</div>' +
          (S.view === 'day' || S.view === 'audit'
            ? '<input class="dc-input" id="dc-date" type="date" value="' + esc(S.date) +
              '" style="width:150px;height:32px" aria-label="Business date">' +
              (status ? K.statusChip(status) : '') +
              (status === 'OPEN' && S.isCfo && S.view === 'day'
                ? '<button class="dc-btn dc-btn--primary" id="dc-close" type="button">Close Day</button>' : '')
            : '') +
        '</div>' +
      '</div>' +
      (loading || S.view === 'days' ? '' : heroRow(d));
    }

    /* ── S3 · the Days list (§A12) ─────────────────────────────────────
       Sixty days, newest first. Every row opens that day in S1; a closed day
       with a rendered PDF offers it here, which is where a Director looks
       for last Tuesday's sheet rather than in a chat thread. */
    function daysBody() {
      if (S.days && !S.days.length) {
        return '<div class="dc-card">' + K.emptyState({
          message: 'No days recorded for this project yet.' }) + '</div>';
      }
      var rows = (S.days || []).map(function (d) {
        var v = Number(d.variance || 0);
        return '<tr tabindex="0" data-day="' + esc(d.business_date) + '">' +
          '<td style="white-space:nowrap">' + esc(F.dateShort(d.business_date)) +
            (d.is_setup_opening ? ' <span class="dc-days-tag">opening</span>' : '') + '</td>' +
          '<td>' + K.statusChip(d.status) + '</td>' +
          '<td class="dc-num dc-hide-sm">' + esc(d.entries || 0) + '</td>' +
          '<td class="dc-num">' + (d.closing_cash === null || d.closing_cash === undefined
            ? '<span class="dc-hint">—</span>' : esc(F.amount(d.closing_cash))) + '</td>' +
          '<td class="dc-num dc-hide-sm">' + (d.closing_bank === null || d.closing_bank === undefined
            ? '<span class="dc-hint">—</span>' : esc(F.amount(d.closing_bank))) + '</td>' +
          '<td class="dc-num' + (v ? ' dc-days-var' : '') + '">' +
            (v ? esc(F.amount(v)) : '') + '</td>' +
          '<td class="dc-linkcell">' + (d.pdf_document_id
            ? '<button type="button" class="dc-icon-btn" data-pdf="' + esc(d.pdf_document_id) + '"' +
              ' title="Director PDF v' + esc(d.pdf_version) + '"' +
              ' aria-label="Open the Director PDF for ' + esc(F.dateShort(d.business_date)) +
              ', version ' + esc(d.pdf_version) + '">' + K.icon('file', 15) + '</button>'
            : '') + '</td>' +
        '</tr>';
      }).join('');
      return '<div class="dc-card"><table class="dc-days">' +
        '<thead><tr><th>Date</th><th>Status</th><th class="dc-num dc-hide-sm">Entries</th>' +
          '<th class="dc-num">Closing cash</th><th class="dc-num dc-hide-sm">Closing bank</th>' +
          '<th class="dc-num">Variance</th><th></th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>';
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
      // A Director may look at a day that has not been opened; they may not be
      // the one to open it. Offering the button and then refusing the click
      // would be worse than not offering it.
      return '<div class="dc-card">' + K.emptyState({
        message: S.mayRecord
          ? 'No day open for ' + F.dateShort(S.date)
          : 'No day was opened on ' + F.dateShort(S.date) + '.',
        action: S.mayRecord ? 'Open day' : null,
        actionId: S.mayRecord ? 'dc-open' : null
      }) + '</div>';
    }

    /* ── composer + ledger ─────────────────────────────────────────────── */
    function openBody() {
      // §A10: the Director's row is read. No composer is drawn for them, and
      // the ledger takes the full width rather than leaving a hole where the
      // form would have been.
      if (!S.mayRecord) return '<div>' + ledger() + '</div>' + stickyTotals();
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

    /* §A12: "Ledger row actions (Accountant+): Void". P6 shipped a picker and
       a button because the kit had no popover; P7 adds the RowMenu and this
       is where it lands. A row already voided has no menu — its cell carries
       the link to its reversal instead, which is the more useful thing. */
    function actionsFor(e) {
      if (!S.isAccountantPlus) return null;
      if (e.is_voided || e.is_adjustment) return null;
      if (!S.day || S.day.status !== 'OPEN') return null;
      return [{ code: 'void', label: 'Void…', danger: true }];
    }

    function rowsFor(list) {
      return list.map(function (e) {
        return {
          id: e.id,
          seq: e.seq_no, voucherType: e.voucher_type, voucherNo: e.voucher_no,
          payee: e.payee_name, narration: e.narration,
          in: e.direction === 'IN' ? Number(e.amount) : 0,
          out: e.direction === 'OUT' ? Number(e.amount) : 0,
          voided: !!e.is_voided, reversalId: e.reversal_id,
          actions: actionsFor(e)
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
      return K.ledgerTable({ rows: ledgerRows(), totals: t });
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
            '<button class="dc-btn dc-btn--primary" id="dc-pdf" type="button">Director PDF</button>' +
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
      if (p) p.addEventListener('change', function () {
        S.projectId = p.value; S.day = null; S.days = null; load();
      });
      var dt = el('dc-date');
      if (dt) dt.addEventListener('change', function () { S.date = dt.value; S.day = null; load(); });

      var vd = el('dc-view-day');
      if (vd) vd.addEventListener('click', function () { setView('day'); });
      var vs = el('dc-view-days');
      if (vs) vs.addEventListener('click', function () { setView('days'); });
      var va = el('dc-view-audit');
      if (va) va.addEventListener('click', function () { setView('audit'); });

      if (S.view === 'days') return wireDays();
      if (S.view === 'audit') return;          // the audit tab is a list, not a form

      var open = el('dc-open');
      if (open) open.addEventListener('click', openDay);

      // One delegated binding for every row menu on the screen, in both the
      // open and the closed body.
      K.bindRowMenus(root, function (code, rowId) {
        if (code === 'void') voidEntry(rowId);
      });

      if (!S.day || !S.day.exists || S.day.status !== 'OPEN') return wireClosed();
      if (!S.mayRecord) return;                // a Director gets the ledger, not the form

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

      var c = el('dc-close');
      if (c) c.addEventListener('click', openClosePanel);
    }

    function wireClosed() {
      var c = el('dc-close');
      if (c) c.addEventListener('click', openClosePanel);
      var a = el('dc-adjust');
      if (a) a.addEventListener('click', addAdjustment);
      var pd = el('dc-pdf');
      if (pd) pd.addEventListener('click', function () { openPdf({ regenerate: false }); });
    }

    function setView(v) {
      if (S.view === v) return;
      S.view = v;
      if (v === 'days') { S.days = null; return loadDays(); }
      if (v === 'audit') { S.audit = null; return loadAudit(); }
      return load();
    }

    function wireDays() {
      Array.prototype.forEach.call(root.querySelectorAll('.dc-days tbody tr'), function (tr) {
        function go() { S.date = tr.getAttribute('data-day'); S.view = 'day'; S.day = null; load(); }
        tr.addEventListener('click', function (e) {
          if (e.target.closest('[data-pdf]')) return;   // the PDF button is not the row
          go();
        });
        tr.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
        });
      });
      Array.prototype.forEach.call(root.querySelectorAll('[data-pdf]'), function (b) {
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          openStoredDocument(b.getAttribute('data-pdf'));
        });
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


    /* ════════════════════════════════════════════════════════════════════
       S2 · the close panel  ·  §A12
       ────────────────────────────────────────────────────────────────────
       The one screen in this module where a person is asked to reconcile
       something. It shows what the book says the drawer holds, lets the
       cashier count it in notes, and refuses to close until any difference
       has a sentence attached to it.

       Three rules it is built around:

       1 · The BUTTON IS DISABLED until the count is valid — but the server
           still refuses on its own (VARIANCE_UNEXPLAINED). The disabled
           button is a courtesy; `close_cash_day` is the rule.
       2 · The VERSION READ IS SENT BACK. If an entry landed while the notes
           were being counted, the close is refused with VERSION_CONFLICT and
           this panel reloads the day in place, keeping the count typed so
           far. Nobody recounts a drawer because of a race.
       3 · The denomination breakdown is REPORTED, NOT ENFORCED (the server
           says so too). A drawer holds coins; the counted figure may be
           typed over the notes total, and if the two disagree the panel says
           so rather than blocking.
       ════════════════════════════════════════════════════════════════════ */
    function openClosePanel() {
      if (!S.day || !S.day.exists) return;
      if (S.day.status === 'CLOSED') return openPdf({ regenerate: false });

      var st = { counted: null, typed: false, note: '', busy: false, msg: null };

      S.panel = K.sidePanel({
        title: 'Close the day',
        subtitle: F.dateLong(S.date) + ' · ' + projectName(),
        onClose: function () { S.panel = null; }
      });
      paint();
      S.panel.focusFirst();

      function expected() { return Number(S.day.closing_cash || 0); }
      function variance() {
        return st.counted === null ? null : F.round2(st.counted - expected());
      }
      function valid() {
        if (st.counted === null) return false;
        if (st.counted < 0) return false;
        var v = variance();
        return v === 0 || !!st.note.trim();
      }

      function paint() {
        var v = variance();
        S.panel.setBody(
          (st.msg ? '<div class="dc-variance" role="alert" style="margin-bottom:16px">' +
            K.icon('alert', 18) + '<div class="dc-variance-body"><div class="dc-variance-title">' +
            esc(st.msg) + '</div></div></div>' : '') +
          '<div class="dc-count-pair">' +
            K.heroFigure({ label: 'Book says', value: expected(), id: 'dc-cp-exp' }) +
            K.heroFigure({ label: 'Counted', value: st.counted === null ? 0 : st.counted,
                           tone: v === 0 ? 'in' : (v === null ? null : 'warn'), id: 'dc-cp-cnt' }) +
          '</div>' +
          '<label class="dc-label">Count the drawer</label>' +
          K.denominationCounter({ id: 'dc-den' }) +
          // The counter above already ends on a row that says 'Counted'. Naming
          // this one 'Counted cash' printed the same word twice, one line
          // apart, for two different things. This is the figure that gets
          // recorded, so it says so.
          K.moneyInput({ id: 'dc-counted', label: 'Recorded as',
            value: st.counted === null ? '' : String(st.counted),
            hint: 'Fills in from the notes above. Type over it if the drawer holds coins.' }) +
          /* A SLOT, not a branch inside the panel body. Re-rendering the
             panel when the banner appears would destroy the field being
             typed into — after the first digit of "90000" the variance is
             already non-zero, so a repaint would eat the other four
             keystrokes. Only the slot is ever replaced. */
          '<div id="dc-var-slot" data-v="' + (v === null ? 'none' : v === 0 ? 'zero' : 'var') +
            '">' + varSlot(v) + '</div>' +
          '<div class="dc-panel-foot">' +
            '<button type="button" class="dc-btn" data-cancel>Cancel</button>' +
            '<button type="button" class="dc-btn dc-btn--primary" id="dc-do-close"' +
              (valid() && !st.busy ? '' : ' disabled') + '>Close the day</button>' +
          '</div>');
        wirePanel();
      }

      function varSlot(v) {
        if (v === null) return '';
        if (v === 0) return '<div class="dc-hint" style="margin-top:8px">' +
          'The count agrees with the book.</div>';
        return K.varianceBanner({ id: 'dc-var', variance: v });
      }

      function wirePanel() {
        var body = S.panel.body;
        var counted = body.querySelector('#dc-counted');
        K.bindMoneyInput(counted);

        K.bindDenominationCounter(body.querySelector('#dc-den'), function (total) {
          // The notes drive the figure until the CFO types over it; after that
          // the typed figure is theirs and the counter stops overwriting it.
          if (st.typed) return;
          st.counted = total;
          counted.value = total ? F.maskMoney(String(total)) : '';
          refresh();
        });

        counted.addEventListener('input', function () {
          st.typed = true;
          var n = F.parseMoney(counted.value);
          st.counted = (n === null || isNaN(n)) ? null : n;
          refresh();
        });

        bindNote();
        body.querySelector('[data-cancel]').addEventListener('click', function () { S.panel.close(); });
        body.querySelector('#dc-do-close').addEventListener('click', confirmClose);
      }

      function bindNote() {
        var note = S.panel.body.querySelector('#dc-var-r');
        if (!note) return;
        note.value = st.note;
        note.addEventListener('input', function () { st.note = note.value; refresh(); });
      }

      /* Update only what moved: the counted figure, the button, and the
         variance slot. Never the fields themselves. */
      function refresh() {
        var body = S.panel.body, v = variance();

        var cnt = body.querySelector('#dc-cp-cnt');
        if (cnt) {
          cnt.textContent = F.money(st.counted === null ? 0 : st.counted);
          var wrap = cnt.parentNode;
          wrap.className = 'dc-hero' + (v === 0 ? ' dc-hero--in' : v === null ? '' : ' dc-hero--warn');
        }

        var slot = body.querySelector('#dc-var-slot');
        var was = slot.getAttribute('data-v');
        var now = v === null ? 'none' : v === 0 ? 'zero' : 'var';
        if (was !== now) {
          slot.setAttribute('data-v', now);
          slot.innerHTML = varSlot(v);
          bindNote();
        } else if (now === 'var') {
          var t = body.querySelector('#dc-var-t');
          if (t) t.textContent = 'Variance ' + F.amount(v) + ' — the drawer is ' +
            (v < 0 ? 'short' : 'over');
        }

        var btn = body.querySelector('#dc-do-close');
        if (btn) btn.disabled = !valid() || st.busy;
      }

      function confirmClose() {
        var v = variance();
        return K.dialog({
          title: 'Close ' + F.dateShort(S.date) + '?',
          message: v === 0
            ? 'Nothing on a closed day can be edited. A correction after this becomes an adjustment, and it shows as one.'
            : 'The drawer is ' + (v < 0 ? 'short' : 'over') + ' by ' + F.money(Math.abs(v)) +
              '. That difference is recorded with your reason and appears on the Director PDF.',
          confirm: 'Close the day'
        }).then(function (go) {
          if (!go) return;
          return doClose();
        });
      }

      function doClose() {
        st.busy = true; st.msg = null;
        var btn = S.panel.body.querySelector('#dc-do-close');
        if (btn) { btn.disabled = true; btn.classList.add('dc-btn--loading'); }

        return S.rpc('close_cash_day', {
          p_company_id: S.me.companyId, p_cash_day_id: S.day.cash_day_id,
          p_counted_cash: st.counted,
          p_denominations: denomsFromPanel(),
          p_variance_note: st.note.trim() || null,
          p_version: S.day.version
        }).then(function (r) {
          st.busy = false;
          if (r && r.success) return afterClose(r);

          if (r && r.error === 'VERSION_CONFLICT') {
            // Reload the day underneath, keep the count, tell them what moved.
            return load().then(function () {
              st.msg = 'An entry landed while you were counting. The book now says ' +
                       F.money(expected()) + ' — check your count and close again.';
              paint();
            });
          }
          st.msg = (r && r.message) || (r && r.error) || 'The day could not be closed.';
          paint();
          if (r && r.error === 'VARIANCE_UNEXPLAINED') {
            var n = S.panel.body.querySelector('#dc-var-r');
            if (n) n.focus();
          }
        }).catch(function () {
          st.busy = false;
          st.msg = 'Could not reach the server. Nothing was closed — try again.';
          paint();
        });
      }

      function denomsFromPanel() {
        var out = {}, any = false;
        K.FACES.forEach(function (f) {
          var i = S.panel.body.querySelector('[data-face="' + f + '"]');
          var n = i ? (parseInt(String(i.value).replace(/[^0-9]/g, ''), 10) || 0) : 0;
          if (n) { out[f] = n; any = true; }
        });
        return any ? out : null;
      }

      /* §A12: "Closed · PDF ready", with Download and Share. The PDF is
         rendered here rather than on a later click, because a Director
         expects the sheet to exist the moment the day is closed. */
      function afterClose(r) {
        S.panel.setBody('<div class="dc-done">' +
          '<div class="dc-done-t">Closed · rendering the sheet…</div>' +
          '<div class="dc-done-sub">Closing cash ' + esc(F.money(r.closing_cash)) +
            ' · bank ' + esc(F.money(r.closing_bank)) + '</div></div>');

        return renderPdf().then(function (pdf) {
          return load().then(function () { donePanel(r, pdf); });
        });
      }

      function donePanel(r, pdf) {
        if (!S.panel) return;
        var mismatch = r.denominations_match === false;
        S.panel.setBody('<div class="dc-done">' +
          '<div class="dc-done-t">Closed · ' + (pdf ? 'PDF ready' : 'PDF not rendered') + '</div>' +
          '<div class="dc-done-sub">' + esc(F.dateLong(S.date)) + ' · closing cash ' +
            esc(F.money(r.closing_cash)) + ' · bank ' + esc(F.money(r.closing_bank)) +
            (Number(r.variance) ? ' · variance ' + esc(F.amount(r.variance)) : '') +
            (pdf ? ' · v' + esc(pdf.version) : '') + '</div>' +
          (mismatch ? '<div class="dc-hint" style="margin-top:12px">The notes counted came to ' +
            esc(F.money(r.denominations_total)) + ', not ' + esc(F.money(r.counted_cash)) +
            '. The counted figure is what was recorded.</div>' : '') +
          (pdf ? '<div class="dc-done-actions">' +
              '<a class="dc-btn dc-btn--primary" id="dc-dl" href="' + esc(pdf.url) + '"' +
                ' download="' + esc(pdf.filename) + '" target="_blank" rel="noopener">' +
                K.icon('down', 15) + ' Download</a>' +
              '<button type="button" class="dc-btn" id="dc-share">' +
                K.icon('share', 15) + ' Share</button>' +
            '</div>' +
            '<div class="dc-hint" style="margin-top:12px">The link works for ten minutes.</div>'
            : '<div class="dc-hint" style="margin-top:12px">The day is closed. Render the sheet ' +
              'again from the Director PDF button.</div>') +
        '</div>');

        var sh = S.panel.body.querySelector('#dc-share');
        if (sh) sh.addEventListener('click', function () { sharePdf(pdf); });
      }
    }

    function projectName() {
      var p = S.projects.filter(function (x) { return x.id === S.projectId; })[0];
      return (p && p.name) || '';
    }

    /* ── the Director PDF ────────────────────────────────────────────────
       Rendered by the daily-closing-pdf edge function. It takes the version
       itself (get_cash_day_pdf_data computes next_version under the same
       read), so calling it twice makes v2 rather than overwriting v1 — which
       is exactly what a regeneration after an adjustment must do. */
    function renderPdf() {
      if (!S.fn) return Promise.resolve(null);
      return S.fn('daily-closing-pdf', {
        company_id: S.me.companyId, cash_day_id: S.day.cash_day_id
      }).then(function (r) {
        if (r && r.success) return r;
        K.toast((r && r.error) === 'STORAGE_FAILED'
          ? 'The sheet could not be filed. The day is still closed.'
          : 'The sheet could not be rendered. The day is still closed.');
        return null;
      }).catch(function () {
        K.toast('The sheet could not be rendered. The day is still closed.');
        return null;
      });
    }

    function openPdf(o) {
      if (!S.day || !S.day.exists || S.day.status !== 'CLOSED') return;
      var btn = el('dc-pdf');
      if (btn) btn.classList.add('dc-btn--loading');
      return renderPdf().then(function (pdf) {
        if (btn) btn.classList.remove('dc-btn--loading');
        if (!pdf) return;
        K.toast('Director PDF v' + pdf.version + ' ready');
        openLink(pdf.url);
      });
    }

    /* A stored version, from the Days list — no re-render, no new version. */
    function openStoredDocument(documentId) {
      return S.rpc('authorize_day_document', {
        p_company_id: S.me.companyId, p_document_id: documentId
      }).then(function (r) {
        if (!r || !r.success) {
          return K.toast((r && r.message) || (r && r.error) || 'That document is not available.');
        }
        if (!S.fn) return K.toast('Opening a stored sheet needs the file bridge.');
        return S.fn('daily-closing-file', {
          op: 'read-url', company_id: S.me.companyId, document_id: documentId,
          storage_key: r.storage_key
        }).then(function (f) {
          if (f && f.success && f.url) return openLink(f.url);
          K.toast('That document could not be opened.');
        });
      });
    }

    function openLink(url) {
      if (!url) return;
      var a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
    }

    /* §A12's Share is the browser's own share sheet where there is one, and a
       copied link where there is not. Sending it on WhatsApp is Phase 4 and
       is deliberately NOT wired here. */
    function sharePdf(pdf) {
      if (!pdf) return;
      var text = projectName() + ' · Daily Closing · ' + F.dateShort(S.date);
      if (global.navigator && navigator.share) {
        return navigator.share({ title: pdf.filename, text: text, url: pdf.url })
          .catch(function () {});
      }
      if (global.navigator && navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(pdf.url).then(function () {
          K.toast('Link copied — it works for ten minutes');
        }).catch(function () { openLink(pdf.url); });
      }
      openLink(pdf.url);
    }

    /* ── a post-close adjustment (§A12) ──────────────────────────────────
       Same shape as the void: a reason is not optional, and the sheet is
       re-rendered afterwards at the NEXT version, with the earlier one kept.
       A Director who already has v1 in hand can be told what changed. */
    function addAdjustment() {
      if (!S.isCfo) return K.toast('Only the CFO may post an adjustment.');
      return K.dialog({
        title: 'Adjustment on a closed day',
        message: 'The day stays closed. This is written as its own entry, appears in its own block on the sheet, and the sheet is re-issued at the next version.',
        confirm: 'Post the adjustment',
        fields: [
          { name: 'mode', label: 'Cash or bank', type: 'select', options: [
            { value: 'CASH', label: 'Cash' }, { value: 'BANK', label: 'Bank' }] },
          { name: 'dir', label: 'In or out', type: 'select', options: [
            { value: 'IN', label: 'In' }, { value: 'OUT', label: 'Out' }] },
          { name: 'amount', label: 'Amount', type: 'money', required: true },
          { name: 'reason', label: 'Reason', required: true,
            placeholder: 'Why the closed day has to move' }
        ]
      }).then(function (v) {
        if (!v) return;
        return S.rpc('post_cash_adjustment', {
          p_company_id: S.me.companyId, p_cash_day_id: S.day.cash_day_id,
          p_payload: { mode: v.mode, direction: v.dir, amount: v.amount, narration: v.reason },
          p_reason: v.reason
        }).then(function (r) {
          if (!r || !r.success) {
            return K.toast((r && r.message) || (r && r.error) || 'The adjustment was not posted.');
          }
          K.toast('Adjustment posted — re-issuing the sheet');
          return renderPdf().then(function (pdf) {
            return load().then(function () {
              if (pdf) K.toast('Director PDF v' + pdf.version + ' ready');
            });
          });
        });
      });
    }

    function voidEntry(id) {
      if (!id) return;
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

  /* ══════════════════════════════════════════════════════════════════════
     THE SHELL ADAPTER  ·  P8
     ──────────────────────────────────────────────────────────────────────
     nav('dailyclosing') calls window.rDailyClosing(). Everything above this
     line still knows nothing about RMS's globals — the component takes `rpc`,
     `fn` and `me` as arguments, which is why the same file runs under the
     stub with no database at all. THIS is the only part that reaches for S,
     supabase and the session, and it is thirty lines long on purpose.

     It re-mounts on every navigation rather than caching a handle, because
     the project switcher and the date both live inside the component and a
     stale mount would show yesterday to somebody who has just switched
     tenant.
     ══════════════════════════════════════════════════════════════════════ */
  global.rDailyClosing = function rDailyClosing() {
    var host = document.getElementById('pg-dailyclosing');
    if (!host) return;

    // Belt and braces with nav()'s own gate: default-CLOSED, explicit true.
    if (!(global._featureFlags && global._featureFlags.daily_closing === true)) {
      host.innerHTML = '';
      return;
    }

    var sess = global.S || {};
    function rpc(name, args) {
      return global.supabase.rpc(name, args).then(function (r) {
        if (r.error) throw new Error(r.error.message);
        return r.data;
      });
    }
    function fn(name, body) {
      return global.supabase.auth.getSession().then(function (s) {
        var token = s && s.data && s.data.session && s.data.session.access_token;
        if (!token) throw new Error('no session');
        return fetch(SUPABASE_URL + '/functions/v1/' + name, {
          method: 'POST',
          headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token,
                     'Content-Type': 'application/json' },
          body: JSON.stringify(body || {})
        }).then(function (r) { return r.json(); });
      });
    }

    // The shell's own project list, already filtered to what this user may
    // pick (_selectableProjects → hasProjectAccess). That filter is a
    // convenience: every project id sent from here is re-checked by
    // _dc_may_view on the server, and the component asks the server which
    // projects it may see as well.
    var raw = (typeof _selectableProjects === 'function')
      ? _selectableProjects()
      : (global._projectsCache || []);
    var projects = raw.map(function (p) {
      return { id: p.id, name: p.project_name || p.name || p.id };
    });

    // The project the rest of RMS is currently looking through, if it is one
    // this user can use — so arriving from Units on Awami lands on Awami.
    var active = (typeof activeProjectId === 'function') ? activeProjectId() : null;
    var start = projects.filter(function (p) { return p.id === active; })[0];

    host.innerHTML = '';
    mount(host, {
      rpc: rpc, fn: fn,
      me: { companyId: sess.cid, userId: sess.userId, role: String(sess.role || '').toLowerCase() },
      projects: projects,
      projectId: (start || projects[0] || {}).id || null,
      date: F.todayPK()
    });
  };
})(window);
