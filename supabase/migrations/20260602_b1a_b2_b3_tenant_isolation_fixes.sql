-- ════════════════════════════════════════════════════════════════════════
-- 2026-06-02  Multi-tenant fixes from the 2-tenant test — batch B1a + B2 + B3
-- B1a: company-gate the 3 v_all read RPCs that leaked cross-tenant
--      (get_units_cache_bundle, get_contact_logs_cache, get_team_performance_lite).
-- B2 : per-company uniqueness for payments.voucher_code + unit_transfers.transfer_voucher_no
--      (both generated per-company but had a GLOBAL unique index/constraint -> 2nd-tenant collision).
--      payment_links.ref_code has the same class of bug but is a public URL token looked up by
--      ref_code alone -> composite is unsafe; DEFERRED to a separate batch (B2b, generator fix).
-- B3 : project-in-company guard on create_client / create_unit / create_agent /
--      bulk_create_units / upsert_unit (was: caller==company + admin, but no project ownership check).
-- DATA/function-guard + index only. No return-shape change. SECURITY DEFINER + search_path=public
-- preserved on every function. Bodies reproduced verbatim from pg_get_functiondef with only the
-- noted guard line(s) added.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_units_cache_bundle(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me   public.app_users := public._rms_caller();
  v_all  boolean := (v_me.id IS NULL) OR (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids uuid[];
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  RETURN jsonb_build_object(
    'units', COALESCE((SELECT jsonb_agg(to_jsonb(u) ORDER BY u.unit_no)
      FROM public.units u
      WHERE u.company_id = p_company_id
        AND (v_all OR u.project_id = ANY(v_pids))), '[]'::jsonb),
    'sales', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', s.id, 'unit_id', s.unit_id, 'client_id', s.client_id, 'agent_id', s.agent_id,
        'sale_number', s.sale_number, 'sale_date', s.sale_date, 'net_amount', s.net_amount,
        'total_amount', s.total_amount, 'status', s.status, 'sale_type_id', s.sale_type_id))
      FROM public.sales s
      WHERE s.company_id = p_company_id AND s.status <> 'cancelled'
        AND (v_all OR EXISTS (SELECT 1 FROM public.units u2
              WHERE u2.id = s.unit_id AND u2.project_id = ANY(v_pids)))), '[]'::jsonb),
    'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'sale_id', p.sale_id, 'amount', p.amount, 'payment_date', p.payment_date)
        ORDER BY p.payment_date DESC)
      FROM public.payments p
      WHERE p.company_id = p_company_id
        AND (v_all OR EXISTS (SELECT 1 FROM public.sales s2
              JOIN public.units u2 ON u2.id = s2.unit_id
              WHERE s2.id = p.sale_id AND u2.project_id = ANY(v_pids)))), '[]'::jsonb),
    'agents', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'full_name', a.full_name))
      FROM public.agents a WHERE a.company_id = p_company_id), '[]'::jsonb)
  );
END $function$;

CREATE OR REPLACE FUNCTION public.get_contact_logs_cache(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me   public.app_users := public._rms_caller();
  v_all  boolean := (v_me.id IS NULL) OR (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids uuid[];
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(cl) ORDER BY cl.contact_date DESC, cl.created_at DESC)
    FROM (
      SELECT * FROM public.contact_logs cl
      WHERE cl.company_id = p_company_id
        AND (v_all
             OR cl.project_id = ANY(v_pids)
             OR EXISTS (SELECT 1 FROM public.units u2
                         WHERE u2.id = cl.unit_id AND u2.project_id = ANY(v_pids)))
      ORDER BY contact_date DESC, created_at DESC
      LIMIT 2000
    ) cl
  ), '[]'::jsonb);
END $function$;

