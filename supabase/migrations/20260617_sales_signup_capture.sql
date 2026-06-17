-- ============================================================================
-- NEXUNOVA RMS — SALE AGENT SELF-SERVICE — PHASE 2 (step 1): signup capture
-- 2026-06-17.  Plan = SALE_AGENT_SELF_SERVICE_PLAN.md.
-- ----------------------------------------------------------------------------
-- Let an ANON signup capture a profile photo + CNIC front/back (camera or
-- browse) and store the public URLs on the pending sales_user. On approval
-- (Phase 1) these copy onto the agent record.
--
-- Storage: anon uploads are token-gated exactly like paylink_anon_upload.
-- Bucket = rms-documents (public; the same bucket client/nominee CNICs already
-- use), path = sales-signup/<sales_signup_token>/<file>. A new
-- sales_signup_token_valid() helper backs the policy.
-- ============================================================================

-- ── 1. token-valid helper (mirrors paylink_token_valid) ─────────────────────
CREATE OR REPLACE FUNCTION public.sales_signup_token_valid(p_token text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.companies
    WHERE sales_signup_token = p_token AND status = 'active'
  );
$$;
GRANT EXECUTE ON FUNCTION public.sales_signup_token_valid(text) TO anon, authenticated;

-- ── 2. anon upload policy (token-gated, sales-signup/<token>/ prefix) ────────
DROP POLICY IF EXISTS salessignup_anon_upload ON storage.objects;
CREATE POLICY salessignup_anon_upload ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'rms-documents'
    AND (storage.foldername(name))[1] = 'sales-signup'
    AND public.sales_signup_token_valid((storage.foldername(name))[2])
  );

-- ── 3. sales_register — accept + store the 3 captured URLs ───────────────────
DROP FUNCTION IF EXISTS public.sales_register(text,text,text,text,text);

CREATE OR REPLACE FUNCTION public.sales_register(
  p_signup_token text, p_name text, p_phone text, p_pin text, p_cnic text,
  p_profile_photo_url text DEFAULT NULL,
  p_cnic_front_url    text DEFAULT NULL,
  p_cnic_back_url     text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $function$
DECLARE v_co public.companies; v_pending int; v_norm text; v_existing text; v_cnic text;
BEGIN
  IF TRIM(COALESCE(p_signup_token,''))='' THEN RETURN jsonb_build_object('success',false,'error','invalid_link'); END IF;
  SELECT * INTO v_co FROM public.companies WHERE sales_signup_token=p_signup_token AND status='active';
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','invalid_link','message','This signup link is invalid or has been disabled. Ask your office for the current link.'); END IF;
  IF TRIM(COALESCE(p_name,''))='' THEN RETURN jsonb_build_object('success',false,'error','name_required','message','Please enter your name.'); END IF;
  v_norm := public._normalize_pk_mobile(p_phone);
  IF v_norm IS NULL THEN RETURN jsonb_build_object('success',false,'error','invalid_phone','message','Enter a valid mobile number, e.g. 03219694246 or +923219694246.'); END IF;
  v_cnic := TRIM(COALESCE(p_cnic,''));
  IF v_cnic !~ '^[0-9]{5}-[0-9]{7}-[0-9]$' THEN RETURN jsonb_build_object('success',false,'error','invalid_cnic','message','Enter your CNIC in the format 35201-1234567-1.'); END IF;
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4,6}$' THEN RETURN jsonb_build_object('success',false,'error','invalid_pin','message','Choose a PIN of 4 to 6 digits.'); END IF;
  SELECT status INTO v_existing FROM public.sales_users WHERE company_id=v_co.id AND public._normalize_pk_mobile(phone)=v_norm LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('success',false,'error','phone_already_registered','existing_status',v_existing,
      'message', CASE v_existing
        WHEN 'pending'  THEN 'Your request is already pending your office''s approval. Please wait — you will be able to sign in once approved.'
        WHEN 'active'   THEN 'This mobile number is already registered and active. Please sign in with your PIN.'
        WHEN 'inactive' THEN 'This mobile number was deactivated by your office. Please contact them to be reactivated.'
        ELSE 'This mobile number is already registered.' END);
  END IF;
  SELECT count(*) INTO v_pending FROM public.sales_users WHERE company_id=v_co.id AND status='pending';
  IF v_pending >= 100 THEN RETURN jsonb_build_object('success',false,'error','too_many_pending','message','Registrations are temporarily full. Please contact your office.'); END IF;
  INSERT INTO public.sales_users (company_id, project_id, full_name, phone, cnic, pin_hash, status, is_active,
                                  profile_photo_url, cnic_front_url, cnic_back_url)
  VALUES (v_co.id, NULL, TRIM(p_name), v_norm, v_cnic, crypt(p_pin, gen_salt('bf',8)), 'pending', false,
          NULLIF(TRIM(COALESCE(p_profile_photo_url,'')),''),
          NULLIF(TRIM(COALESCE(p_cnic_front_url,'')),''),
          NULLIF(TRIM(COALESCE(p_cnic_back_url,'')),''));
  RETURN jsonb_build_object('success',true,'status','pending','company_name',v_co.company_name);
END; $function$;

REVOKE ALL ON FUNCTION public.sales_register(text,text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sales_register(text,text,text,text,text,text,text,text) TO anon, authenticated;
