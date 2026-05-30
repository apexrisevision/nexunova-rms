-- ════════════════════════════════════════════════════════════
-- PROJECT-SCOPING — BATCH 5: server-side isolation on category list RPCs
-- 2026-05-30.  ⚠️ REVIEW ONLY — DO NOT APPLY until approved.
-- ════════════════════════════════════════════════════════════
-- Closes the categories loop: the frontend already filters by _catProject
-- (Step 7b), but the server-side list RPCs were still company-scoped only.
-- Adds the standard gate: AND (cfg.v_all OR <table>.project_id = ANY(cfg.v_pids))
--
-- Note: no list_payment_types RPC exists today (category_payment_types is
-- empty and not surfaced via an RPC). Nothing to retrofit there.
--
-- Anon (no session) stays PERMISSIVE.

CREATE OR REPLACE FUNCTION public.list_unit_types(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR public._rms_is_admin(me) FROM public._rms_caller() me), true) AS v_all,
      COALESCE(
        (SELECT array_agg(upa.project_id) FROM public._rms_caller() me
         JOIN public.user_project_assignments upa
           ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.sort_order, t.type_name), '[]'::jsonb)
  FROM public.category_unit_types t CROSS JOIN cfg
  WHERE t.company_id = p_company_id
    AND (cfg.v_all OR t.project_id = ANY(cfg.v_pids));
$function$;

CREATE OR REPLACE FUNCTION public.list_unit_statuses(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR public._rms_is_admin(me) FROM public._rms_caller() me), true) AS v_all,
      COALESCE(
        (SELECT array_agg(upa.project_id) FROM public._rms_caller() me
         JOIN public.user_project_assignments upa
           ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.sort_order, s.status_name), '[]'::jsonb)
  FROM public.category_unit_statuses s CROSS JOIN cfg
  WHERE s.company_id = p_company_id
    AND (cfg.v_all OR s.project_id = ANY(cfg.v_pids));
$function$;
