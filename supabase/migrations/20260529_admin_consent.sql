-- ════════════════════════════════════════════════════════════
-- Admin-visibility CONSENT layer  (applied 2026-05-29)
-- ════════════════════════════════════════════════════════════
-- Requirement (Rashid, 2026-05-29):
--   The company Admin/Owner ALWAYS keeps administrative authority over every
--   user — create/delete account, reset forgotten password, assign rights &
--   site assignments. That is NOT gated by consent.
--   BUT to *see* a user's dashboard DATA + ACTIVITY in the Command Center,
--   the user must one-time ACCEPT the admin (opt-in). Decision model:
--     • Forced on first login (must answer YES/NO, cannot skip)
--     • Revocable later from the sidebar "Data sharing" menu
--     • Strictly per-user (one officer's NO never exposes another's data,
--       and one officer's YES never exposes another's site stewardship)
--     • On NO/PENDING → that user's activity is masked AND any project they
--       solely steward is hidden from the admin's Command Center aggregates.
--
-- Visibility rules implemented here:
--   1. Per-user ACTIVITY  → cc_team_activity / cc_user_contacts gate on
--      user_admin_consent.status = 'granted' (admins/owners are 'self' = always shown).
--   2. Per-site DATA      → cc_command_center hides a project's overdue/due figures
--      when the project is "hidden": it has ≥1 non-admin steward and NONE of those
--      stewards have granted. Projects with no non-admin steward (admin-run) stay visible.
--
-- "no row = pending" (no pre-seed needed; new users start pending automatically).
-- Scope note: this gates the COMMAND CENTER surface only. The standalone Reports
-- module + other admin RPCs are not consent-gated (separate follow-up if desired).

-- ── 1. Consent table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_admin_consent (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','granted','declined')),
  decided_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, user_id)
);

ALTER TABLE public.user_admin_consent ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_all_anon ON public.user_admin_consent;
CREATE POLICY deny_all_anon ON public.user_admin_consent
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP TRIGGER IF EXISTS trg_user_admin_consent_upd ON public.user_admin_consent;
CREATE TRIGGER trg_user_admin_consent_upd
  BEFORE UPDATE ON public.user_admin_consent
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS _trg_audit ON public.user_admin_consent;
CREATE TRIGGER _trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.user_admin_consent
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

CREATE INDEX IF NOT EXISTS idx_uac_company_status ON public.user_admin_consent (company_id, status);

-- ── 2. Helper: projects hidden from the admin's Command Center ───────
-- A project is hidden when it has at least one assigned non-admin steward and
-- NONE of those stewards have granted consent. Projects with no non-admin
-- steward (admin-run) are never hidden.
CREATE OR REPLACE FUNCTION public._cc_hidden_project_ids(p_company_id uuid)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(array_agg(pid), ARRAY[]::uuid[]) FROM (
    SELECT upa.project_id AS pid
    FROM user_project_assignments upa
    JOIN app_users u ON u.id = upa.user_id
    WHERE u.company_id = p_company_id
      AND COALESCE(u.is_super_admin,false) = false
      AND u.role NOT IN ('owner','admin')
    GROUP BY upa.project_id
    HAVING bool_or(EXISTS (
      SELECT 1 FROM user_admin_consent uac
      WHERE uac.company_id = p_company_id AND uac.user_id = upa.user_id AND uac.status = 'granted'
    )) = false
  ) q;
$function$;

-- ── 3. Session RPC: my consent status (drives the login modal) ───────
CREATE OR REPLACE FUNCTION public.get_my_consent_status()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  me public.app_users;
  v_status text;
  v_admin_name text;
BEGIN
  me := public._rms_caller();
  IF me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_session');
  END IF;

  -- Admins/owners/super-admins are the VIEWER — never asked for consent.
  IF public._rms_is_admin(me) THEN
    RETURN jsonb_build_object('success', true, 'applicable', false, 'status', 'not_applicable');
  END IF;

  SELECT status INTO v_status
  FROM public.user_admin_consent
  WHERE company_id = me.company_id AND user_id = me.id;
  v_status := COALESCE(v_status, 'pending');

  -- Who they would be consenting to: the company owner, else first active admin/owner.
  SELECT COALESCE(u.full_name, u.username) INTO v_admin_name
  FROM public.companies c
  LEFT JOIN public.app_users u ON u.id = c.owner_user_id
  WHERE c.id = me.company_id;

  IF v_admin_name IS NULL THEN
    SELECT COALESCE(full_name, username) INTO v_admin_name
    FROM public.app_users
    WHERE company_id = me.company_id AND role IN ('owner','admin')
      AND COALESCE(status,'active') = 'active'
    ORDER BY (role = 'owner') DESC, created_at
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'success',        true,
    'applicable',     true,
    'status',         v_status,
    'needs_decision', (v_status = 'pending'),
    'admin_name',     COALESCE(v_admin_name, 'your administrator'),
    'company_name',   (SELECT company_name FROM public.companies WHERE id = me.company_id)
  );
