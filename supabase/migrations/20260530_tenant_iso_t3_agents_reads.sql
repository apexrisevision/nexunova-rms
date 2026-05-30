-- ════════════════════════════════════════════════════════════
-- TENANT-ISOLATION T3: tenant gate on 18 agent read RPCs
-- 2026-05-30.
-- ════════════════════════════════════════════════════════════
-- Same pattern as T2:
--   sql/cfg-CTE: v_all formula updated to require me.company_id = p_company_id
--                for the admin branch; anon (me.id IS NULL) stays permissive.
--   plpgsql v_me: same change on the v_all boolean.
-- For the 1 derived RPC (get_agent_name, no p_company_id arg), the agents
-- lookup is scoped by v_me.company_id (with super-admin bypass).

CREATE OR REPLACE FUNCTION public.get_agent_detail_for_search(p_id uuid, p_company_id uuid)
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
    'full_name', a.full_name, 'agent_code', a.agent_code, 'phone', a.phone,
    'commission_percent', a.commission_percent, 'total_commission_earned', a.total_commission_earned,
    'total_commission_paid', a.total_commission_paid, 'total_commission_pending', a.total_commission_pending)
  FROM public.agents a CROSS JOIN cfg
  WHERE a.id = p_id AND a.company_id = p_company_id
    AND (cfg.v_all OR a.project_id = ANY(cfg.v_pids));
$function$;

CREATE OR REPLACE FUNCTION public.get_agent_extended(p_id uuid, p_company_id uuid)
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
    'territory', a.territory, 'monthly_target', a.monthly_target,
    'quarterly_target', a.quarterly_target, 'contract_doc_url', a.contract_doc_url,
    'parent_agent_id', a.parent_agent_id)
  FROM public.agents a CROSS JOIN cfg
  WHERE a.id = p_id AND a.company_id = p_company_id
    AND (cfg.v_all OR a.project_id = ANY(cfg.v_pids));
$function$;

CREATE OR REPLACE FUNCTION public.get_agent_full(p_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR (me.company_id = p_company_id AND public._rms_is_admin(me)) FROM public._rms_caller() me), true) AS v_all,
      COALESCE((SELECT array_agg(upa.project_id) FROM public._rms_caller() me
        JOIN public.user_project_assignments upa ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT to_jsonb(a) FROM public.agents a CROSS JOIN cfg
  WHERE a.id = p_id AND a.company_id = p_company_id
    AND (cfg.v_all OR a.project_id = ANY(cfg.v_pids));
$function$;

CREATE OR REPLACE FUNCTION public.get_agent_lite(p_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR (me.company_id = p_company_id AND public._rms_is_admin(me)) FROM public._rms_caller() me), true) AS v_all,
      COALESCE((SELECT array_agg(upa.project_id) FROM public._rms_caller() me
        JOIN public.user_project_assignments upa ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT jsonb_build_object('id', a.id, 'full_name', a.full_name, 'agent_code', a.agent_code, 'commission_percent', a.commission_percent)
  FROM public.agents a CROSS JOIN cfg
  WHERE a.id = p_id AND a.company_id = p_company_id
    AND (cfg.v_all OR a.project_id = ANY(cfg.v_pids));
$function$;

CREATE OR REPLACE FUNCTION public.list_agent_commission_payments(p_company_id uuid, p_agent_id uuid DEFAULT NULL::uuid)
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
    'id', acp.id, 'company_id', acp.company_id, 'agent_id', acp.agent_id, 'sale_id', acp.sale_id,
    'amount', acp.amount, 'payment_date', acp.payment_date, 'payment_method', acp.payment_method,
    'reference_no', acp.reference_no, 'notes', acp.notes, 'created_by', acp.created_by, 'created_at', acp.created_at,
    'agents', jsonb_build_object('full_name', a.full_name, 'agent_code', a.agent_code)
  ) ORDER BY acp.payment_date DESC), '[]'::jsonb)
  FROM public.agent_commission_payments acp
  LEFT JOIN public.agents a ON a.id = acp.agent_id
  CROSS JOIN cfg
  WHERE acp.company_id = p_company_id
    AND (cfg.v_all OR acp.project_id = ANY(cfg.v_pids))
    AND (p_agent_id IS NULL OR acp.agent_id = p_agent_id);
