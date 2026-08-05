-- check_session_valid: also hand back the caller's CURRENT role + module_permissions
-- so a running session picks up a Users&Roles grant on its next 5-minute poll
-- instead of forcing the user to log out and back in.
--
-- Authz: the validity answer keeps its old (id, version) contract, but role /
-- permissions are returned ONLY when p_user_id is the authenticated caller's own
-- app_users row. Passing someone else's id therefore leaks nothing new.
CREATE OR REPLACE FUNCTION public.check_session_valid(p_user_id uuid, p_session_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current_version INTEGER;
  v_caller          public.app_users;
  v_out             jsonb;
BEGIN
  SELECT session_version INTO v_current_version
  FROM public.app_users
  WHERE id = p_user_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false);
  END IF;

  v_out := jsonb_build_object('valid', v_current_version = p_session_version);

  v_caller := public._rms_caller();
  IF v_caller.id IS NOT NULL AND v_caller.id = p_user_id THEN
    v_out := v_out || jsonb_build_object(
      'role',        v_caller.role,
      'permissions', COALESCE(v_caller.module_permissions, '{}'::jsonb),
      'status',      v_caller.status
    );
  END IF;

  RETURN v_out;
END;
$function$;
