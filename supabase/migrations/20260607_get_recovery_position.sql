-- ================================================================
-- NEXUNOVA RMS — GRAND RECOVERY POSITION REPORT BACKEND
-- 2026-06-07 — get_recovery_position(p_company_id, p_project_id, p_as_of_date)
--
--   One row per ACTIVE sale, with DP / old-due / current-month buckets
--   derived from the installments + payments tables (audit 2026-06-07).
--
--   Buckets (per audit):
--     • DP rows      : installment_type='down_payment' OR installment_number=0
--     • Regular rows : everything else
--     • Payments     : joined via payments.installment_id, ALWAYS excluding
--                      status='cancelled'
--   NULL-safe: both bucket predicates are COALESCE-guarded so a regular row
--   with a NULL installment_type is NOT silently dropped by 3-valued logic.
--
--   Date windows derived from p_as_of_date:
--     v_month_start = date_trunc('month', p_as_of_date)
--     v_month_end   = last calendar day of that month
--     "old"     = due_date < v_month_start
--     "current" = due_date BETWEEN v_month_start AND v_month_end
--
--   dp_remaining is reported as a SEPARATE bucket and is intentionally NOT
--   folded into net_outstanding (per the approved sample layout).
--
--   Follows the get_outstanding_report / get_unit_inventory report family:
--   SECURITY DEFINER, search_path=public, company-scoped, returns a jsonb
--   array of row-objects, granted to anon + authenticated (the report viewer
--   uses the anon key with no session — NO _rms_caller/session check here).
--
-- ✅ APPLIED 2026-06-07 to the RMS project (itqxljtfbrppntgyfush) via MCP after
--     confirming the MCP target (get_project_url + list_tables showed RMS tables,
--     no NexuAttend tables). Flagged columns resolved against the live schema:
--       • clients.client_code  → EXISTS (kept)
--       • sales total price     → column is sales.total_amount (NOT total_price); fixed
--       • floor name            → joins public.floors.name (canonical), falls back to
--                                 floor_label / floor_no; ordered by floors.sort_order
--     VERIFY status: smoke / window-shift / project-filter / EXPLAIN ran clean.
--     The two data-driven checks (hand-computed buckets, cancelled-payment toggle)
--     COULD NOT produce real numbers — the RMS DB is empty (post-2026-06-02 wipe:
--     sales/installments/payments/units/floors = 0 rows). Re-run them once a tenant
--     has live sales, or seed a temporary test sale.
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
  -- ── DP totals per sale (amount_due of DP rows) ──
  dp AS (
    SELECT i.sale_id, COALESCE(SUM(i.amount_due),0) AS dp_total
    FROM public.installments i
    WHERE i.company_id = p_company_id
      AND (COALESCE(i.installment_type,'') = 'down_payment' OR COALESCE(i.installment_number,-1) = 0)
    GROUP BY i.sale_id
  ),
  -- ── DP received: payments on DP rows, payment_date <= month_end ──
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
  -- ── OLD regular installments due before this month (amount_due) ──
  old_due AS (
    SELECT i.sale_id, COALESCE(SUM(i.amount_due),0) AS amt
    FROM public.installments i
    WHERE i.company_id = p_company_id
      AND NOT (COALESCE(i.installment_type,'') = 'down_payment' OR COALESCE(i.installment_number,-1) = 0)
      AND i.due_date < v_month_start
    GROUP BY i.sale_id
  ),
  -- ── Payments on OLD regular rows received BEFORE this month ──
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
  -- ── Payments on OLD regular rows received DURING this month (dead recovery) ──
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
  -- ── CURRENT-month regular installments (amount_due) ──
  cur_due AS (
    SELECT i.sale_id, COALESCE(SUM(i.amount_due),0) AS amt
    FROM public.installments i
    WHERE i.company_id = p_company_id
      AND NOT (COALESCE(i.installment_type,'') = 'down_payment' OR COALESCE(i.installment_number,-1) = 0)
      AND i.due_date BETWEEN v_month_start AND v_month_end
    GROUP BY i.sale_id
  ),
  -- ── Payments on CURRENT-month regular rows received DURING this month ──
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
  )
  SELECT COALESCE(jsonb_agg(q.row_j ORDER BY q.ord_cat NULLS LAST, q.ord_floor NULLS LAST, q.ord_unit), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      jsonb_build_object(
        -- identity / unit facts
        'client_code',   cl.client_code,                                                  -- VERIFY clients.client_code
        'client_name',   cl.full_name,
        'unit_no',       u.unit_no,
        'floor_name',    COALESCE(fl.name, NULLIF(u.floor_label,''), u.floor_no::text),     -- RESOLVED 2026-06-07: floors.name canonical, floor_label/floor_no fallback
        'category_name', ut.type_name,                                                     -- unit type/nature (residential vs commercial grouping)
        'reg_date',      s.sale_date,
        'area',          s.area_sqft,
        'unit_rate',     s.price_per_sqft,
        'total_price',   s.total_amount,                                                   -- RESOLVED 2026-06-07: column is sales.total_amount (no total_price col)
        'discount',      s.discount,
        'net_price',     s.net_amount,
        -- DP bucket (separate; NOT in net_outstanding)
        'dp_total',      COALESCE(dp.dp_total,0),
        'dp_received',   COALESCE(dp_pay.dp_received,0),
        'dp_remaining',  COALESCE(dp.dp_total,0) - COALESCE(dp_pay.dp_received,0),
        -- old bucket
        'old_outstanding',     COALESCE(old_due.amt,0) - COALESCE(old_pay_before.amt,0),
        'recd_old',            COALESCE(old_pay_in_month.amt,0),
        'outstanding_old_net', (COALESCE(old_due.amt,0) - COALESCE(old_pay_before.amt,0)) - COALESCE(old_pay_in_month.amt,0),
        -- current bucket
        'month_installment',   COALESCE(cur_due.amt,0),
        'recd_current',        COALESCE(cur_pay.amt,0),
        -- net position (old_net + current_due - current_received); DP excluded
        'net_outstanding',     ((COALESCE(old_due.amt,0) - COALESCE(old_pay_before.amt,0)) - COALESCE(old_pay_in_month.amt,0))
                                 + COALESCE(cur_due.amt,0) - COALESCE(cur_pay.amt,0)
      ) AS row_j,
      ut.type_name                         AS ord_cat,
      COALESCE(fl.sort_order, u.floor_no)  AS ord_floor,
      u.unit_no                            AS ord_unit
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
    WHERE s.company_id = p_company_id
      AND s.status <> 'cancelled'                       -- exclude cancelled sales
      AND COALESCE(s.is_active, s.status = 'active')    -- exclude transferred-out / inactive sales
      AND (p_project_id IS NULL OR s.project_id = p_project_id)
  ) q;

  RETURN COALESCE(v_result, '[]'::jsonb);
