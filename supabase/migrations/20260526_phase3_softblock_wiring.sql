-- =====================================================================
-- Phase 3 / Component 3 — PART B: soft-block wiring + hard block.
-- Applied to itqxljtfbrppntgyfush on 2026-05-26 (migration
-- phase3_softblock_wiring).
--
-- Strategy: rename each heavy executor to _<name>_core (body preserved
-- verbatim by the rename) and create a same-signature gating WRAPPER that
-- takes over the public name. The wrapper resolves the restriction level
-- via _rms_restriction_level and:
--   hard    -> refuse  ({success:false, error:'action_hard_blocked'})
--   soft    -> create_approval_request (snapshot the params as payload)
--              + return {success:true, status:'pending_approval', request_id}
--   warning -> write an audit_logs row (is_sensitive) then proceed
-- On proceed it delegates to the _core. The approve-engine (approve_request)
-- is pointed at the _core functions directly, so an approved request runs
-- the real action WITHOUT re-entering the gate (no recursion; no GUC).
-- The _core functions are REVOKE'd from anon/authenticated so the gate
-- cannot be bypassed by calling them directly; the SECURITY DEFINER wrapper
-- and approve-engine (owned by the migration role) can still invoke them.
--
-- Hard block: delete_client / delete_client_simple refuse when the client
-- has non-cancelled sales (active financials).
--
-- DELIBERATELY NOT WIRED HERE (see report):
--   * Refund: no standalone refund RPC exists — refunds run inside
--     execute_unit_cancellation (gated) and the approve-engine refund branch.
--   * Discount soft-block: record_payment has NO discount/base_price params,
--     so gating it would block ordinary payments; and the approve-engine
--     'discount' branch UPDATEs an EXISTING sale, which needs a dedicated
--     "edit discount" entry point. The 'discount' restriction rule + apply
--     branch are already in place for that follow-up.
-- =====================================================================