$function$;

CREATE OR REPLACE FUNCTION public.list_agent_commissions_with_agent(p_company_id uuid)
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
    'id', acp.id, 'agent_id', acp.agent_id, 'sale_id', acp.sale_id, 'amount', acp.amount,
    'payment_date', acp.payment_date, 'payment_method', acp.payment_method,
    'reference_no', acp.reference_no, 'created_by', acp.created_by, 'notes', acp.notes,
    'agents', jsonb_build_object('full_name', a.full_name, 'agent_code', a.agent_code)
  )), '[]'::jsonb)
  FROM public.agent_commission_payments acp
  LEFT JOIN public.agents a ON a.id = acp.agent_id
  CROSS JOIN cfg
  WHERE acp.company_id = p_company_id
    AND (cfg.v_all OR acp.project_id = ANY(cfg.v_pids));
$function$;

CREATE OR REPLACE FUNCTION public.list_agent_transactions(p_company_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
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
    'id', t.id, 'company_id', t.company_id, 'agent_id', t.agent_id,
    'transaction_type', t.transaction_type, 'amount', t.amount,
    'related_sale_id', t.related_sale_id, 'related_cancellation_id', t.related_cancellation_id,
    'related_transfer_id', t.related_transfer_id, 'payment_method', t.payment_method,
    'reference', t.reference, 'notes', t.notes, 'created_by', t.created_by, 'created_at', t.created_at,
    'agents', jsonb_build_object('agent_name', a.full_name, 'agent_code', a.agent_code, 'full_name', a.full_name)
  ) ORDER BY t.created_at DESC), '[]'::jsonb)
  FROM public.agent_transactions t
  LEFT JOIN public.agents a ON a.id = t.agent_id
  CROSS JOIN cfg
  WHERE t.company_id = p_company_id
    AND (cfg.v_all OR t.project_id = ANY(cfg.v_pids))
    AND (NULLIF(p_filters->>'agent_id','') IS NULL OR t.agent_id = (p_filters->>'agent_id')::uuid)
    AND (NULLIF(p_filters->>'transaction_type','') IS NULL OR t.transaction_type = p_filters->>'transaction_type');
$function$;

CREATE OR REPLACE FUNCTION public.list_agents_for_fnav(p_company_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR (me.company_id = p_company_id AND public._rms_is_admin(me)) FROM public._rms_caller() me), true) AS v_all,
      COALESCE((SELECT array_agg(upa.project_id) FROM public._rms_caller() me
        JOIN public.user_project_assignments upa ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a.id, 'created_at', a.created_at) ORDER BY a.created_at ASC), '[]'::jsonb)
  FROM public.agents a CROSS JOIN cfg
  WHERE a.company_id = p_company_id
    AND (cfg.v_all OR a.project_id = ANY(cfg.v_pids));
$function$;

CREATE OR REPLACE FUNCTION public.list_agents_for_reports(p_company_id uuid)
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
    'id', a.id, 'full_name', a.full_name, 'agent_code', a.agent_code, 'phone', a.phone,
    'commission_percent', a.commission_percent, 'total_commission_earned', a.total_commission_earned,
    'status', a.status) ORDER BY a.full_name), '[]'::jsonb)
  FROM public.agents a CROSS JOIN cfg
  WHERE a.company_id = p_company_id
    AND (cfg.v_all OR a.project_id = ANY(cfg.v_pids));
$function$;

