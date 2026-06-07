-- ================================================================
-- NEXUNOVA RMS — GRAND RECOVERY POSITION v3 (FROM/TO date range)
-- 2026-06-08 — replaces the v2 as-of-date signature with an explicit
-- [p_from_date, p_to_date] window. DROP the old (uuid,uuid,date) signature
-- first (otherwise a 3-arg call is ambiguous against the new 4-arg/defaulted fn).
--
-- Window semantics (period = [from, to]):
--   • old              = regular dues with due_date <  from   (minus payments < from)
--   • recd_old (dead)  = payments in [from,to] against pre-from dues
--   • month_installment= regular dues with due_date in [from,to]   (JSON key kept for compat)
--   • recd_current     = payments in [from,to] against in-period dues
--   • dp_received      = DP payments with payment_date <= to
--   • paid_pct         = all non-cancelled payments <= to ÷ net_amount
--   • officer_summary  = recovery (regular only) in [from,to], dead vs current by due_date
--   • recovery_pct     = (recd_old+recd_current) / (old_outstanding+month_installment)
--   • pdc_in_hand / flag_legal — unchanged (current snapshot)
--
-- Return shape unchanged: { rows:[...], officer_summary:[...], totals:{...} }.
-- Verified 2026-06-08 on ADMIN seed: from=2026-06-01,to=2026-06-07 reproduces v2
-- exactly; from=2026-03-01,to=2026-06-07 matches hand-computed buckets.
-- ================================================================

DROP FUNCTION IF EXISTS public.get_recovery_position(uuid, uuid, date);

