-- =====================================================================
-- Phase 4 / Component 4 — Reports backlog: 8 new management report RPCs.
-- Applied to itqxljtfbrppntgyfush on 2026-05-27 (migration
-- phase4_report_rpcs).
--
-- All anon-friendly (NO _rms_caller session check — report viewer uses
-- the anon publishable key), SECURITY DEFINER + search_path=public,
-- company-scoped via p_company_id, optional p_project_id (NULL = all).
-- Granted to anon, authenticated, service_role.
--
-- Schema realities (verified against the live DB):
--   * legal_cases uses `stage` (status) and `lawyer_name`; `outcome` is
--     the closure type. Active = outcome IS NULL OR NOT IN
--     (closed/dismissed/settled/withdrawn).
--   * commission_structures column is `rate_percent` (not commission_rate).
--   * No filer/non-filer column exists yet — get_tax_wht_report defaults
--     filer_status='unknown' and derives wht_rate_pct from
--     wht_amount/net_amount (effective rate).
--   * get_post_possession_dues collided with a pre-existing 1-arg RPC
--     (powers js/pages/possession.js, different table+envelope). Renamed
--     mine to get_post_possession_dues_report in a follow-up migration —
--     see 20260527_phase4_report_rpcs_fix_possession_name.sql.
-- =====================================================================

-- 1) Aging report — outstanding installments bucketed by days overdue
CREATE OR REPLACE FUNCTION public.get_aging_report(
  p_company_id uuid, p_project_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH q AS (
    SELECT
      CASE
        WHEN (CURRENT_DATE - i.due_date) BETWEEN 0  AND 30  THEN '0-30'
        WHEN (CURRENT_DATE - i.due_date) BETWEEN 31 AND 60  THEN '31-60'
        WHEN (CURRENT_DATE - i.due_date) BETWEEN 61 AND 90  THEN '61-90'
        WHEN (CURRENT_DATE - i.due_date) BETWEEN 91 AND 180 THEN '91-180'
        ELSE '180+'
      END AS bucket,
      GREATEST(0, COALESCE(i.outstanding, i.amount_due - COALESCE(i.amount_paid,0))) AS outstanding,
      c.full_name AS client_name
    FROM public.installments i
    JOIN public.sales s ON s.id = i.sale_id AND s.company_id = i.company_id
    LEFT JOIN public.clients c ON c.id = s.client_id
    LEFT JOIN public.units   u ON u.id = s.unit_id
    WHERE i.company_id = p_company_id
      AND COALESCE(i.outstanding, i.amount_due - COALESCE(i.amount_paid,0)) > 0
      AND i.due_date IS NOT NULL
      AND i.due_date <= CURRENT_DATE
      AND (p_project_id IS NULL OR COALESCE(i.project_id, s.project_id, u.project_id) = p_project_id)
  ),
  agg AS (
    SELECT bucket, count(*) AS cnt, SUM(outstanding) AS total_amount,
      (array_agg(client_name) FILTER (WHERE client_name IS NOT NULL))[1:3] AS sample
    FROM q GROUP BY bucket
  ),
  bo AS (
    SELECT * FROM (VALUES ('0-30',1),('31-60',2),('61-90',3),('91-180',4),('180+',5)) AS b(bucket, ord)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'bucket',        bo.bucket,
    'count',         COALESCE(agg.cnt, 0),
    'total_amount',  COALESCE(agg.total_amount, 0),
    'client_sample', COALESCE(array_to_string(agg.sample, ', '), '—')
  ) ORDER BY bo.ord), '[]'::jsonb)
  FROM bo LEFT JOIN agg ON agg.bucket = bo.bucket;
$$;

