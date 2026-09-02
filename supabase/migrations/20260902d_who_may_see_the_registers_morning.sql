-- ═══════════════════════════════════════════════════════════════════════════
-- Who may see the register's morning
-- ───────────────────────────────────────────────────────────────────────────
-- The day's attendance report is a WHOLE COMPANY's figures — how many came, how
-- many were late, how many did not come at all. Every other portal action
-- through the attendance bridge answers for ONE person about themselves, and
-- the one action that hands back a whole company (employees) deliberately
-- refuses a portal token and demands a real admin session instead.
--
-- So this is not something to hand to whoever happens to be pointed at the
-- register. It is an explicit permission, off for everybody, switched on per
-- person. Amar Taj runs Fourteen Manzil Height and is the reason the report
-- exists; he is the only one turned on here. Widening it later is one UPDATE
-- and leaves a trail, which is the point of doing it this way rather than
-- inferring it from a role that was never meant to carry it.
--
-- Reversible: set the column false, or drop it — nothing else reads it.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.sales_users
  ADD COLUMN IF NOT EXISTS attend_daily_report boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.sales_users.attend_daily_report IS
  'May this portal user see their attendance register''s whole-company daily report? Off by default — these are company-wide figures, not the holder''s own record.';

-- The bridge asks this one question at the start of every portal call, so the
-- answer travels with the rest of the context instead of needing a second trip.
CREATE OR REPLACE FUNCTION public.portal_attendance_context(p_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user public.sales_users%ROWTYPE;
  v_link public.attendance_link%ROWTYPE;
  v_proj uuid;
BEGIN
  SELECT su.* INTO v_user
    FROM public.sales_sessions ss
    JOIN public.sales_users su ON su.id = ss.sales_user_id
   WHERE ss.session_token = p_session_token
     AND ss.expires_at > now();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'session_invalid');
  END IF;
  IF COALESCE(v_user.status, 'active') <> 'active' OR v_user.is_active IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'user_inactive');
  END IF;

  -- Where this person attends: the office set for them if there is one, else
  -- the project they work. Under the umbrella everybody shares one company row,
  -- so the project is what distinguishes them.
  v_proj := COALESCE(v_user.attend_project_id, v_user.home_project_id);

  IF v_proj IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_project',
                              'sales_user_name', v_user.full_name);
  END IF;

  SELECT * INTO v_link FROM public.attendance_link WHERE project_id = v_proj;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_linked');
  END IF;
  IF NOT v_link.is_enabled THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'link_disabled');
  END IF;
  IF COALESCE(btrim(v_user.cnic), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_cnic',
                              'sales_user_name', v_user.full_name);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'sales_user_id', v_user.id,
    'sales_user_name', v_user.full_name,
    'cnic', v_user.cnic,
    'attend_company_id', v_link.attend_company_id,
    'attend_company_name', v_link.attend_company_name,
    'may_see_daily_report', COALESCE(v_user.attend_daily_report, false)
  );
END;
$function$;

-- Amar Taj — Fourteen Manzil Height. The report was asked for on his login.
UPDATE public.sales_users
   SET attend_daily_report = true
 WHERE id = 'c94705b2-842b-48a9-801d-c373044974cd';
