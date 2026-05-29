-- ════════════════════════════════════════════════════════════
-- PROJECT-SCOPING — BATCH 2, STEP 6: agent writers  (completes Track B)
-- 2026-05-29.  ⚠️ REVIEW ONLY — DO NOT APPLY until approved.
-- ════════════════════════════════════════════════════════════
-- create_agent: requires + stores project_id, 2-arg generate_agent_code(company,
--   project), CNIC soft-check scoped to (company, project). [DROP+CREATE: gains a
--   trailing p_project_id param — old 14-arg signature dropped to avoid overload
--   ambiguity. p_project_id DEFAULT NULL so a project-less call fails GRACEFULLY
--   with project_required, not function-not-found.]
-- update_agent: gains trailing p_project_id (immutability guard); never writes it.
-- update_agent_extended: project immutable + parent_agent_id must be same project.
-- create_agent_transaction / create_agent_commission_payment_full: derive
--   project_id from the parent agent (caller does NOT pass it).

-- ── create_agent ────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.create_agent(uuid, uuid, text, text, text, text, text, numeric, text, text, text, date, text, text);

CREATE OR REPLACE FUNCTION public.create_agent(
  p_company_id uuid, p_created_by uuid, p_full_name text, p_phone text,
  p_email text DEFAULT NULL::text, p_cnic text DEFAULT NULL::text, p_address text DEFAULT NULL::text,
  p_commission_percent numeric DEFAULT 2.00, p_bank_name text DEFAULT NULL::text,
  p_bank_account_no text DEFAULT NULL::text, p_bank_account_title text DEFAULT NULL::text,
  p_join_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text, p_status text DEFAULT 'active'::text,
  p_project_id uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_code       TEXT;
  v_agent_id   UUID;
  v_max_agents INT;
  v_cur_count  INT;
  v_plan_code  TEXT;
BEGIN
  IF p_project_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'project_required',
      'message', 'A project must be selected for this agent.');
  END IF;

  -- Plan limit check (company-level)
  SELECT sp.max_agents, sp.plan_code INTO v_max_agents, v_plan_code
  FROM public.subscriptions s
  JOIN public.subscription_plans sp ON sp.id = s.plan_id
  WHERE s.company_id = p_company_id
  ORDER BY s.created_at DESC LIMIT 1;

  SELECT COUNT(*) INTO v_cur_count
  FROM public.agents WHERE company_id = p_company_id AND status = 'active';

  IF v_max_agents IS NOT NULL AND v_cur_count >= v_max_agents THEN
    RETURN jsonb_build_object('success', false, 'error', 'plan_limit',
      'message', 'Agent limit reached for your plan. Please upgrade to add more agents.');
  END IF;

  -- CNIC soft-uniqueness within (company, project)
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

-- ── update_agent ────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.update_agent(uuid, uuid, text, text, text, text, text, numeric, text, text, text, date, date, text, text, text, text, text, numeric);

