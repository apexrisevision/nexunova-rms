-- ================================================================
-- NEXUNOVA RMS — GRAND RECOVERY POSITION REPORT v2
-- 2026-06-08 — CREATE OR REPLACE get_recovery_position(p_company_id, p_project_id, p_as_of_date)
--
-- Extends the v1 RPC (migration 20260607_get_recovery_position.sql — DO NOT edit
-- that file) with 6 additions. RETURN SHAPE CHANGES from a jsonb ARRAY to a jsonb
-- OBJECT: { rows:[...], officer_summary:[...], totals:{...} }.
-- Every existing per-row field name is preserved verbatim (backward-compatible
-- row contract); 4 new per-row fields are appended.
--
-- ADDITIONS
--  1. rows[].last_payment_date — MAX(payment_date) of non-cancelled payments for
--     the sale (any bucket), capped at <= v_month_end for as-of consistency.
--     'YYYY-MM-DD' text, null when never paid (frontend shows "Never").
--  2. rows[].pdc_in_hand — SUM(amount) of the sale's PDC cheques still IN HAND.
--     "In hand" = status IN ('pending','presented'); terminal 'cleared'/'bounced'
--     excluded (confirmed from create_pdc_cheque default 'pending' + mark_pdc_*:
--     deposited->'presented', cleared->'cleared', bounced->'bounced'). 0 if none.
--  3. rows[].paid_pct — SUM(non-cancelled payments, payment_date<=v_month_end,
--     all buckets incl. DP) / net_amount * 100, ROUND 1dp, guarded (net=0 -> 0).
--  4. rows[].flag_legal — true if an OPEN legal case OR OPEN escalation exists for
--     the sale or its client. Legal "open" = outcome IS NULL AND stage NOT IN
--     ('settled','closed') (legal_cases.stage CHECK = pre_legal/notice_sent/filed/
--     hearing/judgment/appeal/settled/closed; no status col). Escalation "open" =
--     lower(status) NOT IN ('resolved','closed','dismissed','cancelled')
--     (escalations.status CHECK = open/acknowledged/resolved/closed → open &
--     acknowledged count). Matched by (sale_id = s.id OR client_id = s.client_id).
--  5. officer_summary[] — per recovery officer for the current-month window:
--     officer_name, dead_recovery_total (in-month payments vs OLD-due regular
--     installments), current_recovery_total (in-month payments vs CURRENT-month
--     regular installments). DP excluded (not recovery). ATTRIBUTION: payments
--     have no dedicated collecting-officer column; user_project_assignments is
--     user<->project (not per-payment) and recovery_agents is a separate registry.
--     The only clean per-payment actor is payments.created_by (a uuid-as-text set
--     by record_payment's p_created_by). So we attribute by created_by ->
--     app_users.full_name, falling back to the raw created_by text, else
--     'Unassigned'. Same company/project/active-sale scope as rows.
--  6. totals{} — company-level sums of every bucket (+ pdc_in_hand, total_price,
--     net_price, row_count) and recovery_pct = (recd_old + recd_current) /
--     NULLIF(old_outstanding + month_installment, 0) * 100, ROUND 1dp.
--
-- SECURITY DEFINER, search_path=public, company-scoped, granted to anon +
-- authenticated (report viewer uses anon key, no session — no _rms_caller check).
-- Verified 2026-06-08 via seed->verify->cleanup on the ADMIN test company; all
-- additions matched hand-computed expectations.
-- ================================================================

CREATE OR REPLACE FUNCTION public.get_recovery_position(
  p_company_id uuid,
  p_project_id uuid DEFAULT NULL,
  p_as_of_date date DEFAULT CURRENT_DATE
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_month_start date := date_trunc('month', p_as_of_date)::date;
  v_month_end   date := (date_trunc('month', p_as_of_date) + interval '1 month' - interval '1 day')::date;
  v_result      jsonb;
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
      AND p.payment_date <= v_month_end
    GROUP BY i.sale_id
  ),
  old_due AS (
    SELECT i.sale_id, COALESCE(SUM(i.amount_due),0) AS amt
    FROM public.installments i
    WHERE i.company_id = p_company_id
      AND NOT (COALESCE(i.installment_type,'') = 'down_payment' OR COALESCE(i.installment_number,-1) = 0)
      AND i.due_date < v_month_start
    GROUP BY i.sale_id
  ),
  old_pay_before AS (
    SELECT i.sale_id, COALESCE(SUM(p.amount),0) AS amt
    FROM public.installments i
    JOIN public.payments p ON p.installment_id = i.id AND p.company_id = i.company_id
    WHERE i.company_id = p_company_id
      AND NOT (COALESCE(i.installment_type,'') = 'down_payment' OR COALESCE(i.installment_number,-1) = 0)
      AND i.due_date < v_month_start
      AND p.status <> 'cancelled'
      AND p.payment_date < v_month_start
    GROUP BY i.sale_id
  ),
  old_pay_in_month AS (
    SELECT i.sale_id, COALESCE(SUM(p.amount),0) AS amt
    FROM public.installments i
    JOIN public.payments p ON p.installment_id = i.id AND p.company_id = i.company_id
    WHERE i.company_id = p_company_id
      AND NOT (COALESCE(i.installment_type,'') = 'down_payment' OR COALESCE(i.installment_number,-1) = 0)
      AND i.due_date < v_month_start
      AND p.status <> 'cancelled'
      AND p.payment_date BETWEEN v_month_start AND v_month_end
    GROUP BY i.sale_id
  ),
  cur_due AS (
    SELECT i.sale_id, COALESCE(SUM(i.amount_due),0) AS amt
    FROM public.installments i
    WHERE i.company_id = p_company_id
      AND NOT (COALESCE(i.installment_type,'') = 'down_payment' OR COALESCE(i.installment_number,-1) = 0)
      AND i.due_date BETWEEN v_month_start AND v_month_end
    GROUP BY i.sale_id
  ),
  cur_pay AS (
    SELECT i.sale_id, COALESCE(SUM(p.amount),0) AS amt
    FROM public.installments i
    JOIN public.payments p ON p.installment_id = i.id AND p.company_id = i.company_id
    WHERE i.company_id = p_company_id
      AND NOT (COALESCE(i.installment_type,'') = 'down_payment' OR COALESCE(i.installment_number,-1) = 0)
      AND i.due_date BETWEEN v_month_start AND v_month_end
      AND p.status <> 'cancelled'
      AND p.payment_date BETWEEN v_month_start AND v_month_end
    GROUP BY i.sale_id
  ),
  -- ADD 1: last non-cancelled payment date (<= month_end)
  last_pay AS (
    SELECT p.sale_id, MAX(p.payment_date) AS last_dt
    FROM public.payments p
    WHERE p.company_id = p_company_id AND p.status <> 'cancelled' AND p.payment_date <= v_month_end
    GROUP BY p.sale_id
  ),
  -- ADD 3 source: total non-cancelled paid to date (<= month_end), all buckets
  total_pay AS (
    SELECT p.sale_id, COALESCE(SUM(p.amount),0) AS paid
    FROM public.payments p
    WHERE p.company_id = p_company_id AND p.status <> 'cancelled' AND p.payment_date <= v_month_end
    GROUP BY p.sale_id
  ),
  -- ADD 2 source: PDC cheques still in hand
  pdc_hand AS (
    SELECT pc.sale_id, COALESCE(SUM(pc.amount),0) AS pdc_amt
    FROM public.pdc_cheques pc
    WHERE pc.company_id = p_company_id AND lower(pc.status) IN ('pending','presented')
    GROUP BY pc.sale_id
  ),
  -- Per-sale row source (numeric; jsonb + totals derived from this)
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
      COALESCE(old_pay_in_month.amt,0)                    AS recd_old,
      ((COALESCE(old_due.amt,0) - COALESCE(old_pay_before.amt,0)) - COALESCE(old_pay_in_month.amt,0)) AS outstanding_old_net,
      COALESCE(cur_due.amt,0)                             AS month_installment,
      COALESCE(cur_pay.amt,0)                             AS recd_current,
      (((COALESCE(old_due.amt,0) - COALESCE(old_pay_before.amt,0)) - COALESCE(old_pay_in_month.amt,0))
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
    LEFT JOIN dp               ON dp.sale_id = s.id
    LEFT JOIN dp_pay           ON dp_pay.sale_id = s.id
    LEFT JOIN old_due          ON old_due.sale_id = s.id
    LEFT JOIN old_pay_before   ON old_pay_before.sale_id = s.id
    LEFT JOIN old_pay_in_month ON old_pay_in_month.sale_id = s.id
    LEFT JOIN cur_due          ON cur_due.sale_id = s.id
    LEFT JOIN cur_pay          ON cur_pay.sale_id = s.id
    LEFT JOIN last_pay  lp ON lp.sale_id = s.id
    LEFT JOIN total_pay tp ON tp.sale_id = s.id
    LEFT JOIN pdc_hand  ph ON ph.sale_id = s.id
    WHERE s.company_id = p_company_id
      AND s.status <> 'cancelled'
      AND COALESCE(s.is_active, s.status = 'active')
      AND (p_project_id IS NULL OR s.project_id = p_project_id)
  ),
  -- ADD 5: officer recovery summary (regular-only, in-month), attributed by created_by
  officer AS (
    SELECT
      COALESCE(au.full_name, NULLIF(p.created_by,''), 'Unassigned') AS officer_name,
      COALESCE(SUM(p.amount) FILTER (WHERE i.due_date <  v_month_start), 0) AS dead_recovery_total,
      COALESCE(SUM(p.amount) FILTER (WHERE i.due_date BETWEEN v_month_start AND v_month_end), 0) AS current_recovery_total
    FROM public.payments p
    JOIN public.installments i ON i.id = p.installment_id AND i.company_id = p.company_id
    JOIN public.sales s ON s.id = p.sale_id AND s.company_id = p.company_id
    LEFT JOIN public.app_users au
      ON au.id = CASE WHEN p.created_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                      THEN p.created_by::uuid END
    WHERE p.company_id = p_company_id
      AND p.status <> 'cancelled'
      AND NOT (COALESCE(i.installment_type,'') = 'down_payment' OR COALESCE(i.installment_number,-1) = 0)
      AND p.payment_date BETWEEN v_month_start AND v_month_end
      AND s.status <> 'cancelled'
      AND COALESCE(s.is_active, s.status = 'active')
      AND (p_project_id IS NULL OR s.project_id = p_project_id)
    GROUP BY 1
    HAVING COALESCE(SUM(p.amount) FILTER (WHERE i.due_date <  v_month_start), 0)
         + COALESCE(SUM(p.amount) FILTER (WHERE i.due_date BETWEEN v_month_start AND v_month_end), 0) <> 0
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

REVOKE ALL ON FUNCTION public.get_recovery_position(uuid, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_recovery_position(uuid, uuid, date) TO anon, authenticated;