CREATE OR REPLACE FUNCTION public.get_team_performance_lite(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me     public.app_users;
  v_result jsonb;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL
     OR NOT public._rms_is_admin(v_me)
     OR (NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id) THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(row ORDER BY row->>'full_name'), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'user_id',             u.id,
      'full_name',           u.full_name,
      'projects',            COALESCE(pj.project_names, ARRAY[]::text[]),
      'outstanding',         COALESCE(ins.outstanding, 0),
      'overdue',             COALESCE(ins.overdue, 0),
      'collected_this_month',COALESCE(pay.collected, 0),
      'pending_approvals',   COALESCE(ap.pending_count, 0),
      'calls_this_month',    COALESCE(cl.calls, 0),
      'promises_made',       COALESCE(pp.made, 0),
      'promises_kept',       COALESCE(pp.kept, 0),
      'promises_broken',     COALESCE(pp.broken, 0),
      'untouched_overdue',   COALESCE(nu.untouched, 0)
    ) AS row
    FROM public.app_users u
    LEFT JOIN LATERAL (
      SELECT array_agg(p.project_name ORDER BY p.project_name) AS project_names,
             array_agg(upa.project_id)                         AS project_ids
      FROM public.user_project_assignments upa
      JOIN public.projects p ON p.id = upa.project_id
      WHERE upa.user_id = u.id
        AND upa.company_id = p_company_id
        AND upa.is_active = true
    ) pj ON true
    LEFT JOIN LATERAL (
      SELECT
        SUM(GREATEST(i.amount_due - i.amount_paid, 0)) AS outstanding,
        SUM(CASE WHEN i.due_date < CURRENT_DATE
                 THEN GREATEST(i.amount_due - i.amount_paid, 0) ELSE 0 END) AS overdue
      FROM public.installments i
      WHERE i.company_id = p_company_id
        AND i.project_id = ANY(pj.project_ids)
    ) ins ON true
    LEFT JOIN LATERAL (
      SELECT SUM(p2.amount) AS collected
      FROM public.payments p2
      JOIN public.sales s2 ON s2.id = p2.sale_id
      WHERE p2.company_id = p_company_id
        AND s2.project_id = ANY(pj.project_ids)
        AND COALESCE(p2.status, '') <> 'cancelled'
        AND p2.payment_date >= date_trunc('month', CURRENT_DATE)::date
        AND p2.payment_date <  (date_trunc('month', CURRENT_DATE) + interval '1 month')::date
    ) pay ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS pending_count
      FROM public.approval_requests ar
      WHERE ar.company_id = p_company_id
        AND ar.requested_by = u.id
        AND ar.status = 'pending'
    ) ap ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS calls
      FROM public.contact_logs c
      WHERE c.company_id = p_company_id
        AND c.agent_id = u.id::text
        AND c.contact_date >= date_trunc('month', CURRENT_DATE)::date
        AND c.contact_date <  (date_trunc('month', CURRENT_DATE) + interval '1 month')::date
    ) cl ON true
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (
          WHERE pr.promise_made_on >= date_trunc('month', CURRENT_DATE)::date
            AND pr.promise_made_on <  (date_trunc('month', CURRENT_DATE) + interval '1 month')::date
        ) AS made,
        COUNT(*) FILTER (
          WHERE pr.promise_date < CURRENT_DATE AND pr.status IN ('kept','partial')
        ) AS kept,
        COUNT(*) FILTER (
          WHERE pr.promise_date < CURRENT_DATE AND pr.status IN ('broken','pending','postponed')
        ) AS broken
      FROM public.payment_promises pr
      WHERE pr.company_id = p_company_id
        AND pr.logged_by = u.id::text
        AND pr.project_id = ANY(pj.project_ids)
    ) pp ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(DISTINCT i.sale_id) AS untouched
      FROM public.installments i
      WHERE i.company_id = p_company_id
        AND i.project_id = ANY(pj.project_ids)
        AND i.due_date < CURRENT_DATE
        AND i.amount_due > i.amount_paid
        AND NOT EXISTS (
          SELECT 1 FROM public.contact_logs c2
          WHERE c2.company_id = p_company_id
            AND c2.sale_id = i.sale_id
            AND c2.contact_date >= (CURRENT_DATE - INTERVAL '14 days')::date
        )
    ) nu ON true
    WHERE u.company_id = p_company_id
      AND u.role IN ('recovery','recovery_officer')
      AND u.status = 'active'
  ) sub;

  RETURN v_result;
END;
$function$;

-- B2: per-company uniqueness
DROP INDEX IF EXISTS public.idx_payments_voucher_code;
CREATE UNIQUE INDEX idx_payments_company_voucher_code
  ON public.payments (company_id, voucher_code) WHERE voucher_code IS NOT NULL;

