-- Collection/dashboard reports: exclude cancelled/transferred sales' payments.
--
-- Same class of bug as get_client_ledger (20260720): these RPCs summed payments
-- joined to sales WITHOUT filtering the SALE's status, so payments made on
-- bookings that were later cancelled kept inflating collection figures. In
-- Fourteen alone that was ₨49,061,380 across 202 payments.
--
-- Fixes applied live via apply_migration on 2026-07-20; recorded here:
--   * get_monthly_collection_trend   — status filter added to the s_filtered CTE
--   * get_project_collection_ledger  — status filter on the v_monthly subquery
--   * get_dashboard_kpis             — NOT EXISTS(cancelled sale) on each payment
--                                      aggregate (this/prev month, today, 6-mo, recent)
--   * get_smart_insights             — status filter on the collection-velocity
--                                      loop + the monthly-target subqueries
--
-- NOTE: get_officer_ledger / get_receiving_ledger (cash-received registers) were
-- intentionally left as-is — a receipt is a receipt even if the booking later
-- cancelled; they are a cash log, not a receivable view.

CREATE OR REPLACE FUNCTION public.get_monthly_collection_trend(p_company_id uuid, p_project_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH months AS (
    SELECT date_trunc('month', CURRENT_DATE - (n || ' months')::interval)::date AS m
    FROM generate_series(0, 11) AS n
  ),
  s_filtered AS (
    SELECT s.id FROM public.sales s LEFT JOIN public.units u ON u.id = s.unit_id
    WHERE s.company_id = p_company_id
      AND s.status NOT IN ('cancelled','transferred')
      AND (p_project_id IS NULL OR COALESCE(s.project_id, u.project_id) = p_project_id)
  ),
  billed AS (
    SELECT date_trunc('month', i.due_date)::date AS m, SUM(i.amount_due) AS amt
    FROM public.installments i
    JOIN s_filtered sf ON sf.id = i.sale_id
    WHERE i.company_id = p_company_id AND i.due_date IS NOT NULL
      AND i.due_date >= (CURRENT_DATE - INTERVAL '13 months')::date
    GROUP BY date_trunc('month', i.due_date)::date
  ),
  collected AS (
    SELECT date_trunc('month', p.payment_date)::date AS m, SUM(p.amount) AS amt
    FROM public.payments p
    JOIN s_filtered sf ON sf.id = p.sale_id
    WHERE p.company_id = p_company_id AND p.payment_date IS NOT NULL
      AND p.status IN ('received','cleared')
      AND p.payment_date >= (CURRENT_DATE - INTERVAL '13 months')::date
    GROUP BY date_trunc('month', p.payment_date)::date
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'month_label',         to_char(months.m, 'Mon YYYY'),
    'month_key',           to_char(months.m, 'YYYY-MM'),
    'billed_amount',       COALESCE(b.amt, 0),
    'collected_amount',    COALESCE(c.amt, 0),
    'collection_rate_pct', CASE WHEN COALESCE(b.amt, 0) > 0
                                THEN ROUND((COALESCE(c.amt,0) / b.amt) * 100, 1)
                                ELSE 0 END
  ) ORDER BY months.m), '[]'::jsonb)
  FROM months
  LEFT JOIN billed    b ON b.m = months.m
  LEFT JOIN collected c ON c.m = months.m;
$function$;

