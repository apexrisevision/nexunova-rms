-- ════════════════════════════════════════════════════════════
-- PROJECT-SCOPING — BATCH 4, GROUP 4D: server-side isolation on agent
-- performance read
-- 2026-05-30.  ⚠️ REVIEW ONLY — DO NOT APPLY until approved.
-- ════════════════════════════════════════════════════════════
-- get_agent_performance is single-source: it aggregates SALES for one agent
-- (count, revenue, commission). The gate goes on the initial agent lookup —
-- if non-admin and agent's project ∉ v_pids, v_comm_pct stays NULL and the
-- existing 'not_found' envelope returns (same UX as Group 4B detail-by-id).

CREATE OR REPLACE FUNCTION public.get_agent_performance(p_id uuid, p_company_id uuid, p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_comm_pct    NUMERIC;
  v_sales_count INT;
  v_revenue     NUMERIC;
  v_commission  NUMERIC;
  v_me          public.app_users := public._rms_caller();
  v_all         boolean := (v_me.id IS NULL) OR public._rms_is_admin(v_me);
  v_pids        uuid[];
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  -- Project gate piggy-backed on the existing commission_percent lookup.
  -- Inaccessible agent → v_comm_pct NULL → existing 'not_found' branch fires.
  SELECT commission_percent INTO v_comm_pct
  FROM public.agents
  WHERE id = p_id AND company_id = p_company_id
    AND (v_all OR project_id = ANY(v_pids));

  IF v_comm_pct IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  SELECT
    COUNT(*),
    COALESCE(SUM(total_price), 0),
    COALESCE(SUM(total_price * v_comm_pct / 100), 0)
  INTO v_sales_count, v_revenue, v_commission
  FROM public.sales
  WHERE agent_id = p_id
    AND company_id = p_company_id
    AND (p_from_date IS NULL OR sale_date >= p_from_date)
    AND (p_to_date   IS NULL OR sale_date <= p_to_date);

  RETURN jsonb_build_object(
    'success',      true,
    'sales_count',  v_sales_count,
    'revenue',      v_revenue,
    'commission',   v_commission,
    'from_date',    p_from_date,
    'to_date',      p_to_date
  );
END;
$function$;
