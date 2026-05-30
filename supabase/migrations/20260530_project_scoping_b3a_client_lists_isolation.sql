-- ════════════════════════════════════════════════════════════
-- PROJECT-SCOPING — BATCH 3, GROUP 3A: server-side isolation on client LIST RPCs
-- 2026-05-30.  ⚠️ REVIEW ONLY — DO NOT APPLY until approved.
-- ════════════════════════════════════════════════════════════
-- Retrofits the get_units_cache_bundle pattern onto the 6 core client list RPCs:
--   v_me   := _rms_caller()
--   v_all  := (no session) OR _rms_is_admin(me)        -- anon stays PERMISSIVE
--   v_pids := assigned projects (when not v_all)
--   filter: AND (v_all OR c.project_id = ANY(v_pids))
--
-- Per Rashid (2026-05-30):
--   • get_clients_plan_status is COMPANY-WIDE for admins / not_applicable for
--     non-admins (option b — plan limits are company-level).
--   • get_portal_client_data is NOT touched here (anon buyer-portal path).
--   • check_client_blacklisted is Group 3E.

-- ── 1. list_clients ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_clients(p_company_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_search    TEXT    := NULLIF(p_filters->>'search',   '');
  v_status    TEXT    := NULLIF(p_filters->>'status',   '');
  v_category  TEXT    := NULLIF(p_filters->>'category', '');
  v_limit     INTEGER := COALESCE((p_filters->>'limit')::INTEGER,  20);
  v_offset    INTEGER := COALESCE((p_filters->>'offset')::INTEGER,  0);
  v_total     INTEGER;
  v_rows      JSONB;
  v_me        public.app_users := public._rms_caller();
  v_all       boolean := (v_me.id IS NULL) OR public._rms_is_admin(v_me);
  v_pids      uuid[];
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT COUNT(*) INTO v_total FROM public.clients c
  WHERE c.company_id = p_company_id
    AND (v_all OR c.project_id = ANY(v_pids))
    AND (v_status   IS NULL OR c.status          = v_status)
    AND (v_category IS NULL OR c.client_category = v_category)
    AND (v_search   IS NULL OR
         c.full_name     ILIKE '%' || v_search || '%' OR
         c.cnic          ILIKE '%' || v_search || '%' OR
         c.phone_primary ILIKE '%' || v_search || '%' OR
         c.email         ILIKE '%' || v_search || '%' OR
         c.client_code   ILIKE '%' || v_search || '%');

  SELECT jsonb_agg(to_jsonb(c) ORDER BY c.full_name) INTO v_rows
  FROM (
    SELECT c.* FROM public.clients c
    WHERE c.company_id = p_company_id
      AND (v_all OR c.project_id = ANY(v_pids))
      AND (v_status   IS NULL OR c.status          = v_status)
      AND (v_category IS NULL OR c.client_category = v_category)
      AND (v_search   IS NULL OR
           c.full_name     ILIKE '%' || v_search || '%' OR
           c.cnic          ILIKE '%' || v_search || '%' OR
           c.phone_primary ILIKE '%' || v_search || '%' OR
           c.email         ILIKE '%' || v_search || '%' OR
           c.client_code   ILIKE '%' || v_search || '%')
    ORDER BY c.full_name LIMIT v_limit OFFSET v_offset
  ) c;

  RETURN jsonb_build_object('total', v_total, 'rows', COALESCE(v_rows,'[]'::JSONB),
    'limit', v_limit, 'offset', v_offset);
END; $function$;

-- ── 2. list_clients_for_search ──────────────────────────────
CREATE OR REPLACE FUNCTION public.list_clients_for_search(p_company_id uuid, p_filter text DEFAULT NULL::text)
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
    'id', c.id, 'full_name', c.full_name, 'cnic', c.cnic, 'phone_primary', c.phone_primary,
    'is_blacklisted', c.is_blacklisted, 'is_defaulter', c.is_defaulter,
    'has_cancellation_history', c.has_cancellation_history
  )), '[]'::jsonb)
  FROM (SELECT c.* FROM public.clients c CROSS JOIN cfg
        WHERE c.company_id = p_company_id
          AND (cfg.v_all OR c.project_id = ANY(cfg.v_pids))
          AND (p_filter IS NULL
            OR (p_filter='blacklisted' AND c.is_blacklisted)
            OR (p_filter='defaulter' AND c.is_defaulter)
            OR (p_filter='active' AND NOT COALESCE(c.is_blacklisted,false) AND NOT COALESCE(c.is_defaulter,false))
          )
        ORDER BY c.full_name LIMIT 300) c;
