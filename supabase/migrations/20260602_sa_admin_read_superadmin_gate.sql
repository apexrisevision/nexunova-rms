-- Area-4 launch-blocker fix (2026-06-02): gate the 8 super-admin panel READ RPCs.
-- They were SECURITY DEFINER + authenticated-EXECUTE with NO super-admin check, so any
-- logged-in tenant/trial user could read all tenants' data. Prepend the existing
-- _rms_require_super_admin() guard (raises 42501/forbidden for non-super-admins).
-- DATA/function-guard only: no return-shape or logic change; all stay SECURITY DEFINER
-- + search_path=public. Grants unchanged (CREATE OR REPLACE preserves ACL).
-- For the 3 functions with an existing EXCEPTION WHEN OTHERS handler, the guard is placed
-- BEFORE a nested BEGIN..EXCEPTION..END wrapping the unchanged body so the guard's raise
-- is NOT swallowed by that handler.

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
  SELECT COUNT(DISTINCT id) INTO v_total_companies FROM public.companies;

  SELECT COUNT(*) INTO v_active_subs
  FROM public.subscriptions WHERE status = 'active';

  SELECT COUNT(*), COALESCE(SUM(amount_paid), 0)
  INTO v_pending_count, v_pending_amount
  FROM public.payment_proofs WHERE status IN ('pending','needs_info');

  SELECT COALESCE(SUM(amount_paid), 0) INTO v_month_revenue
  FROM public.payment_proofs
  WHERE status = 'approved'
    AND verified_at >= DATE_TRUNC('month', NOW());

  SELECT COUNT(*) INTO v_trial_count
  FROM public.subscriptions WHERE status = 'trialing';

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
  WHERE s.id = (
    SELECT id FROM public.subscriptions
    WHERE company_id = c.id ORDER BY created_at DESC LIMIT 1
  ) OR s.id IS NULL;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_all_proofs_admin(p_status text DEFAULT NULL::text)
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
      'proof_id',           pp.id,
      'proof_status',       pp.status,
      'submitted_at',       pp.created_at,
      'verified_at',        pp.verified_at,
      'reference_number',   pp.reference_number,
      'amount_paid',        pp.amount_paid,
      'currency',           pp.currency,
      'payment_date',       pp.payment_date,
      'receipt_url',        pp.receipt_url,
      'rejection_reason',   pp.rejection_reason,
      'admin_notes',        pp.verification_notes,
      'company_name',       c.company_name,
      'company_code',       c.company_code,
      'invoice_number',     i.invoice_number,
      'plan_name',          i.plan_name,
      'invoice_amount',     i.amount,
      'payment_method_name', pm.method_name
    ) ORDER BY pp.created_at DESC
  ) INTO v_result
  FROM public.payment_proofs pp
  JOIN  public.companies c       ON c.id    = pp.company_id
  LEFT JOIN public.invoices i    ON i.id    = pp.invoice_id
  LEFT JOIN public.payment_methods pm ON pm.id = pp.payment_method_id
  WHERE p_status IS NULL OR pp.status = p_status;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_pending_proofs_admin()
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
      'proof_id',           pp.id,
      'proof_status',       pp.status,
      'submitted_at',       pp.created_at,
      'reference_number',   pp.reference_number,
      'amount_paid',        pp.amount_paid,
      'currency',           pp.currency,
      'payment_date',       pp.payment_date,
      'receipt_url',        pp.receipt_url,
      'receipt_filename',   pp.receipt_filename,
      'payer_name',         pp.payer_name,
      'payer_account',      pp.payer_account,
      'submitter_notes',    pp.notes_from_user,
      'rejection_reason',   pp.rejection_reason,
      'admin_notes',        pp.verification_notes,
      'company_name',       c.company_name,
      'company_code',       c.company_code,
      'company_id',         c.id,
      'invoice_number',     i.invoice_number,
      'plan_code',          sp.plan_code,
      'plan_name',          i.plan_name,
      'invoice_amount',     i.amount,
      'invoice_currency',   COALESCE(i.currency, 'PKR'),
      'payment_method_name', pm.method_name,
      'method_type',        pm.method_type,
      'partner_name',       ptnr.partner_name
    ) ORDER BY pp.created_at DESC
  ) INTO v_result
  FROM public.payment_proofs pp
  JOIN  public.companies c       ON c.id    = pp.company_id
  LEFT JOIN public.invoices i    ON i.id    = pp.invoice_id
  LEFT JOIN public.subscription_plans sp ON sp.id = i.plan_id
  LEFT JOIN public.payment_methods pm ON pm.id = pp.payment_method_id
  LEFT JOIN public.payment_partners ptnr ON ptnr.id = pp.payment_partner_id
  WHERE pp.status IN ('pending', 'needs_info');

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_payment_partners_admin()
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
      'id',           pp.id,
      'name',         pp.partner_name,
      'country_code', pp.country_code,
      'country_name', pp.country_name,
      'phone',        pp.partner_phone,
      'email',        pp.partner_email,
      'whatsapp',     pp.partner_whatsapp,
      'is_active',    pp.is_active,
      'methods', (
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'id',             pm.id,
            'method_type',    pm.method_type,
            'method_name',    pm.method_name,
            'account_title',  pm.account_title,
            'account_number', pm.account_number,
            'iban',           pm.iban,
            'is_active',      pm.is_active
          ) ORDER BY pm.display_order
        ), '[]'::jsonb)
        FROM public.payment_methods pm
        WHERE pm.partner_id = pp.id
      )
    ) ORDER BY pp.display_order, pp.partner_name
  ) INTO v_result
  FROM public.payment_partners pp;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_company_detail_admin(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public._rms_require_super_admin();
  BEGIN
    SELECT jsonb_build_object(
      'company',      row_to_json(c)::jsonb,
      'subscription', row_to_json(s)::jsonb,
      'plan',         row_to_json(sp)::jsonb,
      'stats', jsonb_build_object(
        'users',              (SELECT COUNT(*)  FROM app_users  WHERE company_id = p_company_id AND status = 'active'),
        'projects',           (SELECT COUNT(*)  FROM projects   WHERE company_id = p_company_id),
        'units',              (SELECT COUNT(*)  FROM units      WHERE company_id = p_company_id),
        'clients',            (SELECT COUNT(*)  FROM clients    WHERE company_id = p_company_id),
        'agents',             (SELECT COUNT(*)  FROM agents     WHERE company_id = p_company_id),
        'sales',              (SELECT COUNT(*)  FROM sales      WHERE company_id = p_company_id),
        'payments_30d',       (SELECT COUNT(*)  FROM payments   WHERE company_id = p_company_id AND created_at >= NOW() - INTERVAL '30 days'),
        'payments_amt_30d',   (SELECT COALESCE(SUM(amount),0) FROM payments WHERE company_id = p_company_id AND created_at >= NOW() - INTERVAL '30 days'),
        'last_payment_at',    (SELECT MAX(created_at) FROM payments WHERE company_id = p_company_id)
      )
    )
    INTO v_result
    FROM companies c
    LEFT JOIN subscriptions s  ON s.company_id  = c.id
    LEFT JOIN subscription_plans sp ON sp.id = s.plan_id
    WHERE c.id = p_company_id
    ORDER BY s.created_at DESC
    LIMIT 1;

    RETURN COALESCE(v_result, jsonb_build_object('error', 'Company not found'));
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('error', SQLERRM);
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_company_feature_flags(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_rows jsonb;
BEGIN
  PERFORM public._rms_require_super_admin();
  BEGIN
    SELECT COALESCE(jsonb_agg(row_to_json(f) ORDER BY f.feature_key), '[]'::jsonb)
    INTO v_rows
    FROM company_feature_flags f
    WHERE f.company_id = p_company_id;
    RETURN v_rows;
  EXCEPTION WHEN OTHERS THEN RETURN '[]'::jsonb;
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_sa_announcements()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_rows jsonb;
BEGIN
  PERFORM public._rms_require_super_admin();
  BEGIN
    SELECT COALESCE(jsonb_agg(row_to_json(a) ORDER BY a.created_at DESC), '[]'::jsonb)
    INTO v_rows FROM sa_announcements a;
    RETURN v_rows;
  EXCEPTION WHEN OTHERS THEN RETURN '[]'::jsonb;
  END;
END;
$function$;
