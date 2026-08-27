-- ============================================================================
-- What the link screen opens with: every portal login, and whether anybody has
-- said yet which employee it is.
-- ----------------------------------------------------------------------------
-- A separate read rather than three more columns bolted onto
-- list_sales_users_admin, which half the Sales Access page already depends on.
-- This card is new; it can have its own query and leave the old one alone.
--
-- cnic_digits travels with each row because the matching happens in the
-- browser, against the roster the bridge fetched, and the two systems punctuate
-- the same number differently. Comparing digits is the only comparison that
-- means anything — 17301-3400733-2 and 1730134007332 are the same person.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_link_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_u public.app_users;
BEGIN
  v_u := public._rms_caller();
  IF v_u.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not_signed_in'); END IF;
  IF NOT public._rms_is_admin(v_u) THEN RETURN jsonb_build_object('success', false, 'error', 'not_an_admin'); END IF;

  RETURN jsonb_build_object('success', true, 'users', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id',                 su.id,
             'full_name',          su.full_name,
             'phone',              su.phone,
             'cnic',               su.cnic,
             'cnic_digits',        NULLIF(regexp_replace(COALESCE(su.cnic, ''), '[^0-9]', '', 'g'), ''),
             'role',               su.role,
             'status',             su.status,
             'attend_employee_id', su.attend_employee_id,
             'attend_linked_at',   su.attend_linked_at,
             'attend_project_id',  su.attend_project_id)
           -- Unlinked first: the screen exists to empty that list.
           ORDER BY (su.attend_employee_id IS NOT NULL), su.full_name)
      FROM public.sales_users su
     WHERE su.company_id = v_u.company_id
       AND su.status <> 'pending'), '[]'::jsonb));
END $function$;

REVOKE ALL ON FUNCTION public.admin_link_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_link_overview() TO authenticated, service_role;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_link_overview()', 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_link_overview is reachable with the publishable key';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_link_overview()', 'EXECUTE') THEN
    RAISE EXCEPTION 'the admin app could not call admin_link_overview';
  END IF;
END $$;
