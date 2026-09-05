-- ════════════════════════════════════════════════════════════════════════
-- NexuFinance — the caller's own context, in one call
-- ────────────────────────────────────────────────────────────────────────
-- WHY THIS EXISTS
--
-- The cash book is moving out of the RMS shell and onto its own page. That
-- page has no RMS session object to read a company id out of — and it must
-- not have one, because reading `S.cid` off a global it did not own is what
-- sent p_company_id: undefined to PostgREST for a week.
--
-- Every other Daily Closing RPC takes p_company_id as its first argument, so
-- something has to answer "which company is this person in?" before any of
-- them can be called. `app_users` cannot be read directly: its only policy is
-- deny_all_anon over {anon, authenticated}, which is the PATH_B lockdown
-- working exactly as intended.
--
-- So the boot needs one caller-resolved call with NO arguments, the same
-- shape get_my_feature_flags() already uses. This is it.
--
-- SCOPE. Read-only. Returns nothing a caller could not already obtain through
-- get_my_daily_closing_access once they knew their own company id. It grants
-- no new reach: a person with no Daily Closing role gets role NULL and an
-- empty project list, exactly as the access RPC does.
--
-- SHAPE. Always the same keys, present or absent, for the reason written into
-- get_my_daily_closing_access: a payload that changes shape makes every
-- consumer test for undefined, and undefined is falsy until somebody writes
-- !== false.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_my_daily_closing_context()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me       public.app_users := public._rms_caller();
  v_role     text;
  v_company  public.companies;
  v_projects jsonb;
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'NOT_AUTHORIZED',
      'company_id', NULL, 'company_name', NULL, 'display_name', NULL,
      'user_id', NULL, 'full_name', NULL, 'role', NULL, 'projects', '[]'::jsonb);
  END IF;

  SELECT * INTO v_company FROM public.companies WHERE id = v_me.company_id;
  v_role := public._dc_role(v_me);

  -- The projects this person may actually look at, decided by the same
  -- predicate the rest of the module uses. A NULL role yields an empty list
  -- rather than a refusal, so the page can say "you have no cash book here"
  -- instead of showing an error it cannot explain.
  SELECT COALESCE(jsonb_agg(x ORDER BY x.project_name), '[]'::jsonb) INTO v_projects FROM (
    SELECT p.id AS project_id, p.project_name
      FROM public.projects p
     WHERE p.company_id = v_me.company_id
       AND v_role IS NOT NULL
       AND public._dc_may_view(v_me, v_me.company_id, p.id)
  ) x;

  RETURN jsonb_build_object(
    'success',      true,
    'company_id',   v_me.company_id,
    'company_name', v_company.company_name,
    'display_name', COALESCE(v_company.display_name, v_company.company_name),
    'user_id',      v_me.id,
    'full_name',    v_me.full_name,
    'role',         v_role,
    'projects',     v_projects);
END;
$function$;

-- Same grant posture as every other Daily Closing reader: the role that a
-- signed-in browser actually holds, and nothing wider. anon is not granted;
-- an unauthenticated caller has no _rms_caller() and would get
-- NOT_AUTHORIZED anyway, but the grant is the lock and the guard is the belt.
REVOKE ALL ON FUNCTION public.get_my_daily_closing_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_daily_closing_context() TO authenticated;

COMMENT ON FUNCTION public.get_my_daily_closing_context() IS
  'NexuFinance boot: the caller''s company, name, Daily Closing role and visible projects, resolved from auth.uid() with no arguments. Added 2026-09-06 so the standalone page never has to read a company id off a global it does not own.';
