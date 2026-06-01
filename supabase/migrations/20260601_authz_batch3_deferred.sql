-- Authz hardening — Batch 3 (final): gate the DEFER set. Source: RPC_AUTHZ_TRIAGE.md + recon.
-- Null-safe guard convention as prior batches.
--
-- Coverage in THIS migration (5 fns):
--   1. create_payment_link    — caller + tenant(p_company_id) + role owner/admin/finance.
--   2. reject_payment_link    — caller + role owner/admin/finance; tenant DERIVED from
--                               payment_links.company_id via p_payment_link_id (super bypass).
--   3. verify_payment_link    — SAME as reject; guard runs BEFORE record_payment (money write).
--   4. create_demand_notice   — keep existing _rms_caller + tenant compare; ADD null-check + role owner/admin.
--   6. generate_recovery_radar— DUAL caller: app users restricted by role(owner/admin/recovery)+tenant;
--                               session-less callers allowed ONLY if pg_cron (session_user='postgres')
--                               or service_role JWT. (Evidence: cron.job 2 & 5 run as postgres.)
--
-- NOT in this migration:
--   * submit_buyer_complaint   — LEFT UNTOUCHED (correctly portal-session-token guarded).
--   * upload_payment_screenshot— FLAGGED & LEFT UNGATED (no session-token param; buyer-token pattern
--                                does not fit its signature without a frontend-coordinated signature
--                                change — see handoff). Per task: do not guess → flag for review.
--
-- ROLE NOTE: task said 'recovery_officer' but app_users.role has no such value (real: owner/recovery/
-- manager). Used 'recovery' so recovery officers retain on-demand radar access. Flagged for review.
-- Signatures, return types, SECURITY DEFINER, search_path, and EXCEPTION logic preserved; only guard added.

-- ════════════════════════ 1. create_payment_link ════════════════════════
CREATE OR REPLACE FUNCTION public.create_payment_link(p_company_id uuid, p_client_id uuid, p_sale_id uuid, p_installment_ids uuid[], p_amount numeric, p_description text DEFAULT NULL::text, p_sent_by text DEFAULT 'system'::text, p_sent_by_user_id uuid DEFAULT NULL::uuid, p_expires_in_days integer DEFAULT 7, p_selected_method_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_client_name   TEXT;
  v_wa_phone      TEXT;
  v_unit_number   TEXT;
  v_project_name  TEXT;
  v_company_name  TEXT;
  v_methods       JSONB := '[]';
  v_ref_code      TEXT;
  v_message       TEXT;
  v_wa_url        TEXT;
  v_link_id       UUID;
  v_expires_at    TIMESTAMPTZ;
  v_due_date_text TEXT;
  v_clean_phone   TEXT;
  v_me            public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin','finance')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success',false,'error','amount_must_be_positive');
  END IF;

  SELECT full_name, COALESCE(NULLIF(TRIM(whatsapp),''), NULLIF(TRIM(phone_primary),''))
  INTO v_client_name, v_wa_phone
  FROM public.clients WHERE id = p_client_id AND company_id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','client_not_found'); END IF;
  IF v_wa_phone IS NULL THEN RETURN jsonb_build_object('success',false,'error','client_no_phone'); END IF;

  SELECT u.unit_no, proj.project_name, co.company_name
  INTO v_unit_number, v_project_name, v_company_name
  FROM public.sales s
  JOIN public.units    u    ON u.id    = s.unit_id
  JOIN public.projects proj ON proj.id = s.project_id
  JOIN public.companies co  ON co.id   = s.company_id
  WHERE s.id = p_sale_id AND s.company_id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','sale_not_found'); END IF;

  SELECT TO_CHAR(MIN(due_date),'DD-Mon-YYYY') INTO v_due_date_text
  FROM public.installments WHERE id = ANY(p_installment_ids) AND company_id = p_company_id;

  SELECT jsonb_agg(jsonb_build_object(
    'id',id,'method_type',method_type,'account_title',account_title,
    'account_number',account_number,'bank_name',COALESCE(bank_name,''),
    'iban',COALESCE(iban,''),'display_order',display_order
  ) ORDER BY display_order, method_type)
  INTO v_methods FROM public.company_payment_methods
  WHERE company_id = p_company_id AND is_active = TRUE
    AND (p_selected_method_ids IS NULL OR id = ANY(p_selected_method_ids));
  IF v_methods IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_payment_methods'); END IF;

  v_ref_code := public.generate_payment_link_ref(p_company_id);
  v_message  := public.build_whatsapp_message(
    'initial',v_client_name,v_unit_number,v_project_name,
    p_amount,v_due_date_text,v_ref_code,v_methods,v_company_name);

  v_clean_phone := REGEXP_REPLACE(v_wa_phone,'[^0-9]','','g');
  IF LEFT(v_clean_phone,1)='0' THEN v_clean_phone:='92'||SUBSTRING(v_clean_phone FROM 2);
  ELSIF LEFT(v_clean_phone,4)='0092' THEN v_clean_phone:='92'||SUBSTRING(v_clean_phone FROM 5);
  ELSIF LEFT(v_clean_phone,2)!='92' THEN v_clean_phone:='92'||v_clean_phone; END IF;
  v_wa_url := 'https://wa.me/'||v_clean_phone;

  IF p_expires_in_days IS NOT NULL AND p_expires_in_days > 0 THEN
    v_expires_at := NOW()+(p_expires_in_days||' days')::interval;
  END IF;

  INSERT INTO public.payment_links(
    company_id,ref_code,client_id,sale_id,installment_ids,
    requested_amount,description,whatsapp_phone,payment_methods_offered,
    message_text,whatsapp_url,sent_by,sent_by_user_id,expires_at,status)
  VALUES(p_company_id,v_ref_code,p_client_id,p_sale_id,COALESCE(p_installment_ids,'{}'),
    p_amount,
    COALESCE(p_description,'Installment payment for '||v_unit_number||' - '||v_project_name),
    v_wa_phone,v_methods,v_message,v_wa_url,p_sent_by,p_sent_by_user_id,v_expires_at,'sent')
  RETURNING id INTO v_link_id;

  INSERT INTO public.payment_link_status_history
    (payment_link_id,from_status,to_status,changed_by,changed_by_user_id,notes)
  VALUES(v_link_id,NULL,'sent',p_sent_by,p_sent_by_user_id,'Payment link created');

  INSERT INTO public.contact_logs(company_id,client_id,channel,direction,contact_date,remarks,created_by)
  VALUES(p_company_id,p_client_id,'whatsapp','outbound',CURRENT_DATE,
    'Payment link sent: '||v_ref_code||' — PKR '||TO_CHAR(p_amount,'FM999,999,999,999'),p_sent_by);

  RETURN jsonb_build_object('success',true,'id',v_link_id,
    'ref_code',v_ref_code,'whatsapp_url',v_wa_url,'message_text',v_message);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success',false,'error',SQLERRM);
