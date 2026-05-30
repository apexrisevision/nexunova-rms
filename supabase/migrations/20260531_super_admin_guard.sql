-- ════════════════════════════════════════════════════════════
-- PLATFORM SUPER-ADMIN GUARD — close P0 cross-tenant exploit
-- 2026-05-31. Launch blocker.
-- ════════════════════════════════════════════════════════════
-- Nine SECURITY DEFINER RPCs in the sa_* / platform-admin family
-- were granted EXECUTE to `authenticated` with NO caller-role gate
-- in their bodies. Empirically reproduced: a non-super-admin company
-- owner can call suspend_company() on another tenant and the UPDATE
-- lands (the tenant is suspended, locking out all its users).
--
-- Other proven attacks from the same gap:
--   • upsert_sa_announcement / delete_sa_announcement — hostile
--     platform-wide broadcast or wipe
--   • set_company_feature_flag — flip any feature flag on any tenant
--   • verify_payment — approve any tenant's payment proof; the
--     caller-supplied p_verified_by also forges the audit log
--   • list_companies / get_sa_health_dashboard / list_sa_support_tickets
--     — read platform-wide tenant data, MRR/ARR, tenant tickets
--   • update_sa_ticket — alter any support ticket
--
-- Fix: one helper (_rms_require_super_admin) + one-line guard
-- (PERFORM ...) at the top of each of the 9 RPCs. Bodies otherwise
-- verbatim. verify_payment also gets one extra hardening: override
-- the caller-supplied p_verified_by with the actual super-admin's
-- app_users.id so the audit log can't be forged.
--
-- list_sa_announcements stays open — those are broadcasts every
-- logged-in user should be able to read.
--
-- Guard surfaces as Postgres error 42501 (insufficient_privilege),
-- which PostgREST maps to HTTP 403 — same shape the anon-revoke
-- already produces.

-- ────────────────── 1. Helper ──────────────────

CREATE OR REPLACE FUNCTION public._rms_require_super_admin()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL OR NOT COALESCE(v_me.is_super_admin, false) THEN
    RAISE EXCEPTION 'forbidden_not_super_admin'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

-- ────────────────── 2. The 9 guarded RPCs ──────────────────

-- 2.1 get_sa_health_dashboard
CREATE OR REPLACE FUNCTION public.get_sa_health_dashboard()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_mrr           numeric := 0;
  v_arr           numeric := 0;
  v_active        int := 0;
  v_trialing      int := 0;
  v_churned_30d   int := 0;
  v_new_30d       int := 0;
  v_total         int := 0;
  v_by_plan       jsonb;
  v_monthly_new   jsonb;
BEGIN
  PERFORM public._rms_require_super_admin();

  SELECT COALESCE(SUM(
    CASE WHEN billing_cycle = 'monthly' THEN amount
         WHEN billing_cycle = 'yearly'  THEN amount / 12
         ELSE 0 END
  ), 0)
  INTO v_mrr
  FROM subscriptions WHERE status = 'active';

  v_arr := v_mrr * 12;

  SELECT
    COUNT(*) FILTER (WHERE status = 'active')::int,
    COUNT(*) FILTER (WHERE status = 'trialing')::int
  INTO v_active, v_trialing
  FROM subscriptions;

  SELECT COUNT(*)::int INTO v_churned_30d
  FROM subscriptions
  WHERE status = 'cancelled' AND cancelled_at >= NOW() - INTERVAL '30 days';

  SELECT COUNT(*)::int INTO v_new_30d
  FROM companies
  WHERE created_at >= NOW() - INTERVAL '30 days' AND deleted_at IS NULL;

  SELECT COUNT(*)::int INTO v_total
  FROM companies WHERE deleted_at IS NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'plan',  COALESCE(sp.plan_name, t.legacy_plan_name, t.tier, 'Unknown'),
    'count', t.cnt,
    'mrr',   t.plan_mrr
  )), '[]'::jsonb)
  INTO v_by_plan
  FROM (
    SELECT s.plan_id, s.legacy_plan_name, s.tier,
      COUNT(*)::int AS cnt,
      COALESCE(SUM(
        CASE WHEN s.billing_cycle = 'monthly' THEN s.amount
             WHEN s.billing_cycle = 'yearly'  THEN s.amount / 12
             ELSE 0 END
      ), 0) AS plan_mrr
    FROM subscriptions s
    WHERE s.status = 'active'
    GROUP BY s.plan_id, s.legacy_plan_name, s.tier
  ) t
  LEFT JOIN subscription_plans sp ON sp.id = t.plan_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'month', TO_CHAR(m, 'Mon YY'),
    'count', cnt::int
  ) ORDER BY m), '[]'::jsonb)
  INTO v_monthly_new
  FROM (
    SELECT DATE_TRUNC('month', created_at) AS m, COUNT(*)::int AS cnt
    FROM companies
    WHERE created_at >= DATE_TRUNC('month', NOW()) - INTERVAL '5 months'
      AND deleted_at IS NULL
    GROUP BY DATE_TRUNC('month', created_at)
  ) t;

  RETURN jsonb_build_object(
    'mrr',             v_mrr,
    'arr',             v_arr,
    'active',          v_active,
    'trialing',        v_trialing,
    'churned_30d',     v_churned_30d,
    'new_30d',         v_new_30d,
    'total_companies', v_total,
    'by_plan',         v_by_plan,
    'monthly_new',     v_monthly_new
  );
