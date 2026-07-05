-- Outward-facing brand name: "Fourteen Group of Companies" everywhere members/directors/
-- signup/OTP/admin-header see it. Adds companies.display_name (NULL -> falls back to
-- company_name). company_name is NEVER touched (legal/internal/accounting references depend on it).
-- Applied to prod via MCP 2026-07-06 in 4 steps (company_display_name_1/_2/_3a/_3b_brief);
-- this file is the consolidated, idempotent equivalent.
--
-- Surfaces switched to COALESCE(display_name, company_name):
--   NexuBrief push title (crm_brief_claim_pushes.company — read by crm-daily-brief edge fn),
--   brief text/masthead (crm_brief_gather.company — fed to the AI prompt),
--   /crm "Request access" badge (get_sales_signup_company / get_portal_default_signup /
--     get_sales_company_by_join_code),
--   portal post-login badge + profile (sales_login / get_my_profile),
--   OTP emails (sales_request_pin_reset / sales_request_email_verify — company_name in body),
--   admin/back-office header (get_session_context.organization.name).
-- Output-compatible (same JSON keys) -> NO frontend change, NO edge-fn redeploy.
-- Left untouched (deliberate): client-facing WhatsApp/receipts/payment pages (legal entity name),
--   project/board attribution chips (identify the owning member company), lead & announcement
--   pushes (carry no company name).

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS display_name text;
COMMENT ON COLUMN public.companies.display_name IS 'Outward-facing brand name shown to members/directors (push, brief, signup badge, portal, OTP, admin header). NULL -> falls back to company_name. Does NOT change company_name (legal/internal/accounting references).';
UPDATE public.companies SET display_name='Fourteen Group of Companies' WHERE id='96d210e7-e63b-4ef0-b1d0-74e622eac7ce';

-- ── signup "Request access" badge ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_sales_signup_company(p_signup_token text)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT jsonb_build_object('success',true,'company_name',COALESCE(display_name,company_name),'company_code',company_code,'umbrella',false)
       FROM public.companies WHERE sales_signup_token=p_signup_token AND status='active'),
    (SELECT jsonb_build_object('success',true,'company_name',COALESCE(c.display_name,c.company_name),'company_code',c.company_code,'umbrella',true,'group_name',g.name)
       FROM public.company_groups g JOIN public.companies c ON c.id=g.home_company_id
       WHERE g.signup_token=p_signup_token AND g.is_active AND c.status='active'),
    jsonb_build_object('success',false,'error','invalid_link'));
$function$;

CREATE OR REPLACE FUNCTION public.get_sales_company_by_join_code(p_code text)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT jsonb_build_object('success',true,'company_name',COALESCE(display_name,company_name),'company_code',company_code,
              'umbrella',false,'signup_token',sales_signup_token)
       FROM public.companies
      WHERE sales_join_code = upper(trim(COALESCE(p_code,''))) AND status='active'
        AND sales_signup_token IS NOT NULL),
    jsonb_build_object('success',false,'error','invalid_code'));
$function$;

CREATE OR REPLACE FUNCTION public.get_portal_default_signup()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE c public.companies; v_gname text; v_gtok text;
BEGIN
  SELECT * INTO c FROM public.companies
   WHERE portal_signup_enabled AND status='active'
   ORDER BY updated_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','disabled'); END IF;
  IF COALESCE(c.portal_signup_scope,'umbrella')='umbrella' THEN
    SELECT name, signup_token INTO v_gname, v_gtok FROM public.company_groups
     WHERE home_company_id=c.id AND is_active AND signup_token IS NOT NULL LIMIT 1;
    IF v_gtok IS NOT NULL THEN
      RETURN jsonb_build_object('success',true,'umbrella',true,'group_name',v_gname,
        'company_name',COALESCE(c.display_name,c.company_name),'company_code',c.company_code,'signup_token',v_gtok);
    END IF;
  END IF;
  IF c.sales_signup_token IS NOT NULL THEN
    RETURN jsonb_build_object('success',true,'umbrella',false,
      'company_name',COALESCE(c.display_name,c.company_name),'company_code',c.company_code,'signup_token',c.sales_signup_token);
  END IF;
  RETURN jsonb_build_object('success',false,'error','no_token');
