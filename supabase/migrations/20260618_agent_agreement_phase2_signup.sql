-- ════════════════════════════════════════════════════════════════════════════
-- SALE AGENT AGREEMENT — Phase 2: signup gate.
-- The sub-dealer reads the agreement on the signup screen, ticks "I agree" and
-- types their full name to sign. sales_register now (a) requires that signature and
-- (b) records the acceptance of every active clause (method='signup') against the
-- new pending account. get_signup_agreement exposes the clauses to the public
-- signup screen (no session/account exists yet).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_signup_agreement(p_signup_token text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT jsonb_build_object(
      'success', true,
      'company_name', co.company_name,
      'clauses', COALESCE((SELECT jsonb_agg(jsonb_build_object('seq',c.seq,'title',c.title,'body',c.body)
                            ORDER BY c.seq, c.title)
                  FROM public.agent_agreement_clauses c WHERE c.company_id=co.id AND c.is_active),'[]'::jsonb))
    FROM public.companies co
    WHERE co.sales_signup_token=p_signup_token AND co.status='active'
  ), jsonb_build_object('success',false));
$function$;
REVOKE ALL ON FUNCTION public.get_signup_agreement(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_signup_agreement(text) TO anon, authenticated;

-- sales_register: + p_signature_name (required) and records the signup acceptance.
CREATE OR REPLACE FUNCTION public.sales_register(p_signup_token text, p_name text, p_phone text, p_pin text, p_cnic text, p_profile_photo_url text DEFAULT NULL::text, p_cnic_front_url text DEFAULT NULL::text, p_cnic_back_url text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_father_name text DEFAULT NULL::text, p_signature_name text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_co public.companies; v_pending int; v_norm text; v_existing text; v_cnic text; v_uid uuid;
BEGIN
  IF TRIM(COALESCE(p_signup_token,''))='' THEN RETURN jsonb_build_object('success',false,'error','invalid_link'); END IF;
  SELECT * INTO v_co FROM public.companies WHERE sales_signup_token=p_signup_token AND status='active';
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','invalid_link','message','This signup link is invalid or has been disabled. Ask your office for the current link.'); END IF;
  IF TRIM(COALESCE(p_name,''))='' THEN RETURN jsonb_build_object('success',false,'error','name_required','message','Please enter your name.'); END IF;
  IF TRIM(COALESCE(p_father_name,''))='' THEN RETURN jsonb_build_object('success',false,'error','father_name_required','message','Please enter your father / husband name.'); END IF;
  v_norm := public._normalize_pk_mobile(p_phone);
  IF v_norm IS NULL THEN RETURN jsonb_build_object('success',false,'error','invalid_phone','message','Enter a valid mobile number, e.g. 03219694246 or +923219694246.'); END IF;
  v_cnic := TRIM(COALESCE(p_cnic,''));
  IF v_cnic !~ '^[0-9]{5}-[0-9]{7}-[0-9]$' THEN RETURN jsonb_build_object('success',false,'error','invalid_cnic','message','Enter your CNIC in the format 35201-1234567-1.'); END IF;
  IF TRIM(COALESCE(p_address,''))='' THEN RETURN jsonb_build_object('success',false,'error','address_required','message','Please enter your address.'); END IF;
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{6}$' THEN
    RETURN jsonb_build_object('success',false,'error','invalid_pin','message','Choose a 6-digit PIN.'); END IF;
  IF p_pin ~ '^(.)\1{5}$' OR p_pin IN ('123456','654321','123123','121212','112233','786786','098765','456789') THEN
    RETURN jsonb_build_object('success',false,'error','weak_pin','message','This PIN is too easy to guess. Choose a less obvious 6-digit PIN.'); END IF;
  IF NULLIF(TRIM(COALESCE(p_profile_photo_url,'')),'') IS NULL
     OR NULLIF(TRIM(COALESCE(p_cnic_front_url,'')),'') IS NULL
     OR NULLIF(TRIM(COALESCE(p_cnic_back_url,'')),'') IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','kyc_required',
      'message','Please add your photo and both sides of your CNIC to complete verification.'); END IF;
  IF TRIM(COALESCE(p_signature_name,''))='' THEN
    RETURN jsonb_build_object('success',false,'error','agreement_required',
      'message','Please read and sign the Sale Agent Agreement to continue.'); END IF;
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
  INSERT INTO public.sales_users (company_id, project_id, full_name, father_name, phone, cnic, pin_hash, status, is_active,
                                  profile_photo_url, cnic_front_url, cnic_back_url, email, address, kyc_status)
  VALUES (v_co.id, NULL, TRIM(p_name), TRIM(p_father_name), v_norm, v_cnic, crypt(p_pin, gen_salt('bf',8)), 'pending', false,
          NULLIF(TRIM(p_profile_photo_url),''), NULLIF(TRIM(p_cnic_front_url),''), NULLIF(TRIM(p_cnic_back_url),''),
          NULLIF(TRIM(COALESCE(p_email,'')),''), TRIM(p_address), 'pending')
  RETURNING id INTO v_uid;
  INSERT INTO public.agent_agreement_acceptances (company_id, sales_user_id, clause_id, clause_key, version, method, signature_name)
  SELECT v_co.id, v_uid, c.id, c.clause_key, c.version, 'signup', TRIM(p_signature_name)
  FROM public.agent_agreement_clauses c
  WHERE c.company_id=v_co.id AND c.is_active
  ON CONFLICT (sales_user_id, clause_key, version) DO NOTHING;
  RETURN jsonb_build_object('success',true,'status','pending','company_name',v_co.company_name);
END; $function$;
