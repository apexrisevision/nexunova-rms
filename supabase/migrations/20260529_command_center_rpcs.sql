-- ════════════════════════════════════════════════════════════
-- Command Center — admin landing aggregates (applied 2026-05-29)
-- ════════════════════════════════════════════════════════════
-- Only the 3 data points the Command Center needs that have NO existing
-- RPC source (everything else reuses get_pending_approvals / get_pdc_register
-- / get_all_promises / get_collection_report / get_health_dashboard_stats /
-- get_latest_radar / get_radar_history / get_admin_audit_feed):
--   1. distinct clients with an unpaid installment > 90 days overdue (legal threshold)
--      — get_executive_dashboard exposes a d90_plus *installment* aging bucket, not
--        distinct clients, so we compute clients here.
--   2. unpaid installments due in the next 3 days
--      — list_installments_filtered supports only status_in/limit, no date window.
--   3. average radar score today vs yesterday
--      — get_radar_history carries potential/counts but no per-day score.
-- Pattern mirrors get_executive_dashboard: SECURITY DEFINER, company-scoped,
-- search_path=public (no session check — same as the other dashboard aggregates).

CREATE OR REPLACE FUNCTION public.cc_command_center(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_clients_90d int := 0;
  v_amount_90d  numeric := 0;
  v_inst_3d_cnt int := 0;
  v_inst_3d_amt numeric := 0;
  v_radar_today numeric := NULL;
  v_radar_yest  numeric := NULL;
BEGIN
  -- Distinct clients with any unpaid installment more than 90 days overdue (legal threshold)
  SELECT COUNT(DISTINCT s.client_id),
         COALESCE(SUM(i.amount_due - COALESCE(i.amount_paid,0)), 0)
    INTO v_clients_90d, v_amount_90d
  FROM installments i
  JOIN sales s ON s.id = i.sale_id
  WHERE i.company_id = p_company_id
    AND (i.amount_due - COALESCE(i.amount_paid,0)) > 0
    AND i.due_date < CURRENT_DATE - 90
    AND COALESCE(s.status,'active') <> 'cancelled';

  -- Unpaid installments due within the next 3 days (today .. today+3)
  SELECT COUNT(*),
         COALESCE(SUM(i.amount_due - COALESCE(i.amount_paid,0)), 0)
    INTO v_inst_3d_cnt, v_inst_3d_amt
  FROM installments i
  WHERE i.company_id = p_company_id
    AND (i.amount_due - COALESCE(i.amount_paid,0)) > 0
    AND i.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 3;

  -- Average radar score today & yesterday (from stored radar logs' top_clients)
  SELECT AVG((e->>'final_score')::numeric) INTO v_radar_today
  FROM recovery_radar_logs r
  CROSS JOIN LATERAL jsonb_array_elements(r.top_clients) e
  WHERE r.company_id = p_company_id AND r.generated_date = CURRENT_DATE;

  SELECT AVG((e->>'final_score')::numeric) INTO v_radar_yest
  FROM recovery_radar_logs r
  CROSS JOIN LATERAL jsonb_array_elements(r.top_clients) e
  WHERE r.company_id = p_company_id AND r.generated_date = CURRENT_DATE - 1;

  RETURN jsonb_build_object(
    'clients_90d_overdue', v_clients_90d,
    'amount_90d_overdue',  v_amount_90d,
    'installments_due_3d', v_inst_3d_cnt,
    'amount_due_3d',       v_inst_3d_amt,
    'radar_avg_today',     CASE WHEN v_radar_today IS NULL THEN NULL ELSE ROUND(v_radar_today) END,
    'radar_avg_yesterday', CASE WHEN v_radar_yest  IS NULL THEN NULL ELSE ROUND(v_radar_yest)  END
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.cc_command_center(uuid) TO anon, authenticated;
