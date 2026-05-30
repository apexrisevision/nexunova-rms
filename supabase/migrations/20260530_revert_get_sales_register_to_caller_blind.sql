-- ════════════════════════════════════════════════════════════
-- REVERT: get_sales_register back to its caller-blind, pre-Batch-6B body.
-- 2026-05-30.
-- ════════════════════════════════════════════════════════════
-- get_sales_register is one of the 9 protected report RPCs (per
-- [[report_rpcs_anon_scoped]] — must stay caller-blind / company-scoped
-- only). Batch 6B inadvertently retrofitted it with v_pids isolation;
-- this migration restores the canonical body from the consent-reversal
-- migration (20260529_remove_admin_consent.sql).
--
-- Per-project report isolation will be built deliberately as a separate
-- future task — not as a Batch-6 side effect.
--
-- Audit also performed on the other 8 of the 9 (get_collection_report,
-- get_outstanding_report, get_unit_inventory, get_aging_report,
-- get_project_summary, get_tax_wht_report, get_post_possession_dues_report,
-- get_legal_portfolio) — all confirmed caller-blind in current DB state
-- (no _rms_caller / v_pids / _rms_is_admin / user_project_assignments /
-- cfg AS markers).

CREATE OR REPLACE FUNCTION public.get_sales_register(
  p_company_id uuid,
  p_from_date  date DEFAULT NULL,
  p_to_date    date DEFAULT NULL,
  p_project_id uuid DEFAULT NULL,
  p_status     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(q.j ORDER BY q.sale_date DESC NULLS LAST), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'booking_date', s.sale_date,
      'client_name',  cl.full_name,
      'unit_ref',     u.unit_no,
      'project_name', pr.project_name,
      'unit_type',    ut.type_name,
      'total_price',  s.net_amount,
      'total_paid',   COALESCE(pay.paid, 0),
      'balance_due',  COALESCE(s.net_amount, 0) - COALESCE(pay.paid, 0),
      'sale_status',  s.status
    ) AS j, s.sale_date
    FROM public.sales s
    LEFT JOIN public.clients  cl ON cl.id = s.client_id
    LEFT JOIN public.units    u  ON u.id  = s.unit_id
    LEFT JOIN public.category_unit_types ut ON ut.id = u.unit_type_id
    LEFT JOIN public.projects pr ON pr.id = COALESCE(s.project_id, u.project_id)
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(amount), 0) AS paid
      FROM public.payments
      WHERE sale_id = s.id AND status IS DISTINCT FROM 'cancelled'
    ) pay ON true
    WHERE s.company_id = p_company_id
      AND (p_status     IS NULL OR s.status = p_status)
      AND (p_from_date  IS NULL OR s.sale_date >= p_from_date)
      AND (p_to_date    IS NULL OR s.sale_date <= p_to_date)
      AND (p_project_id IS NULL OR COALESCE(s.project_id, u.project_id) = p_project_id)
  ) q;
$function$;
