-- ════════════════════════════════════════════════════════════
-- TENANT-ISOLATION T2: tenant-gate on 19 client read RPCs
-- 2026-05-30.
-- ════════════════════════════════════════════════════════════
-- Pattern:
--   v_all formula updated from
--     (me.id IS NULL) OR _rms_is_admin(me)
--   to
--     (me.id IS NULL) OR (me.company_id = p_company_id AND _rms_is_admin(me))
-- Net effect:
--   anon (me.id NULL)           → v_all=true  (reads stay permissive)
--   same-tenant admin           → v_all=true  (sees everything in own company)
--   same-tenant non-admin       → v_all=false (falls through to v_pids/UPA)
--   CROSS-tenant admin/officer  → v_all=false AND v_pids empty (UPA scoped by p_company_id) → no rows
-- Body otherwise verbatim.
-- For the 2 derived RPCs (get_client_360, get_client_promise_history),
-- the parent clients lookup is scoped by v_me.company_id (with super-admin
-- bypass) so cross-tenant ids return "not found" naturally.

-- ────────────────── sql/cfg-CTE pattern (12 RPCs) ──────────────────

CREATE OR REPLACE FUNCTION public.check_client_blacklisted(p_client_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR (me.company_id = p_company_id AND public._rms_is_admin(me)) FROM public._rms_caller() me), true) AS v_all,
      COALESCE((SELECT array_agg(upa.project_id) FROM public._rms_caller() me
        JOIN public.user_project_assignments upa ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT COALESCE(
    (SELECT jsonb_build_object('blacklisted', true, 'reason', bc.reason, 'reason_type', bc.reason_type, 'blacklist_date', bc.blacklist_date)
     FROM public.blacklisted_clients bc
     JOIN public.clients c ON c.id = bc.client_id AND c.company_id = bc.company_id
     CROSS JOIN cfg
     WHERE bc.client_id = p_client_id AND bc.company_id = p_company_id AND bc.is_active = true
       AND (cfg.v_all OR c.project_id = ANY(cfg.v_pids))
     ORDER BY bc.blacklist_date DESC LIMIT 1),
    jsonb_build_object('blacklisted', false));
$function$;

CREATE OR REPLACE FUNCTION public.get_client_by_id(p_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR (me.company_id = p_company_id AND public._rms_is_admin(me)) FROM public._rms_caller() me), true) AS v_all,
      COALESCE((SELECT array_agg(upa.project_id) FROM public._rms_caller() me
        JOIN public.user_project_assignments upa ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT to_jsonb(c) FROM public.clients c CROSS JOIN cfg
  WHERE c.id = p_id AND c.company_id = p_company_id
    AND (cfg.v_all OR c.project_id = ANY(cfg.v_pids));
$function$;

CREATE OR REPLACE FUNCTION public.get_client_detail_for_search(p_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR (me.company_id = p_company_id AND public._rms_is_admin(me)) FROM public._rms_caller() me), true) AS v_all,
      COALESCE((SELECT array_agg(upa.project_id) FROM public._rms_caller() me
        JOIN public.user_project_assignments upa ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT jsonb_build_object(
    'full_name', c.full_name, 'cnic', c.cnic, 'phone_primary', c.phone_primary,
    'phone_secondary', c.phone_secondary, 'email', c.email, 'address', c.address,
    'city', c.city, 'father_name', c.father_name, 'next_of_kin_name', c.next_of_kin_name,
    'next_of_kin_relation', c.next_of_kin_relation, 'next_of_kin_phone', c.next_of_kin_phone,
    'overseas_local', c.overseas_local, 'occupation', c.occupation, 'client_category', c.client_category)
  FROM public.clients c CROSS JOIN cfg
  WHERE c.id = p_id AND c.company_id = p_company_id
    AND (cfg.v_all OR c.project_id = ANY(cfg.v_pids));
$function$;

CREATE OR REPLACE FUNCTION public.get_client_health_history(p_client_id uuid, p_company_id uuid, p_limit integer DEFAULT 30)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR (me.company_id = p_company_id AND public._rms_is_admin(me)) FROM public._rms_caller() me), true) AS v_all,
      COALESCE((SELECT array_agg(upa.project_id) FROM public._rms_caller() me
        JOIN public.user_project_assignments upa ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT COALESCE(jsonb_agg(row_to_json(h) ORDER BY h.calculated_at ASC), '[]'::jsonb)
  FROM (
    SELECT chh.score, chh.category, chh.total_exposure, chh.calculated_at
    FROM public.client_health_history chh
    JOIN public.clients c ON c.id = chh.client_id AND c.company_id = chh.company_id
    CROSS JOIN cfg
    WHERE chh.client_id = p_client_id AND chh.company_id = p_company_id
      AND (cfg.v_all OR c.project_id = ANY(cfg.v_pids))
    ORDER BY chh.calculated_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 30), 365))
  ) h;
$function$;

CREATE OR REPLACE FUNCTION public.get_client_health_score(p_client_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR (me.company_id = p_company_id AND public._rms_is_admin(me)) FROM public._rms_caller() me), true) AS v_all,
      COALESCE((SELECT array_agg(upa.project_id) FROM public._rms_caller() me
        JOIN public.user_project_assignments upa ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT COALESCE(to_jsonb(h), 'null'::jsonb)
  FROM (
    SELECT chs.* FROM public.client_health_scores chs
    JOIN public.clients c ON c.id = chs.client_id AND c.company_id = chs.company_id
    CROSS JOIN cfg
    WHERE chs.client_id = p_client_id AND chs.company_id = p_company_id
      AND (cfg.v_all OR c.project_id = ANY(cfg.v_pids))
    ORDER BY chs.last_calculated DESC NULLS LAST LIMIT 1
  ) h;
$function$;

CREATE OR REPLACE FUNCTION public.get_client_lite(p_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR (me.company_id = p_company_id AND public._rms_is_admin(me)) FROM public._rms_caller() me), true) AS v_all,
      COALESCE((SELECT array_agg(upa.project_id) FROM public._rms_caller() me
        JOIN public.user_project_assignments upa ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT jsonb_build_object('id', c.id, 'full_name', c.full_name, 'cnic', c.cnic,
    'phone_primary', c.phone_primary, 'client_code', c.client_code)
  FROM public.clients c CROSS JOIN cfg
  WHERE c.id = p_id AND c.company_id = p_company_id
    AND (cfg.v_all OR c.project_id = ANY(cfg.v_pids));
$function$;

CREATE OR REPLACE FUNCTION public.get_clients_all(p_company_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR (me.company_id = p_company_id AND public._rms_is_admin(me)) FROM public._rms_caller() me), true) AS v_all,
      COALESCE((SELECT array_agg(upa.project_id) FROM public._rms_caller() me
        JOIN public.user_project_assignments upa ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.full_name), '[]'::jsonb)
  FROM public.clients c CROSS JOIN cfg
  WHERE c.company_id = p_company_id
    AND (cfg.v_all OR c.project_id = ANY(cfg.v_pids));
$function$;

CREATE OR REPLACE FUNCTION public.list_blacklisted_clients(p_company_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR (me.company_id = p_company_id AND public._rms_is_admin(me)) FROM public._rms_caller() me), true) AS v_all,
      COALESCE((SELECT array_agg(upa.project_id) FROM public._rms_caller() me
        JOIN public.user_project_assignments upa ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', b.id, 'company_id', b.company_id, 'client_id', b.client_id,
    'reason', b.reason, 'reason_type', b.reason_type, 'blacklist_date', b.blacklist_date,
    'related_cancellation_id', b.related_cancellation_id,
    'approved_by', b.approved_by, 'is_active', b.is_active,
    'removed_date', b.removed_date, 'removed_by', b.removed_by,
    'removal_reason', b.removal_reason, 'created_at', b.created_at,
    'clients', jsonb_build_object('client_name', c.full_name, 'client_code', c.client_code, 'phone', c.phone_primary)
  ) ORDER BY b.blacklist_date DESC), '[]'::jsonb)
  FROM public.blacklisted_clients b
  LEFT JOIN public.clients c ON c.id = b.client_id
  CROSS JOIN cfg
  WHERE b.company_id = p_company_id
    AND (cfg.v_all OR c.project_id = ANY(cfg.v_pids));
