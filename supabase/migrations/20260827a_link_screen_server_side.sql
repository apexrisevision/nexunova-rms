-- ============================================================================
-- The two calls the link screen stands on.
-- ----------------------------------------------------------------------------
-- Somebody has to sit down with two lists — the people who can sign into the
-- portal, and the people the attendance register knows — and say which row is
-- which person. These are the server halves of that: one decides whether the
-- person asking is allowed to see a staff roster at all, and the other writes
-- down the answer they give.
--
-- Deliberately split, because they are guarded differently.
--
--   admin_attendance_context is called by the bridge with the SERVICE key,
--   after the bridge has checked a real Supabase Auth token for itself. It
--   therefore takes the caller's auth id as a PARAMETER, which would be an
--   impersonation hole if anybody but a server could call it — so it is granted
--   to service_role and to nothing else. Not anon, not authenticated.
--
--   admin_link_sales_user is called from the admin app in the browser, so it
--   trusts nothing it is told about who is calling: it resolves auth.uid()
--   itself through _rms_caller().
--
-- Which registers may an administrator read? Not "any that exist" — that would
-- let one company list another's staff. The rule is that the attendance tenant
-- must be one their own business already reaches: a project their company owns,
-- or one their own portal users are already pointed at. Today that gives Awami
-- the KBH register, which is where its people actually punch.
--
-- Known gap, stated rather than hidden: FMH's register is reachable by neither
-- test, because no portal user points at it yet. The first FMH link will have
-- to be made by setting one user's attend_project_id by hand; after that the
-- screen opens by itself.
-- ============================================================================

-- ── who is asking, and which registers may they read ────────────────────────
CREATE OR REPLACE FUNCTION public.admin_attendance_context(
  p_auth_user_id uuid,
  p_project_id   uuid DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_u public.app_users; v_rows jsonb;
BEGIN
  IF p_auth_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  END IF;

  SELECT * INTO v_u FROM public.app_users
   WHERE auth_user_id = p_auth_user_id AND status = 'active' LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  END IF;
  IF NOT public._rms_is_admin(v_u) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_an_admin');
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'project_id',          p.id,
           'project_name',        p.project_name,
           'attend_company_id',   al.attend_company_id,
           'attend_company_name', al.attend_company_name)
         ORDER BY p.project_name)
    INTO v_rows
    FROM public.projects p
    JOIN public.attendance_link al ON al.project_id = p.id AND al.is_enabled
   WHERE p.company_id = v_u.company_id
      OR p.id IN (SELECT su.attend_project_id FROM public.sales_users su
                   WHERE su.company_id = v_u.company_id AND su.attend_project_id IS NOT NULL);

  v_rows := COALESCE(v_rows, '[]'::jsonb);

  IF p_project_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'company_id', v_u.company_id, 'registers', v_rows);
  END IF;

  -- Asking for one in particular: it must be one of the ones just allowed.
  RETURN COALESCE((
    SELECT jsonb_build_object('ok', true, 'company_id', v_u.company_id) || r
      FROM jsonb_array_elements(v_rows) AS r
     WHERE (r->>'project_id')::uuid = p_project_id
     LIMIT 1
  ), jsonb_build_object('ok', false, 'reason', 'register_not_yours'));
END $function$;

-- ── writing down that these two rows are one person ─────────────────────────
CREATE OR REPLACE FUNCTION public.admin_link_sales_user(
  p_sales_user_id uuid,
  p_employee_id   uuid,          -- NULL to break an existing link
  p_project_id    uuid DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_u public.app_users; v_su public.sales_users;
BEGIN
  v_u := public._rms_caller();
  IF v_u.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not_signed_in'); END IF;
  IF NOT public._rms_is_admin(v_u) THEN RETURN jsonb_build_object('success', false, 'error', 'not_an_admin'); END IF;

  SELECT * INTO v_su FROM public.sales_users WHERE id = p_sales_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'no_such_user'); END IF;
  IF v_su.company_id IS DISTINCT FROM v_u.company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;

  -- One employee, one login. The unique index already refuses this; catching it
  -- here turns a raw 23505 into a sentence the screen can show.
  IF p_employee_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.sales_users s
        WHERE s.attend_employee_id = p_employee_id AND s.id <> p_sales_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_linked',
      'message', 'That employee is already linked to another portal user.');
  END IF;

  UPDATE public.sales_users
     SET attend_employee_id = p_employee_id,
         attend_linked_at   = CASE WHEN p_employee_id IS NULL THEN NULL ELSE now() END,
         attend_project_id  = COALESCE(p_project_id, attend_project_id)
   WHERE id = p_sales_user_id;

  RETURN jsonb_build_object('success', true, 'linked', p_employee_id IS NOT NULL);
END $function$;

-- ── grants: each call gets only the door it uses ────────────────────────────
-- REVOKE FROM PUBLIC, not just from anon: a fresh function's EXECUTE goes to
-- PUBLIC, and anon inherits it from there.
REVOKE ALL ON FUNCTION public.admin_attendance_context(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_attendance_context(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.admin_link_sales_user(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_link_sales_user(uuid, uuid, uuid) TO authenticated, service_role;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_attendance_context(uuid, uuid)', 'EXECUTE')
  OR has_function_privilege('authenticated', 'public.admin_attendance_context(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_attendance_context takes the caller''s id as a parameter and must be server-only';
  END IF;
  IF has_function_privilege('anon', 'public.admin_link_sales_user(uuid, uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_link_sales_user is reachable with the publishable key';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_link_sales_user(uuid, uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'the admin app could not call admin_link_sales_user';
  END IF;
END $$;
