-- ════════════════════════════════════════════════════════════
-- PROJECT-SCOPING — BATCH 4, GROUP 4E: server-side isolation on list_sub_agents
-- (last group of Batch 4)
-- 2026-05-30.  ⚠️ REVIEW ONLY — DO NOT APPLY until approved.
-- ════════════════════════════════════════════════════════════
-- Gate directly on the sub-agent's own a.project_id.
-- The hierarchy stays within one project by construction: Step 6's
-- update_agent_extended already rejects a parent_agent_id whose project
-- differs from the child's project. So a non-admin who can see the parent
-- (parent.project_id ∈ v_pids) will also see all its sub-agents (same
-- project), and a non-admin who can't see the parent gets an empty list
-- (since sub-agents share the inaccessible project).

CREATE OR REPLACE FUNCTION public.list_sub_agents(p_parent_id uuid, p_company_id uuid)
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
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id, 'full_name', a.full_name, 'agent_code', a.agent_code,
    'status', a.status, 'total_sales_count', a.total_sales_count,
    'commission_percent', a.commission_percent
  )), '[]'::jsonb)
  FROM public.agents a CROSS JOIN cfg
  WHERE a.parent_agent_id = p_parent_id AND a.company_id = p_company_id
    AND (cfg.v_all OR a.project_id = ANY(cfg.v_pids));
$function$;
