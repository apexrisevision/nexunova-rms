-- ============================================================================
-- get_my_profile also hands back the two CNIC scans.
-- ----------------------------------------------------------------------------
-- "My record" now shows a person their own personnel file, and the identity
-- half of that file comes from KYC sign-up. The photograph was already
-- returned here; the front and back of the CNIC were captured at the same
-- moment, stored on the same row, and then never given back to the person who
-- provided them.
--
-- Nothing else changes. The function is still session-scoped and STABLE: it
-- resolves the caller's own sales_users row from their session token and can
-- only ever describe that one person, so this adds nothing to what the caller
-- was already entitled to see about themselves.
--
-- CREATE OR REPLACE keeps the existing grants, so the portal (which calls this
-- as `anon`, holding only a session token) is unaffected.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_my_profile(p_session_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_su public.sales_users; v_co text;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT * INTO v_su FROM public.sales_users WHERE id=v_ses.sales_user_id;
  SELECT COALESCE(display_name, company_name) INTO v_co FROM public.companies WHERE id=v_su.company_id;
  RETURN jsonb_build_object('success',true,'profile', jsonb_build_object(
    'full_name', v_su.full_name, 'father_name', v_su.father_name, 'phone', v_su.phone,
    'email', v_su.email, 'email_verified', v_su.email_verified, 'email_verified_at', v_su.email_verified_at,
    'address', v_su.address, 'cnic', v_su.cnic,
    'role', v_su.role, 'parent_sales_user_id', v_su.parent_sales_user_id, 'kyc_status', v_su.kyc_status,
    'bank_name', v_su.bank_name, 'bank_account_no', v_su.bank_account_no, 'bank_account_title', v_su.bank_account_title,
    'profile_photo_url', v_su.profile_photo_url,
    'cnic_front_url', v_su.cnic_front_url, 'cnic_back_url', v_su.cnic_back_url,
    'company_name', v_co,
    'last_login_at', v_su.last_login_at, 'created_at', v_su.created_at));
END $function$;