CREATE OR REPLACE FUNCTION public.update_agent(
  p_id uuid, p_company_id uuid, p_full_name text DEFAULT NULL::text, p_phone text DEFAULT NULL::text,
  p_email text DEFAULT NULL::text, p_cnic text DEFAULT NULL::text, p_address text DEFAULT NULL::text,
  p_commission_percent numeric DEFAULT NULL::numeric, p_bank_name text DEFAULT NULL::text,
  p_bank_account_no text DEFAULT NULL::text, p_bank_account_title text DEFAULT NULL::text,
  p_join_date date DEFAULT NULL::date, p_termination_date date DEFAULT NULL::date, p_notes text DEFAULT NULL::text,
  p_status text DEFAULT NULL::text, p_profile_photo_url text DEFAULT NULL::text, p_cnic_front_url text DEFAULT NULL::text,
  p_cnic_back_url text DEFAULT NULL::text, p_rating numeric DEFAULT NULL::numeric,
  p_project_id uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_proj uuid;
BEGIN
  SELECT project_id INTO v_proj FROM public.agents WHERE id = p_id AND company_id = p_company_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  -- project_id is IMMUTABLE
  IF p_project_id IS NOT NULL AND p_project_id IS DISTINCT FROM v_proj THEN
    RETURN jsonb_build_object('success', false, 'error', 'project_immutable',
      'message', 'An agent cannot be moved to another project. Create a new agent instead.');
  END IF;

  -- CNIC soft-uniqueness within the agent's project (excluding self)
  IF p_cnic IS NOT NULL AND p_cnic <> '' THEN
    IF EXISTS (SELECT 1 FROM public.agents WHERE company_id = p_company_id AND project_id = v_proj AND cnic = p_cnic AND id <> p_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'duplicate_cnic',
        'message', 'An agent with this CNIC already exists in this project.');
    END IF;
  END IF;

  IF p_commission_percent IS NOT NULL AND (p_commission_percent < 0 OR p_commission_percent > 100) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_commission',
      'message', 'Commission must be between 0 and 100.');
  END IF;

  -- project_id intentionally NOT in the SET list (immutable)
  UPDATE public.agents SET
    full_name          = COALESCE(p_full_name,          full_name),
    phone              = COALESCE(p_phone,              phone),
    email              = COALESCE(p_email,              email),
    cnic               = COALESCE(p_cnic,               cnic),
    address            = COALESCE(p_address,            address),
    commission_percent = COALESCE(p_commission_percent, commission_percent),
    bank_name          = COALESCE(p_bank_name,          bank_name),
    bank_account_no    = COALESCE(p_bank_account_no,    bank_account_no),
    bank_account_title = COALESCE(p_bank_account_title, bank_account_title),
    join_date          = COALESCE(p_join_date,          join_date),
    termination_date   = COALESCE(p_termination_date,   termination_date),
    notes              = COALESCE(p_notes,              notes),
    status             = COALESCE(p_status,             status),
    profile_photo_url  = COALESCE(p_profile_photo_url,  profile_photo_url),
    cnic_front_url     = COALESCE(p_cnic_front_url,     cnic_front_url),
    cnic_back_url      = COALESCE(p_cnic_back_url,      cnic_back_url),
    rating             = COALESCE(p_rating,             rating)
  WHERE id = p_id AND company_id = p_company_id;

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ── update_agent_extended (project immutable + same-project parent) ──
CREATE OR REPLACE FUNCTION public.update_agent_extended(p_id uuid, p_company_id uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_proj   uuid;
  v_parent uuid := NULLIF(p_data->>'parent_agent_id','')::uuid;
BEGIN
  SELECT project_id INTO v_proj FROM public.agents WHERE id = p_id AND company_id = p_company_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  -- project_id immutable
  IF (p_data ? 'project_id') AND (p_data->>'project_id') IS NOT NULL
     AND (p_data->>'project_id')::uuid IS DISTINCT FROM v_proj THEN
    RETURN jsonb_build_object('success', false, 'error', 'project_immutable',
      'message', 'An agent cannot be moved to another project.');
  END IF;

  -- parent agent must be in the SAME project
  IF v_parent IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.agents WHERE id = v_parent AND company_id = p_company_id AND project_id = v_proj) THEN
      RETURN jsonb_build_object('success', false, 'error', 'parent_cross_project',
        'message', 'The parent agent must belong to the same project.');
    END IF;
  END IF;

  UPDATE public.agents SET
    territory = COALESCE(NULLIF(p_data->>'territory',''), territory),
    monthly_target = COALESCE(NULLIF(p_data->>'monthly_target','')::numeric, monthly_target),
    quarterly_target = COALESCE(NULLIF(p_data->>'quarterly_target','')::numeric, quarterly_target),
    contract_doc_url = COALESCE(NULLIF(p_data->>'contract_doc_url',''), contract_doc_url),
    parent_agent_id = COALESCE(NULLIF(p_data->>'parent_agent_id','')::uuid, parent_agent_id)
  WHERE id = p_id AND company_id = p_company_id;
  RETURN jsonb_build_object('success', true);
END $function$;

-- ── create_agent_transaction (derive project_id from parent agent) ──
CREATE OR REPLACE FUNCTION public.create_agent_transaction(p_company_id uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_agent uuid := (p_data->>'agent_id')::uuid; v_proj uuid;
BEGIN
  SELECT project_id INTO v_proj FROM public.agents WHERE id = v_agent AND company_id = p_company_id;
  INSERT INTO public.agent_transactions (
    company_id, project_id, agent_id, transaction_type, amount, related_sale_id,
    related_cancellation_id, related_transfer_id, payment_method, reference, notes, created_by
  ) VALUES (
    p_company_id, v_proj, v_agent, p_data->>'transaction_type',
    (p_data->>'amount')::numeric, NULLIF(p_data->>'related_sale_id','')::uuid,
    NULLIF(p_data->>'related_cancellation_id','')::uuid, NULLIF(p_data->>'related_transfer_id','')::uuid,
    NULLIF(p_data->>'payment_method',''), NULLIF(p_data->>'reference',''), NULLIF(p_data->>'notes',''),
    NULLIF(p_data->>'created_by','')
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END $function$;

-- ── create_agent_commission_payment_full (derive project_id from parent agent) ──
CREATE OR REPLACE FUNCTION public.create_agent_commission_payment_full(p_company_id uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_row jsonb; v_agent uuid := (p_data->>'agent_id')::uuid; v_proj uuid;
BEGIN
  SELECT project_id INTO v_proj FROM public.agents WHERE id = v_agent AND company_id = p_company_id;
  INSERT INTO public.agent_commission_payments (company_id, project_id, agent_id, sale_id, amount, payment_date, payment_method, reference_no, notes, created_by)
  VALUES (p_company_id, v_proj, v_agent, NULLIF(p_data->>'sale_id','')::uuid,
          (p_data->>'amount')::numeric, COALESCE((p_data->>'payment_date')::date, CURRENT_DATE),
          COALESCE(p_data->>'payment_method','bank_transfer'), NULLIF(p_data->>'reference_no',''),
          NULLIF(p_data->>'notes',''), NULLIF(p_data->>'created_by',''))
  RETURNING id INTO v_id;
  SELECT to_jsonb(acp) INTO v_row FROM public.agent_commission_payments acp WHERE acp.id = v_id;
  RETURN jsonb_build_object('success', true, 'id', v_id, 'row', v_row);
END $function$;
