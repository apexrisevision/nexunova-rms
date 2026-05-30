-- ════════════════════════════════════════════════════════════
-- PROJECT-SCOPING — BATCH 4, GROUP 4C: server-side isolation on agent
-- financial / sales-by-agent RPCs
-- 2026-05-30.  ⚠️ REVIEW ONLY — DO NOT APPLY until approved.
-- ════════════════════════════════════════════════════════════
-- Each RPC gated on its authoritative project source (no forced uniform rule):
--   • get_agent_ledger              → early-gate on parent agent.project_id
--                                      (mirrors get_client_ledger from 3C)
--   • list_agent_transactions       → direct on t.project_id
--   • list_agent_commission_payments → direct on acp.project_id
--   • list_agent_commissions_with_agent → direct on acp.project_id
--   • list_sales_by_agent           → direct on s.project_id (per flag decision)
-- Anon (no session) stays PERMISSIVE.

-- ── 1. get_agent_ledger (early gate via parent agent.project_id) ──
CREATE OR REPLACE FUNCTION public.get_agent_ledger(p_agent_id uuid, p_company_id uuid, p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rows            jsonb;
  v_opening_balance numeric := 0;
  v_ob_earned       numeric := 0;
  v_ob_paid         numeric := 0;
  v_period_net      numeric := 0;
  v_agent_info      jsonb;
  v_me              public.app_users := public._rms_caller();
  v_all             boolean := (v_me.id IS NULL) OR public._rms_is_admin(v_me);
  v_pids            uuid[];
  v_proj            uuid;
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  -- Early gate via parent agent
  SELECT project_id INTO v_proj
  FROM public.agents
  WHERE id = p_agent_id AND company_id = p_company_id;
  IF v_proj IS NULL OR (NOT v_all AND NOT (v_proj = ANY(v_pids))) THEN
    RETURN jsonb_build_object(
      'success', true, 'agent_info', '{}'::jsonb,
      'opening_balance', 0, 'rows', '[]'::jsonb, 'closing_balance', 0);
  END IF;

  SELECT jsonb_build_object(
    'agent_name', ag.full_name,
    'agent_code', ag.agent_code,
    'projects', (
      SELECT STRING_AGG(DISTINCT pj.project_name, ', ' ORDER BY pj.project_name)
      FROM sales s2 JOIN projects pj ON pj.id = s2.project_id
      WHERE s2.agent_id = p_agent_id AND s2.company_id = p_company_id
        AND s2.status NOT IN ('cancelled')))
  INTO v_agent_info FROM agents ag
  WHERE ag.id = p_agent_id AND ag.company_id = p_company_id;

  IF p_from_date IS NOT NULL THEN
    SELECT COALESCE(SUM(ROUND(COALESCE(s.net_amount,0) * COALESCE(ag.commission_percent,0) / 100, 2)), 0)
    INTO v_ob_earned
    FROM sales s
    JOIN agents ag ON ag.id = p_agent_id AND ag.company_id = p_company_id
    WHERE s.agent_id = p_agent_id AND s.company_id = p_company_id
      AND s.status NOT IN ('cancelled')
      AND COALESCE(s.sale_date, s.created_at::date) < p_from_date;

    SELECT COALESCE(SUM(acp.amount), 0) INTO v_ob_paid
    FROM agent_commission_payments acp
    WHERE acp.agent_id = p_agent_id AND acp.company_id = p_company_id
      AND acp.payment_date < p_from_date;

    v_opening_balance := v_ob_earned - v_ob_paid;
  END IF;

  SELECT jsonb_agg(r ORDER BY (r->>'row_date') NULLS LAST, (r->>'sort_key') NULLS LAST)
  INTO v_rows FROM (
    SELECT jsonb_build_object(
      'voucher_no',  s.sale_number,
      'row_type',    'earned',
      'row_date',    COALESCE(TO_CHAR(s.sale_date,'YYYY-MM-DD'),
                              TO_CHAR(s.created_at AT TIME ZONE 'Asia/Karachi','YYYY-MM-DD')),
      'description', 'Commission Earned — ' ||
                     COALESCE(u.unit_no, u.unit_code, '—') ||
                     CASE WHEN p.project_name IS NOT NULL THEN ' · ' || p.project_name ELSE '' END ||
                     CASE WHEN s.sale_number  IS NOT NULL THEN ' · ' || s.sale_number  ELSE '' END,
      'earned',      ROUND(COALESCE(s.net_amount,0) * COALESCE(ag.commission_percent,0) / 100, 2),
      'paid',        NULL,
      'chq_no',      NULL,
      'sort_key',    '1'
    ) AS r
    FROM sales s
    JOIN agents ag ON ag.id = p_agent_id AND ag.company_id = p_company_id
    LEFT JOIN units    u ON u.id = s.unit_id
    LEFT JOIN projects p ON p.id = s.project_id
    WHERE s.agent_id = p_agent_id AND s.company_id = p_company_id
      AND s.status NOT IN ('cancelled')
      AND (p_from_date IS NULL OR COALESCE(s.sale_date, s.created_at::date) >= p_from_date)
      AND (p_to_date   IS NULL OR COALESCE(s.sale_date, s.created_at::date) <= p_to_date)
    UNION ALL
    SELECT jsonb_build_object(
      'voucher_no',  COALESCE(acp.reference_no, ''),
      'row_type',    'paid',
      'row_date',    TO_CHAR(acp.payment_date,'YYYY-MM-DD'),
      'description', 'Commission Paid' ||
                     CASE WHEN acp.reference_no   IS NOT NULL THEN ' — ' || acp.reference_no   ELSE '' END ||
                     CASE WHEN acp.payment_method IS NOT NULL THEN ' · ' || INITCAP(REPLACE(acp.payment_method,'_',' ')) ELSE '' END ||
                     CASE WHEN acp.notes          IS NOT NULL THEN ' · ' || acp.notes           ELSE '' END,
      'earned',      NULL,
      'paid',        acp.amount,
      'chq_no',      NULL,
      'sort_key',    '2'
    )
    FROM agent_commission_payments acp
    WHERE acp.agent_id = p_agent_id AND acp.company_id = p_company_id
      AND (p_from_date IS NULL OR acp.payment_date >= p_from_date)
      AND (p_to_date   IS NULL OR acp.payment_date <= p_to_date)
  ) sub;

  SELECT COALESCE(SUM(
    CASE
      WHEN r->>'row_type' = 'earned' THEN  (r->>'earned')::numeric
      WHEN r->>'row_type' = 'paid'   THEN -((r->>'paid')::numeric)
      ELSE 0
    END), 0)
  INTO v_period_net FROM jsonb_array_elements(COALESCE(v_rows, '[]'::jsonb)) r;

  RETURN jsonb_build_object(
    'success', true, 'agent_info', COALESCE(v_agent_info, '{}'::jsonb),
    'opening_balance', v_opening_balance, 'rows', COALESCE(v_rows, '[]'::jsonb),
    'closing_balance', v_opening_balance + v_period_net);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- ── 2. list_agent_transactions (direct on t.project_id) ────
CREATE OR REPLACE FUNCTION public.list_agent_transactions(p_company_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
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

-- ── 3. list_agent_commission_payments (direct on acp.project_id) ──
CREATE OR REPLACE FUNCTION public.list_agent_commission_payments(p_company_id uuid, p_agent_id uuid DEFAULT NULL::uuid)
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

-- ── 4. list_agent_commissions_with_agent (direct on acp.project_id) ──
CREATE OR REPLACE FUNCTION public.list_agent_commissions_with_agent(p_company_id uuid)
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

-- ── 5. list_sales_by_agent (direct on s.project_id) ────────
CREATE OR REPLACE FUNCTION public.list_sales_by_agent(p_agent_id uuid, p_company_id uuid)
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
  SELECT COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
  FROM public.sales s CROSS JOIN cfg
  WHERE s.agent_id = p_agent_id AND s.company_id = p_company_id
    AND (cfg.v_all OR s.project_id = ANY(cfg.v_pids));
$function$;