CREATE OR REPLACE FUNCTION public.list_agents_for_search(p_company_id uuid)
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
    'id', a.id, 'full_name', a.full_name, 'agent_code', a.agent_code,
    'phone', a.phone, 'status', a.status, 'commission_percent', a.commission_percent
  ) ORDER BY a.full_name), '[]'::jsonb)
  FROM public.agents a CROSS JOIN cfg
  WHERE a.company_id = p_company_id
    AND (cfg.v_all OR a.project_id = ANY(cfg.v_pids));
$function$;

CREATE OR REPLACE FUNCTION public.list_agents_lookup(p_company_id uuid)
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
    'id', a.id, 'agent_name', a.full_name, 'full_name', a.full_name,
    'agent_code', a.agent_code, 'phone', a.phone, 'commission_percent', a.commission_percent,
    'status', a.status, 'is_active', (a.status = 'active')
  ) ORDER BY a.full_name), '[]'::jsonb)
  FROM public.agents a CROSS JOIN cfg
  WHERE a.company_id = p_company_id
    AND (cfg.v_all OR a.project_id = ANY(cfg.v_pids));
$function$;

CREATE OR REPLACE FUNCTION public.list_sales_by_agent(p_agent_id uuid, p_company_id uuid)
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
  WHERE s.agent_id = p_agent_id AND s.company_id = p_company_id
    AND (cfg.v_all OR s.project_id = ANY(cfg.v_pids));
$function$;

CREATE OR REPLACE FUNCTION public.list_sub_agents(p_parent_id uuid, p_company_id uuid)
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
    'id', a.id, 'full_name', a.full_name, 'agent_code', a.agent_code,
    'status', a.status, 'total_sales_count', a.total_sales_count,
    'commission_percent', a.commission_percent)), '[]'::jsonb)
  FROM public.agents a CROSS JOIN cfg
  WHERE a.parent_agent_id = p_parent_id AND a.company_id = p_company_id
    AND (cfg.v_all OR a.project_id = ANY(cfg.v_pids));
$function$;

-- plpgsql with v_me boolean (4)

