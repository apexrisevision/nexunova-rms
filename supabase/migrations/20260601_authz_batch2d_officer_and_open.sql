-- Authz hardening — Batch 2d: gate officer-allowed doer-toolkit + remaining OPEN RPCs. Source: RPC_AUTHZ_TRIAGE.md.
-- Guard = null-safe caller + tenant ONLY (NO role line) for the officer-allowed set — these are intended
-- for recovery officers AND admins. create_blacklist_entry additionally gets an owner/admin role line.
--
-- TENANT RESOLUTION per fn:
--   * Functions with a real p_company_id tenant key → tenant line uses p_company_id directly.
--   * Functions with NO usable company param (the "OPEN" triage rows, or a nullable/unused p_company_id)
--     → derive company_id from the target row (via the id the fn already takes) and compare to
--       v_me.company_id. Super-admin bypasses the derivation entirely.
--   - mark_promise_broken / postpone_promise  → payment_promises.company_id  via p_promise_id
--   - update_radar_outcome / log_radar_action  → recovery_radar_logs.company_id via p_radar_log_id
--   - calculate_client_health_score            → clients.company_id           via p_client_id
--     (its p_company_id is DEFAULT NULL and unused by the body; param-based check would break NULL calls)
--
-- SIGNATURE NOTES: log_radar_action, postpone_promise, update_radar_outcome have NO `SET search_path`
-- in the catalog — preserved as-is (NOT adding one); their bodies already reference unqualified tables,
-- and the derivation SELECTs match that. Bodies, return types, SECURITY DEFINER, search_path, and
-- EXCEPTION/NOT-FOUND logic preserved byte-for-byte; only the guard block + decls are added.
-- For derived-tenant fns a non-existent / other-tenant target id now returns 'forbidden' instead of
-- 'not_found' for non-super callers (acceptable — blocks cross-tenant probing).

-- ════════════════════ OFFICER-ALLOWED — caller + tenant only ════════════════════

-- 1. assign_clients_to_campaign  (param tenant: p_company_id)
CREATE OR REPLACE FUNCTION public.assign_clients_to_campaign(p_campaign_id uuid, p_company_id uuid, p_client_ids jsonb, p_assigned_by text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_added int := 0;
  v_id    uuid;
  v_me    public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  IF p_campaign_id IS NULL OR p_company_id IS NULL OR p_client_ids IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_params');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM recovery_campaigns
                  WHERE id = p_campaign_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'campaign_not_found');
  END IF;
  IF jsonb_typeof(p_client_ids) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'error', 'client_ids_must_be_array');
  END IF;

  FOR v_id IN SELECT (value #>> '{}')::uuid FROM jsonb_array_elements(p_client_ids)
  LOOP
    BEGIN
      INSERT INTO campaign_clients(company_id, campaign_id, client_id, assigned_by)
      VALUES (p_company_id, p_campaign_id, v_id, p_assigned_by)
      ON CONFLICT (campaign_id, client_id) DO UPDATE
        SET status = 'active', assigned_at = now()
        WHERE campaign_clients.status = 'removed';
      v_added := v_added + 1;
    EXCEPTION WHEN OTHERS THEN
      -- skip bad ids silently in bulk
      NULL;
    END;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'added_count', v_added);
END;
$function$;

