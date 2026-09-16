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
      saveLine: function (dayId, lineId, side, voucherNo, description, head, floor, via, amount, version) {
        return call('nf_save_line', {
          p_day_id: dayId, p_line_id: lineId || null, p_side: side, p_voucher_no: voucherNo,
          p_description: description || null, p_head: head, p_floor: floor, p_via: via,
          p_amount: amount, p_version: version === undefined ? null : version,
        });
      },
      deleteLine: function (lineId, version) { return call('nf_delete_line', { p_line_id: lineId, p_version: version }); },

      // the rest of the sheet
      setTransfers: function (dayId, toBank, toPetty, version) {
        return call('nf_set_transfers', { p_day_id: dayId, p_to_bank: toBank, p_to_petty: toPetty, p_version: version });
      },
      saveCount: function (dayId, denoms, version) { return call('nf_save_count', { p_day_id: dayId, p_denoms: denoms, p_version: version }); },
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

      // membership
      setMember: function (companyId, userId, role, displayName, active) {
        return call('nf_set_member', { p_company_id: companyId, p_user_id: userId, p_role: role, p_display_name: displayName, p_active: active });
      },

      raw: call,
    };
  }

  global.NfApi = { build: build };
})(window);