-- ── Hard block: client delete with active financials ────────────────
CREATE OR REPLACE FUNCTION public.delete_client(p_id uuid, p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_rows INTEGER;
BEGIN
  IF EXISTS (SELECT 1 FROM public.sales
             WHERE client_id = p_id AND company_id = p_company_id AND status <> 'cancelled') THEN
    RAISE EXCEPTION 'client_has_active_financials';
  END IF;
  UPDATE public.clients SET status = 'inactive', updated_at = now()
  WHERE id = p_id AND company_id = p_company_id AND status <> 'inactive';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Client not found, already inactive, or access denied');
  END IF;
  RETURN jsonb_build_object('success', true, 'action', 'deactivated');
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;

CREATE OR REPLACE FUNCTION public.delete_client_simple(p_id uuid, p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.sales
             WHERE client_id = p_id AND company_id = p_company_id AND status <> 'cancelled') THEN
    RAISE EXCEPTION 'client_has_active_financials';
  END IF;
  DELETE FROM public.clients WHERE id = p_id AND company_id = p_company_id;
  RETURN jsonb_build_object('success', true);
END $function$;

-- ── Cancellation: rename core + gating wrapper ───────────────────────
ALTER FUNCTION public.execute_unit_cancellation(
  uuid,uuid,uuid,uuid,uuid,uuid,date,date,text,text,text,integer,integer,integer,date,boolean,
  numeric,numeric,numeric,numeric,numeric,numeric,text,numeric,text,text,uuid,text,date,date,text,
  numeric,numeric,numeric,text,numeric,text,text,text,text,text,text
) RENAME TO _execute_unit_cancellation_core;

REVOKE ALL ON FUNCTION public._execute_unit_cancellation_core(
  uuid,uuid,uuid,uuid,uuid,uuid,date,date,text,text,text,integer,integer,integer,date,boolean,
  numeric,numeric,numeric,numeric,numeric,numeric,text,numeric,text,text,uuid,text,date,date,text,
  numeric,numeric,numeric,text,numeric,text,text,text,text,text,text
) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.execute_unit_cancellation(
  p_company_id uuid, p_unit_id uuid, p_project_id uuid, p_sale_id uuid, p_client_id uuid, p_agent_id uuid,
  p_cancellation_date date, p_effective_date date, p_cancellation_type text, p_reason_category text, p_detailed_reason text,
  p_overdue_count integer DEFAULT 0, p_days_past_due integer DEFAULT 0, p_notices_sent integer DEFAULT 0,
  p_last_notice_date date DEFAULT NULL, p_legal_action boolean DEFAULT false, p_total_paid numeric DEFAULT 0,
  p_booking_forfeiture numeric DEFAULT 0, p_cancellation_charges numeric DEFAULT 0, p_late_penalty numeric DEFAULT 0,
  p_processing_fee numeric DEFAULT 0, p_other_deductions numeric DEFAULT 0, p_other_deductions_note text DEFAULT NULL,
  p_net_refund numeric DEFAULT 0, p_refund_method text DEFAULT NULL, p_refund_payment_mode text DEFAULT NULL,
  p_refund_bank_id uuid DEFAULT NULL, p_refund_reference text DEFAULT NULL, p_refund_date date DEFAULT NULL,
  p_expected_refund_date date DEFAULT NULL, p_refund_notes text DEFAULT NULL, p_agent_commission_total numeric DEFAULT 0,
  p_agent_commission_paid numeric DEFAULT 0, p_agent_commission_pending numeric DEFAULT 0,
  p_commission_action text DEFAULT 'no_clawback', p_commission_recovery_amt numeric DEFAULT 0,
  p_commission_recovery_method text DEFAULT NULL, p_commission_notes text DEFAULT NULL,
  p_client_flag text DEFAULT 'none', p_blacklist_reason text DEFAULT NULL, p_initiated_by text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_level text; v_ar jsonb;
BEGIN
  v_level := public._rms_restriction_level(p_company_id, 'cancellation');
  IF v_level = 'hard' THEN
    RETURN jsonb_build_object('success', false, 'error', 'action_hard_blocked', 'action', 'cancellation');
  ELSIF v_level = 'soft' THEN
    v_ar := public.create_approval_request(jsonb_build_object(
      'request_type','cancellation','entity_table','units','entity_id',p_unit_id,
      'project_id',p_project_id,'title','Unit cancellation','description',p_detailed_reason,
      'amount',p_net_refund,
      'comment',COALESCE(NULLIF(TRIM(p_detailed_reason),''), NULLIF(TRIM(p_notes),'')),
      'payload',jsonb_build_object(
        'unit_id',p_unit_id,'project_id',p_project_id,'sale_id',p_sale_id,'client_id',p_client_id,'agent_id',p_agent_id,
        'cancellation_date',p_cancellation_date,'effective_date',p_effective_date,'cancellation_type',p_cancellation_type,
        'reason_category',p_reason_category,'detailed_reason',p_detailed_reason,'overdue_count',p_overdue_count,
        'days_past_due',p_days_past_due,'notices_sent',p_notices_sent,'last_notice_date',p_last_notice_date,
        'legal_action',p_legal_action,'total_paid',p_total_paid,'booking_forfeiture',p_booking_forfeiture,
        'cancellation_charges',p_cancellation_charges,'late_penalty',p_late_penalty,'processing_fee',p_processing_fee,
        'other_deductions',p_other_deductions,'other_deductions_note',p_other_deductions_note,'net_refund',p_net_refund,
        'refund_method',p_refund_method,'refund_payment_mode',p_refund_payment_mode,'refund_bank_id',p_refund_bank_id,
        'refund_reference',p_refund_reference,'refund_date',p_refund_date,'expected_refund_date',p_expected_refund_date,
        'refund_notes',p_refund_notes,'agent_commission_total',p_agent_commission_total,
        'agent_commission_paid',p_agent_commission_paid,'agent_commission_pending',p_agent_commission_pending,
        'commission_action',p_commission_action,'commission_recovery_amt',p_commission_recovery_amt,
        'commission_recovery_method',p_commission_recovery_method,'commission_notes',p_commission_notes,
        'client_flag',p_client_flag,'blacklist_reason',p_blacklist_reason,'initiated_by',p_initiated_by,'notes',p_notes)
    ));
    IF NOT COALESCE((v_ar->>'success')::boolean, false) THEN RETURN v_ar; END IF;
    RETURN jsonb_build_object('success', true, 'status', 'pending_approval', 'request_id', v_ar->>'id');
  ELSIF v_level = 'warning' THEN
    INSERT INTO public.audit_logs (company_id, table_name, record_id, action, is_sensitive, module, reason)
    VALUES (p_company_id, 'units', p_unit_id::text, 'restriction_warning', true, 'restrictions', 'cancellation');
  END IF;

  -- proceed (warning / non-soft) -> delegate to the preserved executor
  RETURN public._execute_unit_cancellation_core(
    p_company_id, p_unit_id, p_project_id, p_sale_id, p_client_id, p_agent_id,
    p_cancellation_date, p_effective_date, p_cancellation_type, p_reason_category, p_detailed_reason,
    p_overdue_count, p_days_past_due, p_notices_sent, p_last_notice_date, p_legal_action, p_total_paid,
    p_booking_forfeiture, p_cancellation_charges, p_late_penalty, p_processing_fee, p_other_deductions,
    p_other_deductions_note, p_net_refund, p_refund_method, p_refund_payment_mode, p_refund_bank_id,
    p_refund_reference, p_refund_date, p_expected_refund_date, p_refund_notes, p_agent_commission_total,
    p_agent_commission_paid, p_agent_commission_pending, p_commission_action, p_commission_recovery_amt,
    p_commission_recovery_method, p_commission_notes, p_client_flag, p_blacklist_reason, p_initiated_by, p_notes
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.execute_unit_cancellation(
  uuid,uuid,uuid,uuid,uuid,uuid,date,date,text,text,text,integer,integer,integer,date,boolean,
  numeric,numeric,numeric,numeric,numeric,numeric,text,numeric,text,text,uuid,text,date,date,text,
  numeric,numeric,numeric,text,numeric,text,text,text,text,text,text
) TO anon, authenticated, service_role;

-- ── Transfer (v2): rename core + gating wrapper ──────────────────────
ALTER FUNCTION public.execute_unit_transfer_v2(
  uuid,date,uuid,uuid,uuid,uuid,numeric,numeric,numeric,text,uuid,jsonb,jsonb,numeric,numeric,numeric,
  text,text,text,text,uuid,numeric,text,text
) RENAME TO _execute_unit_transfer_v2_core;

REVOKE ALL ON FUNCTION public._execute_unit_transfer_v2_core(
  uuid,date,uuid,uuid,uuid,uuid,numeric,numeric,numeric,text,uuid,jsonb,jsonb,numeric,numeric,numeric,
  text,text,text,text,uuid,numeric,text,text
) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.execute_unit_transfer_v2(
  p_company_id uuid, p_transfer_date date, p_unit_id uuid, p_project_id uuid, p_old_sale_id uuid, p_old_client_id uuid,
  p_old_total_paid numeric, p_old_outstanding numeric, p_old_sale_price numeric, p_old_close_note text,
  p_new_client_id uuid, p_new_sale jsonb, p_installments jsonb DEFAULT '[]'::jsonb, p_transfer_fee numeric DEFAULT 0,
  p_documentation_charges numeric DEFAULT 0, p_other_charges numeric DEFAULT 0, p_other_charges_desc text DEFAULT NULL,
  p_charges_paid_by text DEFAULT 'new', p_charges_payment_method text DEFAULT NULL, p_charges_reference text DEFAULT NULL,
  p_agent_id uuid DEFAULT NULL, p_commission_rate numeric DEFAULT 0, p_notes text DEFAULT NULL, p_created_by text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_level text; v_ar jsonb;
BEGIN
  v_level := public._rms_restriction_level(p_company_id, 'transfer');
  IF v_level = 'hard' THEN
    RETURN jsonb_build_object('success', false, 'error', 'action_hard_blocked', 'action', 'transfer');
  ELSIF v_level = 'soft' THEN
    v_ar := public.create_approval_request(jsonb_build_object(
      'request_type','transfer','entity_table','units','entity_id',p_unit_id,
      'project_id',p_project_id,'title','Unit transfer','description',p_old_close_note,
      'comment',COALESCE(NULLIF(TRIM(p_notes),''), NULLIF(TRIM(p_old_close_note),'')),
      'payload',jsonb_build_object(
        'transfer_date',p_transfer_date,'unit_id',p_unit_id,'project_id',p_project_id,'old_sale_id',p_old_sale_id,
        'old_client_id',p_old_client_id,'old_total_paid',p_old_total_paid,'old_outstanding',p_old_outstanding,
        'old_sale_price',p_old_sale_price,'old_close_note',p_old_close_note,'new_client_id',p_new_client_id,
        'new_sale',p_new_sale,'installments',p_installments,'transfer_fee',p_transfer_fee,
        'documentation_charges',p_documentation_charges,'other_charges',p_other_charges,
        'other_charges_desc',p_other_charges_desc,'charges_paid_by',p_charges_paid_by,
        'charges_payment_method',p_charges_payment_method,'charges_reference',p_charges_reference,
        'agent_id',p_agent_id,'commission_rate',p_commission_rate,'notes',p_notes,'created_by',p_created_by)
    ));
    IF NOT COALESCE((v_ar->>'success')::boolean, false) THEN RETURN v_ar; END IF;
    RETURN jsonb_build_object('success', true, 'status', 'pending_approval', 'request_id', v_ar->>'id');
  ELSIF v_level = 'warning' THEN
    INSERT INTO public.audit_logs (company_id, table_name, record_id, action, is_sensitive, module, reason)
    VALUES (p_company_id, 'units', p_unit_id::text, 'restriction_warning', true, 'restrictions', 'transfer');
  END IF;

  RETURN public._execute_unit_transfer_v2_core(
    p_company_id, p_transfer_date, p_unit_id, p_project_id, p_old_sale_id, p_old_client_id,
    p_old_total_paid, p_old_outstanding, p_old_sale_price, p_old_close_note, p_new_client_id, p_new_sale,
    p_installments, p_transfer_fee, p_documentation_charges, p_other_charges, p_other_charges_desc,
    p_charges_paid_by, p_charges_payment_method, p_charges_reference, p_agent_id, p_commission_rate,
    p_notes, p_created_by
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.execute_unit_transfer_v2(
  uuid,date,uuid,uuid,uuid,uuid,numeric,numeric,numeric,text,uuid,jsonb,jsonb,numeric,numeric,numeric,
  text,text,text,text,uuid,numeric,text,text
) TO anon, authenticated, service_role;

-- ── Point the approve-engine at the _core executors (bypass the gate) ──
-- (Only the two executor calls change vs. phase3_price_revision_payload_key:
--  execute_unit_cancellation -> _execute_unit_cancellation_core, and
--  execute_unit_transfer_v2  -> _execute_unit_transfer_v2_core.)
CREATE OR REPLACE FUNCTION public.approve_request(p_request_id uuid, p_comment text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_me      public.app_users;
  v_req     public.approval_requests;
  v_comment text := NULLIF(TRIM(p_comment),'');
  v_pl      jsonb;
  v_rc      integer;
  v_res     jsonb;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden','message','Only the Admin can approve.');
  END IF;
  IF v_comment IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','comment_required','message','A comment is required to approve.');
  END IF;

  SELECT * INTO v_req FROM public.approval_requests WHERE id=p_request_id;
  IF NOT FOUND OR v_req.company_id <> v_me.company_id THEN
    RETURN jsonb_build_object('success',false,'error','not_found');
  END IF;
  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('success',false,'error','not_pending','message','Already '||v_req.status||'.');
  END IF;

  v_pl := COALESCE(v_req.payload, '{}'::jsonb);

  CASE v_req.request_type

    WHEN 'discount' THEN
      UPDATE public.sales
        SET discount_amount = (v_pl->>'discount_amount')::numeric, updated_at = now()
        WHERE id = v_req.entity_id AND company_id = v_req.company_id;
      GET DIAGNOSTICS v_rc = ROW_COUNT;
      IF v_rc = 0 THEN RAISE EXCEPTION 'entity_not_found_or_cross_company'; END IF;

    WHEN 'price_revision' THEN
      UPDATE public.sales
        SET net_amount = (v_pl->>'net_amount')::numeric, updated_at = now()
        WHERE id = v_req.entity_id AND company_id = v_req.company_id;
      GET DIAGNOSTICS v_rc = ROW_COUNT;
      IF v_rc = 0 THEN RAISE EXCEPTION 'entity_not_found_or_cross_company'; END IF;

    WHEN 'refund' THEN
      UPDATE public.payments
        SET status = 'refunded', refund_amount = (v_pl->>'refund_amount')::numeric, updated_at = now()
        WHERE id = v_req.entity_id AND company_id = v_req.company_id;
      GET DIAGNOSTICS v_rc = ROW_COUNT;
      IF v_rc = 0 THEN RAISE EXCEPTION 'entity_not_found_or_cross_company'; END IF;

    WHEN 'dnd' THEN
      UPDATE public.clients
        SET dnd_status = true, updated_at = now()
        WHERE id = v_req.entity_id AND company_id = v_req.company_id;
      GET DIAGNOSTICS v_rc = ROW_COUNT;
      IF v_rc = 0 THEN RAISE EXCEPTION 'entity_not_found_or_cross_company'; END IF;

    WHEN 'blacklist' THEN
      UPDATE public.clients
        SET is_blacklisted = true, updated_at = now()
        WHERE id = v_req.entity_id AND company_id = v_req.company_id;
      GET DIAGNOSTICS v_rc = ROW_COUNT;
      IF v_rc = 0 THEN RAISE EXCEPTION 'entity_not_found_or_cross_company'; END IF;

    WHEN 'cancellation' THEN
      IF NOT EXISTS (SELECT 1 FROM public.units
                     WHERE id = v_req.entity_id AND company_id = v_req.company_id) THEN
        RAISE EXCEPTION 'entity_not_found_or_cross_company';
      END IF;
      SELECT public._execute_unit_cancellation_core(
        p_company_id            => v_req.company_id,
        p_unit_id               => (v_pl->>'unit_id')::uuid,
        p_project_id            => (v_pl->>'project_id')::uuid,
        p_sale_id               => (v_pl->>'sale_id')::uuid,
        p_client_id             => (v_pl->>'client_id')::uuid,
        p_agent_id              => (v_pl->>'agent_id')::uuid,
        p_cancellation_date     => (v_pl->>'cancellation_date')::date,
        p_effective_date        => (v_pl->>'effective_date')::date,
        p_cancellation_type     => v_pl->>'cancellation_type',
        p_reason_category       => v_pl->>'reason_category',
        p_detailed_reason       => v_pl->>'detailed_reason',
        p_overdue_count         => COALESCE((v_pl->>'overdue_count')::int,0),
        p_days_past_due         => COALESCE((v_pl->>'days_past_due')::int,0),
        p_notices_sent          => COALESCE((v_pl->>'notices_sent')::int,0),
        p_last_notice_date      => (v_pl->>'last_notice_date')::date,
        p_legal_action          => COALESCE((v_pl->>'legal_action')::boolean,false),
        p_total_paid            => COALESCE((v_pl->>'total_paid')::numeric,0),
        p_booking_forfeiture    => COALESCE((v_pl->>'booking_forfeiture')::numeric,0),
        p_cancellation_charges  => COALESCE((v_pl->>'cancellation_charges')::numeric,0),
        p_late_penalty          => COALESCE((v_pl->>'late_penalty')::numeric,0),
        p_processing_fee        => COALESCE((v_pl->>'processing_fee')::numeric,0),
        p_other_deductions      => COALESCE((v_pl->>'other_deductions')::numeric,0),
        p_other_deductions_note => v_pl->>'other_deductions_note',
        p_net_refund            => COALESCE((v_pl->>'net_refund')::numeric,0),
        p_refund_method         => v_pl->>'refund_method',
        p_refund_payment_mode   => v_pl->>'refund_payment_mode',
        p_refund_bank_id        => (v_pl->>'refund_bank_id')::uuid,
        p_refund_reference      => v_pl->>'refund_reference',
        p_refund_date           => (v_pl->>'refund_date')::date,
        p_expected_refund_date  => (v_pl->>'expected_refund_date')::date,
        p_refund_notes          => v_pl->>'refund_notes',
        p_agent_commission_total   => COALESCE((v_pl->>'agent_commission_total')::numeric,0),
        p_agent_commission_paid    => COALESCE((v_pl->>'agent_commission_paid')::numeric,0),
        p_agent_commission_pending => COALESCE((v_pl->>'agent_commission_pending')::numeric,0),
        p_commission_action        => COALESCE(v_pl->>'commission_action','no_clawback'),
        p_commission_recovery_amt  => COALESCE((v_pl->>'commission_recovery_amt')::numeric,0),
        p_commission_recovery_method => v_pl->>'commission_recovery_method',
        p_commission_notes      => v_pl->>'commission_notes',
        p_client_flag           => COALESCE(v_pl->>'client_flag','none'),
        p_blacklist_reason      => v_pl->>'blacklist_reason',
        p_initiated_by          => COALESCE(v_pl->>'initiated_by', v_me.id::text),
        p_notes                 => v_pl->>'notes'
      ) INTO v_res;
      IF NOT COALESCE((v_res->>'success')::boolean, false) THEN
        RAISE EXCEPTION 'cancellation_apply_failed: %', COALESCE(v_res->>'error', v_res->>'message', 'unknown');
      END IF;

    WHEN 'transfer' THEN
      IF NOT EXISTS (SELECT 1 FROM public.units
                     WHERE id = v_req.entity_id AND company_id = v_req.company_id) THEN
        RAISE EXCEPTION 'entity_not_found_or_cross_company';
      END IF;
      SELECT public._execute_unit_transfer_v2_core(
        p_company_id          => v_req.company_id,
        p_transfer_date       => (v_pl->>'transfer_date')::date,
        p_unit_id             => (v_pl->>'unit_id')::uuid,
        p_project_id          => (v_pl->>'project_id')::uuid,
        p_old_sale_id         => (v_pl->>'old_sale_id')::uuid,
        p_old_client_id       => (v_pl->>'old_client_id')::uuid,
        p_old_total_paid      => COALESCE((v_pl->>'old_total_paid')::numeric,0),
        p_old_outstanding     => COALESCE((v_pl->>'old_outstanding')::numeric,0),
        p_old_sale_price      => COALESCE((v_pl->>'old_sale_price')::numeric,0),
        p_old_close_note      => v_pl->>'old_close_note',
        p_new_client_id       => (v_pl->>'new_client_id')::uuid,
        p_new_sale            => COALESCE(v_pl->'new_sale','{}'::jsonb),
        p_installments        => COALESCE(v_pl->'installments','[]'::jsonb),
        p_transfer_fee        => COALESCE((v_pl->>'transfer_fee')::numeric,0),
        p_documentation_charges => COALESCE((v_pl->>'documentation_charges')::numeric,0),
        p_other_charges       => COALESCE((v_pl->>'other_charges')::numeric,0),
        p_other_charges_desc  => v_pl->>'other_charges_desc',
        p_charges_paid_by     => COALESCE(v_pl->>'charges_paid_by','new'),
        p_charges_payment_method => v_pl->>'charges_payment_method',
        p_charges_reference   => v_pl->>'charges_reference',
        p_agent_id            => (v_pl->>'agent_id')::uuid,
        p_commission_rate     => COALESCE((v_pl->>'commission_rate')::numeric,0),
        p_notes               => v_pl->>'notes',
        p_created_by          => COALESCE(v_pl->>'created_by', v_me.id::text)
      ) INTO v_res;
      IF NOT COALESCE((v_res->>'success')::boolean, false) THEN
        RAISE EXCEPTION 'transfer_apply_failed: %', COALESCE(v_res->>'error', v_res->>'message', 'unknown');
      END IF;

    ELSE
      RAISE EXCEPTION 'unsupported_request_type';
  END CASE;

  UPDATE public.approval_requests
    SET status='approved', decided_by=v_me.id, decided_at=now(), decision_comment=v_comment
    WHERE id=p_request_id;

  INSERT INTO public.approval_request_comments (company_id, request_id, author_id, action, comment)
  VALUES (v_me.company_id, p_request_id, v_me.id, 'approved', v_comment);

  INSERT INTO public.audit_logs (
    company_id, table_name, record_id, action, new_data,
    changed_by, changed_by_name, changed_by_role, is_sensitive, module, reason
  ) VALUES (
    v_req.company_id, v_req.entity_table, v_req.entity_id::text, 'approval_applied', v_pl,
    v_me.id, v_me.full_name, v_me.role, true, 'approvals', v_req.request_type
  );

  RETURN jsonb_build_object('success',true,'status','approved',
    'entity_table',v_req.entity_table,'entity_id',v_req.entity_id,'applied',true);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success',false,'error','apply_failed','message',SQLERRM);
END;
$function$;