CREATE OR REPLACE FUNCTION public.get_project_collection_ledger(p_project_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
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
    WHERE s.project_id = p_project_id AND p.company_id = p_company_id
      AND s.status NOT IN ('cancelled','transferred')
      AND p.status <> 'cancelled' AND p.payment_date IS NOT NULL
    GROUP BY DATE_TRUNC('month', p.payment_date)
  ) m;
  RETURN jsonb_build_object('success', true, 'sales', COALESCE(v_sales, '[]'::jsonb), 'monthly', COALESCE(v_monthly, '[]'::jsonb));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_dashboard_kpis(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
      AND NOT EXISTS (SELECT 1 FROM sales sc WHERE sc.id = p.sale_id AND sc.status IN ('cancelled','transferred'))
      AND (v_all OR EXISTS (SELECT 1 FROM sales s WHERE s.id = p.sale_id AND s.project_id = ANY(v_pids)));

  SELECT COALESCE(SUM(amount),0) INTO v_prev_month FROM payments p
    WHERE p.company_id = p_company_id
      AND p.payment_date >= v_prev_month_start AND p.payment_date < v_month_start
      AND NOT EXISTS (SELECT 1 FROM sales sc WHERE sc.id = p.sale_id AND sc.status IN ('cancelled','transferred'))
      AND (v_all OR EXISTS (SELECT 1 FROM sales s WHERE s.id = p.sale_id AND s.project_id = ANY(v_pids)));

  SELECT COALESCE(SUM(amount),0), COUNT(*) INTO v_today_total, v_today_count
    FROM payments p
    WHERE p.company_id = p_company_id AND p.payment_date = v_today
      AND NOT EXISTS (SELECT 1 FROM sales sc WHERE sc.id = p.sale_id AND sc.status IN ('cancelled','transferred'))
      AND (v_all OR EXISTS (SELECT 1 FROM sales s WHERE s.id = p.sale_id AND s.project_id = ANY(v_pids)));

  SELECT COALESCE(jsonb_agg(row_to_json(r)), '[]'::jsonb) INTO v_recent
  FROM (
    SELECT p.id, p.sale_id, p.payment_date, p.amount, p.payment_method, s.unit_id AS "unitId"
    FROM payments p LEFT JOIN sales s ON s.id = p.sale_id
    WHERE p.company_id = p_company_id AND p.payment_date >= v_month_start
      AND (s.status IS NULL OR s.status NOT IN ('cancelled','transferred'))
      AND (v_all OR (s.id IS NOT NULL AND s.project_id = ANY(v_pids)))
    ORDER BY p.payment_date DESC, p.created_at DESC LIMIT 6
  ) r;

  WITH month_buckets AS (
    SELECT generate_series(v_six_mo_ago, v_month_start, interval '1 month')::date AS m_start
  ), totals AS (
    SELECT date_trunc('month', p.payment_date)::date AS m, SUM(p.amount) AS total
    FROM payments p
    WHERE p.company_id = p_company_id AND p.payment_date >= v_six_mo_ago
      AND NOT EXISTS (SELECT 1 FROM sales sc WHERE sc.id = p.sale_id AND sc.status IN ('cancelled','transferred'))
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

CREATE OR REPLACE FUNCTION public.get_smart_insights(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller(); v_all boolean; v_pids uuid[];
  v_out jsonb := '[]'::jsonb; v_cnt int; v_amt numeric;
  v_wk_start date := date_trunc('week', CURRENT_DATE)::date;
  v_mo_start date := date_trunc('month', CURRENT_DATE)::date;
  v_yr smallint := EXTRACT(year FROM CURRENT_DATE)::smallint;
  v_mo smallint := EXTRACT(month FROM CURRENT_DATE)::smallint;
  rec record;
BEGIN
  IF p_company_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'missing_company_id'); END IF;
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'no_session'); END IF;
  IF v_me.company_id IS DISTINCT FROM p_company_id THEN RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant'); END IF;
  v_all := public._rms_is_admin(v_me);
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT COUNT(*), COALESCE(SUM(promised_amount),0) INTO v_cnt, v_amt
  FROM payment_promises pp
  WHERE pp.company_id = p_company_id AND pp.status = 'pending' AND pp.promise_date = CURRENT_DATE
    AND (v_all OR EXISTS (SELECT 1 FROM sales s WHERE s.id = pp.sale_id AND s.project_id = ANY(v_pids)));
  IF v_cnt > 0 THEN
    v_out := v_out || jsonb_build_object('severity','danger','icon','alert-triangle','message', v_cnt || ' promise(s) due today still pending — {amt} expected','page','promises','amount', v_amt);
  END IF;

  FOR rec IN
    SELECT pr.project_name,
      COALESCE(SUM(p.amount) FILTER (WHERE p.payment_date >= v_wk_start),0) AS this_week,
      COALESCE(SUM(p.amount) FILTER (WHERE p.payment_date >= v_wk_start - 28 AND p.payment_date < v_wk_start),0)/4.0 AS wk_avg
    FROM payments p JOIN sales s ON s.id = p.sale_id JOIN projects pr ON pr.id = s.project_id
    WHERE p.company_id = p_company_id AND p.status IN ('received','cleared') AND p.payment_date >= v_wk_start - 28
      AND s.status NOT IN ('cancelled','transferred')
      AND (v_all OR s.project_id = ANY(v_pids))
    GROUP BY pr.project_name
    HAVING COALESCE(SUM(p.amount) FILTER (WHERE p.payment_date >= v_wk_start - 28 AND p.payment_date < v_wk_start),0)/4.0 > 0
       AND COALESCE(SUM(p.amount) FILTER (WHERE p.payment_date >= v_wk_start),0) < 0.7 * (COALESCE(SUM(p.amount) FILTER (WHERE p.payment_date >= v_wk_start - 28 AND p.payment_date < v_wk_start),0)/4.0)
    ORDER BY wk_avg DESC
  LOOP
    v_out := v_out || jsonb_build_object('severity','warning','icon','trending-down','message', rec.project_name || ': collections slowing — {amt} this week vs avg','page','recovery','amount', rec.this_week);
  END LOOP;

  SELECT COUNT(*), COALESCE(SUM(amount),0) INTO v_cnt, v_amt
  FROM pdc_cheques pc
  WHERE pc.company_id = p_company_id AND pc.status IN ('pending','presented') AND COALESCE(pc.deposit_date, pc.cheque_date) = CURRENT_DATE + 1
    AND (v_all OR EXISTS (SELECT 1 FROM sales s WHERE s.id = pc.sale_id AND s.project_id = ANY(v_pids)));
  IF v_cnt > 0 THEN
    v_out := v_out || jsonb_build_object('severity','warning','icon','clock','message', v_cnt || ' PDC(s) due tomorrow — {amt}','page','pdc','amount', v_amt);
  END IF;

  SELECT COUNT(*), COALESCE(SUM(outstanding),0) INTO v_cnt, v_amt
  FROM installments i
  WHERE i.company_id = p_company_id AND i.status <> 'paid' AND COALESCE(i.outstanding,0) > 0 AND i.due_date BETWEEN CURRENT_DATE - 90 AND CURRENT_DATE - 83
    AND (v_all OR EXISTS (SELECT 1 FROM sales s WHERE s.id = i.sale_id AND s.project_id = ANY(v_pids)));
  IF v_cnt > 0 THEN
    v_out := v_out || jsonb_build_object('severity','warning','icon','clock','message', v_cnt || ' installment(s) crossing 90+ overdue this week — {amt}','page','recovery','amount', v_amt);
  END IF;

  FOR rec IN
    SELECT pr.project_name, SUM(rot.target_amount) AS target,
      COALESCE((SELECT SUM(p.amount) FROM payments p JOIN sales s ON s.id = p.sale_id
                WHERE p.company_id = p_company_id AND s.project_id = rot.project_id AND p.status IN ('received','cleared') AND p.payment_date >= v_mo_start AND s.status NOT IN ('cancelled','transferred')),0) AS collected
    FROM recovery_officer_targets rot JOIN projects pr ON pr.id = rot.project_id
    WHERE rot.company_id = p_company_id AND rot.year = v_yr AND rot.month = v_mo AND (v_all OR rot.project_id = ANY(v_pids))
    GROUP BY rot.project_id, pr.project_name
    HAVING SUM(rot.target_amount) > 0
       AND COALESCE((SELECT SUM(p.amount) FROM payments p JOIN sales s ON s.id = p.sale_id
                WHERE p.company_id = p_company_id AND s.project_id = rot.project_id AND p.status IN ('received','cleared') AND p.payment_date >= v_mo_start AND s.status NOT IN ('cancelled','transferred')),0) >= SUM(rot.target_amount)
    ORDER BY collected DESC
  LOOP
    v_out := v_out || jsonb_build_object('severity','success','icon','check','message', rec.project_name || ': monthly target achieved — {amt} collected','page','recovery-dashboard','amount', rec.collected);
  END LOOP;

  IF jsonb_array_length(v_out) = 0 THEN
    v_out := jsonb_build_array(jsonb_build_object('severity','success','icon','check','message','Everything is on track','page','recovery-dashboard','amount', NULL));
  END IF;
  IF jsonb_array_length(v_out) > 6 THEN
    SELECT jsonb_agg(e) INTO v_out FROM (SELECT e FROM jsonb_array_elements(v_out) WITH ORDINALITY t(e,ord) ORDER BY ord LIMIT 6) z;
  END IF;

  RETURN jsonb_build_object('success', true, 'insights', v_out);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM); END;
$function$;
