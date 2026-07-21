-- get_recovery_position: reflect unit amount-shifts in the overdue/closing FIFO.
-- Completes the [[unit_amount_shift_feature]] balance integration — the last surface.
-- Adds a pay_all CTE (real payments + signed shift pseudo-payments: +to sale,
-- −from sale) feeding psum's p1/p2/paid_to, so the FIFO closing/overdue moves with
-- shifts (source overdue up, destination down). last_dt/last_amt stay on REAL
-- payments only (is_shift flag) so "last payment" display is unaffected. Applied
-- live via apply_migration; recorded here. Verified: 100k shift moved source
-- closing +100k, dest −100k; test row removed.
CREATE OR REPLACE FUNCTION public.get_recovery_position(p_company_id uuid, p_project_id uuid DEFAULT NULL::uuid, p_from_date date DEFAULT (date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone))::date, p_to_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_from date := p_from_date;
  v_to   date := p_to_date;
  v_cut  date := p_to_date - 90;
  v_result jsonb;
BEGIN
  WITH
  asale AS (
    SELECT s.id, s.client_id, s.unit_id, s.project_id,
           s.sale_date, s.area_sqft, s.price_per_sqft, s.discount,
           s.total_amount, s.net_amount
    FROM public.sales s
    WHERE s.company_id = p_company_id
      AND s.status <> 'cancelled'
      AND COALESCE(s.is_active, s.status='active')
      AND (p_project_id IS NULL OR s.project_id = p_project_id)
  ),
  pay_all AS (   -- real payments + amount-shifts as signed pseudo-payments (+to, −from)
    SELECT p.sale_id, p.amount, p.payment_date, false AS is_shift
    FROM public.payments p JOIN asale s ON s.id = p.sale_id
    WHERE p.company_id = p_company_id AND p.status <> 'cancelled'
    UNION ALL
    SELECT sh.to_sale_id, sh.amount, sh.shift_date, true
    FROM public.unit_amount_shifts sh JOIN asale s ON s.id = sh.to_sale_id
    WHERE sh.company_id = p_company_id
    UNION ALL
    SELECT sh.from_sale_id, -sh.amount, sh.shift_date, true
    FROM public.unit_amount_shifts sh JOIN asale s ON s.id = sh.from_sale_id
    WHERE sh.company_id = p_company_id
  ),
  psum AS (
    SELECT pa.sale_id,
      COALESCE(SUM(pa.amount) FILTER (WHERE pa.payment_date <  v_from),0)              AS p1,
      COALESCE(SUM(pa.amount) FILTER (WHERE pa.payment_date BETWEEN v_from AND v_to),0) AS p2,
      COALESCE(SUM(pa.amount) FILTER (WHERE pa.payment_date <= v_to),0)                AS paid_to,
      MAX(pa.payment_date)    FILTER (WHERE NOT pa.is_shift AND pa.payment_date <= v_to) AS last_dt
    FROM pay_all pa
    GROUP BY pa.sale_id
  ),
  last_amt AS (
    SELECT p.sale_id, SUM(p.amount) AS last_amt
    FROM public.payments p
    JOIN psum ps ON ps.sale_id = p.sale_id AND ps.last_dt = p.payment_date
    WHERE p.company_id = p_company_id AND p.status <> 'cancelled'
    GROUP BY p.sale_id
  ),
  lines AS (
    SELECT i.sale_id, i.due_date, i.amount_due::numeric AS due,
           (COALESCE(i.installment_type,'')='down_payment') AS is_dp,
           (i.due_date <  v_from)                  AS is_old,
           (i.due_date BETWEEN v_from AND v_to)    AS is_cur,
           SUM(i.amount_due) OVER (PARTITION BY i.sale_id
               ORDER BY i.due_date, i.installment_number
               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_incl
    FROM public.installments i
    JOIN asale s ON s.id = i.sale_id
    WHERE i.company_id = p_company_id AND i.due_date <= v_to
  ),
  perline AS (
    SELECT l.*,
      (l.cum_incl - l.due) AS prevcum,
      GREATEST(0, LEAST(l.due, COALESCE(ps.p1,0)                 - (l.cum_incl - l.due))) AS paid_pre,
      GREATEST(0, LEAST(l.due, COALESCE(ps.p1,0)+COALESCE(ps.p2,0) - (l.cum_incl - l.due))) AS paid_tot
    FROM lines l LEFT JOIN psum ps ON ps.sale_id = l.sale_id
  ),
  pl2 AS (
    SELECT pl.*, (paid_tot - paid_pre) AS paid_per,
           (due - paid_pre) AS unpaid_pre, (due - paid_tot) AS unpaid_tot
    FROM perline pl
  ),
  sale_agg AS (
    SELECT pl.sale_id,
      COALESCE(SUM(unpaid_pre) FILTER (WHERE is_old AND is_dp),0)            AS open_dp,
      COALESCE(SUM(unpaid_pre) FILTER (WHERE is_old AND NOT is_dp),0)        AS open_arr,
      COALESCE(SUM(due)        FILTER (WHERE is_cur),0)                      AS due_period,
      COALESCE(SUM(paid_per)   FILTER (WHERE is_dp),0)                       AS r_dp,
      COALESCE(SUM(paid_per)   FILTER (WHERE (NOT is_dp) AND is_old),0)      AS r_old,
      COALESCE(SUM(paid_per)   FILTER (WHERE (NOT is_dp) AND is_cur),0)      AS r_cur,
      COALESCE(SUM(paid_pre)   FILTER (WHERE is_cur),0)                      AS adv_bf,
      COALESCE(SUM(unpaid_tot) FILTER (WHERE is_dp),0)                       AS clo_dp,
      COALESCE(SUM(unpaid_tot) FILTER (WHERE (NOT is_dp) AND is_old),0)      AS clo_old,
      COALESCE(SUM(unpaid_tot) FILTER (WHERE (NOT is_dp) AND is_cur),0)      AS clo_cur,
      COALESCE(SUM(paid_per)   FILTER (WHERE due_date < v_cut),0)            AS dead_recovery,
      MIN(due_date) FILTER (WHERE unpaid_tot > 0.005)                        AS oldest_unpaid
    FROM pl2 pl GROUP BY pl.sale_id
  ),
  rowsrc AS (
    SELECT
      s.id AS sale_id, cl.client_code, cl.full_name AS client_name, cl.phone_primary AS phone,
      u.unit_no, COALESCE(fl.name, NULLIF(u.floor_label,''), u.floor_no::text) AS floor_name,
      ut.type_name AS unit_type,
      s.sale_date AS reg_date, s.area_sqft AS area, s.price_per_sqft AS unit_rate,
      s.discount, s.total_amount AS total_price, s.net_amount AS net_price,
      COALESCE(a.open_dp,0)  AS opening_dp,
      COALESCE(a.open_arr,0) AS opening_arrears,
      COALESCE(a.open_dp,0)+COALESCE(a.open_arr,0) AS opening,
      COALESCE(a.due_period,0) AS due_period,
      COALESCE(a.r_dp,0) AS r_dp, COALESCE(a.r_old,0) AS r_old, COALESCE(a.r_cur,0) AS r_cur,
      COALESCE(ps.p2,0) AS received_total,
      (COALESCE(ps.p2,0) - (COALESCE(a.r_dp,0)+COALESCE(a.r_old,0)+COALESCE(a.r_cur,0))) AS r_advance,
      (COALESCE(a.r_dp,0)+COALESCE(a.r_old,0)+COALESCE(a.r_cur,0)) AS received_applied,
      COALESCE(a.adv_bf,0) AS advance_bf,
      COALESCE(a.clo_dp,0) AS closing_dp, COALESCE(a.clo_old,0) AS closing_old, COALESCE(a.clo_cur,0) AS closing_current,
      COALESCE(a.clo_dp,0)+COALESCE(a.clo_old,0)+COALESCE(a.clo_cur,0) AS closing,
      COALESCE(ps.paid_to,0) AS paid_to_date,
      COALESCE(ROUND(COALESCE(ps.paid_to,0)/NULLIF(s.net_amount,0)*100,1),0) AS paid_pct,
      CASE WHEN a.oldest_unpaid IS NULL THEN NULL ELSE GREATEST(0,(v_to - a.oldest_unpaid)) END AS overdue_days,
      to_char(ps.last_dt,'YYYY-MM-DD') AS last_payment_date,
      COALESCE(la.last_amt,0) AS last_payment_amount,
      COALESCE(a.dead_recovery,0) AS dead_recovery
    FROM asale s
    JOIN      public.units   u  ON u.id = s.unit_id  AND u.company_id = p_company_id
    LEFT JOIN public.floors  fl ON fl.id = u.floor_id
    LEFT JOIN public.clients cl ON cl.id = s.client_id
    LEFT JOIN public.category_unit_types ut ON ut.id = u.unit_type_id
    LEFT JOIN sale_agg a  ON a.sale_id = s.id
    LEFT JOIN psum     ps ON ps.sale_id = s.id
    LEFT JOIN last_amt la ON la.sale_id = s.id
  )
  SELECT jsonb_build_object(
    'period', jsonb_build_object('from', to_char(v_from,'YYYY-MM-DD'), 'to', to_char(v_to,'YYYY-MM-DD')),
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.closing DESC, r.unit_no) FROM rowsrc r), '[]'::jsonb),
    'totals', (
      SELECT jsonb_build_object(
        'row_count',        COUNT(*),
        'net_price',        COALESCE(SUM(net_price),0),
        'total_price',      COALESCE(SUM(total_price),0),
        'opening',          COALESCE(SUM(opening),0),
        'opening_dp',       COALESCE(SUM(opening_dp),0),
        'opening_arrears',  COALESCE(SUM(opening_arrears),0),
        'due',              COALESCE(SUM(due_period),0),
        'received_total',   COALESCE(SUM(received_total),0),
        'received_applied', COALESCE(SUM(received_applied),0),
        'r_dp',             COALESCE(SUM(r_dp),0),
        'r_old',            COALESCE(SUM(r_old),0),
        'r_cur',            COALESCE(SUM(r_cur),0),
        'r_advance',        COALESCE(SUM(r_advance),0),
        'advance_bf',       COALESCE(SUM(advance_bf),0),
        'closing',          COALESCE(SUM(closing),0),
        'closing_dp',       COALESCE(SUM(closing_dp),0),
        'closing_old',      COALESCE(SUM(closing_old),0),
        'closing_current',  COALESCE(SUM(closing_current),0),
        'recovery_pct',     COALESCE(ROUND(SUM(received_total)/NULLIF(SUM(opening)+SUM(due_period),0)*100,1),0)
      ) FROM rowsrc),
    'officer_summary', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'officer_name', officer_name,
               'dead_recovery_total', dead_recovery_total,
               'current_recovery_total', current_recovery_total)
             ORDER BY (dead_recovery_total+current_recovery_total) DESC, officer_name)
      FROM (
        SELECT 'All Officers'::text AS officer_name,
               COALESCE(SUM(dead_recovery),0) AS dead_recovery_total,
               COALESCE(SUM(received_applied) - SUM(dead_recovery),0) AS current_recovery_total
        FROM rowsrc
        HAVING COALESCE(SUM(received_applied),0) <> 0
      ) o), '[]'::jsonb)
  ) INTO v_result;

  RETURN COALESCE(v_result, jsonb_build_object('rows','[]'::jsonb,'officer_summary','[]'::jsonb,'totals','{}'::jsonb));
END
$function$;