END;
$function$;

-- 2.2 set_company_feature_flag
CREATE OR REPLACE FUNCTION public.set_company_feature_flag(p_company_id uuid, p_feature_key text, p_is_enabled boolean, p_note text DEFAULT NULL::text, p_set_by text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._rms_require_super_admin();
  INSERT INTO company_feature_flags (company_id, feature_key, is_enabled, override_note, set_by, set_at)
  VALUES (p_company_id, p_feature_key, p_is_enabled, p_note, p_set_by, now())
  ON CONFLICT (company_id, feature_key) DO UPDATE SET
    is_enabled    = EXCLUDED.is_enabled,
    override_note = EXCLUDED.override_note,
    set_by        = EXCLUDED.set_by,
    set_at        = now();
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- 2.3 suspend_company
CREATE OR REPLACE FUNCTION public.suspend_company(p_company_id uuid, p_reason text DEFAULT NULL::text, p_suspend boolean DEFAULT true)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._rms_require_super_admin();
  IF p_suspend THEN
    UPDATE companies SET
      suspended_at       = now(),
      suspension_reason  = p_reason,
      status             = 'suspended',
      updated_at         = now()
    WHERE id = p_company_id;
  ELSE
    UPDATE companies SET
      suspended_at       = NULL,
      suspension_reason  = NULL,
      status             = 'active',
      updated_at         = now()
    WHERE id = p_company_id;
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- 2.4 delete_sa_announcement
CREATE OR REPLACE FUNCTION public.delete_sa_announcement(p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._rms_require_super_admin();
  DELETE FROM sa_announcements WHERE id = p_id;
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- 2.5 upsert_sa_announcement
CREATE OR REPLACE FUNCTION public.upsert_sa_announcement(p_data jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  PERFORM public._rms_require_super_admin();
  v_id := COALESCE(NULLIF(p_data->>'id','')::uuid, gen_random_uuid());
  INSERT INTO sa_announcements (id, title, body, type, is_active, target_all, ends_at, created_by, updated_at)
  VALUES (
    v_id,
    p_data->>'title',
    NULLIF(p_data->>'body',''),
    COALESCE(NULLIF(p_data->>'type',''), 'info'),
    COALESCE((p_data->>'is_active')::boolean, true),
    COALESCE((p_data->>'target_all')::boolean, true),
    NULLIF(p_data->>'ends_at','')::timestamptz,
    NULLIF(p_data->>'created_by',''),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    title      = EXCLUDED.title,
    body       = EXCLUDED.body,
    type       = EXCLUDED.type,
    is_active  = EXCLUDED.is_active,
    target_all = EXCLUDED.target_all,
    ends_at    = EXCLUDED.ends_at,
    updated_at = now();
  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$function$;

-- 2.6 list_companies — convert from sql to plpgsql so the guard can be applied
CREATE OR REPLACE FUNCTION public.list_companies()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_rows jsonb;
BEGIN
  PERFORM public._rms_require_super_admin();
  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.company_name), '[]'::jsonb)
  INTO v_rows
  FROM public.companies c;
  RETURN v_rows;
END;
$function$;

-- 2.7 verify_payment — guard + p_verified_by hardening
-- The p_verified_by parameter is preserved in the signature for backward compat
-- but is OVERRIDDEN inside the body with the real super-admin's app_users.id
-- so audit logs can't be forged.
CREATE OR REPLACE FUNCTION public.verify_payment(p_proof_id uuid, p_action text, p_verified_by uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_proof   public.payment_proofs%ROWTYPE;
  v_inv     public.invoices%ROWTYPE;
  v_plan    public.subscription_plans%ROWTYPE;
  v_me      public.app_users;
  v_verifier uuid;
BEGIN
  PERFORM public._rms_require_super_admin();

  -- Override caller-supplied p_verified_by with the actual super-admin's id
  -- (param kept in signature for backward compat; ignored for audit truth).
  v_me := public._rms_caller();
  v_verifier := v_me.id;

  SELECT * INTO v_proof FROM public.payment_proofs WHERE id = p_proof_id LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'proof_not_found');
  END IF;

  IF p_action NOT IN ('approve', 'reject', 'needs_info') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_action');
  END IF;

  IF v_proof.invoice_id IS NOT NULL THEN
    SELECT * INTO v_inv FROM public.invoices WHERE id = v_proof.invoice_id LIMIT 1;
    IF FOUND THEN
      SELECT * INTO v_plan FROM public.subscription_plans WHERE id = v_inv.plan_id LIMIT 1;
    END IF;
  END IF;

  IF p_action = 'approve' THEN
    UPDATE public.payment_proofs SET
      status             = 'approved',
      verified_by        = v_verifier,
      verified_at        = NOW(),
      verification_notes = p_notes,
      updated_at         = NOW()
    WHERE id = p_proof_id;

    IF v_proof.invoice_id IS NOT NULL THEN
      UPDATE public.invoices SET
        status = 'paid', paid_date = CURRENT_DATE, updated_at = NOW()
      WHERE id = v_proof.invoice_id;
    END IF;

    UPDATE public.subscriptions SET
      status               = 'active',
      current_period_start = NOW(),
      current_period_end   = CASE
        WHEN v_plan.billing_cycle = 'yearly'
          THEN NOW() + INTERVAL '1 year'
        ELSE NOW() + INTERVAL '1 month'
      END,
      updated_at           = NOW()
    WHERE company_id = v_proof.company_id
      AND status IN ('pending_payment', 'payment_under_review');

  ELSIF p_action = 'reject' THEN
    UPDATE public.payment_proofs SET
      status             = 'rejected',
      verified_by        = v_verifier,
      verified_at        = NOW(),
      rejection_reason   = p_notes,
      updated_at         = NOW()
    WHERE id = p_proof_id;

    UPDATE public.subscriptions SET
      status = 'pending_payment', updated_at = NOW()
    WHERE company_id = v_proof.company_id
      AND status = 'payment_under_review';

  ELSIF p_action = 'needs_info' THEN
    UPDATE public.payment_proofs SET
      status             = 'needs_info',
      verified_by        = v_verifier,
      verified_at        = NOW(),
      verification_notes = p_notes,
      updated_at         = NOW()
    WHERE id = p_proof_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'action', p_action);
END;
$function$;

-- 2.8 list_sa_support_tickets
CREATE OR REPLACE FUNCTION public.list_sa_support_tickets(p_status text DEFAULT NULL::text, p_priority text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_rows jsonb;
BEGIN
  PERFORM public._rms_require_super_admin();
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY
    CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
    t.created_at DESC
  ), '[]'::jsonb)
  INTO v_rows
  FROM sa_support_tickets t
  WHERE (p_status   IS NULL OR t.status   = p_status)
    AND (p_priority IS NULL OR t.priority = p_priority);
  RETURN v_rows;
END;
$function$;

-- 2.9 update_sa_ticket
CREATE OR REPLACE FUNCTION public.update_sa_ticket(p_id uuid, p_data jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._rms_require_super_admin();
  UPDATE sa_support_tickets SET
    status          = COALESCE(NULLIF(p_data->>'status',''),   status),
    assigned_to     = COALESCE(NULLIF(p_data->>'assigned_to',''), assigned_to),
    resolution_note = COALESCE(NULLIF(p_data->>'resolution_note',''), resolution_note),
    priority        = COALESCE(NULLIF(p_data->>'priority',''), priority),
    resolved_at     = CASE WHEN p_data->>'status' IN ('resolved','closed') THEN NOW() ELSE resolved_at END,
    updated_at      = now()
  WHERE id = p_id;
  RETURN jsonb_build_object('success', true);
END;
$function$;
