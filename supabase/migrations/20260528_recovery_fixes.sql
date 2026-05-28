-- ================================================================
-- NEXUNOVA RMS — RECOVERY MODULE FIXES
-- Migration: 20260528_recovery_fixes.sql  |  2026-05-28
-- ================================================================
-- Fix 1: list_broken_promises — add p_project_ids isolation param
--   payment_promises.project_id already exists; filter by it for
--   non-admin users so recovery officers only see their assigned sites.
--   Admins/owners pass NULL → no project filter (see all).
-- ================================================================

CREATE OR REPLACE FUNCTION public.list_broken_promises(
  p_company_id  uuid,
  p_project_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id',              p.id,
      'client_id',       p.client_id,
      'sale_id',         p.sale_id,
      'project_id',      p.project_id,
      'promised_amount', p.promised_amount,
      'promise_date',    p.promise_date,
      'status',          p.status,
      'notes',           p.notes
    ) ORDER BY p.promise_date ASC)
    FROM public.payment_promises p
    WHERE p.company_id = p_company_id
      AND p.status = 'pending'
      AND p.promise_date <= CURRENT_DATE
      -- NULL means admin/owner (see all); otherwise filter to assigned projects
      AND (p_project_ids IS NULL OR p.project_id = ANY(p_project_ids))
    LIMIT 100
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_broken_promises(uuid, uuid[]) TO anon, authenticated;