-- 2) Commission report — agent-wise sales + earnings
CREATE OR REPLACE FUNCTION public.get_commission_report(
  p_company_id uuid, p_project_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH sale_agg AS (
    SELECT s.agent_id,
           count(*)                            AS sales_count,
           COALESCE(SUM(s.net_amount), 0)      AS sale_value,
           AVG(COALESCE(s.commission_rate, 0)) AS avg_rate
    FROM public.sales s
    LEFT JOIN public.units u ON u.id = s.unit_id
    WHERE s.company_id = p_company_id
      AND s.status <> 'cancelled' AND s.agent_id IS NOT NULL
      AND (p_project_id IS NULL OR COALESCE(s.project_id, u.project_id) = p_project_id)
    GROUP BY s.agent_id
  ),
  cs AS (
    SELECT agent_id, AVG(rate_percent) AS struct_rate
    FROM public.commission_structures
    WHERE company_id = p_company_id AND is_active
      AND (p_project_id IS NULL OR project_id = p_project_id OR project_id IS NULL)
    GROUP BY agent_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'agent_name',         a.full_name,
    'total_sales_count',  COALESCE(sa.sales_count, 0),
    'total_sale_value',   COALESCE(sa.sale_value, 0),
    'commission_rate',    COALESCE(cs.struct_rate, sa.avg_rate, a.commission_percent, 0),
    'commission_earned',  COALESCE(a.total_commission_earned, 0),
    'commission_paid',    COALESCE(a.total_commission_paid, 0),
    'commission_pending', COALESCE(a.total_commission_pending, 0)
  ) ORDER BY COALESCE(sa.sale_value, 0) DESC), '[]'::jsonb)
  FROM public.agents a
  LEFT JOIN sale_agg sa ON sa.agent_id = a.id
  LEFT JOIN cs            ON cs.agent_id = a.id
  WHERE a.company_id = p_company_id
    AND (sa.sales_count > 0 OR a.status = 'active');
$$;

-- 3) Project summary — per-project unit & financial roll-up
CREATE OR REPLACE FUNCTION public.get_project_summary(
  p_company_id uuid, p_project_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH unit_stats AS (
    SELECT u.project_id,
      count(*)                                                                    AS total_units,
      count(*) FILTER (WHERE st.status_name ILIKE 'available')                    AS available_units,
      count(*) FILTER (WHERE st.status_name ILIKE ANY (ARRAY['sold','booked','on installment','possession given','mortgaged'])) AS sold_units,
      count(*) FILTER (WHERE st.status_name ILIKE ANY (ARRAY['reserved','on hold']))              AS reserved_units
    FROM public.units u
    LEFT JOIN public.category_unit_statuses st ON st.id = u.status_id
    WHERE u.company_id = p_company_id
      AND (p_project_id IS NULL OR u.project_id = p_project_id)
    GROUP BY u.project_id
  ),
  sale_stats AS (
    SELECT COALESCE(s.project_id, u.project_id) AS project_id,
           SUM(s.net_amount) AS total_sale_value,
           SUM(pay.paid)     AS total_collected
    FROM public.sales s
    LEFT JOIN public.units u ON u.id = s.unit_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(p.amount), 0) AS paid
      FROM public.payments p
      WHERE p.sale_id = s.id AND p.company_id = s.company_id AND p.status IN ('received','cleared')
    ) pay ON true
    WHERE s.company_id = p_company_id AND s.status <> 'cancelled'
      AND (p_project_id IS NULL OR COALESCE(s.project_id, u.project_id) = p_project_id)
    GROUP BY COALESCE(s.project_id, u.project_id)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'project_name',      pr.project_name,
    'total_units',       COALESCE(us.total_units, 0),
    'sold_units',        COALESCE(us.sold_units, 0),
    'available_units',   COALESCE(us.available_units, 0),
    'reserved_units',    COALESCE(us.reserved_units, 0),
    'total_sale_value',  COALESCE(ss.total_sale_value, 0),
    'total_collected',   COALESCE(ss.total_collected, 0),
    'total_outstanding', GREATEST(0, COALESCE(ss.total_sale_value, 0) - COALESCE(ss.total_collected, 0)),
    'collection_pct',    CASE WHEN COALESCE(ss.total_sale_value, 0) > 0
                              THEN ROUND((COALESCE(ss.total_collected, 0) / ss.total_sale_value) * 100, 1)
                              ELSE 0 END
  ) ORDER BY pr.project_name), '[]'::jsonb)
  FROM public.projects pr
  LEFT JOIN unit_stats us ON us.project_id = pr.id
  LEFT JOIN sale_stats ss ON ss.project_id = pr.id
  WHERE pr.company_id = p_company_id
    AND (p_project_id IS NULL OR pr.id = p_project_id);
$$;

-- 4) Tax / WHT report — per-sale WHT + CVT (filer status default 'unknown')
CREATE OR REPLACE FUNCTION public.get_tax_wht_report(
  p_company_id uuid, p_project_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'sale_number',  s.sale_number,
    'sale_date',    s.sale_date,
    'buyer_name',   c.full_name,
    'sale_value',   s.net_amount,
    'wht_amount',   COALESCE(s.wht_amount, 0),
    'cvt_amount',   COALESCE(s.cvt_amount, 0),
    'wht_rate_pct', CASE WHEN COALESCE(s.net_amount, 0) > 0
                         THEN ROUND((COALESCE(s.wht_amount, 0) / s.net_amount) * 100, 2)
                         ELSE 0 END,
    'filer_status', 'unknown'
  ) ORDER BY s.sale_date DESC NULLS LAST), '[]'::jsonb)
  FROM public.sales s
  LEFT JOIN public.units   u ON u.id = s.unit_id
  LEFT JOIN public.clients c ON c.id = s.client_id
  WHERE s.company_id = p_company_id
    AND s.status <> 'cancelled'
    AND (p_project_id IS NULL OR COALESCE(s.project_id, u.project_id) = p_project_id)
    AND (COALESCE(s.wht_amount, 0) > 0 OR COALESCE(s.cvt_amount, 0) > 0);