ALTER TABLE public.unit_transfers DROP CONSTRAINT IF EXISTS unit_transfers_transfer_voucher_no_key;
ALTER TABLE public.unit_transfers
  ADD CONSTRAINT unit_transfers_company_transfer_voucher_no_key
  UNIQUE (company_id, transfer_voucher_no);
-- payment_links.ref_code: SAME collision class but public URL token (lookup by ref_code alone)
-- -> NOT composited here; needs a globally-unique generator (deferred batch B2b).

CREATE OR REPLACE FUNCTION public.create_client(p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID := (p_data->>'company_id')::UUID;
  v_project_id UUID := (p_data->>'project_id')::UUID;
  v_cnic       TEXT := NULLIF(TRIM(p_data->>'cnic'), '');
  v_code       TEXT; v_id UUID; v_existing UUID; v_can_add boolean;
  v_me         public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'auth_required');
  END IF;
  IF NOT COALESCE(v_me.is_super_admin, false) AND v_me.company_id IS DISTINCT FROM v_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'message', 'Account creation is admin-only.');
  END IF;

  IF v_project_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'project_required',
      'message', 'A project must be selected for this client.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = v_project_id AND company_id = v_company_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'project_not_in_company',
      'message', 'The selected project does not belong to your company.');
  END IF;

  SELECT (check_plan_limit(v_company_id, 'clients')->>'can_add')::boolean INTO v_can_add;
  IF NOT v_can_add THEN
    RETURN jsonb_build_object('success', false, 'error', 'plan_limit',
      'message', 'Client limit reached for your plan. Please upgrade.');
  END IF;

  IF v_cnic IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.clients
    WHERE company_id = v_company_id AND project_id = v_project_id AND cnic = v_cnic LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'CNIC already registered',
        'duplicate_id', v_existing::TEXT, 'duplicate_field', 'cnic');
    END IF;
  END IF;

  v_code := public.generate_client_code(v_company_id, v_project_id);

  INSERT INTO public.clients (
    company_id, project_id, client_code, full_name, father_name,
    cnic, passport_no, phone_primary, phone_secondary, whatsapp,
    email, address, city, country,
    occupation, company_name, client_category, reference_by,
    notes, status, created_by,
    client_photo_url, cnic_front_url, cnic_back_url,
    overseas_local, next_of_kin_name, next_of_kin_relation, next_of_kin_phone,
    lead_source, bank_name, bank_account_title, bank_account_no, bank_iban
  ) VALUES (
    v_company_id, v_project_id, v_code,
    p_data->>'full_name',
    NULLIF(p_data->>'father_name',''), v_cnic, NULLIF(p_data->>'passport_no',''),
    p_data->>'phone_primary',
    NULLIF(p_data->>'phone_secondary',''), NULLIF(p_data->>'whatsapp',''),
    NULLIF(p_data->>'email',''), NULLIF(p_data->>'address',''),
    NULLIF(p_data->>'city',''), COALESCE(NULLIF(p_data->>'country',''),'Pakistan'),
    NULLIF(p_data->>'occupation',''), NULLIF(p_data->>'company_name',''),
    NULLIF(p_data->>'client_category',''), NULLIF(p_data->>'reference_by',''),
    NULLIF(p_data->>'notes',''), COALESCE(NULLIF(p_data->>'status',''),'active'),
    NULLIF(p_data->>'created_by','')::UUID,
    NULLIF(p_data->>'client_photo_url',''), NULLIF(p_data->>'cnic_front_url',''),
    NULLIF(p_data->>'cnic_back_url',''),
    COALESCE(NULLIF(p_data->>'overseas_local',''),'local'),
    NULLIF(p_data->>'next_of_kin_name',''), NULLIF(p_data->>'next_of_kin_relation',''),
    NULLIF(p_data->>'next_of_kin_phone',''), NULLIF(p_data->>'lead_source',''),
    NULLIF(p_data->>'bank_name',''), NULLIF(p_data->>'bank_account_title',''),
    NULLIF(p_data->>'bank_account_no',''), NULLIF(p_data->>'bank_iban','')
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'id', v_id::TEXT, 'client_code', v_code);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_unit(p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID := (p_data->>'company_id')::UUID;
  v_project_id UUID := (p_data->>'project_id')::UUID;
  v_code TEXT; v_id UUID; v_can_add boolean;
  v_me   public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'auth_required');
  END IF;
  IF NOT COALESCE(v_me.is_super_admin, false) AND v_me.company_id IS DISTINCT FROM v_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'message', 'Account creation is admin-only.');
  END IF;
  IF v_project_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.projects WHERE id = v_project_id AND company_id = v_company_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'project_not_in_company',
      'message', 'The selected project does not belong to your company.');
  END IF;

  SELECT (check_plan_limit(v_company_id, 'units')->>'can_add')::boolean INTO v_can_add;
  IF NOT v_can_add THEN
    RETURN jsonb_build_object('success', false, 'error', 'plan_limit',
      'message', 'Unit limit reached for your plan. Please upgrade.');
  END IF;
  v_code := public.generate_unit_code(v_company_id);
  INSERT INTO public.units (
    company_id, project_id, unit_no, unit_code, unit_type_id, status_id,
    floor_id, floor_no, floor_label, block, area, carpet_area, area_unit,
    bedrooms, bathrooms, parking_count, facing, base_price, features, notes, created_by,
    is_premium, is_corner, maintenance_monthly, possession_date, handover_status,
    transfer_history, image_urls, document_urls
  ) VALUES (
    v_company_id, v_project_id, p_data->>'unit_no', v_code,
    NULLIF(p_data->>'unit_type_id','')::UUID, NULLIF(p_data->>'status_id','')::UUID,
    NULLIF(p_data->>'floor_id','')::UUID, NULLIF(p_data->>'floor_no','')::INTEGER,
    NULLIF(p_data->>'floor_label',''), NULLIF(p_data->>'block',''),
    NULLIF(p_data->>'area','')::NUMERIC, NULLIF(p_data->>'carpet_area','')::NUMERIC,
    COALESCE(NULLIF(p_data->>'area_unit',''),'sqft'),
    NULLIF(p_data->>'bedrooms','')::INTEGER, NULLIF(p_data->>'bathrooms','')::INTEGER,
    COALESCE(NULLIF(p_data->>'parking_count','')::INTEGER,0), NULLIF(p_data->>'facing',''),
    COALESCE(NULLIF(p_data->>'base_price','')::NUMERIC,0),
    COALESCE(p_data->'features','{}'::JSONB), NULLIF(p_data->>'notes',''),
    NULLIF(p_data->>'created_by','')::UUID,
    COALESCE((p_data->>'is_premium')::BOOLEAN,false),
    COALESCE((p_data->>'is_corner')::BOOLEAN,false),
    NULLIF(p_data->>'maintenance_monthly','')::NUMERIC,
    NULLIF(p_data->>'possession_date','')::DATE,
    NULLIF(p_data->>'handover_status',''), NULLIF(p_data->>'transfer_history',''),
    COALESCE(p_data->'image_urls','[]'::JSONB),
    COALESCE(p_data->'document_urls','[]'::JSONB)
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object('success',true,'id',v_id::TEXT,'unit_code',v_code);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success',false,'error',SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_agent(p_company_id uuid, p_created_by uuid, p_full_name text, p_phone text, p_email text DEFAULT NULL::text, p_cnic text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_commission_percent numeric DEFAULT 2.00, p_bank_name text DEFAULT NULL::text, p_bank_account_no text DEFAULT NULL::text, p_bank_account_title text DEFAULT NULL::text, p_join_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text, p_status text DEFAULT 'active'::text, p_project_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_code       TEXT; v_agent_id UUID;
  v_max_agents INT;  v_cur_count INT; v_plan_code TEXT;
  v_me         public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'auth_required');
  END IF;
  IF NOT COALESCE(v_me.is_super_admin, false)
     AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    IF p_project_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_id_required');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.user_project_assignments
                   WHERE user_id = v_me.id AND company_id = p_company_id
                     AND project_id = p_project_id AND is_active) THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_not_assigned');
    END IF;
  END IF;

  IF p_project_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'project_required',
      'message', 'A project must be selected for this agent.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = p_project_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'project_not_in_company',
      'message', 'The selected project does not belong to your company.');
  END IF;

  SELECT sp.max_agents, sp.plan_code INTO v_max_agents, v_plan_code
  FROM public.subscriptions s
  JOIN public.subscription_plans sp ON sp.id = s.plan_id
  WHERE s.company_id = p_company_id ORDER BY s.created_at DESC LIMIT 1;
  SELECT COUNT(*) INTO v_cur_count FROM public.agents
  WHERE company_id = p_company_id AND status = 'active';
  IF v_max_agents IS NOT NULL AND v_cur_count >= v_max_agents THEN
    RETURN jsonb_build_object('success', false, 'error', 'plan_limit',
      'message', 'Agent limit reached for your plan. Please upgrade to add more agents.');
  END IF;
  IF p_cnic IS NOT NULL AND p_cnic <> '' THEN
    IF EXISTS (SELECT 1 FROM public.agents WHERE company_id = p_company_id AND project_id = p_project_id AND cnic = p_cnic) THEN
      RETURN jsonb_build_object('success', false, 'error', 'duplicate_cnic',
        'message', 'An agent with this CNIC already exists in this project.');
    END IF;
  END IF;
  IF p_commission_percent < 0 OR p_commission_percent > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_commission',
      'message', 'Commission must be between 0 and 100.');
  END IF;
  v_code := public.generate_agent_code(p_company_id, p_project_id);
  INSERT INTO public.agents (
    company_id, project_id, created_by, agent_code, full_name, phone, email, cnic,
    address, commission_percent, bank_name, bank_account_no, bank_account_title,
    join_date, notes, status
  ) VALUES (
    p_company_id, p_project_id, p_created_by, v_code, p_full_name, p_phone, p_email, p_cnic,
    p_address, p_commission_percent, p_bank_name, p_bank_account_no, p_bank_account_title,
    p_join_date, p_notes, p_status
  ) RETURNING id INTO v_agent_id;
  RETURN jsonb_build_object('success', true, 'agent_id', v_agent_id, 'agent_code', v_code);
