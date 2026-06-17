-- ============================================================================
-- NEXUNOVA RMS — sales_login returns upload_token (= company sales_signup_token)
-- 2026-06-17. Lets a logged-in sales agent upload client/nominee KYC images from
-- the Mark Sold form, reusing the existing token-gated salessignup_anon_upload
-- storage policy (path sales-signup/<token>/...). The signup token is the shared,
-- non-secret company link token — safe to expose to the agent and in image URLs
-- (unlike the session token, which must never appear in a public path).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.sales_login(p_company_code text, p_phone text, p_pin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $function$
DECLARE v_co public.companies; v_su public.sales_users; v_tok text;
BEGIN
  SELECT * INTO v_co FROM public.companies WHERE LOWER(company_code)=LOWER(TRIM(p_company_code)) AND status='active';
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','Invalid company code'); END IF;

  SELECT * INTO v_su FROM public.sales_users
   WHERE company_id=v_co.id AND public._normalize_pk_mobile(phone)=public._normalize_pk_mobile(p_phone)
   ORDER BY (status='active') DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','Invalid phone or PIN'); END IF;

  IF v_su.pin_hash IS NULL OR v_su.pin_hash <> crypt(p_pin, v_su.pin_hash) THEN
    RETURN jsonb_build_object('success',false,'error','Invalid phone or PIN'); END IF;

  IF v_su.status='pending' THEN
    RETURN jsonb_build_object('success',false,'error','pending',
      'message','Your request is still pending your office''s approval. Please wait — you can sign in once approved.'); END IF;
  IF v_su.status='inactive' OR v_su.is_active IS NOT TRUE THEN
    RETURN jsonb_build_object('success',false,'error','inactive',
      'message','Your access has been deactivated. Please contact your office to be reactivated.'); END IF;

  v_tok := encode(gen_random_bytes(32),'hex');
  DELETE FROM public.sales_sessions WHERE sales_user_id=v_su.id;
  INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
  VALUES (v_co.id, v_su.id, v_su.project_id, v_tok, now()+interval '8 hours');
  UPDATE public.sales_users SET last_login_at=now() WHERE id=v_su.id;
  RETURN jsonb_build_object('success',true,'session_token',v_tok,'sales_user_id',v_su.id,
    'company_id',v_co.id,'company_name',v_co.company_name,'sales_user_name',v_su.full_name,'project_id',v_su.project_id,
    'upload_token',v_co.sales_signup_token);
END; $function$;