END $function$;

-- ── portal profile + post-login badge ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_profile(p_session_token text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
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
    'profile_photo_url', v_su.profile_photo_url, 'company_name', v_co,
    'last_login_at', v_su.last_login_at, 'created_at', v_su.created_at));
END $function$;

CREATE OR REPLACE FUNCTION public.sales_login(p_company_code text, p_phone text, p_pin text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_co public.companies; v_su public.sales_users; v_tok text;
        v_max int := 5; v_lock interval := interval '15 minutes'; v_att int;
BEGIN
  SELECT * INTO v_co FROM public.companies WHERE LOWER(company_code)=LOWER(TRIM(p_company_code)) AND status='active';
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','Invalid company code'); END IF;
  SELECT * INTO v_su FROM public.sales_users
   WHERE company_id=v_co.id AND public._normalize_pk_mobile(phone)=public._normalize_pk_mobile(p_phone)
   ORDER BY (status='active') DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','Invalid phone or PIN'); END IF;
  IF v_su.locked_until IS NOT NULL AND v_su.locked_until > now() THEN
    RETURN jsonb_build_object('success',false,'error','locked',
      'message','Too many wrong PIN attempts. Please try again after '||
        CEIL(EXTRACT(EPOCH FROM (v_su.locked_until - now()))/60)::int||' minute(s).'); END IF;
  IF v_su.pin_hash IS NULL OR v_su.pin_hash <> crypt(p_pin, v_su.pin_hash) THEN
    v_att := COALESCE(v_su.failed_pin_attempts,0) + 1;
    IF v_att >= v_max THEN
      UPDATE public.sales_users SET failed_pin_attempts=0, locked_until=now()+v_lock WHERE id=v_su.id;
      RETURN jsonb_build_object('success',false,'error','locked',
        'message','Too many wrong PIN attempts. Your sign-in is locked for 15 minutes.');
    ELSE
      UPDATE public.sales_users SET failed_pin_attempts=v_att WHERE id=v_su.id;
      RETURN jsonb_build_object('success',false,'error','Invalid phone or PIN',
        'attempts_left', v_max - v_att,
        'message','Invalid phone or PIN. '||(v_max - v_att)||' attempt(s) left before a 15-minute lock.');
    END IF;
  END IF;
  IF v_su.status='pending' THEN
    RETURN jsonb_build_object('success',false,'error','pending',
      'message','Your request is still pending your office''s approval. Please wait — you can sign in once approved.'); END IF;
  IF v_su.status='inactive' OR v_su.is_active IS NOT TRUE THEN
    RETURN jsonb_build_object('success',false,'error','inactive',
      'message','Your access has been deactivated. Please contact your office to be reactivated.'); END IF;
  IF COALESCE(v_su.failed_pin_attempts,0) <> 0 OR v_su.locked_until IS NOT NULL THEN
    UPDATE public.sales_users SET failed_pin_attempts=0, locked_until=NULL WHERE id=v_su.id;
  END IF;
  v_tok := encode(gen_random_bytes(32),'hex');
  DELETE FROM public.sales_sessions WHERE sales_user_id=v_su.id;
  INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
  VALUES (v_co.id, v_su.id, v_su.project_id, v_tok, now()+interval '8 hours');
  UPDATE public.sales_users SET last_login_at=now() WHERE id=v_su.id;
  RETURN jsonb_build_object('success',true,'session_token',v_tok,'sales_user_id',v_su.id,
    'company_id',v_co.id,'company_name',COALESCE(v_co.display_name,v_co.company_name),'sales_user_name',v_su.full_name,'project_id',v_su.project_id,
    'role', v_su.role, 'permissions', v_su.permissions,
    'email', v_su.email, 'email_verified', v_su.email_verified,
    'upload_token',v_co.sales_signup_token);
END $function$;

-- ── admin/back-office app header (login.html) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_session_context()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_user public.app_users%ROWTYPE; v_org public.companies%ROWTYPE;
  v_member public.platform_organization_members%ROWTYPE;
  v_sub_status text; v_tier text; v_products text[];
  v_inv_id uuid; v_inv_number text; v_inv_amount numeric; v_inv_due date; v_inv_currency text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'no_session'); END IF;
  SELECT * INTO v_user FROM public.app_users WHERE auth_user_id = v_uid LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'no_app_user'); END IF;
  IF v_user.status <> 'active' THEN RETURN jsonb_build_object('success', false, 'error', 'user_inactive'); END IF;
  UPDATE public.app_users SET last_login_at = now() WHERE id = v_user.id;
  SELECT * INTO v_member FROM public.platform_organization_members
  WHERE user_id = v_user.id AND organization_id = v_user.company_id AND status = 'active' LIMIT 1;
  IF NOT FOUND THEN
    SELECT * INTO v_member FROM public.platform_organization_members
    WHERE user_id = v_user.id AND status = 'active' ORDER BY joined_at ASC LIMIT 1;
  END IF;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'no_organization'); END IF;
  SELECT * INTO v_org FROM public.companies WHERE id = v_member.organization_id;
  SELECT COALESCE(array_agg(DISTINCT product ORDER BY product), '{}'::text[]) INTO v_products
  FROM public.subscriptions
  WHERE company_id = v_member.organization_id
    AND status IN ('trialing','active','past_due','pending_payment','payment_under_review');
  SELECT tier, status INTO v_tier, v_sub_status
  FROM public.subscriptions
  WHERE company_id = v_member.organization_id
    AND status IN ('trialing','active','past_due','pending_payment','payment_under_review')
  ORDER BY CASE status WHEN 'pending_payment' THEN 5 WHEN 'payment_under_review' THEN 4
             WHEN 'past_due' THEN 3 WHEN 'trialing' THEN 2 WHEN 'active' THEN 1 END DESC LIMIT 1;
  IF v_sub_status IN ('pending_payment','payment_under_review') THEN
    SELECT i.id, i.invoice_number, i.amount, i.due_date, i.currency
    INTO v_inv_id, v_inv_number, v_inv_amount, v_inv_due, v_inv_currency
    FROM public.invoices i WHERE i.company_id = v_member.organization_id AND i.status = 'unpaid'
    ORDER BY i.created_at DESC LIMIT 1;
  END IF;
  RETURN jsonb_build_object(
    'success', true,
    'user', jsonb_build_object('id', v_user.id, 'auth_user_id', v_uid, 'name', v_user.full_name,
      'email', v_user.email, 'username', v_user.username, 'role', v_user.role, 'is_super_admin', v_user.is_super_admin),
    'organization', jsonb_build_object('id', v_member.organization_id,
      'name', COALESCE(v_org.display_name, v_org.company_name), 'slug', v_org.slug, 'code', v_org.company_code,
      'logo_url', v_org.logo_url, 'brand_color', v_org.brand_color, 'currency', v_org.currency,
      'timezone', v_org.timezone, 'onboarding_complete', v_org.onboarding_complete, 'membership_role', v_member.role),
    'subscription', jsonb_build_object('status', v_sub_status, 'tier', v_tier,
      'product_subscriptions', to_jsonb(COALESCE(v_products, '{}'::text[])),
      'invoice_id', v_inv_id, 'invoice_number', v_inv_number, 'invoice_amount', v_inv_amount,
      'invoice_due', v_inv_due, 'invoice_currency', COALESCE(v_inv_currency, 'PKR')));
