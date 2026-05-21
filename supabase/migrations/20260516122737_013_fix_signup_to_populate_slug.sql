-- =====================================================================
-- 013 — Update signup_new_company + create_app_user to populate the
-- new platform columns (slug, brand_color, timezone, currency, owner,
-- subscription product/tier) and bridge to auth.users
-- =====================================================================
CREATE OR REPLACE FUNCTION public.signup_new_company(
  p_full_name      text,
  p_email          text,
  p_phone          text,
  p_company_name   text,
  p_password       text,
  p_company_type   text DEFAULT 'real_estate'::text,
  p_country        text DEFAULT 'Pakistan'::text,
  p_city           text DEFAULT NULL::text,
  p_address        text DEFAULT NULL::text,
  p_plan_code      text DEFAULT 'free_trial'::text,
  p_billing_cycle  text DEFAULT 'monthly'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_company_id uuid; v_user_id uuid; v_auth_id uuid; v_sub_id uuid;
  v_plan public.subscription_plans%ROWTYPE;
  v_hash text; v_base text; v_username text; v_suffix int;
  v_trial_ends timestamptz; v_sub_status text;
  v_inv_result jsonb; v_inv_id uuid; v_inv_number text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.app_users WHERE LOWER(email) = LOWER(TRIM(p_email))) THEN
    RETURN jsonb_build_object('success', false, 'error', 'email_taken',
      'message', 'This email is already registered.');
  END IF;

  SELECT * INTO v_plan FROM public.subscription_plans
  WHERE plan_code = p_plan_code AND is_active = true LIMIT 1;
  IF NOT FOUND THEN
    SELECT * INTO v_plan FROM public.subscription_plans
    WHERE plan_code = 'free_trial' AND is_active = true LIMIT 1;
  END IF;

  v_base := LOWER(REGEXP_REPLACE(TRIM(p_company_name), '[^a-zA-Z0-9]', '', 'g'));
  IF length(v_base) < 2 THEN v_base := 'company'; END IF;
  v_base := LEFT(v_base, 20);

  v_username := v_base;
  IF EXISTS (SELECT 1 FROM public.companies WHERE company_code = v_username OR slug = v_username)
     OR EXISTS (SELECT 1 FROM public.app_users WHERE username = v_username) THEN
    v_suffix := 2;
    LOOP
      v_username := v_base || v_suffix::text;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.companies WHERE company_code = v_username OR slug = v_username)
        AND NOT EXISTS (SELECT 1 FROM public.app_users WHERE username = v_username);
      v_suffix := v_suffix + 1;
      EXIT WHEN v_suffix > 999;
    END LOOP;
  END IF;

  v_hash := extensions.crypt(p_password, extensions.gen_salt('bf', 10));

  INSERT INTO public.companies (
    company_code, slug, company_name, company_type, country, city, address,
    status, onboarding_complete, brand_color, timezone, currency, signup_source
  ) VALUES (
    v_username, v_username, TRIM(p_company_name), p_company_type,
    COALESCE(NULLIF(TRIM(p_country), ''), 'Pakistan'),
    NULLIF(TRIM(p_city), ''), NULLIF(TRIM(p_address), ''),
    'active', false, '#6C63FF',
    CASE WHEN COALESCE(NULLIF(TRIM(p_country), ''), 'Pakistan') = 'UAE' THEN 'Asia/Dubai' ELSE 'Asia/Karachi' END,
    CASE WHEN COALESCE(NULLIF(TRIM(p_country), ''), 'Pakistan') = 'UAE' THEN 'AED' ELSE 'PKR' END,
    'self_serve'
  ) RETURNING id INTO v_company_id;

  INSERT INTO public.app_users (
    company_id, full_name, username, email, phone,
    role, password_hash, status, auth_provider, email_verified
  ) VALUES (
    v_company_id, TRIM(p_full_name), v_username, LOWER(TRIM(p_email)),
    NULLIF(TRIM(p_phone), ''), 'owner', v_hash, 'active',
    'supabase', true
  ) RETURNING id INTO v_user_id;

  UPDATE public.companies SET owner_user_id = v_user_id WHERE id = v_company_id;
  SELECT auth_user_id INTO v_auth_id FROM public.app_users WHERE id = v_user_id;

  IF v_plan.plan_code = 'free_trial' THEN
    v_sub_status := 'trialing';
    v_trial_ends := now() + (v_plan.trial_days || ' days')::interval;
  ELSE
    v_sub_status := 'pending_payment'; v_trial_ends := NULL;
  END IF;

  INSERT INTO public.subscriptions (
    company_id, plan_id, status, billing_cycle, amount, currency,
    trial_ends_at, current_period_start, current_period_end,
    product, tier, legacy_plan_name, trial_started_at
  ) VALUES (
    v_company_id, v_plan.id, v_sub_status, v_plan.billing_cycle,
    v_plan.price, v_plan.currency, v_trial_ends, now(),
    COALESCE(v_trial_ends,
      CASE v_plan.billing_cycle WHEN 'yearly' THEN now() + interval '1 year' ELSE now() + interval '1 month' END),
    'rms',
    CASE v_plan.plan_code
      WHEN 'free_trial'       THEN 'trial'
      WHEN 'basic_monthly'    THEN 'starter'  WHEN 'basic_yearly'    THEN 'starter'
      WHEN 'pro_monthly'      THEN 'professional' WHEN 'pro_yearly'  THEN 'professional'
      WHEN 'ultimate_monthly' THEN 'enterprise' WHEN 'ultimate_yearly' THEN 'enterprise'
      WHEN 'enterprise'       THEN 'enterprise' ELSE 'starter' END,
    v_plan.plan_name, now()
  ) RETURNING id INTO v_sub_id;

  IF v_sub_status = 'pending_payment' THEN
    SELECT public.create_invoice_for_subscription(v_sub_id) INTO v_inv_result;
    v_inv_id := (v_inv_result->>'invoice_id')::uuid;
    v_inv_number := v_inv_result->>'invoice_number';
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'status', v_sub_status,
    'company_id', v_company_id, 'company_code', v_username, 'slug', v_username,
    'username', v_username, 'user_id', v_user_id, 'auth_user_id', v_auth_id,
    'trial_ends_at', v_trial_ends, 'plan_code', v_plan.plan_code,
    'invoice_id', v_inv_id, 'invoice_number', v_inv_number
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'server_error', 'message', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_app_user(
  p_company_id uuid, p_full_name text, p_role text, p_password text,
  p_email text DEFAULT NULL, p_phone text DEFAULT NULL,
  p_module_permissions jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_user_id uuid; v_auth_id uuid; v_hash text;
  v_admin_uname text; v_username text; v_email text;
  v_suffix int; v_can_add boolean;
BEGIN
  SELECT company_code INTO v_admin_uname FROM public.companies WHERE id = p_company_id LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'company_not_found');
  END IF;

  SELECT (check_plan_limit(p_company_id, 'users')->>'can_add')::boolean INTO v_can_add;
  IF NOT v_can_add THEN
    RETURN jsonb_build_object('success', false, 'error', 'limit_reached');
  END IF;

  v_username := p_role || '@' || v_admin_uname;
  IF EXISTS (SELECT 1 FROM public.app_users WHERE company_id = p_company_id AND username = v_username) THEN
    v_suffix := 2;
    LOOP
      v_username := p_role || v_suffix::text || '@' || v_admin_uname;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.app_users WHERE company_id = p_company_id AND username = v_username);
      v_suffix := v_suffix + 1;
      EXIT WHEN v_suffix > 99;
    END LOOP;
  END IF;

  v_email := NULLIF(LOWER(TRIM(COALESCE(p_email, ''))), '');
  IF v_email IS NULL THEN
    v_email := LOWER(v_username || '.' || v_admin_uname || '.nxn.local');
  END IF;

  v_hash := extensions.crypt(p_password, extensions.gen_salt('bf', 10));

  INSERT INTO public.app_users (
    company_id, full_name, username, email, phone,
    role, password_hash, status, module_permissions,
    auth_provider, email_verified
  ) VALUES (
    p_company_id, TRIM(p_full_name), v_username, v_email,
    NULLIF(TRIM(COALESCE(p_phone, '')), ''),
    p_role, v_hash, 'active',
    COALESCE(p_module_permissions, '{}'::jsonb),
    'supabase', (p_email IS NOT NULL)
  ) RETURNING id INTO v_user_id;

  SELECT auth_user_id INTO v_auth_id FROM public.app_users WHERE id = v_user_id;

  RETURN jsonb_build_object(
    'success', true, 'user_id', v_user_id,
    'auth_user_id', v_auth_id, 'username', v_username, 'email', v_email
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'server_error', 'message', SQLERRM);
END;
$function$;
