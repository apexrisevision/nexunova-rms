-- ================================================================
-- NEXUNOVA RMS — MODULE 1.4 RECOVERY FORECASTING
-- 2026-05-25
-- APPLIED to live DB (project itqxljtfbrppntgyfush) via MCP apply_migration
-- on 2026-05-25. Verified: empty-tenant returns correct full structure
-- (has_history:false, rate 1.0, 6-month series); core arithmetic confirmed
-- with a synthetic check (rate 0.8, sched 50k/50k/80k, forecast_90 64k).
--
-- forecast_recovery(p_company_id): predicted collection for the next
-- 30/60/90 days from (a) scheduled installments due in window, weighted
-- by the trailing-90-day collection rate, plus (b) the pending-promise
-- pipeline. Project- and officer-wise breakdowns + backward 6-month
-- billed-vs-collected series. Read-only; SECURITY DEFINER.
-- ================================================================

CREATE OR REPLACE FUNCTION public.forecast_recovery(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_billed_90    numeric := 0;
  v_collected_90 numeric := 0;
  v_rate         numeric;
  v_has_history  boolean := false;
  v_horizons     jsonb;
  v_by_project   jsonb;
  v_by_officer   jsonb;
  v_monthly      jsonb;
BEGIN
  SELECT COALESCE(SUM(amount_due), 0) INTO v_billed_90
  FROM installments
  WHERE company_id = p_company_id
    AND due_date BETWEEN CURRENT_DATE - 90 AND CURRENT_DATE;

  SELECT COALESCE(SUM(amount), 0) INTO v_collected_90
  FROM payments
  WHERE company_id = p_company_id
    AND payment_date BETWEEN CURRENT_DATE - 90 AND CURRENT_DATE;

  v_has_history := v_billed_90 > 0;
  v_rate := LEAST(1.0, CASE WHEN v_billed_90 > 0 THEN v_collected_90 / v_billed_90 ELSE 1.0 END);

  SELECT jsonb_agg(h ORDER BY (h->>'days')::int) INTO v_horizons
  FROM (
    SELECT jsonb_build_object(
      'days',          x.d,
      'scheduled_due', x.sched,
      'promised',      x.prom,
      'forecast',      ROUND(x.sched * v_rate)
    ) AS h
    FROM (
      SELECT t.d,
        COALESCE((
          SELECT SUM(amount_due - COALESCE(amount_paid, 0)) FROM installments
          WHERE company_id = p_company_id
            AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + t.d
            AND COALESCE(status, '') <> 'paid'
            AND (amount_due - COALESCE(amount_paid, 0)) > 0
        ), 0)::numeric AS sched,
        COALESCE((
          SELECT SUM(promised_amount) FROM payment_promises
          WHERE company_id = p_company_id
            AND status = 'pending'
            AND promise_date BETWEEN CURRENT_DATE AND CURRENT_DATE + t.d
        ), 0)::numeric AS prom
      FROM (VALUES (30), (60), (90)) AS t(d)
    ) x
  ) y;

  SELECT COALESCE(jsonb_agg(row_to_json(p) ORDER BY p.scheduled_due DESC), '[]'::jsonb) INTO v_by_project
  FROM (
    SELECT
      pr.id           AS project_id,
      pr.project_name AS project_name,
      COALESCE(SUM(i.amount_due - COALESCE(i.amount_paid, 0)), 0)::numeric            AS scheduled_due,
      ROUND(COALESCE(SUM(i.amount_due - COALESCE(i.amount_paid, 0)), 0) * v_rate)::numeric AS forecast
    FROM installments i
    JOIN sales s     ON s.id  = i.sale_id
    JOIN units u     ON u.id  = s.unit_id
    JOIN projects pr ON pr.id = u.project_id
    WHERE i.company_id = p_company_id
      AND i.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 90
      AND COALESCE(i.status, '') <> 'paid'
      AND (i.amount_due - COALESCE(i.amount_paid, 0)) > 0
    GROUP BY pr.id, pr.project_name
  ) p;

  SELECT COALESCE(jsonb_agg(row_to_json(o) ORDER BY o.promised DESC), '[]'::jsonb) INTO v_by_officer
  FROM (
    SELECT
      pp.logged_by AS username,
      COALESCE(au.full_name, pp.logged_by) AS officer_name,
      COUNT(*)::int                          AS pending_count,
      COALESCE(SUM(pp.promised_amount), 0)::numeric AS promised
    FROM payment_promises pp
    LEFT JOIN app_users au ON au.username = pp.logged_by AND au.company_id = pp.company_id
    WHERE pp.company_id = p_company_id
      AND pp.status = 'pending'
      AND pp.promise_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 90
      AND pp.logged_by IS NOT NULL AND pp.logged_by <> ''
    GROUP BY pp.logged_by, au.full_name
  ) o;

  SELECT COALESCE(jsonb_agg(row_to_json(m) ORDER BY m.month_start ASC), '[]'::jsonb) INTO v_monthly
  FROM (
    SELECT
      mb.month_start,
      to_char(mb.month_start, 'Mon YYYY') AS label,
      COALESCE((
        SELECT SUM(amount_due) FROM installments
        WHERE company_id = p_company_id
          AND due_date >= mb.month_start
          AND due_date <  (mb.month_start + INTERVAL '1 month')
      ), 0)::numeric AS billed,
      COALESCE((
        SELECT SUM(amount) FROM payments
        WHERE company_id = p_company_id
          AND payment_date >= mb.month_start
          AND payment_date <  (mb.month_start + INTERVAL '1 month')
      ), 0)::numeric AS collected
    FROM (
      SELECT (date_trunc('month', CURRENT_DATE) - (gs || ' months')::interval)::date AS month_start
      FROM generate_series(5, 0, -1) AS gs
    ) mb
  ) m;

  RETURN jsonb_build_object(
    'success',      true,
    'generated_at', NOW(),
    'historical', jsonb_build_object(
      'billed_90',    v_billed_90,
      'collected_90', v_collected_90,
      'rate',         ROUND(v_rate, 4),
      'rate_pct',     ROUND(v_rate * 100, 1),
      'has_history',  v_has_history
    ),
    'horizons',       COALESCE(v_horizons, '[]'::jsonb),
    'by_project',     v_by_project,
    'by_officer',     v_by_officer,
    'monthly_actual', v_monthly
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.forecast_recovery(uuid) TO anon, authenticated;
