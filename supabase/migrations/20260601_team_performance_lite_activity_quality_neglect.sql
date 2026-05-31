-- Team Performance Lite — ADD activity / quality / neglect metrics (backend only).
-- Keeps every existing field byte-identical (user_id, full_name, projects, outstanding,
-- overdue, collected_this_month [via sale, from 20260601_..._collected_via_sale], pending_approvals).
-- Adds 5 new per-officer keys, each over the user's assigned project_ids where noted.
--
-- Field choices (verified against live columns, 2026-06-01):
--   contact_logs    user field  = agent_id (text, holds app_users.id; recovery_agent_id is NULL,
--                                 created_by = data-entry user). date = contact_date.
--                                 account linkage for neglect = contact_logs.sale_id.
--   payment_promises user field = logged_by (text, holds app_users.id, NOT NULL).
--                                 made date = promise_made_on; due date = promise_date.
--                                 project_id IS populated -> used directly (no sale join needed).
--                                 status vocabulary = pending|kept|partial|broken|cancelled|postponed.
--   installments    overdue     = due_date < CURRENT_DATE AND amount_due > amount_paid;
--                                 project_id + sale_id both populated.
--
-- Admin gate, role/status filter, SECURITY DEFINER, search_path=public all preserved.
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
      'pending_approvals',   COALESCE(ap.pending_count, 0),
      -- ── NEW: activity / quality / neglect ──────────────────────────
      'calls_this_month',    COALESCE(cl.calls, 0),
      'promises_made',       COALESCE(pp.made, 0),
      'promises_kept',       COALESCE(pp.kept, 0),
      'promises_broken',     COALESCE(pp.broken, 0),
      'untouched_overdue',   COALESCE(nu.untouched, 0)
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
    -- NEW: calls logged this calendar month, attributed to this officer (contact_logs.agent_id)
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS calls
      FROM public.contact_logs c
      WHERE c.company_id = p_company_id
        AND c.agent_id = u.id::text
        AND c.contact_date >= date_trunc('month', CURRENT_DATE)::date
        AND c.contact_date <  (date_trunc('month', CURRENT_DATE) + interval '1 month')::date
    ) cl ON true
    -- NEW: promises by this user within assigned projects —
    --      made this month; kept/broken among those already past their promised date.
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (
          WHERE pr.promise_made_on >= date_trunc('month', CURRENT_DATE)::date
            AND pr.promise_made_on <  (date_trunc('month', CURRENT_DATE) + interval '1 month')::date
        ) AS made,
        COUNT(*) FILTER (
          WHERE pr.promise_date < CURRENT_DATE AND pr.status = 'kept'
        ) AS kept,
        COUNT(*) FILTER (
          WHERE pr.promise_date < CURRENT_DATE AND pr.status IN ('broken','pending')
        ) AS broken
      FROM public.payment_promises pr
      WHERE pr.company_id = p_company_id
        AND pr.logged_by = u.id::text
        AND pr.project_id = ANY(pj.project_ids)
    ) pp ON true
    -- NEW (neglect): overdue accounts (distinct sales) in this user's projects
    --      that NO ONE has contacted in the last 14 days. Linkage: contact_logs.sale_id.
    LEFT JOIN LATERAL (
      SELECT COUNT(DISTINCT i.sale_id) AS untouched
      FROM public.installments i
      WHERE i.company_id = p_company_id
        AND i.project_id = ANY(pj.project_ids)
        AND i.due_date < CURRENT_DATE
        AND i.amount_due > i.amount_paid
        AND NOT EXISTS (
          SELECT 1 FROM public.contact_logs c2
          WHERE c2.company_id = p_company_id
            AND c2.sale_id = i.sale_id
            AND c2.contact_date >= (CURRENT_DATE - INTERVAL '14 days')::date
        )
    ) nu ON true
    WHERE u.company_id = p_company_id
      AND u.role IN ('recovery','recovery_officer')
      AND u.status = 'active'
  ) sub;

  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_team_performance_lite(uuid) TO authenticated;
