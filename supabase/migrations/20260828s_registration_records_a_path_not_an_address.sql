-- The three photographs an applicant takes now land in a bucket that answers
-- nobody, so what registration records is a PATH. The old URL parameters stay
-- in the signature — an unfinished form left open in somebody's browser should
-- fail with a message, not with "function not found" — but they are no longer
-- what makes an application complete.
--
-- Written as one function with one signature. Adding defaults to the old one
-- would have left two, and PostgREST is free to choose either; a registration
-- that silently dropped its documents is exactly the kind of quiet wrong answer
-- this whole pass exists to remove.
create or replace function public.sales_register(
  p_signup_token text, p_name text, p_phone text, p_pin text, p_cnic text,
  p_profile_photo_url text DEFAULT NULL::text,
  p_cnic_front_url text DEFAULT NULL::text,
  p_cnic_back_url text DEFAULT NULL::text,
  p_email text DEFAULT NULL::text,
  p_address text DEFAULT NULL::text,
  p_father_name text DEFAULT NULL::text,
  p_signature_name text DEFAULT NULL::text,
  p_profile_photo_path text DEFAULT NULL::text,
  p_cnic_front_path text DEFAULT NULL::text,
  p_cnic_back_path text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_co public.companies; v_pending int; v_norm text; v_existing text; v_cnic text; v_uid uuid; v_umb boolean := false;
        v_pp text; v_cf text; v_cb text;
BEGIN
  IF TRIM(COALESCE(p_signup_token,''))='' THEN RETURN jsonb_build_object('success',false,'error','invalid_link'); END IF;
  SELECT * INTO v_co FROM public.companies WHERE sales_signup_token=p_signup_token AND status='active';
  IF FOUND THEN v_umb := false;
  ELSE
    SELECT c.* INTO v_co FROM public.company_groups g JOIN public.companies c ON c.id=g.home_company_id
      WHERE g.signup_token=p_signup_token AND g.is_active AND c.status='active';
    v_umb := FOUND;
  END IF;
  IF v_co.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','invalid_link','message','This signup link is invalid or has been disabled. Ask your office for the current link.'); END IF;
  IF TRIM(COALESCE(p_name,''))='' THEN RETURN jsonb_build_object('success',false,'error','name_required','message','Please enter your name.'); END IF;
  IF TRIM(COALESCE(p_father_name,''))='' THEN RETURN jsonb_build_object('success',false,'error','father_name_required','message','Please enter your father / husband name.'); END IF;
  v_norm := public._normalize_pk_mobile(p_phone);
  IF v_norm IS NULL THEN RETURN jsonb_build_object('success',false,'error','invalid_phone','message','Enter a valid mobile number, e.g. 03001234567 or +923001234567.'); END IF;
  v_cnic := TRIM(COALESCE(p_cnic,''));
  IF v_cnic !~ '^[0-9]{5}-[0-9]{7}-[0-9]$' THEN RETURN jsonb_build_object('success',false,'error','invalid_cnic','message','Enter your CNIC in the format 35201-1234567-1.'); END IF;
  IF TRIM(COALESCE(p_address,''))='' THEN RETURN jsonb_build_object('success',false,'error','address_required','message','Please enter your address.'); END IF;
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{6}$' THEN RETURN jsonb_build_object('success',false,'error','invalid_pin','message','Choose a 6-digit PIN.'); END IF;
  IF p_pin ~ '^(.)\1{5}$' OR p_pin IN ('123456','654321','123123','121212','112233','786786','098765','456789') THEN
    RETURN jsonb_build_object('success',false,'error','weak_pin','message','This PIN is too easy to guess. Choose a less obvious 6-digit PIN.'); END IF;

  -- The documents, now addressed by path. Each one must sit under this very
  -- token's folder: a path is a claim about where a file is, and a claim made
  -- by a browser is checked, not believed.
  v_pp := NULLIF(TRIM(COALESCE(p_profile_photo_path,'')),'');
  v_cf := NULLIF(TRIM(COALESCE(p_cnic_front_path,'')),'');
  v_cb := NULLIF(TRIM(COALESCE(p_cnic_back_path,'')),'');
  IF v_pp IS NULL OR v_cf IS NULL OR v_cb IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','kyc_required','message','Please add your photo and both sides of your CNIC to complete verification.');
  END IF;
  IF v_pp NOT LIKE 'sales-signup/' || p_signup_token || '/%'
     OR v_cf NOT LIKE 'sales-signup/' || p_signup_token || '/%'
     OR v_cb NOT LIKE 'sales-signup/' || p_signup_token || '/%' THEN
    RETURN jsonb_build_object('success',false,'error','kyc_required','message','Those images could not be verified. Please add them again.');
  END IF;

  IF TRIM(COALESCE(p_signature_name,''))='' THEN
    RETURN jsonb_build_object('success',false,'error','agreement_required','message','Please read and sign the Sale Agent Agreement to continue.'); END IF;
  SELECT status INTO v_existing FROM public.sales_users WHERE company_id=v_co.id AND public._normalize_pk_mobile(phone)=v_norm LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('success',false,'error','phone_already_registered','existing_status',v_existing,
      'message', CASE v_existing WHEN 'pending' THEN 'Your request is already pending your office''s approval. Please wait — you will be able to sign in once approved.'
        WHEN 'active' THEN 'This mobile number is already registered and active. Please sign in with your PIN.'
        WHEN 'inactive' THEN 'This mobile number was deactivated by your office. Please contact them to be reactivated.'
        ELSE 'This mobile number is already registered.' END);
  END IF;
  SELECT count(*) INTO v_pending FROM public.sales_users WHERE company_id=v_co.id AND status='pending';
  IF v_pending >= 100 THEN RETURN jsonb_build_object('success',false,'error','too_many_pending','message','Registrations are temporarily full. Please contact your office.'); END IF;

  INSERT INTO public.sales_users (company_id, project_id, full_name, father_name, phone, cnic, pin_hash, status, is_active,
                                  profile_photo_path, cnic_front_path, cnic_back_path, email, address, kyc_status, is_umbrella)
  VALUES (v_co.id, NULL, TRIM(p_name), TRIM(p_father_name), v_norm, v_cnic, crypt(p_pin, gen_salt('bf',8)), 'pending', false,
          v_pp, v_cf, v_cb,
          NULLIF(TRIM(COALESCE(p_email,'')),''), TRIM(p_address), 'pending', v_umb)
  RETURNING id INTO v_uid;
  INSERT INTO public.agent_agreement_acceptances (company_id, sales_user_id, clause_id, clause_key, version, method, signature_name)
  SELECT v_co.id, v_uid, c.id, c.clause_key, c.version, 'signup', TRIM(p_signature_name)
  FROM public.agent_agreement_clauses c WHERE c.company_id=v_co.id AND c.is_active
  ON CONFLICT (sales_user_id, clause_key, version) DO NOTHING;
  RETURN jsonb_build_object('success',true,'status','pending','company_name',v_co.company_name,'umbrella',v_umb);
END; $function$;

-- exactly one sales_register, or the ambiguity is back
drop function if exists public.sales_register(text,text,text,text,text,text,text,text,text,text,text,text);

do $$
declare v int;
begin
  select count(*) into v from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='sales_register';
  if v <> 1 then raise exception 'there are % sales_register functions, expected 1', v; end if;
end $$;
