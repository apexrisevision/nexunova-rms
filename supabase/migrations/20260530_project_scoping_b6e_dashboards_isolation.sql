-- ════════════════════════════════════════════════════════════
-- PROJECT-SCOPING — BATCH 6 GROUP 6E: server-side isolation on non-admin dashboard RPCs
-- 2026-05-30.
-- ════════════════════════════════════════════════════════════
-- 6 dashboard/aggregate RPCs retrofitted — ONLY the ones hit from
-- non-admin call sites (per 6E triage approved 2026-05-30):
--
--   1. get_dashboard_kpis           ← dashboard.js + recovery-dashboard.js
--   2. get_health_dashboard_stats   ← dashboard.js (health widget)
--   3. get_commissions_overview     ← agents.js (accounts staff allow-list)
--   4. get_pdc_analytics            ← pdc.js (recovery + accounts allow-lists)
--   5. get_payment_link_stats       ← dashboard.js + payment-links.js
--   6. get_unit_payment_summary     ← search/addpayment/cancellation/transfers/print
--
-- LEAVING PERMISSIVE (admin-only / feature-flagged / dead-code surfaces):
--   get_executive_dashboard, get_executive_kpis (REPORT-VIEWER, now in
--   protected-10 set), get_promise_analytics, get_promise_stats,
--   get_escalation_analytics, get_field_visit_analytics, get_legal_analytics,
--   get_noc_analytics, get_radar_accuracy_stats, get_audit_stats,
--   get_possession_analytics (dead), get_schedule_analytics (dead).
--
-- Gate posture (consistent with 6C/6D): each aggregate row gated via its
-- parent's project_id (parent sale for payments/PDC/links; parent client
-- for client_health_scores; parent agent for commission_payments; parent
-- unit for get_unit_payment_summary). NULL-parent rows invisible to
-- non-admins. Anon stays PERMISSIVE (v_all=true).
--
-- Envelope-on-block shape: every RPC keeps returning success:true with
-- zeroed/empty aggregates so the page renders empty rather than blank/
-- crash. get_unit_payment_summary uses the existing {success:false,
-- error:'no_active_sale'} fallback shape (already handled by JS) for
-- gate-blocked unit detail.
--
-- NOT TOUCHED (10 protected report RPCs — must stay caller-blind):
--   get_collection_report, get_sales_register, get_outstanding_report,
--   get_unit_inventory, get_aging_report, get_project_summary,
--   get_tax_wht_report, get_post_possession_dues_report, get_legal_portfolio,
--   get_executive_kpis (added to protected set during 6E triage)

