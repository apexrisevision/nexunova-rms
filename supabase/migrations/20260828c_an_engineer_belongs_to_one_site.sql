-- ══ An engineer belongs to one site ═════════════════════════════════════════
--
-- Site listed every project in the dealer group and let the engineer set the
-- percentage on all of them, so KBH's engineer could quietly move FMH's floors.
-- Recovery and accounts are already scoped to the desk's own project; this is
-- the same rule for the site.
--
-- Where the scope comes from, in order:
--   1. the RMS project assignments, if the login is joined to a desktop user
--   2. otherwise the person's own project tag (home_project_id)
-- Neither ever widens to the group. Most engineers have no RMS account, so the
-- tag is what usually decides — and every portal user now carries one.

CREATE OR REPLACE FUNCTION public._portal_own_projects(p_session_token text)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_su public.sales_users; v_out uuid[];
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions
   WHERE session_token = p_session_token AND expires_at > now();
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_su FROM public.sales_users WHERE id = v_ses.sales_user_id;

  IF v_su.app_user_id IS NOT NULL THEN
    SELECT array_agg(upa.project_id) INTO v_out
      FROM public.user_project_assignments upa
     WHERE upa.user_id = v_su.app_user_id AND upa.is_active;
    IF v_out IS NOT NULL THEN RETURN v_out; END IF;
  END IF;

  IF v_su.home_project_id IS NOT NULL THEN RETURN ARRAY[v_su.home_project_id]; END IF;
  RETURN NULL;
END $function$;

REVOKE ALL ON FUNCTION public._portal_own_projects(text) FROM PUBLIC, anon, authenticated;

-- The list the Site screen offers: only what this person is responsible for.
-- short_code lives on projects, not on project_profile.
CREATE OR REPLACE FUNCTION public.portal_site_projects(p_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_ids uuid[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.sales_sessions
                  WHERE session_token = p_session_token AND expires_at > now()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_expired');
  END IF;

  v_ids := public._portal_own_projects(p_session_token);
  IF v_ids IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_project',
      'message', 'No project is assigned to you yet. Please ask the office.');
  END IF;

  RETURN jsonb_build_object('success', true,
    'projects', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'project_id', p.id, 'project_name', p.project_name,
               'short_code', p.short_code) ORDER BY p.project_name)
        FROM public.projects p
       WHERE p.id = ANY(v_ids)), '[]'::jsonb));
END $function$;

REVOKE ALL ON FUNCTION public.portal_site_projects(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_site_projects(text) TO anon;

-- Both progress RPCs stop accepting a project that is not this person's.
DO $do$
DECLARE v_src text; v_old text; v_new text; f text;
BEGIN
  v_old := '  SELECT dealer_group_id INTO v_group FROM public.companies WHERE id = v_ses.company_id;
  SELECT EXISTS (SELECT 1 FROM public.projects p JOIN public.companies c ON c.id = p.company_id
                  WHERE p.id = p_project_id
                    AND ((v_group IS NOT NULL AND c.dealer_group_id = v_group) OR c.id = v_ses.company_id))
    INTO v_ok;
  IF NOT v_ok THEN RETURN jsonb_build_object(''success'', false, ''error'', ''not_yours''); END IF;';
  v_new := '  -- The site is the one this person is responsible for, not the group''''s.
  SELECT p_project_id = ANY(COALESCE(public._portal_own_projects(p_session_token), ''{}''::uuid[]))
    INTO v_ok;
  IF NOT v_ok THEN RETURN jsonb_build_object(''success'', false, ''error'', ''not_yours'',
    ''message'', ''That project is not yours to record.''); END IF;';

  FOREACH f IN ARRAY ARRAY['portal_progress','portal_progress_set'] LOOP
    SELECT pg_get_functiondef(oid) INTO v_src
      FROM pg_proc WHERE proname = f AND pronamespace = 'public'::regnamespace;
    IF position(v_old IN v_src) = 0 THEN
      RAISE EXCEPTION '% does not scope the way this expects — refusing to guess', f;
    END IF;
    EXECUTE replace(v_src, v_old, v_new);
  END LOOP;
END $do$;
