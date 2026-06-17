-- ============================================================================
-- NEXUNOVA RMS — SALE AGENT SELF-SERVICE — P2.1c: signup refine (owner)
-- 2026-06-17.  Plan = SALE_AGENT_SELF_SERVICE_PLAN.md.
-- ----------------------------------------------------------------------------
-- Owner refinements: drop bank details from signup; add father/husband name;
-- make name, father_name, phone, CNIC#, address + KYC docs (photo+CNIC F/B) all
-- REQUIRED (process cannot proceed without them); email optional. father_name
-- copies onto the agent on approval.
-- ============================================================================

ALTER TABLE public.sales_users ADD COLUMN IF NOT EXISTS father_name text;
ALTER TABLE public.agents      ADD COLUMN IF NOT EXISTS father_name text;

DROP FUNCTION IF EXISTS public.sales_register(text,text,text,text,text,text,text,text,text,text,text,text,text);

CREATE OR REPLACE FUNCTION public.sales_register(
  p_signup_token text, p_name text, p_phone text, p_pin text, p_cnic text,
  p_profile_photo_url text DEFAULT NULL,
  p_cnic_front_url    text DEFAULT NULL,
  p_cnic_back_url     text DEFAULT NULL,
  p_email text DEFAULT NULL, p_address text DEFAULT NULL,
  p_father_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $function$
DECLARE v_co public.companies; v_pending int; v_norm text; v_existing text; v_cnic text;
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
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4,6}$' THEN RETURN jsonb_build_object('success',false,'error','invalid_pin','message','Choose a PIN of 4 to 6 digits.'); END IF;
  IF NULLIF(TRIM(COALESCE(p_profile_photo_url,'')),'') IS NULL
     OR NULLIF(TRIM(COALESCE(p_cnic_front_url,'')),'') IS NULL
     OR NULLIF(TRIM(COALESCE(p_cnic_back_url,'')),'') IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','kyc_required',
      'message','Please add your photo and both sides of your CNIC to complete verification.'); END IF;
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
                                  profile_photo_url, cnic_front_url, cnic_back_url,
                                  email, address, kyc_status)
  VALUES (v_co.id, NULL, TRIM(p_name), TRIM(p_father_name), v_norm, v_cnic, crypt(p_pin, gen_salt('bf',8)), 'pending', false,
          NULLIF(TRIM(p_profile_photo_url),''), NULLIF(TRIM(p_cnic_front_url),''), NULLIF(TRIM(p_cnic_back_url),''),
          NULLIF(TRIM(COALESCE(p_email,'')),''), TRIM(p_address), 'pending');
  RETURN jsonb_build_object('success',true,'status','pending','company_name',v_co.company_name);
END; $function$;
REVOKE ALL ON FUNCTION public.sales_register(text,text,text,text,text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sales_register(text,text,text,text,text,text,text,text,text,text,text) TO anon, authenticated;

-- admin_approve_sales_user: also copy father_name onto the agent (full body in
-- migration 20260617_sale_agent_full_signup_kyc.sql; this only adds father_name).
CREATE OR REPLACE FUNCTION public.admin_approve_sales_user(
  p_id uuid, p_project_id uuid, p_commission_percent numeric DEFAULT 2.00)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_me public.app_users; v_su public.sales_users; v_limit jsonb; v_agent uuid; v_code text;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  SELECT * INTO v_su FROM public.sales_users WHERE id=p_id AND company_id=v_me.company_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF v_su.status <> 'pending' THEN
    RETURN jsonb_build_object('success',false,'error','not_pending','message','This registration is already '||v_su.status||'.'); END IF;
  IF p_project_id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','project_required',
      'message','Pick the project this sales agent works in — it becomes their reserve scope and agent home project.'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id=p_project_id AND company_id=v_me.company_id) THEN
    RETURN jsonb_build_object('success',false,'error','invalid_project'); END IF;
  IF p_commission_percent IS NULL OR p_commission_percent < 0 OR p_commission_percent > 100 THEN
    RETURN jsonb_build_object('success',false,'error','invalid_commission','message','Commission must be between 0 and 100.'); END IF;

  v_limit := public.check_plan_limit(v_me.company_id, 'sales_users');
  IF NOT (v_limit->>'can_add')::boolean THEN
    RETURN jsonb_build_object('success',false,'error','plan_limit',
      'message','Sales-access limit reached for your plan ('||(v_limit->>'current_count')||'/'||(v_limit->>'max_allowed')||'). Deactivate an active sales person, or upgrade your plan, before approving more.',
      'limit', v_limit);
  END IF;

  IF v_su.cnic IS NOT NULL AND TRIM(v_su.cnic) <> '' THEN
    SELECT id INTO v_agent FROM public.agents
     WHERE company_id=v_me.company_id AND cnic=v_su.cnic ORDER BY created_at LIMIT 1;
  END IF;

  IF v_agent IS NULL THEN
    v_code := public.generate_agent_code(v_me.company_id, p_project_id);
    INSERT INTO public.agents (
      company_id, project_id, created_by, agent_code, full_name, father_name, phone, cnic,
      email, address, bank_name, bank_account_no, bank_account_title,
      commission_percent, join_date, status,
      profile_photo_url, cnic_front_url, cnic_back_url
    ) VALUES (
      v_me.company_id, p_project_id, v_me.id, v_code, v_su.full_name, v_su.father_name, v_su.phone,
      NULLIF(TRIM(COALESCE(v_su.cnic,'')),''),
      v_su.email, v_su.address, v_su.bank_name, v_su.bank_account_no, v_su.bank_account_title,
      p_commission_percent, CURRENT_DATE, 'active',
      v_su.profile_photo_url, v_su.cnic_front_url, v_su.cnic_back_url
    ) RETURNING id INTO v_agent;
  ELSE
    SELECT agent_code INTO v_code FROM public.agents WHERE id=v_agent;
  END IF;

  UPDATE public.sales_users
     SET status='active', is_active=true, project_id=p_project_id,
         agent_id=v_agent, kyc_status='verified', updated_at=now()
   WHERE id=p_id;

  RETURN jsonb_build_object('success',true,'agent_id',v_agent,'agent_code',v_code);
END; $$;
GRANT EXECUTE ON FUNCTION public.admin_approve_sales_user(uuid,uuid,numeric) TO anon, authenticated;