$$;

-- 5) Post-possession dues — units handed over but still owing
--    (Renamed to get_post_possession_dues_report by the follow-up migration
--     to avoid collision with the pre-existing 1-arg get_post_possession_dues
--     that powers js/pages/possession.js.)
CREATE OR REPLACE FUNCTION public.get_post_possession_dues(
  p_company_id uuid, p_project_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'unit_number',                u.unit_no,
    'project_name',               pr.project_name,
    'buyer_name',                 c.full_name,
    'possession_date',            u.possession_date,
    'total_outstanding',          ist.total_outstanding,
    'overdue_installments_count', ist.overdue_count,
    'last_payment_date',          pay.last_payment_date
  ) ORDER BY ist.total_outstanding DESC NULLS LAST), '[]'::jsonb)
  FROM public.units u
  JOIN public.sales s   ON s.unit_id = u.id AND s.company_id = u.company_id AND s.status <> 'cancelled'
  LEFT JOIN public.clients  c  ON c.id = s.client_id
  LEFT JOIN public.projects pr ON pr.id = u.project_id
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(SUM(GREATEST(0, COALESCE(i.outstanding, i.amount_due - COALESCE(i.amount_paid,0)))), 0) AS total_outstanding,
      COUNT(*) FILTER (
        WHERE i.due_date < CURRENT_DATE
          AND COALESCE(i.outstanding, i.amount_due - COALESCE(i.amount_paid,0)) > 0
      ) AS overdue_count
    FROM public.installments i WHERE i.sale_id = s.id
  ) ist ON true
  LEFT JOIN LATERAL (
    SELECT MAX(payment_date) AS last_payment_date
    FROM public.payments
    WHERE sale_id = s.id AND status IN ('received','cleared')
  ) pay ON true
  WHERE u.company_id = p_company_id
    AND u.possession_date IS NOT NULL
    AND (p_project_id IS NULL OR u.project_id = p_project_id)
    AND ist.total_outstanding > 0;
$$;

-- 6) Legal portfolio — active legal cases
CREATE OR REPLACE FUNCTION public.get_legal_portfolio(
  p_company_id uuid, p_project_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'case_number',        lc.case_number,
    'case_type',          lc.case_type,
    'filed_date',         lc.filed_date,
    'client_name',        c.full_name,
    'unit_number',        u.unit_no,
    'outstanding_amount', COALESCE(lc.claim_amount,
                            GREATEST(0, COALESCE(s.net_amount, 0)
                              - COALESCE((SELECT SUM(amount) FROM public.payments
                                          WHERE sale_id = s.id AND company_id = s.company_id
                                            AND status IN ('received','cleared')), 0))),
    'status',             COALESCE(lc.stage, 'active'),
    'assigned_lawyer',    lc.lawyer_name,
    'next_hearing_date',  lc.next_hearing_date
  ) ORDER BY lc.filed_date DESC NULLS LAST), '[]'::jsonb)
  FROM public.legal_cases lc
  LEFT JOIN public.clients c ON c.id = lc.client_id
  LEFT JOIN public.sales   s ON s.id = lc.sale_id
  LEFT JOIN public.units   u ON u.id = COALESCE(lc.unit_id, s.unit_id)
  WHERE lc.company_id = p_company_id
    AND (lc.outcome IS NULL OR lc.outcome NOT IN ('closed','dismissed','settled','withdrawn'))
    AND (p_project_id IS NULL OR COALESCE(lc.project_id, s.project_id, u.project_id) = p_project_id);
$$;

