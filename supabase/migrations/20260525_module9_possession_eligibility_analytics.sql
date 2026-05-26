-- ================================================================
-- NEXUNOVA RMS — MODULE 9 (POSSESSION) ELIGIBILITY + ANALYTICS
-- 2026-05-25 — APPLIED via MCP + verified (95% paid → eligible@90 true,
-- @99 false; analytics by_status/by_project/this_month). Rolled back, 0 residue.
--
--   (a) check_possession_eligibility(unit, company, threshold=90)
--   (b) get_possession_analytics(company)
-- Possession CRUD + checklist + snagging already exist (public.possessions).
-- NOC management = separate greenfield sub-module (DEFERRED — needs new
-- noc table + RPCs + page).
-- Canonical bodies applied via apply_migration 'module9_possession_eligibility_analytics'.
-- ================================================================

CREATE OR REPLACE FUNCTION public.check_possession_eligibility(p_unit_id uuid, p_company_id uuid, p_threshold numeric DEFAULT 90)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE v_sale uuid; v_due numeric := 0; v_paid numeric := 0; v_pct numeric := 0;
BEGIN
  SELECT id INTO v_sale FROM sales
   WHERE unit_id = p_unit_id AND company_id = p_company_id AND status = 'active'
   ORDER BY created_at DESC LIMIT 1;
  IF v_sale IS NULL THEN
    SELECT id INTO v_sale FROM sales WHERE unit_id = p_unit_id AND company_id = p_company_id
     ORDER BY created_at DESC LIMIT 1;
  END IF;
  IF v_sale IS NULL THEN
    RETURN jsonb_build_object('success', true, 'has_sale', false, 'eligible', false, 'pct_paid', 0);
  END IF;
  SELECT COALESCE(SUM(amount_due),0), COALESCE(SUM(amount_paid),0)
  INTO v_due, v_paid FROM installments WHERE sale_id = v_sale AND company_id = p_company_id;
  v_pct := CASE WHEN v_due > 0 THEN ROUND(v_paid / v_due * 100, 1) ELSE 0 END;
  RETURN jsonb_build_object('success', true, 'has_sale', true, 'sale_id', v_sale,
    'total_due', v_due, 'total_paid', v_paid, 'pct_paid', v_pct,
    'threshold', p_threshold, 'eligible', v_pct >= p_threshold);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END $function$;
GRANT EXECUTE ON FUNCTION public.check_possession_eligibility(uuid, uuid, numeric) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_possession_analytics(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE v_status jsonb; v_by_proj jsonb; v_month jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(s) ORDER BY s.status), '[]'::jsonb) INTO v_status
  FROM (SELECT COALESCE(status,'(none)') AS status, COUNT(*)::int AS count
        FROM possessions WHERE company_id = p_company_id GROUP BY status) s;
  SELECT jsonb_build_object(
    'scheduled_this_month', COUNT(*) FILTER (WHERE date_trunc('month',possession_date)=date_trunc('month',CURRENT_DATE) AND status <> 'completed'),
    'completed_this_month', COUNT(*) FILTER (WHERE date_trunc('month',possession_date)=date_trunc('month',CURRENT_DATE) AND status = 'completed')
  ) INTO v_month FROM possessions WHERE company_id = p_company_id;
  SELECT COALESCE(jsonb_agg(row_to_json(p) ORDER BY p.total DESC), '[]'::jsonb) INTO v_by_proj
  FROM (
    SELECT COALESCE(pr.project_name,'(unassigned)') AS project_name, COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE po.status='completed')::int AS completed
    FROM possessions po LEFT JOIN units u ON u.id = po.unit_id LEFT JOIN projects pr ON pr.id = u.project_id
    WHERE po.company_id = p_company_id GROUP BY pr.project_name
  ) p;
  RETURN jsonb_build_object('success', true, 'by_status', v_status, 'this_month', v_month, 'by_project', v_by_proj);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END $function$;
GRANT EXECUTE ON FUNCTION public.get_possession_analytics(uuid) TO anon, authenticated;