CREATE OR REPLACE FUNCTION public.get_recovery_position(
  p_company_id uuid,
  p_project_id uuid  DEFAULT NULL,
  p_from_date  date  DEFAULT date_trunc('month', CURRENT_DATE)::date,
  p_to_date    date  DEFAULT CURRENT_DATE
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_from   date := p_from_date;
  v_to     date := p_to_date;
  v_result jsonb;
BEGIN
  WITH
  dp AS (
    SELECT i.sale_id, COALESCE(SUM(i.amount_due),0) AS dp_total
    FROM public.installments i
    WHERE i.company_id = p_company_id
      AND (COALESCE(i.installment_type,'') = 'down_payment' OR COALESCE(i.installment_number,-1) = 0)
    GROUP BY i.sale_id
  ),
  dp_pay AS (
    SELECT i.sale_id, COALESCE(SUM(p.amount),0) AS dp_received
    FROM public.installments i
    JOIN public.payments p ON p.installment_id = i.id AND p.company_id = i.company_id
    WHERE i.company_id = p_company_id
      AND (COALESCE(i.installment_type,'') = 'down_payment' OR COALESCE(i.installment_number,-1) = 0)
      AND p.status <> 'cancelled'
      AND p.payment_date <= v_to
    GROUP BY i.sale_id
  ),
  old_due AS (
    SELECT i.sale_id, COALESCE(SUM(i.amount_due),0) AS amt
    FROM public.installments i
    WHERE i.company_id = p_company_id
      AND NOT (COALESCE(i.installment_type,'') = 'down_payment' OR COALESCE(i.installment_number,-1) = 0)
      AND i.due_date < v_from
    GROUP BY i.sale_id
  ),
  old_pay_before AS (
    SELECT i.sale_id, COALESCE(SUM(p.amount),0) AS amt
    FROM public.installments i
    JOIN public.payments p ON p.installment_id = i.id AND p.company_id = i.company_id
    WHERE i.company_id = p_company_id
      AND NOT (COALESCE(i.installment_type,'') = 'down_payment' OR COALESCE(i.installment_number,-1) = 0)
      AND i.due_date < v_from
      AND p.status <> 'cancelled'
      AND p.payment_date < v_from
    GROUP BY i.sale_id
  ),
  old_pay_in_period AS (
    SELECT i.sale_id, COALESCE(SUM(p.amount),0) AS amt
    FROM public.installments i
    JOIN public.payments p ON p.installment_id = i.id AND p.company_id = i.company_id
    WHERE i.company_id = p_company_id
      AND NOT (COALESCE(i.installment_type,'') = 'down_payment' OR COALESCE(i.installment_number,-1) = 0)
      AND i.due_date < v_from
      AND p.status <> 'cancelled'
      AND p.payment_date BETWEEN v_from AND v_to
    GROUP BY i.sale_id
  ),
  cur_due AS (
    SELECT i.sale_id, COALESCE(SUM(i.amount_due),0) AS amt
    FROM public.installments i
    WHERE i.company_id = p_company_id
      AND NOT (COALESCE(i.installment_type,'') = 'down_payment' OR COALESCE(i.installment_number,-1) = 0)
      AND i.due_date BETWEEN v_from AND v_to
    GROUP BY i.sale_id
  ),
  cur_pay AS (
    SELECT i.sale_id, COALESCE(SUM(p.amount),0) AS amt
    FROM public.installments i
    JOIN public.payments p ON p.installment_id = i.id AND p.company_id = i.company_id
    WHERE i.company_id = p_company_id
      AND NOT (COALESCE(i.installment_type,'') = 'down_payment' OR COALESCE(i.installment_number,-1) = 0)
      AND i.due_date BETWEEN v_from AND v_to
      AND p.status <> 'cancelled'
      AND p.payment_date BETWEEN v_from AND v_to
    GROUP BY i.sale_id
  ),
  last_pay AS (
    SELECT p.sale_id, MAX(p.payment_date) AS last_dt
    FROM public.payments p
    WHERE p.company_id = p_company_id AND p.status <> 'cancelled' AND p.payment_date <= v_to
    GROUP BY p.sale_id
  ),
  total_pay AS (
    SELECT p.sale_id, COALESCE(SUM(p.amount),0) AS paid
    FROM public.payments p
    WHERE p.company_id = p_company_id AND p.status <> 'cancelled' AND p.payment_date <= v_to
    GROUP BY p.sale_id
  ),
  pdc_hand AS (
    SELECT pc.sale_id, COALESCE(SUM(pc.amount),0) AS pdc_amt
    FROM public.pdc_cheques pc
    WHERE pc.company_id = p_company_id AND lower(pc.status) IN ('pending','presented')
    GROUP BY pc.sale_id
  ),
  rowsrc AS (
    SELECT
      s.id AS sale_id,
      cl.client_code,
      cl.full_name AS client_name,
      u.unit_no,
      COALESCE(fl.name, NULLIF(u.floor_label,''), u.floor_no::text) AS floor_name,
      ut.type_name AS category_name,
      s.sale_date     AS reg_date,
      s.area_sqft     AS area,
      s.price_per_sqft AS unit_rate,
      s.total_amount  AS total_price,
      s.discount,
      s.net_amount    AS net_price,
      COALESCE(dp.dp_total,0)                              AS dp_total,
      COALESCE(dp_pay.dp_received,0)                       AS dp_received,
      COALESCE(dp.dp_total,0) - COALESCE(dp_pay.dp_received,0) AS dp_remaining,
      (COALESCE(old_due.amt,0) - COALESCE(old_pay_before.amt,0)) AS old_outstanding,
      COALESCE(old_pay_in_period.amt,0)                   AS recd_old,
      ((COALESCE(old_due.amt,0) - COALESCE(old_pay_before.amt,0)) - COALESCE(old_pay_in_period.amt,0)) AS outstanding_old_net,
      COALESCE(cur_due.amt,0)                             AS month_installment,
      COALESCE(cur_pay.amt,0)                             AS recd_current,
      (((COALESCE(old_due.amt,0) - COALESCE(old_pay_before.amt,0)) - COALESCE(old_pay_in_period.amt,0))
        + COALESCE(cur_due.amt,0) - COALESCE(cur_pay.amt,0)) AS net_outstanding,
      lp.last_dt                                          AS last_payment_date,
      COALESCE(ph.pdc_amt,0)                              AS pdc_in_hand,
      COALESCE(ROUND(COALESCE(tp.paid,0) / NULLIF(s.net_amount,0) * 100, 1), 0) AS paid_pct,
      ( EXISTS (SELECT 1 FROM public.legal_cases lc
                 WHERE lc.company_id = p_company_id
                   AND (lc.sale_id = s.id OR lc.client_id = s.client_id)
                   AND lc.outcome IS NULL
                   AND lower(lc.stage) NOT IN ('settled','closed'))
        OR EXISTS (SELECT 1 FROM public.escalations e
                 WHERE e.company_id = p_company_id
                   AND (e.sale_id = s.id OR e.client_id = s.client_id)
                   AND lower(e.status) NOT IN ('resolved','closed','dismissed','cancelled')) ) AS flag_legal,
      ut.type_name                        AS ord_cat,
      COALESCE(fl.sort_order, u.floor_no) AS ord_floor,
      u.unit_no                           AS ord_unit
    FROM public.sales s
    JOIN      public.units    u  ON u.id = s.unit_id AND u.company_id = s.company_id
    LEFT JOIN public.floors   fl ON fl.id = u.floor_id AND fl.company_id = u.company_id
    LEFT JOIN public.clients  cl ON cl.id = s.client_id
    LEFT JOIN public.projects pr ON pr.id = s.project_id
    LEFT JOIN public.category_unit_types ut ON ut.id = u.unit_type_id
    LEFT JOIN dp                ON dp.sale_id = s.id
    LEFT JOIN dp_pay            ON dp_pay.sale_id = s.id
    LEFT JOIN old_due           ON old_due.sale_id = s.id
    LEFT JOIN old_pay_before    ON old_pay_before.sale_id = s.id
    LEFT JOIN old_pay_in_period ON old_pay_in_period.sale_id = s.id
    LEFT JOIN cur_due           ON cur_due.sale_id = s.id
    LEFT JOIN cur_pay           ON cur_pay.sale_id = s.id
    LEFT JOIN last_pay  lp ON lp.sale_id = s.id
    LEFT JOIN total_pay tp ON tp.sale_id = s.id
    LEFT JOIN pdc_hand  ph ON ph.sale_id = s.id
    WHERE s.company_id = p_company_id
      AND s.status <> 'cancelled'
      AND COALESCE(s.is_active, s.status = 'active')
      AND (p_project_id IS NULL OR s.project_id = p_project_id)
  ),
  officer AS (
    SELECT
      COALESCE(au.full_name, NULLIF(p.created_by,''), 'Unassigned') AS officer_name,
      COALESCE(SUM(p.amount) FILTER (WHERE i.due_date <  v_from), 0) AS dead_recovery_total,
      COALESCE(SUM(p.amount) FILTER (WHERE i.due_date BETWEEN v_from AND v_to), 0) AS current_recovery_total
    FROM public.payments p
    JOIN public.installments i ON i.id = p.installment_id AND i.company_id = p.company_id
    JOIN public.sales s ON s.id = p.sale_id AND s.company_id = p.company_id
    LEFT JOIN public.app_users au
      ON au.id = CASE WHEN p.created_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                      THEN p.created_by::uuid END
    WHERE p.company_id = p_company_id
      AND p.status <> 'cancelled'
      AND NOT (COALESCE(i.installment_type,'') = 'down_payment' OR COALESCE(i.installment_number,-1) = 0)
      AND p.payment_date BETWEEN v_from AND v_to
      AND s.status <> 'cancelled'
      AND COALESCE(s.is_active, s.status = 'active')
      AND (p_project_id IS NULL OR s.project_id = p_project_id)
    GROUP BY 1
    HAVING COALESCE(SUM(p.amount) FILTER (WHERE i.due_date <  v_from), 0)
         + COALESCE(SUM(p.amount) FILTER (WHERE i.due_date BETWEEN v_from AND v_to), 0) <> 0
  )
  SELECT jsonb_build_object(
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'client_code',         client_code,
        'client_name',         client_name,
        'unit_no',             unit_no,
        'floor_name',          floor_name,
        'category_name',       category_name,
        'reg_date',            reg_date,
        'area',                area,
        'unit_rate',           unit_rate,
        'total_price',         total_price,
        'discount',            discount,
        'net_price',           net_price,
        'dp_total',            dp_total,
        'dp_received',         dp_received,
        'dp_remaining',        dp_remaining,
        'old_outstanding',     old_outstanding,
        'recd_old',            recd_old,
        'outstanding_old_net', outstanding_old_net,
        'month_installment',   month_installment,
        'recd_current',        recd_current,
        'net_outstanding',     net_outstanding,
        'last_payment_date',   to_char(last_payment_date, 'YYYY-MM-DD'),
        'pdc_in_hand',         pdc_in_hand,
        'paid_pct',            paid_pct,
        'flag_legal',          flag_legal
      ) ORDER BY ord_cat NULLS LAST, ord_floor NULLS LAST, ord_unit)
      FROM rowsrc), '[]'::jsonb),
    'officer_summary', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'officer_name',           officer_name,
        'dead_recovery_total',    dead_recovery_total,
        'current_recovery_total', current_recovery_total
      ) ORDER BY (dead_recovery_total + current_recovery_total) DESC, officer_name)
      FROM officer), '[]'::jsonb),
    'totals', (
      SELECT jsonb_build_object(
        'dp_total',            COALESCE(SUM(dp_total),0),
        'dp_received',         COALESCE(SUM(dp_received),0),
        'dp_remaining',        COALESCE(SUM(dp_remaining),0),
        'old_outstanding',     COALESCE(SUM(old_outstanding),0),
        'recd_old',            COALESCE(SUM(recd_old),0),
        'outstanding_old_net', COALESCE(SUM(outstanding_old_net),0),
        'month_installment',   COALESCE(SUM(month_installment),0),
        'recd_current',        COALESCE(SUM(recd_current),0),
        'net_outstanding',     COALESCE(SUM(net_outstanding),0),
        'pdc_in_hand',         COALESCE(SUM(pdc_in_hand),0),
        'total_price',         COALESCE(SUM(total_price),0),
        'net_price',           COALESCE(SUM(net_price),0),
        'row_count',           COUNT(*),
        'recovery_pct',        COALESCE(ROUND(
                                 (COALESCE(SUM(recd_old),0) + COALESCE(SUM(recd_current),0))
                                 / NULLIF(COALESCE(SUM(old_outstanding),0) + COALESCE(SUM(month_installment),0), 0)
                                 * 100, 1), 0)
      )
      FROM rowsrc)
  )
  INTO v_result;

  RETURN COALESCE(v_result, jsonb_build_object('rows','[]'::jsonb,'officer_summary','[]'::jsonb,'totals','{}'::jsonb));
END
$function$;

REVOKE ALL ON FUNCTION public.get_recovery_position(uuid, uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_recovery_position(uuid, uuid, date, date) TO anon, authenticated;
