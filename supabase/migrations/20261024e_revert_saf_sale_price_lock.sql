-- 20261024e: revert 20261024c completely (Rashid 2026-10-24: Naseer and the Awami
-- login must not need any approval). The six functions go back to exactly their
-- definitions before 20261024c; the two helpers 20261024c added are dropped.
-- 20261024b (_saf_make_sale nets token refunds) stays.

CREATE OR REPLACE FUNCTION public.edit_sale(p_sale_id uuid, p_company_id uuid, p_data jsonb, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_project uuid; v_found boolean; v_level text; v_ar jsonb; v_res jsonb;
  v_sale_row jsonb;
  v_protected_keys text[] := ARRAY['discount','discount_amount','discount_percentage','price_per_sqft','area_sqft',
    'status','cancellation_reason','cancellation_date','cancelled_by',
    'delivery_breach','breach_months','breach_reason_type','breach_reason_detail',
    'breach_approved_by','breach_approval_ref','breach_approved_at'];
  v_prot jsonb; v_benign jsonb; v_changed_prot int;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant'); END IF;
  SELECT true, project_id, to_jsonb(s.*) INTO v_found, v_project, v_sale_row
    FROM public.sales s WHERE id = p_sale_id AND company_id = p_company_id;
  IF NOT v_found THEN RETURN jsonb_build_object('success', false, 'error', 'sale_not_found'); END IF;

  SELECT jsonb_object_agg(k, p_data->k) INTO v_prot FROM unnest(v_protected_keys) k WHERE p_data ? k;
  v_benign := p_data - v_protected_keys;

  -- P2: reason REQUIRED only when a protected field's VALUE actually changes
  -- (numeric-aware so 0 vs 0.00 / 5000 vs 5000.00 are treated as equal).
  SELECT count(*) INTO v_changed_prot FROM unnest(v_protected_keys) k
   WHERE p_data ? k AND (
     CASE WHEN (p_data->>k) ~ '^-?[0-9]+(\.[0-9]+)?$' AND (v_sale_row->>k) ~ '^-?[0-9]+(\.[0-9]+)?$'
          THEN (p_data->>k)::numeric IS DISTINCT FROM (v_sale_row->>k)::numeric
          ELSE (p_data->>k) IS DISTINCT FROM (v_sale_row->>k)
     END);
  IF v_changed_prot > 0 THEN
    IF length(TRIM(COALESCE(p_reason,''))) < 10 THEN
      RETURN jsonb_build_object('success', false, 'error', 'reason_required',
        'message', 'A reason (at least 10 characters) is required for price/discount/status changes.');
    END IF;
    PERFORM set_config('rms.audit_reason', p_reason, true);
  END IF;

  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role = 'manager' THEN
      RETURN jsonb_build_object('success',false,'error','forbidden','message','Managers have read-only access.');
    END IF;
    IF v_project IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_project_assignments
        WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=v_project AND is_active) THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_not_assigned'); END IF;
  END IF;

  IF public._rms_is_admin(v_me) THEN
    RETURN public._edit_sale_core(p_sale_id, p_company_id, p_data);
  END IF;

  IF v_benign <> '{}'::jsonb THEN
    v_res := public._edit_sale_core(p_sale_id, p_company_id, v_benign);
    IF NOT COALESCE((v_res->>'success')::boolean,false) THEN RETURN v_res; END IF;
  END IF;

  IF v_prot IS NULL THEN RETURN jsonb_build_object('success', true); END IF;

  v_level := public._rms_restriction_level(p_company_id, 'sale_edit');
  IF v_level = 'hard' THEN
    RETURN jsonb_build_object('success', false, 'error', 'action_hard_blocked', 'action', 'sale_edit');
  ELSIF v_level = 'warning' THEN
    INSERT INTO public.audit_logs (company_id, table_name, record_id, action, new_data, is_sensitive, module, reason)
    VALUES (p_company_id, 'sales', p_sale_id::text, 'restriction_warning', v_prot, true, 'restrictions', p_reason);
    RETURN public._edit_sale_core(p_sale_id, p_company_id, v_prot);
  ELSE
    IF NULLIF(TRIM(COALESCE(p_reason,'')),'') IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'reason_required','message','A reason is required to request protected sale changes (discount/price/status).'); END IF;
    v_ar := public.create_approval_request(jsonb_build_object(
      'request_type','sale_edit','entity_table','sales','entity_id',p_sale_id,
      'project_id',v_project,'title','Protected sale edit','comment',p_reason,
      'payload',jsonb_build_object('sale_id',p_sale_id,'fields',v_prot)));
    IF NOT COALESCE((v_ar->>'success')::boolean,false) THEN RETURN v_ar; END IF;
    RETURN jsonb_build_object('success', true, 'status', 'pending_approval', 'request_id', v_ar->>'id');
  END IF;