END
$function$;

REVOKE ALL ON FUNCTION public.get_recovery_position(uuid, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_recovery_position(uuid, uuid, date) TO anon, authenticated;

-- NOTE on floor_name: units carry floor_id/floor_no/floor_label. This impl uses
-- floor_label (with floor_no as fallback) to avoid an unverified join. If the
-- human-readable floor name lives in public.floors.name, swap the floor_name
-- expression for COALESCE(fl.name, NULLIF(u.floor_label,''), u.floor_no::text)
-- and add: LEFT JOIN public.floors fl ON fl.id = u.floor_id  (and order by
-- COALESCE(fl.sort_order, u.floor_no)). Verify floors column names first
-- (an earlier migration fix noted floors uses name/sort_order, not
-- floor_name/floor_number).

-- ================================================================
-- VERIFY BLOCK — run these against the RMS project after applying.
-- (Cannot be executed from this workspace; MCP points at NexuAttend.)
-- Replace :CID / :SALE / :PROJ as needed.
-- ================================================================
--
-- 0) Smoke: top rows for a company
-- SELECT jsonb_pretty(public.get_recovery_position('<CID>'::uuid));
--
-- 1) Hand-compute one sale's buckets from raw rows, compare to the RPC row.
--    Pick a sale with a DP row + >=2 regular installments + >=1 payment:
--   WITH d AS (SELECT date_trunc('month',CURRENT_DATE)::date ms,
--                     (date_trunc('month',CURRENT_DATE)+interval '1 month -1 day')::date me)
--   SELECT i.installment_number, i.installment_type, i.due_date, i.amount_due,
--          p.amount, p.payment_date, p.status
--   FROM installments i
--   LEFT JOIN payments p ON p.installment_id=i.id AND p.status<>'cancelled'
--   WHERE i.sale_id='<SALE>'::uuid ORDER BY i.installment_number;
--   -- then locate that sale in:
--   SELECT * FROM jsonb_array_elements(public.get_recovery_position('<CID>'::uuid)) x
--   WHERE x->>'unit_no' = '<UNIT_NO>';
--
-- 2) Cancelled-payment exclusion:
--   SELECT id,amount,status FROM payments WHERE sale_id='<SALE>'::uuid AND status<>'cancelled' LIMIT 1;
--   -- snapshot the RPC row, then:
--   UPDATE payments SET status='cancelled' WHERE id='<PAYID>'::uuid;   -- (test data only)
--   -- re-run get_recovery_position and diff: dp_received/recd_* should drop by that amount.
--   -- restore: UPDATE payments SET status='received' WHERE id='<PAYID>'::uuid;
--
-- 3) Past-month windows shift:
--   SELECT public.get_recovery_position('<CID>'::uuid, NULL, (CURRENT_DATE - interval '1 month')::date);
--   -- "current" installments should now be last month's; old window shrinks by one month.
--
-- 4) Plan / missing-index check:
--   EXPLAIN ANALYZE SELECT public.get_recovery_position('<CID>'::uuid);
--   -- watch for Seq Scan on installments/payments by (company_id, sale_id) or
--   -- payments(installment_id, status, payment_date). Report only — do not add yet.
-- ================================================================