END;
$function$;

-- ── NexuBrief push title (read by crm-daily-brief edge fn: claim.company) ─────
CREATE OR REPLACE FUNCTION public.crm_brief_claim_pushes(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_tz text := 'Asia/Karachi'; v_date date; v_coname text; v_copush boolean;
        d record; v_ins uuid; v_subs jsonb; v_out jsonb := '[]'::jsonb;
BEGIN
  v_date := (now() AT TIME ZONE v_tz)::date;
  SELECT COALESCE(display_name, company_name), COALESCE(crm_notify_push,true) INTO v_coname, v_copush FROM public.companies WHERE id=p_company_id;
  IF NOT COALESCE(v_copush,true) THEN
    RETURN jsonb_build_object('success',true,'company',v_coname,'subs','[]'::jsonb);
  END IF;
  FOR d IN
    SELECT id FROM public.sales_users
     WHERE company_id=p_company_id AND status='active' AND role IN ('director','admin')
       AND COALESCE(notify_push,true)
       AND EXISTS (SELECT 1 FROM public.push_subscriptions ps WHERE ps.sales_user_id=sales_users.id)
  LOOP
    INSERT INTO public.reminder_deliveries (company_id, sales_user_id, channel, dedup_key, status)
    VALUES (p_company_id, d.id, 'push', 'brief:'||d.id||':'||v_date, 'sent')
    ON CONFLICT (company_id, dedup_key) DO NOTHING RETURNING id INTO v_ins;
    IF v_ins IS NULL THEN CONTINUE; END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('endpoint',endpoint,'p256dh',p256dh,'auth',auth)),'[]'::jsonb)
      INTO v_subs FROM public.push_subscriptions WHERE sales_user_id=d.id;
    v_out := v_out || v_subs;
  END LOOP;
  RETURN jsonb_build_object('success',true,'company',v_coname,'subs',v_out);
