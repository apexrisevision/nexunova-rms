-- Phase 3A: read-only Total Receivable aggregate for the dashboard.
-- Non-aging contract metric (distinct from get_recovery_position's rollforward):
--   receivable = Σ net_amount(active sales) − Σ payments(amount) on those sales.
-- Active-sale definition mirrors get_recovery_position exactly so net_active ties
-- to its totals.net_price. Caller-blind + SECURITY DEFINER, same posture as its sibling.
-- Applied to prod via MCP apply_migration 2026-06-12; this file is the repo record.
CREATE OR REPLACE FUNCTION public.get_dashboard_receivable(
  p_company_id uuid,
  p_project_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_net  numeric := 0;
  v_paid numeric := 0;
BEGIN
  WITH asale AS (
    SELECT s.id, s.net_amount
    FROM public.sales s
    WHERE s.company_id = p_company_id
      AND s.status <> 'cancelled'
      AND COALESCE(s.is_active, s.status = 'active')
      AND (p_project_id IS NULL OR s.project_id = p_project_id)
  )
  SELECT
    COALESCE((SELECT SUM(net_amount) FROM asale), 0),
    COALESCE((SELECT SUM(p.amount)
              FROM public.payments p
              WHERE p.sale_id IN (SELECT id FROM asale)
                AND COALESCE(p.status, 'cleared') NOT IN ('cancelled','bounced','void','rejected')), 0)
  INTO v_net, v_paid;

  RETURN jsonb_build_object(
    'net_active',  v_net,
    'paid_active', v_paid,
    'receivable',  v_net - v_paid
  );
END
$function$;

REVOKE ALL ON FUNCTION public.get_dashboard_receivable(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_dashboard_receivable(uuid, uuid) TO authenticated;
