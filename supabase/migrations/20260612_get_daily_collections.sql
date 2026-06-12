-- ════════════════════════════════════════════════════════════════════════════
-- get_daily_collections — per-day collected amount for a period
-- ----------------------------------------------------------------------------
-- Powers the dashboard "Collection Pace" sparkline (this MTD cumulative vs last
-- full month). Scoped IDENTICALLY to get_recovery_position's "received"
-- definition so the series reconciles to the report to the paisa:
--
--   SUM(get_daily_collections(co, proj, from, to).amount)
--     == get_recovery_position(co, proj, from, to).totals.received_total
--
-- Same row set as RP's totals: payments on ACTIVE, non-cancelled sales that have
-- an existing unit (RP's rowsrc INNER-joins units), payment.status <> 'cancelled',
-- payment_date BETWEEN from AND to (payment_date is a DATE column — clean range).
-- A binding live cross-check is run for both months before the card ships; if the
-- two ever diverge (definition drift) the card degrades to the arithmetic pace-bar
-- rather than drawing a misleading line.
--
-- PERF NOTE (deliberate, NOT done here): this RPC is also the intended future
-- replacement for the dashboard inflow chart's 6 separate monthly
-- get_recovery_position calls — one ranged call grouped by month. Left as a
-- follow-up; the inflow chart is NOT rewired in this phase.
--
-- SECURITY: SECURITY DEFINER + STABLE + search_path 'public', mirroring the
-- neighbouring dashboard RPC get_dashboard_receivable; EXECUTE granted to
-- authenticated + service_role only (no anon — the dashboard caller is logged in).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_daily_collections(
  p_company_id uuid,
  p_project_id uuid  DEFAULT NULL,
  p_from       date  DEFAULT (date_trunc('month', CURRENT_DATE::timestamptz))::date,
  p_to         date  DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('day', to_char(d.day, 'YYYY-MM-DD'), 'amount', d.amount)
      ORDER BY d.day
    ),
    '[]'::jsonb
  )
  FROM (
    SELECT p.payment_date AS day, SUM(p.amount)::numeric AS amount
    FROM public.payments p
    JOIN public.sales  s ON s.id = p.sale_id
    JOIN public.units  u ON u.id = s.unit_id AND u.company_id = p_company_id
    WHERE s.company_id = p_company_id
      AND s.status <> 'cancelled'
      AND COALESCE(s.is_active, s.status = 'active')
      AND (p_project_id IS NULL OR s.project_id = p_project_id)
      AND p.company_id = p_company_id
      AND p.status <> 'cancelled'
      AND p.payment_date BETWEEN p_from AND p_to
    GROUP BY p.payment_date
  ) d;
$function$;

REVOKE ALL  ON FUNCTION public.get_daily_collections(uuid, uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_daily_collections(uuid, uuid, date, date) TO authenticated, service_role;
