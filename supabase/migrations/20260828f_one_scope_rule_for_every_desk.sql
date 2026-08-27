-- ══ One scope rule for every desk ═══════════════════════════════════════════
--
-- The engineer's site was scoped as "the RMS assignment, or failing that the
-- person's own project tag". Accounts and recovery were scoped as "the RMS
-- assignment, or nothing" — so Muhammad Junaid, approved this evening as
-- accounts and tagged KHUSHAL BAGH HEIGHTS, opened Collection and was told to
-- go and ask the office, about a project the app already knew he was on.
--
-- That was an inconsistency of mine, not a policy. All four desk RPCs now use
-- _portal_own_projects: assignment first, own tag second, and never the group.
-- Only somebody with neither is told to ask the office.

-- ── accounts: the day's drawer ──────────────────────────────────────────────
DO $do$
DECLARE v_src text; v_old text; v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
    FROM pg_proc WHERE proname='portal_accounts_summary' AND pronamespace='public'::regnamespace;

  v_old := '  IF v_su.app_user_id IS NULL THEN
    RETURN jsonb_build_object(''success'', false, ''error'', ''not_linked'',
      ''message'', ''Your portal login is not joined to your RMS accounts user yet. Please ask the office.'');
  END IF;

  SELECT array_agg(upa.project_id) INTO v_projects
    FROM public.user_project_assignments upa
   WHERE upa.user_id = v_su.app_user_id AND upa.is_active;

  IF v_projects IS NULL THEN
    RETURN jsonb_build_object(''success'', false, ''error'', ''no_project'',
      ''message'', ''No project is assigned to your RMS accounts user yet. Please ask the office.'');
  END IF;';

  v_new := '  -- The RMS assignment if there is one, otherwise this person''''s own project
  -- tag. Never the whole group.
  v_projects := public._portal_own_projects(p_session_token);

  IF v_projects IS NULL THEN
    RETURN jsonb_build_object(''success'', false, ''error'', ''no_project'',
      ''message'', ''No project is set for you yet. Please ask the office.'');
  END IF;';

  IF position(v_old IN v_src) = 0 THEN
    RAISE EXCEPTION 'portal_accounts_summary does not scope the way this expects — refusing to guess';
  END IF;
  EXECUTE replace(v_src, v_old, v_new);
END $do$;

-- ── the three that loop project by project ──────────────────────────────────
DO $do$
DECLARE v_src text; v_old text; v_new text; f text; v_msg text; v_hit boolean;
BEGIN
  v_old := '  FOR r IN
    SELECT upa.company_id, upa.project_id, p.project_name
      FROM public.user_project_assignments upa
      JOIN public.projects p ON p.id = upa.project_id
     WHERE upa.user_id = v_su.app_user_id AND upa.is_active
     ORDER BY p.project_name
  LOOP';

  v_new := '  FOR r IN
    -- Assignment first, own project tag second, never the group.
    SELECT p.company_id, p.id AS project_id, p.project_name
      FROM public.projects p
     WHERE p.id = ANY(COALESCE(public._portal_own_projects(p_session_token), ''{}''::uuid[]))
     ORDER BY p.project_name
  LOOP';

  FOREACH f IN ARRAY ARRAY['portal_accounts_position','portal_recovery_summary','portal_recovery_position'] LOOP
    SELECT pg_get_functiondef(oid) INTO v_src
      FROM pg_proc WHERE proname=f AND pronamespace='public'::regnamespace;
    IF position(v_old IN v_src) = 0 THEN
      RAISE EXCEPTION '% does not loop the way this expects — refusing to guess', f;
    END IF;
    v_src := replace(v_src, v_old, v_new);

    -- and the guard that refused anyone without a desktop account
    v_hit := false;
    FOREACH v_msg IN ARRAY ARRAY[
      'Your portal login is not joined to your RMS accounts user yet. Please ask the office.',
      'Your portal login is not joined to your RMS recovery account yet. Please ask the office.'] LOOP
      IF position('''' || v_msg || '''' IN v_src) > 0 THEN
        v_src := replace(v_src,
          '  IF v_su.app_user_id IS NULL THEN
    RETURN jsonb_build_object(''success'', false, ''error'', ''not_linked'',
      ''message'', ''' || v_msg || ''');
  END IF;',
          '  IF public._portal_own_projects(p_session_token) IS NULL THEN
    RETURN jsonb_build_object(''success'', false, ''error'', ''no_project'',
      ''message'', ''No project is set for you yet. Please ask the office.'');
  END IF;');
        v_hit := true;
      END IF;
    END LOOP;
    IF NOT v_hit THEN
      RAISE EXCEPTION '% has no not_linked guard where this expects one — refusing to guess', f;
    END IF;

    EXECUTE v_src;
  END LOOP;
END $do$;