END;
$function$;

-- ════════════════════════ 2. reject_payment_link ════════════════════════
CREATE OR REPLACE FUNCTION public.reject_payment_link(p_payment_link_id uuid, p_rejected_by text, p_rejection_reason text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_link         RECORD; v_clean_phone TEXT; v_message TEXT; v_wa_url TEXT;
  v_client_name  TEXT;   v_unit_number TEXT; v_project_name TEXT; v_company_name TEXT;
  v_me           public.app_users; v_tenant uuid;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin','finance')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) THEN
    SELECT company_id INTO v_tenant FROM public.payment_links WHERE id = p_payment_link_id;
    IF v_tenant IS DISTINCT FROM v_me.company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  END IF;

  SELECT pl.* INTO v_link FROM public.payment_links pl WHERE pl.id = p_payment_link_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','link_not_found'); END IF;
  IF v_link.status != 'screenshot_received' THEN
    RETURN jsonb_build_object('success',false,'error','invalid_status','current_status',v_link.status);
  END IF;
  SELECT c.full_name, u.unit_no, proj.project_name, co.company_name
  INTO v_client_name, v_unit_number, v_project_name, v_company_name
  FROM public.sales s
  JOIN public.clients  c    ON c.id    = s.client_id
  JOIN public.units    u    ON u.id    = s.unit_id
  JOIN public.projects proj ON proj.id = s.project_id
  JOIN public.companies co  ON co.id   = s.company_id
  WHERE s.id = v_link.sale_id;
  UPDATE public.payment_links SET status='rejected',rejection_reason=p_rejection_reason,updated_at=NOW()
  WHERE id=p_payment_link_id;
  INSERT INTO public.payment_link_status_history(payment_link_id,from_status,to_status,changed_by,notes)
  VALUES(p_payment_link_id,'screenshot_received','rejected',p_rejected_by,COALESCE(p_rejection_reason,'Rejected'));
  v_message := public.build_whatsapp_message('rejection',
    v_client_name,v_unit_number,v_project_name,v_link.requested_amount,
    NULL,v_link.ref_code,'[]'::jsonb,v_company_name,NULL,NULL,NULL,p_rejection_reason);
  v_clean_phone := REGEXP_REPLACE(v_link.whatsapp_phone,'[^0-9]','','g');
  IF LEFT(v_clean_phone,1)='0' THEN v_clean_phone:='92'||SUBSTRING(v_clean_phone FROM 2);
  ELSIF LEFT(v_clean_phone,4)='0092' THEN v_clean_phone:='92'||SUBSTRING(v_clean_phone FROM 5);
  ELSIF LEFT(v_clean_phone,2)!='92' THEN v_clean_phone:='92'||v_clean_phone; END IF;
  v_wa_url := 'https://wa.me/'||v_clean_phone;
  RETURN jsonb_build_object('success',true,'rejection_whatsapp_url',v_wa_url,'rejection_message',v_message);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error',SQLERRM);
END;
$function$;

-- ════════════════════════ 3. verify_payment_link ════════════════════════
-- Guard runs BEFORE the record_payment() money writes.
CREATE OR REPLACE FUNCTION public.verify_payment_link(p_payment_link_id uuid, p_verified_by text, p_verified_by_user_id uuid DEFAULT NULL::uuid, p_actual_amount numeric DEFAULT NULL::numeric, p_payment_date date DEFAULT CURRENT_DATE, p_payment_method text DEFAULT 'bank_transfer'::text, p_bank_ref text DEFAULT NULL::text, p_verification_notes text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_link           RECORD;
  v_inst           RECORD;
  v_result         JSONB;
  v_remaining      NUMERIC;
  v_alloc          NUMERIC;
  v_first_pay_id   UUID;
  v_last_prv       TEXT;
  v_pay_ids        UUID[] := '{}';
  v_prv_numbers    TEXT[] := '{}';
  v_wa_url         TEXT;
  v_message        TEXT;
  v_clean_phone    TEXT;
  v_notes_with_ref TEXT;
  v_client_name    TEXT;
  v_unit_number    TEXT;
  v_project_name   TEXT;
  v_company_name   TEXT;
  v_me             public.app_users;
  v_tenant         uuid;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin','finance')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) THEN
    SELECT company_id INTO v_tenant FROM public.payment_links WHERE id = p_payment_link_id;
    IF v_tenant IS DISTINCT FROM v_me.company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  END IF;

  SELECT pl.* INTO v_link FROM public.payment_links pl WHERE pl.id = p_payment_link_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','link_not_found'); END IF;
  IF v_link.status != 'screenshot_received' THEN
    RETURN jsonb_build_object('success',false,'error','invalid_status',
      'current_status',v_link.status,'hint','Upload screenshot first');
  END IF;

  SELECT c.full_name, u.unit_no, proj.project_name, co.company_name
  INTO v_client_name, v_unit_number, v_project_name, v_company_name
  FROM public.sales s
  JOIN public.clients  c    ON c.id    = s.client_id
  JOIN public.units    u    ON u.id    = s.unit_id
  JOIN public.projects proj ON proj.id = s.project_id
  JOIN public.companies co  ON co.id   = s.company_id
  WHERE s.id = v_link.sale_id;

  v_remaining      := COALESCE(p_actual_amount, v_link.requested_amount);
  v_notes_with_ref := TRIM(CONCAT_WS(' | ','Payment Link: '||v_link.ref_code,
    NULLIF(TRIM(COALESCE(p_bank_ref,'')),  ''),
    NULLIF(TRIM(COALESCE(p_verification_notes,'')), '')));

  IF array_length(v_link.installment_ids,1) > 0 THEN
    FOR v_inst IN
      SELECT i.id, i.amount_due, i.amount_paid,
             GREATEST(i.amount_due - i.amount_paid,0) AS outstanding,
             i.installment_type
      FROM public.installments i
      WHERE i.id = ANY(v_link.installment_ids) AND i.company_id = v_link.company_id
      ORDER BY i.due_date ASC NULLS LAST, i.installment_number ASC
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_alloc := LEAST(v_remaining, v_inst.outstanding);
      IF v_alloc <= 0 THEN CONTINUE; END IF;
      v_result := public.record_payment(
        p_company_id=>v_link.company_id,p_sale_id=>v_link.sale_id,
        p_installment_id=>v_inst.id,
        p_is_down_payment=>(v_inst.installment_type='down_payment'),
        p_amount=>v_alloc,p_payment_date=>p_payment_date,
        p_payment_method=>p_payment_method,
        p_reference_no=>p_bank_ref,p_notes=>v_notes_with_ref,
        p_created_by=>p_verified_by_user_id);
      IF NOT (v_result->>'success')::boolean THEN
        RETURN jsonb_build_object('success',false,'error',
          'payment_failed: '||COALESCE(v_result->>'error','unknown'));
      END IF;
      v_pay_ids     := v_pay_ids     || (v_result->>'payment_id')::uuid;
      v_prv_numbers := v_prv_numbers || (v_result->>'voucher_code')::text;
      v_remaining   := v_remaining - v_alloc;
    END LOOP;
  ELSE
    v_result := public.record_payment(
      p_company_id=>v_link.company_id,p_sale_id=>v_link.sale_id,
      p_installment_id=>NULL,p_is_down_payment=>FALSE,
      p_amount=>COALESCE(p_actual_amount,v_link.requested_amount),
      p_payment_date=>p_payment_date,p_payment_method=>p_payment_method,
      p_reference_no=>p_bank_ref,p_notes=>v_notes_with_ref,
      p_created_by=>p_verified_by_user_id);
    IF NOT (v_result->>'success')::boolean THEN
      RETURN jsonb_build_object('success',false,'error',
        'payment_failed: '||COALESCE(v_result->>'error','unknown'));
    END IF;
    v_pay_ids     := ARRAY[(v_result->>'payment_id')::uuid];
    v_prv_numbers := ARRAY[v_result->>'voucher_code'];
  END IF;

  v_first_pay_id := v_pay_ids[1];
  v_last_prv     := v_prv_numbers[array_length(v_prv_numbers,1)];

  UPDATE public.payment_links SET
    status='verified',verified_by=p_verified_by,
    verified_by_user_id=p_verified_by_user_id,verified_at=NOW(),
    verification_notes=p_verification_notes,
    payment_id=v_first_pay_id,prv_number=v_last_prv,updated_at=NOW()
  WHERE id=p_payment_link_id;

  INSERT INTO public.payment_link_status_history
    (payment_link_id,from_status,to_status,changed_by,changed_by_user_id,notes)
  VALUES(p_payment_link_id,'screenshot_received','verified',
    p_verified_by,p_verified_by_user_id,'Verified. PRV: '||COALESCE(v_last_prv,'N/A'));

  v_clean_phone := REGEXP_REPLACE(v_link.whatsapp_phone,'[^0-9]','','g');
  IF LEFT(v_clean_phone,1)='0' THEN v_clean_phone:='92'||SUBSTRING(v_clean_phone FROM 2);
  ELSIF LEFT(v_clean_phone,4)='0092' THEN v_clean_phone:='92'||SUBSTRING(v_clean_phone FROM 5);
  ELSIF LEFT(v_clean_phone,2)!='92' THEN v_clean_phone:='92'||v_clean_phone; END IF;
  v_message := public.build_whatsapp_message('confirmation',
    v_client_name,v_unit_number,v_project_name,
    COALESCE(p_actual_amount,v_link.requested_amount),
    NULL,v_link.ref_code,'[]'::jsonb,v_company_name,
    NULL,v_last_prv,TO_CHAR(p_payment_date,'DD-Mon-YYYY'));
  v_wa_url := 'https://wa.me/'||v_clean_phone;

  RETURN jsonb_build_object('success',true,'payment_id',v_first_pay_id,'prv_number',v_last_prv,
    'all_prv_numbers',to_jsonb(v_prv_numbers),
    'confirmation_whatsapp_url',v_wa_url,'confirmation_message',v_message);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success',false,'error',SQLERRM);
END;
$function$;

-- ════════════════════════ 4. create_demand_notice ════════════════════════
-- Existing _rms_caller + tenant compare KEPT; added null-check (close no-session hole) + owner/admin role.
CREATE OR REPLACE FUNCTION public.create_demand_notice(p_sale_id uuid, p_company_id uuid, p_channel text DEFAULT 'print'::text, p_overdue_amount numeric DEFAULT NULL::numeric, p_due_date date DEFAULT NULL::date)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_me        public.app_users;
  v_client_id uuid;
  v_year      int  := EXTRACT(YEAR FROM CURRENT_DATE)::int;
  v_seq       int;
  v_notice_no text;
  v_id        uuid;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF v_me.id IS NOT NULL AND v_me.company_id != p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  SELECT client_id INTO v_client_id
  FROM public.sales
  WHERE id = p_sale_id AND company_id = p_company_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'sale_not_found');
  END IF;

  SELECT COALESCE(MAX(
    CASE
      WHEN notice_no ~ ('^DN-' || v_year || '-[0-9]+$')
      THEN SUBSTRING(notice_no FROM LENGTH('DN-' || v_year || '-') + 1)::int
      ELSE 0
    END
  ), 0) + 1
  INTO v_seq
  FROM public.demand_notices
  WHERE company_id = p_company_id
    AND notice_no LIKE 'DN-' || v_year || '-%';

  v_notice_no := 'DN-' || v_year || '-' || LPAD(v_seq::text, 4, '0');

  INSERT INTO public.demand_notices
    (company_id, sale_id, client_id, notice_no, notice_date,
     overdue_amount, due_date, channel, issued_by)
  VALUES
    (p_company_id, p_sale_id, v_client_id, v_notice_no, CURRENT_DATE,
     p_overdue_amount, p_due_date, COALESCE(p_channel, 'print'),
     CASE WHEN v_me.id IS NOT NULL THEN v_me.id ELSE NULL END)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'success',     true,
    'id',          v_id,
    'notice_no',   v_notice_no,
    'notice_date', CURRENT_DATE
  );