END $function$;

-- ── OTP emails (company name appears in the email body) ───────────────────────
CREATE OR REPLACE FUNCTION public.sales_request_email_verify(p_session_token text, p_new_email text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ses public.sales_sessions; v_su public.sales_users;
  v_email TEXT := LOWER(TRIM(COALESCE(p_new_email,''))); v_co TEXT; v_otp TEXT; v_hash TEXT;
  v_count INT; v_at INT; v_mask TEXT;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT * INTO v_su FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF v_email = '' OR v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
    RETURN jsonb_build_object('success',false,'error','invalid_email','message','Please enter a valid email address.'); END IF;
  IF EXISTS (SELECT 1 FROM public.sales_users WHERE company_id=v_su.company_id AND id<>v_su.id
              AND email_verified IS TRUE AND LOWER(email)=v_email) THEN
    RETURN jsonb_build_object('success',false,'error','email_taken',
      'message','That email is already verified by another member. Please use a different email.'); END IF;
  SELECT count(*) INTO v_count FROM public.email_otps
   WHERE sales_user_id=v_su.id AND purpose='sales_email_verify' AND created_at > now() - INTERVAL '1 hour';
  IF v_count >= 3 THEN
    RETURN jsonb_build_object('success',false,'error','rate_limited','message','Too many requests. Please try again in an hour.'); END IF;
  UPDATE public.email_otps SET used_at=now()
   WHERE sales_user_id=v_su.id AND purpose='sales_email_verify' AND used_at IS NULL;
  v_otp  := lpad((floor(random()*900000)+100000)::INT::TEXT, 6, '0');
  v_hash := crypt(v_otp, gen_salt('bf', 8));
  INSERT INTO public.email_otps (company_id, sales_user_id, email, otp_hash, purpose, channel, expires_at)
  VALUES (v_su.company_id, v_su.id, v_email, v_hash, 'sales_email_verify', 'email', now() + INTERVAL '10 minutes');
  SELECT COALESCE(display_name, company_name) INTO v_co FROM public.companies WHERE id=v_su.company_id;
  PERFORM net.http_post(
    url     := 'https://itqxljtfbrppntgyfush.supabase.co/functions/v1/send-otp-email',
    headers := jsonb_build_object('Content-Type','application/json'),
    body    := jsonb_build_object('email', v_email, 'otp', v_otp,
      'purpose', 'sales_email_verify', 'company_name', v_co, 'full_name', v_su.full_name));
  v_at   := position('@' IN v_email);
  v_mask := left(v_email, least(2, greatest(v_at-1,1))) || '***' || substring(v_email FROM v_at);
  RETURN jsonb_build_object('success',true,'sent',true,'email_hint',v_mask);
END $function$;

CREATE OR REPLACE FUNCTION public.sales_request_pin_reset(p_company_code text, p_phone text, p_ip text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_co public.companies; v_su public.sales_users; v_email TEXT; v_otp_plain TEXT; v_otp_hash TEXT;
  v_count INT; v_at INT; v_masked TEXT;
BEGIN
  SELECT * INTO v_co FROM public.companies WHERE LOWER(company_code)=LOWER(TRIM(p_company_code)) AND status='active';
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found','message','No account found with that company code and mobile number.'); END IF;
  SELECT * INTO v_su FROM public.sales_users
   WHERE company_id=v_co.id AND public._normalize_pk_mobile(phone)=public._normalize_pk_mobile(p_phone)
   ORDER BY (status='active') DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found','message','No account found with that company code and mobile number.'); END IF;
  IF v_su.status='pending' THEN RETURN jsonb_build_object('success',false,'error','pending','message','Your account is still awaiting your office''s approval. You can set your PIN once approved.'); END IF;
  IF v_su.status='inactive' OR v_su.is_active IS NOT TRUE THEN RETURN jsonb_build_object('success',false,'error','inactive','message','Your access has been deactivated. Please contact your office to be reactivated.'); END IF;
  v_email := LOWER(NULLIF(TRIM(v_su.email),''));
  IF v_email IS NULL OR v_su.email_verified IS NOT TRUE THEN
    RETURN jsonb_build_object('success',false,'error','no_email','message','No verified email is on file for your account. Verify your email in the app, or contact your office to reset your PIN.'); END IF;
  SELECT count(*) INTO v_count FROM public.email_otps
   WHERE company_id=v_co.id AND email=v_email AND purpose='sales_pin_reset' AND created_at > now() - INTERVAL '1 hour';
  IF v_count >= 3 THEN RETURN jsonb_build_object('success',false,'error','rate_limited','message','Too many reset requests. Please try again in an hour.'); END IF;
  UPDATE public.email_otps SET used_at=now() WHERE company_id=v_co.id AND email=v_email AND purpose='sales_pin_reset' AND used_at IS NULL;
  v_otp_plain := lpad((floor(random()*900000)+100000)::INT::TEXT, 6, '0');
  v_otp_hash  := crypt(v_otp_plain, gen_salt('bf', 8));
  INSERT INTO public.email_otps (company_id, sales_user_id, email, otp_hash, purpose, channel, expires_at, ip_address)
  VALUES (v_co.id, v_su.id, v_email, v_otp_hash, 'sales_pin_reset', 'email', now() + INTERVAL '10 minutes', p_ip);
  PERFORM net.http_post(
    url     := 'https://itqxljtfbrppntgyfush.supabase.co/functions/v1/send-otp-email',
    headers := jsonb_build_object('Content-Type','application/json'),
    body    := jsonb_build_object('email', v_email, 'otp', v_otp_plain,
      'purpose', 'sales_pin_reset', 'company_name', COALESCE(v_co.display_name, v_co.company_name), 'full_name', v_su.full_name));
  v_at     := position('@' IN v_email);
  v_masked := left(v_email, least(2, greatest(v_at-1,1))) || '***' || substring(v_email FROM v_at);
  RETURN jsonb_build_object('success',true,'sent',true,'email_hint',v_masked);
END $function$;

-- ── brief content / masthead (crm_brief_gather.company -> fed to AI prompt) ───
-- Reproduces the P7 deal-sourced crm_brief_gather with the only change being the
-- v_coname source (company_name -> COALESCE(display_name, company_name)). Full body
-- lives in 20260706_crm_p7_cleanup_brief_b.sql; the single differing line is:
--   SELECT COALESCE(display_name, company_name) INTO v_coname FROM public.companies WHERE id=p_company_id;
-- (applied to prod as company_display_name_3b_brief).