END; $function$;

CREATE OR REPLACE FUNCTION public._edit_sale_core(p_sale_id uuid, p_company_id uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_allowed text[] := ARRAY[
    'sale_date','notes','client_id','agent_id','sale_type_id',
    'price_per_sqft','area_sqft','discount','down_payment','installment_count',
    'co_buyer_name','co_buyer_cnic','co_buyer_share_pct',
    'nominee_name','nominee_cnic','nominee_relation',
    'wht_amount','cvt_amount','discount_approved_by','discount_notes',
    'discount_amount','discount_percentage','payment_plan_type',
    'commission_rate','commission_notes',
    'status','cancellation_reason','cancellation_date','cancelled_by',
    'delivery_breach','breach_months','breach_reason_type','breach_reason_detail',
    'breach_approved_by','breach_approval_ref','breach_approved_at'];
  v_setters text := ''; v_key text; v_sql text;
BEGIN
  IF p_sale_id IS NULL OR p_company_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'missing_params'); END IF;
  IF NOT EXISTS (SELECT 1 FROM sales WHERE id = p_sale_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sale_not_found'); END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_data) LOOP
    IF v_key = ANY(v_allowed) THEN
      v_setters := v_setters || format('%I = NULLIF($1->>%L, %L)::%s, ', v_key, v_key, '',
        CASE v_key
          WHEN 'sale_date' THEN 'date' WHEN 'cancellation_date' THEN 'date'
          WHEN 'breach_approved_at' THEN 'date' WHEN 'client_id' THEN 'uuid'
          WHEN 'agent_id' THEN 'uuid' WHEN 'sale_type_id' THEN 'uuid'
          WHEN 'price_per_sqft' THEN 'numeric' WHEN 'area_sqft' THEN 'numeric' WHEN 'discount' THEN 'numeric'
          WHEN 'down_payment' THEN 'numeric' WHEN 'installment_count' THEN 'integer'
          WHEN 'co_buyer_share_pct' THEN 'numeric' WHEN 'wht_amount' THEN 'numeric'
          WHEN 'cvt_amount' THEN 'numeric' WHEN 'discount_amount' THEN 'numeric'
          WHEN 'discount_percentage' THEN 'numeric' WHEN 'commission_rate' THEN 'numeric'
          WHEN 'delivery_breach' THEN 'boolean'
          WHEN 'breach_months' THEN 'integer' ELSE 'text'
        END);
    END IF;
  END LOOP;
  IF v_setters = '' THEN RETURN jsonb_build_object('success', true, 'updated', 0); END IF;
  v_setters := v_setters || 'updated_at = now()';
  v_sql := format('UPDATE sales SET %s WHERE id = %L AND company_id = %L', v_setters, p_sale_id, p_company_id);
  EXECUTE v_sql USING p_data;
  RETURN jsonb_build_object('success', true, 'sale_id', p_sale_id);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;

CREATE OR REPLACE FUNCTION public.edit_installment_schedule(p_sale_id uuid, p_company_id uuid, p_schedule jsonb, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_project uuid; v_found boolean; v_level text; v_ar jsonb;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant'); END IF;

  SELECT true, project_id INTO v_found, v_project FROM public.sales WHERE id = p_sale_id AND company_id = p_company_id;
  IF NOT v_found THEN RETURN jsonb_build_object('success', false, 'error', 'sale_not_found'); END IF;

  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role = 'manager' THEN
      RETURN jsonb_build_object('success',false,'error','forbidden','message','Managers have read-only access.');
    END IF;
    IF v_project IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_project_assignments
        WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=v_project AND is_active) THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_not_assigned'); END IF;
  END IF;

  IF public._rms_is_admin(v_me) THEN
    RETURN public._edit_installment_schedule_core(p_sale_id, p_company_id, p_schedule);
  END IF;

  v_level := public._rms_restriction_level(p_company_id, 'schedule_change');
  IF v_level = 'hard' THEN
    RETURN jsonb_build_object('success', false, 'error', 'action_hard_blocked', 'action', 'schedule_change');
  ELSIF v_level = 'warning' THEN
    INSERT INTO public.audit_logs (company_id, table_name, record_id, action, is_sensitive, module, reason)
    VALUES (p_company_id, 'sales', p_sale_id::text, 'restriction_warning', true, 'restrictions', 'schedule_change');
    RETURN public._edit_installment_schedule_core(p_sale_id, p_company_id, p_schedule);
  ELSE
    IF NULLIF(TRIM(COALESCE(p_reason,'')),'') IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'reason_required','message','A reason is required to request schedule changes.'); END IF;
    v_ar := public.create_approval_request(jsonb_build_object(
      'request_type','schedule_change','entity_table','sales','entity_id',p_sale_id,
      'project_id',v_project,'title','Installment schedule change','comment',p_reason,
      'payload',jsonb_build_object('sale_id',p_sale_id,'schedule',p_schedule)));
    IF NOT COALESCE((v_ar->>'success')::boolean,false) THEN RETURN v_ar; END IF;
    RETURN jsonb_build_object('success', true, 'status', 'pending_approval', 'request_id', v_ar->>'id');
  END IF;
