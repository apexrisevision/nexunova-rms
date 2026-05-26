-- =====================================================================
-- Phase 3 follow-up — align price_revision payload key to 'net_amount'.
-- Applied to itqxljtfbrppntgyfush on 2026-05-26 (migration
-- phase3_price_revision_payload_key).
--
-- Component 2 (phase3_approval_apply_engine) read payload->>'total_price'
-- in the price_revision branch. Per the master-context §7 contract
-- ("approval_requests payload key for price revision = 'net_amount'"),
-- this re-creates approve_request reading payload->>'net_amount' so the
-- documented contract matches the deployed code. ONLY the price_revision
-- payload key changes vs. phase3_approval_apply_engine; everything else
-- (dispatch, isolation, audit row, comment trail) is identical.
-- =====================================================================

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
      SELECT public.execute_unit_cancellation(
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
      SELECT public.execute_unit_transfer_v2(
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