-- 7) Executive KPIs — single summary object (returned as 1-element jsonb array)
CREATE OR REPLACE FUNCTION public.get_executive_kpis(
  p_company_id uuid, p_project_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH
  mtd_start AS (SELECT date_trunc('month', CURRENT_DATE)::date AS d),
  s_filtered AS (
    SELECT s.*, COALESCE(s.project_id, u.project_id) AS eff_project_id
    FROM public.sales s LEFT JOIN public.units u ON u.id = s.unit_id
    WHERE s.company_id = p_company_id
      AND (p_project_id IS NULL OR COALESCE(s.project_id, u.project_id) = p_project_id)
  ),
  i_filtered AS (
    SELECT i.* FROM public.installments i
    JOIN s_filtered sf ON sf.id = i.sale_id
    WHERE i.company_id = p_company_id
  ),
  p_filtered AS (
    SELECT p.*, sf.eff_project_id FROM public.payments p
    JOIN s_filtered sf ON sf.id = p.sale_id
    WHERE p.company_id = p_company_id AND p.status IN ('received','cleared')
  ),
  bookings_mtd     AS (SELECT count(*) AS cnt FROM s_filtered
                        WHERE sale_date >= (SELECT d FROM mtd_start) AND sale_date <= CURRENT_DATE
                          AND status <> 'cancelled'),
  sales_mtd        AS (SELECT count(*) AS cnt, COALESCE(SUM(net_amount),0) AS amt FROM s_filtered
                        WHERE sale_date >= (SELECT d FROM mtd_start) AND sale_date <= CURRENT_DATE
                          AND status <> 'cancelled'),
  cancels_mtd      AS (SELECT count(*) AS cnt FROM s_filtered
                        WHERE status = 'cancelled'
                          AND COALESCE(cancellation_date, sale_date) >= (SELECT d FROM mtd_start)),
  collected_mtd    AS (SELECT COALESCE(SUM(amount),0) AS amt FROM p_filtered
                        WHERE payment_date >= (SELECT d FROM mtd_start) AND payment_date <= CURRENT_DATE),
  billed_mtd       AS (SELECT COALESCE(SUM(amount_due),0) AS amt FROM i_filtered
                        WHERE due_date >= (SELECT d FROM mtd_start) AND due_date <= CURRENT_DATE),
  outstanding_all  AS (SELECT COALESCE(SUM(GREATEST(0, COALESCE(outstanding, amount_due - COALESCE(amount_paid,0)))),0) AS amt FROM i_filtered),
  overdue          AS (SELECT count(*) AS cnt FROM i_filtered
                        WHERE due_date < CURRENT_DATE
                          AND COALESCE(outstanding, amount_due - COALESCE(amount_paid,0)) > 0),
  top_proj         AS (SELECT pr.project_name, SUM(pf.amount) AS amt
                        FROM p_filtered pf
                        JOIN public.projects pr ON pr.id = pf.eff_project_id
                        WHERE pf.payment_date >= (SELECT d FROM mtd_start) AND pf.payment_date <= CURRENT_DATE
                        GROUP BY pr.project_name ORDER BY amt DESC LIMIT 1)
  SELECT jsonb_build_array(jsonb_build_object(
    'total_sales_mtd',           (SELECT cnt FROM sales_mtd),
    'total_sales_value_mtd',     (SELECT amt FROM sales_mtd),
    'total_collected_mtd',       (SELECT amt FROM collected_mtd),
    'total_outstanding_all',     (SELECT amt FROM outstanding_all),
    'overdue_count',             (SELECT cnt FROM overdue),
    'cancellations_mtd',         (SELECT cnt FROM cancels_mtd),
    'new_bookings_mtd',          (SELECT cnt FROM bookings_mtd),
    'collection_efficiency_pct', CASE WHEN (SELECT amt FROM billed_mtd) > 0
                                      THEN ROUND(((SELECT amt FROM collected_mtd) / NULLIF((SELECT amt FROM billed_mtd),0)) * 100, 1)
                                      ELSE 0 END,
    'top_performing_project',    COALESCE((SELECT project_name FROM top_proj), '—')
  ));
$$;

-- 8) Monthly collection trend — last 12 months, billed vs collected
CREATE OR REPLACE FUNCTION public.get_monthly_collection_trend(
  p_company_id uuid, p_project_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH months AS (
    SELECT date_trunc('month', CURRENT_DATE - (n || ' months')::interval)::date AS m
    FROM generate_series(0, 11) AS n
  ),
  s_filtered AS (
    SELECT s.id FROM public.sales s LEFT JOIN public.units u ON u.id = s.unit_id
    WHERE s.company_id = p_company_id
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
$$;

GRANT EXECUTE ON FUNCTION public.get_aging_report(uuid,uuid)              TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_commission_report(uuid,uuid)         TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_project_summary(uuid,uuid)           TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_tax_wht_report(uuid,uuid)            TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_post_possession_dues(uuid,uuid)      TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_legal_portfolio(uuid,uuid)           TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_executive_kpis(uuid,uuid)            TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_monthly_collection_trend(uuid,uuid)  TO anon, authenticated, service_role;