$function$;

-- ── 3. list_clients_lookup ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_clients_lookup(p_company_id uuid)
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
    'id', c.id, 'client_name', c.full_name, 'full_name', c.full_name,
    'client_code', c.client_code, 'phone', c.phone_primary,
    'phone_primary', c.phone_primary, 'cnic', c.cnic
  ) ORDER BY c.full_name), '[]'::jsonb)
  FROM public.clients c CROSS JOIN cfg
  WHERE c.company_id = p_company_id
    AND (cfg.v_all OR c.project_id = ANY(cfg.v_pids));
$function$;

-- ── 4. get_clients_all ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_clients_all(p_company_id uuid)
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
  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.full_name), '[]'::jsonb)
  FROM public.clients c CROSS JOIN cfg
  WHERE c.company_id = p_company_id
    AND (cfg.v_all OR c.project_id = ANY(cfg.v_pids));
$function$;

-- ── 5. get_clients_by_health_category (gate via parent client) ────
CREATE OR REPLACE FUNCTION public.get_clients_by_health_category(p_company_id uuid, p_category text DEFAULT 'ALL'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB;
  v_me     public.app_users := public._rms_caller();
  v_all    boolean := (v_me.id IS NULL) OR public._rms_is_admin(v_me);
  v_pids   uuid[];
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'client_id',         c.id,
      'client_name',       c.full_name,
      'client_code',       c.client_code,
      'phone',             c.phone_primary,
      'score',             chs.score,
      'category',          chs.category,
      'exposure',          chs.total_exposure,
      'score_breakdown',   chs.score_breakdown,
      'last_calculated',   chs.last_calculated,
      'last_payment_date', (
        SELECT MAX(p.payment_date)
        FROM payments p
        WHERE p.client_id = c.id AND p.company_id = p_company_id
      )
    ) ORDER BY chs.score ASC
  ), '[]'::jsonb) INTO v_result
  FROM client_health_scores chs
  JOIN clients c ON c.id = chs.client_id
  WHERE chs.company_id = p_company_id
    AND (v_all OR c.project_id = ANY(v_pids))
    AND (p_category = 'ALL' OR chs.category = p_category);

  RETURN v_result;
END;
$function$;

-- ── 6. get_clients_plan_status (admin-only / company-wide; non-admin → not_applicable) ──
CREATE OR REPLACE FUNCTION public.get_clients_plan_status(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_max   int;
  v_count int;
  v_me    public.app_users := public._rms_caller();
BEGIN
  -- Plan limits are company-level (per Rashid's earlier decision). For an
  -- authenticated non-admin caller, return not_applicable; admins and the anon
  -- path (no session — covers signup/onboarding/dashboards) see the real count.
  IF v_me.id IS NOT NULL AND NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('applicable', false, 'error', 'not_applicable',
      'message', 'Plan status is visible to admins only.');
  END IF;

  SELECT sp.max_clients INTO v_max FROM subscriptions s
  JOIN subscription_plans sp ON sp.id = s.plan_id
  WHERE s.company_id = p_company_id AND s.status IN ('active','trialing')
  ORDER BY s.created_at DESC NULLS LAST LIMIT 1;
  SELECT COUNT(*)::int INTO v_count FROM clients WHERE company_id = p_company_id;
  RETURN jsonb_build_object('current_count', v_count,
    'max_allowed', COALESCE(v_max, 0), 'can_add', v_count < COALESCE(v_max, 0));
END;
$function$;
