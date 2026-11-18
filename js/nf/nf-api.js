/**
 * NexuFinance v1 — the ONLY file that calls supabase.rpc. window.NfApi.
 *
 * Every call asserts its own argument shape before sending (an `undefined`
 * value is silently dropped by JSON.stringify and turns into a differently
 * shaped request — see rms_anon_rpc / SR-9 in the daily-closing history).
 * A refusal from the database (`RAISE EXCEPTION '%%', 'NF:CODE' USING
 * DETAIL = …`) arrives as `error.message === 'NF:CODE'` and
 * `error.details === '<the DETAIL text, often JSON>'`; make(name) normalises
 * that into `{code, detail, raw}` and throws it, so callers can switch on
 * `.code` without re-parsing PostgREST's error shape everywhere.
 */
(function (global) {
  'use strict';

  function build(sb) {
    if (!sb || typeof sb.rpc !== 'function') {
      throw new Error('NfApi.build: no working Supabase client was given');
    }

    function call(name, args) {
      args = args || {};
      var missing = [];
      Object.keys(args).forEach(function (k) { if (args[k] === undefined) missing.push(k); });
      if (missing.length) {
        return Promise.reject(new Error('Cannot call ' + name + ' — ' + missing.join(', ') +
          ' missing. This is a fault in the app, not a permission problem.'));
      }
      return sb.rpc(name, args).then(function (r) {
        if (r.error) {
          var code = r.error.message || 'NF:UNKNOWN';
          var detail = r.error.details || null;
          var parsed = detail;
          if (typeof detail === 'string') {
            try { parsed = JSON.parse(detail); } catch (e) { parsed = detail; }
          }
          var err = new Error(code);
          err.code = code;
          err.detail = parsed;
          err.raw = r.error;
          throw err;
        }
        return r.data;
      });
    }

    return {
      // reading
      getContext: function () { return call('nf_get_context', {}); },
      listHeads: function (companyId) { return call('nf_list_heads', { p_company_id: companyId }); },
      listFloors: function (companyId) { return call('nf_list_floors', { p_company_id: companyId }); },
      listVias: function (companyId) { return call('nf_list_vias', { p_company_id: companyId }); },
      listDays: function (companyId, from, to) {
        return call('nf_list_days', { p_company_id: companyId, p_from: from || null, p_to: to || null });
      },
      getDay: function (companyId, date) { return call('nf_get_day', { p_company_id: companyId, p_date: date || null }); },
      listAudit: function (dayId) { return call('nf_list_audit', { p_day_id: dayId }); },

      // starting a day
      startFirstDay: function (companyId, date, closingNo, openCash, openPetty, openBank) {
        return call('nf_start_first_day', {
          p_company_id: companyId, p_date: date, p_closing_no: closingNo,
          p_open_cash: openCash, p_open_petty: openPetty, p_open_bank: openBank,
        });
      },
      startNextDay: function (companyId, date) { return call('nf_start_next_day', { p_company_id: companyId, p_date: date || null }); },
      setFirstDayOpening: function (dayId, cash, petty, bank, version) {
        return call('nf_set_first_day_opening', { p_day_id: dayId, p_open_cash: cash, p_open_petty: petty, p_open_bank: bank, p_version: version });
      },

      // lines
      saveLine: function (dayId, lineId, side, voucherNo, description, head, floor, via, amount, version, partyName) {
        return call('nf_save_line', {
          p_day_id: dayId, p_line_id: lineId || null, p_side: side, p_voucher_no: voucherNo,
          p_description: description || null, p_head: head, p_floor: floor, p_via: via,
          p_amount: amount, p_version: version === undefined ? null : version,
          p_party_name: partyName || null,
        });
      },
      deleteLine: function (lineId, version) { return call('nf_delete_line', { p_line_id: lineId, p_version: version }); },

      // the rest of the sheet
      setTransfers: function (dayId, toBank, toPetty, version) {
        return call('nf_set_transfers', { p_day_id: dayId, p_to_bank: toBank, p_to_petty: toPetty, p_version: version });
      },
      setRemarks: function (dayId, remarks, version) { return call('nf_set_remarks', { p_day_id: dayId, p_remarks: remarks, p_version: version }); },

      // PDCs
      savePdc: function (dayId, pdcId, direction, chequeNo, party, bank, dueDate, amount, version) {
        return call('nf_save_pdc', {
          p_day_id: dayId, p_pdc_id: pdcId || null, p_direction: direction, p_cheque_no: chequeNo,
          p_party: party || null, p_bank: bank || null, p_due_date: dueDate, p_amount: amount,
          p_version: version === undefined ? null : version,
        });
      },
      resolvePdc: function (dayId, pdcId, status, version) {
        return call('nf_resolve_pdc', { p_day_id: dayId, p_pdc_id: pdcId, p_status: status, p_version: version });
      },
      deletePdc: function (pdcId, version) { return call('nf_delete_pdc', { p_pdc_id: pdcId, p_version: version }); },

      // state
      submitDay: function (dayId, version) { return call('nf_submit_day', { p_day_id: dayId, p_version: version }); },
      closeDay: function (dayId, version, varianceReason) {
        return call('nf_close_day', { p_day_id: dayId, p_version: version, p_variance_reason: varianceReason || null });
      },
      returnDay: function (dayId, reason, version) { return call('nf_return_day', { p_day_id: dayId, p_reason: reason, p_version: version }); },
      reopenDay: function (dayId, reason, version) { return call('nf_reopen_day', { p_day_id: dayId, p_reason: reason, p_version: version }); },

      // report (Phase 3 — exposed here so it isn't re-plumbed later)
      getReport: function (dayId) { return call('nf_get_report', { p_day_id: dayId }); },
      getJournal: function (companyId, from, to) {
        return call('nf_get_journal', { p_company_id: companyId, p_from: from || null, p_to: to || null });
      },
      listAllAccounts: function (companyId) { return call('nf_list_all_accounts', { p_company_id: companyId }); },
      getLedger: function (companyId, accountCode, from, to) {
        return call('nf_get_ledger', { p_company_id: companyId, p_account_code: accountCode, p_from: from || null, p_to: to || null });
      },
      getTrialBalance: function (companyId, asOf) { return call('nf_get_trial_balance', { p_company_id: companyId, p_as_of: asOf || null }); },
      getPL: function (companyId, from, to) {
        return call('nf_get_pl', { p_company_id: companyId, p_from: from || null, p_to: to || null });
      },
      getBalanceSheet: function (companyId, asOf) {
        return call('nf_get_balance_sheet', { p_company_id: companyId, p_as_of: asOf || null });
      },
      listAllParties: function (companyId) { return call('nf_list_all_parties', { p_company_id: companyId }); },

      // journal vouchers — the entry path for anything that is NOT a cash or
      // bank movement (docs/PLAN.md §32.1). p_legs is an array of
      // { account_code, floor_code, debit | credit, memo?, party_name? };
      // nf_jv_save resolves party_name the same way nf_save_line does and
      // always posts with day_id NULL, so a JV can never land inside a daily
      // closing.
      jvList: function (companyId, from, to) {
        return call('nf_jv_list', { p_company_id: companyId, p_from: from || null, p_to: to || null });
      },
      jvSave: function (companyId, voucherNo, date, narration, legs) {
        return call('nf_jv_save', {
          p_company_id: companyId, p_voucher_no: voucherNo, p_voucher_date: date,
          p_narration: narration || null, p_legs: legs,
        });
      },
      jvDelete: function (voucherId, version) { return call('nf_jv_delete', { p_voucher_id: voucherId, p_version: version }); },
      // only the MANUAL (paper) voucher number, on a cash-book line or a JV —
      // the Close day dialog fills the missing ones through it (docs/PLAN.md §45)
      // the daily WhatsApp report: site | ho | combined — the site login always gets site (docs/PLAN.md §51)
      dayReport: function (companyId, date, view) { return call('nf_day_report', { p_company_id: companyId, p_date: date, p_view: view }); },
      // one date's cash & bank book for the director's Excel (docs/PLAN.md §50)
      dayBook: function (companyId, date) { return call('nf_day_book', { p_company_id: companyId, p_date: date }); },
      // the other login may already have booked this (docs/PLAN.md §50): { block: [...], warn: [...] }
      checkDuplicate: function (companyId, kind, via, head, amount, description, partyName, date) {
        return call('nf_dup_check', { p_company_id: companyId, p_kind: kind, p_via: via, p_head: head || null, p_amount: amount,
          p_description: description || '', p_party_name: partyName || null, p_date: date, p_exclude: null });
      },
      setManualNo: function (voucherId, manualNo, version) { return call('nf_set_manual_no', { p_voucher_id: voucherId, p_manual_no: manualNo, p_version: version }); },
      getPartyStatement: function (companyId, partyId, from, to) {
        return call('nf_get_party_statement', { p_company_id: companyId, p_party_id: partyId, p_from: from || null, p_to: to || null });
      },
      getTokenRegister: function (companyId, from, to) {
        return call('nf_get_token_register', { p_company_id: companyId, p_from: from || null, p_to: to || null });
      },
      // Token / receipt numbers used, used twice, missing (20261007b)
      getReceiptRegister: function (companyId, from, to) {
        return call('nf_get_receipt_register', { p_company_id: companyId, p_from: from || null, p_to: to || null });
      },
      // Group companies (22000) and directors (12600): who owes whom
      getGroupBalances: function (companyId, from, to) {
        return call('nf_get_group_balances', { p_company_id: companyId, p_from: from || null, p_to: to || null });
      },
      getCashBankMovement: function (companyId, from, to) {
        return call('nf_get_cash_bank_movement', { p_company_id: companyId, p_from: from || null, p_to: to || null });
      },
      getFloorSummary: function (companyId, from, to) {
        return call('nf_get_floor_summary', { p_company_id: companyId, p_from: from || null, p_to: to || null });
      },
      getProjectCostSummary: function (companyId, from, to) {
        return call('nf_get_project_cost_summary', { p_company_id: companyId, p_from: from || null, p_to: to || null });
      },
      getMonthlyTrend: function (companyId, from, to) {
        return call('nf_get_monthly_trend', { p_company_id: companyId, p_from: from || null, p_to: to || null });
      },

      // ── Site Closing (docs/SITE_CLOSING_SPEC.md) ──
      // the site accountant's own day
      siteGetDay: function (companyId, date) { return call('nf_site_get_day', { p_company_id: companyId, p_business_date: date }); },
      siteListDays: function (companyId, from, to) {
        return call('nf_site_list_days', { p_company_id: companyId, p_from: from || null, p_to: to || null });
      },
      siteListHeads: function (companyId) { return call('nf_site_list_heads', { p_company_id: companyId }); },
      siteListUnits: function (companyId) { return call('nf_site_list_units', { p_company_id: companyId }); },
      siteSaveLine: function (companyId, date, lineId, line, version) {
        return call('nf_site_save_line', {
          p_company_id: companyId, p_business_date: date, p_line_id: lineId || null, p_side: line.side,
          p_doc_no: line.doc_no || null, p_party_name: line.party_name || null, p_unit_codes: line.unit_codes || null,
          p_token_no: line.token_no === '' || line.token_no === null || line.token_no === undefined ? null : Number(line.token_no),
          p_head_code: line.head_code, p_via: line.via, p_amount: line.amount,
          p_bank_ref: line.bank_ref || null, p_remarks: line.remarks || null, p_attachment_url: line.attachment_url || null,
          p_version: version === undefined ? null : version,
        });
      },
      siteDeleteLine: function (lineId, version) { return call('nf_site_delete_line', { p_line_id: lineId, p_version: version }); },
      siteSubmit: function (siteDayId, counted, denominations, varianceReason, version) {
        return call('nf_site_submit', {
          p_site_day_id: siteDayId, p_counted_cash: counted === undefined ? null : counted,
          p_denominations: denominations || null, p_variance_reason: varianceReason || null, p_version: version,
        });
      },
      siteReopen: function (siteDayId, reason, version) { return call('nf_site_reopen', { p_site_day_id: siteDayId, p_reason: reason || null, p_version: version }); },
      // head office's review
      siteReview: function (siteDayId) { return call('nf_site_review', { p_site_day_id: siteDayId }); },
      siteMatch: function (siteDayId) { return call('nf_site_match', { p_site_day_id: siteDayId }); },
      siteAccept: function (lineId, version, headCode, partyName) {
        return call('nf_site_accept', { p_line_id: lineId, p_version: version, p_head_code: headCode || null, p_party_name: partyName || null });
      },
      siteAcceptNew: function (siteDayId, version) { return call('nf_site_accept_new', { p_site_day_id: siteDayId, p_version: version }); },
      siteReject: function (lineId, version, reason) { return call('nf_site_reject', { p_line_id: lineId, p_version: version, p_reason: reason }); },
      siteLink: function (lineId, version, voucherId, reason) {
        return call('nf_site_link', { p_line_id: lineId, p_version: version, p_voucher_id: voucherId, p_reason: reason || null });
      },
      siteMarkDuplicate: function (lineId, version, voucherId) {
        return call('nf_site_mark_duplicate', { p_line_id: lineId, p_version: version, p_voucher_id: voucherId });
      },
      siteReturn: function (siteDayId, reason, version) { return call('nf_site_return', { p_site_day_id: siteDayId, p_reason: reason, p_version: version }); },
      // a bill photo, into the private bucket (migration 20261118b — not applied yet). Not an rpc:
      // storage is the one other door this module opens, and only here.
      uploadSiteBill: function (companyId, date, file) {
        if (!sb.storage || typeof sb.storage.from !== 'function') return Promise.reject(new Error('Photo storage is not available.'));
        var ext = ((file && file.name) || '').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
        var path = companyId + '/' + date + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
        return sb.storage.from('nf-site-bills').upload(path, file, { upsert: false, contentType: file.type || 'image/jpeg' })
          .then(function (r) {
            if (r.error) { var e = new Error('NF:PHOTO_UPLOAD'); e.code = 'NF:PHOTO_UPLOAD'; e.detail = r.error.message; throw e; }
            return path;
          });
      },
      // each HO voucher's manual no and real business date, for "Link to…" search (nf_get_journal
      // does not carry them). A plain table read under the existing nf_vouchers read policy —
      // HO roles only; a site user reads nothing here.
      voucherFacts: function (companyId) {
        return sb.from('nf_vouchers').select('id,manual_no,real_date').eq('company_id', companyId)
          .then(function (r) { if (r.error) { var e = new Error('NF:READ'); e.code = 'NF:READ'; e.detail = r.error.message; throw e; } return r.data || []; });
      },
      siteBillUrl: function (path) {
        if (!path || !sb.storage) return Promise.resolve(null);
        return sb.storage.from('nf-site-bills').createSignedUrl(path, 600).then(function (r) { return r.error ? null : r.data.signedUrl; });
      },

      // membership
      setMember: function (companyId, userId, role, displayName, active) {
        return call('nf_set_member', { p_company_id: companyId, p_user_id: userId, p_role: role, p_display_name: displayName, p_active: active });
      },

      raw: call,
    };
  }

  global.NfApi = { build: build };
})(window);