$function$;

CREATE OR REPLACE FUNCTION public.list_clients_for_search(p_company_id uuid, p_filter text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR (me.company_id = p_company_id AND public._rms_is_admin(me)) FROM public._rms_caller() me), true) AS v_all,
      COALESCE((SELECT array_agg(upa.project_id) FROM public._rms_caller() me
        JOIN public.user_project_assignments upa ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', c.id, 'full_name', c.full_name, 'cnic', c.cnic, 'phone_primary', c.phone_primary,
    'is_blacklisted', c.is_blacklisted, 'is_defaulter', c.is_defaulter,
    'has_cancellation_history', c.has_cancellation_history)), '[]'::jsonb)
  FROM (SELECT c.* FROM public.clients c CROSS JOIN cfg
        WHERE c.company_id = p_company_id
          AND (cfg.v_all OR c.project_id = ANY(cfg.v_pids))
          AND (p_filter IS NULL
            OR (p_filter='blacklisted' AND c.is_blacklisted)
            OR (p_filter='defaulter' AND c.is_defaulter)
            OR (p_filter='active' AND NOT COALESCE(c.is_blacklisted,false) AND NOT COALESCE(c.is_defaulter,false)))
        ORDER BY c.full_name LIMIT 300) c;
$function$;

CREATE OR REPLACE FUNCTION public.list_clients_lookup(p_company_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR (me.company_id = p_company_id AND public._rms_is_admin(me)) FROM public._rms_caller() me), true) AS v_all,
      COALESCE((SELECT array_agg(upa.project_id) FROM public._rms_caller() me
        JOIN public.user_project_assignments upa ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', c.id, 'client_name', c.full_name, 'full_name', c.full_name,
    'client_code', c.client_code, 'phone', c.phone_primary,
    'phone_primary', c.phone_primary, 'cnic', c.cnic) ORDER BY c.full_name), '[]'::jsonb)
  FROM public.clients c CROSS JOIN cfg
  WHERE c.company_id = p_company_id
    AND (cfg.v_all OR c.project_id = ANY(cfg.v_pids));
