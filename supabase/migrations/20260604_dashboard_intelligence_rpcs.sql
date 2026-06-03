-- ════════════════════════════════════════════════════════════════════════
-- 2026-06-04  Dashboard "Mission Control" intelligence RPCs
--   1. get_recovery_health_score  — composite 0-100 health score + components
--   2. get_smart_insights         — prioritised actionable insight feed
--   3. get_cash_forecast          — expected inflow next 90 days, by month
--
-- Conventions (mirror get_dashboard_kpis): SECURITY DEFINER, search_path=public,
-- caller via public._rms_caller() (app_users.auth_user_id = auth.uid()),
-- wrong_tenant guard, project gate via user_project_assignments + sales.project_id,
-- graceful {success:false,error:'no_session'} envelope. authenticated-only EXECUTE
-- (NOT anon — these are not on the anon allow-list).
--
-- Verified status vocabularies (CHECK constraints, 2026-06-04):
--   installments: pending|partial|paid|overdue
--   payment_promises: pending|kept|partial|broken|cancelled|postponed
--   payments: received|cleared|bounced|reversed|cancelled|refunded
--   pdc_cheques (no check): pending|presented|deposited|cleared|bounced
-- ════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- 1. get_recovery_health_score(p_company_id) → jsonb
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_recovery_health_score(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me   public.app_users := public._rms_caller();
  v_all  boolean;
  v_pids uuid[];
  d0 date := CURRENT_DATE;          -- "now" anchor
  d1 date := CURRENT_DATE - 30;     -- "last month" anchor (window shifted back 30d)
  -- raw aggregates: _n = now window [d0-90,d0], _p = prev window [d1-90,d1]
  recv_n numeric; recv_p numeric; due_n numeric; due_p numeric;
  kept_n int; kept_p int; decided_n int; decided_p int;
  over90_n numeric; over90_p numeric; tot_n numeric; tot_p numeric;
  pres_n int; pres_p int; bnc_n int; bnc_p int;
  -- component ratios (NULL when no data → returned as null, scored as neutral best)
  cr numeric; pk numeric; ag numeric; bn numeric;
  cr_p numeric; pk_p numeric; ag_p numeric; bn_p numeric;
  score_n int; score_p int; v_label text;
BEGIN
  IF p_company_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'missing_company_id'); END IF;
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'no_session'); END IF;
  IF v_me.company_id IS DISTINCT FROM p_company_id THEN RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant'); END IF;
  v_all := public._rms_is_admin(v_me);
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  -- collection: payments received vs installments due
  SELECT COALESCE(SUM(amount) FILTER (WHERE payment_date BETWEEN d0-90 AND d0),0),
         COALESCE(SUM(amount) FILTER (WHERE payment_date BETWEEN d1-90 AND d1),0)
  INTO recv_n, recv_p
  FROM payments p
  WHERE p.company_id = p_company_id AND p.status IN ('received','cleared')
    AND p.payment_date BETWEEN d1-90 AND d0
    AND (v_all OR EXISTS (SELECT 1 FROM sales s WHERE s.id = p.sale_id AND s.project_id = ANY(v_pids)));

  SELECT COALESCE(SUM(amount_due) FILTER (WHERE due_date BETWEEN d0-90 AND d0),0),
         COALESCE(SUM(amount_due) FILTER (WHERE due_date BETWEEN d1-90 AND d1),0)
  INTO due_n, due_p
  FROM installments i
  WHERE i.company_id = p_company_id AND i.due_date BETWEEN d1-90 AND d0
    AND (v_all OR EXISTS (SELECT 1 FROM sales s WHERE s.id = i.sale_id AND s.project_id = ANY(v_pids)));

  -- promises: kept(+partial) / decided(kept+partial+broken)
  SELECT COUNT(*) FILTER (WHERE promise_date BETWEEN d0-90 AND d0 AND status IN ('kept','partial')),
         COUNT(*) FILTER (WHERE promise_date BETWEEN d0-90 AND d0 AND status IN ('kept','partial','broken')),
         COUNT(*) FILTER (WHERE promise_date BETWEEN d1-90 AND d1 AND status IN ('kept','partial')),
         COUNT(*) FILTER (WHERE promise_date BETWEEN d1-90 AND d1 AND status IN ('kept','partial','broken'))
  INTO kept_n, decided_n, kept_p, decided_p
  FROM payment_promises pp
  WHERE pp.company_id = p_company_id AND pp.promise_date BETWEEN d1-90 AND d0
    AND (v_all OR EXISTS (SELECT 1 FROM sales s WHERE s.id = pp.sale_id AND s.project_id = ANY(v_pids)));

  -- aging: outstanding overdue >90d / total outstanding (as-of each anchor; current balances)
  SELECT COALESCE(SUM(outstanding) FILTER (WHERE due_date < d0-90),0),
         COALESCE(SUM(outstanding) FILTER (WHERE due_date <= d0),0),
         COALESCE(SUM(outstanding) FILTER (WHERE due_date < d1-90),0),
         COALESCE(SUM(outstanding) FILTER (WHERE due_date <= d1),0)
  INTO over90_n, tot_n, over90_p, tot_p
  FROM installments i
  WHERE i.company_id = p_company_id AND i.status <> 'paid' AND COALESCE(i.outstanding,0) > 0
    AND (v_all OR EXISTS (SELECT 1 FROM sales s WHERE s.id = i.sale_id AND s.project_id = ANY(v_pids)));

  -- pdc: bounced / presented
  SELECT COUNT(*) FILTER (WHERE status IN ('presented','cleared','bounced') AND COALESCE(bounce_date,clearance_date,deposit_date,cheque_date) BETWEEN d0-90 AND d0),
         COUNT(*) FILTER (WHERE status = 'bounced' AND COALESCE(bounce_date,deposit_date,cheque_date) BETWEEN d0-90 AND d0),
         COUNT(*) FILTER (WHERE status IN ('presented','cleared','bounced') AND COALESCE(bounce_date,clearance_date,deposit_date,cheque_date) BETWEEN d1-90 AND d1),
         COUNT(*) FILTER (WHERE status = 'bounced' AND COALESCE(bounce_date,deposit_date,cheque_date) BETWEEN d1-90 AND d1)
  INTO pres_n, bnc_n, pres_p, bnc_p
  FROM pdc_cheques pc
  WHERE pc.company_id = p_company_id
    AND (v_all OR EXISTS (SELECT 1 FROM sales s WHERE s.id = pc.sale_id AND s.project_id = ANY(v_pids)));

  -- component ratios (NULL = no data)
  cr   := CASE WHEN due_n  > 0 THEN LEAST(1, recv_n/due_n) END;
  pk   := CASE WHEN decided_n > 0 THEN kept_n::numeric/decided_n END;
  ag   := CASE WHEN tot_n  > 0 THEN over90_n/tot_n END;
  bn   := CASE WHEN pres_n > 0 THEN bnc_n::numeric/pres_n END;
  cr_p := CASE WHEN due_p  > 0 THEN LEAST(1, recv_p/due_p) END;
  pk_p := CASE WHEN decided_p > 0 THEN kept_p::numeric/decided_p END;
  ag_p := CASE WHEN tot_p  > 0 THEN over90_p/tot_p END;
  bn_p := CASE WHEN pres_p > 0 THEN bnc_p::numeric/pres_p END;

  -- score (no-data component → neutral best: collection/promise=1, aging/bounce=0)
  score_n := ROUND(35*COALESCE(cr,1) + 25*COALESCE(pk,1) + 25*(1-COALESCE(ag,0)) + 15*(1-COALESCE(bn,0)));
  score_p := ROUND(35*COALESCE(cr_p,1) + 25*COALESCE(pk_p,1) + 25*(1-COALESCE(ag_p,0)) + 15*(1-COALESCE(bn_p,0)));

  v_label := CASE WHEN score_n >= 80 THEN 'Excellent'
                  WHEN score_n >= 60 THEN 'Good'
                  WHEN score_n >= 40 THEN 'Needs attention'
                  ELSE 'Critical' END;

  RETURN jsonb_build_object(
    'success', true,
    'score', score_n,
    'label', v_label,
    'delta_vs_last_month', score_n - score_p,
    'components', jsonb_build_object(
      'collection_rate',     CASE WHEN cr IS NULL THEN NULL ELSE ROUND(cr,4) END,
      'promise_keep_rate',   CASE WHEN pk IS NULL THEN NULL ELSE ROUND(pk,4) END,
      'aging_90_plus_share', CASE WHEN ag IS NULL THEN NULL ELSE ROUND(ag,4) END,
      'pdc_bounce_rate',     CASE WHEN bn IS NULL THEN NULL ELSE ROUND(bn,4) END
    )
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. get_smart_insights(p_company_id) → jsonb array (max 6)
--    item: { severity, icon, message, page, amount }  (message has {amt} token;
--    frontend substitutes the lakh/crore-formatted amount. amount is raw numeric.)
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_smart_insights(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me   public.app_users := public._rms_caller();
  v_all  boolean;
  v_pids uuid[];
  v_out  jsonb := '[]'::jsonb;
  v_cnt  int; v_amt numeric;
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

  -- 1) promises due today still pending  → danger / promises
  SELECT COUNT(*), COALESCE(SUM(promised_amount),0) INTO v_cnt, v_amt
  FROM payment_promises pp
  WHERE pp.company_id = p_company_id AND pp.status = 'pending' AND pp.promise_date = CURRENT_DATE
    AND (v_all OR EXISTS (SELECT 1 FROM sales s WHERE s.id = pp.sale_id AND s.project_id = ANY(v_pids)));
  IF v_cnt > 0 THEN
    v_out := v_out || jsonb_build_object('severity','danger','icon','alert-triangle',
      'message', v_cnt || ' promise(s) due today still pending — {amt} expected', 'page','promises','amount', v_amt);
  END IF;

  -- 2) per project: this week's collections < 70% of trailing 4-week weekly avg  → warning / recovery
  FOR rec IN
    SELECT pr.project_name,
      COALESCE(SUM(p.amount) FILTER (WHERE p.payment_date >= v_wk_start),0) AS this_week,
      COALESCE(SUM(p.amount) FILTER (WHERE p.payment_date >= v_wk_start - 28 AND p.payment_date < v_wk_start),0)/4.0 AS wk_avg
    FROM payments p JOIN sales s ON s.id = p.sale_id JOIN projects pr ON pr.id = s.project_id
    WHERE p.company_id = p_company_id AND p.status IN ('received','cleared')
      AND p.payment_date >= v_wk_start - 28
      AND (v_all OR s.project_id = ANY(v_pids))
    GROUP BY pr.project_name
    HAVING COALESCE(SUM(p.amount) FILTER (WHERE p.payment_date >= v_wk_start - 28 AND p.payment_date < v_wk_start),0)/4.0 > 0
       AND COALESCE(SUM(p.amount) FILTER (WHERE p.payment_date >= v_wk_start),0)
           < 0.7 * (COALESCE(SUM(p.amount) FILTER (WHERE p.payment_date >= v_wk_start - 28 AND p.payment_date < v_wk_start),0)/4.0)
    ORDER BY wk_avg DESC
  LOOP
    v_out := v_out || jsonb_build_object('severity','warning','icon','trending-down',
      'message', rec.project_name || ': collections slowing — {amt} this week vs avg', 'page','recovery','amount', rec.this_week);
  END LOOP;

  -- 3) PDCs due tomorrow  → warning / pdc
  SELECT COUNT(*), COALESCE(SUM(amount),0) INTO v_cnt, v_amt
  FROM pdc_cheques pc
  WHERE pc.company_id = p_company_id AND pc.status IN ('pending','presented')
    AND COALESCE(pc.deposit_date, pc.cheque_date) = CURRENT_DATE + 1
    AND (v_all OR EXISTS (SELECT 1 FROM sales s WHERE s.id = pc.sale_id AND s.project_id = ANY(v_pids)));
  IF v_cnt > 0 THEN
    v_out := v_out || jsonb_build_object('severity','warning','icon','clock',
      'message', v_cnt || ' PDC(s) due tomorrow — {amt}', 'page','pdc','amount', v_amt);
  END IF;

  -- 4) installments crossing into 90+ overdue within next 7 days  → warning / recovery
  SELECT COUNT(*), COALESCE(SUM(outstanding),0) INTO v_cnt, v_amt
  FROM installments i
  WHERE i.company_id = p_company_id AND i.status <> 'paid' AND COALESCE(i.outstanding,0) > 0
    AND i.due_date BETWEEN CURRENT_DATE - 90 AND CURRENT_DATE - 83
    AND (v_all OR EXISTS (SELECT 1 FROM sales s WHERE s.id = i.sale_id AND s.project_id = ANY(v_pids)));
  IF v_cnt > 0 THEN
    v_out := v_out || jsonb_build_object('severity','warning','icon','clock',
      'message', v_cnt || ' installment(s) crossing 90+ overdue this week — {amt}', 'page','recovery','amount', v_amt);
  END IF;

  -- 5) project crossed monthly collection target  → success / recovery-dashboard
  FOR rec IN
    SELECT pr.project_name,
      SUM(rot.target_amount) AS target,
      COALESCE((SELECT SUM(p.amount) FROM payments p JOIN sales s ON s.id = p.sale_id
                WHERE p.company_id = p_company_id AND s.project_id = rot.project_id
                  AND p.status IN ('received','cleared') AND p.payment_date >= v_mo_start),0) AS collected
    FROM recovery_officer_targets rot JOIN projects pr ON pr.id = rot.project_id
    WHERE rot.company_id = p_company_id AND rot.year = v_yr AND rot.month = v_mo
      AND (v_all OR rot.project_id = ANY(v_pids))
    GROUP BY rot.project_id, pr.project_name
    HAVING SUM(rot.target_amount) > 0
       AND COALESCE((SELECT SUM(p.amount) FROM payments p JOIN sales s ON s.id = p.sale_id
                WHERE p.company_id = p_company_id AND s.project_id = rot.project_id
                  AND p.status IN ('received','cleared') AND p.payment_date >= v_mo_start),0) >= SUM(rot.target_amount)
    ORDER BY collected DESC
  LOOP
    v_out := v_out || jsonb_build_object('severity','success','icon','check',
      'message', rec.project_name || ': monthly target achieved — {amt} collected', 'page','recovery-dashboard','amount', rec.collected);
  END LOOP;

  -- 6) nothing triggered → single all-clear
  IF jsonb_array_length(v_out) = 0 THEN
    v_out := jsonb_build_array(jsonb_build_object('severity','success','icon','check',
      'message','Everything is on track','page','recovery-dashboard','amount', NULL));
  END IF;

  -- cap at 6 (priority order preserved)
  IF jsonb_array_length(v_out) > 6 THEN
    SELECT jsonb_agg(e) INTO v_out FROM (SELECT e FROM jsonb_array_elements(v_out) WITH ORDINALITY t(e,ord) ORDER BY ord LIMIT 6) z;
  END IF;

  RETURN jsonb_build_object('success', true, 'insights', v_out);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. get_cash_forecast(p_company_id) → jsonb { total, months:[{month,expected}x3] }