END
$function$;

-- ── 4. Session RPC: set my consent (grant / decline / revoke) ────────
CREATE OR REPLACE FUNCTION public.set_my_consent(p_granted boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  me public.app_users;
  v_status text;
BEGIN
  me := public._rms_caller();
  IF me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_session');
  END IF;
  IF public._rms_is_admin(me) THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_applicable');
  END IF;

  v_status := CASE WHEN p_granted THEN 'granted' ELSE 'declined' END;

  INSERT INTO public.user_admin_consent (company_id, user_id, status, decided_at)
  VALUES (me.company_id, me.id, v_status, now())
  ON CONFLICT (company_id, user_id)
  DO UPDATE SET status = EXCLUDED.status, decided_at = now();

  RETURN jsonb_build_object('success', true, 'status', v_status);
END
$function$;

-- ════════════════════════════════════════════════════════════
-- 5. Gated Command Center RPCs (supersede 20260529_cc_team_activity.sql
--    + 20260529_command_center_rpcs.sql with consent gating)
-- ════════════════════════════════════════════════════════════

-- 5a. Team Activity — mask non-granted users -------------------------
CREATE OR REPLACE FUNCTION public.cc_team_activity(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_start timestamptz := date_trunc('day', now() AT TIME ZONE 'Asia/Karachi') AT TIME ZONE 'Asia/Karachi';
  v_today date := (now() AT TIME ZONE 'Asia/Karachi')::date;
  v jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row ORDER BY shown DESC, mins DESC), '[]'::jsonb) INTO v
  FROM (
    SELECT
      ( is_admin OR cons_status = 'granted' )                                   AS shown,
      COALESCE(GREATEST(0, ROUND(EXTRACT(EPOCH FROM (act.last_ts - act.first_ts)) / 60))::int, 0) AS mins,
      jsonb_build_object(
        'id',             u.id,
        'name',           COALESCE(u.full_name, u.username, 'User'),
        'role',           u.role,
        'consent',        CASE WHEN is_admin THEN 'self' ELSE cons_status END,
        'login_today',    CASE WHEN shown_flag THEN COALESCE(act.first_login, act.first_ts) END,
        'online',         CASE WHEN shown_flag THEN
                            ( (act.last_ts IS NOT NULL AND act.last_ts > now() - interval '10 minutes')
                              OR EXISTS (SELECT 1 FROM user_sessions se WHERE se.user_id = u.id
                                          AND se.revoked_at IS NULL AND se.expires_at > now()
                                          AND se.last_seen_at > now() - interval '15 minutes') )
                          ELSE false END,
        'minutes_today',  CASE WHEN shown_flag THEN COALESCE(GREATEST(0, ROUND(EXTRACT(EPOCH FROM (act.last_ts - act.first_ts)) / 60))::int, 0) END,
        'actions_today',  CASE WHEN shown_flag THEN COALESCE(act.actions, 0) END,
        'contacts_today', CASE WHEN shown_flag THEN COALESCE(ct.cnt, 0) END,
        'call_minutes',   CASE WHEN shown_flag THEN COALESCE(ct.mins, 0) END
      ) AS row
    FROM app_users u
    CROSS JOIN LATERAL (
      SELECT (u.role IN ('owner','admin') OR COALESCE(u.is_super_admin,false)) AS is_admin,
             COALESCE((SELECT status FROM user_admin_consent c
                        WHERE c.company_id = u.company_id AND c.user_id = u.id), 'pending') AS cons_status
    ) cc
    CROSS JOIN LATERAL (
      SELECT (cc.is_admin OR cc.cons_status = 'granted') AS shown_flag
    ) sf
    LEFT JOIN LATERAL (
      SELECT MIN(ts) AS first_ts, MAX(ts) AS last_ts,
             MIN(ts) FILTER (WHERE kind = 'login') AS first_login,
             COUNT(*) FILTER (WHERE kind = 'action') AS actions
      FROM (
        SELECT ae.created_at AS ts, 'login'  AS kind FROM auth_events ae
          WHERE ae.user_id = u.id AND ae.event_type ILIKE '%login%' AND ae.created_at >= v_start
        UNION ALL
        SELECT al.changed_at, 'action' FROM audit_logs al
          WHERE al.company_id = p_company_id AND al.changed_by_name = COALESCE(u.full_name, u.username) AND al.changed_at >= v_start
        UNION ALL
        SELECT se.created_at, 'session' FROM user_sessions se WHERE se.user_id = u.id AND se.created_at >= v_start
        UNION ALL
        SELECT se.last_seen_at, 'seen' FROM user_sessions se WHERE se.user_id = u.id AND se.last_seen_at >= v_start
        UNION ALL
        SELECT c.created_at, 'contact' FROM contact_logs c
          WHERE c.company_id = p_company_id AND (c.created_by = u.id::text OR c.recovery_agent_id = u.id) AND c.created_at >= v_start
      ) e
    ) act ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS cnt, COALESCE(SUM(c.duration_minutes), 0) AS mins
      FROM contact_logs c
      WHERE c.company_id = p_company_id AND (c.created_by = u.id::text OR c.recovery_agent_id = u.id) AND c.contact_date = v_today
    ) ct ON true
    WHERE u.company_id = p_company_id
      AND COALESCE(u.status, 'active') NOT IN ('inactive','suspended','deleted')
      AND COALESCE(u.is_super_admin, false) = false
  ) q;
  RETURN v;
