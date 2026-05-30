-- ════════════════════════════════════════════════════════════
-- PROJECT-SCOPING — BATCH 3, GROUP 3D: server-side isolation on client
-- health / promise dependent RPCs
-- 2026-05-30.  ⚠️ REVIEW ONLY — DO NOT APPLY until approved.
-- ════════════════════════════════════════════════════════════
-- The dependent tables here (client_health_scores, client_health_history,
-- payment_promises) keep project_id NULLABLE by design (Batch 1 — never break
-- a writer). So the gate runs via the PARENT client.project_id join.
--
-- FLAG: get_client_promise_history takes only p_client_id (no p_company_id)
-- and has no company gate today. v_pids is resolved by user_id alone (like
-- get_client_360), and the client lookup also gives us company_id.
-- Anon (no session) stays PERMISSIVE.

-- ── 1. get_client_health_score (parent client join) ────────
CREATE OR REPLACE FUNCTION public.get_client_health_score(p_client_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
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
  SELECT COALESCE(to_jsonb(h), 'null'::jsonb)
  FROM (
    SELECT chs.* FROM public.client_health_scores chs
    JOIN public.clients c ON c.id = chs.client_id AND c.company_id = chs.company_id
    CROSS JOIN cfg
    WHERE chs.client_id = p_client_id AND chs.company_id = p_company_id
      AND (cfg.v_all OR c.project_id = ANY(cfg.v_pids))
    ORDER BY chs.last_calculated DESC NULLS LAST
    LIMIT 1
  ) h;
$function$;

-- ── 2. get_client_health_history (parent client join) ─────
CREATE OR REPLACE FUNCTION public.get_client_health_history(p_client_id uuid, p_company_id uuid, p_limit integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
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
  SELECT COALESCE(jsonb_agg(row_to_json(h) ORDER BY h.calculated_at ASC), '[]'::jsonb)
  FROM (
    SELECT chh.score, chh.category, chh.total_exposure, chh.calculated_at
    FROM public.client_health_history chh
    JOIN public.clients c ON c.id = chh.client_id AND c.company_id = chh.company_id
    CROSS JOIN cfg
    WHERE chh.client_id = p_client_id AND chh.company_id = p_company_id
      AND (cfg.v_all OR c.project_id = ANY(cfg.v_pids))
    ORDER BY chh.calculated_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 30), 365))
  ) h;
$function$;

-- ── 3. get_client_promise_history (no p_company_id; v_pids by user_id; parent gate) ──
CREATE OR REPLACE FUNCTION public.get_client_promise_history(p_client_id uuid, p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result  JSONB;
  v_kept    INT;
  v_broken  INT;
  v_total   INT;
  v_pending INT;
  v_me      public.app_users := public._rms_caller();
  v_all     boolean := (v_me.id IS NULL) OR public._rms_is_admin(v_me);
  v_pids    uuid[];
  v_proj    uuid;
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE user_id = v_me.id AND is_active;
  END IF;

  -- Early gate via parent client
  SELECT project_id INTO v_proj FROM public.clients WHERE id = p_client_id;
  IF v_proj IS NULL OR (NOT v_all AND NOT (v_proj = ANY(v_pids))) THEN
    RETURN jsonb_build_object(
      'promises', '[]'::jsonb,
      'stats', jsonb_build_object('total',0,'kept',0,'broken',0,'pending',0,'kept_pct',0));
  END IF;

  SELECT COUNT(*),
    COUNT(*) FILTER (WHERE status IN ('kept','partial')),
    COUNT(*) FILTER (WHERE status = 'broken'),
    COUNT(*) FILTER (WHERE status = 'pending')
  INTO v_total, v_kept, v_broken, v_pending
  FROM payment_promises WHERE client_id = p_client_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', pp.id, 'promised_amount', pp.promised_amount, 'promise_date', pp.promise_date,
    'status', pp.status, 'promised_via', pp.promised_via, 'logged_by', pp.logged_by,
    'notes', pp.notes, 'broken_reason', pp.broken_reason,
    'actual_paid_amount', COALESCE(pp.actual_paid_amount, 0),
    'actual_paid_date', pp.actual_paid_date, 'created_at', pp.created_at
  ) ORDER BY pp.created_at DESC), '[]'::JSONB)
  INTO v_result
  FROM payment_promises pp WHERE pp.client_id = p_client_id
  LIMIT COALESCE(p_limit, 20);

  RETURN jsonb_build_object(
    'promises', COALESCE(v_result, '[]'::JSONB),
    'stats', jsonb_build_object(
      'total', v_total, 'kept', v_kept, 'broken', v_broken, 'pending', v_pending,
      'kept_pct', CASE WHEN v_total > 0 THEN ROUND(v_kept::NUMERIC / v_total * 100) ELSE 0 END
    )
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('promises','[]'::JSONB,'stats',jsonb_build_object('total',0,'kept',0,'broken',0,'pending',0,'kept_pct',0));
END;
$function$;
