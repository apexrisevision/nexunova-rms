-- Team Performance Lite — fix "Collected This Month" (always 0).
-- Root cause: the collected-this-month lateral joined on payments.project_id, which is
-- NULL on every payment row, so the project filter never matched and SUM returned 0 for all.
-- Fix: resolve the payment's project through its sale (payments.sale_id -> sales.project_id).
-- Only the "collected this month" lateral subquery changes; everything else is byte-identical
-- to 20260531_team_performance_lite.sql (outstanding, overdue, projects, pending_approvals,
-- admin gate, role/status filter). SECURITY DEFINER + search_path=public preserved.
CREATE OR REPLACE FUNCTION public.get_team_performance_lite(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me     public.app_users;
  v_result jsonb;
BEGIN
  -- Admin gate: authenticated non-admins get nothing; service-role (null caller) passes.
  v_me := public._rms_caller();
  IF v_me.id IS NOT NULL AND NOT public._rms_is_admin(v_me) THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(row ORDER BY row->>'full_name'), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'user_id',             u.id,
      'full_name',           u.full_name,
      'projects',            COALESCE(pj.project_names, ARRAY[]::text[]),
      'outstanding',         COALESCE(ins.outstanding, 0),
      'overdue',             COALESCE(ins.overdue, 0),
      'collected_this_month',COALESCE(pay.collected, 0),
      'pending_approvals',   COALESCE(ap.pending_count, 0)
    ) AS row
    FROM public.app_users u
    -- assigned project ids for this user
    LEFT JOIN LATERAL (
      SELECT array_agg(p.project_name ORDER BY p.project_name) AS project_names,
             array_agg(upa.project_id)                         AS project_ids
      FROM public.user_project_assignments upa
      JOIN public.projects p ON p.id = upa.project_id
      WHERE upa.user_id = u.id
        AND upa.company_id = p_company_id
        AND upa.is_active = true
    ) pj ON true
    -- outstanding + overdue across those projects
    LEFT JOIN LATERAL (
      SELECT
        SUM(GREATEST(i.amount_due - i.amount_paid, 0)) AS outstanding,
        SUM(CASE WHEN i.due_date < CURRENT_DATE
                 THEN GREATEST(i.amount_due - i.amount_paid, 0) ELSE 0 END) AS overdue
      FROM public.installments i
      WHERE i.company_id = p_company_id
        AND i.project_id = ANY(pj.project_ids)
    ) ins ON true
    -- collected this calendar month across those projects (project resolved via the sale)
    LEFT JOIN LATERAL (
      SELECT SUM(p2.amount) AS collected
      FROM public.payments p2
      JOIN public.sales s2 ON s2.id = p2.sale_id
      WHERE p2.company_id = p_company_id
        AND s2.project_id = ANY(pj.project_ids)
        AND COALESCE(p2.status, '') <> 'cancelled'
        AND p2.payment_date >= date_trunc('month', CURRENT_DATE)::date
        AND p2.payment_date <  (date_trunc('month', CURRENT_DATE) + interval '1 month')::date
    ) pay ON true
    -- pending approvals requested by this user
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS pending_count
      FROM public.approval_requests ar
      WHERE ar.company_id = p_company_id
        AND ar.requested_by = u.id
        AND ar.status = 'pending'
    ) ap ON true
    WHERE u.company_id = p_company_id
      AND u.role IN ('recovery','recovery_officer')
      AND u.status = 'active'
  ) sub;

  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_team_performance_lite(uuid) TO authenticated;
