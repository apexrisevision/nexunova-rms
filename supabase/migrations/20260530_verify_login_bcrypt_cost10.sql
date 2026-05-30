-- ════════════════════════════════════════════════════════════
-- verify_login: bump bcrypt cost factor from 6 → 10 on the GoTrue
-- self-heal so signInWithPassword() actually accepts the resynced hash.
-- 2026-05-30. Launch blocker — surfaces post-anon-revoke as 401s.
-- ════════════════════════════════════════════════════════════
-- Root cause: the existing self-heal calls extensions.gen_salt('bf'),
-- which defaults to cost 6. Supabase GoTrue requires bcrypt cost ≥ 10 and
-- rejects anything weaker. Every "successful" verify_login was writing a
-- cost-6 hash that the subsequent supabase.auth.signInWithPassword() call
-- silently failed against — the JS client logged a console.warn and
-- proceeded into _completeLogin with no JWT attached. All RPC calls went
-- out as anon. Before today's anon-EXECUTE revoke that "worked" because
-- anon was permissive (and explained the earlier Ledgers cross-tenant
-- visibility); after the revoke it 401s.
--
-- This migration changes one argument: gen_salt('bf') → gen_salt('bf', 10).
-- All existing officers self-heal automatically on their next successful
-- login: the same verify_login call that runs the resync now writes a
-- cost-10 hash, and the bridge signInWithPassword call right after it
-- (js/auth.js:155) finally succeeds. No admin password-reset needed.
-- Body otherwise verbatim.

CREATE OR REPLACE FUNCTION public.verify_login(p_company_code text, p_username text, p_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_co   public.companies%ROWTYPE;
  v_user public.app_users%ROWTYPE;
  v_sub_status   TEXT; v_plan_code TEXT;
  v_inv_id UUID; v_inv_number TEXT; v_inv_amount NUMERIC; v_inv_due DATE; v_inv_currency TEXT;
  v_require_2fa BOOLEAN;
BEGIN
  SELECT * INTO v_co FROM public.companies
  WHERE LOWER(company_code) = LOWER(TRIM(p_company_code)) LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','invalid_credentials'); END IF;
  IF v_co.status <> 'active' THEN RETURN jsonb_build_object('success',false,'error','company_inactive'); END IF;

  SELECT * INTO v_user FROM public.app_users
  WHERE company_id = v_co.id AND LOWER(username) = LOWER(TRIM(p_username)) LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','invalid_credentials'); END IF;
  IF v_user.status <> 'active' THEN RETURN jsonb_build_object('success',false,'error','user_inactive'); END IF;

  IF v_user.locked_until IS NOT NULL AND v_user.locked_until > NOW() THEN
    RETURN jsonb_build_object('success',false,'error','account_locked','locked_until',v_user.locked_until); END IF;

  IF v_user.password_hash IS NULL
    OR extensions.crypt(p_password, v_user.password_hash) <> v_user.password_hash THEN
    IF v_user.failed_login_attempts + 1 >= 5 THEN
      UPDATE public.app_users SET failed_login_attempts=0, locked_until=NOW()+INTERVAL '15 minutes', updated_at=NOW() WHERE id=v_user.id;
      RETURN jsonb_build_object('success',false,'error','account_locked','locked_until',NOW()+INTERVAL '15 minutes');
    ELSE
      UPDATE public.app_users SET failed_login_attempts=failed_login_attempts+1, updated_at=NOW() WHERE id=v_user.id;
    END IF;
    RETURN jsonb_build_object('success',false,'error','invalid_credentials');
  END IF;

  IF v_user.email_verified = false THEN
    RETURN jsonb_build_object('success',false,'error','email_not_verified','email',v_user.email); END IF;

  UPDATE public.app_users
    SET last_login_at=NOW(), failed_login_attempts=0, locked_until=NULL, updated_at=NOW()
  WHERE id = v_user.id;

  -- Self-heal GoTrue side so supabase.auth.signInWithPassword(email, p_password) matches.
  -- Cost factor 10: GoTrue rejects bcrypt hashes below cost 10. Default gen_salt('bf')
  -- gives cost 6, which silently fails the bridge and leaves the client unauthenticated.
  IF v_user.auth_user_id IS NOT NULL THEN
    UPDATE auth.users
      SET encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
          email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
          updated_at         = NOW()
    WHERE id = v_user.auth_user_id;
  END IF;

  SELECT s.status, sp.plan_code INTO v_sub_status, v_plan_code
  FROM public.subscriptions s JOIN public.subscription_plans sp ON sp.id = s.plan_id
  WHERE s.company_id = v_co.id ORDER BY s.created_at DESC LIMIT 1;

  IF v_sub_status IN ('pending_payment', 'payment_under_review') THEN
    SELECT i.id, i.invoice_number, i.amount, i.due_date, i.currency
    INTO v_inv_id, v_inv_number, v_inv_amount, v_inv_due, v_inv_currency
    FROM public.invoices i WHERE i.company_id = v_co.id AND i.status = 'unpaid'
    ORDER BY i.created_at DESC LIMIT 1;
  END IF;

  -- [NEW] Surface the admin-2FA toggle so the client can gate admin/owner logins.
  SELECT require_2fa_admin INTO v_require_2fa
  FROM public.company_security_settings WHERE company_id = v_co.id LIMIT 1;

  RETURN jsonb_build_object(
    'success', true,
    'user', jsonb_build_object(
      'id', v_user.id, 'name', v_user.full_name, 'username', v_user.username, 'email', v_user.email,
      'role', v_user.role, 'module_permissions', v_user.module_permissions,
      'session_version', v_user.session_version,
      'needs_password_reset', v_user.needs_password_reset,
      'password_expires_at', v_user.password_expires_at),
    'company', jsonb_build_object(
      'id', v_co.id, 'name', v_co.company_name, 'code', v_co.company_code,
      'onboarding_complete', v_co.onboarding_complete, 'sub_status', COALESCE(v_sub_status,'active'),
      'plan_code', v_plan_code, 'invoice_id', v_inv_id, 'invoice_number', v_inv_number,
      'invoice_amount', v_inv_amount, 'invoice_due', v_inv_due,
      'invoice_currency', COALESCE(v_inv_currency,'PKR'),
      'require_2fa_admin', COALESCE(v_require_2fa, false))
  );
END;
$function$;
