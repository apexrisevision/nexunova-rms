-- Authz hardening — Batch 2a: gate admin-only company-scoped DELETE RPCs. Source: RPC_AUTHZ_TRIAGE.md.
-- All 8 take (p_id uuid, p_company_id uuid); none had a caller/role gate. Guard prepended (null-safe,
-- super-admin bypasses tenant; matches batch 1 / record_payment). Bodies otherwise byte-identical;
-- signatures, return type, SECURITY DEFINER, search_path=public, and EXCEPTION blocks preserved.

-- 1. delete_agent
CREATE OR REPLACE FUNCTION public.delete_agent(p_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_sales_count INT; v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.agents WHERE id = p_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  SELECT COUNT(*) INTO v_sales_count FROM public.sales WHERE agent_id = p_id;

  IF v_sales_count > 0 THEN
    UPDATE public.agents SET status = 'inactive', termination_date = CURRENT_DATE
    WHERE id = p_id AND company_id = p_company_id;
    RETURN jsonb_build_object('success', true, 'action', 'deactivated',
      'message', 'Agent has sales records and was deactivated instead of deleted.');
  ELSE
    DELETE FROM public.agents WHERE id = p_id AND company_id = p_company_id;
    RETURN jsonb_build_object('success', true, 'action', 'deleted');
  END IF;
END;
$function$;

-- 2. delete_bank
CREATE OR REPLACE FUNCTION public.delete_bank(p_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  DELETE FROM public.banks WHERE id = p_id AND company_id = p_company_id;
  RETURN jsonb_build_object('success', true);
END $function$;

-- 3. delete_project
CREATE OR REPLACE FUNCTION public.delete_project(p_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  DELETE FROM public.projects WHERE id = p_id AND company_id = p_company_id;
  RETURN jsonb_build_object('success', true);
END $function$;

-- 4. delete_project_bank_account
CREATE OR REPLACE FUNCTION public.delete_project_bank_account(p_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  DELETE FROM public.project_bank_accounts WHERE id = p_id AND company_id = p_company_id;
  RETURN jsonb_build_object('success', true);
END $function$;

-- 5. delete_project_expense
CREATE OR REPLACE FUNCTION public.delete_project_expense(p_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  DELETE FROM public.project_expenses WHERE id = p_id AND company_id = p_company_id;
  RETURN jsonb_build_object('success', true);
END $function$;

-- 6. delete_project_milestone
CREATE OR REPLACE FUNCTION public.delete_project_milestone(p_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  DELETE FROM public.project_milestones WHERE id = p_id AND company_id = p_company_id;
  RETURN jsonb_build_object('success', true);
END $function$;

-- 7. delete_floor
CREATE OR REPLACE FUNCTION public.delete_floor(p_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  DELETE FROM public.floors WHERE id = p_id AND company_id = p_company_id;
  RETURN jsonb_build_object('success', true);
END $function$;

-- 8. delete_unit
CREATE OR REPLACE FUNCTION public.delete_unit(p_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_rows INTEGER; v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT (COALESCE(v_me.is_super_admin,false) OR v_me.role IN ('owner','admin')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  DELETE FROM public.units WHERE id = p_id AND company_id = p_company_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unit not found or access denied');
  END IF;
  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END; $function$;
