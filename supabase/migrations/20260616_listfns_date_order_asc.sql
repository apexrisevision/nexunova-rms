-- ============================================================================
-- NEXUNOVA RMS — flip date ordering to ASCENDING (oldest first, newest last).
-- 2026-06-16. Owner wants the starting date at the top and the latest at the
-- bottom (earlier today these were set newest-first). Reverses the 9 list/report
-- RPCs that were DESC. (list_payments_for_sale & list_installments_filtered are
-- already ASC; nothing else changes.)
-- ============================================================================

-- ── receipt vouchers / payments list (oldest first) ─────────────────────────
CREATE OR REPLACE FUNCTION public.list_payments_filtered(p_company_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_columns text := COALESCE(p_filters->>'columns', '*');
  v_method text := NULLIF(p_filters->>'payment_method','');
  v_date_from date := NULLIF(p_filters->>'date_from','')::date;
  v_date_to date := NULLIF(p_filters->>'date_to','')::date;
  v_deposit_confirmed text := p_filters->>'deposit_confirmed';
  v_cheque_from date := NULLIF(p_filters->>'cheque_from','')::date;
  v_cheque_to date := NULLIF(p_filters->>'cheque_to','')::date;
  v_tax_gt numeric := COALESCE((p_filters->>'tax_gt')::numeric, NULL);
  v_limit int := COALESCE((p_filters->>'limit')::int, 5000);
  v_result jsonb;
  v_me     public.app_users := public._rms_caller();
  v_all    boolean := (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids   uuid[];
  v_agg_order text;
BEGIN
  IF v_me.id IS NULL THEN RETURN '[]'::jsonb; END IF;
  v_columns := CASE
    WHEN v_columns IS NULL OR v_columns = '*'  THEN '*'
    WHEN v_columns = 'amount'                  THEN 'amount'
    ELSE '*'
  END;
  v_agg_order := CASE WHEN v_columns = '*'
    THEN 'ORDER BY p.payment_date ASC NULLS LAST, p.created_at ASC NULLS LAST, p.id ASC'
    ELSE '' END;

  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(to_jsonb(p) %s), ''[]''::jsonb) FROM (
       SELECT %s FROM public.payments pmt
       WHERE pmt.company_id = $1
         AND ($10::boolean OR EXISTS (SELECT 1 FROM public.sales s WHERE s.id = pmt.sale_id AND s.project_id = ANY($11)))
         AND ($2::text IS NULL OR pmt.payment_method = $2)
         AND ($3::date IS NULL OR pmt.payment_date >= $3)
         AND ($4::date IS NULL OR pmt.payment_date <= $4)
         AND ($5::text IS NULL OR ($5 = ''true'' AND pmt.deposit_confirmed) OR ($5 = ''false'' AND NOT pmt.deposit_confirmed))
         AND ($6::date IS NULL OR pmt.cheque_date >= $6)
         AND ($7::date IS NULL OR pmt.cheque_date <= $7)
         AND ($8::numeric IS NULL OR pmt.tax_amount > $8)
       ORDER BY pmt.payment_date ASC NULLS LAST, pmt.created_at ASC NULLS LAST, pmt.id ASC
       LIMIT $9
     ) p',
    v_agg_order, v_columns
  ) USING p_company_id, v_method, v_date_from, v_date_to, v_deposit_confirmed,
            v_cheque_from, v_cheque_to, v_tax_gt, v_limit, v_all, v_pids
  INTO v_result;
  RETURN v_result;
END $function$;

-- ── payments + unit (oldest first) ──────────────────────────────────────────
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
  ) ORDER BY p.payment_date ASC NULLS LAST, p.created_at ASC NULLS LAST), '[]'::jsonb)
  FROM public.payments p CROSS JOIN cfg
  LEFT JOIN public.sales s ON s.id = p.sale_id
  WHERE p.company_id = p_company_id
    AND (cfg.v_all OR (s.id IS NOT NULL AND s.project_id = ANY(cfg.v_pids)))
    AND (NULLIF(p_filters->>'date_from','')::date IS NULL OR p.payment_date >= (p_filters->>'date_from')::date)
    AND (NULLIF(p_filters->>'date_to','')::date IS NULL OR p.payment_date <= (p_filters->>'date_to')::date);