END; $function$;

CREATE OR REPLACE FUNCTION public.get_sale_for_edit(p_sale_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sale         jsonb;
  v_installments jsonb;
  v_me           public.app_users := public._rms_caller();
  v_all          boolean := (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids         uuid[];
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'sale_not_found');
  END IF;
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT to_jsonb(s) INTO v_sale FROM (
    SELECT id, sale_number, unit_id, client_id, agent_id, sale_date,
           price_per_sqft, area_sqft, total_amount, discount, net_amount,
           down_payment, remaining_amount, notes, co_buyer_name, co_buyer_cnic,
           co_buyer_share_pct, nominee_name, nominee_cnic, nominee_relation,
           wht_amount, cvt_amount, discount_approved_by, discount_notes, status,
           sale_type_id
    FROM sales WHERE id = p_sale_id AND company_id = p_company_id
      AND (v_all OR project_id = ANY(v_pids))
  ) s;
  IF v_sale IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'sale_not_found'); END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(i) ORDER BY i.installment_number), '[]'::jsonb)
  INTO v_installments FROM (
    SELECT id, installment_number, installment_type, due_date,
           amount_due, amount_paid, notes, status
    FROM installments WHERE sale_id = p_sale_id AND company_id = p_company_id
    ORDER BY installment_number
  ) i;
  RETURN jsonb_build_object('success', true, 'sale', v_sale, 'installments', v_installments);
END;
$function$;

