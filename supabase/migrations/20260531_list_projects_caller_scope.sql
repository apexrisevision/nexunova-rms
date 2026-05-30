-- ════════════════════════════════════════════════════════════
-- list_projects: caller-scope to the user's UPA-assigned projects
-- 2026-05-31. Closes the last project-scoping gap (B3-B6 omission).
-- ════════════════════════════════════════════════════════════
-- list_projects was the only project-list RPC left out of the B3-B6
-- isolation pass. It returned every project in the company regardless
-- of caller. The data itself was never leaked (the downstream ledger
-- RPCs gate by UPA already), but the project NAMES and metadata were
-- exposed via every project picker in the app — including the Ledgers
-- hub picker that an FMH-only recovery officer would see as
-- "FMH + KBH" instead of "FMH only".
--
-- Standard pattern from T2/T3/T4:
--   anon (me.id NULL)        → v_all=true  (unchanged for report viewer)
--   admin/owner same tenant  → v_all=true  (sees all)
--   non-admin / cross-tenant → v_all=false → restricted to UPA project_ids
-- Body otherwise verbatim.

CREATE OR REPLACE FUNCTION public.list_projects(p_company_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR (me.company_id = p_company_id AND public._rms_is_admin(me)) FROM public._rms_caller() me), true) AS v_all,
      COALESCE(
        (SELECT array_agg(upa.project_id) FROM public._rms_caller() me
         JOIN public.user_project_assignments upa
           ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.project_name), '[]'::jsonb)
  FROM public.projects p CROSS JOIN cfg
  WHERE p.company_id = p_company_id
    AND (cfg.v_all OR p.id = ANY(cfg.v_pids));
$function$;