$function$;

-- ── agent commission payments (oldest first) ────────────────────────────────
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
  ) ORDER BY acp.payment_date ASC NULLS LAST, acp.created_at ASC NULLS LAST), '[]'::jsonb)
  FROM public.agent_commission_payments acp
  LEFT JOIN public.agents a ON a.id = acp.agent_id
  CROSS JOIN cfg
  WHERE acp.company_id = p_company_id
    AND (cfg.v_all OR acp.project_id = ANY(cfg.v_pids));
$function$;

-- ── possessions (oldest first) ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_possessions_filtered(p_company_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.possession_date ASC NULLS LAST, p.created_at ASC NULLS LAST), '[]'::jsonb)
  FROM public.possessions p
  WHERE p.company_id = p_company_id;
$function$;

-- ── sales by agent (oldest first) ───────────────────────────────────────────
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
  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.sale_date ASC NULLS LAST, s.created_at ASC NULLS LAST), '[]'::jsonb)
  FROM public.sales s CROSS JOIN cfg
  WHERE s.agent_id = p_agent_id AND s.company_id = p_company_id
    AND (cfg.v_all OR s.project_id = ANY(cfg.v_pids));
$function$;

-- ── sales by client (active units lookup — oldest first) ────────────────────
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
    ORDER BY s.sale_date ASC NULLS LAST, s.created_at ASC NULLS LAST), '[]'::jsonb)
  FROM public.sales s
  LEFT JOIN public.units u    ON u.id = s.unit_id
  LEFT JOIN public.projects p ON p.id = u.project_id
  CROSS JOIN cfg
  WHERE s.company_id = p_company_id AND s.client_id = p_client_id AND s.status = 'active'
    AND (cfg.v_all OR s.project_id = ANY(cfg.v_pids));
$function$;

-- ── all sales by client (oldest first) ──────────────────────────────────────
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
  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.sale_date ASC NULLS LAST, s.created_at ASC NULLS LAST), '[]'::jsonb)
  FROM public.sales s CROSS JOIN cfg
  WHERE s.client_id = p_client_id AND s.company_id = p_company_id
    AND (cfg.v_all OR s.project_id = ANY(cfg.v_pids));
$function$;

-- ── sales list (oldest first; LIMIT keeps earliest) ─────────────────────────
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

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.sale_date ASC NULLS LAST, s.created_at ASC NULLS LAST, s.id ASC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT * FROM public.sales
    WHERE company_id = p_company_id
      AND (v_all OR project_id = ANY(v_pids))
      AND (v_status IS NULL OR status = v_status)
      AND (v_status_in IS NULL OR status = ANY(string_to_array(v_status_in, ',')))
      AND (v_ids_in IS NULL OR id::text = ANY(string_to_array(v_ids_in, ',')))
      AND (v_discount_gt IS NULL OR discount > v_discount_gt)
    ORDER BY sale_date ASC NULLS LAST, created_at ASC NULLS LAST, id ASC
    LIMIT v_limit
  ) s;
  RETURN v_result;
END $function$;

-- ── sales register report (oldest first; LIMIT keeps earliest) ──────────────
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
  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.sale_date ASC NULLS LAST, s.created_at ASC NULLS LAST, s.id ASC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT * FROM public.sales
    WHERE company_id = p_company_id
      AND (v_status IS NULL OR status = v_status)
      AND (v_sale_from IS NULL OR sale_date >= v_sale_from)
      AND (v_sale_to IS NULL OR sale_date <= v_sale_to)
      AND (v_cancel_from IS NULL OR cancellation_date >= v_cancel_from)
      AND (v_cancel_to IS NULL OR cancellation_date <= v_cancel_to)
      AND (v_discount_gt IS NULL OR discount > v_discount_gt)
    ORDER BY sale_date ASC NULLS LAST, created_at ASC NULLS LAST, id ASC
    LIMIT v_limit
  ) s;
  RETURN v_result;
END $function$;
