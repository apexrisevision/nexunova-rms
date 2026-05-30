-- ════════════════════════════════════════════════════════════
-- PROJECT-SCOPING — BATCH 3, GROUP 3E: server-side isolation on client
-- blacklist RPCs (last group in Batch 3)
-- 2026-05-30.  ⚠️ REVIEW ONLY — DO NOT APPLY until approved.
-- ════════════════════════════════════════════════════════════
-- blacklisted_clients keeps project_id NULLABLE (Batch 1) — gate via parent
-- client.project_id join. Per the flag decision: a Project-B non-admin must
-- not probe a Project-A client's blacklist status or see Project-A blacklist
-- entries. Anon (no session) stays PERMISSIVE.

-- ── 1. check_client_blacklisted (parent client join) ──────
CREATE OR REPLACE FUNCTION public.check_client_blacklisted(p_client_id uuid, p_company_id uuid)
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
  SELECT COALESCE(
    (SELECT jsonb_build_object(
       'blacklisted', true, 'reason', bc.reason, 'reason_type', bc.reason_type,
       'blacklist_date', bc.blacklist_date)
     FROM public.blacklisted_clients bc
     JOIN public.clients c ON c.id = bc.client_id AND c.company_id = bc.company_id
     CROSS JOIN cfg
     WHERE bc.client_id = p_client_id AND bc.company_id = p_company_id AND bc.is_active = true
       AND (cfg.v_all OR c.project_id = ANY(cfg.v_pids))
     ORDER BY bc.blacklist_date DESC LIMIT 1),
    jsonb_build_object('blacklisted', false)
  );
$function$;

-- ── 2. list_blacklisted_clients (parent client join) ──────
CREATE OR REPLACE FUNCTION public.list_blacklisted_clients(p_company_id uuid)
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
    'id', b.id, 'company_id', b.company_id, 'client_id', b.client_id,
    'reason', b.reason, 'reason_type', b.reason_type, 'blacklist_date', b.blacklist_date,
    'related_cancellation_id', b.related_cancellation_id,
    'approved_by', b.approved_by, 'is_active', b.is_active,
    'removed_date', b.removed_date, 'removed_by', b.removed_by,
    'removal_reason', b.removal_reason, 'created_at', b.created_at,
    'clients', jsonb_build_object(
      'client_name', c.full_name, 'client_code', c.client_code, 'phone', c.phone_primary
    )
  ) ORDER BY b.blacklist_date DESC), '[]'::jsonb)
  FROM public.blacklisted_clients b
  LEFT JOIN public.clients c ON c.id = b.client_id
  CROSS JOIN cfg
  WHERE b.company_id = p_company_id
    AND (cfg.v_all OR c.project_id = ANY(cfg.v_pids));
$function$;
