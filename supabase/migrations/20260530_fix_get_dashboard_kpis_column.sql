-- ════════════════════════════════════════════════════════════
-- TINY CLEANUP: fix pre-existing column-name bug in get_dashboard_kpis
-- 2026-05-30.  Unrelated to project-scoping; kept separate per Rashid's instruction.
-- ════════════════════════════════════════════════════════════
-- Same class of bug as the get_agent_performance fix (commit 173c4f2)
-- and the get_portal_client_data fix (commit e79f7df). The top_overdue
-- subquery references sales.total_price which doesn't exist — the
-- correct column is net_amount (generated; gross less discount).
-- Verified empirically: get_dashboard_kpis returns success:false
-- ("column s.total_price does not exist") on a real call, so the
-- recovery dashboard / main dashboard KPIs are already degraded today.
--
-- Three column references in the top_overdue CTE → net_amount:
--   GROUP BY ... s.total_price       → s.net_amount
--   HAVING (s.total_price - ...)     → s.net_amount - ...
--   SELECT s.total_price             → s.net_amount
-- Everything else (incl. the deliberately-untouched per-project
-- isolation that ships in Batch 6E) is preserved verbatim.

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
BEGIN
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_company_id');
  END IF;

  SELECT COALESCE(SUM(amount),0) INTO v_this_month FROM payments
    WHERE company_id = p_company_id AND payment_date >= v_month_start;

  SELECT COALESCE(SUM(amount),0) INTO v_prev_month FROM payments
    WHERE company_id = p_company_id
      AND payment_date >= v_prev_month_start AND payment_date < v_month_start;

  SELECT COALESCE(SUM(amount),0), COUNT(*)
    INTO v_today_total, v_today_count
    FROM payments
    WHERE company_id = p_company_id AND payment_date = v_today;

  SELECT COALESCE(jsonb_agg(row_to_json(r)), '[]'::jsonb) INTO v_recent
  FROM (
    SELECT p.id, p.sale_id, p.payment_date, p.amount, p.payment_method,
           s.unit_id AS "unitId"
    FROM payments p LEFT JOIN sales s ON s.id = p.sale_id
    WHERE p.company_id = p_company_id AND p.payment_date >= v_month_start
    ORDER BY p.payment_date DESC, p.created_at DESC LIMIT 6
  ) r;

  WITH month_buckets AS (
    SELECT generate_series(v_six_mo_ago, v_month_start, interval '1 month')::date AS m_start
  ), totals AS (
    SELECT date_trunc('month', payment_date)::date AS m, SUM(amount) AS total
    FROM payments WHERE company_id = p_company_id AND payment_date >= v_six_mo_ago GROUP BY 1
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