$function$;

CREATE OR REPLACE FUNCTION public.list_sales_by_client(p_client_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR (me.company_id = p_company_id AND public._rms_is_admin(me)) FROM public._rms_caller() me), true) AS v_all,
      COALESCE((SELECT array_agg(upa.project_id) FROM public._rms_caller() me
        JOIN public.user_project_assignments upa ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id, 'sale_number', s.sale_number, 'unit_id', s.unit_id,
    'units', jsonb_build_object('unit_no', u.unit_no),
    'projects', jsonb_build_object('project_name', p.project_name))), '[]'::jsonb)
  FROM public.sales s
  LEFT JOIN public.units u    ON u.id = s.unit_id
  LEFT JOIN public.projects p ON p.id = u.project_id
  CROSS JOIN cfg
  WHERE s.company_id = p_company_id AND s.client_id = p_client_id AND s.status = 'active'
    AND (cfg.v_all OR s.project_id = ANY(cfg.v_pids));
$function$;

CREATE OR REPLACE FUNCTION public.list_sales_by_client_all(p_client_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR (me.company_id = p_company_id AND public._rms_is_admin(me)) FROM public._rms_caller() me), true) AS v_all,
      COALESCE((SELECT array_agg(upa.project_id) FROM public._rms_caller() me
        JOIN public.user_project_assignments upa ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
  FROM public.sales s CROSS JOIN cfg
  WHERE s.client_id = p_client_id AND s.company_id = p_company_id
    AND (cfg.v_all OR s.project_id = ANY(cfg.v_pids));
$function$;

-- ────────────────── plpgsql with v_me variable (5 RPCs) ──────────────────

CREATE OR REPLACE FUNCTION public.get_client_ledger(p_client_id uuid, p_company_id uuid, p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_rows jsonb; v_opening_balance numeric := 0;
  v_ob_debit numeric := 0; v_ob_credit numeric := 0;
  v_period_net numeric := 0; v_client_info jsonb;
  v_me public.app_users := public._rms_caller();
  v_all boolean := (v_me.id IS NULL) OR (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids uuid[]; v_proj uuid;
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;
  SELECT project_id INTO v_proj FROM public.clients WHERE id = p_client_id AND company_id = p_company_id;
  IF v_proj IS NULL OR (NOT v_all AND NOT (v_proj = ANY(v_pids))) THEN
    RETURN jsonb_build_object('success', true, 'client_info', '{}'::jsonb,
      'opening_balance', 0, 'rows', '[]'::jsonb, 'closing_balance', 0);
  END IF;
  SELECT jsonb_build_object('client_name', c.full_name, 'client_code', c.client_code,
    'projects', (SELECT STRING_AGG(DISTINCT pj.project_name, ', ' ORDER BY pj.project_name)
      FROM sales s2 JOIN projects pj ON pj.id = s2.project_id
      WHERE s2.client_id = p_client_id AND s2.company_id = p_company_id AND s2.status NOT IN ('cancelled')))
  INTO v_client_info FROM clients c WHERE c.id = p_client_id AND c.company_id = p_company_id;
  IF p_from_date IS NOT NULL THEN
    SELECT COALESCE(SUM(i.amount_due), 0) INTO v_ob_debit
    FROM installments i JOIN sales s ON s.id = i.sale_id
    WHERE i.company_id = p_company_id AND s.client_id = p_client_id AND i.due_date < p_from_date;
    SELECT COALESCE(SUM(p.amount), 0) INTO v_ob_credit
    FROM payments p JOIN sales s ON s.id = p.sale_id
    WHERE p.company_id = p_company_id AND p.client_id = p_client_id AND p.status != 'cancelled' AND p.payment_date < p_from_date;
    v_opening_balance := v_ob_debit - v_ob_credit;
  END IF;
  SELECT jsonb_agg(to_jsonb(r)) INTO v_rows FROM (
    SELECT CASE i.installment_type WHEN 'down_payment' THEN 'DP-0' ELSE 'INS-' || LPAD(i.installment_number::text, 2, '0') END AS voucher_no,
      'DR' AS row_type, 1 AS row_order, i.due_date AS entry_date, i.created_at AS created_at,
      CASE i.installment_type WHEN 'down_payment' THEN 'Installment Due — Down Payment / Booking'
        ELSE 'Installment Due — ' || i.installment_number::text ||
          CASE WHEN i.installment_number % 100 BETWEEN 11 AND 13 THEN 'th'
            WHEN i.installment_number % 10 = 1 THEN 'st'
            WHEN i.installment_number % 10 = 2 THEN 'nd'
            WHEN i.installment_number % 10 = 3 THEN 'rd' ELSE 'th' END || ' Installment' END AS description,
      i.amount_due AS debit, NULL::numeric AS credit, NULL::text AS chq_no, s.sale_number AS sale_number
    FROM public.installments i JOIN public.sales s ON s.id = i.sale_id
    WHERE i.company_id = p_company_id AND s.client_id = p_client_id
      AND (p_from_date IS NULL OR i.due_date >= p_from_date)
      AND (p_to_date IS NULL OR i.due_date <= p_to_date)
    UNION ALL
    SELECT COALESCE(p.voucher_code, p.payment_code) AS voucher_no,
      'CR' AS row_type, 2 AS row_order, p.payment_date AS entry_date, p.created_at AS created_at,
      'Payment Received — ' || INITCAP(REPLACE(p.payment_method, '_', ' ')) ||
        CASE WHEN p.voucher_code IS NOT NULL THEN ' [' || p.voucher_code || ']'
          WHEN p.payment_code IS NOT NULL THEN ' [' || p.payment_code || ']' ELSE '' END AS description,
      NULL::numeric AS debit, p.amount AS credit,
      CASE WHEN LOWER(p.payment_method) IN ('pdc','cheque') THEN p.reference_no ELSE NULL END AS chq_no,
      s.sale_number AS sale_number
    FROM public.payments p JOIN public.sales s ON s.id = p.sale_id
    WHERE p.company_id = p_company_id AND p.client_id = p_client_id AND p.status != 'cancelled'
      AND (p_from_date IS NULL OR p.payment_date >= p_from_date)
      AND (p_to_date IS NULL OR p.payment_date <= p_to_date)
    ORDER BY entry_date NULLS LAST, created_at, row_order
  ) r;
  SELECT COALESCE(SUM(COALESCE((r->>'debit')::numeric, 0) - COALESCE((r->>'credit')::numeric, 0)), 0) INTO v_period_net
  FROM jsonb_array_elements(COALESCE(v_rows, '[]'::jsonb)) r;
  RETURN jsonb_build_object('success', true, 'client_info', COALESCE(v_client_info, '{}'::jsonb),
    'opening_balance', v_opening_balance, 'rows', COALESCE(v_rows, '[]'::jsonb),
    'closing_balance', v_opening_balance + v_period_net);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_clients_by_health_category(p_company_id uuid, p_category text DEFAULT 'ALL'::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB;
  v_me public.app_users := public._rms_caller();
  v_all boolean := (v_me.id IS NULL) OR (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids uuid[];
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'client_id', c.id, 'client_name', c.full_name, 'client_code', c.client_code,
    'phone', c.phone_primary, 'score', chs.score, 'category', chs.category,
    'exposure', chs.total_exposure, 'score_breakdown', chs.score_breakdown,
    'last_calculated', chs.last_calculated,
    'last_payment_date', (SELECT MAX(p.payment_date) FROM payments p WHERE p.client_id = c.id AND p.company_id = p_company_id)
  ) ORDER BY chs.score ASC), '[]'::jsonb) INTO v_result
  FROM client_health_scores chs JOIN clients c ON c.id = chs.client_id
  WHERE chs.company_id = p_company_id
    AND (v_all OR c.project_id = ANY(v_pids))
    AND (p_category = 'ALL' OR chs.category = p_category);
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_clients_plan_status(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_max int; v_count int;
  v_me public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NOT NULL AND NOT COALESCE(v_me.is_super_admin, false)
     AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('applicable', false, 'error', 'wrong_tenant');
  END IF;
  IF v_me.id IS NOT NULL AND NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('applicable', false, 'error', 'not_applicable',
      'message', 'Plan status is visible to admins only.');
  END IF;
  SELECT sp.max_clients INTO v_max FROM subscriptions s
  JOIN subscription_plans sp ON sp.id = s.plan_id
  WHERE s.company_id = p_company_id AND s.status IN ('active','trialing')
  ORDER BY s.created_at DESC NULLS LAST LIMIT 1;
  SELECT COUNT(*)::int INTO v_count FROM clients WHERE company_id = p_company_id;
  RETURN jsonb_build_object('current_count', v_count,
    'max_allowed', COALESCE(v_max, 0), 'can_add', v_count < COALESCE(v_max, 0));
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_clients(p_company_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_search TEXT := NULLIF(p_filters->>'search', '');
  v_status TEXT := NULLIF(p_filters->>'status', '');
  v_category TEXT := NULLIF(p_filters->>'category', '');
  v_limit INTEGER := COALESCE((p_filters->>'limit')::INTEGER, 20);
  v_offset INTEGER := COALESCE((p_filters->>'offset')::INTEGER, 0);
  v_total INTEGER; v_rows JSONB;
  v_me public.app_users := public._rms_caller();
  v_all boolean := (v_me.id IS NULL) OR (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids uuid[];
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;
  SELECT COUNT(*) INTO v_total FROM public.clients c
  WHERE c.company_id = p_company_id
    AND (v_all OR c.project_id = ANY(v_pids))
    AND (v_status IS NULL OR c.status = v_status)
    AND (v_category IS NULL OR c.client_category = v_category)
    AND (v_search IS NULL OR
         c.full_name ILIKE '%' || v_search || '%' OR
         c.cnic ILIKE '%' || v_search || '%' OR
         c.phone_primary ILIKE '%' || v_search || '%' OR
         c.email ILIKE '%' || v_search || '%' OR
         c.client_code ILIKE '%' || v_search || '%');
  SELECT jsonb_agg(to_jsonb(c) ORDER BY c.full_name) INTO v_rows FROM (
    SELECT c.* FROM public.clients c
    WHERE c.company_id = p_company_id
      AND (v_all OR c.project_id = ANY(v_pids))
      AND (v_status IS NULL OR c.status = v_status)
      AND (v_category IS NULL OR c.client_category = v_category)
      AND (v_search IS NULL OR
           c.full_name ILIKE '%' || v_search || '%' OR
           c.cnic ILIKE '%' || v_search || '%' OR
           c.phone_primary ILIKE '%' || v_search || '%' OR
           c.email ILIKE '%' || v_search || '%' OR
           c.client_code ILIKE '%' || v_search || '%')
    ORDER BY c.full_name LIMIT v_limit OFFSET v_offset
  ) c;
  RETURN jsonb_build_object('total', v_total, 'rows', COALESCE(v_rows, '[]'::JSONB),
    'limit', v_limit, 'offset', v_offset);
END; $function$;

-- ────────────────── plpgsql with explicit tenant check (1 RPC) ──────────────────

CREATE OR REPLACE FUNCTION public.get_client_documents(p_client_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users; v_all boolean; v_pids uuid[];
  v_proj uuid; v_sales jsonb; v_notices jsonb; v_nocs jsonb; v_receipts jsonb;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_session');
  END IF;
  IF NOT COALESCE(v_me.is_super_admin, false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;
  v_all := public._rms_is_admin(v_me);
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;
  SELECT project_id INTO v_proj FROM public.clients WHERE id = p_client_id AND company_id = p_company_id;
  IF v_proj IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;
  IF NOT v_all AND NOT (v_proj = ANY(v_pids)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'doc_type','agreement','label','Sale Agreement',
    'ref',s.sale_number,'date',s.sale_date,'sale_id',s.id,
    'unit_no',u.unit_no,'project',COALESCE(pr.project_name,'')
  ) ORDER BY s.sale_date DESC NULLS LAST), '[]'::jsonb) INTO v_sales
  FROM public.sales s
  LEFT JOIN public.units u ON u.id = s.unit_id
  LEFT JOIN public.projects pr ON pr.id = COALESCE(s.project_id, u.project_id)
  WHERE s.client_id = p_client_id AND s.company_id = p_company_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'doc_type','demand_notice','label','Demand Notice',
    'ref',dn.notice_no,'date',dn.notice_date,'sale_id',dn.sale_id,
    'channel',dn.channel,'amount',dn.overdue_amount
  ) ORDER BY dn.created_at DESC), '[]'::jsonb) INTO v_notices
  FROM public.demand_notices dn
  WHERE dn.client_id = p_client_id AND dn.company_id = p_company_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'doc_type','noc','label','NOC — '||INITCAP(COALESCE(n.noc_type,'general')),
    'ref',COALESCE(n.noc_number,'NOC-'||LEFT(n.id::text,8)),
    'date',COALESCE(n.approved_at::date,n.requested_at::date),
    'noc_id',n.id,'noc_type',n.noc_type,'status',n.status,'unit_no',n.unit_no
  ) ORDER BY n.requested_at DESC NULLS LAST), '[]'::jsonb) INTO v_nocs
  FROM public.noc n
  WHERE n.client_id = p_client_id AND n.company_id = p_company_id AND n.status='approved';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'doc_type','receipt','label','Payment Receipt',
    'ref',COALESCE(p.voucher_code,p.payment_code),'date',p.payment_date,
    'sale_id',p.sale_id,'amount',p.amount,'payment_id',p.id
  ) ORDER BY p.payment_date DESC NULLS LAST), '[]'::jsonb) INTO v_receipts
  FROM (SELECT p2.* FROM public.payments p2
    JOIN public.sales s2 ON s2.id=p2.sale_id AND s2.client_id=p_client_id
    WHERE p2.company_id=p_company_id AND p2.status IN ('received','cleared')
    ORDER BY p2.payment_date DESC NULLS LAST LIMIT 5) p;

  RETURN jsonb_build_object('success', true,
    'sales', v_sales, 'notices', v_notices,
    'nocs', COALESCE(v_nocs, '[]'::jsonb), 'receipts', COALESCE(v_receipts, '[]'::jsonb));