CREATE OR REPLACE FUNCTION public.get_agent_360(p_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_agent jsonb; v_sales jsonb;
  v_me public.app_users := public._rms_caller();
  v_all boolean := (v_me.id IS NULL) OR (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids uuid[];
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
  ), '[]'::jsonb) INTO v_sales
  FROM public.sales s
  JOIN public.agents a_ref ON a_ref.id = s.agent_id
  JOIN public.units u ON u.id = s.unit_id
  JOIN public.projects p ON p.id = u.project_id
  JOIN public.clients c ON c.id = s.client_id
  WHERE s.agent_id = p_id AND s.company_id = p_company_id;
  RETURN jsonb_build_object('success', true, 'agent', v_agent, 'sales', v_sales);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_agent_ledger(p_agent_id uuid, p_company_id uuid, p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_rows jsonb; v_opening_balance numeric := 0;
  v_ob_earned numeric := 0; v_ob_paid numeric := 0;
  v_period_net numeric := 0; v_agent_info jsonb;
  v_me public.app_users := public._rms_caller();
  v_all boolean := (v_me.id IS NULL) OR (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids uuid[]; v_proj uuid;
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;
  SELECT project_id INTO v_proj FROM public.agents
  WHERE id = p_agent_id AND company_id = p_company_id;
  IF v_proj IS NULL OR (NOT v_all AND NOT (v_proj = ANY(v_pids))) THEN
    RETURN jsonb_build_object('success', true, 'agent_info', '{}'::jsonb,
      'opening_balance', 0, 'rows', '[]'::jsonb, 'closing_balance', 0);
  END IF;
  SELECT jsonb_build_object(
    'agent_name', ag.full_name, 'agent_code', ag.agent_code,
    'projects', (SELECT STRING_AGG(DISTINCT pj.project_name, ', ' ORDER BY pj.project_name)
      FROM sales s2 JOIN projects pj ON pj.id = s2.project_id
      WHERE s2.agent_id = p_agent_id AND s2.company_id = p_company_id AND s2.status NOT IN ('cancelled')))
  INTO v_agent_info FROM agents ag
  WHERE ag.id = p_agent_id AND ag.company_id = p_company_id;
  IF p_from_date IS NOT NULL THEN
    SELECT COALESCE(SUM(ROUND(COALESCE(s.net_amount,0) * COALESCE(ag.commission_percent,0) / 100, 2)), 0) INTO v_ob_earned
    FROM sales s JOIN agents ag ON ag.id = p_agent_id AND ag.company_id = p_company_id
    WHERE s.agent_id = p_agent_id AND s.company_id = p_company_id
      AND s.status NOT IN ('cancelled')
      AND COALESCE(s.sale_date, s.created_at::date) < p_from_date;
    SELECT COALESCE(SUM(acp.amount), 0) INTO v_ob_paid
    FROM agent_commission_payments acp
    WHERE acp.agent_id = p_agent_id AND acp.company_id = p_company_id
      AND acp.payment_date < p_from_date;
    v_opening_balance := v_ob_earned - v_ob_paid;
  END IF;
  SELECT jsonb_agg(r ORDER BY (r->>'row_date') NULLS LAST, (r->>'sort_key') NULLS LAST) INTO v_rows FROM (
    SELECT jsonb_build_object(
      'voucher_no', s.sale_number, 'row_type', 'earned',
      'row_date', COALESCE(TO_CHAR(s.sale_date,'YYYY-MM-DD'), TO_CHAR(s.created_at AT TIME ZONE 'Asia/Karachi','YYYY-MM-DD')),
      'description', 'Commission Earned — ' || COALESCE(u.unit_no, u.unit_code, '—') ||
                     CASE WHEN p.project_name IS NOT NULL THEN ' · ' || p.project_name ELSE '' END ||
                     CASE WHEN s.sale_number IS NOT NULL THEN ' · ' || s.sale_number ELSE '' END,
      'earned', ROUND(COALESCE(s.net_amount,0) * COALESCE(ag.commission_percent,0) / 100, 2),
      'paid', NULL, 'chq_no', NULL, 'sort_key', '1') AS r
    FROM sales s
    JOIN agents ag ON ag.id = p_agent_id AND ag.company_id = p_company_id
    LEFT JOIN units u ON u.id = s.unit_id
    LEFT JOIN projects p ON p.id = s.project_id
    WHERE s.agent_id = p_agent_id AND s.company_id = p_company_id
      AND s.status NOT IN ('cancelled')
      AND (p_from_date IS NULL OR COALESCE(s.sale_date, s.created_at::date) >= p_from_date)
      AND (p_to_date IS NULL OR COALESCE(s.sale_date, s.created_at::date) <= p_to_date)
    UNION ALL
    SELECT jsonb_build_object(
      'voucher_no', COALESCE(acp.reference_no, ''), 'row_type', 'paid',
      'row_date', TO_CHAR(acp.payment_date,'YYYY-MM-DD'),
      'description', 'Commission Paid' ||
                     CASE WHEN acp.reference_no IS NOT NULL THEN ' — ' || acp.reference_no ELSE '' END ||
                     CASE WHEN acp.payment_method IS NOT NULL THEN ' · ' || INITCAP(REPLACE(acp.payment_method,'_',' ')) ELSE '' END ||
                     CASE WHEN acp.notes IS NOT NULL THEN ' · ' || acp.notes ELSE '' END,
      'earned', NULL, 'paid', acp.amount, 'chq_no', NULL, 'sort_key', '2')
    FROM agent_commission_payments acp
    WHERE acp.agent_id = p_agent_id AND acp.company_id = p_company_id
      AND (p_from_date IS NULL OR acp.payment_date >= p_from_date)
      AND (p_to_date IS NULL OR acp.payment_date <= p_to_date)
  ) sub;
  SELECT COALESCE(SUM(
    CASE WHEN r->>'row_type' = 'earned' THEN (r->>'earned')::numeric
         WHEN r->>'row_type' = 'paid'   THEN -((r->>'paid')::numeric)
         ELSE 0 END), 0)
  INTO v_period_net FROM jsonb_array_elements(COALESCE(v_rows, '[]'::jsonb)) r;
  RETURN jsonb_build_object('success', true, 'agent_info', COALESCE(v_agent_info, '{}'::jsonb),
    'opening_balance', v_opening_balance, 'rows', COALESCE(v_rows, '[]'::jsonb),
    'closing_balance', v_opening_balance + v_period_net);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_agent_performance(p_id uuid, p_company_id uuid, p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_comm_pct NUMERIC; v_sales_count INT; v_revenue NUMERIC; v_commission NUMERIC;
  v_me public.app_users := public._rms_caller();
  v_all boolean := (v_me.id IS NULL) OR (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids uuid[];
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
  SELECT COUNT(*), COALESCE(SUM(net_amount), 0), COALESCE(SUM(net_amount * v_comm_pct / 100), 0)
  INTO v_sales_count, v_revenue, v_commission
  FROM public.sales
  WHERE agent_id = p_id AND company_id = p_company_id
    AND (p_from_date IS NULL OR sale_date >= p_from_date)
    AND (p_to_date IS NULL OR sale_date <= p_to_date);
  RETURN jsonb_build_object('success', true, 'sales_count', v_sales_count,
    'revenue', v_revenue, 'commission', v_commission,
    'from_date', p_from_date, 'to_date', p_to_date);
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_agents(p_company_id uuid, p_search text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_sort text DEFAULT 'name'::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_me public.app_users := public._rms_caller();
  v_all boolean := (v_me.id IS NULL) OR (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids uuid[];
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;
  SELECT jsonb_agg(row_data ORDER BY
    CASE WHEN p_sort = 'sales' THEN a.total_sales_count END DESC,
    CASE WHEN p_sort = 'commission' THEN a.total_commission_earned END DESC,
    CASE WHEN p_sort = 'name' THEN lower(a.full_name) END ASC)
  INTO v_result
  FROM (
    SELECT a.id, a.project_id, a.agent_code, a.full_name, a.phone, a.email, a.cnic,
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
      AND (p_search IS NULL OR p_search = '' OR
        lower(a.full_name) LIKE '%' || lower(p_search) || '%' OR
        a.phone LIKE '%' || p_search || '%' OR
        lower(COALESCE(a.email, '')) LIKE '%' || lower(p_search) || '%' OR
        lower(COALESCE(a.cnic, '')) LIKE '%' || lower(p_search) || '%' OR
        a.agent_code LIKE '%' || upper(p_search) || '%')
  ) a(id, project_id, agent_code, full_name, phone, email, cnic, address, commission_percent,
      status, join_date, profile_photo_url, bank_name, bank_account_no,
      bank_account_title, notes, rating, total_sales_count, total_sales_amount,
      total_commission_earned, total_commission_paid, total_commission_pending,
      created_at, updated_at),
  LATERAL (SELECT row_to_json(a)::jsonb AS row_data) r;
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

-- derived (1): scope agents lookup by caller's company

CREATE OR REPLACE FUNCTION public.get_agent_name(p_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR public._rms_is_admin(me) FROM public._rms_caller() me), true) AS v_all,
      COALESCE((SELECT array_agg(upa.project_id) FROM public._rms_caller() me
        JOIN public.user_project_assignments upa ON upa.user_id = me.id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT jsonb_build_object('full_name', a.full_name, 'agent_code', a.agent_code)
  FROM public.agents a CROSS JOIN cfg, public._rms_caller() me
  WHERE a.id = p_id
    AND (me.id IS NULL OR COALESCE(me.is_super_admin, false) OR a.company_id = me.company_id)
    AND (cfg.v_all OR a.project_id = ANY(cfg.v_pids));
$function$;
