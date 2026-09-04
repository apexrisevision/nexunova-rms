/* ════════════════════════════════════════════════════════════════════════
   DAILY CLOSING — the scripted stand-in for the database  ·  P6
   ────────────────────────────────────────────────────────────────────────
   window.DCStub.make(state) returns { rpc, me, projects, calls }.

   WHY THIS EXISTS. A screen test should fail because the screen is wrong. If
   it talks to the real database it also fails when a row moved overnight,
   when a day was closed by hand, or when nobody is signed in — and then
   nobody trusts it. The RPC contract is already proved by the P3 and P4
   suites against the live schema; what is left to prove here is that the
   screen derives the right voucher, puts the right error under the right
   field, and draws the right state.

   `calls` records everything the screen sent, so a test can assert the
   idempotency key was reused on a retry rather than take it on trust.

   Answers match the real RPCs' jsonb shapes exactly. If the server contract
   changes, the P3/P4 suites catch it; this file is a mirror, not a source.
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var PJ = '6b56d5ec-6141-4440-9465-ed2a9acbbd97';
  var CO = 'a2915ce7-c01c-463b-ba50-b144b2240337';
  var A2020 = 'acc-2020', A6050 = 'acc-6050', A1010 = 'acc-1010', A1030 = 'acc-1030';

  function make(state) {
    var calls = [];
    var entries = [
      { id: 'e1', seq_no: 1, entry_type: 'CLIENT_RECEIPT', mode: 'CASH', direction: 'IN',
        voucher_type: 'CRV', voucher_no: '0041', amount: '150000.00',
        narration: 'Unit 915 · Installment #4', payee_name: 'Yousaf Khan',
        qb_number: '2020', qb_name: 'Advance from Customers',
        rms_status: 'PENDING', is_adjustment: false, is_voided: false, attachments: 1, created_at: '2026-09-03T09:10:00Z' },
      { id: 'e2', seq_no: 2, entry_type: 'EXPENSE', mode: 'CASH', direction: 'OUT',
        voucher_type: 'CPV', voucher_no: '0112', amount: '77000.00',
        narration: 'Electricity bill', payee_name: 'PESCO',
        qb_number: '6030', qb_name: 'Electricity & Utility Bills',
        rms_status: 'NA', is_adjustment: false, is_voided: false, attachments: 0, created_at: '2026-09-03T10:00:00Z' },
      { id: 'e3', seq_no: 3, entry_type: 'OTHER', mode: 'BANK', direction: 'IN',
        voucher_type: 'BRV', voucher_no: '0007', amount: '50000.00',
        narration: 'Cheque deposited', payee_name: 'Al-Habib Builders',
        qb_number: '2020', qb_name: 'Advance from Customers',
        rms_status: 'NA', is_adjustment: false, is_voided: false, attachments: 0, created_at: '2026-09-03T11:00:00Z' },
      { id: 'e4', seq_no: 4, entry_type: 'OTHER', mode: 'CASH', direction: 'IN',
        voucher_type: 'CRV', voucher_no: '0042', amount: '500.00',
        narration: 'Entered twice', payee_name: 'Zubair',
        rms_status: 'UNAPPLIED', is_adjustment: false, is_voided: true, reversal_id: 'e5', attachments: 0, created_at: '2026-09-03T12:00:00Z' },
      { id: 'e5', seq_no: 5, entry_type: 'OTHER', mode: 'CASH', direction: 'OUT',
        voucher_type: 'CPV', voucher_no: '0042-VOID', amount: '500.00',
        narration: 'Void of CRV-0042', payee_name: 'Zubair',
        rms_status: 'NA', is_adjustment: true, adjustment_reason: 'receipt entered twice',
        is_voided: false, attachments: 0, created_at: '2026-09-03T12:05:00Z' }
    ];

    var closedExtra = {
      id: 'a1', seq_no: 6, entry_type: 'OTHER', mode: 'CASH', direction: 'OUT',
      voucher_type: 'CPV', voucher_no: 'JV-2026-0001', amount: '3.00',
      narration: null, payee_name: 'A. Khan', rms_status: 'NA',
      is_adjustment: true, adjustment_reason: 'cashier short by 3, corrected next morning',
      is_voided: false, attachments: 0, created_at: '2026-09-04T08:30:00Z'   // AFTER closed_at
    };

    var day = {
      notopened: { success: true, exists: false, business_date: '2026-09-03', status: null },
      open: { success: true, exists: true, cash_day_id: 'day-1', business_date: '2026-09-03',
              status: 'OPEN', version: 0, opening_cash: '17723.00', opening_bank: '1000.00',
              in_cash: '150500.00', out_cash: '77500.00', in_bank: '50000.00', out_bank: '0.00',
              closing_cash: '90723.00', closing_bank: '51000.00',
              counted_cash: null, variance: null, variance_note: null, closed_at: null },
      closed: { success: true, exists: true, cash_day_id: 'day-1', business_date: '2026-09-03',
                status: 'CLOSED', version: 1, opening_cash: '17723.00', opening_bank: '1000.00',
                in_cash: '150500.00', out_cash: '77503.00', in_bank: '50000.00', out_bank: '0.00',
                closing_cash: '90723.00', closing_bank: '51000.00',
                counted_cash: '90720.00', variance: '-3.00', variance_note: 'short 3, cashier',
                closed_at: '2026-09-03T14:05:00Z' }
    }[state] || {};

    /* A test can script the next answer for ANY rpc — scriptNext(a) still
       means record_cash_entry, which is what P6 used, but close_cash_day
       needs the same thing to prove the VERSION_CONFLICT path. Each scripted
       answer is used once and then forgotten, so the following call goes back
       to the happy path without the test having to reset anything. */
    var next = {};
    function take(name) {
      if (!next[name]) return null;
      var a = next[name]; delete next[name]; return a;
    }

    var days = [
      { cash_day_id: 'day-1', business_date: '2026-09-03', status: 'CLOSED', is_setup_opening: false,
        closing_cash: '90723.00', closing_bank: '51000.00', variance: '-3.00',
        variance_note: 'short 3, cashier', entries: 6, pdf_version: 2, pdf_document_id: 'doc-2' },
      { cash_day_id: 'day-0', business_date: '2026-09-02', status: 'CLOSED', is_setup_opening: false,
        closing_cash: '17723.00', closing_bank: '1000.00', variance: '0.00',
        variance_note: null, entries: 4, pdf_version: 1, pdf_document_id: 'doc-1' },
      { cash_day_id: 'day-s', business_date: '2026-09-01', status: 'CLOSED', is_setup_opening: true,
        closing_cash: '10000.00', closing_bank: '1000.00', variance: '0.00',
        variance_note: null, entries: 0, pdf_version: null, pdf_document_id: null }
    ];

    function rpc(name, args) {
      calls.push({ name: name, args: args });
      var scripted = take(name);
      if (scripted) return Promise.resolve(scripted);
      switch (name) {
        case 'list_cash_days':
          return Promise.resolve({ success: true, days: days });
        case 'authorize_day_document':
          return Promise.resolve({ success: true, bucket: 'daily-closing',
            storage_key: 'pj/documents/2026-09-03/v2_Awami_Daily_Closing_2026-09-03.pdf',
            version: 2, expires_in: 600 });
        case 'close_cash_day':
          day = JSON.parse(JSON.stringify(day));
          day.status = 'CLOSED';
          day.version = Number(day.version || 0) + 1;
          day.counted_cash = String(args.p_counted_cash);
          day.variance = String(Number(args.p_counted_cash) - Number(day.closing_cash));
          day.variance_note = args.p_variance_note;
          day.closed_at = '2026-09-03T14:05:00Z';
          return Promise.resolve({ success: true, event: 'DayClosed', cash_day_id: 'day-1',
            business_date: '2026-09-03', closing_cash: day.closing_cash,
            closing_bank: day.closing_bank, counted_cash: day.counted_cash,
            variance: day.variance, denominations_total: null, denominations_match: true,
            version: day.version });
        case 'post_cash_adjustment':
          return Promise.resolve({ success: true, event: 'AdjustmentPosted', entry_id: 'adj-1' });
        case 'get_cash_day_summary':
          return Promise.resolve(day);
        case 'list_cash_entries':
          return Promise.resolve({ success: true, cash_day_id: 'day-1',
            business_date: '2026-09-03', status: day.status,
            entries: state === 'closed' ? entries.concat([closedExtra]) : entries });
        case 'list_payees':
          return Promise.resolve({ success: true, payees: [
            { id: 'p1', name: 'Yousaf Khan', is_active: true, last_used_at: '2026-09-03' },
            { id: 'p2', name: 'PESCO', is_active: true, last_used_at: '2026-09-03' },
            { id: 'p3', name: 'Sui Northern Gas', is_active: true, last_used_at: null },
            { id: 'p4', name: 'Al-Habib Builders', is_active: true, last_used_at: null }
          ]});
        case 'list_qb_accounts_for_project':
          return Promise.resolve({ success: true,
            accounts: [
              { id: A1010, number: '1010', name: 'Cash in Hand', qb_type: 'BANK' },
              { id: A1030, number: '1030', name: 'Bank Al-Habib - Awami', qb_type: 'BANK' },
              { id: A2020, number: '2020', name: 'Advance from Customers', qb_type: 'OCLIAB' },
              { id: A6050, number: '6050', name: 'Office Rent', qb_type: 'EXP' }
            ],
            defaults: { CLIENT_RECEIPT: A2020 },
            cash_accounts: [
              { cash_account_id: 'ca1', name: 'Cash in Hand', kind: 'CASH', qb_account_id: A1010 },
              { cash_account_id: 'ca2', name: 'Bank Al-Habib - Awami', kind: 'BANK', qb_account_id: A1030 }
            ]});
        case 'list_units_for_picker':
          return Promise.resolve({ success: true, units: [
            { id: 'u1', unit_no: '915' }, { id: 'u2', unit_no: '916' }, { id: 'u3', unit_no: 'G-02' }
          ]});
        case 'record_cash_entry':
          return Promise.resolve({ success: true, event: 'EntryRecorded', replayed: false,
            entry_id: 'new-' + calls.length, seq_no: entries.length + 1,
            voucher_type: (args.p_payload || {}).mode === 'BANK' ? 'BRV' : 'CRV',
            voucher_no: (args.p_payload || {}).voucher_no, rms_status: 'PENDING' });
        case 'open_cash_day':
          if (state === 'needsopening') {
            return Promise.resolve({ success: false, error: 'SETUP_OPENING_REQUIRED',
              message: 'Set the opening cash and bank balance before opening the first day.' });
          }
          day = { success: true, exists: true, cash_day_id: 'day-1', business_date: '2026-09-03',
                  status: 'OPEN', version: 0, opening_cash: '0.00', opening_bank: '0.00',
                  in_cash: '0.00', out_cash: '0.00', in_bank: '0.00', out_bank: '0.00',
                  closing_cash: '0.00', closing_bank: '0.00' };
          entries = [];
          return Promise.resolve({ success: true, event: 'DayOpened', cash_day_id: 'day-1' });
        case 'void_cash_entry':
          return Promise.resolve({ success: true, event: 'EntryVoided', reversal_id: 'r9' });
        case 'create_payee':
          return Promise.resolve({ success: true, payee_id: 'p-new' });
        case 'setup_cash_opening':
          return Promise.resolve({ success: true, event: 'OpeningSet' });
        default:
          return Promise.resolve({ success: true });
      }
    }

    /* The edge functions, scripted the same way. The screen calls these
       through an injected `fn`, so nothing here needs a network. */
    var fnNext = {};
    function fn(name, body) {
      calls.push({ name: 'fn:' + name, args: body });
      if (fnNext[name]) { var a = fnNext[name]; delete fnNext[name]; return Promise.resolve(a); }
      if (name === 'daily-closing-pdf') {
        pdfVersion += 1;
        return Promise.resolve({ success: true, event: 'DirectorPdfRendered',
          version: pdfVersion, typeface: 'Helvetica', bytes: 4677,
          filename: 'AwamiMarket_Daily_Closing_2026-09-03.pdf',
          storage_key: 'pj/documents/2026-09-03/v' + pdfVersion + '_AwamiMarket_Daily_Closing_2026-09-03.pdf',
          url: 'https://example.invalid/signed/v' + pdfVersion + '.pdf', expires_in: 600 });
      }
      if (name === 'daily-closing-file') {
        return Promise.resolve({ success: true, url: 'https://example.invalid/stored/doc.pdf',
          mime: 'application/pdf', expires_in: 600 });
      }
      return Promise.resolve({ success: true });
    }
    var pdfVersion = state === 'closed' ? 1 : 0;

    return {
      rpc: rpc, fn: fn, calls: calls,
      /* scriptNext({success:false, error:'DUPLICATE_VOUCHER', ...}) makes the
         next save answer that, so the inline-error path is testable. Pass a
         second argument to script a different RPC — close_cash_day, say. */
      scriptNext: function (a, forRpc) { next[forRpc || 'record_cash_entry'] = a; },
      scriptNextFn: function (a, forFn) { fnNext[forFn || 'daily-closing-pdf'] = a; },
      me: { companyId: CO, userId: 'u-cfo', role: 'cfo', isCfo: true, isAccountantPlus: true },
      projects: [{ id: PJ, name: 'Awami Market' }, { id: 'pj2', name: 'Khushal Bagh' }]
    };
  }

  global.DCStub = { make: make };
})(window);