-- ────────────────────────────────────────────────────────────
-- 1. get_dashboard_kpis — non-admin payments gated via parent sale
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_dashboard_kpis(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today            date    := CURRENT_DATE;
  v_month_start      date    := date_trunc('month', now())::date;
  v_prev_month_start date    := (date_trunc('month', now()) - interval '1 month')::date;
  v_six_mo_ago       date    := (date_trunc('month', now()) - interval '5 months')::date;
  v_this_month       numeric; v_prev_month numeric;
  v_today_total      numeric; v_today_count  integer;
  v_recent           jsonb;   v_trend        jsonb;
  v_top_overdue      jsonb;
  v_me               public.app_users := public._rms_caller();
  v_all              boolean := (v_me.id IS NULL) OR public._rms_is_admin(v_me);
  v_pids             uuid[];
BEGIN
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_company_id');
  END IF;

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

  SELECT COALESCE(SUM(amount),0), COUNT(*)
    INTO v_today_total, v_today_count
    FROM payments p
    WHERE p.company_id = p_company_id AND p.payment_date = v_today
      AND (v_all OR EXISTS (SELECT 1 FROM sales s WHERE s.id = p.sale_id AND s.project_id = ANY(v_pids)));

  SELECT COALESCE(jsonb_agg(row_to_json(r)), '[]'::jsonb) INTO v_recent
  FROM (
    SELECT p.id, p.sale_id, p.payment_date, p.amount, p.payment_method,
           s.unit_id AS "unitId"
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
    SELECT
      s.id AS sale_id, s.unit_id,
      c.full_name AS client_name,
      u.unit_no,
      SUM(p.amount) FILTER (WHERE p.id IS NOT NULL) AS paid,
      s.net_amount,
      (s.net_amount - COALESCE(SUM(p.amount) FILTER (WHERE p.id IS NOT NULL), 0)) AS outstanding,
      MAX(p.payment_date) AS last_payment_date,
      (v_today - MAX(p.payment_date))::int AS days_since_payment
    FROM sales s
    JOIN units u ON u.id = s.unit_id
    LEFT JOIN clients c ON c.id = s.client_id
    LEFT JOIN payments p ON p.sale_id = s.id AND p.company_id = p_company_id
    WHERE s.company_id = p_company_id
      AND s.status = 'active'
      AND (v_all OR s.project_id = ANY(v_pids))
    GROUP BY s.id, s.unit_id, c.full_name, u.unit_no, s.net_amount
    HAVING
      (s.net_amount - COALESCE(SUM(p.amount) FILTER (WHERE p.id IS NOT NULL), 0)) > 0
      AND (MAX(p.payment_date) IS NULL OR (v_today - MAX(p.payment_date))::int > 60)
    ORDER BY outstanding DESC
    LIMIT 3
  ) r;

  RETURN jsonb_build_object(
    'success',               true,
    'this_month_collection', v_this_month,
    'prev_month_collection', v_prev_month,
    'today_collection',      v_today_total,
    'today_count',           v_today_count,
    'recent_payments',       v_recent,
    'trend_6m',              v_trend,
    'top_overdue',           v_top_overdue
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- ────────────────────────────────────────────────────────────
-- 2. get_health_dashboard_stats — gate via parent client.project_id
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_health_dashboard_stats(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_result JSONB;
  v_me     public.app_users := public._rms_caller();
  v_all    boolean := (v_me.id IS NULL) OR public._rms_is_admin(v_me);
  v_pids   uuid[];
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT jsonb_build_object(
    'platinum', jsonb_build_object(
      'count',    COUNT(*) FILTER (WHERE category = 'PLATINUM'),
      'exposure', COALESCE(SUM(total_exposure) FILTER (WHERE category = 'PLATINUM'), 0)
    ),
    'good', jsonb_build_object(
      'count',    COUNT(*) FILTER (WHERE category = 'GOOD'),
      'exposure', COALESCE(SUM(total_exposure) FILTER (WHERE category = 'GOOD'), 0)
    ),
    'at_risk', jsonb_build_object(
      'count',    COUNT(*) FILTER (WHERE category = 'AT RISK'),
      'exposure', COALESCE(SUM(total_exposure) FILTER (WHERE category = 'AT RISK'), 0)
    ),
    'critical', jsonb_build_object(
      'count',    COUNT(*) FILTER (WHERE category = 'CRITICAL'),
      'exposure', COALESCE(SUM(total_exposure) FILTER (WHERE category = 'CRITICAL'), 0)
    ),
    'total_clients',          COUNT(*),
    'total_at_risk_exposure', COALESCE(SUM(total_exposure) FILTER (WHERE category IN ('AT RISK', 'CRITICAL')), 0)
  ) INTO v_result
  FROM client_health_scores chs
  WHERE chs.company_id = p_company_id
    AND (v_all OR EXISTS (SELECT 1 FROM clients c WHERE c.id = chs.client_id AND c.project_id = ANY(v_pids)));

  RETURN COALESCE(v_result, jsonb_build_object(
    'platinum',               jsonb_build_object('count', 0, 'exposure', 0),
    'good',                   jsonb_build_object('count', 0, 'exposure', 0),
    'at_risk',                jsonb_build_object('count', 0, 'exposure', 0),
    'critical',               jsonb_build_object('count', 0, 'exposure', 0),
    'total_clients',          0,
    'total_at_risk_exposure', 0
  ));
END;
$function$;

-- ────────────────────────────────────────────────────────────
-- 3. get_commissions_overview — agents direct project_id; payments via parent agent
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_commissions_overview(p_company_id uuid)
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
    'agents', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', a.id, 'full_name', a.full_name, 'agent_code', a.agent_code,
      'total_commission_earned', a.total_commission_earned, 'status', a.status
    ) ORDER BY a.full_name) FROM public.agents a CROSS JOIN cfg
      WHERE a.company_id = p_company_id
        AND (cfg.v_all OR a.project_id = ANY(cfg.v_pids))), '[]'::jsonb),
    'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'agent_id', p.agent_id, 'amount', p.amount
    )) FROM public.agent_commission_payments p CROSS JOIN cfg
      WHERE p.company_id = p_company_id
        AND (cfg.v_all OR EXISTS (SELECT 1 FROM public.agents pa WHERE pa.id = p.agent_id AND pa.project_id = ANY(cfg.v_pids)))), '[]'::jsonb)
  );