-- 2. create_campaign  (param tenant: p_company_id)
CREATE OR REPLACE FUNCTION public.create_campaign(p_company_id uuid, p_data jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  IF p_company_id IS NULL OR p_data IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_params');
  END IF;
  IF COALESCE(p_data->>'name','') = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'name_required');
  END IF;
  IF NULLIF(p_data->>'start_date','') IS NULL OR NULLIF(p_data->>'end_date','') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'dates_required');
  END IF;

  INSERT INTO recovery_campaigns
    (company_id, name, description, target_amount, start_date, end_date, status, created_by)
  VALUES (
    p_company_id,
    p_data->>'name',
    NULLIF(p_data->>'description',''),
    COALESCE((p_data->>'target_amount')::numeric, 0),
    (p_data->>'start_date')::date,
    (p_data->>'end_date')::date,
    COALESCE(NULLIF(p_data->>'status',''), 'active'),
    NULLIF(p_data->>'created_by','')
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- 3. create_noc_request  (param tenant: p_company_id)
CREATE OR REPLACE FUNCTION public.create_noc_request(p_company_id uuid, p_data jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id     uuid := gen_random_uuid();
  v_noc_no text;
  v_me     public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  v_noc_no := _generate_noc_number(p_company_id);
  INSERT INTO noc (
    id, company_id, unit_id, sale_id, client_id,
    client_name, client_phone, project_name, unit_no,
    noc_type, purpose, payment_threshold,
    status, requested_by, requested_at,
    valid_from, valid_until, noc_number, notes
  ) VALUES (
    v_id, p_company_id,
    (p_data->>'unit_id')::uuid,
    NULLIF(p_data->>'sale_id', '')::uuid,
    NULLIF(p_data->>'client_id', '')::uuid,
    p_data->>'client_name', p_data->>'client_phone',
    p_data->>'project_name', p_data->>'unit_no',
    p_data->>'noc_type', p_data->>'purpose',
    COALESCE((p_data->>'payment_threshold')::numeric, 80),
    'pending', p_data->>'requested_by', now(),
    NULLIF(p_data->>'valid_from', '')::date,
    NULLIF(p_data->>'valid_until', '')::date,
    v_noc_no, p_data->>'notes'
  );
  RETURN jsonb_build_object('success', true, 'id', v_id, 'noc_number', v_noc_no);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- 4. log_message_sent  (param tenant: p_company_id)
CREATE OR REPLACE FUNCTION public.log_message_sent(p_company_id uuid, p_data jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  IF p_company_id IS NULL OR p_data IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_params');
  END IF;
  INSERT INTO message_log (company_id, client_id, channel, template_id, category, to_address, body_rendered, status, sent_by)
  VALUES (
    p_company_id,
    NULLIF(p_data->>'client_id','')::uuid,
    COALESCE(NULLIF(p_data->>'channel',''), 'whatsapp'),
    NULLIF(p_data->>'template_id','')::uuid,
    p_data->>'category',
    p_data->>'to_address',
    p_data->>'body_rendered',
    COALESCE(NULLIF(p_data->>'status',''), 'manual'),
    NULLIF(p_data->>'sent_by','')
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- 5. upsert_legal_case  (param tenant: p_company_id)
CREATE OR REPLACE FUNCTION public.upsert_legal_case(p_company_id uuid, p_data jsonb, p_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.legal_cases (
      company_id, client_id, sale_id, unit_id, case_number, stage, case_type,
      lawyer_name, lawyer_contact, filed_date, next_hearing_date,
      outcome, claim_amount, settled_amount, notes, created_by
    ) VALUES (
      p_company_id,
      (p_data->>'client_id')::uuid,
      NULLIF(p_data->>'sale_id','')::uuid,
      NULLIF(p_data->>'unit_id','')::uuid,
      NULLIF(p_data->>'case_number',''),
      COALESCE(p_data->>'stage','pre_legal'),
      COALESCE(NULLIF(p_data->>'case_type',''),'court'),
      NULLIF(p_data->>'lawyer_name',''),
      NULLIF(p_data->>'lawyer_contact',''),
      NULLIF(p_data->>'filed_date','')::date,
      NULLIF(p_data->>'next_hearing_date','')::date,
      NULLIF(p_data->>'outcome',''),
      COALESCE((p_data->>'claim_amount')::numeric, 0),
      COALESCE((p_data->>'settled_amount')::numeric, 0),
      NULLIF(p_data->>'notes',''),
      NULLIF(p_data->>'created_by','')::uuid
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.legal_cases SET
      unit_id           = CASE WHEN p_data ? 'unit_id'
                               THEN NULLIF(p_data->>'unit_id','')::uuid
                               ELSE unit_id END,
      case_number       = COALESCE(NULLIF(p_data->>'case_number',''),       case_number),
      stage             = COALESCE(p_data->>'stage',                         stage),
      case_type         = COALESCE(NULLIF(p_data->>'case_type',''),          case_type),
      lawyer_name       = COALESCE(NULLIF(p_data->>'lawyer_name',''),        lawyer_name),
      lawyer_contact    = COALESCE(NULLIF(p_data->>'lawyer_contact',''),     lawyer_contact),
      filed_date        = COALESCE(NULLIF(p_data->>'filed_date','')::date,   filed_date),
      next_hearing_date = COALESCE(NULLIF(p_data->>'next_hearing_date','')::date, next_hearing_date),
      outcome           = COALESCE(NULLIF(p_data->>'outcome',''),            outcome),
      claim_amount      = COALESCE((p_data->>'claim_amount')::numeric,       claim_amount),
      settled_amount    = COALESCE((p_data->>'settled_amount')::numeric,     settled_amount),
      notes             = COALESCE(NULLIF(p_data->>'notes',''),              notes),
      updated_at        = now()
    WHERE id = p_id AND company_id = p_company_id;
    v_id := p_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$function$;

-- 6. mark_promise_broken  (derived tenant: payment_promises.company_id via p_promise_id)
CREATE OR REPLACE FUNCTION public.mark_promise_broken(p_promise_id uuid, p_broken_reason text DEFAULT NULL::text, p_updated_by text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_status     TEXT;
  v_client_id  UUID;
  v_company_id UUID;
  v_threshold  INT := 3;   -- broken promises in 90d to trigger auto-escalation
  v_broken_count INT := 0;
  v_has_open_escalation BOOLEAN;
  v_escalation_id UUID := NULL;
  v_me         public.app_users;
  v_tenant     UUID;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) THEN
    SELECT company_id INTO v_tenant FROM payment_promises WHERE id = p_promise_id;
    IF v_tenant IS DISTINCT FROM v_me.company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  END IF;

  SELECT status, client_id, company_id
    INTO v_status, v_client_id, v_company_id
    FROM payment_promises WHERE id = p_promise_id;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'promise_not_found');
  END IF;
  IF v_status NOT IN ('pending','postponed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'promise_already_resolved');
  END IF;

  UPDATE payment_promises SET
    status = 'broken', broken_reason = p_broken_reason, updated_at = NOW()
  WHERE id = p_promise_id;

  -- Auto-escalate after threshold broken promises in last 90 days,
  -- unless an open escalation already exists for this client.
  SELECT COUNT(*) INTO v_broken_count
  FROM payment_promises
  WHERE client_id = v_client_id
    AND company_id = v_company_id
    AND status = 'broken'
    AND COALESCE(updated_at, created_at) >= NOW() - INTERVAL '90 days';

  SELECT EXISTS (
    SELECT 1 FROM escalations
     WHERE client_id = v_client_id
       AND company_id = v_company_id
       AND status = 'open'
  ) INTO v_has_open_escalation;

  IF v_broken_count >= v_threshold AND NOT v_has_open_escalation THEN
    INSERT INTO escalations (
      company_id, client_id, from_level, to_level, reason, status, created_at, updated_at
    ) VALUES (
      v_company_id, v_client_id, 1, 2,
      'Auto-escalated: ' || v_broken_count || ' broken promise(s) in last 90 days (threshold ' || v_threshold || ')',
      'open', NOW(), NOW()
    ) RETURNING id INTO v_escalation_id;
  END IF;

  RETURN jsonb_build_object(
    'success',          true,
    'id',               p_promise_id,
    'status',           'broken',
    'broken_count_90d', v_broken_count,
    'auto_escalated',   v_escalation_id IS NOT NULL,
    'escalation_id',    v_escalation_id
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- 7. postpone_promise  (derived tenant: payment_promises.company_id via p_promise_id; NO search_path preserved)
CREATE OR REPLACE FUNCTION public.postpone_promise(p_promise_id uuid, p_new_date date, p_postpone_reason text DEFAULT NULL::text, p_updated_by text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE v_promise payment_promises; v_new_id UUID; v_me public.app_users; v_tenant UUID;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) THEN
    SELECT company_id INTO v_tenant FROM payment_promises WHERE id = p_promise_id;
    IF v_tenant IS DISTINCT FROM v_me.company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  END IF;

  SELECT * INTO v_promise FROM payment_promises WHERE id = p_promise_id;
  IF v_promise.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'promise_not_found');
  END IF;
  IF p_new_date IS NULL OR p_new_date <= v_promise.promise_date THEN
    RETURN jsonb_build_object('success', false, 'error', 'new_date_must_be_after_original');
  END IF;

  UPDATE payment_promises SET
    status = 'postponed', postponed_to_date = p_new_date,
    postpone_reason = p_postpone_reason, updated_at = NOW()
  WHERE id = p_promise_id;

  INSERT INTO payment_promises (
    company_id, client_id, sale_id, installment_id,
    promised_amount, promise_date, promise_made_on,
    promised_via, promised_by_client, logged_by, notes
  ) VALUES (
    v_promise.company_id, v_promise.client_id, v_promise.sale_id, v_promise.installment_id,
    v_promise.promised_amount, p_new_date, CURRENT_DATE,
    v_promise.promised_via, v_promise.promised_by_client,
    COALESCE(p_updated_by, v_promise.logged_by),
    'Postponed from ' || v_promise.promise_date::text || COALESCE(': ' || p_postpone_reason, '')
  ) RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('success', true, 'original_id', p_promise_id, 'new_id', v_new_id, 'new_date', p_new_date);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;$function$;

-- 8. log_radar_action  (derived tenant: recovery_radar_logs.company_id via p_radar_log_id; NO search_path preserved)
CREATE OR REPLACE FUNCTION public.log_radar_action(p_radar_log_id uuid, p_client_id uuid, p_action_taken text, p_action_by text, p_company_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_company_id UUID;
  v_score      INTEGER;
  v_new_id     UUID;
  v_me         public.app_users;
  v_tenant     UUID;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) THEN
    SELECT company_id INTO v_tenant FROM recovery_radar_logs WHERE id = p_radar_log_id;
    IF v_tenant IS DISTINCT FROM v_me.company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  END IF;

  SELECT r.company_id,
         ((c)->>'final_score')::INTEGER
  INTO   v_company_id, v_score
  FROM   recovery_radar_logs r,
         jsonb_array_elements(r.top_clients) c
  WHERE  r.id = p_radar_log_id
    AND  (c)->>'client_id' = p_client_id::TEXT
  LIMIT  1;

  v_company_id := COALESCE(p_company_id, v_company_id);

  INSERT INTO radar_action_logs
    (company_id, radar_log_id, client_id, predicted_score, action_taken, action_by)
  VALUES
    (v_company_id, p_radar_log_id, p_client_id, v_score, p_action_taken, p_action_by)
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('success', true, 'id', v_new_id);
END;
$function$;

-- 9. update_radar_outcome  (derived tenant: recovery_radar_logs.company_id via p_radar_log_id; NO search_path preserved)
CREATE OR REPLACE FUNCTION public.update_radar_outcome(p_radar_log_id uuid, p_client_id uuid, p_payment_amount numeric, p_payment_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE v_rows_affected INTEGER; v_me public.app_users; v_tenant UUID;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) THEN
    SELECT company_id INTO v_tenant FROM recovery_radar_logs WHERE id = p_radar_log_id;
    IF v_tenant IS DISTINCT FROM v_me.company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  END IF;

  UPDATE radar_action_logs
  SET    payment_received = TRUE,
         payment_amount   = p_payment_amount,
         payment_date     = p_payment_date
  WHERE  radar_log_id = p_radar_log_id
    AND  client_id    = p_client_id;

  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

  -- Insert if no action was logged yet
  IF v_rows_affected = 0 THEN
    INSERT INTO radar_action_logs
      (company_id, radar_log_id, client_id, action_taken, payment_received, payment_amount, payment_date)
    SELECT r.company_id, p_radar_log_id, p_client_id, 'no_action', TRUE, p_payment_amount, p_payment_date
    FROM   recovery_radar_logs r WHERE r.id = p_radar_log_id;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- 10. calculate_client_health_score  (derived tenant: clients.company_id via p_client_id; p_company_id param nullable/unused)
CREATE OR REPLACE FUNCTION public.calculate_client_health_score(p_client_id uuid, p_company_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id      UUID;
  v_on_time         INTEGER := 0;
  v_late            INTEGER := 0;
  v_answered        INTEGER := 0;
  v_missed          INTEGER := 0;
  v_kept            INTEGER := 0;
  v_broken          INTEGER := 0;
  v_bounced         INTEGER := 0;
  v_legal_active    INTEGER := 0;
  v_points_added    INTEGER;
  v_points_deducted INTEGER;
  v_score           INTEGER;
  v_category        TEXT;
  v_exposure        NUMERIC := 0;
  v_breakdown       JSONB;
  v_calc_time       TIMESTAMPTZ;
  v_me              public.app_users;
  v_tenant          UUID;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) THEN
    SELECT company_id INTO v_tenant FROM clients WHERE id = p_client_id;
    IF v_tenant IS DISTINCT FROM v_me.company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  END IF;

  SELECT company_id INTO v_company_id FROM clients WHERE id = p_client_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'client_not_found');
  END IF;

  SELECT COUNT(*) INTO v_on_time
  FROM installments i JOIN sales s ON s.id = i.sale_id
  WHERE s.client_id = p_client_id AND i.paid_at IS NOT NULL AND i.paid_at::date <= i.due_date;

  SELECT COUNT(*) INTO v_late
  FROM installments i JOIN sales s ON s.id = i.sale_id
  WHERE s.client_id = p_client_id AND i.paid_at IS NOT NULL AND i.paid_at::date > i.due_date;

  SELECT COUNT(*) INTO v_answered
  FROM contact_logs WHERE client_id = p_client_id AND call_status = 'answered';

  SELECT COUNT(*) INTO v_missed
  FROM contact_logs WHERE client_id = p_client_id AND call_status = 'no_answer';

  SELECT COUNT(*) INTO v_kept
  FROM payment_promises WHERE client_id = p_client_id AND status = 'kept';

  SELECT COUNT(*) INTO v_broken
  FROM payment_promises WHERE client_id = p_client_id AND status = 'broken';

  SELECT COUNT(*) INTO v_bounced
  FROM pdc_cheques WHERE client_id = p_client_id AND status = 'bounced';

  -- NEW: active legal cases = filed but no final outcome yet
  SELECT COUNT(*) INTO v_legal_active
  FROM legal_cases WHERE client_id = p_client_id AND outcome IS NULL;

  v_points_added    := (v_on_time * 10) + (v_answered * 5) + (v_kept * 5);
  v_points_deducted := (v_late * 15) + (v_missed * 10) + (v_broken * 20) + (v_bounced * 25) + (v_legal_active * 20);
  v_score           := GREATEST(0, LEAST(100, 50 + v_points_added - v_points_deducted));

  v_category := CASE
    WHEN v_score >= 80 THEN 'PLATINUM'
    WHEN v_score >= 60 THEN 'GOOD'
    WHEN v_score >= 40 THEN 'AT RISK'
    ELSE 'CRITICAL'
  END;

  SELECT COALESCE(SUM(i.amount_due - i.amount_paid), 0) INTO v_exposure
  FROM installments i JOIN sales s ON s.id = i.sale_id
  WHERE s.client_id = p_client_id AND i.paid_at IS NULL;

  v_calc_time := NOW();

  v_breakdown := jsonb_build_object(
    'on_time_payments',   v_on_time,
    'late_payments',      v_late,
    'answered_calls',     v_answered,
    'missed_calls',       v_missed,
    'kept_promises',      v_kept,
    'broken_promises',    v_broken,
    'pdc_bounces',        v_bounced,
    'legal_active_cases', v_legal_active,
    'points_added',       v_points_added,
    'points_deducted',    v_points_deducted,
    'final_score',        v_score
  );

  INSERT INTO client_health_scores
    (company_id, client_id, score, category, score_breakdown, total_exposure, last_calculated)
  VALUES
    (v_company_id, p_client_id, v_score, v_category, v_breakdown, v_exposure, v_calc_time)
  ON CONFLICT (client_id) DO UPDATE SET
    score           = EXCLUDED.score,
    category        = EXCLUDED.category,
    score_breakdown = EXCLUDED.score_breakdown,
    total_exposure  = EXCLUDED.total_exposure,
    last_calculated = EXCLUDED.last_calculated;

  -- NEW: capture a durable history point (one per day unless score changes)
  IF NOT EXISTS (
    SELECT 1 FROM client_health_history
    WHERE client_id = p_client_id
      AND calculated_at::date = v_calc_time::date
      AND score = v_score
  ) THEN
    INSERT INTO client_health_history
      (company_id, client_id, score, category, total_exposure, score_breakdown, calculated_at)
    VALUES
      (v_company_id, p_client_id, v_score, v_category, v_exposure, v_breakdown, v_calc_time);
  END IF;

  RETURN jsonb_build_object(
    'success',         true,
    'score',           v_score,
    'category',        v_category,
    'breakdown',       v_breakdown,
    'exposure',        v_exposure,
    'client_id',       p_client_id,
    'last_calculated', v_calc_time
  );
END;
$function$;

-- ════════════════════════════ ADMIN-ONLY in this group ════════════════════════════

-- 11. create_blacklist_entry  (param tenant: p_company_id + owner/admin role line)
CREATE OR REPLACE FUNCTION public.create_blacklist_entry(p_company_id uuid, p_data jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  INSERT INTO public.blacklisted_clients (
    company_id, client_id, reason, reason_type, blacklist_date, related_cancellation_id, approved_by, is_active
  ) VALUES (
    p_company_id, (p_data->>'client_id')::uuid, p_data->>'reason',
    COALESCE(NULLIF(p_data->>'reason_type',''),'other'),
    COALESCE((p_data->>'blacklist_date')::date, CURRENT_DATE),
    NULLIF(p_data->>'related_cancellation_id','')::uuid,
    NULLIF(p_data->>'approved_by',''),
    COALESCE((p_data->>'is_active')::bool, true)
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END $function$;
