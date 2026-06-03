-- 2026-06-03  Buyer-portal launch-blockers in portal_login:
--   (A) company match used  company_code = UPPER(TRIM(p_company_code))  but codes
--       are stored as-entered (e.g. lowercase 'albadar') → UPPER'd input never
--       matched → login impossible for any lowercase-coded tenant. Mirror
--       verify_login: normalize BOTH sides (company code + email identifier).
--   (B) SET search_path TO 'public' (only) — but pgcrypto's crypt/gen_salt/
--       gen_random_bytes live in the `extensions` schema, so the password-check
--       line threw 42883 → login could never succeed even with correct creds.
--       Fix: add 'extensions' to search_path (same as send_admin_reset_otp).
-- Body otherwise verbatim.

CREATE OR REPLACE FUNCTION public.portal_login(p_company_code text, p_email text, p_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_co  public.companies;
  v_pc  public.portal_clients;
  v_cl  public.clients;
  v_tok text;
BEGIN
  SELECT * INTO v_co FROM public.companies
  WHERE LOWER(company_code) = LOWER(TRIM(p_company_code)) AND status = 'active';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'error','Invalid company code');
  END IF;

  SELECT * INTO v_pc FROM public.portal_clients
  WHERE company_id=v_co.id AND LOWER(email)=LOWER(TRIM(p_email)) AND is_active=true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'error','Invalid email or password');
  END IF;

  IF v_pc.password_hash IS NULL OR v_pc.password_hash <> crypt(p_password, v_pc.password_hash) THEN
    RETURN jsonb_build_object('success',false,'error','Invalid email or password');
  END IF;

  SELECT * INTO v_cl FROM public.clients WHERE id=v_pc.client_id;
  v_tok := encode(gen_random_bytes(32),'hex');

  DELETE FROM public.portal_sessions WHERE portal_client_id=v_pc.id;
  INSERT INTO public.portal_sessions
    (company_id,client_id,portal_client_id,session_token,expires_at)
  VALUES (v_co.id,v_pc.client_id,v_pc.id,v_tok,now()+INTERVAL '8 hours');

  UPDATE public.portal_clients SET last_login_at=now() WHERE id=v_pc.id;

  RETURN jsonb_build_object(
    'success',true,'session_token',v_tok,
    'client_id',v_cl.id,'company_id',v_co.id,'company_name',v_co.company_name,
    'client_name',v_cl.full_name,'client_code',v_cl.client_code,'cnic',v_cl.cnic
  );
END;
$function$;