$function$;

-- ────────────────────────────────────────────────────────────
-- 4. get_pdc_analytics — PDC + payments gated via parent sale
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_pdc_analytics(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status   jsonb;
  v_aging    jsonb;
  v_by_bank  jsonb;
  v_by_proj  jsonb;
  v_methods  jsonb;
  v_me       public.app_users := public._rms_caller();
  v_all      boolean := (v_me.id IS NULL) OR public._rms_is_admin(v_me);
  v_pids     uuid[];
BEGIN
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
    'due_this_week',  jsonb_build_object('count', COALESCE(COUNT(*) FILTER (WHERE eff BETWEEN CURRENT_DATE AND CURRENT_DATE+7),0),
                                         'amount', COALESCE(SUM(amount) FILTER (WHERE eff BETWEEN CURRENT_DATE AND CURRENT_DATE+7),0)),
    'due_this_month', jsonb_build_object('count', COALESCE(COUNT(*) FILTER (WHERE eff BETWEEN CURRENT_DATE AND CURRENT_DATE+30),0),
                                         'amount', COALESCE(SUM(amount) FILTER (WHERE eff BETWEEN CURRENT_DATE AND CURRENT_DATE+30),0)),
    'overdue',        jsonb_build_object('count', COALESCE(COUNT(*) FILTER (WHERE eff < CURRENT_DATE),0),
                                         'amount', COALESCE(SUM(amount) FILTER (WHERE eff < CURRENT_DATE),0))
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
    LEFT JOIN sales s    ON s.id = pc.sale_id
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

  RETURN jsonb_build_object(
    'success', true,
    'status_summary', v_status,
    'aging', v_aging,
    'by_bank', v_by_bank,
    'by_project', v_by_proj,
    'method_split', v_methods
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- ────────────────────────────────────────────────────────────
-- 5. get_payment_link_stats — gate via parent sale.project_id
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_payment_link_stats(p_company_id uuid, p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_result JSONB;
  v_me     public.app_users := public._rms_caller();
  v_all    boolean := (v_me.id IS NULL) OR public._rms_is_admin(v_me);
  v_pids   uuid[];
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT jsonb_build_object(
    'total_sent',
      COUNT(*) FILTER (WHERE sent_at >= NOW() - (p_days || ' days')::INTERVAL),
    'pending_verification',
      COUNT(*) FILTER (WHERE status = 'screenshot_received'),
    'verified',
      COUNT(*) FILTER (WHERE status = 'verified'),
    'success_rate',
      CASE WHEN COUNT(*) FILTER (WHERE status IN ('verified','rejected')) > 0
        THEN ROUND(
          COUNT(*) FILTER (WHERE status = 'verified')::NUMERIC
          / COUNT(*) FILTER (WHERE status IN ('verified','rejected')) * 100
        )::INTEGER
        ELSE 0 END,
    'total_collected',
      COALESCE(SUM(requested_amount) FILTER (WHERE status = 'verified'), 0)
  )
  INTO v_result
  FROM payment_links pl
  WHERE pl.company_id = p_company_id
    AND (v_all OR EXISTS (SELECT 1 FROM sales s WHERE s.id = pl.sale_id AND s.project_id = ANY(v_pids)));

  RETURN COALESCE(v_result, '{}'::JSONB);
END;
$function$;

-- ────────────────────────────────────────────────────────────
-- 6. get_unit_payment_summary — early-gate on parent unit
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_unit_payment_summary(p_unit_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sale   RECORD;
  v_sale_j JSONB;
  v_insts  JSONB;
  v_me     public.app_users := public._rms_caller();
  v_all    boolean := (v_me.id IS NULL) OR public._rms_is_admin(v_me);
  v_pids   uuid[];
  v_unit_visible boolean;
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.units u
    WHERE u.id = p_unit_id AND u.company_id = p_company_id
      AND (v_all OR u.project_id = ANY(v_pids))
  ) INTO v_unit_visible;

  IF NOT v_unit_visible THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_active_sale');
  END IF;

  SELECT s.id, s.sale_number, s.sale_date, s.price_per_sqft, s.area_sqft,
         s.discount, s.net_amount, s.down_payment, s.remaining_amount,
         s.installment_count, s.status AS sale_status,
         u.unit_no, u.unit_code, u.floor_label, u.area, u.area_unit, u.block,
         p.project_name,
         c.full_name  AS client_name,  c.phone_primary AS client_phone,
         a.full_name  AS agent_name,   a.commission_percent,
         ct.type_name AS unit_type
  INTO v_sale
  FROM public.sales   s
  JOIN public.units   u  ON u.id = s.unit_id
  JOIN public.projects p  ON p.id = u.project_id
  JOIN public.clients  c  ON c.id = s.client_id
  LEFT JOIN public.agents a  ON a.id = s.agent_id
  LEFT JOIN public.category_unit_types ct ON ct.id = u.unit_type_id
  WHERE s.unit_id = p_unit_id
    AND s.company_id = p_company_id
    AND s.status = 'active'
  LIMIT 1;

  IF v_sale IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_active_sale');
  END IF;

  v_sale_j := jsonb_build_object(
    'sale_id',           v_sale.id,
    'sale_number',       v_sale.sale_number,
    'sale_date',         v_sale.sale_date,
    'price_per_sqft',    v_sale.price_per_sqft,
    'area_sqft',         v_sale.area_sqft,
    'discount',          v_sale.discount,
    'net_amount',        v_sale.net_amount,
    'down_payment',      v_sale.down_payment,
    'installment_count', v_sale.installment_count,
    'unit_no',           v_sale.unit_no,
    'unit_code',         v_sale.unit_code,
    'floor_label',       v_sale.floor_label,
    'block',             v_sale.block,
    'area',              v_sale.area,
    'area_unit',         v_sale.area_unit,
    'project_name',      v_sale.project_name,
    'unit_type',         v_sale.unit_type,
    'client_name',       v_sale.client_name,
    'client_phone',      v_sale.client_phone,
    'agent_name',        v_sale.agent_name,
    'commission_percent',v_sale.commission_percent
  );

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'installment_id',     i.id,
      'installment_number', i.installment_number,
      'installment_type',   i.installment_type,
      'due_date',           i.due_date,
      'amount_due',         i.amount_due,
      'amount_paid',        i.amount_paid,
      'outstanding',        GREATEST(i.amount_due - i.amount_paid, 0),
      'status',             i.status,
      'notes',              i.notes
    ) ORDER BY i.installment_number
  ), '[]'::jsonb)
  INTO v_insts
  FROM public.installments i
  WHERE i.sale_id = v_sale.id AND i.company_id = p_company_id;

  IF v_insts = '[]'::jsonb AND v_sale.down_payment > 0 THEN
    v_insts := jsonb_build_array(jsonb_build_object(
      'installment_id',     NULL,
      'installment_number', 0,
      'installment_type',   'down_payment',
      'due_date',           v_sale.sale_date,
      'amount_due',         v_sale.down_payment,
      'amount_paid',        0,
      'outstanding',        v_sale.down_payment,
      'status',             'pending',
      'notes',              'Down Payment / Booking'
    ));
  END IF;

  RETURN jsonb_build_object(
    'success',      true,
    'sale',         v_sale_j,
    'installments', v_insts
  );
END;
$function$;