END
$function$;

-- 5b. Per-user contact drill-down — empty unless granted/admin ------
CREATE OR REPLACE FUNCTION public.cc_user_contacts(p_company_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'client',  COALESCE(c.client_name, '—'),
    'channel', c.channel,
    'time',    COALESCE(c.contact_time::text, to_char(c.created_at AT TIME ZONE 'Asia/Karachi', 'HH24:MI')),
    'status',  COALESCE(c.call_status, c.status_tag, c.response_type),
    'minutes', c.duration_minutes,
    'promise', c.promise_amount,
    'next',    c.next_action
  ) ORDER BY c.created_at DESC), '[]'::jsonb)
  FROM contact_logs c
  WHERE c.company_id = p_company_id
    AND (c.created_by = p_user_id::text OR c.recovery_agent_id = p_user_id)
    AND c.contact_date = (now() AT TIME ZONE 'Asia/Karachi')::date
    AND EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.id = p_user_id AND u.company_id = p_company_id
        AND ( u.role IN ('owner','admin') OR COALESCE(u.is_super_admin,false)
              OR EXISTS (SELECT 1 FROM user_admin_consent uac
                          WHERE uac.company_id = p_company_id AND uac.user_id = p_user_id AND uac.status = 'granted') )
    );
$function$;

-- 5c. Command Center aggregates — hide non-consented projects -------
CREATE OR REPLACE FUNCTION public.cc_command_center(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_clients_90d int := 0;
  v_amount_90d  numeric := 0;
  v_inst_3d_cnt int := 0;
  v_inst_3d_amt numeric := 0;
  v_radar_today numeric := NULL;
  v_radar_yest  numeric := NULL;
  v_hidden uuid[] := public._cc_hidden_project_ids(p_company_id);
BEGIN
  -- Distinct clients with any unpaid installment > 90 days overdue (legal threshold)
  SELECT COUNT(DISTINCT s.client_id),
         COALESCE(SUM(i.amount_due - COALESCE(i.amount_paid,0)), 0)
    INTO v_clients_90d, v_amount_90d
  FROM installments i
  JOIN sales s ON s.id = i.sale_id
  WHERE i.company_id = p_company_id
    AND (i.amount_due - COALESCE(i.amount_paid,0)) > 0
    AND i.due_date < CURRENT_DATE - 90
    AND COALESCE(s.status,'active') <> 'cancelled'
    AND (s.project_id IS NULL OR NOT (s.project_id = ANY(v_hidden)));

  -- Unpaid installments due within the next 3 days (today .. today+3)
  SELECT COUNT(*),
         COALESCE(SUM(i.amount_due - COALESCE(i.amount_paid,0)), 0)
    INTO v_inst_3d_cnt, v_inst_3d_amt
  FROM installments i
  WHERE i.company_id = p_company_id
    AND (i.amount_due - COALESCE(i.amount_paid,0)) > 0
    AND i.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 3
    AND (i.project_id IS NULL OR NOT (i.project_id = ANY(v_hidden)));

  -- Average radar score today & yesterday (company health index — not project-scoped)
  SELECT AVG((e->>'final_score')::numeric) INTO v_radar_today
  FROM recovery_radar_logs r
  CROSS JOIN LATERAL jsonb_array_elements(r.top_clients) e
  WHERE r.company_id = p_company_id AND r.generated_date = CURRENT_DATE;

  SELECT AVG((e->>'final_score')::numeric) INTO v_radar_yest
  FROM recovery_radar_logs r
  CROSS JOIN LATERAL jsonb_array_elements(r.top_clients) e
  WHERE r.company_id = p_company_id AND r.generated_date = CURRENT_DATE - 1;

  RETURN jsonb_build_object(
    'clients_90d_overdue', v_clients_90d,
    'amount_90d_overdue',  v_amount_90d,
    'installments_due_3d', v_inst_3d_cnt,
    'amount_due_3d',       v_inst_3d_amt,
    'radar_avg_today',     CASE WHEN v_radar_today IS NULL THEN NULL ELSE ROUND(v_radar_today) END,
    'radar_avg_yesterday', CASE WHEN v_radar_yest  IS NULL THEN NULL ELSE ROUND(v_radar_yest)  END
  );
END
$function$;

-- ── Grants (mirror existing cc_* + new session RPCs) ─────────────────
GRANT EXECUTE ON FUNCTION public._cc_hidden_project_ids(uuid)   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cc_team_activity(uuid)         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cc_user_contacts(uuid, uuid)   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cc_command_center(uuid)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_consent_status()        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_consent(boolean)        TO anon, authenticated;