CREATE OR REPLACE FUNCTION public.saf_submit(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c jsonb := public._saf_me(); v_row public.sale_approval_forms; v_blk jsonb; v_m jsonb; v_f jsonb; v_p jsonb;
        v_full boolean; v_now timestamptz := now(); v_snap jsonb; v_sale jsonb;
BEGIN
  IF c IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'no_session'); END IF;
  IF NOT (c->>'prepare')::boolean THEN RETURN jsonb_build_object('success', false, 'error', 'forbidden'); END IF;
  SELECT * INTO v_row FROM public.sale_approval_forms
   WHERE id = p_id AND company_id = (c->>'company_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  IF v_row.status <> 'draft' THEN RETURN jsonb_build_object('success', false, 'error', 'not_draft'); END IF;
  IF EXISTS (SELECT 1 FROM public.sales s WHERE s.unit_id = v_row.unit_id AND s.status = 'active') THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_sold', 'message', 'This unit already has an active sale.'); END IF;

  v_blk := public._saf_unit_block(v_row.unit_id);
  v_m   := public._saf_money(v_row.company_id, v_blk->>'unit_code');
  v_f := public._saf_compute(to_jsonb(v_row) || v_blk || jsonb_build_object('total_received', v_m->'total'));
  v_p := public._saf_problems(v_f);
  IF jsonb_array_length(v_p) > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'incomplete', 'problems', v_p,
      'message', 'This form cannot be submitted yet: ' || (v_p->>0)); END IF;
  v_full := COALESCE((v_f->>'discount_amount')::numeric, 0) <= 0
        AND COALESCE((v_f->>'net_price')::numeric, 0) >= COALESCE((v_blk->>'base_price')::numeric, 0);

  UPDATE public.sale_approval_forms SET
    status = 'submitted', approval_route = 'plan',  -- 20261017a: no director step any more
    unit_code = v_blk->>'unit_code', floor_label = v_blk->>'floor_label', block = v_blk->>'block',
    area_sqft = (v_blk->>'area_sqft')::numeric, rate_per_sqft = (v_blk->>'rate_per_sqft')::numeric,
    base_price = (v_blk->>'base_price')::numeric,
    net_price = (v_f->>'net_price')::numeric, dp_amount = (v_f->>'dp_amount')::numeric,
    discount_amount = (v_f->>'discount_amount')::numeric, discount_pct = (v_f->>'discount_pct')::numeric,
    discount_beyond_standard = (v_f->>'discount_beyond_standard')::boolean,
    installment_amount = (v_f->>'installment_amount')::numeric, schedule_json = v_f->'schedule_json',
    commission_amount = (v_f->>'commission_amount')::numeric,
    token_numbers = v_m->>'token_numbers', receipts = v_m->'receipts', total_received = (v_m->>'total')::numeric,
    dp_balance = (v_f->>'dp_balance')::numeric, money_as_of = v_now,
    buyer_cnic = regexp_replace(public._saf_digits(buyer_cnic), '^(\d{5})(\d{7})(\d)$', '\1-\2-\3'),
    submitted_by = (c->>'user_id')::uuid, submitted_by_name = c->>'name', submitted_at = v_now,
    accounts_verified_by = (c->>'user_id')::uuid, accounts_verified_by_name = c->>'name', accounts_verified_at = v_now,
    updated_at = v_now
  WHERE id = p_id;

  IF true THEN  -- 20261017a: every form, discount or not, makes the sale on submit
    SELECT * INTO v_row FROM public.sale_approval_forms WHERE id = p_id;
    IF v_row.supersedes_id IS NOT NULL THEN
      UPDATE public.sale_approval_forms SET status = 'superseded', superseded_by = v_row.id, updated_at = v_now
       WHERE id = v_row.supersedes_id AND status IN ('approved','rejected') AND sale_id IS NULL;
    END IF;
    v_snap := (to_jsonb(v_row) || jsonb_build_object('approved_at', v_now))
              - ARRAY['snapshot','snapshot_hash','pdf_sha256','pdf_path','sale_id','superseded_by','updated_at','status',
                      'filed_by','filed_by_name','filed_at'];
    UPDATE public.sale_approval_forms SET status = 'approved', approved_at = v_now, updated_at = v_now,
      snapshot = v_snap, snapshot_hash = encode(sha256(convert_to(v_snap::text, 'UTF8')), 'hex')
    WHERE id = p_id;
    -- 20261014b: no director needed, so the sale is made now
    v_sale := public._saf_make_sale(p_id, (c->>'user_id')::uuid, c->>'name');
    IF NOT COALESCE((v_sale->>'success')::boolean, false) THEN
      RAISE EXCEPTION 'The sale could not be made: %', COALESCE(v_sale->>'message', v_sale->>'error'); END IF;
  END IF;
  RETURN jsonb_build_object('success', true, 'saf', public._saf_view(p_id));
