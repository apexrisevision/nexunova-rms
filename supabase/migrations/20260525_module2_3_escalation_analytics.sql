-- ================================================================
-- NEXUNOVA RMS — MODULE 2.3 ESCALATION ANALYTICS
-- 2026-05-25 — APPLIED via MCP + verified (total/open/resolved, resolution
-- rate 50%, avg resolution 3d, by_level, by_month). Rolled back, 0 residue.
--
-- get_escalation_analytics(p_company_id): volume (total/open/resolved),
-- resolution rate, avg resolution days, by escalation level, by month.
-- (Escalation levels, auto-escalation rules [promises 1.3 / PDC 3 / legal],
--  and resolution tracking already existed in the escalations table/RPCs.)
-- Canonical body applied via apply_migration 'module2_3_escalation_analytics'.
-- ================================================================
CREATE OR REPLACE FUNCTION public.get_escalation_analytics(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_total int := 0; v_open int := 0; v_resolved int := 0; v_avg numeric := NULL;
  v_by_level jsonb; v_by_month jsonb;
BEGIN
  SELECT COUNT(*), COUNT(*) FILTER (WHERE status='open'), COUNT(*) FILTER (WHERE status='resolved')
  INTO v_total, v_open, v_resolved FROM escalations WHERE company_id = p_company_id;

  SELECT ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 86400)::numeric, 1) INTO v_avg
  FROM escalations WHERE company_id = p_company_id AND status='resolved' AND resolved_at IS NOT NULL;

  SELECT COALESCE(jsonb_agg(row_to_json(l) ORDER BY l.to_level), '[]'::jsonb) INTO v_by_level
  FROM (SELECT to_level, COUNT(*)::int AS count, COUNT(*) FILTER (WHERE status='open')::int AS open
        FROM escalations WHERE company_id = p_company_id GROUP BY to_level) l;

  SELECT COALESCE(jsonb_agg(row_to_json(m) ORDER BY m.month_start), '[]'::jsonb) INTO v_by_month
  FROM (
    SELECT mb.month_start, to_char(mb.month_start,'Mon YY') AS label,
      COALESCE((SELECT COUNT(*) FROM escalations WHERE company_id=p_company_id
                AND created_at >= mb.month_start AND created_at < mb.month_start + INTERVAL '1 month'),0)::int AS created,
      COALESCE((SELECT COUNT(*) FROM escalations WHERE company_id=p_company_id
                AND resolved_at >= mb.month_start AND resolved_at < mb.month_start + INTERVAL '1 month'),0)::int AS resolved
    FROM (SELECT (date_trunc('month',CURRENT_DATE)-(gs||' months')::interval)::date AS month_start
          FROM generate_series(5,0,-1) gs) mb
  ) m;

  RETURN jsonb_build_object(
    'success', true, 'total', v_total, 'open', v_open, 'resolved', v_resolved,
    'resolution_rate', CASE WHEN v_total>0 THEN ROUND(v_resolved::numeric/v_total*100,1) ELSE 0 END,
    'avg_resolution_days', v_avg, 'by_level', v_by_level, 'by_month', v_by_month
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END $function$;
GRANT EXECUTE ON FUNCTION public.get_escalation_analytics(uuid) TO anon, authenticated;