--    next 90 days: unpaid installments + standalone pending promises
--    (installment_id IS NULL → not double-counting linked installments) + in-hand PDCs
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_cash_forecast(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me   public.app_users := public._rms_caller();
  v_all  boolean;
  v_pids uuid[];
  v_months jsonb;
  v_total  numeric;
BEGIN
  IF p_company_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'missing_company_id'); END IF;
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'no_session'); END IF;
  IF v_me.company_id IS DISTINCT FROM p_company_id THEN RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant'); END IF;
  v_all := public._rms_is_admin(v_me);
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  WITH months AS (
    SELECT generate_series(date_trunc('month', CURRENT_DATE),
                           date_trunc('month', CURRENT_DATE) + interval '2 months',
                           interval '1 month')::date AS m_start
  ),
  inst AS (
    SELECT date_trunc('month', i.due_date)::date AS m, SUM(i.outstanding) AS amt
    FROM installments i
    WHERE i.company_id = p_company_id AND i.status IN ('pending','partial','overdue') AND COALESCE(i.outstanding,0) > 0
      AND i.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 90
      AND (v_all OR EXISTS (SELECT 1 FROM sales s WHERE s.id = i.sale_id AND s.project_id = ANY(v_pids)))
    GROUP BY 1
  ),
  prom AS (
    SELECT date_trunc('month', COALESCE(pp.postponed_to_date, pp.promise_date))::date AS m, SUM(pp.promised_amount) AS amt
    FROM payment_promises pp
    WHERE pp.company_id = p_company_id AND pp.status = 'pending' AND pp.installment_id IS NULL
      AND COALESCE(pp.postponed_to_date, pp.promise_date) BETWEEN CURRENT_DATE AND CURRENT_DATE + 90
      AND (v_all OR EXISTS (SELECT 1 FROM sales s WHERE s.id = pp.sale_id AND s.project_id = ANY(v_pids)))
    GROUP BY 1
  ),
  pdc AS (
    SELECT date_trunc('month', COALESCE(pc.deposit_date, pc.cheque_date))::date AS m, SUM(pc.amount) AS amt
    FROM pdc_cheques pc
    WHERE pc.company_id = p_company_id AND pc.status NOT IN ('cleared','bounced','cancelled','reversed')
      AND COALESCE(pc.deposit_date, pc.cheque_date) BETWEEN CURRENT_DATE AND CURRENT_DATE + 90
      AND (v_all OR EXISTS (SELECT 1 FROM sales s WHERE s.id = pc.sale_id AND s.project_id = ANY(v_pids)))
    GROUP BY 1
  )
  SELECT
    COALESCE(SUM(COALESCE(i.amt,0) + COALESCE(pr.amt,0) + COALESCE(pc.amt,0)),0),
    jsonb_agg(jsonb_build_object(
      'month', to_char(m.m_start, 'Mon'),
      'expected', COALESCE(i.amt,0) + COALESCE(pr.amt,0) + COALESCE(pc.amt,0)
    ) ORDER BY m.m_start)
  INTO v_total, v_months
  FROM months m
  LEFT JOIN inst i ON i.m = m.m_start
  LEFT JOIN prom pr ON pr.m = m.m_start
  LEFT JOIN pdc pc ON pc.m = m.m_start;

  RETURN jsonb_build_object('success', true, 'total', COALESCE(v_total,0), 'months', COALESCE(v_months,'[]'::jsonb));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- ── Grants: authenticated only (NOT anon) ────────────────────────────────
REVOKE ALL ON FUNCTION public.get_recovery_health_score(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_smart_insights(uuid)        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_cash_forecast(uuid)         FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_recovery_health_score(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_smart_insights(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cash_forecast(uuid)         TO authenticated;