END;
$function$;

CREATE OR REPLACE FUNCTION public.bulk_create_units(p_company_id uuid, p_project_id uuid, p_units jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_unit JSONB; v_code TEXT; v_inserted INTEGER := 0; v_error_count INTEGER := 0;
  v_errors TEXT[] := ARRAY[]::TEXT[]; v_idx INTEGER := 0;
  v_limit_info JSONB; v_max INTEGER; v_current INTEGER; v_requested INTEGER;
  v_me public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'auth_required');
  END IF;
  IF NOT COALESCE(v_me.is_super_admin, false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'message', 'Account creation is admin-only.');
  END IF;
  IF p_project_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.projects WHERE id = p_project_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'project_not_in_company', 'inserted', 0, 'errors', 1,
      'error_details', jsonb_build_array('The selected project does not belong to your company.'));
  END IF;

  v_requested  := jsonb_array_length(p_units);
  v_limit_info := public.check_plan_limit(p_company_id, 'units');
  v_max        := (v_limit_info->>'max_allowed')::INTEGER;
  v_current    := (v_limit_info->>'current_count')::INTEGER;

  IF v_max > 0 AND (v_current + v_requested) > v_max THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'plan_limit', 'inserted', 0, 'errors', 1,
      'error_details', jsonb_build_array(
        format('Unit limit reached: plan allows %s units, you already have %s, and you are trying to add %s more. Upgrade your plan to continue.', v_max, v_current, v_requested)
      )
    );
  END IF;

  FOR v_unit IN SELECT * FROM jsonb_array_elements(p_units) LOOP
    v_idx := v_idx + 1;
    BEGIN
      v_code := public.generate_unit_code(p_company_id);
      INSERT INTO public.units (
        company_id, project_id, unit_no, unit_code, unit_type_id, status_id,
        floor_no, floor_label, block, area, area_unit, bedrooms, bathrooms, parking_count,
        base_price, features, notes, created_by
      ) VALUES (
        p_company_id, p_project_id, v_unit->>'unit_no', v_code,
        NULLIF(v_unit->>'unit_type_id', '')::UUID, NULLIF(v_unit->>'status_id', '')::UUID,
        NULLIF(v_unit->>'floor_no', '')::INTEGER, NULLIF(v_unit->>'floor_label', ''),
        NULLIF(v_unit->>'block', ''), NULLIF(v_unit->>'area', '')::NUMERIC,
        COALESCE(NULLIF(v_unit->>'area_unit', ''), 'sqft'),
        NULLIF(v_unit->>'bedrooms', '')::INTEGER, NULLIF(v_unit->>'bathrooms', '')::INTEGER,
        COALESCE(NULLIF(v_unit->>'parking_count', '')::INTEGER, 0),
        COALESCE(NULLIF(v_unit->>'base_price', '')::NUMERIC, 0),
        '{}'::JSONB, NULLIF(v_unit->>'notes', ''), NULLIF(v_unit->>'created_by', '')::UUID
      );
      v_inserted := v_inserted + 1;
    EXCEPTION WHEN OTHERS THEN
      v_error_count := v_error_count + 1;
      v_errors := v_errors || ('Row ' || v_idx || ' (' || COALESCE(v_unit->>'unit_no','?') || '): ' || SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', v_error_count = 0, 'inserted', v_inserted, 'errors', v_error_count,
    'error_details', to_jsonb(v_errors)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_unit(p_company_id uuid, p_data jsonb, p_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid; v_row record;
  v_target_pid uuid;
  v_me public.app_users := public._rms_caller();
  v_data jsonb;
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'auth_required');
  END IF;
  IF NOT COALESCE(v_me.is_super_admin, false)
     AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;

  IF p_id IS NULL THEN
    v_target_pid := NULLIF(p_data->>'project_id','')::uuid;
  ELSE
    SELECT project_id INTO v_target_pid FROM public.units
    WHERE id = p_id AND company_id = p_company_id;
  END IF;

  IF v_target_pid IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.projects WHERE id = v_target_pid AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'project_not_in_company');
  END IF;

  IF NOT public._rms_is_admin(v_me) THEN
    IF v_target_pid IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_id_required');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.user_project_assignments
                   WHERE user_id = v_me.id AND company_id = p_company_id
                     AND project_id = v_target_pid AND is_active) THEN
      RETURN jsonb_build_object('success', false, 'error', 'project_not_assigned');
    END IF;
  END IF;

  IF p_id IS NULL THEN
    v_data := p_data || jsonb_build_object('company_id', p_company_id);

    IF NULLIF(v_data->>'id','') IS NULL THEN
      v_data := v_data || jsonb_build_object('id', gen_random_uuid());
    END IF;
    IF NULLIF(v_data->>'base_price','') IS NULL THEN
      v_data := v_data || jsonb_build_object('base_price', 0);
    END IF;
    IF NULL IS NOT DISTINCT FROM v_data->'features' OR v_data->'features' = 'null'::jsonb THEN
      v_data := v_data || jsonb_build_object('features', '{}'::jsonb);
    END IF;
    IF NULLIF(v_data->>'parking_count','') IS NULL THEN
      v_data := v_data || jsonb_build_object('parking_count', 0);
    END IF;
    IF NULLIF(v_data->>'is_premium','') IS NULL THEN
      v_data := v_data || jsonb_build_object('is_premium', false);
    END IF;
    IF NULLIF(v_data->>'origin_type','') IS NULL THEN
      v_data := v_data || jsonb_build_object('origin_type', 'fresh');
    END IF;
    IF NULLIF(v_data->>'created_at','') IS NULL THEN
      v_data := v_data || jsonb_build_object('created_at', now());
    END IF;
    IF NULLIF(v_data->>'updated_at','') IS NULL THEN
      v_data := v_data || jsonb_build_object('updated_at', now());
    END IF;

    INSERT INTO public.units SELECT * FROM jsonb_populate_record(NULL::public.units, v_data)
    RETURNING * INTO v_row;
    v_id := v_row.id;
  ELSE
    UPDATE public.units SET row = q.row FROM (
      SELECT to_jsonb(public.units.*) || p_data AS row FROM public.units WHERE id = p_id AND company_id = p_company_id
    ) q WHERE units.id = p_id;
    v_id := p_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END $function$;
