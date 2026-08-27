-- ══ An accounts desk belongs to a project ═══════════════════════════════════
--
-- Collection fell back to the whole dealer group whenever the login had no RMS
-- assignment, so KBH's accounts clerk was being shown FMH's money. Recovery has
-- never done that — its book comes from user_project_assignments and nothing
-- else — and accounts now works the same way. No assignment, no fallback: the
-- screen says so and names who fixes it.

DO $do$
DECLARE v_src text; v_old text; v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
    FROM pg_proc WHERE proname = 'portal_accounts_summary' AND pronamespace = 'public'::regnamespace;

  v_old := '  v_m1 := date_trunc(''month'', v_day)::date;
  SELECT dealer_group_id INTO v_group FROM public.companies WHERE id = v_ses.company_id;

  -- An assignment narrows; its absence means the whole group.
  SELECT array_agg(upa.project_id) INTO v_projects
    FROM public.user_project_assignments upa
   WHERE upa.user_id = v_su.app_user_id AND upa.is_active;

  IF v_projects IS NULL THEN
    SELECT array_agg(p.id) INTO v_projects
      FROM public.projects p JOIN public.companies c ON c.id = p.company_id
     WHERE (v_group IS NOT NULL AND c.dealer_group_id = v_group)
        OR c.id = v_ses.company_id;
  END IF;
';
  v_new := '  v_m1 := date_trunc(''month'', v_day)::date;

  -- The assignment IS the scope. A desk that is not on a project is not shown
  -- another project''s money.
  IF v_su.app_user_id IS NULL THEN
    RETURN jsonb_build_object(''success'', false, ''error'', ''not_linked'',
      ''message'', ''Your portal login is not joined to your RMS accounts user yet. Please ask the office.'');
  END IF;

  SELECT array_agg(upa.project_id) INTO v_projects
    FROM public.user_project_assignments upa
   WHERE upa.user_id = v_su.app_user_id AND upa.is_active;

  IF v_projects IS NULL THEN
    RETURN jsonb_build_object(''success'', false, ''error'', ''no_project'',
      ''message'', ''No project is assigned to your RMS accounts user yet. Please ask the office.'');
  END IF;
';
  IF position(v_old IN v_src) = 0 THEN
    RAISE EXCEPTION 'portal_accounts_summary does not scope the way this expects — refusing to guess';
  END IF;
  EXECUTE replace(v_src, v_old, v_new);
END $do$;

-- The month's billing view is replaced on screen by the Grand Summary, so the
-- RPC behind it goes rather than sitting on the anon surface unused.
DROP FUNCTION IF EXISTS public.portal_accounts_billing(text, date);
