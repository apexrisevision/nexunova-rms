-- ============================================================================
-- NEXUNOVA RMS — date-wise ordering audit (2026-06-16).
-- Several list/report RPCs had NO ORDER BY, so they returned rows in heap order
-- ("randomly" sorted) and, where a LIMIT was present, could silently drop the
-- most recent rows. This adds deterministic date ordering to every offender.
--   Newest-first (DESC): transaction registers / lists
--   Chronological (ASC): per-sale payment statement + installment schedule
-- Only ORDER BY is added; filters, security gates and shapes are unchanged.
-- (get_sales_register already orders via _get_sales_register_core; list_payments_
--  filtered fixed in 20260616_list_payments_filtered_order.sql.)
-- ============================================================================

-- ── agent commission payments (newest first) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_agent_commissions_with_agent(p_company_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.company_id = p_company_id AND public._rms_is_admin(me)) FROM public._rms_caller() me), false) AS v_all,
      COALESCE((SELECT array_agg(upa.project_id) FROM public._rms_caller() me
        JOIN public.user_project_assignments upa ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', acp.id, 'agent_id', acp.agent_id, 'sale_id', acp.sale_id, 'amount', acp.amount,
    'payment_date', acp.payment_date, 'payment_method', acp.payment_method,
    'reference_no', acp.reference_no, 'created_by', acp.created_by, 'notes', acp.notes,
    'agents', jsonb_build_object('full_name', a.full_name, 'agent_code', a.agent_code)
  ) ORDER BY acp.payment_date DESC NULLS LAST, acp.created_at DESC NULLS LAST), '[]'::jsonb)
  FROM public.agent_commission_payments acp
  LEFT JOIN public.agents a ON a.id = acp.agent_id
  CROSS JOIN cfg
  WHERE acp.company_id = p_company_id
    AND (cfg.v_all OR acp.project_id = ANY(cfg.v_pids));
$function$;

-- ── payments for one sale (chronological statement) ─────────────────────────
CREATE OR REPLACE FUNCTION public.list_payments_for_sale(p_sale_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.company_id = p_company_id AND public._rms_is_admin(me)) FROM public._rms_caller() me), false) AS v_all,
      COALESCE((SELECT array_agg(upa.project_id) FROM public._rms_caller() me
         JOIN public.user_project_assignments upa ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  ),
  parent AS (
    SELECT s.id FROM public.sales s CROSS JOIN cfg
    WHERE s.id = p_sale_id AND s.company_id = p_company_id
      AND (cfg.v_all OR s.project_id = ANY(cfg.v_pids))
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'payment_method', p.payment_method, 'amount', p.amount,
    'payment_category', p.payment_category, 'payment_date', p.payment_date,
    'reference_no', p.reference_no, 'status', p.status
  ) ORDER BY p.payment_date ASC NULLS LAST, p.created_at ASC NULLS LAST), '[]'::jsonb)
  FROM public.payments p
  WHERE p.sale_id = p_sale_id AND p.company_id = p_company_id AND p.status = 'received'
    AND EXISTS (SELECT 1 FROM parent);
$function$;

-- ── payments + unit (newest first) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_payments_with_sales_unit(p_company_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.company_id = p_company_id AND public._rms_is_admin(me)) FROM public._rms_caller() me), false) AS v_all,
      COALESCE((SELECT array_agg(upa.project_id) FROM public._rms_caller() me
         JOIN public.user_project_assignments upa ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.id, 'payment_date', p.payment_date, 'amount', p.amount,
    'payment_method', p.payment_method, 'reference_no', p.reference_no,
    'notes', p.notes, 'created_by', p.created_by, 'sale_id', p.sale_id,
    'sales', jsonb_build_object('unit_id', s.unit_id)
  ) ORDER BY p.payment_date DESC NULLS LAST, p.created_at DESC NULLS LAST), '[]'::jsonb)
  FROM public.payments p CROSS JOIN cfg
  LEFT JOIN public.sales s ON s.id = p.sale_id
  WHERE p.company_id = p_company_id
    AND (cfg.v_all OR (s.id IS NOT NULL AND s.project_id = ANY(cfg.v_pids)))
    AND (NULLIF(p_filters->>'date_from','')::date IS NULL OR p.payment_date >= (p_filters->>'date_from')::date)
    AND (NULLIF(p_filters->>'date_to','')::date IS NULL OR p.payment_date <= (p_filters->>'date_to')::date);
$function$;

-- ── possessions (newest first) ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_possessions_filtered(p_company_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.possession_date DESC NULLS LAST, p.created_at DESC NULLS LAST), '[]'::jsonb)
  FROM public.possessions p
  WHERE p.company_id = p_company_id;
$function$;

-- ── sales by agent (newest first) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_sales_by_agent(p_agent_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.company_id = p_company_id AND public._rms_is_admin(me)) FROM public._rms_caller() me), false) AS v_all,
      COALESCE((SELECT array_agg(upa.project_id) FROM public._rms_caller() me
        JOIN public.user_project_assignments upa ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.sale_date DESC NULLS LAST, s.created_at DESC NULLS LAST), '[]'::jsonb)
  FROM public.sales s CROSS JOIN cfg
  WHERE s.agent_id = p_agent_id AND s.company_id = p_company_id
    AND (cfg.v_all OR s.project_id = ANY(cfg.v_pids));
$function$;

