-- ════════════════════════════════════════════════════════════
-- TINY CLEANUP: fix pre-existing column-name bug in get_agent_performance
-- 2026-05-30.  Unrelated to project-scoping; kept separate per Rashid's instruction.
-- ════════════════════════════════════════════════════════════
-- The aggregate referenced sales.total_price which doesn't exist. The
-- intended column is net_amount (gross less discount; also the commission
-- base used by get_agent_ledger). Zero current impact (sales = 0 pre-go-live)
-- but the function would have errored at first real call.
--
-- Single-character change of intent: total_price → net_amount, twice.
-- The Batch 4 Group 4D isolation gate added earlier is preserved verbatim.

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

  SELECT commission_percent INTO v_comm_pct
  FROM public.agents
  WHERE id = p_id AND company_id = p_company_id
    AND (v_all OR project_id = ANY(v_pids));

  IF v_comm_pct IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  SELECT
    COUNT(*),
    COALESCE(SUM(net_amount), 0),
    COALESCE(SUM(net_amount * v_comm_pct / 100), 0)
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
