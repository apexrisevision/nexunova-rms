-- =====================================================================
-- 016 — Custom Access Token hook + login-time RPCs (STEP 5a)
-- =====================================================================
-- After this migration the user MUST enable the hook in Supabase Studio:
--   Authentication → Hooks → Custom Access Token → set hook function:
--     public.custom_access_token_hook
-- Until that toggle is flipped, JWTs will NOT contain the custom claims
-- and the frontend falls back to get_session_context() to populate `S`.
-- =====================================================================

-- =====================================================================
-- 1. custom_access_token_hook
-- =====================================================================
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid             uuid := (event->>'user_id')::uuid;
  v_claims          jsonb := event->'claims';
  v_app_metadata    jsonb := COALESCE(v_claims->'app_metadata', '{}'::jsonb);
  v_user            public.app_users%ROWTYPE;
  v_org             public.companies%ROWTYPE;
  v_member          public.platform_organization_members%ROWTYPE;
  v_products        text[];
  v_tier            text;
  v_sub_status      text;
BEGIN
  SELECT * INTO v_user FROM public.app_users WHERE auth_user_id = v_uid LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('claims', v_claims);
  END IF;

  SELECT * INTO v_member
  FROM   public.platform_organization_members
  WHERE  user_id = v_user.id AND organization_id = v_user.company_id AND status = 'active'
  LIMIT 1;
  IF NOT FOUND THEN
    SELECT * INTO v_member
    FROM   public.platform_organization_members
    WHERE  user_id = v_user.id AND status = 'active'
    ORDER  BY joined_at ASC LIMIT 1;
  END IF;

  IF FOUND THEN
    SELECT * INTO v_org FROM public.companies WHERE id = v_member.organization_id;

    SELECT COALESCE(array_agg(DISTINCT product ORDER BY product), '{}'::text[])
    INTO   v_products
    FROM   public.subscriptions
    WHERE  company_id = v_member.organization_id
      AND  status IN ('trialing','active','past_due','pending_payment','payment_under_review');

    SELECT tier INTO v_tier
    FROM   public.subscriptions
    WHERE  company_id = v_member.organization_id
      AND  status IN ('trialing','active','past_due','pending_payment','payment_under_review')
    ORDER  BY CASE tier WHEN 'enterprise' THEN 4 WHEN 'professional' THEN 3 WHEN 'starter' THEN 2 WHEN 'trial' THEN 1 ELSE 0 END DESC
    LIMIT 1;

    SELECT status INTO v_sub_status
    FROM   public.subscriptions
    WHERE  company_id = v_member.organization_id
      AND  status IN ('trialing','active','past_due','pending_payment','payment_under_review')
    ORDER  BY CASE status WHEN 'pending_payment' THEN 5 WHEN 'payment_under_review' THEN 4 WHEN 'past_due' THEN 3 WHEN 'trialing' THEN 2 WHEN 'active' THEN 1 END DESC
    LIMIT 1;

    v_app_metadata := v_app_metadata || jsonb_build_object(
      'app_user_id',           v_user.id,
      'full_name',             v_user.full_name,
      'is_super_admin',        v_user.is_super_admin,
      'organization_id',       v_member.organization_id,
      'organization_role',     v_member.role,
      'organization_slug',     v_org.slug,
      'organization_name',     v_org.company_name,
      'organization_currency', v_org.currency,
      'organization_timezone', v_org.timezone,
      'product_subscriptions', to_jsonb(COALESCE(v_products, '{}'::text[])),
      'subscription_tier',     v_tier,
      'subscription_status',   v_sub_status,
      'onboarding_complete',   v_org.onboarding_complete
    );

    v_claims := jsonb_set(v_claims, '{app_metadata}', v_app_metadata);
  END IF;

  RETURN jsonb_build_object('claims', v_claims);
END;
$$;

GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;

-- =====================================================================
-- 2. resolve_login_email — anon RPC
-- =====================================================================
CREATE OR REPLACE FUNCTION public.resolve_login_email(
  p_company_code text, p_username text
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_co_id uuid; v_email text; v_status text;
BEGIN
  IF p_company_code IS NULL OR p_username IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_input');
  END IF;
  SELECT id INTO v_co_id FROM public.companies
   WHERE LOWER(company_code) = LOWER(TRIM(p_company_code))
      OR LOWER(slug) = LOWER(TRIM(p_company_code))
   LIMIT 1;
  IF v_co_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_credentials');
  END IF;
  SELECT email, status INTO v_email, v_status FROM public.app_users
   WHERE company_id = v_co_id AND LOWER(username) = LOWER(TRIM(p_username)) LIMIT 1;
  IF v_email IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_credentials');
  END IF;
  IF v_status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_inactive');
  END IF;
  RETURN jsonb_build_object('success', true, 'email', LOWER(v_email));
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_login_email(text, text) TO anon, authenticated;

-- =====================================================================
-- 3. get_session_context — authenticated RPC (VOLATILE: updates last_login_at)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_session_context()
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_user public.app_users%ROWTYPE;
  v_org public.companies%ROWTYPE;
  v_member public.platform_organization_members%ROWTYPE;
  v_sub_status text; v_tier text; v_products text[];
  v_inv_id uuid; v_inv_number text; v_inv_amount numeric;
  v_inv_due date; v_inv_currency text;
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
  FROM public.subscriptions WHERE company_id = v_member.organization_id
    AND status IN ('trialing','active','past_due','pending_payment','payment_under_review');

  SELECT tier, status INTO v_tier, v_sub_status FROM public.subscriptions
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
    'user', jsonb_build_object(
      'id', v_user.id, 'auth_user_id', v_uid, 'name', v_user.full_name,
      'email', v_user.email, 'username', v_user.username, 'role', v_user.role,
      'is_super_admin', v_user.is_super_admin),
    'organization', jsonb_build_object(
      'id', v_member.organization_id, 'name', v_org.company_name,
      'slug', v_org.slug, 'code', v_org.company_code, 'logo_url', v_org.logo_url,
      'brand_color', v_org.brand_color, 'currency', v_org.currency,
      'timezone', v_org.timezone, 'onboarding_complete', v_org.onboarding_complete,
      'membership_role', v_member.role),
    'subscription', jsonb_build_object(
      'status', v_sub_status, 'tier', v_tier,
      'product_subscriptions', to_jsonb(COALESCE(v_products, '{}'::text[])),
      'invoice_id', v_inv_id, 'invoice_number', v_inv_number,
      'invoice_amount', v_inv_amount, 'invoice_due', v_inv_due,
      'invoice_currency', COALESCE(v_inv_currency, 'PKR'))
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_session_context() TO authenticated;
