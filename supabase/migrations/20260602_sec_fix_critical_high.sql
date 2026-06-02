-- ============================================================================
-- 20260602_sec_fix_critical_high.sql
-- Security remediation — CRITICAL + HIGH findings only (audit 2026-06-02).
-- Applied to live DB on 2026-06-02 via Supabase MCP (migration name:
-- 20260602_sec_fix_critical_high). This file mirrors the applied SQL verbatim.
-- Policy / grant / single-function-guard changes. No table drops, no logic rewrites.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- CRITICAL 1: get_team_performance_lite leaked to anon.
-- Old guard: IF v_me.id IS NOT NULL AND NOT _rms_is_admin THEN RETURN '[]'
--   -> anon (v_me.id IS NULL) short-circuits FALSE and falls through to full data.
-- New guard: reject no-session OR non-admin. Body otherwise byte-for-byte unchanged.
-- ----------------------------------------------------------------------------
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
  v_me := public._rms_caller();
  IF v_me.id IS NULL OR NOT public._rms_is_admin(v_me) THEN
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
      'calls_this_month',    COALESCE(cl.calls, 0),
      'promises_made',       COALESCE(pp.made, 0),
      'promises_kept',       COALESCE(pp.kept, 0),
      'promises_broken',     COALESCE(pp.broken, 0),
      'untouched_overdue',   COALESCE(nu.untouched, 0)
    ) AS row
    FROM public.app_users u
    LEFT JOIN LATERAL (
      SELECT array_agg(p.project_name ORDER BY p.project_name) AS project_names,
             array_agg(upa.project_id)                         AS project_ids
      FROM public.user_project_assignments upa
      JOIN public.projects p ON p.id = upa.project_id
      WHERE upa.user_id = u.id
        AND upa.company_id = p_company_id
        AND upa.is_active = true
    ) pj ON true
    LEFT JOIN LATERAL (
      SELECT
        SUM(GREATEST(i.amount_due - i.amount_paid, 0)) AS outstanding,
        SUM(CASE WHEN i.due_date < CURRENT_DATE
                 THEN GREATEST(i.amount_due - i.amount_paid, 0) ELSE 0 END) AS overdue
      FROM public.installments i
      WHERE i.company_id = p_company_id
        AND i.project_id = ANY(pj.project_ids)
    ) ins ON true
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
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS pending_count
      FROM public.approval_requests ar
      WHERE ar.company_id = p_company_id
        AND ar.requested_by = u.id
        AND ar.status = 'pending'
    ) ap ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS calls
      FROM public.contact_logs c
      WHERE c.company_id = p_company_id
        AND c.agent_id = u.id::text
        AND c.contact_date >= date_trunc('month', CURRENT_DATE)::date
        AND c.contact_date <  (date_trunc('month', CURRENT_DATE) + interval '1 month')::date
    ) cl ON true
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (
          WHERE pr.promise_made_on >= date_trunc('month', CURRENT_DATE)::date
            AND pr.promise_made_on <  (date_trunc('month', CURRENT_DATE) + interval '1 month')::date
        ) AS made,
        COUNT(*) FILTER (
          WHERE pr.promise_date < CURRENT_DATE AND pr.status IN ('kept','partial')
        ) AS kept,
        COUNT(*) FILTER (
          WHERE pr.promise_date < CURRENT_DATE AND pr.status IN ('broken','pending','postponed')
        ) AS broken
      FROM public.payment_promises pr
      WHERE pr.company_id = p_company_id
        AND pr.logged_by = u.id::text
        AND pr.project_id = ANY(pj.project_ids)
    ) pp ON true
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

-- anon holds EXECUTE on this one via the PUBLIC grant (no explicit anon entry),
-- so REVOKE FROM PUBLIC. authenticated + service_role keep their explicit grants.
REVOKE EXECUTE ON FUNCTION public.get_team_performance_lite(uuid) FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- HIGH 3: caller-blind financial readers, not on the sanctioned anon allow-list.
-- Both have an explicit anon=X grant -> REVOKE FROM anon.
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.get_commission_report(uuid, uuid)        FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_monthly_collection_trend(uuid, uuid) FROM anon;

-- ----------------------------------------------------------------------------
-- HIGH 2: 6 tables still used the old {public} company-isolation policy, which
-- let any authenticated user read/write their own company's rows directly via
-- PostgREST (bypassing role + project gates). Replace with deny_all_anon so all
-- access flows through the SECURITY DEFINER RPCs (which bypass RLS as table owner;
-- relforcerowsecurity=false on all of these). Full RPC read+write paths confirmed.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS fv_company_isolation       ON public.field_visits;
DROP POLICY IF EXISTS noc_company_isolation       ON public.noc;
DROP POLICY IF EXISTS instsnap_company_isolation  ON public.installment_snapshots;
DROP POLICY IF EXISTS cs_company_isolation        ON public.commission_structures;
DROP POLICY IF EXISTS ipwl_company_isolation      ON public.company_ip_whitelists;
DROP POLICY IF EXISTS css_company_isolation       ON public.company_security_settings;

CREATE POLICY deny_all_anon ON public.field_visits
  AS PERMISSIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY deny_all_anon ON public.noc
  AS PERMISSIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY deny_all_anon ON public.installment_snapshots
  AS PERMISSIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY deny_all_anon ON public.commission_structures
  AS PERMISSIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY deny_all_anon ON public.company_ip_whitelists
  AS PERMISSIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY deny_all_anon ON public.company_security_settings
  AS PERMISSIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
