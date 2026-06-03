-- 20260603_sa_hide_platform_company.sql
-- Super-admin Companies view + dashboard stats must show REAL customers only.
-- Excludes the platform/super-admin company (the tenant that contains any
-- is_super_admin user) from both the list RPC and the counts RPC.
--
-- Identifier choice: filter by the is_super_admin owner (robust) rather than a
-- hardcoded company id (f46bb375-...) or company_code='ADMIN'. is_super_admin is
-- the real platform-staff invariant; it survives a company re-create/re-seed and
-- never appears on a customer tenant. Encapsulated in one helper so the list and
-- the stats can never drift apart.
--
-- Both RPCs stay SECURITY DEFINER and keep the _rms_require_super_admin() gate.

-- 1) Single source of truth for "which companies are platform-owned"
CREATE OR REPLACE FUNCTION public._rms_platform_company_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $function$
  SELECT DISTINCT company_id
  FROM public.app_users
  WHERE is_super_admin = true
    AND company_id IS NOT NULL;
$function$;

-- 2) Company list -- hide platform company
CREATE OR REPLACE FUNCTION public.get_companies_admin()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public._rms_require_super_admin();
  SELECT jsonb_agg(
    jsonb_build_object(
      'id',            c.id,
      'company_name',  c.company_name,
      'company_code',  c.company_code,
      'email',         u.email,
      'country',       c.country,
      'city',          c.city,
      'status',        c.status,
      'created_at',    c.created_at,
      'sub_status',    s.status,
      'plan_name',     sp.plan_name,
      'plan_code',     sp.plan_code,
      'billing_cycle', s.billing_cycle,
      'amount',        s.amount,
      'trial_ends_at', s.trial_ends_at,
      'sub_expires_at', s.current_period_end,
      'user_count',    (SELECT COUNT(*) FROM public.app_users au WHERE au.company_id = c.id AND au.status = 'active'),
      'unit_count',    (SELECT COUNT(*) FROM public.units un WHERE un.company_id = c.id)
    ) ORDER BY c.created_at DESC
  ) INTO v_result
  FROM public.companies c
  LEFT JOIN public.subscriptions s ON s.company_id = c.id
  LEFT JOIN public.subscription_plans sp ON sp.id = s.plan_id
  LEFT JOIN public.app_users u ON u.company_id = c.id AND u.role = 'owner'
  WHERE (s.id = (
      SELECT id FROM public.subscriptions
      WHERE company_id = c.id ORDER BY created_at DESC LIMIT 1
    ) OR s.id IS NULL)
    AND c.id NOT IN (SELECT public._rms_platform_company_ids());

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

-- 3) Dashboard counts -- exclude platform company everywhere
CREATE OR REPLACE FUNCTION public.get_admin_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total_companies INT;
  v_active_subs     INT;
  v_pending_count   INT;
  v_pending_amount  NUMERIC;
  v_month_revenue   NUMERIC;
  v_trial_count     INT;
BEGIN
  PERFORM public._rms_require_super_admin();

  SELECT COUNT(DISTINCT id) INTO v_total_companies
  FROM public.companies
  WHERE id NOT IN (SELECT public._rms_platform_company_ids());

  SELECT COUNT(*) INTO v_active_subs
  FROM public.subscriptions
  WHERE status = 'active'
    AND company_id NOT IN (SELECT public._rms_platform_company_ids());

  SELECT COUNT(*), COALESCE(SUM(amount_paid), 0)
  INTO v_pending_count, v_pending_amount
  FROM public.payment_proofs
  WHERE status IN ('pending','needs_info')
    AND company_id NOT IN (SELECT public._rms_platform_company_ids());

  SELECT COALESCE(SUM(amount_paid), 0) INTO v_month_revenue
  FROM public.payment_proofs
  WHERE status = 'approved'
    AND verified_at >= DATE_TRUNC('month', NOW())
    AND company_id NOT IN (SELECT public._rms_platform_company_ids());

  SELECT COUNT(*) INTO v_trial_count
  FROM public.subscriptions
  WHERE status = 'trialing'
    AND company_id NOT IN (SELECT public._rms_platform_company_ids());

  RETURN jsonb_build_object(
    'total_companies', v_total_companies,
    'active_subs',     v_active_subs,
    'trial_count',     v_trial_count,
    'pending_count',   v_pending_count,
    'pending_amount',  v_pending_amount,
    'month_revenue',   v_month_revenue
  );
END;
$function$;
