-- 20260603_iso_null_caller_batch2b_ledgers.sql
-- HIGH fix (#3) batch 2B: client/agent readers + dashboards/ledgers/registers (17).
-- Early empty-return when v_me.id IS NULL; v_all drops the IS NULL term. Admin
-- branch already gated in all 17 (direct company-gate; early wrong_tenant guard for
-- get_dashboard_kpis/get_pdc_analytics; target-company WHERE for the no-company-param
-- get_client_360/get_client_promise_history, from which the v_me.id IS NULL OR term
-- is also dropped). Bodies otherwise verbatim.
--
-- EXCLUDED as already-secure (NOT modified):
--   verify_payment_link  - write RPC, granted authenticated/service_role/postgres only
--                          (NOT anon); already RAISE EXCEPTION 'forbidden' on null caller
--                          + role/company gated.
--   get_client_documents - already null-gated ('no_session') + v_all=admin-only + wrong_tenant.
-- Legit-anon RPCs (verify_login + buyer-portal) untouched.
--
-- Verified live (2-tenant replica): no-app_user JWT -> all 17 empty; ALPHA admin vs
-- BETA ids -> empty + wrong_tenant on kpis/pdc_analytics; ALPHA admin vs own -> data;
-- verify_payment_link + get_client_documents unchanged.
--
-- This batch closes the full ~30 v_all-reader set (batches 1 + 2A + 2B) => issue #3 shut.

CREATE OR REPLACE FUNCTION public.get_agent_360(p_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_agent jsonb; v_sales jsonb;
  v_me public.app_users := public._rms_caller();
  v_all boolean := (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids uuid[];
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
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
  v_all boolean := (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids uuid[]; v_proj uuid;
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'agent_info', '{}'::jsonb, 'opening_balance', 0, 'rows', '[]'::jsonb, 'closing_balance', 0);
  END IF;
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
  v_all boolean := (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids uuid[];
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
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
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('error', 'Client not found'); END IF;
  SELECT company_id INTO v_target_company FROM public.clients
  WHERE id = p_id
    AND (COALESCE(v_me.is_super_admin, false) OR company_id = v_me.company_id);
  IF v_target_company IS NULL THEN
    RETURN jsonb_build_object('error', 'Client not found');
  END IF;
  v_all := public._rms_is_admin(v_me);
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
  v_all boolean := public._rms_is_admin(v_me);
  v_pids uuid[]; v_proj uuid;
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('promises', '[]'::jsonb,
      'stats', jsonb_build_object('total',0,'kept',0,'broken',0,'pending',0,'kept_pct',0));
  END IF;
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments WHERE user_id = v_me.id AND is_active;
  END IF;
  SELECT project_id INTO v_proj FROM public.clients
  WHERE id = p_client_id
    AND (COALESCE(v_me.is_super_admin, false) OR company_id = v_me.company_id);
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

CREATE OR REPLACE FUNCTION public.get_clients_by_health_category(p_company_id uuid, p_category text DEFAULT 'ALL'::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB;
  v_me public.app_users := public._rms_caller();
  v_all boolean := (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids uuid[];
BEGIN
  IF v_me.id IS NULL THEN RETURN '[]'::jsonb; END IF;
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

CREATE OR REPLACE FUNCTION public.get_dashboard_kpis(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := CURRENT_DATE;
  v_month_start date := date_trunc('month', now())::date;
  v_prev_month_start date := (date_trunc('month', now()) - interval '1 month')::date;
  v_six_mo_ago date := (date_trunc('month', now()) - interval '5 months')::date;
  v_this_month numeric; v_prev_month numeric;
  v_today_total numeric; v_today_count integer;
  v_recent jsonb; v_trend jsonb; v_top_overdue jsonb;
  v_me public.app_users := public._rms_caller();
  v_all boolean;
  v_pids uuid[];
BEGIN
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_company_id');
  END IF;
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_session');
  END IF;
  IF v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;
  v_all := public._rms_is_admin(v_me);
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT COALESCE(SUM(amount),0) INTO v_this_month FROM payments p
    WHERE p.company_id = p_company_id AND p.payment_date >= v_month_start
      AND (v_all OR EXISTS (SELECT 1 FROM sales s WHERE s.id = p.sale_id AND s.project_id = ANY(v_pids)));

  SELECT COALESCE(SUM(amount),0) INTO v_prev_month FROM payments p
    WHERE p.company_id = p_company_id
      AND p.payment_date >= v_prev_month_start AND p.payment_date < v_month_start
      AND (v_all OR EXISTS (SELECT 1 FROM sales s WHERE s.id = p.sale_id AND s.project_id = ANY(v_pids)));

  SELECT COALESCE(SUM(amount),0), COUNT(*) INTO v_today_total, v_today_count
    FROM payments p
    WHERE p.company_id = p_company_id AND p.payment_date = v_today
      AND (v_all OR EXISTS (SELECT 1 FROM sales s WHERE s.id = p.sale_id AND s.project_id = ANY(v_pids)));

  SELECT COALESCE(jsonb_agg(row_to_json(r)), '[]'::jsonb) INTO v_recent
  FROM (
    SELECT p.id, p.sale_id, p.payment_date, p.amount, p.payment_method, s.unit_id AS "unitId"
    FROM payments p LEFT JOIN sales s ON s.id = p.sale_id
    WHERE p.company_id = p_company_id AND p.payment_date >= v_month_start
      AND (v_all OR (s.id IS NOT NULL AND s.project_id = ANY(v_pids)))
    ORDER BY p.payment_date DESC, p.created_at DESC LIMIT 6
  ) r;

  WITH month_buckets AS (
    SELECT generate_series(v_six_mo_ago, v_month_start, interval '1 month')::date AS m_start
  ), totals AS (
    SELECT date_trunc('month', p.payment_date)::date AS m, SUM(p.amount) AS total
    FROM payments p
    WHERE p.company_id = p_company_id AND p.payment_date >= v_six_mo_ago
      AND (v_all OR EXISTS (SELECT 1 FROM sales s WHERE s.id = p.sale_id AND s.project_id = ANY(v_pids)))
    GROUP BY 1
  )
  SELECT jsonb_agg(jsonb_build_object(
    'month', to_char(mb.m_start, 'Mon'), 'month_start', mb.m_start,
    'total', COALESCE(t.total, 0)) ORDER BY mb.m_start)
  INTO v_trend FROM month_buckets mb LEFT JOIN totals t ON t.m = mb.m_start;

  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.outstanding DESC), '[]'::jsonb)
  INTO v_top_overdue
  FROM (
    SELECT s.id AS sale_id, s.unit_id, c.full_name AS client_name, u.unit_no,
      SUM(p.amount) FILTER (WHERE p.id IS NOT NULL) AS paid,
      s.net_amount,
      (s.net_amount - COALESCE(SUM(p.amount) FILTER (WHERE p.id IS NOT NULL), 0)) AS outstanding,
      MAX(p.payment_date) AS last_payment_date,
      (v_today - MAX(p.payment_date))::int AS days_since_payment
    FROM sales s JOIN units u ON u.id = s.unit_id
    LEFT JOIN clients c ON c.id = s.client_id
    LEFT JOIN payments p ON p.sale_id = s.id AND p.company_id = p_company_id
    WHERE s.company_id = p_company_id AND s.status = 'active'
      AND (v_all OR s.project_id = ANY(v_pids))
    GROUP BY s.id, s.unit_id, c.full_name, u.unit_no, s.net_amount
    HAVING (s.net_amount - COALESCE(SUM(p.amount) FILTER (WHERE p.id IS NOT NULL), 0)) > 0
      AND (MAX(p.payment_date) IS NULL OR (v_today - MAX(p.payment_date))::int > 60)
    ORDER BY outstanding DESC LIMIT 3
  ) r;

  RETURN jsonb_build_object(
    'success', true,
    'this_month_collection', v_this_month, 'prev_month_collection', v_prev_month,
    'today_collection', v_today_total, 'today_count', v_today_count,
    'recent_payments', v_recent, 'trend_6m', v_trend, 'top_overdue', v_top_overdue
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_health_dashboard_stats(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_result JSONB;
  v_me public.app_users := public._rms_caller();
  v_all boolean := (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids uuid[];
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object(
      'platinum', jsonb_build_object('count', 0, 'exposure', 0),
      'good', jsonb_build_object('count', 0, 'exposure', 0),
      'at_risk', jsonb_build_object('count', 0, 'exposure', 0),
      'critical', jsonb_build_object('count', 0, 'exposure', 0),
      'total_clients', 0, 'total_at_risk_exposure', 0);
  END IF;
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT jsonb_build_object(
    'platinum', jsonb_build_object('count', COUNT(*) FILTER (WHERE category = 'PLATINUM'), 'exposure', COALESCE(SUM(total_exposure) FILTER (WHERE category = 'PLATINUM'), 0)),
    'good', jsonb_build_object('count', COUNT(*) FILTER (WHERE category = 'GOOD'), 'exposure', COALESCE(SUM(total_exposure) FILTER (WHERE category = 'GOOD'), 0)),
    'at_risk', jsonb_build_object('count', COUNT(*) FILTER (WHERE category = 'AT RISK'), 'exposure', COALESCE(SUM(total_exposure) FILTER (WHERE category = 'AT RISK'), 0)),
    'critical', jsonb_build_object('count', COUNT(*) FILTER (WHERE category = 'CRITICAL'), 'exposure', COALESCE(SUM(total_exposure) FILTER (WHERE category = 'CRITICAL'), 0)),
    'total_clients', COUNT(*),
    'total_at_risk_exposure', COALESCE(SUM(total_exposure) FILTER (WHERE category IN ('AT RISK', 'CRITICAL')), 0)
  ) INTO v_result
  FROM client_health_scores chs
  WHERE chs.company_id = p_company_id
    AND (v_all OR EXISTS (SELECT 1 FROM clients c WHERE c.id = chs.client_id AND c.project_id = ANY(v_pids)));

  RETURN COALESCE(v_result, jsonb_build_object(
    'platinum', jsonb_build_object('count', 0, 'exposure', 0),
    'good', jsonb_build_object('count', 0, 'exposure', 0),
    'at_risk', jsonb_build_object('count', 0, 'exposure', 0),
    'critical', jsonb_build_object('count', 0, 'exposure', 0),
    'total_clients', 0, 'total_at_risk_exposure', 0
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_officer_ledger(p_company_id uuid, p_officer_id uuid DEFAULT NULL::uuid, p_project_id uuid DEFAULT NULL::uuid, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_method text DEFAULT 'All'::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_rows jsonb; v_officers jsonb;
  v_opening_balance numeric := 0; v_period_total numeric := 0;
  v_me public.app_users := public._rms_caller();
  v_all boolean := (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids uuid[];
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'officers', '[]'::jsonb, 'opening_balance', 0, 'rows', '[]'::jsonb, 'closing_balance', 0);
  END IF;
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;
  SELECT jsonb_agg(jsonb_build_object('id', au.id, 'name', au.full_name, 'role', au.role) ORDER BY au.full_name) INTO v_officers
  FROM app_users au WHERE au.company_id = p_company_id AND au.status = 'active';
  IF p_date_from IS NOT NULL THEN
    SELECT COALESCE(SUM(p.amount), 0) INTO v_opening_balance
    FROM payments p LEFT JOIN sales s ON s.id = p.sale_id AND s.company_id = p_company_id
    WHERE p.company_id = p_company_id AND p.status <> 'cancelled' AND p.payment_date < p_date_from
      AND (v_all OR (s.id IS NOT NULL AND s.project_id = ANY(v_pids)))
      AND (p_officer_id IS NULL OR p.created_by = p_officer_id::text)
      AND (p_project_id IS NULL OR s.project_id = p_project_id)
      AND (p_project_id IS NULL OR v_all OR p_project_id = ANY(v_pids))
      AND (p_method = 'All' OR LOWER(p.payment_method) = LOWER(p_method));
  END IF;
  SELECT jsonb_agg(r ORDER BY (r->>'payment_date') DESC NULLS LAST) INTO v_rows FROM (
    SELECT jsonb_build_object(
      'id', p.id, 'voucher_code', COALESCE(p.voucher_code, p.payment_code),
      'payment_date', TO_CHAR(p.payment_date, 'YYYY-MM-DD'),
      'amount', p.amount, 'method', p.payment_method, 'status', p.status,
      'officer_id', p.created_by, 'officer_name', au.full_name,
      'client_name', c.full_name, 'sale_number', s.sale_number, 'unit_no', u.unit_no,
      'project_name', pj.project_name, 'reference_no', p.reference_no, 'notes', p.notes
    ) AS r
    FROM payments p
    LEFT JOIN app_users au ON au.id::text = p.created_by
    LEFT JOIN sales s ON s.id = p.sale_id AND s.company_id = p_company_id
    LEFT JOIN clients c ON c.id = p.client_id AND c.company_id = p_company_id
    LEFT JOIN units u ON u.id = s.unit_id
    LEFT JOIN projects pj ON pj.id = s.project_id
    WHERE p.company_id = p_company_id AND p.status <> 'cancelled'
      AND (v_all OR (s.id IS NOT NULL AND s.project_id = ANY(v_pids)))
      AND (p_officer_id IS NULL OR p.created_by = p_officer_id::text)
      AND (p_project_id IS NULL OR s.project_id = p_project_id)
      AND (p_project_id IS NULL OR v_all OR p_project_id = ANY(v_pids))
      AND (p_date_from IS NULL OR p.payment_date >= p_date_from)
      AND (p_date_to IS NULL OR p.payment_date <= p_date_to)
      AND (p_method = 'All' OR LOWER(p.payment_method) = LOWER(p_method))
  ) sub;
  SELECT COALESCE(SUM((r->>'amount')::numeric), 0) INTO v_period_total
  FROM jsonb_array_elements(COALESCE(v_rows, '[]'::jsonb)) r;
  RETURN jsonb_build_object('success', true, 'officers', COALESCE(v_officers, '[]'::jsonb), 'opening_balance', v_opening_balance, 'rows', COALESCE(v_rows, '[]'::jsonb), 'closing_balance', v_opening_balance + v_period_total);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_receiving_ledger(p_company_id uuid, p_project_id uuid DEFAULT NULL::uuid, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_method text DEFAULT 'All'::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_rows jsonb; v_opening_balance numeric := 0; v_period_total numeric := 0;
  v_me public.app_users := public._rms_caller();
  v_all boolean := (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids uuid[];
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'opening_balance', 0, 'rows', '[]'::jsonb, 'closing_balance', 0);
  END IF;
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;
  IF p_date_from IS NOT NULL THEN
    SELECT COALESCE(SUM(p.amount), 0) INTO v_opening_balance
    FROM payments p LEFT JOIN sales s ON s.id = p.sale_id AND s.company_id = p_company_id
    WHERE p.company_id = p_company_id AND p.status <> 'cancelled' AND p.payment_date < p_date_from
      AND (v_all OR (s.id IS NOT NULL AND s.project_id = ANY(v_pids)))
      AND (p_project_id IS NULL OR s.project_id = p_project_id)
      AND (p_project_id IS NULL OR v_all OR p_project_id = ANY(v_pids))
      AND (p_method = 'All' OR LOWER(p.payment_method) = LOWER(p_method));
  END IF;
  SELECT jsonb_agg(r ORDER BY (r->>'payment_date') DESC NULLS LAST) INTO v_rows FROM (
    SELECT jsonb_build_object(
      'id', p.id, 'voucher_code', COALESCE(p.voucher_code, p.payment_code),
      'payment_date', TO_CHAR(p.payment_date, 'YYYY-MM-DD'),
      'amount', p.amount, 'method', p.payment_method, 'status', p.status,
      'client_name', c.full_name, 'sale_number', s.sale_number, 'unit_no', u.unit_no,
      'project_name', pj.project_name, 'received_by', au.full_name,
      'reference_no', p.reference_no, 'notes', p.notes
    ) AS r
    FROM payments p
    LEFT JOIN app_users au ON au.id::text = p.created_by
    LEFT JOIN sales s ON s.id = p.sale_id AND s.company_id = p_company_id
    LEFT JOIN clients c ON c.id = p.client_id AND c.company_id = p_company_id
    LEFT JOIN units u ON u.id = s.unit_id
    LEFT JOIN projects pj ON pj.id = s.project_id
    WHERE p.company_id = p_company_id AND p.status <> 'cancelled'
      AND (v_all OR (s.id IS NOT NULL AND s.project_id = ANY(v_pids)))
      AND (p_project_id IS NULL OR s.project_id = p_project_id)
      AND (p_project_id IS NULL OR v_all OR p_project_id = ANY(v_pids))
      AND (p_date_from IS NULL OR p.payment_date >= p_date_from)
      AND (p_date_to IS NULL OR p.payment_date <= p_date_to)
      AND (p_method = 'All' OR LOWER(p.payment_method) = LOWER(p_method))
  ) sub;
  SELECT COALESCE(SUM((r->>'amount')::numeric), 0) INTO v_period_total
  FROM jsonb_array_elements(COALESCE(v_rows, '[]'::jsonb)) r;
  RETURN jsonb_build_object('success', true, 'opening_balance', v_opening_balance, 'rows', COALESCE(v_rows, '[]'::jsonb), 'closing_balance', v_opening_balance + v_period_total);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_pdc_register(p_company_id uuid, p_status text DEFAULT 'All'::text, p_project_id uuid DEFAULT NULL::uuid, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_rows jsonb;
  v_me   public.app_users := public._rms_caller();
  v_all  boolean := (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids uuid[];
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'rows', '[]'::jsonb);
  END IF;
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT jsonb_agg(r ORDER BY (r->>'cheque_date') DESC NULLS LAST, r->>'id')
  INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', pc.id, 'cheque_no', pc.cheque_no, 'bank_name', pc.bank_name, 'amount', pc.amount,
      'cheque_date', TO_CHAR(pc.cheque_date, 'YYYY-MM-DD'),
      'received_date', TO_CHAR(pc.received_date, 'YYYY-MM-DD'),
      'clearance_date', TO_CHAR(pc.clearance_date, 'YYYY-MM-DD'),
      'deposit_date', TO_CHAR(pc.deposit_date, 'YYYY-MM-DD'),
      'bounce_date', TO_CHAR(pc.bounce_date, 'YYYY-MM-DD'),
      'status', pc.status, 'notes', pc.notes, 'bounce_reason', pc.bounce_reason,
      'payment_id', pc.payment_id, 'sale_id', pc.sale_id, 'client_id', pc.client_id,
      'client_name', c.full_name, 'sale_number', s.sale_number,
      'unit_no', u.unit_no, 'unit_code', u.unit_code,
      'project_id', s.project_id, 'project_name', pr.project_name
    ) AS r
    FROM pdc_cheques pc
    LEFT JOIN clients  c  ON c.id  = pc.client_id  AND c.company_id  = p_company_id
    LEFT JOIN sales    s  ON s.id  = pc.sale_id    AND s.company_id  = p_company_id
    LEFT JOIN units    u  ON u.id  = s.unit_id
    LEFT JOIN projects pr ON pr.id = s.project_id
    WHERE pc.company_id = p_company_id
      AND (v_all OR (s.id IS NOT NULL AND s.project_id = ANY(v_pids)))
      AND (p_status = 'All' OR LOWER(pc.status) = LOWER(p_status))
      AND (p_project_id IS NULL OR s.project_id = p_project_id)
      AND (p_project_id IS NULL OR v_all OR p_project_id = ANY(v_pids))
      AND (p_date_from  IS NULL OR pc.cheque_date >= p_date_from)
      AND (p_date_to    IS NULL OR pc.cheque_date <= p_date_to)
  ) sub;

  RETURN jsonb_build_object('success', true, 'rows', COALESCE(v_rows, '[]'::jsonb));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_pdc_analytics(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_status jsonb; v_aging jsonb; v_by_bank jsonb; v_by_proj jsonb; v_methods jsonb;
  v_me public.app_users := public._rms_caller();
  v_all boolean;
  v_pids uuid[];
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_session');
  END IF;
  IF v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;
  v_all := public._rms_is_admin(v_me);
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(s) ORDER BY s.status), '[]'::jsonb) INTO v_status
  FROM (
    SELECT status, COUNT(*)::int AS count, COALESCE(SUM(amount),0)::numeric AS amount
    FROM pdc_cheques pc
    WHERE pc.company_id = p_company_id
      AND (v_all OR EXISTS (SELECT 1 FROM sales s WHERE s.id = pc.sale_id AND s.project_id = ANY(v_pids)))
    GROUP BY status
  ) s;

  SELECT jsonb_build_object(
    'due_this_week', jsonb_build_object('count', COALESCE(COUNT(*) FILTER (WHERE eff BETWEEN CURRENT_DATE AND CURRENT_DATE+7),0), 'amount', COALESCE(SUM(amount) FILTER (WHERE eff BETWEEN CURRENT_DATE AND CURRENT_DATE+7),0)),
    'due_this_month', jsonb_build_object('count', COALESCE(COUNT(*) FILTER (WHERE eff BETWEEN CURRENT_DATE AND CURRENT_DATE+30),0), 'amount', COALESCE(SUM(amount) FILTER (WHERE eff BETWEEN CURRENT_DATE AND CURRENT_DATE+30),0)),
    'overdue', jsonb_build_object('count', COALESCE(COUNT(*) FILTER (WHERE eff < CURRENT_DATE),0), 'amount', COALESCE(SUM(amount) FILTER (WHERE eff < CURRENT_DATE),0))
  ) INTO v_aging
  FROM (
    SELECT pc.amount, COALESCE(pc.deposit_date, pc.cheque_date) AS eff
    FROM pdc_cheques pc
    WHERE pc.company_id = p_company_id AND pc.status IN ('pending','presented')
      AND (v_all OR EXISTS (SELECT 1 FROM sales s WHERE s.id = pc.sale_id AND s.project_id = ANY(v_pids)))
  ) a;

  SELECT COALESCE(jsonb_agg(row_to_json(b) ORDER BY b.amount DESC), '[]'::jsonb) INTO v_by_bank
  FROM (
    SELECT COALESCE(NULLIF(bank_name,''),'(unknown)') AS bank_name,
           COUNT(*)::int AS count, COALESCE(SUM(amount),0)::numeric AS amount,
           COUNT(*) FILTER (WHERE status='bounced')::int AS bounced
    FROM pdc_cheques pc
    WHERE pc.company_id = p_company_id
      AND (v_all OR EXISTS (SELECT 1 FROM sales s WHERE s.id = pc.sale_id AND s.project_id = ANY(v_pids)))
    GROUP BY 1
  ) b;

  SELECT COALESCE(jsonb_agg(row_to_json(p) ORDER BY p.amount DESC), '[]'::jsonb) INTO v_by_proj
  FROM (
    SELECT pr.id AS project_id, COALESCE(pr.project_name,'(unassigned)') AS project_name,
           COUNT(*)::int AS count, COALESCE(SUM(pc.amount),0)::numeric AS amount
    FROM pdc_cheques pc
    LEFT JOIN sales s ON s.id = pc.sale_id
    LEFT JOIN projects pr ON pr.id = s.project_id
    WHERE pc.company_id = p_company_id
      AND (v_all OR (s.id IS NOT NULL AND s.project_id = ANY(v_pids)))
    GROUP BY pr.id, pr.project_name
  ) p;

  SELECT COALESCE(jsonb_agg(row_to_json(m) ORDER BY m.amount DESC), '[]'::jsonb) INTO v_methods
  FROM (
    SELECT COALESCE(NULLIF(payment_method,''),'(unspecified)') AS method,
           COUNT(*)::int AS count, COALESCE(SUM(amount),0)::numeric AS amount
    FROM payments pmt
    WHERE pmt.company_id = p_company_id
      AND (v_all OR EXISTS (SELECT 1 FROM sales s WHERE s.id = pmt.sale_id AND s.project_id = ANY(v_pids)))
    GROUP BY 1
  ) m;

  RETURN jsonb_build_object('success', true, 'status_summary', v_status, 'aging', v_aging, 'by_bank', v_by_bank, 'by_project', v_by_proj, 'method_split', v_methods);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_payment_link_stats(p_company_id uuid, p_days integer DEFAULT 30)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_result JSONB;
  v_me public.app_users := public._rms_caller();
  v_all boolean := (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids uuid[];
BEGIN
  IF v_me.id IS NULL THEN RETURN '{}'::jsonb; END IF;
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT jsonb_build_object(
    'total_sent', COUNT(*) FILTER (WHERE sent_at >= NOW() - (p_days || ' days')::INTERVAL),
    'pending_verification', COUNT(*) FILTER (WHERE status = 'screenshot_received'),
    'verified', COUNT(*) FILTER (WHERE status = 'verified'),
    'success_rate',
      CASE WHEN COUNT(*) FILTER (WHERE status IN ('verified','rejected')) > 0
        THEN ROUND(COUNT(*) FILTER (WHERE status = 'verified')::NUMERIC / COUNT(*) FILTER (WHERE status IN ('verified','rejected')) * 100)::INTEGER
        ELSE 0 END,
    'total_collected', COALESCE(SUM(requested_amount) FILTER (WHERE status = 'verified'), 0)
  )
  INTO v_result
  FROM payment_links pl
  WHERE pl.company_id = p_company_id
    AND (v_all OR EXISTS (SELECT 1 FROM sales s WHERE s.id = pl.sale_id AND s.project_id = ANY(v_pids)));

  RETURN COALESCE(v_result, '{}'::JSONB);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_project_ledger(p_project_id uuid, p_company_id uuid, p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_rows jsonb; v_opening_balance numeric := 0;
  v_ob_debit numeric := 0; v_ob_credit numeric := 0;
  v_period_net numeric := 0; v_project_info jsonb;
  v_me public.app_users := public._rms_caller();
  v_all boolean := (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids uuid[];
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'project_info', '{}'::jsonb, 'opening_balance', 0, 'rows', '[]'::jsonb, 'closing_balance', 0);
  END IF;
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
    IF NOT (p_project_id = ANY(v_pids)) THEN
      RETURN jsonb_build_object('success', true, 'project_info', '{}'::jsonb, 'opening_balance', 0, 'rows', '[]'::jsonb, 'closing_balance', 0);
    END IF;
  END IF;
  SELECT jsonb_build_object('project_name', p.project_name,
    'total_units', (SELECT COUNT(*) FROM units WHERE project_id = p.id AND company_id = p_company_id),
    'total_sold', (SELECT COUNT(*) FROM sales WHERE project_id = p.id AND company_id = p_company_id AND status NOT IN ('cancelled')))
  INTO v_project_info FROM projects p WHERE p.id = p_project_id AND p.company_id = p_company_id;
  IF p_from_date IS NOT NULL THEN
    SELECT COALESCE(SUM(i.amount_due), 0) INTO v_ob_debit FROM installments i JOIN sales s ON s.id = i.sale_id
    WHERE s.company_id = p_company_id AND s.project_id = p_project_id AND s.status NOT IN ('cancelled') AND i.due_date < p_from_date;
    SELECT COALESCE(SUM(p.amount), 0) INTO v_ob_credit FROM payments p JOIN sales s ON s.id = p.sale_id
    WHERE p.company_id = p_company_id AND s.project_id = p_project_id AND s.status NOT IN ('cancelled') AND p.status != 'cancelled' AND p.payment_date < p_from_date;
    v_opening_balance := v_ob_debit - v_ob_credit;
  END IF;
  SELECT jsonb_agg(to_jsonb(r)) INTO v_rows FROM (
    SELECT CASE i.installment_type WHEN 'down_payment' THEN 'DP-0' ELSE 'INS-' || LPAD(i.installment_number::text, 2, '0') END AS voucher_no,
      'DR' AS row_type, 1 AS row_order, i.due_date AS entry_date, i.created_at AS created_at,
      CASE i.installment_type WHEN 'down_payment' THEN 'Installment Due — Down Payment [' || s.sale_number || '] ' || COALESCE(u.unit_no, '')
        ELSE 'Installment Due — ' || i.installment_number::text ||
          CASE WHEN i.installment_number % 100 BETWEEN 11 AND 13 THEN 'th' WHEN i.installment_number % 10 = 1 THEN 'st' WHEN i.installment_number % 10 = 2 THEN 'nd' WHEN i.installment_number % 10 = 3 THEN 'rd' ELSE 'th' END
          || ' Installment [' || s.sale_number || '] ' || COALESCE(u.unit_no, '')
      END AS description, i.amount_due AS debit, NULL::numeric AS credit, NULL::text AS chq_no,
      s.sale_number AS sale_number, u.unit_no AS unit_no, c.full_name AS client_name
    FROM installments i JOIN sales s ON s.id = i.sale_id JOIN units u ON u.id = s.unit_id JOIN clients c ON c.id = s.client_id
    WHERE s.company_id = p_company_id AND s.project_id = p_project_id AND s.status NOT IN ('cancelled')
      AND (p_from_date IS NULL OR i.due_date >= p_from_date) AND (p_to_date IS NULL OR i.due_date <= p_to_date)
    UNION ALL
    SELECT COALESCE(p.voucher_code, p.payment_code) AS voucher_no, 'CR' AS row_type, 2 AS row_order,
      p.payment_date AS entry_date, p.created_at AS created_at,
      'Payment Received — ' || INITCAP(REPLACE(p.payment_method, '_', ' ')) ||
        CASE WHEN p.voucher_code IS NOT NULL THEN ' [' || p.voucher_code || ']' WHEN p.payment_code IS NOT NULL THEN ' [' || p.payment_code || ']' ELSE '' END ||
        ' · ' || COALESCE(c.full_name, '') || ' · ' || COALESCE(u.unit_no, '') AS description,
      NULL::numeric AS debit, p.amount AS credit,
      CASE WHEN LOWER(p.payment_method) IN ('pdc','cheque') THEN p.reference_no ELSE NULL END AS chq_no,
      s.sale_number AS sale_number, u.unit_no AS unit_no, c.full_name AS client_name
    FROM payments p JOIN sales s ON s.id = p.sale_id JOIN units u ON u.id = s.unit_id LEFT JOIN clients c ON c.id = s.client_id
    WHERE p.company_id = p_company_id AND s.project_id = p_project_id AND s.status NOT IN ('cancelled') AND p.status != 'cancelled'
      AND (p_from_date IS NULL OR p.payment_date >= p_from_date) AND (p_to_date IS NULL OR p.payment_date <= p_to_date)
    ORDER BY entry_date NULLS LAST, created_at, row_order
  ) r;
  SELECT COALESCE(SUM(COALESCE((r->>'debit')::numeric, 0) - COALESCE((r->>'credit')::numeric, 0)), 0) INTO v_period_net
  FROM jsonb_array_elements(COALESCE(v_rows, '[]'::jsonb)) r;
  RETURN jsonb_build_object('success', true, 'project_info', COALESCE(v_project_info, '{}'::jsonb), 'opening_balance', v_opening_balance, 'rows', COALESCE(v_rows, '[]'::jsonb), 'closing_balance', v_opening_balance + v_period_net);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_project_collection_ledger(p_project_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_sales jsonb; v_monthly jsonb;
  v_me public.app_users := public._rms_caller();
  v_all boolean := (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids uuid[];
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'sales', '[]'::jsonb, 'monthly', '[]'::jsonb);
  END IF;
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
    IF NOT (p_project_id = ANY(v_pids)) THEN
      RETURN jsonb_build_object('success', true, 'sales', '[]'::jsonb, 'monthly', '[]'::jsonb);
    END IF;
  END IF;
  SELECT jsonb_agg(jsonb_build_object(
    'sale_id', sub.sale_id, 'sale_number', sub.sale_number, 'sale_date', sub.sale_date,
    'unit_no', sub.unit_no, 'unit_code', sub.unit_code, 'client_name', sub.client_name,
    'sale_price', sub.sale_price, 'collected', sub.collected, 'outstanding', sub.outstanding
  ) ORDER BY sub.sale_date NULLS LAST, sub.sale_number) INTO v_sales
  FROM (
    SELECT s.id AS sale_id, s.sale_number, TO_CHAR(s.sale_date, 'YYYY-MM-DD') AS sale_date,
      u.unit_no, u.unit_code, c.full_name AS client_name,
      COALESCE(s.net_amount, 0) AS sale_price, COALESCE(pt.total_collected, 0) AS collected,
      GREATEST(0, COALESCE(s.net_amount, 0) - COALESCE(pt.total_collected, 0)) AS outstanding
    FROM sales s LEFT JOIN units u ON u.id = s.unit_id
    LEFT JOIN clients c ON c.id = s.client_id AND c.company_id = p_company_id
    LEFT JOIN (SELECT p.sale_id, SUM(p.amount) AS total_collected FROM payments p
               WHERE p.company_id = p_company_id AND p.status <> 'cancelled' GROUP BY p.sale_id) pt ON pt.sale_id = s.id
    WHERE s.project_id = p_project_id AND s.company_id = p_company_id AND s.status NOT IN ('cancelled')
  ) sub;
  SELECT jsonb_agg(jsonb_build_object('month', m.month, 'month_lbl', m.month_lbl, 'collected', m.collected) ORDER BY m.month) INTO v_monthly
  FROM (
    SELECT TO_CHAR(DATE_TRUNC('month', p.payment_date), 'YYYY-MM') AS month,
           TO_CHAR(DATE_TRUNC('month', p.payment_date), 'Mon YYYY') AS month_lbl,
           SUM(p.amount) AS collected
    FROM payments p JOIN sales s ON s.id = p.sale_id AND s.company_id = p_company_id
    WHERE s.project_id = p_project_id AND p.company_id = p_company_id AND p.status <> 'cancelled' AND p.payment_date IS NOT NULL
    GROUP BY DATE_TRUNC('month', p.payment_date)
  ) m;
  RETURN jsonb_build_object('success', true, 'sales', COALESCE(v_sales, '[]'::jsonb), 'monthly', COALESCE(v_monthly, '[]'::jsonb));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_cancelled_units_ledger(p_company_id uuid, p_project_id uuid DEFAULT NULL::uuid, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_refund_status text DEFAULT 'All'::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_rows jsonb;
  v_me public.app_users := public._rms_caller();
  v_all boolean := (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids uuid[];
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'rows', '[]'::jsonb);
  END IF;
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;
  SELECT jsonb_agg(r ORDER BY (r->>'cancellation_date') DESC NULLS LAST) INTO v_rows FROM (
    SELECT jsonb_build_object(
      'id', uc.id, 'unit_id', uc.unit_id, 'sale_id', uc.sale_id, 'client_id', uc.client_id,
      'cancellation_voucher_no', uc.cancellation_voucher_no,
      'cancellation_date', TO_CHAR(uc.cancellation_date, 'YYYY-MM-DD'),
      'cancellation_type', uc.cancellation_type, 'reason_category', uc.reason_category,
      'detailed_reason', uc.detailed_reason, 'client_name', c.full_name,
      'unit_no', u.unit_no, 'unit_code', u.unit_code, 'project_name', p.project_name,
      'total_paid', COALESCE(uc.total_paid, 0),
      'booking_forfeiture', COALESCE(uc.booking_forfeiture, 0),
      'cancellation_charges', COALESCE(uc.cancellation_charges, 0),
      'total_deductions', COALESCE(uc.total_deductions, 0),
      'net_refund_amount', COALESCE(uc.net_refund_amount, 0),
      'refund_status', uc.refund_status, 'refund_date', TO_CHAR(uc.refund_date, 'YYYY-MM-DD'),
      'refund_method', uc.refund_method, 'refund_reference', uc.refund_reference,
      'status', uc.status, 'initiated_by', uc.initiated_by, 'notes', uc.notes
    ) AS r
    FROM unit_cancellations uc
    LEFT JOIN clients c ON c.id = uc.client_id AND c.company_id = p_company_id
    LEFT JOIN units u ON u.id = uc.unit_id
    LEFT JOIN projects p ON p.id = uc.project_id
    WHERE uc.company_id = p_company_id
      AND (v_all OR EXISTS (SELECT 1 FROM public.units pu WHERE pu.id = uc.unit_id AND pu.project_id = ANY(v_pids)))
      AND (p_project_id IS NULL OR uc.project_id = p_project_id)
      AND (p_project_id IS NULL OR v_all OR p_project_id = ANY(v_pids))
      AND (p_date_from IS NULL OR uc.cancellation_date >= p_date_from)
      AND (p_date_to IS NULL OR uc.cancellation_date <= p_date_to)
      AND (p_refund_status = 'All' OR LOWER(uc.refund_status) = LOWER(p_refund_status))
  ) sub;
  RETURN jsonb_build_object('success', true, 'rows', COALESCE(v_rows, '[]'::jsonb));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_transferred_units_ledger(p_company_id uuid, p_project_id uuid DEFAULT NULL::uuid, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_settlement_status text DEFAULT 'All'::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_rows jsonb;
  v_me public.app_users := public._rms_caller();
  v_all boolean := (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids uuid[];
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'rows', '[]'::jsonb);
  END IF;
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;
  SELECT jsonb_agg(r ORDER BY (r->>'transfer_date') DESC NULLS LAST) INTO v_rows FROM (
    SELECT jsonb_build_object(
      'id', ut.id, 'unit_id', ut.unit_id, 'transfer_voucher_no', ut.transfer_voucher_no,
      'transfer_date', TO_CHAR(ut.transfer_date, 'YYYY-MM-DD'),
      'unit_no', u.unit_no, 'unit_code', u.unit_code, 'project_name', p.project_name,
      'old_client_name', cold.full_name, 'new_client_name', cnew.full_name,
      'old_client_id', ut.old_client_id, 'new_client_id', ut.new_client_id,
      'old_sale_id', ut.old_sale_id, 'new_sale_id', ut.new_sale_id,
      'new_sale_number', ns.sale_number,
      'old_sale_price', COALESCE(ut.old_sale_price, 0),
      'new_sale_price', COALESCE(ut.new_sale_price, 0),
      'price_difference', COALESCE(ut.price_difference, 0),
      'transfer_fee', COALESCE(ut.transfer_fee, 0),
      'documentation_charges', COALESCE(ut.documentation_charges, 0),
      'other_charges', COALESCE(ut.other_charges, 0),
      'total_transfer_charges', COALESCE(ut.total_transfer_charges, 0),
      'charges_paid_by', ut.charges_paid_by, 'charges_payment_method', ut.charges_payment_method,
      'settlement_type', ut.settlement_type, 'settlement_status', ut.settlement_status,
      'settlement_amount', COALESCE(ut.settlement_amount, 0),
      'settlement_reference', ut.settlement_reference,
      'old_total_paid', COALESCE(ut.old_total_paid, 0),
      'old_outstanding', COALESCE(ut.old_outstanding, 0),
      'notes', ut.notes
    ) AS r
    FROM unit_transfers ut
    LEFT JOIN units u ON u.id = ut.unit_id
    LEFT JOIN projects p ON p.id = ut.project_id
    LEFT JOIN clients cold ON cold.id = ut.old_client_id AND cold.company_id = p_company_id
    LEFT JOIN clients cnew ON cnew.id = ut.new_client_id AND cnew.company_id = p_company_id
    LEFT JOIN sales ns ON ns.id = ut.new_sale_id
    WHERE ut.company_id = p_company_id
      AND (v_all OR EXISTS (SELECT 1 FROM public.units pu WHERE pu.id = ut.unit_id AND pu.project_id = ANY(v_pids)))
      AND (p_project_id IS NULL OR ut.project_id = p_project_id)
      AND (p_project_id IS NULL OR v_all OR p_project_id = ANY(v_pids))
      AND (p_date_from IS NULL OR ut.transfer_date >= p_date_from)
      AND (p_date_to IS NULL OR ut.transfer_date <= p_date_to)
      AND (p_settlement_status = 'All' OR LOWER(ut.settlement_status) = LOWER(p_settlement_status))
  ) sub;
  RETURN jsonb_build_object('success', true, 'rows', COALESCE(v_rows, '[]'::jsonb));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;