END $function$;

CREATE OR REPLACE FUNCTION public.saf_room_approve(p_token text, p_password text, p_id uuid, p_sign text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_co uuid := public._saf_room(p_token, p_password); s jsonb; v_row public.sale_approval_forms;
        v_blk jsonb; v_m jsonb; v_snap jsonb; v_now timestamptz := now(); v_sale jsonb;
BEGIN
  IF v_co IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'forbidden'); END IF;
  s := public._saf_signer(v_co, p_sign);
  IF s ? 'error' THEN RETURN public._saf_sign_error(s); END IF;
  SELECT * INTO v_row FROM public.sale_approval_forms WHERE id = p_id AND company_id = v_co FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  IF v_row.status NOT IN ('submitted','verified') THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_submitted',
      'message', 'This form is ' || v_row.status || ', not waiting for a director.'); END IF;
  IF EXISTS (SELECT 1 FROM public.sales s2 WHERE s2.unit_id = v_row.unit_id AND s2.status = 'active') THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_sold', 'message', 'This unit already has an active sale.'); END IF;

  v_blk := public._saf_unit_block(v_row.unit_id);
  v_m   := public._saf_money(v_row.company_id, v_row.unit_code);
  IF (v_blk->>'base_price')::numeric IS DISTINCT FROM v_row.base_price
     OR (v_blk->>'area_sqft')::numeric IS DISTINCT FROM v_row.area_sqft THEN
    RETURN jsonb_build_object('success', false, 'error', 'unit_changed',
      'message', 'The unit''s price or area changed after Accounts submitted this form. Decline it so Accounts can make a new one.'); END IF;
  IF (v_m->>'total')::numeric IS DISTINCT FROM v_row.total_received OR v_m->'receipts' IS DISTINCT FROM v_row.receipts THEN
    RETURN jsonb_build_object('success', false, 'error', 'money_changed',
      'message', 'NexuFinance shows different money for this unit than Accounts submitted. Decline it so Accounts can check and resubmit.'); END IF;

  IF v_row.supersedes_id IS NOT NULL THEN
    UPDATE public.sale_approval_forms SET status = 'superseded', superseded_by = v_row.id, updated_at = v_now
     WHERE id = v_row.supersedes_id AND status IN ('approved','rejected') AND sale_id IS NULL;
  END IF;
  v_snap := (to_jsonb(v_row) || jsonb_build_object(
               'approved_by', NULL, 'approved_by_sales_user', s->>'sales_user_id', 'approved_by_approver', s->>'approver_id',
               'approved_by_name', s->>'name', 'approved_at', v_now))
            - ARRAY['snapshot','snapshot_hash','pdf_sha256','pdf_path','sale_id','superseded_by','updated_at','status',
                    'filed_by','filed_by_name','filed_at'];
  UPDATE public.sale_approval_forms SET status = 'approved',
    approved_by = NULL, approved_by_sales_user = (s->>'sales_user_id')::uuid, approved_by_approver = (s->>'approver_id')::uuid,
    approved_by_name = s->>'name', approved_at = v_now, updated_at = v_now,
    snapshot = v_snap, snapshot_hash = encode(sha256(convert_to(v_snap::text, 'UTF8')), 'hex')
  WHERE id = p_id;
  -- 20261014b: approved, so the sale is made now, in the name of whoever prepared the form
  v_sale := public._saf_make_sale(p_id, v_row.prepared_by, v_row.prepared_by_name);
  IF NOT COALESCE((v_sale->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'Approved, but the sale could not be made: %', COALESCE(v_sale->>'message', v_sale->>'error'); END IF;
  RETURN jsonb_build_object('success', true, 'saf', public._saf_view(p_id), 'sale_number', v_sale->>'sale_number');
END $function$;

DROP FUNCTION IF EXISTS public._saf_sale_price_block(uuid, jsonb);
DROP FUNCTION IF EXISTS public._saf_sale_schedule_block(uuid, jsonb);