END;
$function$;

-- ────────────────── derived (parent-lookup scoped) (2 RPCs) ──────────────────

CREATE OR REPLACE FUNCTION public.get_client_360(p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB;
  v_me public.app_users := public._rms_caller();
  v_all boolean;
  v_pids uuid[];
  v_target_company uuid;
BEGIN
  -- Scope parent client lookup by caller's company (super-admin bypass).
  SELECT company_id INTO v_target_company FROM public.clients
  WHERE id = p_id
    AND (v_me.id IS NULL
         OR COALESCE(v_me.is_super_admin, false)
         OR company_id = v_me.company_id);
  IF v_target_company IS NULL THEN
    RETURN jsonb_build_object('error', 'Client not found');
  END IF;

  v_all := (v_me.id IS NULL) OR public._rms_is_admin(v_me);
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE user_id = v_me.id AND is_active;
  END IF;
  SELECT to_jsonb(c) INTO v_result FROM public.clients c
  WHERE c.id = p_id AND (v_all OR c.project_id = ANY(v_pids));
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Client not found');
  END IF;
  RETURN jsonb_build_object('client', v_result);
END; $function$;

CREATE OR REPLACE FUNCTION public.get_client_promise_history(p_client_id uuid, p_limit integer DEFAULT 20)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB; v_kept INT; v_broken INT; v_total INT; v_pending INT;
  v_me public.app_users := public._rms_caller();
  v_all boolean := (v_me.id IS NULL) OR public._rms_is_admin(v_me);
  v_pids uuid[]; v_proj uuid;
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments WHERE user_id = v_me.id AND is_active;
  END IF;
  -- Scope parent client lookup by caller's company (super-admin bypass).
  SELECT project_id INTO v_proj FROM public.clients
  WHERE id = p_client_id
    AND (v_me.id IS NULL
         OR COALESCE(v_me.is_super_admin, false)
         OR company_id = v_me.company_id);
  IF v_proj IS NULL OR (NOT v_all AND NOT (v_proj = ANY(v_pids))) THEN
    RETURN jsonb_build_object('promises', '[]'::jsonb,
      'stats', jsonb_build_object('total',0,'kept',0,'broken',0,'pending',0,'kept_pct',0));
  END IF;
  SELECT COUNT(*),
    COUNT(*) FILTER (WHERE status IN ('kept','partial')),
    COUNT(*) FILTER (WHERE status = 'broken'),
    COUNT(*) FILTER (WHERE status = 'pending')
  INTO v_total, v_kept, v_broken, v_pending
  FROM payment_promises WHERE client_id = p_client_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', pp.id, 'promised_amount', pp.promised_amount, 'promise_date', pp.promise_date,
    'status', pp.status, 'promised_via', pp.promised_via, 'logged_by', pp.logged_by,
    'notes', pp.notes, 'broken_reason', pp.broken_reason,
    'actual_paid_amount', COALESCE(pp.actual_paid_amount, 0),
    'actual_paid_date', pp.actual_paid_date, 'created_at', pp.created_at
  ) ORDER BY pp.created_at DESC), '[]'::JSONB) INTO v_result
  FROM payment_promises pp WHERE pp.client_id = p_client_id
  LIMIT COALESCE(p_limit, 20);
  RETURN jsonb_build_object('promises', COALESCE(v_result, '[]'::JSONB),
    'stats', jsonb_build_object('total', v_total, 'kept', v_kept, 'broken', v_broken, 'pending', v_pending,
      'kept_pct', CASE WHEN v_total > 0 THEN ROUND(v_kept::NUMERIC / v_total * 100) ELSE 0 END));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('promises', '[]'::JSONB, 'stats', jsonb_build_object('total',0,'kept',0,'broken',0,'pending',0,'kept_pct',0));
END;
$function$;
