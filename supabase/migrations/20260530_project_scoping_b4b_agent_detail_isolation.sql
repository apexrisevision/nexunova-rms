-- ════════════════════════════════════════════════════════════
-- PROJECT-SCOPING — BATCH 4, GROUP 4B: server-side isolation on agent DETAIL RPCs
-- 2026-05-30.  ⚠️ REVIEW ONLY — DO NOT APPLY until approved.
-- ════════════════════════════════════════════════════════════
-- Same template as 4A but for single-row reads. Inaccessible agent → no row.
--
-- NOTE: get_agent_name takes only p_id (no p_company_id) — like get_client_360
-- in 3B. v_pids derived from user_project_assignments by user_id alone.

-- ── 1. get_agent_full ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_agent_full(p_id uuid, p_company_id uuid)
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
  SELECT to_jsonb(a)
  FROM public.agents a CROSS JOIN cfg
  WHERE a.id = p_id AND a.company_id = p_company_id
    AND (cfg.v_all OR a.project_id = ANY(cfg.v_pids));
$function$;

-- ── 2. get_agent_lite ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_agent_lite(p_id uuid, p_company_id uuid)
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
  SELECT jsonb_build_object(
    'id', a.id, 'full_name', a.full_name, 'agent_code', a.agent_code,
    'commission_percent', a.commission_percent
  )
  FROM public.agents a CROSS JOIN cfg
  WHERE a.id = p_id AND a.company_id = p_company_id
    AND (cfg.v_all OR a.project_id = ANY(cfg.v_pids));
$function$;

-- ── 3. get_agent_extended ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_agent_extended(p_id uuid, p_company_id uuid)
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
  SELECT jsonb_build_object(
    'territory', a.territory,
    'monthly_target', a.monthly_target,
    'quarterly_target', a.quarterly_target,
    'contract_doc_url', a.contract_doc_url,
    'parent_agent_id', a.parent_agent_id
  )
  FROM public.agents a CROSS JOIN cfg
  WHERE a.id = p_id AND a.company_id = p_company_id
    AND (cfg.v_all OR a.project_id = ANY(cfg.v_pids));
$function$;

-- ── 4. get_agent_detail_for_search ───────────────────────────
CREATE OR REPLACE FUNCTION public.get_agent_detail_for_search(p_id uuid, p_company_id uuid)
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
  SELECT jsonb_build_object(
    'full_name', a.full_name, 'agent_code', a.agent_code, 'phone', a.phone,
    'commission_percent', a.commission_percent, 'total_commission_earned', a.total_commission_earned,
    'total_commission_paid', a.total_commission_paid, 'total_commission_pending', a.total_commission_pending
  )
  FROM public.agents a CROSS JOIN cfg
  WHERE a.id = p_id AND a.company_id = p_company_id
    AND (cfg.v_all OR a.project_id = ANY(cfg.v_pids));
$function$;

-- ── 5. get_agent_360 (plpgsql) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.get_agent_360(p_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_agent jsonb;
  v_sales jsonb;
  v_me    public.app_users := public._rms_caller();
  v_all   boolean := (v_me.id IS NULL) OR public._rms_is_admin(v_me);
  v_pids  uuid[];
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT jsonb_build_object(
    'id', a.id, 'agent_code', a.agent_code, 'full_name', a.full_name,
    'phone', a.phone, 'email', a.email, 'cnic', a.cnic, 'address', a.address,
    'commission_percent', a.commission_percent, 'status', a.status,
    'join_date', a.join_date, 'termination_date', a.termination_date,
    'profile_photo_url', a.profile_photo_url, 'cnic_front_url', a.cnic_front_url,
    'cnic_back_url', a.cnic_back_url, 'bank_name', a.bank_name,
    'bank_account_no', a.bank_account_no, 'bank_account_title', a.bank_account_title,
    'notes', a.notes, 'rating', a.rating,
    'total_sales_count', a.total_sales_count, 'total_sales_amount', a.total_sales_amount,
    'total_commission_earned', a.total_commission_earned,
    'total_commission_paid', a.total_commission_paid,
    'total_commission_pending', a.total_commission_pending,
    'created_at', a.created_at, 'updated_at', a.updated_at
  ) INTO v_agent
  FROM public.agents a
  WHERE a.id = p_id AND a.company_id = p_company_id
    AND (v_all OR a.project_id = ANY(v_pids));

  IF v_agent IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', s.id, 'sale_number', s.sale_number, 'sale_date', s.sale_date,
      'net_amount', s.net_amount, 'down_payment', s.down_payment, 'status', s.status,
      'unit_no', u.unit_no, 'unit_code', u.unit_code,
      'project_name', p.project_name, 'client_name', c.full_name,
      'commission_amount', (s.net_amount * a_ref.commission_percent / 100)
    ) ORDER BY s.sale_date DESC
  ), '[]'::jsonb)
  INTO v_sales
  FROM public.sales s
  JOIN public.agents   a_ref ON a_ref.id = s.agent_id
  JOIN public.units    u     ON u.id = s.unit_id
  JOIN public.projects p     ON p.id = u.project_id
  JOIN public.clients  c     ON c.id = s.client_id
  WHERE s.agent_id = p_id AND s.company_id = p_company_id;

  RETURN jsonb_build_object('success', true, 'agent', v_agent, 'sales', v_sales);
END;
$function$;

-- ── 6. get_agent_name (no p_company_id; v_pids by user_id only) ──
CREATE OR REPLACE FUNCTION public.get_agent_name(p_id uuid)
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
           ON upa.user_id = me.id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT jsonb_build_object('full_name', a.full_name, 'agent_code', a.agent_code)
  FROM public.agents a CROSS JOIN cfg
  WHERE a.id = p_id
    AND (cfg.v_all OR a.project_id = ANY(cfg.v_pids));
$function$;
