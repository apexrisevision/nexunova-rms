-- ════════════════════════════════════════════════════════════
-- PROJECT-SCOPING — BATCH 4, GROUP 4A: server-side isolation on agent LIST RPCs
-- 2026-05-30.  ⚠️ REVIEW ONLY — DO NOT APPLY until approved.
-- ════════════════════════════════════════════════════════════
-- Identical pattern to Batch 3 Group 3A — anon stays PERMISSIVE, admin/owner
-- bypass, authenticated non-admin restricted to user_project_assignments.
-- Gate: AND (cfg.v_all OR a.project_id = ANY(cfg.v_pids))

-- ── 1. list_agents (plpgsql) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_agents(p_company_id uuid, p_search text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_sort text DEFAULT 'name'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_me     public.app_users := public._rms_caller();
  v_all    boolean := (v_me.id IS NULL) OR public._rms_is_admin(v_me);
  v_pids   uuid[];
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT jsonb_agg(row_data ORDER BY
    CASE WHEN p_sort = 'sales'      THEN a.total_sales_count        END DESC,
    CASE WHEN p_sort = 'commission' THEN a.total_commission_earned   END DESC,
    CASE WHEN p_sort = 'name'       THEN lower(a.full_name)          END ASC
  )
  INTO v_result
  FROM (
    SELECT
      a.id, a.project_id, a.agent_code, a.full_name, a.phone, a.email, a.cnic,
      a.address, a.commission_percent, a.status, a.join_date,
      a.profile_photo_url, a.bank_name, a.bank_account_no,
      a.bank_account_title, a.notes, a.rating,
      a.total_sales_count, a.total_sales_amount,
      a.total_commission_earned, a.total_commission_paid,
      a.total_commission_pending, a.created_at, a.updated_at
    FROM public.agents a
    WHERE a.company_id = p_company_id
      AND (v_all OR a.project_id = ANY(v_pids))
      AND (p_status IS NULL OR a.status = p_status)
      AND (
        p_search IS NULL OR p_search = '' OR
        lower(a.full_name) LIKE '%' || lower(p_search) || '%' OR
        a.phone            LIKE '%' || p_search || '%' OR
        lower(COALESCE(a.email, '')) LIKE '%' || lower(p_search) || '%' OR
        lower(COALESCE(a.cnic,  '')) LIKE '%' || lower(p_search) || '%' OR
        a.agent_code       LIKE '%' || upper(p_search) || '%'
      )
  ) a(id, project_id, agent_code, full_name, phone, email, cnic, address, commission_percent,
      status, join_date, profile_photo_url, bank_name, bank_account_no,
      bank_account_title, notes, rating, total_sales_count, total_sales_amount,
      total_commission_earned, total_commission_paid, total_commission_pending,
      created_at, updated_at),
  LATERAL (SELECT row_to_json(a)::jsonb AS row_data) r;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

-- ── 2. list_agents_for_search ────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_agents_for_search(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR public._rms_is_admin(me) FROM public._rms_caller() me), true) AS v_all,
      COALESCE(
        (SELECT array_agg(upa.project_id) FROM public._rms_caller() me
         JOIN public.user_project_assignments upa
           ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id, 'full_name', a.full_name, 'agent_code', a.agent_code,
    'phone', a.phone, 'status', a.status, 'commission_percent', a.commission_percent
  ) ORDER BY a.full_name), '[]'::jsonb)
  FROM public.agents a CROSS JOIN cfg
  WHERE a.company_id = p_company_id
    AND (cfg.v_all OR a.project_id = ANY(cfg.v_pids));
$function$;

-- ── 3. list_agents_lookup ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_agents_lookup(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR public._rms_is_admin(me) FROM public._rms_caller() me), true) AS v_all,
      COALESCE(
        (SELECT array_agg(upa.project_id) FROM public._rms_caller() me
         JOIN public.user_project_assignments upa
           ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id, 'agent_name', a.full_name, 'full_name', a.full_name,
    'agent_code', a.agent_code, 'phone', a.phone, 'commission_percent', a.commission_percent,
    'status', a.status, 'is_active', (a.status = 'active')
  ) ORDER BY a.full_name), '[]'::jsonb)
  FROM public.agents a CROSS JOIN cfg
  WHERE a.company_id = p_company_id
    AND (cfg.v_all OR a.project_id = ANY(cfg.v_pids));
$function$;

-- ── 4. list_agents_for_reports ───────────────────────────────
CREATE OR REPLACE FUNCTION public.list_agents_for_reports(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR public._rms_is_admin(me) FROM public._rms_caller() me), true) AS v_all,
      COALESCE(
        (SELECT array_agg(upa.project_id) FROM public._rms_caller() me
         JOIN public.user_project_assignments upa
           ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id, 'full_name', a.full_name, 'agent_code', a.agent_code, 'phone', a.phone,
    'commission_percent', a.commission_percent, 'total_commission_earned', a.total_commission_earned,
    'status', a.status
  ) ORDER BY a.full_name), '[]'::jsonb)
  FROM public.agents a CROSS JOIN cfg
  WHERE a.company_id = p_company_id
    AND (cfg.v_all OR a.project_id = ANY(cfg.v_pids));
$function$;

-- ── 5. list_agents_for_fnav ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_agents_for_fnav(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR public._rms_is_admin(me) FROM public._rms_caller() me), true) AS v_all,
      COALESCE(
        (SELECT array_agg(upa.project_id) FROM public._rms_caller() me
         JOIN public.user_project_assignments upa
           ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a.id, 'created_at', a.created_at) ORDER BY a.created_at ASC), '[]'::jsonb)
  FROM public.agents a CROSS JOIN cfg
  WHERE a.company_id = p_company_id
    AND (cfg.v_all OR a.project_id = ANY(cfg.v_pids));
$function$;