-- ── sales by client (active units lookup — newest first) ────────────────────
CREATE OR REPLACE FUNCTION public.list_sales_by_client(p_client_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.company_id = p_company_id AND public._rms_is_admin(me)) FROM public._rms_caller() me), false) AS v_all,
      COALESCE((SELECT array_agg(upa.project_id) FROM public._rms_caller() me
        JOIN public.user_project_assignments upa ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id, 'sale_number', s.sale_number, 'unit_id', s.unit_id,
    'units', jsonb_build_object('unit_no', u.unit_no),
    'projects', jsonb_build_object('project_name', p.project_name))
    ORDER BY s.sale_date DESC NULLS LAST, s.created_at DESC NULLS LAST), '[]'::jsonb)
  FROM public.sales s
  LEFT JOIN public.units u    ON u.id = s.unit_id
  LEFT JOIN public.projects p ON p.id = u.project_id
  CROSS JOIN cfg
  WHERE s.company_id = p_company_id AND s.client_id = p_client_id AND s.status = 'active'
    AND (cfg.v_all OR s.project_id = ANY(cfg.v_pids));
$function$;

-- ── all sales by client (newest first) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_sales_by_client_all(p_client_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.company_id = p_company_id AND public._rms_is_admin(me)) FROM public._rms_caller() me), false) AS v_all,
      COALESCE((SELECT array_agg(upa.project_id) FROM public._rms_caller() me
        JOIN public.user_project_assignments upa ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.sale_date DESC NULLS LAST, s.created_at DESC NULLS LAST), '[]'::jsonb)
  FROM public.sales s CROSS JOIN cfg
  WHERE s.client_id = p_client_id AND s.company_id = p_company_id
    AND (cfg.v_all OR s.project_id = ANY(cfg.v_pids));
$function$;

-- ── installments schedule (chronological; LIMIT keeps earliest) ─────────────
CREATE OR REPLACE FUNCTION public.list_installments_filtered(p_company_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_status_in text := NULLIF(p_filters->>'status_in','');
  v_limit int := COALESCE((p_filters->>'limit')::int, 5000);
  v_result jsonb;
  v_me     public.app_users := public._rms_caller();
  v_all    boolean := (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids   uuid[];
BEGIN
  IF v_me.id IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.due_date ASC NULLS LAST, i.id), '[]'::jsonb) INTO v_result
  FROM (
    SELECT i.* FROM public.installments i
    WHERE i.company_id = p_company_id
      AND (v_all OR EXISTS (SELECT 1 FROM public.sales s WHERE s.id = i.sale_id AND s.project_id = ANY(v_pids)))
      AND (v_status_in IS NULL OR i.status = ANY(string_to_array(v_status_in, ',')))
    ORDER BY i.due_date ASC NULLS LAST, i.id
    LIMIT v_limit
  ) i;
  RETURN v_result;
END $function$;

-- ── sales list (newest first; LIMIT keeps most recent) ──────────────────────
CREATE OR REPLACE FUNCTION public.list_sales_filtered(p_company_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_status text := NULLIF(p_filters->>'status','');
  v_status_in text := NULLIF(p_filters->>'status_in','');
  v_ids_in text := NULLIF(p_filters->>'ids_in','');
  v_discount_gt numeric := COALESCE((p_filters->>'discount_gt')::numeric, NULL);
  v_limit int := COALESCE((p_filters->>'limit')::int, 5000);
  v_result jsonb;
  v_me     public.app_users := public._rms_caller();
  v_all    boolean := (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids   uuid[];
BEGIN
  IF v_me.id IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.sale_date DESC NULLS LAST, s.created_at DESC NULLS LAST, s.id), '[]'::jsonb) INTO v_result
  FROM (
    SELECT * FROM public.sales
    WHERE company_id = p_company_id
      AND (v_all OR project_id = ANY(v_pids))
      AND (v_status IS NULL OR status = v_status)
      AND (v_status_in IS NULL OR status = ANY(string_to_array(v_status_in, ',')))
      AND (v_ids_in IS NULL OR id::text = ANY(string_to_array(v_ids_in, ',')))
      AND (v_discount_gt IS NULL OR discount > v_discount_gt)
    ORDER BY sale_date DESC NULLS LAST, created_at DESC NULLS LAST, id
    LIMIT v_limit
  ) s;
  RETURN v_result;
END $function$;

-- ── sales register report (newest first; LIMIT keeps most recent) ───────────
CREATE OR REPLACE FUNCTION public.list_sales_for_report(p_company_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_status text := NULLIF(p_filters->>'status','');
  v_sale_from date := NULLIF(p_filters->>'sale_from','')::date;
  v_sale_to date := NULLIF(p_filters->>'sale_to','')::date;
  v_cancel_from date := NULLIF(p_filters->>'cancel_from','')::date;
  v_cancel_to date := NULLIF(p_filters->>'cancel_to','')::date;
  v_discount_gt numeric := COALESCE(NULLIF(p_filters->>'discount_gt','')::numeric, NULL);
  v_limit int := COALESCE((p_filters->>'limit')::int, 5000);
  v_result jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.sale_date DESC NULLS LAST, s.created_at DESC NULLS LAST, s.id), '[]'::jsonb) INTO v_result
  FROM (
    SELECT * FROM public.sales
    WHERE company_id = p_company_id
      AND (v_status IS NULL OR status = v_status)
      AND (v_sale_from IS NULL OR sale_date >= v_sale_from)
      AND (v_sale_to IS NULL OR sale_date <= v_sale_to)
      AND (v_cancel_from IS NULL OR cancellation_date >= v_cancel_from)
      AND (v_cancel_to IS NULL OR cancellation_date <= v_cancel_to)
      AND (v_discount_gt IS NULL OR discount > v_discount_gt)
    ORDER BY sale_date DESC NULLS LAST, created_at DESC NULLS LAST, id
    LIMIT v_limit
  ) s;
  RETURN v_result;
END $function$;