END;
$function$;

-- ════════════════════════ 6. generate_recovery_radar ════════════════════════
-- DUAL caller. App users: role(owner/admin/recovery) + tenant on p_company_id (super bypass).
-- Session-less callers allowed ONLY if pg_cron (session_user='postgres') or service_role JWT.
CREATE OR REPLACE FUNCTION public.generate_recovery_radar(p_company_id uuid, p_target_date date DEFAULT CURRENT_DATE, p_top_n integer DEFAULT 5, p_generated_by text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_rec          RECORD;
  v_all_scores   JSONB    := '[]'::JSONB;
  v_reasons      TEXT[];
  v_pat_score    INTEGER  := 0;
  v_sal_score    INTEGER  := 0;
  v_pro_score    INTEGER  := 0;
  v_con_score    INTEGER  := 0;
  v_ovd_score    INTEGER  := 0;
  v_pdc_penalty  INTEGER  := 0;
  v_agt_bonus    INTEGER  := 0;
  v_final_score  INTEGER;
  v_pay_days     INTEGER[];
  v_pay_count    INTEGER;
  v_mode_day     INTEGER;
  v_stddev       NUMERIC;
  v_ovd_days     INTEGER;
  v_ovd_amount   NUMERIC;
  v_total_out    NUMERIC;
  v_last_cdate   DATE;
  v_con_outcome  TEXT;
  v_con_days     INTEGER;
  v_promise_date DATE;
  v_promise_diff INTEGER;
  v_kept_cnt     INTEGER;
  v_total_cnt    INTEGER;
  v_bounce_cnt   INTEGER;
  v_sale_id      UUID;
  v_unit_no      TEXT;
  v_project_nm   TEXT;
  v_target_day   INTEGER;
  v_analyzed     INTEGER := 0;
  v_total_pot    NUMERIC := 0;
  v_top_clients  JSONB;
  v_result_row   recovery_radar_logs;
  v_agent_found  BOOLEAN;
  v_ord          TEXT;
  -- next_action additions
  v_next_action     TEXT    := 'send_reminder';
  v_next_action_msg TEXT    := 'Send payment reminder via WhatsApp';
  v_legal_cnt       INTEGER := 0;
  v_broken_cnt      INTEGER := 0;
  v_pdc_30d_bounce  INTEGER := 0;
  v_me              public.app_users;
BEGIN
  -- AUTHZ (batch 3): app users restricted by role+tenant; session-less allowed only for cron/service_role.
  v_me := public._rms_caller();
  IF v_me.id IS NOT NULL THEN
    IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin','recovery')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
    IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  ELSE
    IF NOT ( session_user = 'postgres'
             OR COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'role','') = 'service_role' )
       THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  END IF;

  v_target_day := EXTRACT(DAY FROM p_target_date)::INTEGER;

  v_sal_score := CASE
    WHEN v_target_day = 1            THEN 20
    WHEN v_target_day IN (2, 3)      THEN 15
    WHEN v_target_day IN (15, 16)    THEN 12
    WHEN v_target_day = 25           THEN 8
    ELSE 0
  END;

  FOR v_rec IN
    SELECT DISTINCT c.id AS client_id, c.full_name AS client_name,
           c.phone_primary AS phone, c.client_code
    FROM   clients c
    JOIN   sales s        ON s.client_id  = c.id
                         AND s.company_id = p_company_id
                         AND s.status     = 'active'
    JOIN   installments i ON i.sale_id    = s.id
                         AND i.paid_at    IS NULL
    WHERE  c.company_id = p_company_id
      AND  c.status     = 'active'
  LOOP
    v_analyzed    := v_analyzed + 1;
    -- Reset all per-client variables
    v_reasons      := ARRAY[]::TEXT[];
    v_pat_score    := 0;
    v_pro_score    := 0;
    v_con_score    := 0;
    v_ovd_score    := 0;
    v_pdc_penalty  := 0;
    v_agt_bonus    := 0;
    v_sale_id      := NULL;
    v_unit_no      := NULL;
    v_project_nm   := NULL;
    v_last_cdate   := NULL;
    v_con_outcome  := NULL;
    v_con_days     := NULL;
    v_promise_date := NULL;
    v_next_action     := 'send_reminder';
    v_next_action_msg := 'Send payment reminder via WhatsApp';
    v_legal_cnt       := 0;
    v_broken_cnt      := 0;
    v_pdc_30d_bounce  := 0;

    SELECT s.id, u.unit_no, COALESCE(pr.project_name, '')
    INTO   v_sale_id, v_unit_no, v_project_nm
    FROM   sales s
    LEFT JOIN units    u  ON u.id  = s.unit_id
    LEFT JOIN projects pr ON pr.id = u.project_id
    WHERE  s.client_id  = v_rec.client_id
      AND  s.company_id = p_company_id
      AND  s.status     = 'active'
    ORDER BY s.created_at DESC
    LIMIT 1;

    SELECT
      MIN(CASE WHEN i.due_date < p_target_date THEN (p_target_date - i.due_date) END)::INTEGER,
      COALESCE(SUM(CASE WHEN i.due_date < p_target_date THEN (i.amount_due - i.amount_paid) ELSE 0 END), 0),
      COALESCE(SUM(i.amount_due - i.amount_paid), 0)
    INTO v_ovd_days, v_ovd_amount, v_total_out
    FROM installments i
    JOIN sales s ON s.id = i.sale_id AND s.company_id = p_company_id
    WHERE s.client_id = v_rec.client_id AND i.paid_at IS NULL;

    IF v_total_out <= 0 THEN CONTINUE; END IF;

    -- Factor 1: Payment Pattern
    SELECT ARRAY_AGG(EXTRACT(DAY FROM p.payment_date)::INTEGER)
    INTO   v_pay_days
    FROM   payments p
    WHERE  p.client_id  = v_rec.client_id
      AND  p.company_id = p_company_id
      AND  p.payment_date >= p_target_date - INTERVAL '6 months';

    v_pay_count := COALESCE(ARRAY_LENGTH(v_pay_days, 1), 0);

    IF v_pay_count >= 2 THEN
      SELECT
        (SELECT d FROM UNNEST(v_pay_days) d GROUP BY d ORDER BY COUNT(*) DESC, d LIMIT 1),
        COALESCE(STDDEV(d::NUMERIC), 0)
      INTO v_mode_day, v_stddev
      FROM UNNEST(v_pay_days) d;

      v_ord := CASE WHEN v_mode_day IN (1,21,31) THEN 'st'
                    WHEN v_mode_day IN (2,22)    THEN 'nd'
                    WHEN v_mode_day IN (3,23)    THEN 'rd' ELSE 'th' END;

      IF    v_stddev <= 2 AND ABS(v_target_day - v_mode_day) <= 2 THEN
        v_pat_score := 30;
        v_reasons   := array_append(v_reasons, 'Pays on ' || v_mode_day || v_ord || ' regularly');
      ELSIF v_stddev <= 5 AND ABS(v_target_day - v_mode_day) <= 5 THEN
        v_pat_score := 20;
        v_reasons   := array_append(v_reasons, 'Usually pays around ' || v_mode_day || v_ord);
      ELSIF v_pay_count >= 3 THEN
        v_pat_score := 10;
      END IF;
    END IF;

    -- Factor 2: Salary
    IF v_sal_score > 0 THEN
      v_reasons := array_append(v_reasons, 'Salary date match (' || v_target_day ||
        CASE WHEN v_target_day IN (1,21,31) THEN 'st' WHEN v_target_day IN (2,22) THEN 'nd'
             WHEN v_target_day IN (3,23) THEN 'rd' ELSE 'th' END || ')');
    END IF;

    -- Factor 3: Promise
    SELECT promise_date INTO v_promise_date
    FROM   payment_promises
    WHERE  client_id  = v_rec.client_id
      AND  company_id = p_company_id
      AND  status     = 'pending'
      AND  promise_date BETWEEN p_target_date - 1 AND p_target_date + 3
    ORDER BY ABS(promise_date - p_target_date) ASC
    LIMIT 1;

    IF v_promise_date IS NOT NULL THEN
      v_promise_diff := v_promise_date - p_target_date;
      IF    v_promise_diff = 0     THEN v_pro_score := 25; v_reasons := array_append(v_reasons, 'Promise to pay today');
      ELSIF ABS(v_promise_diff)= 1 THEN v_pro_score := 20;
            v_reasons := array_append(v_reasons, CASE WHEN v_promise_diff>0 THEN 'Promise tomorrow' ELSE 'Promise yesterday' END);
      ELSE  v_pro_score := 10; v_reasons := array_append(v_reasons, 'Promise in '||v_promise_diff||' days');
      END IF;

      SELECT COUNT(*) FILTER (WHERE status='kept'),
             COUNT(*) FILTER (WHERE status IN ('kept','broken'))
      INTO   v_kept_cnt, v_total_cnt
      FROM   payment_promises
      WHERE  client_id=v_rec.client_id AND company_id=p_company_id;

      IF v_total_cnt >= 3 AND v_kept_cnt::NUMERIC/v_total_cnt >= 0.70 THEN
        v_pro_score := v_pro_score + 5;
        v_reasons   := array_append(v_reasons,'Good promise history ('||ROUND(v_kept_cnt::NUMERIC/v_total_cnt*100)||'% kept)');
      END IF;
    END IF;

    -- Factor 4: Contact Recency
    SELECT cl.contact_date,
      CASE WHEN cl.call_status='answered'            THEN 'answered'
           WHEN cl.response_received ILIKE 'answer%' THEN 'answered'
           WHEN cl.promise_to_pay=true               THEN 'promised'
           WHEN cl.response_received ILIKE 'refus%'  THEN 'refused'
           WHEN cl.response_received ILIKE 'reject%' THEN 'refused'
           ELSE 'no_answer' END
    INTO v_last_cdate, v_con_outcome
    FROM contact_logs cl
    WHERE cl.client_id=v_rec.client_id AND cl.company_id=p_company_id
    ORDER BY cl.contact_date DESC, cl.created_at DESC LIMIT 1;

    IF v_last_cdate IS NOT NULL THEN
      v_con_days := (p_target_date - v_last_cdate);
      IF    v_con_days<=1  AND v_con_outcome IN ('answered','promised') THEN
        v_con_score:=10; v_reasons:=array_append(v_reasons,'Answered '||CASE WHEN v_con_days=0 THEN 'today' ELSE 'yesterday' END);
      ELSIF v_con_days<=3  AND v_con_outcome IN ('answered','promised') THEN
        v_con_score:=7;  v_reasons:=array_append(v_reasons,'Positive contact '||v_con_days||'d ago');
      ELSIF v_con_days<=7  AND v_con_outcome<>'refused' THEN v_con_score:=4;
      ELSIF v_con_days<=14                               THEN v_con_score:=2;
      END IF;
    END IF;

    -- Factor 5: Overdue Sweet Spot
    IF v_ovd_days IS NOT NULL THEN
      v_ovd_score := CASE WHEN v_ovd_days BETWEEN  7 AND 30 THEN 10
                          WHEN v_ovd_days BETWEEN 31 AND 60 THEN 7
                          WHEN v_ovd_days BETWEEN 61 AND 90 THEN 5
                          WHEN v_ovd_days BETWEEN  1 AND  6 THEN 4
                          ELSE 2 END;
      IF v_ovd_days BETWEEN 7 AND 30 THEN
        v_reasons := array_append(v_reasons, v_ovd_days||'-day overdue (sweet spot)');
      END IF;
    END IF;

    -- Factor 6: PDC Penalty (12-month bounce history)
    SELECT COUNT(*) INTO v_bounce_cnt
    FROM   pdc_cheques
    WHERE  client_id=v_rec.client_id AND company_id=p_company_id AND status='bounced'
      AND  COALESCE(bounce_date, created_at::date) >= p_target_date - INTERVAL '12 months';

    v_pdc_penalty := LEAST(v_bounce_cnt*5, 15);
    IF v_bounce_cnt > 0 THEN
      v_reasons := array_append(v_reasons, v_bounce_cnt||' PDC bounce(s) in 12 months');
    END IF;

    -- ── Next Best Action (priority order — first match wins) ──────────────
    -- Rule 1: active legal case
    SELECT COUNT(*) INTO v_legal_cnt
    FROM legal_cases
    WHERE client_id = v_rec.client_id AND company_id = p_company_id
      AND outcome IS NULL;

    -- Rule 2: PDC bounce in last 30 days
    SELECT COUNT(*) INTO v_pdc_30d_bounce
    FROM pdc_cheques
    WHERE client_id = v_rec.client_id AND company_id = p_company_id
      AND status = 'bounced'
      AND COALESCE(bounce_date, created_at::date) >= p_target_date - 30;

    -- Rule 3: broken promises count
    SELECT COUNT(*) INTO v_broken_cnt
    FROM payment_promises
    WHERE client_id = v_rec.client_id AND company_id = p_company_id
      AND status = 'broken';

    IF v_legal_cnt > 0 THEN
      v_next_action     := 'coordinate_legal';
      v_next_action_msg := 'Legal case active — coordinate with lawyer';
    ELSIF v_pdc_30d_bounce > 0 THEN
      v_next_action     := 'hold_pdc';
      v_next_action_msg := 'Recent PDC bounce — hold cheque for re-deposit or replacement';
    ELSIF v_broken_cnt >= 3 THEN
      v_next_action     := 'escalate';
      v_next_action_msg := 'Multiple broken promises — escalate to senior officer';
    ELSIF COALESCE(v_ovd_days, 0) > 90 THEN
      v_next_action     := 'legal_notice';
      v_next_action_msg := 'Severely overdue — send legal notice';
    ELSIF COALESCE(v_ovd_days, 0) BETWEEN 30 AND 90
          AND (v_last_cdate IS NULL OR COALESCE(v_con_days, 999) > 14) THEN
      v_next_action     := 'field_visit';
      v_next_action_msg := 'No contact for 14+ days — schedule field visit';
    ELSIF COALESCE(v_ovd_days, 0) BETWEEN 7 AND 30 AND v_promise_date IS NOT NULL THEN
      v_next_action     := 'follow_up_promise';
      v_next_action_msg := 'Active promise — follow up on commitment';
    ELSIF COALESCE(v_ovd_days, 0) BETWEEN 1 AND 30 THEN
      v_next_action     := 'call';
      v_next_action_msg := 'Overdue — call client today';
    -- else default 'send_reminder' already set
    END IF;

    -- Factor 7: Agent Boost
    SELECT EXISTS (
      SELECT 1 FROM contact_logs
      WHERE client_id=v_rec.client_id AND company_id=p_company_id
        AND recovery_agent_id IS NOT NULL AND contact_date >= p_target_date-7
    ) INTO v_agent_found;
    IF v_agent_found THEN v_agt_bonus:=5; END IF;

    v_final_score := GREATEST(0, LEAST(100,
      v_pat_score+v_sal_score+v_pro_score+v_con_score+v_ovd_score+v_agt_bonus-v_pdc_penalty
    ));

    v_all_scores := v_all_scores || jsonb_build_object(
      'client_id',           v_rec.client_id,
      'client_name',         v_rec.client_name,
      'client_code',         v_rec.client_code,
      'phone',               v_rec.phone,
      'sale_id',             v_sale_id,
      'unit_no',             v_unit_no,
      'project_name',        v_project_nm,
      'final_score',         v_final_score,
      'overdue_amount',      v_ovd_amount,
      'total_outstanding',   v_total_out,
      'oldest_overdue_days', v_ovd_days,
      'reasons',             to_jsonb(v_reasons),
      'breakdown',           jsonb_build_object(
        'pattern',    v_pat_score, 'salary',      v_sal_score,
        'promise',    v_pro_score, 'contact',     v_con_score,
        'overdue',    v_ovd_score, 'pdc_penalty', -v_pdc_penalty,
        'agent_bonus',v_agt_bonus
      ),
      'next_action',         v_next_action,
      'next_action_message', v_next_action_msg
    );
  END LOOP;

  WITH ranked AS (
    SELECT elem FROM jsonb_array_elements(v_all_scores) elem
    ORDER BY (elem->>'final_score')::INTEGER DESC LIMIT p_top_n
  )
  SELECT COALESCE(jsonb_agg(elem),'[]'::JSONB) INTO v_top_clients FROM ranked;

  SELECT COALESCE(SUM((c->>'overdue_amount')::NUMERIC),0) INTO v_total_pot
  FROM   jsonb_array_elements(COALESCE(v_top_clients,'[]')) c;

  INSERT INTO recovery_radar_logs
    (company_id,generated_date,generated_at,generated_by,
     top_clients,total_potential_recovery,clients_analyzed,algorithm_version)
  VALUES
    (p_company_id,p_target_date,NOW(),p_generated_by,
     COALESCE(v_top_clients,'[]'),v_total_pot,v_analyzed,'v2.0')
  ON CONFLICT (company_id,generated_date) DO UPDATE SET
    generated_at=NOW(), generated_by=EXCLUDED.generated_by,
    top_clients=EXCLUDED.top_clients,
    total_potential_recovery=EXCLUDED.total_potential_recovery,
    clients_analyzed=EXCLUDED.clients_analyzed,
    algorithm_version=EXCLUDED.algorithm_version
  RETURNING * INTO v_result_row;

  RETURN row_to_json(v_result_row)::JSONB;
END;
$function$;
